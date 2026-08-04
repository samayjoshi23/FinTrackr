import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  doc,
  Firestore,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  collection,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { increment } from 'firebase/firestore';
import { UserProfile } from 'firebase/auth';
import {
  Account,
  AccountCreateInput,
  AccountMember,
  AccountType,
  AccountUpdateInput,
  memberFlagsForStatus,
  memberStatusOf,
} from '../../shared/models/account.model';
import { Router } from '@angular/router';
import { NotifierService } from '../../shared/components/notifier/notifier.service';
import { OfflineCrudService } from '../../core/offline/offline-crud.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';
import { NetworkService } from '../../core/offline/network.service';
import {
  REVALIDATION_TTL_MS,
  RevalidationTrackerService,
} from '../../core/offline/revalidation-tracker.service';
import { date, docCalendarDate } from '../../core/date';

const ACCOUNTS_COLLECTION = 'accounts';

function deriveAccountMemberIndexes(members: AccountMember[]): {
  memberIds: string[];
  activeMemberIds: string[];
} {
  // `inactive` members (left / declined / removed) are excluded from memberIds so the
  // `array-contains` listener drops the account for them — they lose access while their
  // row is kept for the owner. `invited` stays in memberIds so they can still accept.
  const memberIds = Array.from(
    new Set(
      members
        .filter((m) => memberStatusOf(m) !== 'inactive')
        .map((m) => m.memberId)
        .filter(Boolean),
    ),
  );
  const activeMemberIds = Array.from(
    new Set(
      members
        .filter((m) => memberStatusOf(m) === 'active')
        .map((m) => m.memberId)
        .filter(Boolean),
    ),
  );
  return { memberIds, activeMemberIds };
}

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);
  private readonly offlineCrud = inject(OfflineCrudService);
  private readonly cache = inject(IndexedDbCacheService);
  private readonly network = inject(NetworkService);
  private readonly functions = inject(Functions);
  private readonly tracker = inject(RevalidationTrackerService);

  /**
   * Session memo for the accounts list. `getSelectedAccount()` is called from nearly
   * every page/service; without this each call re-reads IndexedDB (and can trigger a
   * background Firestore revalidation). Invalidated on every account mutation.
   */
  private accountsMemo: { uid: string; accounts: Account[]; at: number } | null = null;

  /**
   * Reactive source of truth for the current user's accounts. Populated by
   * `refreshMyAccounts()` and auto-refreshed whenever the offline layer signals
   * fresh rows in the `accounts` store. Consumers do `service.myAccounts()` and
   * derive from it via `computed`.
   */
  private readonly _myAccounts = signal<Account[]>([]);
  readonly myAccounts = this._myAccounts.asReadonly();
  readonly selectedAccount = signal<Account | null>(null);

  /**
   * Signed-in uid that drives the realtime listeners. Set via {@link initRealtime}
   * on login and cleared via {@link stopRealtime} on logout (both from AuthService),
   * so listeners attach/detach with the auth session — no page refresh needed.
   */
  private readonly _userId = signal<string | null>(null);

  /** Live Firestore unsubscribe handles (owner query, member query, primary doc). */
  private unsubAccounts: Array<() => void> = [];
  /** Latest snapshot from each source, merged on every change. */
  private snapOwned = new Map<string, Account>();
  private snapMember = new Map<string, Account>();
  private snapPrimary: Account | null = null;
  /**
   * Whether each source has delivered its first snapshot. Cache pruning waits
   * until all three are ready, so a slow listener can't transiently delete an
   * account the others haven't reported yet (initial-load flicker).
   */
  private snapReady = { owned: false, member: false, primary: false };
  /** Coalescing guard so overlapping snapshot callbacks never reconcile the cache concurrently. */
  private publishing = false;
  private publishQueued = false;

  /**
   * Tombstones for accounts just deleted/left on this device (id → time added).
   *
   * A delete removes the row from the cache immediately, but the Firestore listeners
   * still hold the account in their in-memory snapshot maps until the removal
   * propagates. Without this, a snapshot callback firing in that window re-adds the
   * account via `putAll(merged)` and it reappears in the list. Every read path
   * (`doPublishRealtime`, `fetchMyAccountsFromFirestore`) filters tombstoned ids, and
   * `doPublishRealtime` clears a tombstone once the deletion has reached the snapshots
   * (or after {@link TOMBSTONE_TTL_MS}, so a re-created id can never stay hidden).
   */
  private readonly deletedIds = new Map<string, number>();
  private static readonly TOMBSTONE_TTL_MS = 10_000;

  constructor() {
    effect(() => {
      const _stamp = this.offlineCrud.revalidationCounts()['accounts'] ?? 0;
      untracked(() => {
        if (!this.auth.currentUser?.uid) return;
        void this.hydrateAccountsFromCache();
      });
    });

    // Realtime sync: attach Firestore listeners while signed-in AND online; detach
    // when offline (cache + background revalidation take over) or on logout. Any
    // remote change — a new shared account, an accept/reject, a balance update, or
    // being removed from an account — reflects live across devices.
    effect(() => {
      const uid = this._userId();
      const online = this.network.isOnline();
      untracked(() => {
        if (uid && online) {
          this.startAccountListeners(uid);
        } else {
          this.stopAccountListeners();
          if (!uid) this._myAccounts.set([]);
        }
      });
    });
  }

  /** Begin realtime account sync for a signed-in user (called from AuthService). */
  initRealtime(uid: string): void {
    if (this._userId() === uid) return;
    this._userId.set(uid);
  }

  /** Tear down realtime account sync (called from AuthService on logout). */
  stopRealtime(): void {
    this._userId.set(null);
  }

  // ─── Realtime listeners ───────────────────────────────────────────────────

  /**
   * Attach the three listeners that together cover every account the user can
   * see, matching {@link fetchMyAccountsFromFirestore}: owned (`ownerId == uid`),
   * the legacy primary doc (`accounts/{uid}`), and shared (`memberIds`
   * array-contains uid). Each fires independently; {@link publishRealtime} merges
   * their latest snapshots. Idempotent — a no-op if already listening.
   */
  private startAccountListeners(uid: string): void {
    if (this.unsubAccounts.length) return;

    const col = collection(this.firestore, ACCOUNTS_COLLECTION);
    // Keep cached data on error; the effect re-attaches when connectivity returns.
    const onErr = () => {};

    const unsubOwned = onSnapshot(
      query(col, where('ownerId', '==', uid)),
      (snap) => {
        this.snapOwned = new Map(snap.docs.map((d) => [d.id, this.mapAccount(d.id, d.data())]));
        this.snapReady.owned = true;
        void this.publishRealtime(uid);
      },
      onErr,
    );

    const unsubMember = onSnapshot(
      query(col, where('memberIds', 'array-contains', uid)),
      (snap) => {
        this.snapMember = new Map(snap.docs.map((d) => [d.id, this.mapAccount(d.id, d.data())]));
        this.snapReady.member = true;
        void this.publishRealtime(uid);
      },
      onErr,
    );

    const unsubPrimary = onSnapshot(
      this.accountDocRef(uid),
      (snap) => {
        this.snapPrimary = snap.exists() ? this.mapAccount(snap.id, snap.data()) : null;
        this.snapReady.primary = true;
        void this.publishRealtime(uid);
      },
      onErr,
    );

    this.unsubAccounts = [unsubOwned, unsubMember, unsubPrimary];
  }

  private stopAccountListeners(): void {
    for (const unsub of this.unsubAccounts) {
      try {
        unsub();
      } catch {
        /* already detached */
      }
    }
    this.unsubAccounts = [];
    this.snapOwned.clear();
    this.snapMember.clear();
    this.snapPrimary = null;
    this.snapReady = { owned: false, member: false, primary: false };
    this.publishing = false;
    this.publishQueued = false;
  }

  /**
   * Reconcile the cache with the merged live snapshots, then re-hydrate the
   * signal from cache. Going through the cache (rather than setting the signal
   * from `merged` directly) keeps locally-pending optimistic rows visible —
   * `reconcileAccountsCache` preserves `_pendingSync` rows, and
   * `hydrateAccountsFromCache` reads the whole `viewerUid` slice and applies the
   * per-user selection.
   */
  private async publishRealtime(uid: string): Promise<void> {
    if (this._userId() !== uid) return; // stale callback after teardown / user switch

    // Coalesce overlapping callbacks: while one publish runs, later ones just
    // flag a re-run, so reconciles never interleave and the final pass reflects
    // the latest snapshot maps.
    if (this.publishing) {
      this.publishQueued = true;
      return;
    }
    this.publishing = true;
    try {
      do {
        this.publishQueued = false;
        await this.doPublishRealtime(uid);
      } while (this.publishQueued && this._userId() === uid);
    } finally {
      this.publishing = false;
    }
  }

  private async doPublishRealtime(uid: string): Promise<void> {
    // Retire tombstones whose deletion has now reached the live snapshots (the account
    // is genuinely gone, so stop suppressing it), or that have outlived the TTL (a
    // safety valve so a re-created id can never stay hidden). Any tombstone still
    // present in a snapshot is an in-flight delete we must keep filtering.
    if (this.deletedIds.size) {
      const now = Date.now();
      for (const [id, at] of this.deletedIds) {
        const stillLive =
          this.snapOwned.has(id) || this.snapMember.has(id) || this.snapPrimary?.id === id;
        if (!stillLive || now - at > AccountsService.TOMBSTONE_TTL_MS) {
          this.deletedIds.delete(id);
        }
      }
    }

    const seen = new Set<string>();
    const merged: Account[] = [];
    const push = (a: Account | null | undefined) => {
      if (!a || seen.has(a.id) || this.deletedIds.has(a.id)) return;
      seen.add(a.id);
      merged.push(a);
    };
    for (const a of this.snapOwned.values()) push(a);
    push(this.snapPrimary);
    for (const a of this.snapMember.values()) push(a);

    // Only prune once every source has reported, so a slow listener can't delete
    // an account the others haven't delivered yet.
    const canPrune = this.snapReady.owned && this.snapReady.member && this.snapReady.primary;
    await this.reconcileAccountsCache(uid, merged, canPrune);
    this.clearSessionCache();
    await this.hydrateAccountsFromCache();

    // Once the live snapshot is complete it IS the authoritative cache state, so
    // mark the accounts slice fresh — this suppresses the offline-crud background
    // revalidation (getAccounts → fetchAll) that would otherwise re-fetch the same
    // data on every navigation while the listeners already keep it current.
    if (canPrune) {
      await this.tracker.markFresh('accounts', { indexName: 'viewerUid', value: uid });
    }
  }

  /**
   * Upsert the merged live rows into the cache. When `prune` is set, also delete
   * rows no longer present on the server — except local pending writes not yet
   * synced, which must survive until they reach Firestore.
   */
  private async reconcileAccountsCache(
    uid: string,
    merged: Account[],
    prune: boolean,
  ): Promise<void> {
    const keep = new Set(merged.map((a) => a.id));
    try {
      if (prune) {
        const existing = await this.cache.getAllByIndex<Account>('accounts', 'viewerUid', uid);
        for (const row of existing) {
          if (keep.has(row.id)) continue;
          // A tombstoned account was deleted/left server-side, so evict it even if a
          // stale `_pendingSync` flag lingers; otherwise keep unsynced local writes.
          if (this.deletedIds.has(row.id) || row._pendingSync !== true) {
            await this.cache.delete('accounts', row.id).catch(() => {});
          }
        }
      }
      await this.cache.putAll('accounts', merged);
    } catch {
      /* IndexedDB unavailable — the signal still refreshes on the next hydrate */
    }
  }

  /** Drop the in-memory accounts memo (mutations + logout). */
  clearSessionCache(): void {
    this.accountsMemo = null;
  }

  /**
   * Per-user "active account" selection.
   *
   * `isSelected`/`isActive` live on the shared account document, so on a
   * multi-user account they reflect the OWNER's choice and are overwritten for
   * members on every background revalidation (a member selecting the shared
   * account would lose that choice, and could even have their own primary
   * de-selected). The device's actual selection is therefore stored locally,
   * keyed by uid, and is the source of truth for which account is active for
   * THIS user. The doc flags remain a best-effort fallback (owner / legacy).
   */
  private selectedIdKey(uid: string): string {
    return `fintrackr-selected-account:${uid}`;
  }

  private readSelectedId(uid: string): string | null {
    try {
      return localStorage.getItem(this.selectedIdKey(uid));
    } catch {
      return null;
    }
  }

  private writeSelectedId(uid: string, accountId: string): void {
    try {
      localStorage.setItem(this.selectedIdKey(uid), accountId);
    } catch {
      /* storage unavailable (private mode / SSR) — fall back to doc flags */
    }
  }

  /** Resolve the active account for `uid`: local selection first, then doc flags, then first. */
  private pickSelected(uid: string, accounts: Account[]): Account | null {
    if (accounts.length === 0) return null;
    const storedId = this.readSelectedId(uid);
    return (
      (storedId ? accounts.find((a) => a.id === storedId) : undefined) ??
      accounts.find((a) => a.isSelected) ??
      accounts[0]
    );
  }

  private async hydrateAccountsFromCache(): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    // Single index read returns every account the user can see (owned + member),
    // because each row is stamped with `viewerUid = uid` when cached.
    const rows = await this.cache.getAllByIndex<Account>('accounts', 'viewerUid', uid);
    this._myAccounts.set(rows);
    const sel = this.pickSelected(uid, rows);
    if (sel) this.selectedAccount.set(sel);
  }

  /** Explicit refresh: seed from cache, then re-fetch via the offline layer. */
  async refreshMyAccounts(): Promise<Account[]> {
    try {
      const list = await this.getAccounts();
      this._myAccounts.set(list);
      const uid = this.auth.currentUser?.uid;
      const sel = uid ? this.pickSelected(uid, list) : (list[0] ?? null);
      if (sel) this.selectedAccount.set(sel);
    } catch (e) {
      console.warn('refreshMyAccounts failed', e);
    }
    return this._myAccounts();
  }

  private accountDocRef(userId: string) {
    return doc(this.firestore, `${ACCOUNTS_COLLECTION}/${userId}`);
  }

  /**
   * Creates the user's primary account (document id defaults to the owner's uid).
   * For additional accounts use {@link createAdditionalAccount}.
   */
  async createAccount(data: AccountCreateInput, userId?: string): Promise<Account> {
    const ownerUid = userId ?? this.requireUid();
    return this.createAccountInternal(data, { fixedDocId: ownerUid });
  }

  /** Creates an account with a new Firestore document id (multiple accounts per owner). */
  async createAdditionalAccount(data: AccountCreateInput): Promise<Account> {
    this.requireUid();
    return this.createAccountInternal(data, { useAutoId: true });
  }

  private async createAccountInternal(
    data: AccountCreateInput,
    opts: { fixedDocId: string } | { useAutoId: true },
  ): Promise<Account> {
    const day = date().format('YYYY-MM-DD');
    const accountType: AccountType = data.accountType ?? 'single-user';
    const members = serializeMembersForWrite(data.members);
    const memberIndex = deriveAccountMemberIndexes(data.members);

    this.clearSessionCache();
    return this.offlineCrud.create<Account>(
      'accounts',
      'id',
      async (assignedId: string) => {
        const ref = this.accountDocRef(assignedId);
        // Preflight read tells us whether to stamp `createdAt`/`date`/`initialBalance`
        // (fresh doc) vs. preserve them (re-run of the primary-account flow).
        // For auto-id docs the read rule denies (accountId ≠ auth.uid and the doc
        // doesn't exist yet for `canAccessExistingAccount` to inspect) — treat any
        // failure here as "doc is fresh" and proceed.
        const existing = await getDoc(ref).catch(() => null);
        const isFreshDoc = !existing || !existing.exists();
        const payload: Record<string, unknown> = {
          uid: assignedId,
          name: data.name.trim(),
          balance: Number(data.balance),
          currency: data.currency,
          isSelected: data.isSelected,
          isActive: data.isActive,
          members,
          memberIds: memberIndex.memberIds,
          activeMemberIds: memberIndex.activeMemberIds,
          accountType,
          ownerId: data.ownerId,
          updatedAt: serverTimestamp(),
        };
        if (isFreshDoc) {
          payload['createdAt'] = serverTimestamp();
          payload['date'] = day;
          payload['initialBalance'] = Number(data.balance);
        }
        await setDoc(ref, payload, { merge: true });
        const account = await this.getAccountDirect(assignedId);
        if (!account) {
          throw new Error('Failed to read account after creation.');
        }
        return account;
      },
      {
        name: data.name.trim(),
        balance: Number(data.balance),
        initialBalance: Number(data.balance),
        currency: data.currency,
        isSelected: data.isSelected,
        isActive: data.isActive,
        members,
        memberIds: memberIndex.memberIds,
        activeMemberIds: memberIndex.activeMemberIds,
        accountType,
        ownerId: data.ownerId,
        date: day,
        // Local-only; keeps the optimistic row in the `viewerUid` cache index.
        viewerUid: this.auth.currentUser?.uid ?? data.ownerId,
      },
      {
        ...('fixedDocId' in opts ? { fixedDocId: opts.fixedDocId } : {}),
        // Block until Firestore commits: `selectAccount`, budget-plan/goals/
        // monthly-report creates that fire right after all reference this doc's
        // id through `canAccessAccount(accountId)`, and their rules `get()`
        // won't see an uncommitted optimistic write.
        awaitRemote: true,
      },
    );
  }

  async applyPendingAccountCreate(docId: string, data: AccountCreateInput): Promise<void> {
    const day = date().format('YYYY-MM-DD');
    const ref = this.accountDocRef(docId);
    // Same rationale as `createAccountInternal` above — the read rule denies
    // for auto-id docs whose creator isn't yet a member. Treat any failure as
    // "doc is fresh" so a sync-queue retry can succeed.
    const existing = await getDoc(ref).catch(() => null);
    const isFreshDoc = !existing || !existing.exists();
    const accountType: AccountType = data.accountType ?? 'single-user';
    const members = serializeMembersForWrite(data.members);
    const memberIndex = deriveAccountMemberIndexes(data.members);
    const payload: Record<string, unknown> = {
      uid: docId,
      name: data.name.trim(),
      balance: Number(data.balance),
      currency: data.currency,
      isSelected: data.isSelected,
      isActive: data.isActive,
      members,
      memberIds: memberIndex.memberIds,
      activeMemberIds: memberIndex.activeMemberIds,
      accountType,
      ownerId: data.ownerId,
      updatedAt: serverTimestamp(),
    };
    if (isFreshDoc) {
      payload['createdAt'] = serverTimestamp();
      payload['date'] = day;
    }
    await setDoc(ref, payload, { merge: true });
    const account = await this.getAccountDirect(docId);
    if (!account) throw new Error('Failed to read account after pending create sync.');
    await this.cache.put('accounts', {
      ...account,
      viewerUid: this.auth.currentUser?.uid ?? account.ownerId,
      _pendingSync: false,
    });
    this.clearSessionCache();
  }

  /**
   * Atomically adjusts `balance` on `accounts/{accountDocId}` for a posted transaction.
   * Income increases balance; expense decreases. Returns the new balance after the write.
   * When offline, applies the change optimistically to the local cache.
   */
  async adjustBalanceForTransaction(
    accountDocId: string,
    amount: number,
    type: 'income' | 'expense',
  ): Promise<number> {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error('Invalid transaction amount.');
    }
    const delta = type === 'income' ? amt : -amt;

    if (this.network.isOnline()) {
      try {
        const ref = this.accountDocRef(accountDocId);
        await updateDoc(ref, {
          balance: increment(delta),
          updatedAt: serverTimestamp(),
        });
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          throw new Error('Account not found after balance update.');
        }
        const newBalance = Number(snap.data()['balance'] ?? 0);
        // Update cache with authoritative balance
        const cached = await this.cache.getByKey<Account>('accounts', accountDocId);
        if (cached) {
          cached.balance = newBalance;
          cached.updatedAt = new Date();
          await this.cache.put('accounts', cached);
        }
        this.clearSessionCache();
        return newBalance;
      } catch {
        // Fall through to offline handling
      }
    }

    // Offline: apply optimistic balance change
    const cached = await this.cache.getByKey<Account>('accounts', accountDocId);
    if (cached) {
      cached.balance = (cached.balance ?? 0) + delta;
      cached.updatedAt = new Date();
      cached._pendingSync = true;
      await this.cache.put('accounts', cached);
      this.clearSessionCache();
      return cached.balance;
    }
    throw new Error('Account not found in cache.');
  }

  /** Patch fields on `accounts/{accountId}` (only keys present in `patch` are written). */
  async updateAccount(accountId: string, patch: AccountUpdateInput): Promise<void> {
    const cached = await this.cache.getByKey<Account>('accounts', accountId);

    const patchRecord: Record<string, unknown> = {};
    if (patch.name !== undefined) patchRecord['name'] = patch.name.trim();
    if (patch.balance !== undefined) patchRecord['balance'] = Number(patch.balance);
    if (patch.currency !== undefined) patchRecord['currency'] = patch.currency;
    if (patch.isSelected !== undefined) patchRecord['isSelected'] = patch.isSelected;
    if (patch.isActive !== undefined) patchRecord['isActive'] = patch.isActive;
    if (patch.accountType !== undefined) patchRecord['accountType'] = patch.accountType;

    await this.offlineCrud.update<Account>(
      'accounts',
      accountId,
      async () => {
        const ref = this.accountDocRef(accountId);
        const updates: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
          ...patchRecord,
        };
        await setDoc(ref, updates, { merge: true });
      },
      patchRecord,
      (cached ?? {
        id: accountId,
        viewerUid: this.auth.currentUser?.uid,
      }) as unknown as Record<string, unknown>,
    );
    this.clearSessionCache();
  }

  /**
   * Active account from IndexedDB: `isSelected === true`, else first account for the user.
   */
  async getSelectedAccount(): Promise<Account | null> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return null;
    const accounts = await this.getAccounts(uid);
    if (accounts.length === 0) return null;
    return this.pickSelected(uid, accounts);
  }

  /** Persist an account row to the local cache (e.g. optimistic balance after a local-first save). */
  async writeAccountToCache(account: Account): Promise<void> {
    await this.cache.put('accounts', account);
    this.clearSessionCache();
  }

  /** Get the account doc by user id (defaults to current user). */
  async getAccount(userId?: string): Promise<Account | null> {
    const uid = userId ?? this.requireUid();
    return this.offlineCrud.fetchOne<Account>('accounts', uid, async () =>
      this.getAccountDirect(uid),
    );
  }

  /**
   * Returns all accounts the user owns **and** accounts they've been invited to /
   * joined, through a single cache-first + background-revalidation pipeline.
   *
   * One `fetchAll` keyed by the synthetic `viewerUid` index drives the whole
   * visible set: it returns the cached slice instantly, then revalidates from
   * Firestore in the background, writes fresh rows back to the cache, and bumps
   * `revalidationCounts['accounts']` — which the constructor effect observes to
   * re-hydrate `myAccounts`, so every subscriber updates automatically. This is
   * the same pattern the `groups` feature uses.
   */
  async getAccounts(userId?: string): Promise<Account[]> {
    const uid = userId ?? this.requireUid();

    const memo = this.accountsMemo;
    if (memo && memo.uid === uid && Date.now() - memo.at < REVALIDATION_TTL_MS['accounts']) {
      return [...memo.accounts];
    }

    const accounts = await this.offlineCrud.fetchAll<Account>(
      'accounts',
      () => this.fetchMyAccountsFromFirestore(uid),
      { indexName: 'viewerUid', value: uid },
    );
    this.accountsMemo = { uid, accounts: [...accounts], at: Date.now() };
    return accounts;
  }

  /**
   * Firestore read for the full visible set. Merges three sources and de-dupes by
   * id, then stamps `viewerUid` so the rows land in the local cache index:
   *   1. `ownerId == uid`               — accounts owned via the current schema.
   *   2. `accounts/{uid}` direct read   — the legacy primary account, whose doc id
   *      is the owner's uid and which may predate the `ownerId` field. Including it
   *      guarantees the primary is always listed even without a data migration.
   *   3. `memberIds array-contains uid` — shared accounts the user was invited to
   *      or has joined (pending members are in `memberIds`; active ones also in
   *      `activeMemberIds`).
   */
  private async fetchMyAccountsFromFirestore(uid: string): Promise<Account[]> {
    const col = collection(this.firestore, ACCOUNTS_COLLECTION);
    const [ownedSnap, primarySnap, memberSnap] = await Promise.all([
      getDocs(query(col, where('ownerId', '==', uid))),
      getDoc(this.accountDocRef(uid)).catch(() => null),
      getDocs(query(col, where('memberIds', 'array-contains', uid))),
    ]);

    const seen = new Set<string>();
    const out: Account[] = [];
    const push = (id: string, data: unknown) => {
      // Skip an account deleted/left on this device whose removal Firestore hasn't
      // propagated yet, so a background revalidation can't resurrect it in the cache.
      if (seen.has(id) || this.deletedIds.has(id)) return;
      seen.add(id);
      // mapAccount stamps viewerUid = current uid, so rows land in the cache index.
      out.push(this.mapAccount(id, data));
    };

    for (const d of ownedSnap.docs) push(d.id, d.data());
    if (primarySnap?.exists()) push(primarySnap.id, primarySnap.data());
    for (const d of memberSnap.docs) push(d.id, d.data());
    return out;
  }

  /**
   * Marks one account selected in Firestore (`isSelected`) and IndexedDB.
   * Pass `accountId` as the Firestore document id (`Account.id`). Omit to resolve from flags/first.
   */
  async selectAccount(accountId?: string | null): Promise<Account | null> {
    const accounts = await this.getAccounts();
    if (accounts.length === 0) {
      this.notifier.error('No accounts found. Please setup your accounts first');
      await this.router.navigateByUrl('/onboarding');
      return null;
    }

    let selected: Account | undefined;
    if (accountId) {
      selected = accounts.find((a) => a.id === accountId || a.uid === accountId);
      if (!selected) {
        this.notifier.error('Account not found.');
        return null;
      }
    } else {
      selected = accounts.find((a) => a.isSelected) ?? accounts[0];
    }

    const selectedDocId = selected.id;
    const uid = this.requireUid();

    // Durable, per-user selection (survives revalidation clobbering doc flags).
    this.writeSelectedId(uid, selectedDocId);

    // Update Firestore only for owned accounts — members can't write to the account doc
    const ownedAccounts = accounts.filter((a) => a.ownerId === uid);
    await Promise.all(
      ownedAccounts.map((account) =>
        this.updateAccount(account.id, {
          isSelected: account.id === selectedDocId,
          isActive: account.id === selectedDocId,
        }),
      ),
    );

    // Update IDB cache for member accounts (local-only selection state)
    const memberAccounts = accounts.filter((a) => a.ownerId !== uid);
    for (const account of memberAccounts) {
      const updated: Account = {
        ...account,
        isSelected: account.id === selectedDocId,
        isActive: account.id === selectedDocId,
      };
      await this.cache.put('accounts', updated);
    }

    this.clearSessionCache();

    const refreshed = await this.getAccount(selectedDocId);
    if (!refreshed) {
      this.notifier.error('Could not load the selected account.');
      return null;
    }

    refreshed.isSelected = true;
    refreshed.isActive = true;
    return refreshed;
  }

  /**
   * Delete an owned account and every doc that references its id — transactions,
   * recurring, monthlyReports, budgets, budgetPlan, goals, categories — and notify
   * any active member of the account that it's been removed.
   *
   * Server-side (`deleteAccountCascade` callable) does the cascade with Admin SDK
   * so nothing gets orphaned by Firestore rules that check `canAccessAccount`.
   * Only the account's owner may invoke this — members can leave or decline invites
   * but can never delete a shared account.
   *
   * Fully requires network: the cascade is not offline-safe. If offline, throws
   * so the caller can surface a "reconnect and retry" message.
   */
  async deleteAccount(accountDocId: string): Promise<void> {
    this.requireUid();

    const all = await this.getAccounts();
    if (all.length <= 1) {
      throw new Error('You must keep at least one account.');
    }
    if (!this.network.isOnline()) {
      throw new Error('You must be online to delete an account.');
    }

    const call = httpsCallable<
      { accountId: string },
      { ok: boolean; notified: number }
    >(this.functions, 'deleteAccountCascade');
    await call({ accountId: accountDocId });

    // Server has already deleted the Firestore doc + cascade. Tombstone the id and
    // evict it from the live snapshot maps so an in-flight listener callback can't
    // re-add it before the removal propagates, then drop the local IDB row and refresh.
    this.forgetAccountLocally(accountDocId);
    await this.cache.delete('accounts', accountDocId).catch(() => {});
    this.clearSessionCache();
    await this.refreshMyAccounts();
    await this.selectAccount(null);
  }

  /**
   * Optimistically remove an account from every local view (tombstone, live snapshot
   * maps, and the `myAccounts` signal) after a delete/leave, so it disappears
   * immediately and can't be resurrected by a stale realtime callback or a background
   * revalidation racing the server-side removal.
   */
  private forgetAccountLocally(accountId: string): void {
    this.deletedIds.set(accountId, Date.now());
    this.snapOwned.delete(accountId);
    this.snapMember.delete(accountId);
    if (this.snapPrimary?.id === accountId) this.snapPrimary = null;
    this._myAccounts.update((list) => list.filter((a) => a.id !== accountId));
  }

  /** Accept the invite and become an active member of a shared account. */
  async joinAccount(accountId: string): Promise<void> {
    const fn = httpsCallable<{ accountId: string; accept: boolean }, { ok: boolean }>(
      this.functions,
      'respondAccountInvite',
    );
    await fn({ accountId, accept: true });
    this.clearSessionCache();
    await this.refreshMyAccounts();
  }

  /** Leave a shared account (removes the current user from the members list). */
  async leaveAccount(accountId: string): Promise<void> {
    const fn = httpsCallable<{ accountId: string; accept: boolean }, { ok: boolean }>(
      this.functions,
      'respondAccountInvite',
    );
    await fn({ accountId, accept: false });
    this.forgetAccountLocally(accountId);
    await this.cache.delete('accounts', accountId).catch(() => {});
    this.clearSessionCache();
    await this.refreshMyAccounts();
    await this.selectAccount(null);
  }

  // ─── Owner-side member management (all Admin-SDK callables) ──────────────────
  // Rules forbid the client from changing `memberIds`/`activeMemberIds` directly,
  // so add/remove/resend go through Cloud Functions, like `respondAccountInvite`.

  /**
   * Owner: invite a user to this shared account (or re-invite a previously-inactive
   * one). The member lands in `invited` status; the `onAccountUpdated` trigger fires
   * the ACCOUNT_INVITE notification.
   */
  async addMember(
    accountId: string,
    member: { memberId: string; memberDisplayName: string },
  ): Promise<void> {
    const fn = httpsCallable<
      { accountId: string; memberId: string; memberDisplayName: string },
      { ok: boolean }
    >(this.functions, 'addAccountMember');
    await fn({
      accountId,
      memberId: member.memberId,
      memberDisplayName: member.memberDisplayName,
    });
    this.clearSessionCache();
    await this.refreshMyAccounts();
  }

  /**
   * Owner: remove a member. `permanent: false` (default) sets them `inactive` — kept
   * as a record, but dropped from `memberIds` so they lose access. `permanent: true`
   * deletes the row entirely. The removed member is notified server-side.
   */
  async removeMember(accountId: string, memberId: string, permanent = false): Promise<void> {
    const fn = httpsCallable<
      { accountId: string; memberId: string; permanent: boolean },
      { ok: boolean }
    >(this.functions, 'removeAccountMember');
    await fn({ accountId, memberId, permanent });
    this.clearSessionCache();
    await this.refreshMyAccounts();
  }

  /** Owner: re-send the ACCOUNT_INVITE notification to a still-pending (`invited`) member. */
  async resendInvite(accountId: string, memberId: string): Promise<void> {
    const fn = httpsCallable<{ accountId: string; memberId: string }, { ok: boolean }>(
      this.functions,
      'resendAccountInvite',
    );
    await fn({ accountId, memberId });
  }

  // --- User profile (existing helper; kept for onboarding) ---

  async updateUserProfile(userId: string, userProfile: UserProfile) {
    const userProfileRef = doc(this.firestore, `users/${userId}`);
    await setDoc(
      userProfileRef,
      {
        ...userProfile,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  /** Direct Firestore read bypassing offline layer (used internally after create). */
  private async getAccountDirect(userId: string): Promise<Account | null> {
    const snap = await getDoc(this.accountDocRef(userId));
    if (!snap.exists()) return null;
    return this.mapAccount(userId, snap.data());
  }

  private requireUid(): string {
    // Resolve from Firebase Auth (authoritative, in-memory, survives cleared
    // localStorage/IndexedDB caches) — consistent with every other feature service.
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('You must be signed in to manage accounts.');
    }
    return uid;
  }

  private mapAccount(id: string, data: unknown): Account {
    const d = data as Record<string, unknown>;
    const createdAt = d['createdAt'] as { toDate?: () => Date } | null | undefined;
    const updatedAt = d['updatedAt'] as { toDate?: () => Date } | null | undefined;
    const created = createdAt?.toDate?.() ?? null;
    const rawType = d['accountType'] as AccountType | undefined;
    const accountType: AccountType =
      rawType === 'multi-user' || rawType === 'single-user' ? rawType : 'single-user';
    return {
      id,
      uid: (d['uid'] as string) ?? id,
      name: (d['name'] as string) ?? '',
      balance: Number(d['balance'] ?? 0),
      initialBalance: typeof d['initialBalance'] === 'number' ? d['initialBalance'] : undefined,
      currency: (d['currency'] as string) ?? '',
      isSelected: d['isSelected'] as boolean | undefined,
      isActive: d['isActive'] as boolean | undefined,
      members: normalizeMembersFromFirestore(d['members']),
      ownerId: (d['ownerId'] as string | undefined) ?? undefined,
      accountType,
      createdAt: created,
      updatedAt: updatedAt?.toDate?.() ?? null,
      date: docCalendarDate(d, created),
      // Stamp the local viewer so EVERY cache write (getAccount/fetchOne/
      // revalidateOne, not just the list fetch) lands in the `viewerUid` index.
      // Without this, viewing an account's details (getAccount → revalidateOne)
      // would overwrite its stamped row with an unstamped one and drop it from
      // the accounts list. Always the current user — accounts are only ever
      // read/cached in that user's own session.
      viewerUid: this.auth.currentUser?.uid,
    };
  }
}

function serializeMembersForWrite(members: AccountMember[]): Record<string, unknown>[] {
  return members.map((m) => {
    const status = memberStatusOf(m);
    const flags = memberFlagsForStatus(status);
    return {
      memberId: m.memberId.trim(),
      memberDisplayName: (m.memberDisplayName ?? '').trim(),
      status,
      isJoined: flags.isJoined,
      isActive: flags.isActive,
    };
  });
}

function normalizeMembersFromFirestore(raw: unknown): AccountMember[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  if (raw.length === 0) return [];
  if (typeof raw[0] === 'string') {
    return (raw as string[]).map((memberId) => ({
      memberId: memberId,
      memberDisplayName: '',
      status: 'invited' as const,
      isJoined: false,
      isActive: false,
    }));
  }
  return (raw as Record<string, unknown>[]).map((row) => {
    const isJoined = Boolean(row['isJoined']);
    const isActive = Boolean(row['isActive']);
    const status = memberStatusOf({ status: row['status'], isJoined, isActive });
    return {
      memberId: String(row['memberId'] ?? ''),
      memberDisplayName: String(row['memberDisplayName'] ?? ''),
      status,
      isJoined,
      isActive,
    };
  });
}

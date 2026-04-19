import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Firestore, collection, query, orderBy, limit, onSnapshot, doc, updateDoc, writeBatch, serverTimestamp, Timestamp } from '@angular/fire/firestore';
import { NetworkService } from '../../core/offline/network.service';
import { IndexedDbCacheService } from '../../core/offline/indexed-db-cache.service';
import {
  AppNotification,
  AppNotificationDocument,
  NotificationStatus,
  ACTION_NOTIFICATION_TYPES,
} from '../../shared/models/notification.model';

const STORE = 'notifications';
const PAGE_SIZE = 20;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly firestore = inject(Firestore);
  private readonly network = inject(NetworkService);
  private readonly cache = inject(IndexedDbCacheService);

  private unsubFirestore: (() => void) | null = null;

  private readonly _userId = signal<string | null>(null);
  private readonly _queryLimit = signal(PAGE_SIZE);
  private readonly _notifications = signal<AppNotification[]>([]);
  private readonly _loading = signal(false);
  private readonly _activeFilter = signal<'all' | string>('all');
  private readonly _hasMore = signal(true);

  readonly notifications = this._notifications.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly activeFilter = this._activeFilter.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();

  readonly unreadCount = computed(() =>
    this._notifications().filter((n) => n.status === 'UNREAD').length,
  );
  readonly hasUnread = computed(() => this.unreadCount() > 0);

  readonly filteredNotifications = computed(() => {
    const filter = this._activeFilter();
    const all = this._notifications();
    return filter === 'all' ? all : all.filter((n) => n.accountId === filter);
  });

  constructor() {
    // Manage Firestore listener reactively based on user + network state
    effect(() => {
      const uid = this._userId();
      const online = this.network.isOnline();

      if (uid && online) {
        this.setupListener(uid);
      } else if (!uid) {
        this.teardownListener();
        this._notifications.set([]);
      }
    });
  }

  /**
   * Initialize for a user. Loads IndexedDB cache immediately (offline-first),
   * then the Firestore listener picks up when online.
   */
  async init(userId: string): Promise<void> {
    if (this._userId() === userId) return; // already initialized

    this._loading.set(true);
    this._userId.set(userId);

    try {
      const cached = await this.cache.getAllByIndex<AppNotification>(
        STORE,
        'receiverId',
        userId,
      );
      if (cached.length > 0) {
        this._notifications.set(this.sortDesc(this.rehydrateDates(cached)));
      }
    } catch {
      // IndexedDB may not be ready during first boot — listener will hydrate
    }

    this._loading.set(false);
  }

  setFilter(filter: 'all' | string): void {
    this._activeFilter.set(filter);
  }

  loadMore(): void {
    const uid = this._userId();
    if (!uid || !this._hasMore()) return;
    this._queryLimit.update((l) => l + PAGE_SIZE);
    this.teardownListener();
    if (this.network.isOnline()) {
      this.setupListener(uid);
    }
  }

  async markAsRead(notificationId: string): Promise<void> {
    const uid = this._userId();
    if (!uid) return;

    const now = new Date();
    this._notifications.update((list) =>
      list.map((n) =>
        n.id === notificationId
          ? { ...n, status: 'READ' as NotificationStatus, readAt: now }
          : n,
      ),
    );
    await this.persistCache();

    if (this.network.isOnline()) {
      try {
        await updateDoc(doc(this.firestore, `users/${uid}/notifications/${notificationId}`), {
          status: 'READ',
          readAt: serverTimestamp(),
        });
      } catch {
        /* will be corrected on next listener snapshot */
      }
    }
  }

  async markAsActionTaken(notificationId: string): Promise<void> {
    const uid = this._userId();
    if (!uid) return;

    this._notifications.update((list) =>
      list.map((n) =>
        n.id === notificationId ? { ...n, status: 'ACTION_TAKEN' as NotificationStatus } : n,
      ),
    );
    await this.persistCache();

    if (this.network.isOnline()) {
      try {
        await updateDoc(doc(this.firestore, `users/${uid}/notifications/${notificationId}`), {
          status: 'ACTION_TAKEN',
        });
      } catch {
        /* will be corrected on next listener snapshot */
      }
    }
  }

  async markAllAsRead(): Promise<void> {
    const uid = this._userId();
    if (!uid) return;

    const unread = this._notifications().filter((n) => n.status === 'UNREAD');
    if (unread.length === 0) return;

    const now = new Date();
    this._notifications.update((list) =>
      list.map((n) =>
        n.status === 'UNREAD' ? { ...n, status: 'READ' as NotificationStatus, readAt: now } : n,
      ),
    );
    await this.persistCache();

    if (this.network.isOnline()) {
      try {
        const batch = writeBatch(this.firestore);
        for (const n of unread) {
          batch.update(doc(this.firestore, `users/${uid}/notifications/${n.id}`), {
            status: 'READ',
            readAt: serverTimestamp(),
          });
        }
        await batch.commit();
      } catch {
        /* will reconcile on next online event */
      }
    }
  }

  /** Called on logout — clears cache and tears down the listener. */
  async clearAll(): Promise<void> {
    this.teardownListener();
    this._userId.set(null);
    this._notifications.set([]);
    this._queryLimit.set(PAGE_SIZE);
    this._activeFilter.set('all');
    try {
      await this.cache.clear(STORE);
    } catch {
      /* ignore if store missing */
    }
  }

  /** Returns true if a notification type supports inline action buttons. */
  supportsActions(type: AppNotification['type']): boolean {
    return ACTION_NOTIFICATION_TYPES.includes(type);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private setupListener(userId: string): void {
    if (this.unsubFirestore) return; // already listening

    const q = query(
      collection(this.firestore, `users/${userId}/notifications`),
      orderBy('createdAt', 'desc'),
      limit(this._queryLimit()),
    );

    this.unsubFirestore = onSnapshot(
      q,
      async (snapshot) => {
        const docs = snapshot.docs.map((d) =>
          this.fromFirestoreDoc(d.id, d.data() as AppNotificationDocument),
        );
        this._notifications.set(docs);
        this._hasMore.set(docs.length >= this._queryLimit());
        await this.cache.putAll(STORE, docs).catch(() => {});
      },
      () => {
        // On error, keep cached data; listener will retry on reconnect
      },
    );
  }

  private teardownListener(): void {
    this.unsubFirestore?.();
    this.unsubFirestore = null;
  }

  private async persistCache(): Promise<void> {
    try {
      await this.cache.putAll(STORE, this._notifications());
    } catch {
      /* IndexedDB may be unavailable */
    }
  }

  private fromFirestoreDoc(id: string, data: AppNotificationDocument): AppNotification {
    const expiresRaw = data.expiresAt as Timestamp | null | undefined;
    return {
      id,
      type: data.type,
      title: data.title,
      body: data.body,
      senderId: data.senderId ?? null,
      receiverId: data.receiverId,
      accountId: data.accountId ?? null,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      actionData: data.actionData ?? {},
      status: data.status,
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate()
          : data.createdAt
            ? new Date(data.createdAt as unknown as string)
            : null,
      readAt:
        data.readAt instanceof Timestamp
          ? data.readAt.toDate()
          : data.readAt
            ? new Date(data.readAt as unknown as string)
            : null,
      isPushSent: data.isPushSent ?? false,
      expiresAt:
        expiresRaw instanceof Timestamp
          ? expiresRaw.toDate()
          : expiresRaw
            ? new Date(expiresRaw as unknown as string)
            : null,
      priority: data.priority ?? 'normal',
      source: data.source ?? 'system',
      category: data.category ?? null,
      subtitle: data.subtitle ?? null,
    };
  }

  /** Rehydrates Date fields that IndexedDB may have stored as ISO strings. */
  private rehydrateDates(list: AppNotification[]): AppNotification[] {
    return list.map((n) => ({
      ...n,
      createdAt:
        n.createdAt instanceof Date
          ? n.createdAt
          : n.createdAt
            ? new Date(n.createdAt as unknown as string)
            : null,
      readAt:
        n.readAt instanceof Date
          ? n.readAt
          : n.readAt
            ? new Date(n.readAt as unknown as string)
            : null,
      expiresAt:
        n.expiresAt instanceof Date
          ? n.expiresAt
          : n.expiresAt
            ? new Date(n.expiresAt as unknown as string)
            : null,
      priority: n.priority ?? 'normal',
      source: n.source ?? 'system',
      category: n.category ?? null,
      subtitle: n.subtitle ?? null,
    }));
  }

  private sortDesc(list: AppNotification[]): AppNotification[] {
    return [...list].sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );
  }
}

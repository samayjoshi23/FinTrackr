import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Icon } from '../../../../shared/components/icon/icon';
import { FormsModule, NgForm } from '@angular/forms';
import { LinkedObject, TransactionCreateInput } from '../../../../shared/models/transaction.model';
import { AccountsService } from '../../../../services/accounts.service';
import { CategoriesService } from '../../../../services/categories.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { ReportsService } from '../../../../services/reports.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { GroupsService } from '../../groups.service';
import { GroupExpensesService } from '../../group-expenses.service';
import { GroupSettlementsService } from '../../group-settlements.service';
import { memberAvatarClass, memberInitials } from '../../group-balance.utils';
import {
  ExpenseSplit,
  Group,
  GroupExpense,
  GroupMember,
} from '../../../../shared/models/group.model';
import { Account } from '../../../../shared/models/account.model';
import { Category } from '../../../categories/types';
import { paymentSourceOptions } from '../../../transactions/types';
import { DatePicker } from '../../../../shared/components/date-picker/date-picker';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';
import { date } from '../../../../core/date';
import { CurrencyPipe, Location } from '@angular/common';

export type GroupTransactionType = 'expense' | 'settlement';
type SplitMode = 'equal' | 'custom';

@Component({
  selector: 'app-add-group-transaction',
  imports: [CommonModule, Icon, FormsModule, DatePicker],
  templateUrl: './add-group-transaction.html',
  styleUrl: './add-group-transaction.css',
})
export class AddGroupTransaction {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly functions = inject(Functions);
  private readonly location = inject(Location);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly reportsService = inject(ReportsService);
  private readonly notifier = inject(NotifierService);
  private readonly groupsService = inject(GroupsService);
  private readonly expensesService = inject(GroupExpensesService);
  private readonly settlementsService = inject(GroupSettlementsService);

  groupId = signal('');
  formType = signal<GroupTransactionType>('expense');
  group = signal<Group | null>(null);
  members = signal<GroupMember[]>([]);
  currentUserId = signal('');
  currentUserName = signal('');
  selectedAccount = signal<Account | null>(null);
  categories = signal<Category[]>([]);
  currencySymbol = signal('₹');
  loading = signal(true);
  saving = signal(false);

  readonly limits = FORM_LIMITS;
  readonly paymentSources = paymentSourceOptions;

  // ── Expense form fields ──────────────────────────────────────────────────
  expenseAmount = signal<number | string>('');
  expenseDescription = signal('');
  expenseSource = signal('');
  expenseCategory = signal('');
  expenseIcon = signal<string | null>(null);
  expensePaidByIds = signal<string[]>([]);
  expenseDate = signal<string>(date().format('YYYY-MM-DD'));
  splitMode = signal<SplitMode>('equal');
  customSplits = signal<{ memberId: string; memberName: string; amount: string }[]>([]);

  // ── Settlement form fields ───────────────────────────────────────────────
  settlementAmount = signal<number | string>('');
  settlementDescription = signal('');
  settlementSource = signal('');
  settlementCategory = signal('');
  settlementIcon = signal<string | null>(null);
  /** Creditor: who will receive the money (set from query params) */
  creditorId = signal('');
  creditorName = signal('');
  /** Max allowed settlement amount */
  maxSettlementAmount = signal<number | null>(null);

  readonly settlementDirectionLabel = computed(() => {
    const creditor = this.members().find((m) => m.memberId === this.creditorId());
    const name = creditor?.memberDisplayName ?? 'the payee';
    return `Recording a payment from You to ${name.split(' ')[0]}`;
  });

  async ngOnInit() {
    const gid = this.route.snapshot.paramMap.get('id') ?? '';
    const type = (this.route.snapshot.queryParamMap.get('type') ?? 'expense') as GroupTransactionType;
    const toId = this.route.snapshot.queryParamMap.get('toId') ?? '';
    const preAmount = this.route.snapshot.queryParamMap.get('amount') ?? '';
    const preDesc = this.route.snapshot.queryParamMap.get('description') ?? '';

    this.groupId.set(gid);
    this.formType.set(type);

    const uid = this.auth.currentUser?.uid ?? '';
    const uName = this.auth.currentUser?.displayName ?? 'Me';
    this.currentUserId.set(uid);
    this.currentUserName.set(uName);

    try {
      const [grp, categories, account] = await Promise.all([
        this.groupsService.getGroup(gid),
        this.categoriesService.getCategories(),
        this.accountsService.getSelectedAccount(),
      ]);

      this.group.set(grp);
      this.members.set(grp?.members.filter((m) => m.isActive) ?? []);
      this.categories.set(categories);
      this.selectedAccount.set(account);

      const sym = new CurrencyPipe('en-IN').transform(
        0,
        account?.currency ?? grp?.currency ?? 'INR',
        'symbol',
        '0.0-0',
      );
      this.currencySymbol.set((sym ?? '₹').split('')[0]);

      if (type === 'expense') {
        this.expensePaidByIds.set([uid]);
        this.rebuildCustomSplits();
      } else {
        // Settlement: pre-fill from query params
        if (toId) {
          this.creditorId.set(toId);
          const credMember = grp?.members.find((m) => m.memberId === toId);
          this.creditorName.set(credMember?.memberDisplayName ?? '');
        }
        if (preAmount) this.settlementAmount.set(parseFloat(preAmount) || '');
        if (preDesc) this.settlementDescription.set(preDesc);
        if (preAmount) this.maxSettlementAmount.set(parseFloat(preAmount) || null);

        // Pre-select same category as expense if available
        const defaultCat = categories.find((c) => c.name === preDesc) ?? null;
        if (defaultCat) {
          this.settlementCategory.set(defaultCat.name);
          this.settlementIcon.set(defaultCat.icon ?? null);
        }
      }
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not load group data.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Expense helpers ──────────────────────────────────────────────────────

  allMembersForSplit(): GroupMember[] {
    const uid = this.currentUserId();
    const others = this.members().filter((m) => m.memberId !== uid);
    const me: GroupMember = {
      memberId: uid,
      memberDisplayName: this.currentUserName(),
      isActive: true,
      joinedAt: null,
    };
    return [me, ...others];
  }

  private rebuildCustomSplits() {
    this.customSplits.set(
      this.allMembersForSplit().map((m) => ({
        memberId: m.memberId,
        memberName: m.memberDisplayName,
        amount: '',
      })),
    );
  }

  togglePaidBy(memberId: string) {
    const current = this.expensePaidByIds();
    if (current.includes(memberId)) {
      if (current.length === 1) return; // at least one payer required
      this.expensePaidByIds.set(current.filter((id) => id !== memberId));
    } else {
      this.expensePaidByIds.set([...current, memberId]);
    }
  }

  onSplitModeChange(mode: SplitMode) {
    this.splitMode.set(mode);
    if (mode === 'custom') this.rebuildCustomSplits();
  }

  totalCustomSplit(): number {
    return this.customSplits().reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  }

  isSplitMismatch(): boolean {
    const total = this.totalCustomSplit();
    const amount = parseFloat(String(this.expenseAmount()));
    return Math.abs(total - amount) > 0.01;
  }

  onExpenseCategoryChange(cat: Category) {
    this.expenseCategory.set(cat.name);
    this.expenseIcon.set(cat.icon ?? null);
  }

  onSettlementCategoryChange(cat: Category) {
    this.settlementCategory.set(cat.name);
    this.settlementIcon.set(cat.icon ?? null);
  }

  onExpenseSourceChange(src: string) {
    this.expenseSource.set(src);
  }

  onSettlementSourceChange(src: string) {
    this.settlementSource.set(src);
  }

  initials(name: string) {
    return memberInitials(name);
  }

  avatarClass(id: string) {
    return memberAvatarClass(id);
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  async onSubmit(form: NgForm) {
    if (this.formType() === 'expense') {
      await this.submitExpense(form);
    } else {
      await this.submitSettlement(form);
    }
  }

  private async submitExpense(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      this.notifier.error('Please fix the highlighted fields.');
      return;
    }

    const amount = parseFloat(String(this.expenseAmount()));
    if (!amount || amount <= 0) {
      this.notifier.error('Enter a valid amount.');
      return;
    }

    if (!this.expenseSource().trim()) {
      this.notifier.error('Select a payment source.');
      return;
    }

    if (!this.expenseCategory().trim()) {
      this.notifier.error('Select a category.');
      return;
    }

    const gid = this.groupId();
    const grp = this.group();
    if (!grp) return;

    const allMembers = this.allMembersForSplit();
    let splits: ExpenseSplit[];

    if (this.splitMode() === 'equal') {
      const share = parseFloat((amount / allMembers.length).toFixed(2));
      splits = allMembers.map((m, i) => ({
        memberId: m.memberId,
        memberName: m.memberDisplayName,
        amount: i === 0 ? parseFloat((amount - share * (allMembers.length - 1)).toFixed(2)) : share,
        isPaid: this.expensePaidByIds().includes(m.memberId),
      }));
    } else {
      if (this.isSplitMismatch()) {
        this.notifier.error(
          `Split amounts must sum to ${amount}. Current total: ${this.totalCustomSplit().toFixed(2)}`,
        );
        return;
      }
      splits = this.customSplits().map((c) => ({
        memberId: c.memberId,
        memberName: c.memberName,
        amount: parseFloat(c.amount) || 0,
        isPaid: this.expensePaidByIds().includes(c.memberId),
      }));
    }

    const payerIds = this.expensePaidByIds();
    const primaryPayerId = payerIds[0] ?? this.currentUserId();
    const primaryPayerName =
      allMembers.find((m) => m.memberId === primaryPayerId)?.memberDisplayName ?? '';
    const payerNames = payerIds.map(
      (id) => allMembers.find((m) => m.memberId === id)?.memberDisplayName ?? id,
    );

    this.saving.set(true);
    try {
      const expense = await this.expensesService.addExpense({
        groupId: gid,
        description: this.expenseDescription().trim(),
        amount,
        currency: grp.currency,
        paidById: primaryPayerId,
        paidByName: primaryPayerName,
        paidByIds: payerIds,
        paidByNames: payerNames,
        splits,
        date: this.expenseDate(),
      });

      // Create transaction for the current user (payer) with linkedObject
      const linkedObject: LinkedObject = {
        type: 'group-expense',
        id: gid,
        recordId: expense.id,
      };

      const account = this.selectedAccount();
      if (account) {
        const txPayload: TransactionCreateInput = {
          accountId: account.uid ?? '',
          amount,
          description: this.expenseDescription().trim(),
          category: this.expenseCategory(),
          icon: this.expenseIcon(),
          type: 'expense',
          source: this.expenseSource(),
          paidBy: this.currentUserId(),
          date: this.expenseDate(),
          linkedObject,
        };

        const txResponse = await this.transactionsService.createTransaction(txPayload, {
          syncRemoteInBackground: true,
        });

        void this.reportsService.updateReportForTransaction(txResponse).catch((e) => console.error(e));
        void this.accountsService
          .adjustBalanceForTransaction(
            account.id || account.uid,
            amount,
            'expense',
          )
          .catch((e) => console.error(e));
      }

      // Notify other group members via cloud function
      void this.notifyGroupMembers(gid, expense);

      this.notifier.success('Expense added.');
      await this.router.navigateByUrl(`/user/groups/${gid}`, { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not add group expense.');
    } finally {
      this.saving.set(false);
    }
  }

  private async submitSettlement(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      this.notifier.error('Please fix the highlighted fields.');
      return;
    }

    const amount = parseFloat(String(this.settlementAmount()));
    if (!amount || amount <= 0) {
      this.notifier.error('Enter a valid amount.');
      return;
    }

    const max = this.maxSettlementAmount();
    if (max !== null && amount > max + 0.005) {
      this.notifier.error(`Amount cannot exceed ${max.toFixed(2)}.`);
      return;
    }

    if (!this.settlementSource().trim()) {
      this.notifier.error('Select a payment source.');
      return;
    }

    const gid = this.groupId();
    const grp = this.group();
    const credId = this.creditorId();
    const credName = this.creditorName();
    if (!grp || !credId) return;

    this.saving.set(true);
    try {
      const settlement = await this.settlementsService.addSettlement({
        groupId: gid,
        fromId: this.currentUserId(),
        fromName: this.currentUserName(),
        toId: credId,
        toName: credName,
        amount,
        currency: grp.currency,
        note: this.settlementDescription().trim(),
      });

      const linkedObject: LinkedObject = {
        type: 'group-settlement',
        id: gid,
        recordId: settlement.id,
      };

      const account = this.selectedAccount();
      if (account) {
        // Case 1: Current user (debtor) is settling — record expense against their account
        const txPayload: TransactionCreateInput = {
          accountId: account.uid ?? '',
          amount,
          description: this.settlementDescription().trim() || `Settlement - ${credName}`,
          category: this.settlementCategory() || 'Other',
          icon: this.settlementIcon(),
          type: 'expense',
          source: this.settlementSource(),
          paidBy: this.currentUserId(),
          date: date().format('YYYY-MM-DD'),
          linkedObject,
        };

        const txResponse = await this.transactionsService.createTransaction(txPayload, {
          syncRemoteInBackground: true,
        });

        void this.reportsService.updateReportForTransaction(txResponse).catch((e) => console.error(e));
        void this.accountsService
          .adjustBalanceForTransaction(account.id || account.uid, amount, 'expense')
          .catch((e) => console.error(e));
      }

      // Cloud function: create income for creditor + notify them
      void this.recordSettlementForCreditor({
        groupId: gid,
        settlementId: settlement.id,
        creditorId: credId,
        debtorId: this.currentUserId(),
        debtorName: this.currentUserName(),
        amount,
        description: this.settlementDescription().trim() || `Settlement from ${this.currentUserName()}`,
        category: this.settlementCategory() || 'Other',
        source: this.settlementSource(),
        currency: grp.currency,
      });

      this.notifier.success('Settlement recorded.');
      await this.router.navigateByUrl(`/user/groups/${gid}`, { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not record settlement.');
    } finally {
      this.saving.set(false);
    }
  }

  private notifyGroupMembers(groupId: string, expense: GroupExpense): void {
    try {
      const fn = httpsCallable(this.functions, 'notifyGroupExpense');
      void fn({
        groupId,
        expenseId: expense.id,
        description: expense.description,
        amount: expense.amount,
        paidByName: this.currentUserName(),
        memberIds: this.members()
          .map((m) => m.memberId)
          .filter((id) => id !== this.currentUserId()),
      }).catch((e) => console.error('notifyGroupExpense', e));
    } catch (e) {
      console.error(e);
    }
  }

  private recordSettlementForCreditor(payload: {
    groupId: string;
    settlementId: string;
    creditorId: string;
    debtorId: string;
    debtorName: string;
    amount: number;
    description: string;
    category: string;
    source: string;
    currency: string;
  }): void {
    try {
      const fn = httpsCallable(this.functions, 'recordGroupSettlement');
      void fn(payload).catch((e) => console.error('recordGroupSettlement', e));
    } catch (e) {
      console.error(e);
    }
  }

  onBack() {
    this.location.back();
  }
}

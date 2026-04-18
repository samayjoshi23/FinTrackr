import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import {
  DatePicker,
  dateToIsoLocal,
  parseIsoLocal,
} from '../../../../shared/components/date-picker/date-picker';
import { AccountsService } from '../../../../services/accounts.service';
import { TransactionsService } from '../../../../services/transactions.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { RecurringTransactionRecord } from '../../../../shared/models/transaction.model';
import { frequencyLabel } from '../../types';
import { recurringFrequencyOptions } from '../../../transactions/types';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';

@Component({
  selector: 'app-edit-recurring',
  imports: [CommonModule, FormsModule, Icon, DatePicker],
  templateUrl: './edit-recurring.html',
  styleUrl: './edit-recurring.css',
})
export class EditRecurring {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly notifier = inject(NotifierService);

  readonly frequencyLabel = frequencyLabel;
  readonly frequencyOptions = recurringFrequencyOptions;
  readonly limits = FORM_LIMITS;

  recurringId = '';
  recurring = signal<RecurringTransactionRecord | null>(null);
  currencyCode = signal<string>('INR');

  // Form fields
  amount: number | string = '';
  recurringFrequency = '';
  isAutoPay = false;
  lastPaymentIso = '';
  nextPaymentIso = '';

  loading = signal(true);
  saving = signal(false);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.recurringId = id;
    if (!id) {
      this.loading.set(false);
      this.notifier.error('Missing schedule.');
      void this.router.navigateByUrl('/user/recurring', { replaceUrl: true });
      return;
    }

    try {
      const acc = await this.accountsService.getSelectedAccount();
      this.currencyCode.set(acc?.currency ?? 'INR');

      const rec = await this.transactionsService.getRecurringTransaction(id);
      if (!rec) {
        this.notifier.error('Schedule not found.');
        void this.router.navigateByUrl('/user/recurring', { replaceUrl: true });
        return;
      }
      this.recurring.set(rec);

      // Pre-fill form fields from existing record
      this.amount = rec.amount;
      this.recurringFrequency = rec.recurringFrequency ?? '';
      this.isAutoPay = rec.isAutoPay ?? false;
      this.lastPaymentIso = rec.lastPaymentDate ? dateToIsoLocal(rec.lastPaymentDate) : '';
      this.nextPaymentIso = rec.nextPaymentDate ? dateToIsoLocal(rec.nextPaymentDate) : '';
    } catch (err) {
      console.error(err);
      this.notifier.error('Could not load schedule.');
      void this.router.navigateByUrl('/user/recurring', { replaceUrl: true });
    } finally {
      this.loading.set(false);
    }
  }

  onBack() {
    void this.router.navigateByUrl(`/user/recurring/view/${this.recurringId}`);
  }

  async onSave(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      this.notifier.error('Please fix the highlighted fields.');
      return;
    }

    const rawAmount = Number(this.amount);
    if (
      !Number.isFinite(rawAmount) ||
      rawAmount < this.limits.amountMin ||
      rawAmount > this.limits.amountMax
    ) {
      this.notifier.error(
        `Amount must be between ${this.limits.amountMin} and ${this.limits.amountMax}.`,
      );
      return;
    }

    const last = parseIsoLocal(this.lastPaymentIso.trim());
    const next = parseIsoLocal(this.nextPaymentIso.trim());
    if (!last || !next) {
      this.notifier.error('Select both last and next payment dates.');
      return;
    }
    if (next.getTime() < last.getTime()) {
      this.notifier.error('Next payment must be on or after the last payment date.');
      return;
    }

    this.saving.set(true);
    try {
      await this.transactionsService.updateRecurringTransaction(this.recurringId, {
        amount: rawAmount,
        recurringFrequency: this.recurringFrequency || null,
        isAutoPay: this.isAutoPay,
        lastPaymentDate: last,
        nextPaymentDate: next,
      });
      this.notifier.success('Schedule updated.');
      void this.router.navigateByUrl(`/user/recurring/view/${this.recurringId}`, {
        replaceUrl: true,
      });
    } catch (err) {
      console.error(err);
      this.notifier.error('Could not update schedule.');
    } finally {
      this.saving.set(false);
    }
  }
}

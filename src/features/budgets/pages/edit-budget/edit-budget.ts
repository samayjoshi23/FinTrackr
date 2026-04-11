import { CommonModule, Location } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { BudgetsService } from '../../../../services/budgets.service';
import { ReportsService } from '../../../../services/reports.service';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { Budget } from '../../../../shared/models/budget.model';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';

@Component({
  selector: 'app-edit-budget',
  imports: [CommonModule, FormsModule, Icon],
  templateUrl: './edit-budget.html',
})
export class EditBudget {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);
  private readonly accountsService = inject(AccountsService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly reportsService = inject(ReportsService);
  private readonly notifier = inject(NotifierService);

  budget = signal<Budget | null>(null);
  currency = signal<string>('INR');
  loading = signal(true);
  saving = signal(false);

  monthlyLimit: number | string = '';
  readonly limits = FORM_LIMITS;

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (!id) {
      this.notifier.error('Missing budget ID.');
      this.router.navigateByUrl('/user/budgets', { replaceUrl: true });
      return;
    }

    const account = await this.accountsService.getSelectedAccount();
    this.currency.set(account?.currency ?? 'INR');

    try {
      const b = await this.budgetsService.getBudget(id);
      if (!b) {
        this.notifier.error('Budget not found.');
        this.router.navigateByUrl('/user/budgets', { replaceUrl: true });
        return;
      }
      this.budget.set(b);
      this.monthlyLimit = b.limit;
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not load budget.');
      this.router.navigateByUrl('/user/budgets', { replaceUrl: true });
    } finally {
      this.loading.set(false);
    }
  }

  onBack() {
    this.location.back();
  }

  async onSave(form: NgForm): Promise<void> {
    if (form.invalid) {
      form.control.markAllAsTouched();
      this.notifier.error('Please fix the highlighted fields.');
      return;
    }

    const b = this.budget();
    if (!b) return;

    const limit = Number(this.monthlyLimit);
    if (
      !Number.isFinite(limit) ||
      limit < FORM_LIMITS.amountMin ||
      limit > FORM_LIMITS.budgetLimitMax
    ) {
      this.notifier.error(
        `Monthly limit must be between ${FORM_LIMITS.amountMin} and ${FORM_LIMITS.budgetLimitMax}.`,
      );
      return;
    }

    this.saving.set(true);
    try {
      await this.budgetsService.updateBudget(b.id, { limit });
      await this.reportsService.rebuildCurrentMonthReport();
      this.notifier.success('Budget updated.');
      this.router.navigateByUrl('/user/budgets', { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not update budget.');
    } finally {
      this.saving.set(false);
    }
  }
}

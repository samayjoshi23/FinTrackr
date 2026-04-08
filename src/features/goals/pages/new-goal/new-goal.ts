import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { GoalsService } from '../../../../services/goals.service';
import { Goal, GoalCreateInput } from '../../../../shared/models/goal.model';
import { Account } from '../../../../shared/models/account.model';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';
import { DatePicker } from '../../../../shared/components/date-picker/date-picker';

@Component({
  selector: 'app-new-goal',
  imports: [CommonModule, FormsModule, Icon, DatePicker],
  templateUrl: './new-goal.html',
  styleUrl: './new-goal.css',
})
export class NewGoal {
  private readonly router = inject(Router);
  private readonly goalsService = inject(GoalsService);
  private readonly notifier = inject(NotifierService);

  selectedAccount = signal<Account | null>(null);
  currency = signal<string>('INR');
  existingGoals = signal<Goal[]>([]);

  goalName = '';
  targetAmount: number | string = '';
  dueDate = '';
  currentAmount: number | string = 0;
  readonly limits = FORM_LIMITS;

  async ngOnInit() {
    const account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    this.selectedAccount.set(account);
    this.currency.set(account?.currency ?? 'INR');

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    this.dueDate = `${yyyy}-${mm}-${dd}`;

    try {
      const goals = await this.goalsService.getGoals();
      this.existingGoals.set(goals ?? []);
    } catch {
      this.existingGoals.set([]);
    }
  }

  /** Max for "already saved" when target is known and valid. */
  currentSavedMax(): number {
    const t = Number(this.targetAmount);
    if (Number.isFinite(t) && t >= FORM_LIMITS.amountMin) return t;
    return FORM_LIMITS.amountMax;
  }

  isGoalNameDuplicate(name: string): boolean {
    const key = name.trim().toLowerCase();
    if (!key) return false;
    return this.existingGoals().some((g) => g.name.trim().toLowerCase() === key);
  }

  onBack() {
    this.router.navigateByUrl('/user/goals');
  }

  async onCreate(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      this.notifier.error('Please fix the highlighted fields.');
      return;
    }

    const account = this.selectedAccount();
    if (!account) {
      this.notifier.error('No account selected.');
      return;
    }

    const name = this.goalName?.trim() ?? '';
    if (!name) {
      this.notifier.error('Enter a goal name.');
      return;
    }
    if (this.isGoalNameDuplicate(name)) {
      this.notifier.error('A goal with this name already exists.');
      return;
    }

    const target = Number(this.targetAmount);
    if (
      !Number.isFinite(target) ||
      target < FORM_LIMITS.amountMin ||
      target > FORM_LIMITS.amountMax
    ) {
      this.notifier.error('Target amount is not valid.');
      return;
    }

    const current = Number(this.currentAmount);
    if (!Number.isFinite(current) || current < 0 || current > target) {
      this.notifier.error(`"Already saved" must be between 0 and your target (${target}).`);
      return;
    }

    if (!this.dueDate?.trim()) {
      this.notifier.error('Select a due date.');
      return;
    }

    const payload: GoalCreateInput = {
      accountId: account.id ?? account.uid ?? '',
      name,
      target,
      dueDate: this.dueDate.trim(),
      currentAmount: current,
    };

    try {
      await this.goalsService.createGoal(payload);
      this.router.navigateByUrl('/user/goals');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not create goal.');
    }
  }
}

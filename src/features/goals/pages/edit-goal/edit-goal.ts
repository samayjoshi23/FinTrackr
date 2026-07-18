import { CommonModule, Location } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { GoalsService } from '../../../../services/goals.service';
import { Goal } from '../../../../shared/models/goal.model';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';
import { FORM_LIMITS } from '../../../../shared/constants/form-limits';
import { DatePicker } from '../../../../shared/components/date-picker/date-picker';

@Component({
  selector: 'app-edit-goal',
  imports: [CommonModule, FormsModule, Icon, DatePicker],
  templateUrl: './edit-goal.html',
  styleUrl: './edit-goal.css',
})
export class EditGoal {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);
  private readonly accountsService = inject(AccountsService);
  private readonly goalsService = inject(GoalsService);
  private readonly notifier = inject(NotifierService);

  existingGoals = signal<Goal[]>([]);
  currency = signal<string>('INR');
  loading = signal(true);
  saving = signal(false);
  readonly limits = FORM_LIMITS;

  goalId = '';
  goalName = '';
  targetAmount: number | string = '';
  dueDate = '';
  currentAmount: number | string = 0;

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.goalId = id;
    if (!id) {
      this.loading.set(false);
      this.notifier.error('Missing goal.');
      this.router.navigateByUrl('/user/goals', { replaceUrl: true });
      return;
    }

    const account = await this.accountsService.getSelectedAccount();
    this.currency.set(account?.currency ?? 'INR');

    try {
      const [goal, all] = await Promise.all([
        this.goalsService.getGoal(id),
        this.goalsService.getGoals().catch(() => []),
      ]);
      this.existingGoals.set(all ?? []);
      if (!goal) {
        this.notifier.error('Goal not found.');
        this.router.navigateByUrl('/user/goals', { replaceUrl: true });
        return;
      }
      this.goalName = goal.name ?? '';
      this.targetAmount = goal.target ?? '';
      this.dueDate = goal.dueDate ?? '';
      this.currentAmount = goal.currentAmount ?? 0;
    } catch (err) {
      console.error(err);
      this.notifier.error('Could not load goal.');
      this.router.navigateByUrl('/user/goals', { replaceUrl: true });
    } finally {
      this.loading.set(false);
    }
  }

  currentSavedMax(): number {
    const t = Number(this.targetAmount);
    if (Number.isFinite(t) && t >= FORM_LIMITS.amountMin) return t;
    return FORM_LIMITS.amountMax;
  }

  isGoalNameDuplicate(name: string): boolean {
    const key = name.trim().toLowerCase();
    if (!key) return false;
    return this.existingGoals().some(
      (g) => g.id !== this.goalId && g.name.trim().toLowerCase() === key,
    );
  }

  onBack() {
    this.location.back();
  }

  async onSave(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      this.notifier.error('Please fix the highlighted fields.');
      return;
    }

    const name = this.goalName?.trim() ?? '';
    if (!name) {
      this.notifier.error('Enter a goal name.');
      return;
    }
    if (this.isGoalNameDuplicate(name)) {
      this.notifier.error('Another goal already uses this name.');
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

    this.saving.set(true);
    try {
      await this.goalsService.updateGoal(this.goalId, {
        name,
        target,
        dueDate: this.dueDate.trim(),
        currentAmount: current,
      });
      this.router.navigateByUrl('/user/goals', { replaceUrl: true });
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not update goal.');
    } finally {
      this.saving.set(false);
    }
  }
}

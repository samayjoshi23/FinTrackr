import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { ConfirmPrompt } from '../../../../shared/components/confirm-prompt/confirm-prompt';
import { AccountsService } from '../../../../services/accounts.service';
import { GoalsService } from '../../../../services/goals.service';
import { Goal } from '../../../../shared/models/goal.model';
import { GoalCardModel } from '../../types';
import { SignedAmountPipe } from '../../../../shared/pipes/signed-amount.pipe';
import { NotifierService } from '../../../../shared/components/notifier/notifier.service';

@Component({
  selector: 'app-goals',
  imports: [CommonModule, Icon, SignedAmountPipe, ConfirmPrompt],
  templateUrl: './goals.html',
  styleUrl: './goals.css',
})
export class Goals {
  private readonly router = inject(Router);
  private readonly accountsService = inject(AccountsService);
  private readonly goalsService = inject(GoalsService);
  private readonly notifier = inject(NotifierService);

  currency = signal<string>('INR');
  goals = signal<Goal[]>([]);

  deletePromptOpen = signal(false);
  deletingGoal = signal<GoalCardModel | null>(null);
  deleting = signal(false);

  async ngOnInit() {
    const account = await this.accountsService.getSelectedAccount();
    if (!account) return;
    this.currency.set(account.currency ?? 'INR');

    const rows = await this.goalsService.getGoals().catch(() => []);
    this.goals.set(rows ?? []);
  }

  onNewGoal() {
    this.router.navigateByUrl('/user/goals/new');
  }

  onEdit(g: GoalCardModel) {
    this.router.navigateByUrl(`/user/goals/edit/${g.id}`);
  }

  onDeleteRequest(event: Event, g: GoalCardModel): void {
    event.stopPropagation();
    this.deletingGoal.set(g);
    this.deletePromptOpen.set(true);
  }

  async onDeleteConfirmed(agreed: boolean): Promise<void> {
    if (!agreed) {
      this.deletingGoal.set(null);
      return;
    }
    const goal = this.deletingGoal();
    if (!goal) return;

    this.deleting.set(true);
    try {
      await this.goalsService.deleteGoal(goal.id);
      this.goals.update((list) => list.filter((g) => g.id !== goal.id));
      this.notifier.success('Goal deleted.');
    } catch (e) {
      console.error(e);
      this.notifier.error('Could not delete goal.');
    } finally {
      this.deleting.set(false);
      this.deletingGoal.set(null);
    }
  }

  readonly goalCards = computed<GoalCardModel[]>(() => {
    return this.goals().map((g) => {
      const target = Number(g.target ?? 0);
      const currentAmount = Number(g.currentAmount ?? 0);
      const percent = target > 0 ? Math.round((currentAmount / target) * 100) : 0;
      return {
        id: g.id,
        icon: this.iconForGoalName(g.name),
        name: g.name,
        percent,
        progressWidth: Math.min(percent, 100),
        currentAmount,
        target,
      };
    });
  });

  private iconForGoalName(name: string | undefined): string {
    const n = (name ?? '').toLowerCase();
    if (n.includes('emergency') || n.includes('fund')) return 'target';
    if (n.includes('laptop') || n.includes('computer') || n.includes('work'))
      return 'office-building';
    if (
      n.includes('vacation') ||
      n.includes('travel') ||
      n.includes('trip') ||
      n.includes('holiday')
    )
      return 'entertainment';
    return 'bullseye';
  }

  goBack(): void {
    this.router.navigateByUrl('/user/dashboard');
  }
}

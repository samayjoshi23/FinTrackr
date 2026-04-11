import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { AccountsService } from '../../../../services/accounts.service';
import { GoalsService } from '../../../../services/goals.service';
import { Goal } from '../../../../shared/models/goal.model';
import { Account } from '../../../../shared/models/account.model';
import { GoalCardModel } from '../../types';
@Component({
  selector: 'app-goals',
  imports: [CommonModule, Icon],
  templateUrl: './goals.html',
  styleUrl: './goals.css',
})
export class Goals {
  private readonly router = inject(Router);
  private readonly accountsService = inject(AccountsService);
  private readonly goalsService = inject(GoalsService);

  currency = signal<string>('INR');
  goals = signal<Goal[]>([]);

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

  readonly goalCards = computed<GoalCardModel[]>(() => {
    return this.goals().map((g) => {
      const target = Number(g.target ?? 0);
      const currentAmount = Number(g.currentAmount ?? 0);
      const percent = target > 0 ? Math.round((currentAmount / target) * 100) : 0;
      return {
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
}

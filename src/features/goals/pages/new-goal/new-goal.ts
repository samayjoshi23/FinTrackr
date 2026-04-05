import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Icon } from '../../../../shared/components/icon/icon';
import { GoalsService } from '../../../../services/goals.service';
import { GoalCreateInput } from '../../../../shared/models/goal.model';
import { Account } from '../../../../shared/models/account.model';

@Component({
  selector: 'app-new-goal',
  imports: [CommonModule, FormsModule, Icon],
  templateUrl: './new-goal.html',
  styleUrl: './new-goal.css',
})
export class NewGoal {
  private readonly router = inject(Router);
  private readonly goalsService = inject(GoalsService);

  selectedAccount = signal<Account | null>(null);
  currency = signal<string>('INR');

  goalName = '';
  targetAmount: number | string = '';
  dueDate = '';
  currentAmount: number | string = 0;

  async ngOnInit() {
    const account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as
      | Account
      | null;
    this.selectedAccount.set(account);
    this.currency.set(account?.currency ?? 'INR');

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    this.dueDate = `${yyyy}-${mm}-${dd}`;
  }

  onBack() {
    this.router.navigateByUrl('/user/goals');
  }

  async onCreate() {
    const account = this.selectedAccount();
    if (!account) return;

    const payload: GoalCreateInput = {
      accountId: account.id ?? account.uid ?? '',
      name: this.goalName?.trim() || 'Goal',
      target: Number(this.targetAmount),
      dueDate: this.dueDate,
      currentAmount: Number(this.currentAmount),
    };

    await this.goalsService.createGoal(payload);
    this.router.navigateByUrl('/user/goals');
  }
}


import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AccountsService } from '../../../../services/accounts.service';
import { ReportsService } from '../../../../services/reports.service';
import { Icon } from '../../../../shared/components/icon/icon';
import {
  ReportTimePeriod,
  ReportChartMode,
  BudgetTrackingCard,
  ReportSummary,
  CategoryPieDataPoint,
  SavingsTrendDataPoint,
} from '../../../../shared/models/report.model';
import { ReportViewData } from '../../../../services/reports.service';
import { Account } from '../../../../shared/models/account.model';
import { ReportsSummaryCards } from '../../components/reports-summary-cards/reports-summary-cards';
import { ReportsIncomeExpenseBarChart } from '../../components/reports-income-expense-bar-chart/reports-income-expense-bar-chart';
import { ReportsCategoryPieChart } from '../../components/reports-category-pie-chart/reports-category-pie-chart';
import { ReportsSavingsTrendLineChart } from '../../components/reports-savings-trend-line-chart/reports-savings-trend-line-chart';
import { ReportsTopCategories } from '../../components/reports-top-categories/reports-top-categories';
import { ReportsBudgetTracking } from '../../components/reports-budget-tracking/reports-budget-tracking';
import { ReportsSavingsRateCard } from '../../components/reports-savings-rate-card/reports-savings-rate-card';

@Component({
  selector: 'app-reports',
  imports: [
    CommonModule,
    Icon,
    ReportsSummaryCards,
    ReportsIncomeExpenseBarChart,
    ReportsCategoryPieChart,
    ReportsSavingsTrendLineChart,
    ReportsTopCategories,
    ReportsBudgetTracking,
    ReportsSavingsRateCard,
  ],
  templateUrl: './reports.html',
  styleUrl: './reports.css',
})
export class Reports implements OnInit {
  private readonly accountsService = inject(AccountsService);
  private readonly reportsService = inject(ReportsService);
  private readonly router = inject(Router);

  currency = signal<string>('INR');
  loading = signal<boolean>(true);

  selectedPeriod = signal<ReportTimePeriod>('1M');
  selectedChartMode = signal<ReportChartMode>('income-expense');

  summary = signal<ReportSummary>({ totalIncome: 0, totalExpense: 0, savings: 0, savingsRate: 0 });
  barLabels = signal<string[]>([]);
  barIncome = signal<number[]>([]);
  barExpense = signal<number[]>([]);
  pieData = signal<CategoryPieDataPoint[]>([]);
  savingsTrend = signal<SavingsTrendDataPoint[]>([]);
  budgetCards = signal<BudgetTrackingCard[]>([]);
  topCategories = signal<{ category: string; amount: number; color: string; icon: string }[]>([]);

  /** Progress bars grow 0 → target after chart data loads. */
  progressBarsShown = signal(false);

  readonly periods: { label: string; value: ReportTimePeriod }[] = [
    { label: 'Day', value: 'day' },
    { label: 'Week', value: 'week' },
    { label: '1M', value: '1M' },
    { label: '3M', value: '3M' },
    { label: '6M', value: '6M' },
    { label: '1Y', value: '1Y' },
  ];

  async ngOnInit() {
    const account = await this.accountsService.getSelectedAccount();
    this.currency.set(account?.currency ?? 'INR');
    await this.loadData();
  }

  goBack() {
    this.router.navigateByUrl('/user/dashboard');
  }

  async onPeriodChange(period: ReportTimePeriod) {
    this.selectedPeriod.set(period);
    await this.loadData();
  }

  onChartModeChange(mode: ReportChartMode) {
    this.selectedChartMode.set(mode);
  }

  private async loadData() {
    this.loading.set(true);
    this.progressBarsShown.set(false);
    try {
      const data: ReportViewData = await this.reportsService.getReportViewData(
        this.selectedPeriod(),
      );

      this.summary.set(data.summary);
      this.barLabels.set(data.xAxisLabels);
      this.barIncome.set(data.barData.map((d) => Math.round((d as { income: number }).income)));
      this.barExpense.set(data.barData.map((d) => Math.round((d as { expense: number }).expense)));
      this.pieData.set(data.pieData);
      this.savingsTrend.set(data.savingsTrend);
      this.budgetCards.set(data.budgetCards);
      this.topCategories.set(data.topCategories);
    } catch (e) {
      console.error('Failed to load report data', e);
    } finally {
      this.loading.set(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => this.progressBarsShown.set(true));
      });
    }
  }
}

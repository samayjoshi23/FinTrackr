import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  computed,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import ApexCharts from 'apexcharts';
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

@Component({
  selector: 'app-reports',
  imports: [CommonModule, Icon],
  templateUrl: './reports.html',
  styleUrl: './reports.css',
})
export class Reports implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('barChartEl') barChartEl!: ElementRef<HTMLDivElement>;
  @ViewChild('pieChartEl') pieChartEl!: ElementRef<HTMLDivElement>;
  @ViewChild('lineChartEl') lineChartEl!: ElementRef<HTMLDivElement>;

  private readonly reportsService = inject(ReportsService);
  private readonly router = inject(Router);

  currency = signal<string>('INR');
  loading = signal<boolean>(true);

  selectedPeriod = signal<ReportTimePeriod>('3M');
  selectedChartMode = signal<ReportChartMode>('income-expense');

  summary = signal<ReportSummary>({ totalIncome: 0, totalExpense: 0, savings: 0, savingsRate: 0 });
  barLabels = signal<string[]>([]);
  barIncome = signal<number[]>([]);
  barExpense = signal<number[]>([]);
  pieData = signal<CategoryPieDataPoint[]>([]);
  savingsTrend = signal<SavingsTrendDataPoint[]>([]);
  budgetCards = signal<BudgetTrackingCard[]>([]);
  topCategories = signal<{ category: string; amount: number; color: string; icon: string }[]>([]);

  overspentCards = computed(() => this.budgetCards().filter((c) => c.overspent));

  readonly periods: { label: string; value: ReportTimePeriod }[] = [
    { label: 'Day', value: 'day' },
    { label: 'Week', value: 'week' },
    { label: '1M', value: '1M' },
    { label: '3M', value: '3M' },
    { label: '6M', value: '6M' },
    { label: '1Y', value: '1Y' },
    { label: 'All', value: 'all' },
  ];

  private barChart: ApexCharts | null = null;
  private pieChart: ApexCharts | null = null;
  private lineChart: ApexCharts | null = null;
  private viewReady = false;
  private dataReady = false;

  async ngOnInit() {
    const account = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as Account | null;
    this.currency.set(account?.currency ?? 'INR');
    await this.loadData();
  }

  ngAfterViewInit() {
    this.viewReady = true;
    if (this.dataReady) this.renderCharts();
  }

  ngOnDestroy() {
    this.barChart?.destroy();
    this.pieChart?.destroy();
    this.lineChart?.destroy();
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
    this.renderMainChart();
  }

  // ─── Data loading ─────────────────────────────────────────────────────────

  private async loadData() {
    this.loading.set(true);
    try {
      const data: ReportViewData = await this.reportsService.getReportViewData(
        this.selectedPeriod(),
      );

      // 4. Push to signals
      this.summary.set(data.summary);
      this.barLabels.set(data.xAxisLabels);
      this.barIncome.set(data.barData.map((d) => Math.round((d as { income: number }).income)));
      this.barExpense.set(data.barData.map((d) => Math.round((d as { expense: number }).expense)));
      this.pieData.set(data.pieData);
      this.savingsTrend.set(data.savingsTrend);
      this.budgetCards.set(data.budgetCards);
      this.topCategories.set(data.topCategories);

      this.dataReady = true;
      if (this.viewReady) this.renderCharts();
    } catch (e) {
      console.error('Failed to load report data', e);
    } finally {
      this.loading.set(false);
    }
  }

  // ─── Chart rendering ──────────────────────────────────────────────────────

  private renderCharts() {
    this.renderMainChart();
    this.renderLineChart();
  }

  renderMainChart() {
    if (this.selectedChartMode() === 'income-expense') {
      this.pieChart?.destroy();
      this.pieChart = null;
      this.renderBarChart();
    } else {
      this.barChart?.destroy();
      this.barChart = null;
      this.renderPieChart();
    }
  }

  private isDark(): boolean {
    return document.body.classList.contains('theme-dark');
  }

  private chartColors() {
    return {
      text: this.isDark() ? '#94a3b8' : '#64748b',
      grid: this.isDark() ? '#1e293b' : '#e2e8f0',
    };
  }

  private renderBarChart() {
    this.barChart?.destroy();
    const el = this.barChartEl?.nativeElement;
    if (!el) return;
    const c = this.chartColors();
    const labels = this.barLabels();
    const income = this.barIncome();
    const expense = this.barExpense();

    this.barChart = new ApexCharts(el, {
      chart: {
        type: 'bar',
        height: 220,
        toolbar: { show: false },
        background: 'transparent',
        fontFamily: 'DM Sans, sans-serif',
      },
      series: [
        { name: 'Income', data: income },
        { name: 'Expense', data: expense },
      ],
      xaxis: {
        categories: labels,
        labels: { style: { colors: c.text, fontSize: '11px' } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: c.text, fontSize: '11px' },
          formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)),
        },
      },
      colors: ['#10b981', '#f87171'],
      plotOptions: { bar: { columnWidth: '55%', borderRadius: 4 } },
      dataLabels: { enabled: false },
      grid: { borderColor: c.grid, strokeDashArray: 4 },
      legend: { show: false },
      tooltip: { theme: this.isDark() ? 'dark' : 'light' },
    });
    this.barChart.render();
  }

  private renderPieChart() {
    this.pieChart?.destroy();
    const el = this.pieChartEl?.nativeElement;
    if (!el) return;
    const data = this.pieData().slice(0, 7);
    if (data.length === 0) return;
    const c = this.chartColors();

    this.pieChart = new ApexCharts(el, {
      chart: {
        type: 'donut',
        height: 260,
        toolbar: { show: false },
        background: 'transparent',
        fontFamily: 'DM Sans, sans-serif',
      },
      series: data.map((d) => Math.round(d.amount)),
      labels: data.map((d) => d.category),
      colors: data.map((d) => d.color),
      plotOptions: { pie: { donut: { size: '60%' } } },
      dataLabels: { enabled: false },
      legend: {
        show: true,
        position: 'bottom',
        labels: { colors: c.text },
        fontSize: '11px',
        itemMargin: { horizontal: 6, vertical: 2 },
      },
      tooltip: { theme: this.isDark() ? 'dark' : 'light' },
    });
    this.pieChart.render();
  }

  private renderLineChart() {
    this.lineChart?.destroy();
    const el = this.lineChartEl?.nativeElement;
    if (!el) return;
    const data = this.savingsTrend();
    const c = this.chartColors();

    this.lineChart = new ApexCharts(el, {
      chart: {
        type: 'line',
        height: 180,
        toolbar: { show: false },
        background: 'transparent',
        fontFamily: 'DM Sans, sans-serif',
      },
      series: [
        { name: 'Savings', data: data.map((d) => Math.round(d.savings)) },
        { name: 'Expense', data: data.map((d) => Math.round(d.expense)) },
      ],
      xaxis: {
        categories: data.map((d) => d.label),
        labels: { style: { colors: c.text, fontSize: '11px' } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: c.text, fontSize: '11px' },
          formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)),
        },
      },
      colors: ['#10b981', '#f87171'],
      stroke: { curve: 'smooth', width: 2.5 },
      markers: { size: 3 },
      dataLabels: { enabled: false },
      grid: { borderColor: c.grid, strokeDashArray: 4 },
      legend: { show: false },
      tooltip: { theme: this.isDark() ? 'dark' : 'light' },
    });
    this.lineChart.render();
  }
}

import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type ApexCharts from 'apexcharts';
import { loadApexCharts } from '../../utils/apexcharts-loader';
import { reportChartColors, reportChartIsDark } from '../../utils/reports-chart-theme';

@Component({
  selector: 'app-reports-income-expense-bar-chart',
  standalone: true,
  imports: [CommonModule],
  template: '<div #chartHost></div>',
})
export class ReportsIncomeExpenseBarChart implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('chartHost') chartHost!: ElementRef<HTMLDivElement>;

  @Input({ required: true }) labels: string[] = [];
  @Input({ required: true }) income: number[] = [];
  @Input({ required: true }) expense: number[] = [];

  private chart: ApexCharts | null = null;
  /** Invalidates in-flight async renders when inputs change or on destroy. */
  private syncToken = 0;

  ngAfterViewInit(): void {
    this.syncChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartHost?.nativeElement) return;
    if (changes['labels'] || changes['income'] || changes['expense']) {
      this.syncChart();
    }
  }

  ngOnDestroy(): void {
    this.syncToken++;
    this.chart?.destroy();
    this.chart = null;
  }

  private async syncChart(): Promise<void> {
    const token = ++this.syncToken;
    this.chart?.destroy();
    this.chart = null;
    const el = this.chartHost?.nativeElement;
    if (!el || this.labels.length === 0) return;

    // ApexCharts is imported lazily on first render (kept out of the chunk parse cost).
    const Charts = await loadApexCharts();
    if (token !== this.syncToken) return; // superseded by a newer sync or destroy

    const c = reportChartColors();
    this.chart = new Charts(el, {
      chart: {
        type: 'bar',
        height: 220,
        toolbar: { show: false },
        background: 'transparent',
        fontFamily: 'DM Sans, sans-serif',
      },
      series: [
        { name: 'Income', data: this.income.map((v) => Math.round(v)) },
        { name: 'Expense', data: this.expense.map((v) => Math.round(v)) },
      ],
      xaxis: {
        categories: this.labels,
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
      tooltip: { theme: reportChartIsDark() ? 'dark' : 'light' },
    });
    this.chart.render();
  }
}

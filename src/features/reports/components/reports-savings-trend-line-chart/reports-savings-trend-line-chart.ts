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
import ApexCharts from 'apexcharts';
import { SavingsTrendDataPoint } from '../../../../shared/models/report.model';
import { reportChartColors, reportChartIsDark } from '../../utils/reports-chart-theme';

@Component({
  selector: 'app-reports-savings-trend-line-chart',
  standalone: true,
  imports: [CommonModule],
  template: '<div #chartHost></div>',
})
export class ReportsSavingsTrendLineChart implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('chartHost') chartHost!: ElementRef<HTMLDivElement>;

  @Input({ required: true }) trend: SavingsTrendDataPoint[] = [];

  private chart: ApexCharts | null = null;

  ngAfterViewInit(): void {
    this.syncChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartHost?.nativeElement) return;
    if (changes['trend']) {
      this.syncChart();
    }
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  private syncChart(): void {
    this.chart?.destroy();
    this.chart = null;
    const el = this.chartHost?.nativeElement;
    const data = this.trend;
    if (!el || data.length === 0) return;

    const c = reportChartColors();
    this.chart = new ApexCharts(el, {
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
      tooltip: { theme: reportChartIsDark() ? 'dark' : 'light' },
    });
    this.chart.render();
  }
}

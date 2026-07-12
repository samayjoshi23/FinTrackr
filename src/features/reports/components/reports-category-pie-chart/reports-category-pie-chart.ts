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
import { CategoryPieDataPoint } from '../../../../shared/models/report.model';
import { loadApexCharts } from '../../utils/apexcharts-loader';
import { reportChartColors, reportChartIsDark } from '../../utils/reports-chart-theme';

@Component({
  selector: 'app-reports-category-pie-chart',
  standalone: true,
  imports: [CommonModule],
  template: '<div #chartHost></div>',
})
export class ReportsCategoryPieChart implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('chartHost') chartHost!: ElementRef<HTMLDivElement>;

  @Input({ required: true }) segments: CategoryPieDataPoint[] = [];

  private chart: ApexCharts | null = null;
  /** Invalidates in-flight async renders when inputs change or on destroy. */
  private syncToken = 0;

  ngAfterViewInit(): void {
    this.syncChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartHost?.nativeElement) return;
    if (changes['segments']) {
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
    const data = this.segments.slice(0, 7);
    if (!el || data.length === 0) return;

    // ApexCharts is imported lazily on first render (kept out of the chunk parse cost).
    const Charts = await loadApexCharts();
    if (token !== this.syncToken) return; // superseded by a newer sync or destroy

    const c = reportChartColors();
    this.chart = new Charts(el, {
      chart: {
        type: 'donut',
        height: 260,
        toolbar: { show: false },
        background: 'transparent',
        fontFamily: 'DM Sans, sans-serif',
        zoom: { enabled: false },
        foreColor: c.text,
      },
      series: data.map((d) => Math.round(d.amount)),
      labels: data.map((d) => d.category),
      colors: data.map((d) => d.color),
      plotOptions: { pie: { donut: { size: '70%' } } },
      dataLabels: { enabled: true },
      stroke: { show: false, curve: 'smooth', width: 2.5 },
      markers: { size: 3 },
      legend: {
        show: true,
        position: 'bottom',
        labels: { colors: c.text },
        fontSize: '10px',
        itemMargin: { horizontal: 3, vertical: 2 },
      },
      tooltip: { theme: reportChartIsDark() ? 'dark' : 'light' },
    });
    this.chart.render();
  }
}

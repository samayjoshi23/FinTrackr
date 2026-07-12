import type ApexCharts from 'apexcharts';

let modulePromise: Promise<typeof ApexCharts> | null = null;

/**
 * Lazily import ApexCharts (~350 kB, CommonJS — not tree-shakable) on first
 * chart render instead of bundling it into the reports chunk's parse cost.
 * The module is a singleton: all three chart components share one import.
 */
export function loadApexCharts(): Promise<typeof ApexCharts> {
  modulePromise ??= import('apexcharts').then((m) => m.default);
  return modulePromise;
}

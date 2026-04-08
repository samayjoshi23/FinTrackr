export function reportChartIsDark(): boolean {
  return document.body.classList.contains('theme-dark');
}

export function reportChartColors(): { text: string; grid: string } {
  const dark = reportChartIsDark();
  return {
    text: dark ? '#94a3b8' : '#64748b',
    grid: dark ? '#1e293b' : '#e2e8f0',
  };
}

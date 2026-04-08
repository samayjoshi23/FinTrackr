/** Hex colors for budget usage: yellow → orange → red (no green). */

export function budgetUsageFillColor(usedPercent: number): string {
  const p = Number.isFinite(usedPercent) ? Math.max(0, usedPercent) : 0;
  if (p > 100) return '#f73636';
  if (p >= 90) return '#f26e27';
  if (p >= 70) return '#ff8833';
  if (p >= 45) return '#fb923c';
  if (p >= 20) return '#f7d136';
  return '#eab308';
}

/** When spend has exceeded limit, always show critical red. */
export function categoryBudgetBarColor(percentUsed: number, isOverBudget: boolean): string {
  if (isOverBudget) return '#f73636';
  return budgetUsageFillColor(percentUsed);
}

/**
 * Budget bar fill: semantic Tailwind classes (see `theme.css` + `@theme` in `styles.css`).
 * Thresholds match previous yellow → orange → red ramp (no green).
 */
export type BudgetUsageBarClass =
  | 'bg-budget-fill-low'
  | 'bg-budget-fill-mid'
  | 'bg-budget-fill-raised'
  | 'bg-budget-fill-high'
  | 'bg-budget-fill-critical'
  | 'bg-budget-fill-over';

export function budgetUsageBarClass(usedPercent: number): BudgetUsageBarClass {
  const p = Number.isFinite(usedPercent) ? Math.max(0, usedPercent) : 0;
  if (p > 100) return 'bg-budget-fill-over';
  if (p >= 90) return 'bg-budget-fill-critical';
  if (p >= 70) return 'bg-budget-fill-high';
  if (p >= 45) return 'bg-budget-fill-raised';
  if (p >= 20) return 'bg-budget-fill-mid';
  return 'bg-budget-fill-low';
}

/** When spend has exceeded limit, always show critical fill. */
export function categoryBudgetBarClass(
  percentUsed: number,
  isOverBudget: boolean,
): BudgetUsageBarClass {
  if (isOverBudget) return 'bg-budget-fill-over';
  return budgetUsageBarClass(percentUsed);
}

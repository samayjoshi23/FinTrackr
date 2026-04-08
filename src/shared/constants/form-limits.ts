/** Shared field bounds for create/edit forms. */
export const FORM_LIMITS = {
  nameMax: 80,
  nameMinLen: 2,
  descriptionMax: 500,
  transactionDescriptionMax: 200,
  amountMin: 0.01,
  amountMax: 1e12,
  budgetLimitMax: 1e12,
} as const;

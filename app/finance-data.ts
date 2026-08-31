export const FINANCE_DATA_IDS = [
  "balance",
  "credit-total",
  "income",
  "expenses",
  "surplus",
  "overdraft-warnings",
  "view-accounts",
  "view-credits",
  "view-rates",
] as const;

export type FinanceDataId = (typeof FINANCE_DATA_IDS)[number];

export const DEFAULT_FINANCE_DATA_IDS: FinanceDataId[] = [
  "balance",
  "credit-total",
  "income",
  "surplus",
  "view-accounts",
  "view-credits",
  "view-rates",
];

export const DEFAULT_FINANCE_GROUP_DATA_IDS: FinanceDataId[] = [
  "balance",
  "credit-total",
  "income",
  "surplus",
  "view-accounts",
];

export function orderedFinanceDataIds(ids: readonly string[], availableIds: readonly FinanceDataId[]) {
  const available = new Set<FinanceDataId>(availableIds);
  return [...new Set(ids)].filter((id): id is FinanceDataId => available.has(id as FinanceDataId));
}

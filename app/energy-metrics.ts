export const ENERGY_METRIC_IDS = [
  "latest-reading",
  "month-consumption",
  "year-consumption",
  "total-consumption",
  "month-cost",
  "year-cost",
  "month-advance",
  "year-advance",
  "forecast",
  "data-quality",
  "month-savings",
  "year-savings",
  "view-overview",
  "view-contracts",
  "view-advance",
  "view-history",
  "view-meter",
] as const;

export type EnergyMetricId = (typeof ENERGY_METRIC_IDS)[number];

export const DEFAULT_ENERGY_METRIC_IDS: EnergyMetricId[] = [
  "latest-reading",
  "month-consumption",
  "year-consumption",
  "data-quality",
  "view-overview",
  "view-contracts",
  "view-advance",
  "view-history",
  "view-meter",
];

export function orderedEnergyMetricIds(ids: string[], availableIds: EnergyMetricId[]) {
  const available = new Set<EnergyMetricId>(availableIds);
  return [...new Set(ids)].filter((id): id is EnergyMetricId => available.has(id as EnergyMetricId));
}

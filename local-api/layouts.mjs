export const defaultFinanceLayout = {
  enabled: true,
  position: "top",
  metrics: [
    { id: "balance", visible: true },
    { id: "credits", visible: true },
    { id: "income", visible: true },
    { id: "surplus", visible: true },
  ],
  sections: [
    { id: "accounts", visible: true },
    { id: "credits", visible: true },
    { id: "rates", visible: true },
  ],
};

function normalizeEntries(entries, defaults) {
  const allowed = new Set(defaults.map(item => item.id));
  const result = [];
  const seen = new Set();
  if (Array.isArray(entries)) for (const item of entries) {
    const id = String(item?.id ?? "");
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, visible: item.visible !== false });
  }
  for (const item of defaults) if (!seen.has(item.id)) result.push({ ...item });
  return result;
}

export function normalizeFinanceLayout(value = {}) {
  return {
    enabled: value?.enabled !== false,
    position: value?.position === "bottom" ? "bottom" : "top",
    metrics: normalizeEntries(value?.metrics, defaultFinanceLayout.metrics),
    sections: normalizeEntries(value?.sections, defaultFinanceLayout.sections),
  };
}

export const defaultPageLayouts = {
  finance: {
    blocks: [
      { id: "integration", visible: true },
      { id: "navigation", visible: true },
      { id: "documents", visible: true },
    ],
  },
  energy: {
    blocks: [
      { id: "integration", visible: true },
      { id: "navigation", visible: true },
      { id: "documents", visible: true },
    ],
  },
};

function normalizePageLayout(value, fallback = defaultPageLayouts.finance) {
  return { blocks: normalizeEntries(value?.blocks, fallback.blocks) };
}

export function normalizePageLayouts(value = {}, legacyFinanceLayout = {}) {
  let finance = value?.finance;
  if (!finance && legacyFinanceLayout && typeof legacyFinanceLayout === "object") {
    const integration = { id: "integration", visible: legacyFinanceLayout.enabled !== false };
    finance = {
      blocks: legacyFinanceLayout.position === "bottom"
        ? [{ id: "navigation", visible: true }, integration, { id: "documents", visible: true }]
        : [integration, { id: "navigation", visible: true }, { id: "documents", visible: true }],
    };
  }
  return {
    finance: normalizePageLayout(finance, defaultPageLayouts.finance),
    energy: normalizePageLayout(value?.energy, defaultPageLayouts.energy),
  };
}

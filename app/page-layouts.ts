export type PageBlockId = "integration" | "navigation" | "documents";
export type PageLayoutEntry = { id: PageBlockId; visible: boolean };
export type PageLayout = { blocks: PageLayoutEntry[] };
export type PageLayouts = { finance: PageLayout; energy: PageLayout };

const DEFAULT_BLOCKS: PageLayoutEntry[] = [
  { id: "integration", visible: true },
  { id: "navigation", visible: true },
  { id: "documents", visible: true },
];

export const DEFAULT_PAGE_LAYOUTS: PageLayouts = {
  finance: { blocks: DEFAULT_BLOCKS.map(item => ({ ...item })) },
  energy: { blocks: DEFAULT_BLOCKS.map(item => ({ ...item })) },
};

function normalizePageLayout(value?: Partial<PageLayout>): PageLayout {
  const allowed = new Set<PageBlockId>(DEFAULT_BLOCKS.map(item => item.id));
  const blocks: PageLayoutEntry[] = [];
  const seen = new Set<PageBlockId>();
  if (Array.isArray(value?.blocks)) for (const item of value.blocks) {
    const id = String(item?.id ?? "") as PageBlockId;
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    blocks.push({ id, visible: item.visible !== false });
  }
  for (const item of DEFAULT_BLOCKS) if (!seen.has(item.id)) blocks.push({ ...item });
  return { blocks };
}

export function normalizePageLayouts(value?: Partial<PageLayouts>): PageLayouts {
  return {
    finance: normalizePageLayout(value?.finance),
    energy: normalizePageLayout(value?.energy),
  };
}

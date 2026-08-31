import assert from "node:assert/strict";
import test from "node:test";
import { normalizePageLayouts } from "../local-api/layouts.mjs";

test("places complete FinanzLab and EnergieLab imports at the top by default", () => {
  const layouts = normalizePageLayouts();
  assert.equal(layouts.finance.blocks[0].id, "integration");
  assert.equal(layouts.energy.blocks[0].id, "integration");
});

test("preserves reordered and hidden complete page blocks", () => {
  const layouts = normalizePageLayouts({
    finance: { blocks: [{ id: "documents", visible: false }, { id: "integration", visible: true }, { id: "navigation", visible: true }] },
    energy: { blocks: [{ id: "navigation", visible: true }, { id: "documents", visible: true }, { id: "integration", visible: false }] },
  });
  assert.deepEqual(layouts.finance.blocks, [
    { id: "documents", visible: false },
    { id: "integration", visible: true },
    { id: "navigation", visible: true },
  ]);
  assert.equal(layouts.energy.blocks.at(-1)?.visible, false);
});

test("drops unknown blocks and appends newly supported defaults", () => {
  const layouts = normalizePageLayouts({ finance: { blocks: [{ id: "unknown", visible: true }, { id: "documents", visible: false }] } });
  assert.equal(layouts.finance.blocks.some(item => item.id === "unknown"), false);
  assert.equal(layouts.finance.blocks.find(item => item.id === "documents")?.visible, false);
  assert.equal(layouts.finance.blocks.length, 3);
});

test("migrates the former FinanzLab position and visibility to a complete block", () => {
  const layouts = normalizePageLayouts(undefined, { enabled: false, position: "bottom" });
  assert.deepEqual(layouts.finance.blocks.map(item => item.id), ["navigation", "integration", "documents"]);
  assert.equal(layouts.finance.blocks.find(item => item.id === "integration")?.visible, false);
});

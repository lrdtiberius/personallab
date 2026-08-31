import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/personallab.tsx", import.meta.url), "utf8");

test("uses a dedicated editor for nested sidebar entries", () => {
  assert.match(source, /function TreeNodeEditor/);
  assert.match(source, /ABLAGELEISTE BEARBEITEN/);
  assert.match(source, /setTreeNodeEditor\(\{ areaId: targetArea, uid \}\)/);
  assert.doesNotMatch(source, /window\.prompt\("Name des Listeneintrags"/);
});

test("supports reordering nested sidebar entries", () => {
  assert.match(source, /const moveNodeTree/);
  assert.match(source, /Reihenfolge in dieser Ebene/);
  assert.match(source, /Nach oben/);
  assert.match(source, /Nach unten/);
});

test("keeps legacy document assignments connected after a rename", () => {
  assert.match(source, /previousName !== name/);
  assert.match(source, /tileId: treeNodeEditor\.uid!/);
  assert.match(source, /assignmentSource: "manual"/);
});

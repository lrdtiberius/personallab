import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_ENERGY_METRIC_IDS, orderedEnergyMetricIds } from "../app/energy-metrics.ts";

const available = ["latest-reading", "month-consumption", "year-consumption", "month-cost", "data-quality"];

test("offers the EnergyLab meter reading in the default Strom selection", () => {
  assert.ok(DEFAULT_ENERGY_METRIC_IDS.includes("latest-reading"));
  assert.ok(DEFAULT_ENERGY_METRIC_IDS.includes("view-meter"));
  assert.deepEqual(orderedEnergyMetricIds(DEFAULT_ENERGY_METRIC_IDS, available), ["latest-reading", "month-consumption", "year-consumption", "data-quality"]);
});

test("keeps a manually chosen EnergieLab metric order and supports an empty selection", () => {
  assert.deepEqual(orderedEnergyMetricIds(["month-cost", "latest-reading", "unknown", "latest-reading"], available), ["month-cost", "latest-reading"]);
  assert.deepEqual(orderedEnergyMetricIds([], available), []);
});

test("persists the Strom metric selection and exposes the picker on the root energy node", async () => {
  const [ui, integration, server] = await Promise.all([
    readFile(new URL("../app/personallab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../local-api/server.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /energyMetricSelections/);
  assert.match(ui, /active\.node\.id === active\.root\.id/);
  assert.match(integration, /EnergieLab-Daten auswählen/);
  assert.match(integration, /Aktueller Zählerstand/);
  assert.match(integration, /Alle von EnergieLab gelieferten Messwerte/);
  assert.match(integration, /Ersparnis aktueller Monat/);
  assert.match(server, /normalizeEnergyMetricSelections/);
});

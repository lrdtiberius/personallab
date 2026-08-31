import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { energyProviderNames, inferEnergyProviderNames, orderedEnergyContracts } from "../app/energy-providers.ts";

const contracts = [
  { id: 1, provider: "Vattenfall" },
  { id: 2, provider: "Stadtwerke Unstrut-Hainich" },
  { id: 3, provider: "Vattenfall" },
  { id: 4, provider: "TEAG Thüringer Energie" },
];

test("finds unique EnergieLab providers and infers the selected sidebar provider", () => {
  const providers = energyProviderNames(contracts);
  assert.deepEqual(providers, ["Vattenfall", "Stadtwerke Unstrut-Hainich", "TEAG Thüringer Energie"]);
  assert.deepEqual(inferEnergyProviderNames(providers, "Vattenfall"), ["Vattenfall"]);
  assert.deepEqual(inferEnergyProviderNames(providers, "Stadtwerke"), ["Stadtwerke Unstrut-Hainich"]);
});

test("filters EnergieLab contracts and keeps the manually maintained provider order", () => {
  assert.deepEqual(orderedEnergyContracts(contracts, ["TEAG Thüringer Energie", "Vattenfall"]).map(contract => contract.id), [4, 1, 3]);
  assert.deepEqual(orderedEnergyContracts(contracts, []).map(contract => contract.id), []);
});

test("persists deep EnergieLab provider assignments in PersonalLab", async () => {
  const [ui, integration, server] = await Promise.all([
    readFile(new URL("../app/personallab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../local-api/server.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /energyProviderAssignments/);
  assert.match(ui, /active\.path\[1\]/);
  assert.match(ui, /energyDetailId\(active\.path\.at\(-1\)\)/);
  assert.match(integration, /Anbieter auswählen/);
  assert.match(server, /normalizeEnergyProviderAssignments/);
});

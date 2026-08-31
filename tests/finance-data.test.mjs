import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_FINANCE_DATA_IDS, DEFAULT_FINANCE_GROUP_DATA_IDS, FINANCE_DATA_IDS, orderedFinanceDataIds } from "../app/finance-data.ts";

test("offers every FinanceLab summary and view for manual selection", () => {
  for (const id of ["balance", "credit-total", "income", "expenses", "surplus", "overdraft-warnings", "view-accounts", "view-credits", "view-rates"]) {
    assert.ok(FINANCE_DATA_IDS.includes(id));
  }
  assert.ok(DEFAULT_FINANCE_DATA_IDS.includes("credit-total"));
  assert.ok(DEFAULT_FINANCE_DATA_IDS.includes("income"));
  assert.ok(DEFAULT_FINANCE_DATA_IDS.includes("view-credits"));
  assert.ok(DEFAULT_FINANCE_GROUP_DATA_IDS.includes("view-accounts"));
});

test("keeps a manually chosen FinanceLab data order and supports an empty selection", () => {
  assert.deepEqual(orderedFinanceDataIds(["view-rates", "income", "unknown", "income"], FINANCE_DATA_IDS), ["view-rates", "income"]);
  assert.deepEqual(orderedFinanceDataIds([], FINANCE_DATA_IDS), []);
});

test("persists the complete FinanceLab selection", async () => {
  const [ui, integration, server] = await Promise.all([
    readFile(new URL("../app/personallab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../local-api/server.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /financeDataSelections/);
  assert.match(integration, /FinanzLab-Daten auswählen/);
  assert.match(integration, /Monatliche Ausgaben/);
  assert.match(integration, /Alle von FinanzLab gelieferten Kredite/);
  assert.match(server, /normalizeFinanceDataSelections/);
});

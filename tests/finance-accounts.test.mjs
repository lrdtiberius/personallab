import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inferFinanceAccountIds, orderedFinanceAccounts } from "../app/finance-accounts.ts";

const accounts = [
  { id: 1, name: "Sparkasse Giro" },
  { id: 2, name: "Sparkasse Tagesgeld" },
  { id: 3, name: "ING Giro" },
  { id: 4, name: "ING Extrakonto" },
  { id: 5, name: "Wüstenrot Bausparen" },
];

test("infers only accounts belonging to the selected bank", () => {
  assert.deepEqual(inferFinanceAccountIds(accounts, "Sparkasse"), ["1", "2"]);
  assert.deepEqual(inferFinanceAccountIds(accounts, "ING"), ["3", "4"]);
  assert.deepEqual(inferFinanceAccountIds(accounts, "Wuestenrot"), ["5"]);
});

test("uses the manually maintained account order", () => {
  assert.deepEqual(orderedFinanceAccounts(accounts, ["4", "3"]).map(account => account.name), ["ING Extrakonto", "ING Giro"]);
  assert.deepEqual(orderedFinanceAccounts(accounts, []).map(account => account.name), []);
});

test("persists account assignments in the PersonalLab state", async () => {
  const [ui, integration, server] = await Promise.all([
    readFile(new URL("../app/personallab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/integrations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../local-api/server.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /financeAccountAssignments/);
  assert.match(integration, /FinanzLab-Daten auswählen/);
  assert.match(server, /normalizeFinanceAccountAssignments/);
});

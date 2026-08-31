import assert from "node:assert/strict";
import test from "node:test";
import { contractStatusFor, refreshContractStatuses } from "../local-api/contracts.mjs";

const now = new Date("2026-08-27T12:00:00Z");
const contract = { title: "Stromliefervertrag", type: "Vertrag", area: "contracts" };

test("marks ended non-renewing contracts inactive", () => {
  assert.equal(contractStatusFor({ ...contract, contractEnd: "2026-08-01", autoRenew: false }, now), "inactive");
});

test("does not mark automatically renewing contracts inactive", () => {
  assert.equal(contractStatusFor({ ...contract, contractEnd: "2026-08-01", autoRenew: true }, now), "expiring");
});

test("marks contracts expiring within 90 days", () => {
  assert.equal(contractStatusFor({ ...contract, contractEnd: "2026-10-01" }, now), "expiring");
});

test("manual status overrides calculated status", () => {
  assert.equal(contractStatusFor({ ...contract, contractEnd: "2020-01-01", contractStatus: "active", contractStatusManual: true }, now), "active");
});

test("refresh keeps non-contract documents untouched", () => {
  const documents = [{ id: 1, title: "Arztbrief", type: "Bericht" }, { id: 2, ...contract, contractEnd: "2020-01-01" }];
  const result = refreshContractStatuses(documents, now);
  assert.deepEqual(result[0], documents[0]);
  assert.equal(result[1].contractStatus, "inactive");
});

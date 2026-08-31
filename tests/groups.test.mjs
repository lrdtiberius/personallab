import assert from "node:assert/strict";
import test from "node:test";
import { readableGroup, sanitizeDocumentGroups } from "../local-api/groups.mjs";

test("replaces numeric Paperless group IDs with the correspondent name", () => {
  assert.equal(readableGroup("13", "Sparkasse Unstrut-Hainich"), "Sparkasse Unstrut-Hainich");
});

test("uses a neutral label for an unresolved correspondent", () => {
  assert.equal(readableGroup("7", "Nicht eindeutig (Paperless-Korrespondent 7)"), "Nicht erkannt");
});

test("keeps manually named groups unchanged", () => {
  const [document] = sanitizeDocumentGroups([{ group: "Girokonto", correspondent: "Sparkasse" }]);
  assert.equal(document.group, "Girokonto");
});

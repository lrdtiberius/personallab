import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSearchText, searchDocuments } from "../app/document-search.ts";

const documents = [
  { id: 1, title: "Krankenhaus 63", type: "Nicht erkannt", analysisSummary: "Ambulanzbericht über eine traumatische Plexusläsion." },
  { id: 2, title: "2024-06", searchTitle: "Gehaltsabrechnung · Juni 2024", type: "Gehaltsabrechnung", correspondent: "Thomaflor GmbH" },
  { id: 3, title: "KFZ-Steuerbescheid", type: "Bescheid", analysisSummary: "Festsetzung der Kraftfahrzeugsteuer für den VW Multivan." },
];

test("normalizes umlauts, accents and punctuation", () => {
  assert.equal(normalizeSearchText("Kündigung – März"), "kundigung marz");
});

test("finds terms that only exist in the analyzer summary", () => {
  assert.deepEqual(searchDocuments(documents, "Plexusläsion").map(item => item.id), [1]);
});

test("understands common German document synonyms and natural queries", () => {
  assert.deepEqual(searchDocuments(documents, "zeige mir lohn 2024").map(item => item.id), [2]);
  assert.deepEqual(searchDocuments(documents, "Auto Steuer").map(item => item.id), [3]);
});

test("tolerates a small typo", () => {
  assert.deepEqual(searchDocuments(documents, "Gehalttabrechnung").map(item => item.id), [2]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { enrichPaperlessDocument } from "../local-api/document-enrichment.mjs";

test("creates a useful PersonalLab title and summary from invoice OCR", () => {
  const result = enrichPaperlessDocument({
    title: "Roborock Qrevo Curv2 ProX",
    correspondent: "Nicht erkannt",
    documentType: "Rechnung",
    date: "2026-08-19",
    content: `janado
Max Mustermann
Unterm Kirchberg 7
99976 Rodeberg
Rechnungsnummer     Rechnungsdatum     Externe Auftragsnummer
RE923362            20.08.2026        21-15033-09216
Rechnung RE923362
Roborock Qrevo Curv2 ProX
Rechnungssumme 669,90 EUR`,
  });

  assert.equal(result.correspondent, "Janado");
  assert.equal(result.date, "2026-08-20");
  assert.equal(result.invoiceNumber, "RE923362");
  assert.equal(result.amount, 669.9);
  assert.equal(result.title, "Rechnung · Janado · Roborock Qrevo Curv2 ProX");
  assert.equal(result.summary, "Rechnung RE923362 von Janado über 669,90 € für Roborock Qrevo Curv2 ProX, ausgestellt am 20. August 2026.");
});

test("does not invent structured data for unrelated documents", () => {
  assert.deepEqual(enrichPaperlessDocument({ title: "Arztbrief", documentType: "Arztbrief", content: "Befund und Therapie" }), {
    title: "",
    summary: "",
    correspondent: "",
    date: "",
    invoiceNumber: "",
    amount: null,
  });
});

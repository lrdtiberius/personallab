import assert from "node:assert/strict";
import test from "node:test";
import { documentPeriod, documentSummary, documentYear, friendlyDocumentTitle, sortDocumentsByDate } from "../app/document-presentation.ts";

test("uses the payroll period from the title before a later import date", () => {
  const document = { title: "2024-06", type: "Gehaltsabrechnung", date: "15.06.2025" };
  assert.deepEqual(documentPeriod(document), { year: "2024", month: 6 });
  assert.equal(documentYear(document), "2024");
  assert.equal(friendlyDocumentTitle(document), "Gehaltsabrechnung · Juni 2024");
});

test("recognizes German month-year payroll names and corrections", () => {
  assert.equal(friendlyDocumentTitle({ title: "03-2024 1. Korrektur", type: "Gehaltsabrechnung", date: "14.05.2024" }), "Gehaltsabrechnung · Korrektur · März 2024");
});

test("turns account filenames into readable names without account numbers", () => {
  const title = friendlyDocumentTitle({ title: "Konto_1175007427-Auszug_2026_0007", type: "Kontoauszug", correspondent: "Sparkasse Unstrut-Hainich", date: "01.08.2026" });
  assert.equal(title, "Kontoauszug · Juli 2026 · Sparkasse Unstrut-Hainich");
  assert.equal(title.includes("1175007427"), false);
});

test("keeps already descriptive titles and cleans underscores", () => {
  assert.equal(friendlyDocumentTitle({ title: "Informationsbogen_zur_Einlagensicherung", type: "Korrespondenz", date: "26.08.2026" }), "Informationsbogen zur Einlagensicherung");
});

test("replaces numbered hospital titles with a meaningful medical name", () => {
  const document = {
    title: "Krankenhaus_63",
    type: "Nicht eindeutig (Paperless-Dokumenttyp 54)",
    area: "health",
    date: "15.02.2019",
    analysisSummary: "Ambulanzbericht mit Diagnose einer traumatischen Plexusläsion und inkompletter Querschnittlähmung. Empfehlung zur Operation.",
  };
  assert.equal(friendlyDocumentTitle(document), "Ambulanzbericht · Plexusläsion & Querschnittlähmung · Februar 2019");
});

test("turns generic fertility titles into a specific readable name", () => {
  const document = {
    title: "Kinderwunsch Kopie",
    type: "Schriftverkehr",
    area: "health",
    date: "15.05.2025",
    analysisSummary: "Kinderwunschbehandlung mit ICSI-TESE aufgrund primärer Sterilität und Zyklusunregelmäßigkeit.",
  };
  assert.equal(friendlyDocumentTitle(document), "Kinderwunschbehandlung · ICSI/TESE · Mai 2025");
});

test("removes long internal numbers from otherwise useful titles", () => {
  assert.equal(friendlyDocumentTitle({ title: "Vodafone-Vertragsübersicht 108984949", type: "Vertrag", date: "17.08.2026" }), "Vodafone-Vertragsübersicht");
  assert.equal(friendlyDocumentTitle({ title: "Deine Bestellung 55587932 2", type: "Bestätigung", date: "16.08.2026" }), "Bestellbestätigung · August 2026");
});

test("provides a concise summary and fallback", () => {
  const long = "Ambulanzbericht mit ausführlicher Diagnose und Therapieempfehlung. ".repeat(6);
  assert.ok(documentSummary({ analysisSummary: long }).length <= 180);
  assert.match(documentSummary({ type: "Rechnung", correspondent: "Stadtwerke", date: "01.08.2026" }), /^Rechnung von Stadtwerke vom 1\. August 2026\.$/);
});

test("sorts German document dates in both directions", () => {
  const documents = [
    { id: 1, date: "18.12.2018" },
    { id: 2, date: "15.05.2025" },
    { id: 3, date: "15.02.2019" },
  ];
  assert.deepEqual(sortDocumentsByDate(documents, "desc").map(item => item.id), [2, 3, 1]);
  assert.deepEqual(sortDocumentsByDate(documents, "asc").map(item => item.id), [1, 3, 2]);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function serve(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function freePort() {
  const temporary = await serve((_request, response) => response.end());
  const port = new URL(temporary.url).port;
  await close(temporary.server);
  return port;
}

async function waitForJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError;
}

test("binds EnergyLab and FinanzLab as read-only PersonalLab views", async () => {
  const energy = await serve((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/api/personallab");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      version: "1",
      segments: [
        {
          id: "electricity",
          label: "Strom",
          contracts: [{ id: 1, provider: "Stadtwerke" }],
          advances: [{ id: 1, amountCents: 9900 }],
          history: [{ month: "2026-08", consumption: 245 }],
          readings: [{ date: "2026-08-25", value: 12345 }],
        },
        {
          id: "wastewater",
          label: "Abwasser",
          unit: "m³",
          latest: { date: "2026-08-25", total: 200, unit: "m³", source: "water" },
          consumption: { month: 4, year: 43, total: 200 },
          finances: { month: { cost: 19, advance: 48 }, year: { cost: 190, advance: 192 } },
          contracts: [{ id: 2, provider: "Abwasserzweckverband" }],
          history: [{ date: "2026-08-25", total: 200, delta: 4, unit: "m³" }],
        },
      ],
    }));
  });

  const finance = await serve((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/households") {
      return response.end(JSON.stringify({ items: [{ id: "home", name: "Musterhaushalt" }] }));
    }
    if (request.url.startsWith("/api/dashboard?")) {
      assert.match(request.url, /household_id=home/);
      return response.end(JSON.stringify({
        as_of: "2026-08-26",
        household: {
          name: "Musterhaushalt",
          accounts: [{ id: "giro", name: "Girokonto", balance_cents: 123456 }],
        },
        metrics: { total_balance_cents: 123456 },
        credit_summary: { open_balance_cents: 440000 },
      }));
    }
    if (request.url.startsWith("/api/credits?")) {
      assert.match(request.url, /household_id=home/);
      return response.end(JSON.stringify({
        items: [{
          id: "car",
          name: "Autokredit",
          credit_type: "loan",
          remaining_balance_cents: 440000,
          payments: [{
            id: "rate-1",
            date: "2099-01-15",
            planned_account_amount_cents: 17500,
            remaining_after_cents: 422500,
          }],
        }],
      }));
    }
    response.statusCode = 404;
    return response.end("{}");
  });

  const temporary = await mkdtemp(path.join(os.tmpdir(), "personallab-test-"));
  const dataFile = path.join(temporary, "personallab.json");
  const defaults = JSON.parse(await readFile(new URL("../local-api/default-state.json", import.meta.url), "utf8"));
  const property = defaults.areas.find(area => area.id === "property");
  await writeFile(dataFile, JSON.stringify({
    ...defaults,
    areas: [
      { ...property, subareas: [...property.subareas, { id: "utilities", name: "Versorger", description: "Alt", color: "#fff" }] },
      { id: "energy", name: "Meine Energie", description: "Eigene Struktur", tone: "teal", icon: "energy", subareas: [
        { id: "electricity", name: "Strom" },
        { id: "water", name: "Trinkwasser" },
        { id: "gas", name: "Gas" },
      ] },
    ],
    documents: [{
      id: 7,
      title: "Stromabrechnung 2025",
      area: "property",
      subarea: "utilities",
      assignmentSource: "rule",
      tags: [],
    }],
  }));

  const port = await freePort();
  const child = spawn(process.execPath, ["local-api/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: port,
      DATA_FILE: dataFile,
      ENERGYLAB_URL: energy.url,
      FINANZLAB_URL: finance.url,
      AUTO_SYNC_ENABLED: "false",
      SYNC_ON_START: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForJson(`http://127.0.0.1:${port}/api/health`);
    const state = await waitForJson(`http://127.0.0.1:${port}/api/state`);
    assert.equal(state.version, "2.5.11");
    assert.ok(state.areas.find(area => area.id === "property").subareas.some(subarea => subarea.id === "utilities"));
    const migratedEnergy = state.areas.find(area => area.id === "energy");
    assert.equal(migratedEnergy.name, "Meine Energie");
    assert.deepEqual(migratedEnergy.subareas.map(subarea => subarea.id), ["electricity", "water", "wastewater", "gas"]);
    assert.deepEqual(
      { area: state.documents[0].area, subarea: state.documents[0].subarea },
      { area: "property", subarea: "utilities" },
    );

    const energyView = await waitForJson(`http://127.0.0.1:${port}/api/integrations/energy`);
    assert.equal(energyView.segments[0].label, "Strom");
    assert.equal(energyView.segments.find(segment => segment.id === "wastewater").label, "Abwasser");
    assert.equal(energyView.sourceUrl, energy.url);

    const financeView = await waitForJson(`http://127.0.0.1:${port}/api/integrations/finance`);
    assert.equal(financeView.household.name, "Musterhaushalt");
    assert.equal(financeView.accounts[0].balance_cents, 123456);
    assert.equal(financeView.credits[0].remaining_balance_cents, 440000);
    assert.equal(financeView.rates[0].amountCents, 17500);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
    await Promise.all([close(energy.server), close(finance.server)]);
    await rm(temporary, { recursive: true, force: true });
  }
});

test("merges analyzer results with Paperless documents by Paperless ID", async () => {
  const paperlessMutationMethods = [];
  const paperless = await serve((request, response) => {
    if (request.method !== "GET") {
      paperlessMutationMethods.push(request.method);
      response.statusCode = 405;
      return response.end("{}");
    }
    response.setHeader("content-type", "application/json");
    const pages = {
      "/api/documents/?page_size=100": { results: [{ id: 42, title: "Monatsunterlage", correspondent: 3, document_type: null, tags: [8], created: "2026-08-01" }], next: null },
      "/api/correspondents/?page_size=100": { results: [{ id: 3, name: "Vattenfall" }], next: null },
      "/api/document_types/?page_size=100": { results: [], next: null },
      "/api/tags/?page_size=100": { results: [{ id: 8, name: "Energie" }], next: null },
    };
    const payload = pages[request.url];
    if (!payload) { response.statusCode = 404; return response.end("{}"); }
    return response.end(JSON.stringify(payload));
  });
  const analyzer = await serve((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/documents?limit=200&offset=0") return response.end(JSON.stringify([{ paperless_id: 42, document_type: "Stromabrechnung", correspondent: "Vattenfall", short_title: "Strom-Jahresabrechnung 2025 · Vattenfall", summary: "Jahresabrechnung für Stromlieferung und Zählerstand", keywords: ["Strom", "Zählerstand", "Abschlag"], category: "Energie", search_text: "Vertragskonto 4711 Verbrauch 2400 kWh", confidence: 0.97, analyzed_at: "2026-08-25T12:00:00Z" }]));
    response.statusCode = 404;
    return response.end("{}");
  });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "personallab-analyzer-test-"));
  const dataFile = path.join(temporary, "personallab.json");
  const port = await freePort();
  const child = spawn(process.execPath, ["local-api/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: port, DATA_FILE: dataFile, PAPERLESS_URL: paperless.url, PAPERLESS_TOKEN: "test", ANALYZER_URL: analyzer.url, AUTO_SYNC_ENABLED: "false", SYNC_ON_START: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForJson(`http://127.0.0.1:${port}/api/health`);
    const syncResponse = await fetch(`http://127.0.0.1:${port}/api/sync`, { method: "POST" });
    assert.ok(syncResponse.ok);
    let state;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      state = await waitForJson(`http://127.0.0.1:${port}/api/state`);
      if (state.syncStatus !== "running") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(state.documents[0].id, 42);
    assert.equal(state.documents[0].type, "Stromabrechnung");
    assert.equal(state.documents[0].correspondent, "Vattenfall");
    assert.equal(state.documents[0].analysisSummary, "Jahresabrechnung für Stromlieferung und Zählerstand");
    assert.equal(state.documents[0].presentationTitle, "Strom-Jahresabrechnung 2025 · Vattenfall");
    assert.equal(state.documents[0].presentationSummary, "Jahresabrechnung für Stromlieferung und Zählerstand");
    assert.deepEqual(state.documents[0].analysisKeywords, ["Strom", "Zählerstand", "Abschlag"]);
    assert.equal(state.documents[0].analysisCategory, "Energie");
    assert.match(state.documents[0].analysisSearchText, /2400 kWh/);
    assert.equal(state.documents[0].analysisConfidence, 0.97);
    assert.deepEqual({ area: state.documents[0].area, subarea: state.documents[0].subarea }, { area: "property", subarea: "electricity" });
    const disableResponse = await fetch(`http://127.0.0.1:${port}/api/documents/42/disable`, { method: "POST" });
    assert.equal(disableResponse.status, 200);
    assert.equal((await disableResponse.json()).status, "disabled");
    assert.deepEqual(paperlessMutationMethods, []);
    state = await waitForJson(`http://127.0.0.1:${port}/api/state`);
    assert.deepEqual(state.documents, []);
    assert.equal(state.disabledDocuments[0].id, 42);
    const restoreResponse = await fetch(`http://127.0.0.1:${port}/api/documents/42/restore`, { method: "POST" });
    assert.equal(restoreResponse.status, 200);
    assert.equal((await restoreResponse.json()).status, "restored");
    state = await waitForJson(`http://127.0.0.1:${port}/api/state`);
    assert.equal(state.documents[0].id, 42);
    assert.deepEqual(state.disabledDocuments, []);
    assert.deepEqual(paperlessMutationMethods, []);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
    await Promise.all([close(paperless.server), close(analyzer.server)]);
    await rm(temporary, { recursive: true, force: true });
  }
});

test("uses the existing Paperless RAG container for semantic document search", async () => {
  const rag = await serve(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/ask");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), { question: "Was kostete der Roborock?" });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      answer: "Der Roborock kostete 669,90 Euro.",
      duration_ms: 123,
      search: { answer_mode: "fast_fact" },
      sources: [
        { document_id: 77, title: "Rechnung", correspondent: "Janado", document_type: "Rechnung", document_date: "2026-08-20", excerpt: "Rechnungssumme 669,90 EUR", score: 0.98 },
        { document_id: 999, title: "Nicht in PersonalLab", excerpt: "ausgeblendet", score: 0.8 },
      ],
    }));
  });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "personallab-rag-test-"));
  const dataFile = path.join(temporary, "personallab.json");
  const defaults = JSON.parse(await readFile(new URL("../local-api/default-state.json", import.meta.url), "utf8"));
  await writeFile(dataFile, JSON.stringify({ ...defaults, documents: [{ id: 77, title: "Roborock", correspondent: "Janado", type: "Rechnung", date: "2026-08-20", area: "finance", subarea: "invoices", tags: [] }] }));
  const port = await freePort();
  const child = spawn(process.execPath, ["local-api/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: port, DATA_FILE: dataFile, PAPERLESS_RAG_URL: rag.url, AUTO_SYNC_ENABLED: "false", SYNC_ON_START: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForJson(`http://127.0.0.1:${port}/api/health`);
    const state = await waitForJson(`http://127.0.0.1:${port}/api/state`);
    assert.equal(state.config.rag, true);
    assert.equal(state.config.ragUrl, rag.url);
    const response = await fetch(`http://127.0.0.1:${port}/api/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "Was kostete der Roborock?" }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.answer, "Der Roborock kostete 669,90 Euro.");
    assert.equal(result.mode, "fast_fact");
    assert.deepEqual(result.sources.map(source => source.documentId), [77]);
    assert.equal(result.sources[0].excerpt, "Rechnungssumme 669,90 EUR");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
    await close(rag.server);
    await rm(temporary, { recursive: true, force: true });
  }
});

test("derives useful invoice presentation data from Paperless OCR without storing the OCR text", async () => {
  const paperless = await serve((request, response) => {
    assert.equal(request.method, "GET");
    response.setHeader("content-type", "application/json");
    const pages = {
      "/api/documents/?page_size=100": { results: [{
        id: 77,
        title: "Roborock Qrevo Curv2 ProX",
        correspondent: null,
        document_type: 5,
        tags: [],
        created: "2026-08-19",
        content: "janado\nRechnungsnummer Rechnungsdatum\nRE923362 20.08.2026\nRechnung RE923362\nRoborock Qrevo Curv2 ProX\nRechnungssumme 669,90 EUR",
      }], next: null },
      "/api/correspondents/?page_size=100": { results: [], next: null },
      "/api/document_types/?page_size=100": { results: [{ id: 5, name: "Rechnung" }], next: null },
      "/api/tags/?page_size=100": { results: [], next: null },
    };
    const payload = pages[request.url];
    if (!payload) { response.statusCode = 404; return response.end("{}"); }
    return response.end(JSON.stringify(payload));
  });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "personallab-invoice-test-"));
  const dataFile = path.join(temporary, "personallab.json");
  const port = await freePort();
  const child = spawn(process.execPath, ["local-api/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: port, DATA_FILE: dataFile, PAPERLESS_URL: paperless.url, PAPERLESS_TOKEN: "test", AUTO_SYNC_ENABLED: "false", SYNC_ON_START: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForJson(`http://127.0.0.1:${port}/api/health`);
    assert.ok((await fetch(`http://127.0.0.1:${port}/api/sync`, { method: "POST" })).ok);
    let state;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      state = await waitForJson(`http://127.0.0.1:${port}/api/state`);
      if (state.syncStatus !== "running") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const [document] = state.documents;
    assert.equal(document.correspondent, "Janado");
    assert.equal(document.date, "2026-08-20");
    assert.equal(document.presentationTitle, "Rechnung · Janado · Roborock Qrevo Curv2 ProX");
    assert.match(document.presentationSummary, /RE923362.*669,90.*20\. August 2026/);
    assert.deepEqual({ area: document.area, subarea: document.subarea }, { area: "finance", subarea: "invoices" });
    assert.equal(Object.prototype.hasOwnProperty.call(document, "content"), false);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
    await close(paperless.server);
    await rm(temporary, { recursive: true, force: true });
  }
});

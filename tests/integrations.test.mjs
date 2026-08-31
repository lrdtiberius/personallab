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
      ],
    }));
  });

  const finance = await serve((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/households") {
      return response.end(JSON.stringify({ items: [{ id: "home", name: "Müller" }] }));
    }
    if (request.url.startsWith("/api/dashboard?")) {
      assert.match(request.url, /household_id=home/);
      return response.end(JSON.stringify({
        as_of: "2026-08-26",
        household: {
          name: "Müller",
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
    areas: [{ ...property, subareas: [...property.subareas, { id: "utilities", name: "Versorger", description: "Alt", color: "#fff" }] }],
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
    assert.equal(state.version, "2.5.7");
    assert.ok(state.areas.find(area => area.id === "property").subareas.some(subarea => subarea.id === "utilities"));
    assert.deepEqual(
      { area: state.documents[0].area, subarea: state.documents[0].subarea },
      { area: "property", subarea: "utilities" },
    );

    const energyView = await waitForJson(`http://127.0.0.1:${port}/api/integrations/energy`);
    assert.equal(energyView.segments[0].label, "Strom");
    assert.equal(energyView.sourceUrl, energy.url);

    const financeView = await waitForJson(`http://127.0.0.1:${port}/api/integrations/finance`);
    assert.equal(financeView.household.name, "Müller");
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
    if (request.url === "/api/documents?limit=200&offset=0") return response.end(JSON.stringify([{ paperless_id: 42, document_type: "Stromabrechnung", correspondent: "Vattenfall", summary: "Jahresabrechnung für Stromlieferung und Zählerstand", confidence: 0.97, analyzed_at: "2026-08-25T12:00:00Z" }]));
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

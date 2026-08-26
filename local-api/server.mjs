import http from "node:http";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.env.PORT ?? "8095", 10);
const dataFile = resolve(process.env.DATA_FILE ?? "/data/personallab.json");
const paperlessUrl = (process.env.PAPERLESS_URL ?? "").replace(/\/$/, "");
const paperlessToken = process.env.PAPERLESS_TOKEN ?? "";
const analyzerUrl = (process.env.ANALYZER_URL ?? "").replace(/\/$/, "");
const haUrl = (process.env.HOME_ASSISTANT_URL ?? "").replace(/\/$/, "");
const haToken = process.env.HOME_ASSISTANT_TOKEN ?? "";
const energyLabUrl = (process.env.ENERGYLAB_URL ?? "").replace(/\/$/, "");
const energyLabUsername = process.env.ENERGYLAB_USERNAME ?? "";
const energyLabPassword = process.env.ENERGYLAB_PASSWORD ?? "";
const financeLabUrl = (process.env.FINANZLAB_URL ?? "").replace(/\/$/, "");
const financeLabHouseholdId = process.env.FINANZLAB_HOUSEHOLD_ID ?? "";
const autoSync = (process.env.AUTO_SYNC_ENABLED ?? "true").toLowerCase() === "true";
const syncOnStart = (process.env.SYNC_ON_START ?? "true").toLowerCase() === "true";
const syncMinutes = Math.max(5, Number.parseInt(process.env.AUTO_SYNC_INTERVAL_MINUTES ?? "15", 10));

let state;
let saveChain = Promise.resolve();
let syncPromise = null;

async function initialState() {
  const defaults = JSON.parse(await readFile(resolve(here, "default-state.json"), "utf8"));
  try {
    const stored = JSON.parse(await readFile(dataFile, "utf8"));
    const storedAreas = Array.isArray(stored.areas) ? stored.areas : [];
    const defaultIds = new Set(defaults.areas.map(area => area.id));
    const areas = defaults.areas.map(defaultArea => {
      const saved = storedAreas.find(area => area.id === defaultArea.id);
      if (!saved) return defaultArea;
      const savedSubareas = Array.isArray(saved.subareas) ? saved.subareas : [];
      const defaultSubIds = new Set(defaultArea.subareas.map(subarea => subarea.id));
      return {
        ...defaultArea,
        ...saved,
        name: defaultArea.id === "property" && saved.name === "Haus & Immobilie" ? defaultArea.name : (saved.name ?? defaultArea.name),
        description: defaultArea.id === "property" && saved.description === "Eigentum, Abgaben, Wartung und Versorgung" ? defaultArea.description : (saved.description ?? defaultArea.description),
        subareas: [
          ...defaultArea.subareas.map(defaultSubarea => ({ ...defaultSubarea, ...(savedSubareas.find(subarea => subarea.id === defaultSubarea.id) ?? {}) })),
          ...savedSubareas.filter(subarea => !defaultSubIds.has(subarea.id) && !(defaultArea.id === "property" && subarea.id === "utilities")),
        ],
      };
    });
    areas.push(...storedAreas.filter(area => !defaultIds.has(area.id)));
    const documents = (stored.documents ?? []).map(document => {
      if (document.area !== "property" || document.subarea !== "utilities" || document.assignmentSource === "manual") return document;
      const suggestion = classifyDocument(document, document.correspondent, document.type, document.tags ?? []);
      return suggestion.area && suggestion.subarea ? { ...document, ...suggestion } : document;
    });
    return { ...defaults, ...stored, areas, documents, haSensors: stored.haSensors ?? [] };
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("State konnte nicht gelesen werden:", error);
    return defaults;
  }
}

function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  saveChain = saveChain.then(async () => {
    await mkdir(dirname(dataFile), { recursive: true });
    const temporary = `${dataFile}.tmp`;
    await writeFile(temporary, snapshot, { mode: 0o600 });
    await rename(temporary, dataFile);
  }).catch(error => console.error("State konnte nicht gespeichert werden:", error));
  return saveChain;
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  response.end(body);
}

async function bodyJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 8 * 1024 * 1024) throw new Error("Anfrage ist zu groß");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function proxyPaperlessDocument(response, documentId, kind) {
  if (!paperlessUrl || !paperlessToken) return json(response, 503, { error: "Paperless ist nicht konfiguriert" });
  const endpoint = kind === "thumbnail" ? "thumb" : "preview";
  let upstream = await fetch(`${paperlessUrl}/api/documents/${documentId}/${endpoint}/`, { headers: { authorization: `Token ${paperlessToken}` }, signal: AbortSignal.timeout(30000) });
  if (!upstream.ok && kind === "preview") upstream = await fetch(`${paperlessUrl}/api/documents/${documentId}/download/`, { headers: { authorization: `Token ${paperlessToken}` }, signal: AbortSignal.timeout(30000) });
  if (!upstream.ok) return json(response, upstream.status, { error: `Paperless-Vorschau nicht verfügbar (${upstream.status})` });
  const body = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(200, {
    "content-type": upstream.headers.get("content-type") ?? (kind === "thumbnail" ? "image/webp" : "application/pdf"),
    "content-length": body.length,
    "cache-control": "private, max-age=300",
    "content-disposition": "inline",
  });
  response.end(body);
}

async function fetchPages(endpoint, headers) {
  const items = [];
  let next = `${paperlessUrl}${endpoint}${endpoint.includes("?") ? "&" : "?"}page_size=100`;
  let pages = 0;
  while (next && pages < 1000) {
    const data = await fetchJson(next, headers);
    items.push(...(Array.isArray(data) ? data : data.results ?? []));
    next = Array.isArray(data) ? null : data.next;
    pages += 1;
  }
  return items;
}

async function fetchAnalyzerDocuments() {
  if (!analyzerUrl) return [];
  const items = [];
  let offset = 0;
  while (offset < 100000) {
    const page = await fetchJson(`${analyzerUrl}/api/documents?limit=200&offset=${offset}`, { accept: "application/json" });
    if (!Array.isArray(page)) throw new Error("Analyzer liefert keine Dokumentliste");
    items.push(...page);
    if (page.length < 200) break;
    offset += page.length;
  }
  return items;
}

function referenceName(value, lookup) {
  if (value && typeof value === "object") return value.name ?? value.title ?? "";
  return lookup.get(Number(value)) ?? "";
}

function normalized(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function classifyDocument(item, correspondent, documentType, tagNames, analysis = null) {
  const text = normalized([item.title, item.original_file_name, correspondent, documentType, ...tagNames, analysis?.document_type, analysis?.summary].join(" "));
  const rules = [
    ["health", "disability", /schwerbehind|grad der behinderung|versorgungsamt|merkzeichen/],
    ["health", "findings", /befund|labor|blutbild|radiolog|rontgen|mrt|ct |sonograph|untersuchungsergebnis/],
    ["health", "medical-letters", /arztbrief|entlassungsbericht|klinikbericht|ambulanzbrief/],
    ["health", "diagnoses", /diagnos|anamnese|krankheitsverlauf/],
    ["health", "therapy", /therap|rehabilitation| reha|physiotherap|ergotherap/],
    ["health", "aids", /hilfsmittel|verordnung|rezept|sanitatshaus/],
    ["contracts", "mobile", /mobilfunk|handyvertrag|smartphone.?tarif|sim.?karte|rufnummernmitnahme|vodafone mobil|telekom mobil|o2 mobil|congstar/],
    ["property", "internet", /internetvertrag|festnetz|glasfaser|dsl|kabel.?internet|breitband|routermiete|telefonanschluss/],
    ["property", "waste", /mullgebuhr|müllgebühr|abfallgebuhr|abfallgebühr|entsorgung|abfallwirtschaft|wertstoff/],
    ["property", "property-insurance", /wohngebaude|wohngebäude|gebaudeversicherung|gebäudeversicherung|hausrat|elementarversicherung/],
    ["property", "water", /wasserverband|wasserabrechnung|wasservertrag|wasserzahler|wasserzähler|abwasser|trinkwasser/],
    ["property", "electricity", /stromliefer|stromvertrag|stromabrechnung|stromzahler|stromzähler|netzbetreiber|einspeisevertrag/],
    ["property", "gas", /gasliefer|gasvertrag|gasabrechnung|gaszahler|gaszähler|erdgas/],
    ["work", "salary", /gehaltsabrechnung|lohnabrechnung|entgeltabrechnung|verdienstabrechnung/],
    ["work", "tax-certificates", /lohnsteuerbescheinigung|steuerbescheinigung.*arbeit|jahreslohn/],
    ["work", "sick-notes", /arbeitsunfahig|krankmeldung|au-bescheinigung|eau /],
    ["work", "references", /arbeitszeugnis|zwischenzeugnis|dienstzeugnis/],
    ["work", "contracts", /arbeitsvertrag|anderungsvertrag|aufhebungsvertrag|dienstvertrag/],
    ["work", "employer-mail", /arbeitgeber|personalabteilung|beschaftigungsnachweis|betriebsrat/],
    ["contracts", "subscriptions", /abonnement|abo |streaming|mitgliedschaft|jahreslizenz|softwarelizenz/],
    ["contracts", "services", /servicevertrag|wartungsvertrag|dienstleistungsvertrag|pflegevertrag/],
    ["insurance", "vehicle-insurance", /kfz.?versicherung|autoversicherung|schadenfreiheits/],
    ["insurance", "health-insurance", /krankenversicherung|krankenkasse|pflegekasse/],
    ["insurance", "liability", /haftpflicht/],
    ["insurance", "household", /hausrat/],
    ["insurance", "building", /wohngebaude|gebaudeversicherung|elementarversicherung/],
    ["insurance", "provision", /lebensversicherung|rentenversicherung|unfallversicherung|vorsorge/],
    ["vehicle", "vehicle-tax", /kfz.?steuer|kraftfahrzeugsteuer|hauptzollamt/],
    ["vehicle", "inspection", /tuv|hauptuntersuchung|abgasuntersuchung|prufbericht/],
    ["vehicle", "tires", /reifen|rader|einlagerung/],
    ["vehicle", "service", /werkstatt|inspektion|fahrzeugservice|reparatur.*(auto|vw|ford|skoda)/],
    ["vehicle", "purchase", /fahrzeugbrief|zulassungsbescheinigung|kaufvertrag.*(auto|fahrzeug)|leasingvertrag/],
    ["energy", "pv", /photovoltaik|photovoltaik|pv.?anlage|wechselrichter|solaranlage|einspeisung/],
    ["property", "ownership", /grundbuch|notar|kaufvertrag.*(haus|wohnung|grundstuck)|eigentum/],
    ["property", "property-tax", /grundsteuer|abgabenbescheid|grundbesitz/],
    ["property", "craft", /handwerker|heizung|schornsteinfeger|wartung.*(haus|therme)/],
    ["hardware", "server", /nas|server|zimaos|synology|mini.?pc/],
    ["hardware", "network", /router|switch|wlan|netzwerk|fritz.?box/],
    ["hardware", "av", /fernseher|tv |audio|lautsprecher|subwoofer|heimkino/],
    ["hardware", "mobile", /smartphone|tablet|iphone|ipad|mobiltelefon/],
    ["hardware", "pc", /computer|gaming.?pc|grafikkarte|prozessor|monitor|hardware/],
    ["finance", "accounts", /kontoauszug|girokonto|tagesgeld|sparkasse|ing bank|bankkonto/],
    ["finance", "loans", /darlehen|kreditvertrag|ratenkredit|finanzierung/],
    ["finance", "tax", /steuerbescheid|einkommensteuer|finanzamt|steuererklarung/],
    ["finance", "cards", /kreditkarte|debitkarte|kartenabrechnung/],
    ["finance", "invoices", /rechnung|quittung|kassenbon|zahlungsbeleg/],
    ["contracts", "other-contracts", /vertrag|vertragsanderung|vertragsänderung|kundigung|kündigung|tarifwechsel/],
    ["correspondence", "authorities", /behorde|landratsamt|gemeinde|bundesamt|bescheid/],
    ["correspondence", "proof", /bescheinigung|nachweis|urkunde/],
    ["correspondence", "providers", /kundigung|tarif|anbieter|kundenservice/],
  ];
  const match = rules.find(([, , pattern]) => pattern.test(text));
  return match ? { area: match[0], subarea: match[1], assignmentSource: "rule" } : { area: "", subarea: "", assignmentSource: "unassigned" };
}

async function syncPaperless() {
  if (!paperlessUrl || !paperlessToken) throw new Error("Paperless-Verbindung ist nicht konfiguriert");
  const headers = { authorization: `Token ${paperlessToken}`, accept: "application/json" };
  const [rawDocuments, correspondents, documentTypes, tags, analyzerDocuments] = await Promise.all([
    fetchPages("/api/documents/", headers),
    fetchPages("/api/correspondents/", headers),
    fetchPages("/api/document_types/", headers),
    fetchPages("/api/tags/", headers),
    fetchAnalyzerDocuments().catch(error => { console.error("Analyzer-Abgleich fehlgeschlagen:", error.message); return []; }),
  ]);
  const correspondentNames = new Map(correspondents.map(item => [Number(item.id), item.name ?? ""]));
  const typeNames = new Map(documentTypes.map(item => [Number(item.id), item.name ?? ""]));
  const tagNames = new Map(tags.map(item => [Number(item.id), item.name ?? ""]));
  const analyzerByPaperlessId = new Map(analyzerDocuments.map(item => [Number(item.paperless_id), item]));
  const existing = new Map(state.documents.map(item => [Number(item.id), item]));
  const documents = rawDocuments.map(item => {
    const prior = existing.get(Number(item.id));
    const correspondent = referenceName(item.correspondent, correspondentNames);
    const documentType = referenceName(item.document_type, typeNames);
    const documentTags = (item.tags ?? []).map(tag => referenceName(tag, tagNames)).filter(Boolean);
    const analysis = analyzerByPaperlessId.get(Number(item.id));
    const effectiveCorrespondent = analysis?.correspondent || correspondent;
    const effectiveDocumentType = analysis?.document_type || documentType;
    const suggested = classifyDocument(item, effectiveCorrespondent, effectiveDocumentType, documentTags, analysis);
    return {
      id: Number(item.id),
      title: prior?.title ?? item.title ?? `Dokument ${item.id}`,
      sourceTitle: item.title ?? "",
      correspondent: prior?.metadataSource === "manual" ? prior.correspondent : effectiveCorrespondent || prior?.correspondent || "",
      type: prior?.metadataSource === "manual" ? prior.type : effectiveDocumentType || prior?.type || "",
      metadataSource: prior?.metadataSource ?? "paperless",
      tags: documentTags,
      analysisSummary: analysis?.summary ?? prior?.analysisSummary ?? "",
      analysisConfidence: analysis?.confidence ?? prior?.analysisConfidence ?? null,
      analyzedAt: analysis?.analyzed_at ?? prior?.analyzedAt ?? null,
      date: String(item.created ?? item.document_date ?? item.added ?? "").slice(0, 10),
      added: String(item.added ?? "").slice(0, 19),
      modified: String(item.modified ?? "").slice(0, 19),
      area: prior?.assignmentSource === "manual" ? prior.area : suggested.area,
      subarea: prior?.assignmentSource === "manual" ? prior.subarea : suggested.subarea,
      assignmentSource: prior?.assignmentSource === "manual" ? "manual" : suggested.assignmentSource,
      isNew: prior ? false : true,
      present: true,
    };
  });
  const seen = new Set(documents.map(item => item.id));
  for (const prior of state.documents) if (!seen.has(Number(prior.id))) documents.push({ ...prior, present: false });
  documents.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
  state.documents = documents;
  state.lastSync = new Date().toISOString();
  state.syncStatus = "idle";
  state.syncError = null;
  await persist();
  return { imported: rawDocuments.length, total: documents.length, lastSync: state.lastSync };
}

function startSync() {
  if (syncPromise) return syncPromise;
  state.syncStatus = "running";
  state.syncError = null;
  syncPromise = syncPaperless().catch(async error => {
    state.syncStatus = "failed";
    state.syncError = error instanceof Error ? error.message : String(error);
    await persist();
    throw error;
  }).finally(() => { syncPromise = null; });
  return syncPromise;
}

async function homeAssistantEntities() {
  if (!haUrl || !haToken) throw new Error("Home-Assistant-Verbindung ist nicht konfiguriert");
  const states = await fetchJson(`${haUrl}/api/states`, { authorization: `Bearer ${haToken}`, accept: "application/json" });
  return states.filter(item => /^(sensor|binary_sensor|person|device_tracker|input_number)\./.test(item.entity_id)).map(item => ({
    entityId: item.entity_id,
    name: item.attributes?.friendly_name ?? item.entity_id,
    state: item.state,
    unit: item.attributes?.unit_of_measurement ?? "",
    icon: item.attributes?.icon ?? "",
    updated: item.last_updated,
  })).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

async function selectedHomeAssistantEntities() {
  const selected = new Set(state.haSensors ?? []);
  return (await homeAssistantEntities()).filter(item => selected.has(item.entityId));
}

function basicAuthorization(username, password) {
  return username ? { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` } : {};
}

async function legacyEnergyLabOverview() {
  if (!energyLabUrl) throw new Error("EnergieLab-Verbindung ist nicht konfiguriert");
  const headers = { accept: "application/json", ...basicAuthorization(energyLabUsername, energyLabPassword) };
  try {
    const payload = await fetchJson(`${energyLabUrl}/api/personallab`, headers);
    if (Array.isArray(payload.segments)) return { ...payload, sourceUrl: energyLabUrl };
  } catch (error) {
    // EnergyLab 0.4.4 has no /api/personallab endpoint. Its read-only JSON
    // backup contains the same readings, providers, tariffs and advances.
    if (!String(error).includes("404")) throw error;
  }
  const backup = await fetchJson(`${energyLabUrl}/export/backup.json`, headers);
  const readings = Array.isArray(backup.energy_readings) ? backup.energy_readings : [];
  const tariffs = Array.isArray(backup.energy_tariffs) ? backup.energy_tariffs : [];
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const definitions = [
    ["electricity", "Strom", "grid_import", "kWh"],
    ["water", "Wasser", "water", "m³"],
    ["gas", "Gas", "gas", "m³"],
    ["pv", "Photovoltaik", "pv_self", "kWh"],
  ];
  const sumDelta = (items, start) => items.filter(item => item.read_on >= start && Number(item.is_valid ?? 1) !== 0).reduce((sum, item) => sum + Number(item.delta_value ?? 0), 0);
  const dateValue = value => new Date(`${value}T12:00:00Z`);
  const isoDate = value => value.toISOString().slice(0, 10);
  const addDays = (value, days) => { const result = dateValue(value); result.setUTCDate(result.getUTCDate() + days); return isoDate(result); };
  const daysBetween = (from, to) => Math.floor((dateValue(to) - dateValue(from)) / 86400000);
  const activeTariff = (metric, onDate) => tariffs.filter(item => item.metric === metric && item.valid_from <= onDate && (!item.valid_to || item.valid_to >= onDate)).sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)) || Number(b.id) - Number(a.id))[0] ?? null;
  const proratedMonths = (start, end) => {
    if (!start || !end || end < start) return 0;
    let total = 0;
    let cursor = `${start.slice(0, 7)}-01`;
    while (cursor <= end) {
      const current = dateValue(cursor);
      const next = new Date(current); next.setUTCMonth(next.getUTCMonth() + 1);
      const nextIso = isoDate(next);
      const monthEnd = addDays(nextIso, -1);
      const segmentStart = start > cursor ? start : cursor;
      const segmentEnd = end < monthEnd ? end : monthEnd;
      if (segmentStart <= segmentEnd) total += (daysBetween(segmentStart, segmentEnd) + 1) / daysBetween(cursor, nextIso);
      cursor = nextIso;
    }
    return total;
  };
  const allocatedUsage = (readingMetric, start = null, end = null, tariffMetric = readingMetric) => {
    const valid = readings.filter(item => item.metric === readingMetric && Number(item.is_valid ?? 1) !== 0).sort((a, b) => String(a.read_on).localeCompare(String(b.read_on)) || Number(a.id) - Number(b.id));
    let previousDay = null;
    let consumption = 0;
    let variable = 0;
    for (const reading of valid) {
      const currentDay = reading.read_on;
      const delta = reading.delta_value;
      if (delta != null) {
        const intervalStart = previousDay ? addDays(previousDay, 1) : currentDay;
        const intervalDays = Math.max(1, daysBetween(intervalStart, currentDay) + 1);
        const dailyUsage = Number(delta) / intervalDays;
        const crossesReportBoundary = Boolean(start && intervalDays > 62 && intervalStart < start && start <= currentDay);
        for (let cursor = intervalStart; cursor <= currentDay; cursor = addDays(cursor, 1)) {
          if ((!start || cursor >= start) && (!end || cursor <= end)) {
            const tariff = activeTariff(tariffMetric, cursor);
            if (!crossesReportBoundary) consumption += dailyUsage;
            const crossesTariffBoundary = Boolean(tariff && intervalDays > 62 && intervalStart < tariff.valid_from && tariff.valid_from <= currentDay);
            if (tariff && !crossesReportBoundary && !crossesTariffBoundary) variable += dailyUsage * Number(tariff.kwh_per_unit) * Number(tariff.price_per_kwh);
          }
        }
      }
      previousDay = currentDay;
    }
    return { consumption, variable };
  };
  const financesFor = (metric, start = null, end = null) => {
    const usage = allocatedUsage(metric, start, end);
    let baseFee = 0;
    let advance = 0;
    for (const tariff of tariffs.filter(item => item.metric === metric).sort((a, b) => String(a.valid_from).localeCompare(String(b.valid_from)) || Number(a.id) - Number(b.id))) {
      const periodStart = [tariff.valid_from, start].filter(Boolean).sort().at(-1);
      const periodEnd = [tariff.valid_to, end, today].filter(Boolean).sort()[0];
      if (periodEnd < periodStart) continue;
      const months = proratedMonths(periodStart, periodEnd);
      baseFee += months * Number(tariff.base_fee_monthly ?? 0);
      advance += months * Number(tariff.advance_monthly ?? 0);
    }
    const cost = usage.variable + baseFee;
    return { variable: usage.variable, baseFee, cost, advance, balance: advance - cost, consumption: usage.consumption };
  };
  const forecastFor = metric => {
    const valid = readings.filter(item => item.metric === metric && Number(item.is_valid ?? 1) !== 0).sort((a, b) => String(a.read_on).localeCompare(String(b.read_on)) || Number(a.id) - Number(b.id));
    const latest = valid.at(-1);
    if (!latest) return null;
    const tariff = activeTariff(metric, latest.read_on);
    if (!tariff?.valid_to) return null;
    const currentUsage = allocatedUsage(metric, tariff.valid_from, latest.read_on);
    if (currentUsage.consumption <= 0) return null;
    const observedStart = tariff.valid_from > valid[0].read_on ? tariff.valid_from : valid[0].read_on;
    const observedDays = Math.max(1, daysBetween(observedStart, latest.read_on));
    const remainingDays = Math.max(0, daysBetween(latest.read_on, tariff.valid_to));
    const projectedConsumption = currentUsage.consumption + currentUsage.consumption / observedDays * remainingDays;
    const projectedVariable = projectedConsumption * Number(tariff.price_per_kwh) * Number(tariff.kwh_per_unit);
    const projectedBase = proratedMonths(tariff.valid_from, tariff.valid_to) * Number(tariff.base_fee_monthly ?? 0);
    const projectedAdvance = proratedMonths(tariff.valid_from, tariff.valid_to) * Number(tariff.advance_monthly ?? 0);
    const projectedCost = projectedVariable + projectedBase;
    return { through: tariff.valid_to, cost: projectedCost, advance: projectedAdvance, balance: projectedAdvance - projectedCost };
  };
  const segments = definitions.map(([id, label, metric, fallbackUnit]) => {
    const history = readings.filter(item => item.metric === metric).sort((a, b) => String(b.read_on).localeCompare(String(a.read_on))).map(item => ({ id: item.id, date: item.read_on, total: Number(item.total_value), delta: item.delta_value == null ? null : Number(item.delta_value), unit: item.unit || fallbackUnit, source: item.source }));
    const contracts = tariffs.filter(item => item.metric === (metric === "pv_self" ? "grid_import" : metric)).sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from))).map(item => ({ id: Number(item.id), provider: item.provider || "Ohne Anbieter", validFrom: item.valid_from, validTo: item.valid_to || null, unitPrice: Number(item.price_per_kwh), unitPriceLabel: metric === "water" ? `${Number(item.price_per_kwh).toFixed(4)} €/m³` : `${(Number(item.price_per_kwh) * 100).toFixed(2)} Cent/kWh`, baseFeeMonthly: Number(item.base_fee_monthly || 0), advanceMonthly: Number(item.advance_monthly || 0), active: item.valid_from <= today && (!item.valid_to || item.valid_to >= today) }));
    const tariffMetric = metric === "pv_self" ? "grid_import" : metric;
    const monthFinance = id === "pv" ? null : financesFor(tariffMetric, monthStart, today);
    const yearFinance = id === "pv" ? null : financesFor(tariffMetric, yearStart, today);
    const monthSavings = id === "pv" ? allocatedUsage("pv_self", monthStart, today, "grid_import").variable : null;
    const yearSavings = id === "pv" ? allocatedUsage("pv_self", yearStart, today, "grid_import").variable : null;
    return { id, label, unit: history[0]?.unit || fallbackUnit, latest: history[0] ?? null, consumption: { month: allocatedUsage(metric, monthStart, today, tariffMetric).consumption, year: allocatedUsage(metric, yearStart, today, tariffMetric).consumption, total: allocatedUsage(metric, null, today, tariffMetric).consumption }, finances: { month: monthFinance, year: yearFinance }, forecast: yearFinance ? forecastFor(tariffMetric) : null, savings: id === "pv" ? { month: monthSavings, year: yearSavings } : undefined, contracts, history, invalidCount: readings.filter(item => item.metric === metric && Number(item.is_valid ?? 1) === 0).length };
  });
  return { version: backup.version ?? "0.4.4", generatedAt: backup.exported_at ?? new Date().toISOString(), period: { monthStart, yearStart }, segments, sourceUrl: energyLabUrl };
}

async function energyLabOverview() {
  if (!energyLabUrl) throw new Error("EnergieLab-Verbindung ist nicht konfiguriert");
  const headers = { accept: "application/json", ...basicAuthorization(energyLabUsername, energyLabPassword) };
  try {
    const payload = await fetchJson(`${energyLabUrl}/api/personallab`, headers);
    if (!Array.isArray(payload.segments)) throw new Error("EnergieLab liefert ungültige Integrationsdaten");
    return { ...payload, sourceUrl: energyLabUrl };
  } catch (error) {
    if (String(error).includes("404")) throw new Error("EnergyLab 0.4.5 mit PersonalLab-Schnittstelle wird benötigt");
    throw error;
  }
}

async function financeLabOverview() {
  if (!financeLabUrl) throw new Error("FinanzLab-Verbindung ist nicht konfiguriert");
  const householdPayload = await fetchJson(`${financeLabUrl}/api/households`, { accept: "application/json" });
  const households = householdPayload.items ?? [];
  const household = households.find(item => item.id === financeLabHouseholdId) ?? households[0];
  if (!household) throw new Error("In FinanzLab ist noch kein Haushalt angelegt");
  const today = new Date().toISOString().slice(0, 10);
  const query = `household_id=${encodeURIComponent(household.id)}&as_of=${today}`;
  const [dashboard, creditsPayload] = await Promise.all([
    fetchJson(`${financeLabUrl}/api/dashboard?${query}`, { accept: "application/json" }),
    fetchJson(`${financeLabUrl}/api/credits?${query}`, { accept: "application/json" }),
  ]);
  const credits = creditsPayload.items ?? [];
  const rates = credits.flatMap(credit => (credit.payments ?? [])
    .filter(payment => payment.date >= today && !payment.skipped && Number(payment.account_amount_cents ?? payment.planned_account_amount_cents ?? 0) > 0)
    .map(payment => ({
      id: `${credit.id}:${payment.id}`,
      creditId: credit.id,
      creditName: credit.name,
      creditType: credit.credit_type,
      date: payment.date,
      amountCents: Number(payment.account_amount_cents ?? payment.planned_account_amount_cents ?? 0),
      remainingAfterCents: Number(payment.remaining_after_cents ?? 0),
    })))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    version: "1",
    sourceUrl: financeLabUrl,
    generatedAt: new Date().toISOString(),
    household: { id: household.id, name: dashboard.household?.name ?? household.name ?? "Haushalt" },
    asOf: dashboard.as_of ?? today,
    metrics: dashboard.metrics ?? {},
    accounts: dashboard.household?.accounts ?? [],
    creditSummary: dashboard.credit_summary ?? creditsPayload,
    credits,
    rates,
    warnings: dashboard.overdraft_warnings ?? [],
  };
}

state = await initialState();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") return json(response, 200, { status: "ok", version: "1.5.0", documents: state.documents.length });
    const documentAsset = url.pathname.match(/^\/api\/documents\/(\d+)\/(thumbnail|preview)$/);
    if (request.method === "GET" && documentAsset) return proxyPaperlessDocument(response, documentAsset[1], documentAsset[2]);
    if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, { ...state, config: { paperless: Boolean(paperlessUrl && paperlessToken), paperlessUrl, analyzer: Boolean(analyzerUrl), analyzerUrl, homeAssistant: Boolean(haUrl && haToken), homeAssistantUrl: haUrl, energyLab: Boolean(energyLabUrl), financeLab: Boolean(financeLabUrl), autoSync, syncMinutes } });
    if (request.method === "PUT" && url.pathname === "/api/state") {
      const incoming = await bodyJson(request);
      if (!Array.isArray(incoming.areas) || !Array.isArray(incoming.documents)) return json(response, 400, { error: "Ungültige Daten" });
      state.areas = incoming.areas;
      state.documents = incoming.documents;
      if (Array.isArray(incoming.haSensors)) state.haSensors = incoming.haSensors;
      await persist();
      return json(response, 200, { status: "saved" });
    }
    if (request.method === "POST" && url.pathname === "/api/sync") {
      if (syncPromise) return json(response, 202, { status: "running" });
      startSync().catch(error => console.error("Paperless-Abgleich fehlgeschlagen:", error.message));
      return json(response, 202, { status: "started" });
    }
    if (request.method === "GET" && url.pathname === "/api/home-assistant/entities") return json(response, 200, { entities: await homeAssistantEntities() });
    if (request.method === "GET" && url.pathname === "/api/home-assistant/overview") return json(response, 200, { entities: await selectedHomeAssistantEntities(), selected: state.haSensors ?? [] });
    if (request.method === "GET" && url.pathname === "/api/integrations/energy") return json(response, 200, await energyLabOverview());
    if (request.method === "GET" && url.pathname === "/api/integrations/finance") return json(response, 200, await financeLabOverview());
    if (request.method === "PUT" && url.pathname === "/api/home-assistant/sensors") {
      const incoming = await bodyJson(request);
      if (!Array.isArray(incoming.entityIds)) return json(response, 400, { error: "entityIds fehlt" });
      state.haSensors = [...new Set(incoming.entityIds.map(String))];
      await persist();
      return json(response, 200, { status: "saved", haSensors: state.haSensors });
    }
    return json(response, 404, { error: "Nicht gefunden" });
  } catch (error) {
    console.error(error);
    return json(response, 500, { error: error instanceof Error ? error.message : "Unbekannter Fehler" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`PersonalLab API läuft auf Port ${port}`);
  if (syncOnStart && paperlessUrl && paperlessToken) startSync().catch(error => console.error("Startabgleich fehlgeschlagen:", error.message));
  if (autoSync && paperlessUrl && paperlessToken) setInterval(() => startSync().catch(error => console.error("Automatischer Abgleich fehlgeschlagen:", error.message)), syncMinutes * 60 * 1000).unref();
});

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, async () => { await saveChain; server.close(() => process.exit(0)); });

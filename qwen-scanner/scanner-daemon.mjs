import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const API_URL = String(
  process.env.PERSONALLAB_API_URL ?? "http://personal-lab-api:8095"
).replace(/\/$/, "");
const STATE_FILE = process.env.PERSONALLAB_STATE_FILE ?? "/data/personallab.json";
const COMBINED_FILE =
  process.env.PERSONALLAB_COMBINED_FILE ??
  "/config/assignment-lifecycle-report-v2.3.json";
const LIFECYCLE_FILE =
  process.env.PERSONALLAB_LIFECYCLE_FILE ??
  "/config/lifecycle-contract-v3.3.json";
const CONFIRMED_STATUSES_FILE =
  process.env.PERSONALLAB_CONFIRMED_STATUSES_FILE ??
  "/config/confirmed-object-statuses-v2.0.json";
const WORK_DIR = process.env.QWEN_SCANNER_WORK_DIR ?? "/data/qwen-scanner";
const TRACKER_FILE = path.join(WORK_DIR, "tracker-v2.json");
const PROCESSED_STATE_FILE =
  process.env.QWEN_SCANNER_PROCESSED_STATE_FILE ??
  path.join(WORK_DIR, "processed-state.json");
const MAX_ERROR_ATTEMPTS = Math.max(
  1,
  Number(process.env.QWEN_SCANNER_MAX_ERROR_ATTEMPTS ?? 3)
);
const STATUS_FILE = path.join(WORK_DIR, "status.json");
const INTERVAL_SECONDS = Math.max(
  30,
  Number(process.env.QWEN_SCANNER_INTERVAL_SECONDS ?? 300)
);
const RETRY_SECONDS = Math.max(
  30,
  Number(process.env.QWEN_SCANNER_RETRY_SECONDS ?? 120)
);
const BATCH_SIZE = Math.max(
  1,
  Number(process.env.QWEN_SCANNER_BATCH_SIZE ?? 10)
);
const RELEVANT_FROM = process.env.QWEN_RELEVANT_FROM ?? "2019-01-01";
const APPLY = process.env.QWEN_SCANNER_APPLY === "1";
const FIRST_START = process.env.QWEN_SCANNER_FIRST_START ?? "scan-all-v2";
const ONCE = process.env.QWEN_SCANNER_ONCE === "1";

function emptyProcessedState() {
  return {
    version: "personallab-qwen-scanner-processed-v1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    done: {},
    failed: {}
  };
}

function loadProcessedState() {
  if (!fs.existsSync(PROCESSED_STATE_FILE)) return emptyProcessedState();

  try {
    const value = JSON.parse(fs.readFileSync(PROCESSED_STATE_FILE, "utf8"));
    value.done ??= {};
    value.failed ??= {};
    return value;
  } catch (error) {
    console.warn(`Processed-State konnte nicht gelesen werden: ${error.message}`);
    return emptyProcessedState();
  }
}

function saveProcessedState(state) {
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(PROCESSED_STATE_FILE), { recursive: true });
  fs.writeFileSync(PROCESSED_STATE_FILE, JSON.stringify(state, null, 2));
}

function markProcessedDone(state, document, meta = {}) {
  if (!document || document.id == null) return;

  const key = String(document.id);
  state.done[key] = {
    id: Number(document.id),
    title: document.title ?? "",
    status: "done",
    analyzedAt: new Date().toISOString(),
    scannerVersion: "personallab-qwen-scanner-v2.2.0",
    documentHash: meta.documentHash ?? "",
    run: meta.run ?? "",
    reportFile: meta.reportFile ?? "",
    changed: Boolean((meta.appliedFields ?? 0) || (meta.appliedStructure ?? 0))
  };

  delete state.failed[key];
}

function markProcessedFailed(state, item, errorText = "") {
  if (!item || item.id == null) return;

  const key = String(item.id);
  if (state.done[key]) return;

  const previous = state.failed[key] ?? {};
  state.failed[key] = {
    id: Number(item.id),
    title: item.title ?? previous.title ?? "",
    status: "failed",
    attempts: Number(previous.attempts ?? 0) + 1,
    lastError: String(errorText || item.error || "unknown error"),
    lastAttemptAt: new Date().toISOString()
  };
}

function syncProcessedStateFromReports(state) {
  const runsDir = path.join(WORK_DIR, "runs");
  if (!fs.existsSync(runsDir)) return;

  for (const name of fs.readdirSync(runsDir)) {
    const reportFile = path.join(runsDir, name, "qwen-report.json");
    if (!fs.existsSync(reportFile)) continue;

    let report;
    try {
      report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    } catch {
      continue;
    }

    for (const item of report.results ?? []) {
      if (!item || item.id == null) continue;

      const isFailed =
        item.error ||
        item.failed === true ||
        item.ok === false ||
        item.status === "failed";

      if (isFailed) {
        markProcessedFailed(state, item, item.error || item.status || "failed");
      } else {
        const key = String(item.id);
        if (!state.done[key]) {
          state.done[key] = {
            id: Number(item.id),
            title: item.title ?? "",
            status: "done",
            analyzedAt: report.updatedAt ?? report.createdAt ?? new Date().toISOString(),
            scannerVersion: report.version ?? "qwen-shadow",
            documentHash: "",
            run: name,
            reportFile,
            changed: false,
            importedFromReport: true
          };
          delete state.failed[key];
        }
      }
    }
  }
}


const sleep = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));
const sha256 = value =>
  crypto.createHash("sha256").update(value).digest("hex");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const writeAtomic = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, value, "utf8");
  fs.renameSync(temporary, file);
};
const writeJson = (file, value) =>
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const documentHash = document => sha256(JSON.stringify(document));
const isContractDocument = document =>
  document?.area === "contracts" ||
  /vertrag|police|abonnement|mitgliedschaft|tarif/i.test(
    `${document?.title ?? ""} ${document?.type ?? ""}`
  );
const authoritativeContractStatus = (document, now = new Date()) => {
  if (!isContractDocument(document)) return null;
  if (document.contractStatusManual && document.contractStatus) {
    return document.contractStatus;
  }
  const end = String(document.contractEnd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return document.contractStatus === "inactive" ? "inactive" : "unknown";
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(`${end}T00:00:00`);
  const remainingDays = Math.ceil(
    (endDate.getTime() - today.getTime()) / 86_400_000
  );
  if (remainingDays < 0 && !document.autoRenew) return "inactive";
  if (remainingDays <= 90) return "expiring";
  return "active";
};
const relevant = document => {
  const raw = String(document.date ?? "").trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : raw.replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, "$3-$2-$1");
  return iso >= RELEVANT_FROM;
};
const updateStatus = values => {
  const previous = fs.existsSync(STATUS_FILE) ? readJson(STATUS_FILE) : {};
  writeJson(STATUS_FILE, {
    version: "personallab-qwen-scanner-v2.0.0",
    ...previous,
    ...values,
    updatedAt: new Date().toISOString()
  });
};

const apiState = async () => {
  const response = await fetch(`${API_URL}/api/state`, { cache: "no-store" });
  if (!response.ok) throw new Error(`PersonalLab GET fehlgeschlagen: ${response.status}`);
  const value = await response.json();
  if (!Array.isArray(value.areas) || !Array.isArray(value.documents)) {
    throw new Error("PersonalLab lieferte keinen gültigen Zustand.");
  }
  return value;
};

const putState = async state => {
  const payload = {
    areas: state.areas,
    documents: state.documents,
    correspondents: state.correspondents,
    pageLayouts: state.pageLayouts,
    financeAccountAssignments: state.financeAccountAssignments,
    financeDataSelections: state.financeDataSelections,
    energyProviderAssignments: state.energyProviderAssignments,
    energyMetricSelections: state.energyMetricSelections,
    haSensors: state.haSensors,
    revision: state.revision
  };
  const response = await fetch(`${API_URL}/api/state`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(value.error || `PersonalLab PUT fehlgeschlagen: ${response.status}`);
  }
  return value;
};

const runNode = (script, arguments_, environment = {}) => {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...arguments_], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${script} endete mit Status ${result.status}`);
  }
};

const verifyConfig = () => {
  for (const file of [COMBINED_FILE, LIFECYCLE_FILE, CONFIRMED_STATUSES_FILE]) {
    if (!fs.existsSync(file)) throw new Error(`Konfigurationsdatei fehlt: ${file}`);
    JSON.parse(fs.readFileSync(file, "utf8"));
  }
};

const nodeByUid = areas => {
  const result = new Map();
  const walk = node => {
    if (node.uid) result.set(node.uid, node);
    for (const child of node.children ?? []) walk(child);
  };
  for (const area of areas ?? []) {
    for (const root of area.subareas ?? []) walk(root);
  }
  return result;
};

const backupStateFile = label => {
  const backupDir = path.join(WORK_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(STATE_FILE)) {
    fs.copyFileSync(STATE_FILE, path.join(backupDir, `personallab-before-${label}.json`));
  }
};

const reconcileConfirmedStatuses = async state => {
  const config = readJson(CONFIRMED_STATUSES_FILE);
  const candidate = JSON.parse(JSON.stringify(state));
  const nodes = nodeByUid(candidate.areas);
  const changes = [];

  for (const object of config.objects ?? []) {
    const node = nodes.get(object.uid);
    if (!node) throw new Error(`Bestätigtes Objekt fehlt in PersonalLab: ${object.uid}`);
    for (const field of ["name", "hint"]) {
      if (node[field] === object[field]) continue;
      changes.push({ uid: object.uid, field, before: node[field] ?? "", after: object[field] });
      node[field] = object[field];
    }
  }

  if (!changes.length) return state;
  const latest = await apiState();
  if (latest.revision !== state.revision) {
    throw new Error("PersonalLab änderte sich während des Statusabgleichs; Wiederholung folgt.");
  }
  const cycle = `confirmed-status-${stamp()}`;
  backupStateFile(cycle);
  candidate.revision = state.revision;
  await putState(candidate);
  const verified = await apiState();
  const verifiedNodes = nodeByUid(verified.areas);
  for (const object of config.objects ?? []) {
    const node = verifiedNodes.get(object.uid);
    if (node?.name !== object.name || node?.hint !== object.hint) {
      throw new Error(`Bestätigter Status wurde nicht gespeichert: ${object.uid}`);
    }
  }
  writeJson(path.join(WORK_DIR, "audits", `${cycle}.json`), {
    version: "personallab-qwen-scanner-v2.0.0",
    type: "confirmed-object-statuses",
    createdAt: new Date().toISOString(),
    previousRevision: state.revision,
    currentRevision: verified.revision,
    changes
  });
  return verified;
};

fs.mkdirSync(WORK_DIR, { recursive: true });
verifyConfig();

console.log("=== PersonalLab Qwen Scanner V2.1.0 ===");
console.log(`API: ${API_URL}`);
console.log(`Intervall: ${INTERVAL_SECONDS} Sekunden`);
console.log(`Batch: ${BATCH_SIZE}`);
console.log(`Echtbetrieb: ${APPLY ? "JA" : "NEIN"}`);

while (true) {
  try {
    let state = await apiState();
    if (state.syncStatus === "running") {
      updateStatus({ state: "waiting-for-personallab-sync" });
      await sleep(30_000);
      continue;
    }

    state = await reconcileConfirmedStatuses(state);

    const eligible = state.documents.filter(relevant);
    if (!fs.existsSync(TRACKER_FILE) && FIRST_START === "baseline") {
      writeJson(TRACKER_FILE, {
        version: "personallab-qwen-scanner-v2.0.0",
        initializedAt: new Date().toISOString(),
        reviewPending: {},
        documents: Object.fromEntries(
          eligible.map(document => [String(document.id), documentHash(document)])
        )
      });
      updateStatus({
        state: "baseline-created",
        eligibleDocuments: eligible.length,
        queuedDocuments: 0,
        lastSuccessAt: new Date().toISOString()
      });
      console.log(`Baseline mit ${eligible.length} Dokumenten erstellt.`);
      if (ONCE) break;
      await sleep(INTERVAL_SECONDS * 1000);
      continue;
    }

    const tracker = fs.existsSync(TRACKER_FILE)
      ? readJson(TRACKER_FILE)
      : {
          version: "personallab-qwen-scanner-v2.0.0",
          documents: {},
          reviewPending: {}
        };
    tracker.reviewPending ??= {};
    const manualResolutions = eligible.filter(
      document =>
        tracker.reviewPending[String(document.id)] === true &&
        document.assignmentSource === "manual" &&
        document.area !== "review"
    );
    for (const document of manualResolutions) {
      tracker.documents[String(document.id)] = documentHash(document);
      delete tracker.reviewPending[String(document.id)];
    }
    if (manualResolutions.length) {
      tracker.updatedAt = new Date().toISOString();
      writeJson(TRACKER_FILE, tracker);
    }
    const processedState = loadProcessedState();
    syncProcessedStateFromReports(processedState);
    saveProcessedState(processedState);

    const queue = eligible
      .filter(document => {
        const key = String(document.id);
        const currentHash = documentHash(document);

        const done = processedState.done?.[key];
        if (done && (!done.documentHash || done.documentHash === currentHash)) {
          return false;
        }

        const failed = processedState.failed?.[key];
        if (failed && Number(failed.attempts ?? 0) >= MAX_ERROR_ATTEMPTS) {
          return false;
        }

        return tracker.documents?.[key] !== currentHash;
      })
      .slice(0, BATCH_SIZE);

    if (!queue.length) {
      updateStatus({
        state: "idle",
        eligibleDocuments: eligible.length,
        queuedDocuments: 0,
        manualResolutionsAccepted: manualResolutions.length,
        lastSuccessAt: new Date().toISOString()
      });
      if (ONCE) break;
      await sleep(INTERVAL_SECONDS * 1000);
      continue;
    }

    const cycle = stamp();
    const cycleDir = path.join(WORK_DIR, "runs", cycle);
    fs.mkdirSync(cycleDir, { recursive: true });
    const snapshotFile = path.join(cycleDir, "personallab-source.json");
    const reportFile = path.join(cycleDir, "qwen-report.json");
    const candidateFile = path.join(cycleDir, "personallab-candidate.json");
    const auditFile = path.join(cycleDir, "apply-audit.json");
    const liveFile = path.join(cycleDir, "personallab-live.json");
    const mergedFile = path.join(cycleDir, "personallab-merged.json");
    const commitAuditFile = path.join(cycleDir, "commit-audit.json");
    writeJson(snapshotFile, state);

    const ids = queue.map(document => Number(document.id));
    updateStatus({ state: "analyzing", queuedDocuments: ids.length, documentIds: ids });
    console.log(`Analysiere Dokumente: ${ids.join(", ")}`);

    runNode(
      "qwen-shadow-v1.5.mjs",
      [snapshotFile, COMBINED_FILE, LIFECYCLE_FILE, reportFile],
      {
        QWEN_SHADOW_IDS: ids.join(","),
        QWEN_SHADOW_RESET: "1",
        QWEN_SHADOW_HOURS: "12",
        QWEN_SHADOW_MAX: String(ids.length)
      }
    );

    const report = readJson(reportFile);
    if (
      Number(report.summary?.remaining ?? -1) !== 0 ||
      Number(report.summary?.errors ?? -1) !== 0 ||
      Number(report.summary?.successful ?? -1) !== ids.length
    ) {
      throw new Error("Qwen-Batch ist nicht vollständig und fehlerfrei.");
    }

    runNode("qwen-apply-v1.5.mjs", [
      snapshotFile,
      reportFile,
      COMBINED_FILE,
      candidateFile,
      auditFile
    ]);

    const latest = await apiState();
    writeJson(liveFile, latest);
    runNode("qwen-commit-v1.5.mjs", [
      liveFile,
      candidateFile,
      auditFile,
      mergedFile,
      commitAuditFile
    ]);


    function guardStringify(value) {
      try {
        return JSON.stringify(value ?? "");
      } catch {
        return String(value ?? "");
      }
    }

    function guardDocumentText(document) {
      return guardStringify({
        id: document.id,
        title: document.title,
        sourceTitle: document.sourceTitle,
        presentationTitle: document.presentationTitle,
        analysisSearchText: document.analysisSearchText,
        contractStatus: document.contractStatus,
        contractNumber: document.contractNumber,
        qwenContract: document.qwenContract,
        qwenLifecycle: document.qwenLifecycle,
        contract: document.contract
      }).toLowerCase();
    }

    function guardIsActive(document) {
      const status = String(document.contractStatus ?? "").toLowerCase();
      const lifecycle = String(document.qwenLifecycle?.action ?? "").toLowerCase();
      return status === "active" || lifecycle === "active";
    }

    function guardSetInactive(document, subject, reason) {
      const before = guardStringify({
        contractStatus: document.contractStatus,
        qwenLifecycle: document.qwenLifecycle
      });

      document.contractStatus = "inactive";

      const existingLifecycle =
        document.qwenLifecycle && typeof document.qwenLifecycle === "object"
          ? document.qwenLifecycle
          : {};

      document.qwenLifecycle = {
        ...existingLifecycle,
        version: existingLifecycle.version || "qwen-v1.5",
        action: "inactive",
        subjectType: "contract",
        subject,
        confidence: 1,
        reason: `MANUAL_GUARD: ${reason}`
      };

      const after = guardStringify({
        contractStatus: document.contractStatus,
        qwenLifecycle: document.qwenLifecycle
      });

      return before !== after;
    }

    function applyManualTruthGuards(state) {
      const notes = [];

      for (const document of state.documents ?? []) {
        const text = guardDocumentText(document);
        const active = guardIsActive(document);

        const isGolf =
          /\bgolf\b/.test(text) &&
          /(vertrag|kredit|leasing|finanzierung|bnp|paribas|sparkasse|abl[oö]sung|abloesung|ablöse)/.test(text);

        const isGolfSparkasseAblösung =
          /sparkasse/.test(text) &&
          /(abl[oö]sung|abloesung|ablöse)/.test(text);

        const isGolfBnp =
          /\bgolf\b/.test(text) &&
          /(bnp|paribas)/.test(text);

        if (isGolfBnp) {
          if (guardSetInactive(
            document,
            "Golf BNP-Paribas-Kreditvertrag",
            "Golf/BNP ist beendet; nur Sparkasse-Ablösung darf aktiv/relevant bleiben"
          )) {
            notes.push(`#${document.id} Golf/BNP -> inactive`);
          }
          continue;
        }

        if (isGolf && !isGolfSparkasseAblösung && active) {
          if (guardSetInactive(
            document,
            "Golf-Vertrag",
            "Golf-Verträge sind beendet; Ausnahme nur Sparkasse-Ablösung"
          )) {
            notes.push(`#${document.id} Golf -> inactive`);
          }
        }

        const isStrom =
          /(strom|netzanschluss|ten thüringer energienetze|ten thueringer energienetze|energieversorgung|elektrizit)/.test(text);

        const isCurrentStrom =
          /(21[.\-\/]09[.\-\/]2026|2026-09-21)/.test(text);

        if (isStrom && active && !isCurrentStrom) {
          if (guardSetInactive(
            document,
            "Stromvertrag / Netzanschluss alt",
            "Nur aktueller Stromvertrag ab 21.09.2026 ist aktiv; ältere Strom-/Netzanschluss-Verträge sind beendet"
          )) {
            notes.push(`#${document.id} Strom alt -> inactive`);
          }
        }
      }

      return {
        changed: notes.length,
        notes
      };
    }

    const commitAudit = readJson(commitAuditFile);
    const appliedFields = Number(commitAudit.summary?.appliedFieldChanges ?? 0);
    const appliedStructure = Number(commitAudit.summary?.appliedStructureChanges ?? 0);
    let finalState = latest;

    if ((appliedFields || appliedStructure) && APPLY) {
      const beforePut = await apiState();
      if (beforePut.revision !== latest.revision) {
        throw new Error("PersonalLab wurde während der Prüfung geändert; Batch wird wiederholt.");
      }

      backupStateFile(cycle);

      const merged = readJson(mergedFile);
      merged.revision = latest.revision;
      const guardSummary = applyManualTruthGuards(merged);
      if (guardSummary.changed) {
        console.log(`[MANUAL_GUARD] ${guardSummary.changed} Korrektur(en): ${guardSummary.notes.join(" | ")}`);
      }
      console.log(`[LIVE] Schreibe ${appliedFields} Feldänderungen und ${appliedStructure} Strukturänderungen direkt ins Echtsystem...`);
        await putState(merged);
        finalState = await apiState();
        console.log(`[LIVE] Echtsystem aktualisiert. Revision: ${latest.revision} -> ${finalState.revision}`);

      const finalById = new Map(
        finalState.documents.map(document => [Number(document.id), document])
      );
      const mergedById = new Map(
        merged.documents.map(document => [Number(document.id), document])
      );
      for (const id of ids) {
        const expected = mergedById.get(id);
        const actual = finalById.get(id);
        if (!expected || !actual) throw new Error(`Dokument ${id} fehlt nach PUT.`);
        for (const change of (readJson(auditFile).changes ?? []).filter(
          item => Number(item.id) === id
        )) {
          const normalizedContractStatus =
            change.field === "contractStatus" &&
            actual.contractStatus === authoritativeContractStatus(expected);
          if (
            JSON.stringify(expected[change.field]) !== JSON.stringify(actual[change.field]) &&
            !normalizedContractStatus
          ) {
            throw new Error(`Verifikation für Dokument ${id}, Feld ${change.field} fehlgeschlagen.`);
          }
        }
      }
      const applyAudit = readJson(auditFile);
      const finalAreaById = new Map(
        finalState.areas.map(area => [String(area.id), area])
      );
      const mergedAreaById = new Map(
        merged.areas.map(area => [String(area.id), area])
      );
      for (const areaId of Object.keys(applyAudit.sourceChangedAreas ?? {})) {
        if (
          JSON.stringify(finalAreaById.get(areaId)) !==
          JSON.stringify(mergedAreaById.get(areaId))
        ) {
          throw new Error(`Verifikation für Bereich ${areaId} fehlgeschlagen.`);
        }
      }
    }

    const finalById = new Map(
      finalState.documents.map(document => [Number(document.id), document])
    );
    for (const id of ids) {
      const finalDocument = finalById.get(id);
      if (!finalDocument) continue;
      tracker.documents[String(id)] = documentHash(finalDocument);
      markProcessedDone(processedState, finalDocument, {
        run: path.basename(cycleDir),
        reportFile,
        appliedFields,
        appliedStructure,
        documentHash: documentHash(finalDocument)
      });
      if (
        finalDocument.area === "review" &&
        finalDocument.tileId === "tile:review:needs-review" &&
        finalDocument.assignmentSource === "qwen-scanner"
      ) {
        tracker.reviewPending[String(id)] = true;
      } else {
        delete tracker.reviewPending[String(id)];
      }
    }
    tracker.updatedAt = new Date().toISOString();
    writeJson(TRACKER_FILE, tracker);
    saveProcessedState(processedState);
    updateStatus({
      state: APPLY ? "applied" : "candidate-only",
      queuedDocuments: 0,
      lastBatchDocumentIds: ids,
      lastBatchFieldChanges: appliedFields,
      lastBatchStructureChanges: appliedStructure,
      manualResolutionsAccepted: manualResolutions.length,
      lastSuccessAt: new Date().toISOString(),
      lastError: ""
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Scanner] ${message}`);
    updateStatus({ state: "error", lastError: message, lastErrorAt: new Date().toISOString() });
    if (ONCE) process.exit(1);
    await sleep(RETRY_SECONDS * 1000);
    continue;
  }

  if (ONCE) break;
  const latestForBacklog = await apiState();
  const trackerForBacklog = fs.existsSync(TRACKER_FILE)
    ? readJson(TRACKER_FILE)
    : { documents: {} };
  const backlog = latestForBacklog.documents
    .filter(relevant)
    .filter(
      document =>
        trackerForBacklog.documents?.[String(document.id)] !== documentHash(document)
    ).length;
  await sleep((backlog ? 1 : INTERVAL_SECONDS) * 1000);
}

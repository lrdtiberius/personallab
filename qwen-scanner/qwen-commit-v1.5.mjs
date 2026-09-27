import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [LIVE_FILE, CANDIDATE_FILE, AUDIT_FILE, OUTPUT_FILE, COMMIT_AUDIT_FILE] =
  process.argv.slice(2);

if (
  !LIVE_FILE ||
  !CANDIDATE_FILE ||
  !AUDIT_FILE ||
  !OUTPUT_FILE ||
  !COMMIT_AUDIT_FILE
) {
  console.error(
    "Aufruf: node qwen-commit-v1.5.mjs <live.json> <candidate.json> <audit.json> <merged.json> <commit-audit.json>"
  );
  process.exit(64);
}

const inputPaths = new Set(
  [LIVE_FILE, CANDIDATE_FILE, AUDIT_FILE].map(file => path.resolve(file))
);
for (const output of [OUTPUT_FILE, COMMIT_AUDIT_FILE]) {
  if (inputPaths.has(path.resolve(output))) {
    throw new Error(`Ausgabe darf keine Eingabe überschreiben: ${output}`);
  }
}

const sha256 = value =>
  crypto.createHash("sha256").update(value).digest("hex");
const read = file => fs.readFileSync(file, "utf8");
const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, text, "utf8");
  fs.renameSync(temporary, file);
};

const liveText = read(LIVE_FILE);
const candidateText = read(CANDIDATE_FILE);
const auditText = read(AUDIT_FILE);
const live = JSON.parse(liveText);
const candidate = JSON.parse(candidateText);
const audit = JSON.parse(auditText);

if (audit.version !== "qwen-apply-v1.5" || audit.dryRun !== true) {
  throw new Error("Ungültiges Apply-Audit.");
}
if (sha256(candidateText) !== audit.candidate?.sha256) {
  throw new Error("Kandidat stimmt nicht mit dem Apply-Audit überein.");
}
if (sha256(JSON.stringify(live.areas ?? [])) !== audit.sourceAreasSha256) {
  throw new Error("Die PersonalLab-Bereichsstruktur wurde seit der Analyse geändert.");
}

const liveById = new Map(
  (live.documents ?? []).map(document => [Number(document.id), document])
);
const candidateById = new Map(
  (candidate.documents ?? []).map(document => [Number(document.id), document])
);
const changedIds = Object.keys(audit.sourceChangedDocuments ?? {})
  .map(Number)
  .sort((a, b) => a - b);

for (const id of changedIds) {
  const current = liveById.get(id);
  const expectedHash = audit.sourceChangedDocuments[String(id)];
  if (!current || sha256(JSON.stringify(current)) !== expectedHash) {
    throw new Error(
      `Dokument ${id} wurde seit der Analyse geändert. Zusammenführung verweigert.`
    );
  }
  if (!candidateById.has(id)) {
    throw new Error(`Dokument ${id} fehlt im Kandidaten.`);
  }
}

const fieldsById = new Map();
for (const change of audit.changes ?? []) {
  const id = Number(change.id);
  if (!fieldsById.has(id)) fieldsById.set(id, new Set());
  fieldsById.get(id).add(String(change.field));
}

const merged = JSON.parse(JSON.stringify(live));
const mergedAreaById = new Map(
  (merged.areas ?? []).map(area => [String(area.id), area])
);
const candidateAreaById = new Map(
  (candidate.areas ?? []).map(area => [String(area.id), area])
);
const appliedStructure = [];

for (const [areaId, expectedHash] of Object.entries(audit.sourceChangedAreas ?? {})) {
  const current = mergedAreaById.get(areaId);
  const after = candidateAreaById.get(areaId);
  if (!current || !after) throw new Error(`Bereich ${areaId} fehlt bei der Zusammenführung.`);
  if (sha256(JSON.stringify(current)) !== expectedHash) {
    throw new Error(`Bereich ${areaId} wurde seit der Analyse geändert.`);
  }
  const index = merged.areas.findIndex(area => String(area.id) === areaId);
  merged.areas[index] = JSON.parse(JSON.stringify(after));
  appliedStructure.push({ areaId, before: current, after });
}

const mergedById = new Map(
  merged.documents.map(document => [Number(document.id), document])
);
const applied = [];

for (const [id, fields] of fieldsById) {
  const target = mergedById.get(id);
  const source = candidateById.get(id);
  if (!target || !source) {
    throw new Error(`Dokument ${id} kann nicht zusammengeführt werden.`);
  }
  for (const field of fields) {
    const before = target[field];
    const after = source[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (after === undefined) {
      delete target[field];
    } else {
      target[field] = JSON.parse(JSON.stringify(after));
    }
    applied.push({ id, field, before, after });
  }
}

if (applied.length || appliedStructure.length) merged.revision = crypto.randomUUID();

const mergedText = `${JSON.stringify(merged, null, 2)}\n`;
const commitAudit = {
  version: "qwen-commit-v1.5",
  dryRun: true,
  createdAt: new Date().toISOString(),
  source: {
    liveFileSha256: sha256(liveText),
    liveRevision: live.revision ?? "",
    candidateFileSha256: sha256(candidateText),
    applyAuditFileSha256: sha256(auditText)
  },
  output: {
    file: path.resolve(OUTPUT_FILE),
    sha256: sha256(mergedText),
    revision: merged.revision ?? ""
  },
  summary: {
    liveDocuments: live.documents?.length ?? 0,
    analyzedDocumentsChanged: changedIds.length,
    appliedFieldChanges: applied.length,
    appliedStructureChanges: appliedStructure.length,
    preservedLiveDocuments: (live.documents?.length ?? 0) - changedIds.length
  },
  applied,
  appliedStructure
};

writeAtomic(OUTPUT_FILE, mergedText);
writeAtomic(COMMIT_AUDIT_FILE, `${JSON.stringify(commitAudit, null, 2)}\n`);

console.log("=== PersonalLab Qwen Commit V1.5 — Zusammenführung ===");
console.log(`Live-Dokumente: ${commitAudit.summary.liveDocuments}`);
console.log(`Geänderte analysierte Dokumente: ${changedIds.length}`);
console.log(`Übernommene Feldänderungen: ${applied.length}`);
console.log(`Übernommene Strukturänderungen: ${appliedStructure.length}`);
console.log(`Ausgabe: ${path.resolve(OUTPUT_FILE)}`);
console.log("Die aktive personallab.json wurde NICHT verändert.");

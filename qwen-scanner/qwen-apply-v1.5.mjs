import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [
  STATE_FILE,
  REPORT_FILE,
  COMBINED_FILE,
  CANDIDATE_FILE,
  AUDIT_FILE
] = process.argv.slice(2);

if (
  !STATE_FILE ||
  !REPORT_FILE ||
  !COMBINED_FILE ||
  !CANDIDATE_FILE ||
  !AUDIT_FILE
) {
  console.error(
    "Aufruf: node qwen-apply-v1.5.mjs <personallab.json> <qwen-report.json> <assignment-report.json> <candidate.json> <audit.json>"
  );
  process.exit(64);
}

const resolvedInputs = new Set(
  [STATE_FILE, REPORT_FILE, COMBINED_FILE].map(file =>
    path.resolve(file)
  )
);

for (const output of [CANDIDATE_FILE, AUDIT_FILE]) {
  if (resolvedInputs.has(path.resolve(output))) {
    throw new Error(
      `Sicherheitsabbruch: Ausgabe darf keine Eingabe überschreiben: ${output}`
    );
  }
}

const readText = file => fs.readFileSync(file, "utf8");
const sha256 = value =>
  crypto.createHash("sha256").update(value).digest("hex");
const stateContentSha256 = stateValue => {
  const volatileKeys = new Set([
    "lastSync",
    "syncStatus",
    "syncError",
    "syncWarning",
    "revision"
  ]);
  return sha256(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(stateValue).filter(([key]) => !volatileKeys.has(key))
      )
    )
  );
};
const clone = value => JSON.parse(JSON.stringify(value));
const normalize = value =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const finiteConfidence = value => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(1, number))
    : 0;
};
const threshold = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
};
const parseStructured = document => {
  try {
    const parsed = JSON.parse(document.analysisSearchText ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};
const analyzerSemanticText = document =>
  normalize(
    [
      document.analysisSummary,
      document.presentationSummary,
      ...(document.analysisKeywords ?? []),
      document.analysisSearchText
    ]
      .filter(Boolean)
      .join(" ")
  );
const orderWithoutActivation = document => {
  const orderText = normalize(
    [document.title, document.sourceTitle, analyzerSemanticText(document)]
      .filter(Boolean)
      .join(" ")
  );
  const analyzerText = analyzerSemanticText(document);
  const hasOrder =
    /\bauftrag\b|auftragsbestatigung|auftragsbestaetigung|\bbestellung\b|bestellubersicht|bestelluebersicht/.test(
      orderText
    );
  const explicitlyNotCompleted =
    /nicht (?:angegeben|bekannt|erfolgt|bereitgestellt|aktiviert|geschaltet)|noch nicht|voraussichtlich|geplant|planung|soll (?:bereitgestellt|aktiviert|geschaltet|in betrieb genommen) werden|wird (?:bereitgestellt|aktiviert|geschaltet|in betrieb genommen)|vor (?:dem )?bereitstellungstermin/.test(
      analyzerText
    );
  const explicitActivation =
    !explicitlyNotCompleted &&
    /bereitstellung (?:ist )?erfolgt|erfolgreich bereitgestellt|wurde bereitgestellt|aktivierung (?:ist )?erfolgt|erfolgreich aktiviert|wurde aktiviert|schaltung (?:ist )?erfolgt|erfolgreich geschaltet|wurde geschaltet|inbetriebnahme (?:ist )?erfolgt|erfolgreich in betrieb genommen|wurde in betrieb genommen|anschluss ist (?:aktiv|betriebsbereit)|dienst ist (?:aktiv|nutzbar)/.test(
      analyzerText
    );
  return hasOrder && !explicitActivation;
};
const isoDate = value => {
  const raw = String(value ?? "").trim();
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const german = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (german) {
      match = [
        raw,
        german[3],
        german[2].padStart(2, "0"),
        german[1].padStart(2, "0")
      ];
    }
  }
  if (!match) return "";
  const result = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${result}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== result
    ? ""
    : result;
};
const compactObject = value =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) =>
      item !== "" && item !== null && item !== undefined
    )
  );

const stateText = readText(STATE_FILE);
const reportText = readText(REPORT_FILE);
const combinedText = readText(COMBINED_FILE);
const state = JSON.parse(stateText);
const report = JSON.parse(reportText);
const combined = JSON.parse(combinedText);
const candidate = clone(state);

if (report.version !== "qwen-shadow-v1.5" || report.dryRun !== true) {
  throw new Error("Kein gültiger Qwen-Shadow-V1.5-Report.");
}

if (!Array.isArray(report.results)) {
  throw new Error("Qwen-Report enthält keine Ergebnisliste.");
}

const testMode = process.env.QWEN_APPLY_TEST_MODE === "1";
const stateHash = sha256(stateText);
const stateContentHash = stateContentSha256(state);
const combinedHash = sha256(combinedText);

if (!testMode) {
  if (!report.source) {
    throw new Error(
      "Der Report ist nicht an einen Quellstand gebunden. Echtlauf verweigert."
    );
  }
  if (report.source.stateContentSha256 !== stateContentHash) {
    throw new Error(
      "Der Produktionsstand weicht vom analysierten Stand ab. Echtlauf verweigert."
    );
  }
  if (report.source.combinedFileSha256 !== combinedHash) {
    throw new Error(
      "Der Zuordnungsreport weicht vom analysierten Stand ab. Echtlauf verweigert."
    );
  }
  if (
    Number(report.summary?.remaining ?? -1) !== 0 ||
    Number(report.summary?.errors ?? -1) !== 0 ||
    Number(report.summary?.successful ?? -1) !== report.results.length
  ) {
    throw new Error(
      "Der Qwen-Lauf ist nicht vollständig und fehlerfrei. Echtlauf verweigert."
    );
  }
  if (
    Number(report.source.eligibleDocumentCount ?? -1) !==
    report.results.length
  ) {
    throw new Error(
      "Die Zahl der analysierten Dokumente passt nicht zum gebundenen Quellstand."
    );
  }
}

const resultIds = report.results.map(item => Number(item.id));
if (new Set(resultIds).size !== resultIds.length) {
  throw new Error("Der Qwen-Report enthält doppelte Dokument-IDs.");
}

const policy = {
  primaryConfidence: threshold("QWEN_APPLY_PRIMARY_CONFIDENCE", 0.9),
  relationConfidence: threshold("QWEN_APPLY_RELATION_CONFIDENCE", 0.9),
  contractConfidence: threshold("QWEN_APPLY_CONTRACT_CONFIDENCE", 0.9),
  houseBuildConfidence: threshold("QWEN_APPLY_HOUSE_CONFIDENCE", 0.9),
  lifecycleConfidence: threshold("QWEN_APPLY_LIFECYCLE_CONFIDENCE", 0.9),
  preserveManualContractStatus: true,
  neverOverwriteNonemptyContractDetails: true
};

const documentById = new Map(
  candidate.documents.map(document => [Number(document.id), document])
);
const combinedById = new Map(
  (combined.results ?? []).map(item => [Number(item.id), item])
);

const pathByUid = new Map();
const nodeByPath = new Map();
const houseBuildByName = new Map();

for (const area of candidate.areas ?? []) {
  const walk = (node, top, names, insideHouseBuild) => {
    const pathNames = [...names, node.name];
    const pathText = pathNames.join(" / ");
    const entry = {
      areaId: area.id,
      subareaId: top.id,
      tileId: node.uid,
      path: pathText,
      name: node.name
    };
    if (node.uid) pathByUid.set(node.uid, entry);
    nodeByPath.set(normalize(pathText), entry);

    const nowInsideHouseBuild =
      insideHouseBuild ||
      normalize(node.name).includes("hausbau") ||
      normalize(node.id).includes("construction");
    if (insideHouseBuild && node.uid) {
      houseBuildByName.set(normalize(node.name), entry);
    }
    for (const child of node.children ?? []) {
      walk(child, top, pathNames, nowInsideHouseBuild);
    }
  };

  for (const root of area.subareas ?? []) {
    walk(root, root, [area.name], false);
  }
}

const changedIds = new Set();
const changes = [];
const deferred = [];
const autoResolvedNoChange = [];
const reviewRequiredIds = new Set();
const reviewPlacedIds = new Set();
const decisionCounts = {
  primaryAccepted: 0,
  relationsAccepted: 0,
  contractsAccepted: 0,
  houseBuildAccepted: 0,
  lifecycleAccepted: 0
};

const structureChanges = [];
const changedAreaIds = new Set();

const recordChange = (document, type, field, before, after, decision) => {
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  document[field] = after;
  changedIds.add(Number(document.id));
  changes.push(
    compactObject({
      id: Number(document.id),
      title: document.title,
      type,
      field,
      before,
      after,
      confidence: finiteConfidence(decision?.confidence),
      reason: decision?.reason ?? ""
    })
  );
  return true;
};

const recordDeferred = (item, area, decision, reason) => {
  reviewRequiredIds.add(Number(item.id));
  deferred.push(
    compactObject({
      id: Number(item.id),
      title: item.title,
      area,
      action: decision?.action ?? decision?.decision ?? "",
      confidence: finiteConfidence(decision?.confidence),
      reason
    })
  );
};

const recordNoChange = (item, area, decision, reason) => {
  autoResolvedNoChange.push(
    compactObject({
      id: Number(item.id),
      title: item.title,
      area,
      action: decision?.action ?? decision?.decision ?? "",
      confidence: finiteConfidence(decision?.confidence),
      resolution: "keep_existing",
      reason
    })
  );
};

const manualPrimaryProtected = document =>
  document.assignmentSource === "manual" && document.area !== "review";

const findNodeByUid = uid => {
  for (const area of candidate.areas ?? []) {
    const stack = [...(area.subareas ?? [])];
    while (stack.length) {
      const node = stack.shift();
      if (node.uid === uid) return { area, node };
      stack.push(...(node.children ?? []));
    }
  }
  return null;
};

const projectLifecycleToStructure = (document, lifecycle) => {
  let area;
  let node;
  let label;
  let statusText;
  let type;
  const date = isoDate(lifecycle.effectiveDate || document.date);

  if (
    document.area === "vehicle" &&
    lifecycle.subjectType === "vehicle" &&
    ["sold", "inactive"].includes(lifecycle.action)
  ) {
    area = candidate.areas.find(item => item.id === "vehicle");
    node = area?.subareas?.find(item => item.id === document.subarea);
    label = "INAKTIV";
    statusText = date ? `inaktiv seit ${date}` : "inaktiv";
    type = "vehicleLifecycle";
  } else if (
    lifecycle.subjectType === "house_build" &&
    lifecycle.action === "completed"
  ) {
    const target = findNodeByUid("tile:living:construction");
    area = target?.area;
    node = target?.node;
    label = "ABGESCHLOSSEN";
    statusText = date ? `abgeschlossen seit ${date}` : "abgeschlossen";
    type = "houseBuildLifecycle";
  } else {
    return false;
  }

  if (!area || !node) return false;
  const before = { name: node.name, hint: node.hint ?? "" };
  const baseName = String(node.name ?? "")
    .replace(/\s*\[(?:INAKTIV|VERKAUFT|AKTIV|ABGESCHLOSSEN)\]\s*$/i, "")
    .trim();
  const hintParts = String(node.hint ?? "")
    .split("·")
    .map(item => item.trim())
    .filter(Boolean)
    .filter(item => !/^(?:inaktiv|abgeschlossen)(?: seit)?\b/i.test(item));
  const after = {
    name: `${baseName} [${label}]`,
    hint: [...hintParts, statusText].join(" · ")
  };

  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  node.name = after.name;
  node.hint = after.hint;
  changedAreaIds.add(area.id);
  structureChanges.push({
    areaId: area.id,
    nodeId: node.id,
    nodeUid: node.uid,
    type,
    before,
    after,
    sourceDocumentId: Number(document.id),
    confidence: finiteConfidence(lifecycle.confidence),
    reason: lifecycle.reason ?? ""
  });
  return true;
};

const addSecondary = (document, uid, decision, type) => {
  if (!pathByUid.has(uid)) return false;
  const before = Array.isArray(document.secondaryTileIds)
    ? [...document.secondaryTileIds]
    : [];
  const after = [...new Set([...before, uid])];
  return recordChange(
    document,
    type,
    "secondaryTileIds",
    before,
    after,
    decision
  );
};

const removeSecondary = (document, uid, decision, type) => {
  const before = Array.isArray(document.secondaryTileIds)
    ? [...document.secondaryTileIds]
    : [];
  const after = before.filter(value => value !== uid);
  return recordChange(
    document,
    type,
    "secondaryTileIds",
    before,
    after,
    decision
  );
};

for (const item of report.results) {
  if (!item.result) {
    if (!testMode) {
      throw new Error(`Dokument ${item.id} hat kein gültiges Ergebnis.`);
    }
    continue;
  }

  const document = documentById.get(Number(item.id));
  let combinedItem = combinedById.get(Number(item.id));
  if (!document) {
    if (!testMode) {
      throw new Error(`Dokument ${item.id} fehlt im Quellstand.`);
    }
    continue;
  }

  if (!combinedItem) {
    const currentTarget = pathByUid.get(document.tileId);
    combinedItem = {
      id: Number(document.id),
      title: document.title,
      currentPrimaryPath: currentTarget?.path ?? "",
      primary: currentTarget
        ? {
            target: currentTarget.tileId,
            targetPath: currentTarget.path
          }
        : null,
      secondary: (document.secondaryTileIds ?? [])
        .map(uid => pathByUid.get(uid))
        .filter(Boolean)
        .map(target => ({
          target: target.tileId,
          targetPath: target.path,
          alreadyPresent: true
        })),
      cases: []
    };
  }

  const primary = item.result.primary ?? {};
  if (primary.decision === "uncertain") {
    if (manualPrimaryProtected(document)) {
      recordNoChange(
        item,
        "primary",
        primary,
        "Manuelle Zuordnung bleibt maßgeblich"
      );
    } else {
      recordDeferred(item, "primary", primary, "Primärzuordnung ist nicht eindeutig");
    }
  } else if (primary.decision === "accept_rule") {
    if (finiteConfidence(primary.confidence) < policy.primaryConfidence) {
      recordDeferred(item, "primary", primary, "Konfidenz unter Grenzwert");
    } else {
      const selected = (item.input?.primaryCandidates ?? []).find(
        entry => entry.id === primary.candidate
      );
      const expectedPath = String(combinedItem.primary?.targetPath ?? "");
      const target = nodeByPath.get(normalize(selected?.path));
      if (!selected || !target || normalize(selected.path) !== normalize(expectedPath)) {
        recordDeferred(item, "primary", primary, "Regelziel ist nicht eindeutig auflösbar");
      } else if (
        manualPrimaryProtected(document) &&
        target.tileId !== document.tileId
      ) {
        recordNoChange(
          item,
          "primary",
          primary,
          "Manuelle Zuordnung wird vom Dauer-Scanner nicht überschrieben"
        );
      } else {
        decisionCounts.primaryAccepted++;
        recordChange(document, "primary", "area", document.area, target.areaId, primary);
        recordChange(document, "primary", "subarea", document.subarea, target.subareaId, primary);
        recordChange(document, "primary", "tileId", document.tileId, target.tileId, primary);
      }
    }
  }

  const applyRelations = (kind, decisions, candidates, prefix) => {
    for (const relation of decisions ?? []) {
      const index = Number(String(relation.id ?? "").replace(prefix, "")) - 1;
      const source = candidates?.[index];
      if (!source) {
        recordNoChange(item, kind, relation, "Kandidat fehlt; bestehender Stand bleibt erhalten");
        continue;
      }
      if (finiteConfidence(relation.confidence) < policy.relationConfidence) {
        recordNoChange(item, kind, relation, "Konfidenz unter Grenzwert; bestehender Stand bleibt erhalten");
        continue;
      }
      if (!source.target || !pathByUid.has(source.target)) {
        recordNoChange(item, kind, relation, "Kein vorhandenes PersonalLab-Ziel; bestehender Stand bleibt erhalten");
        continue;
      }
      if (relation.decision === "keep") {
        decisionCounts.relationsAccepted++;
        addSecondary(document, source.target, relation, kind);
      } else if (relation.decision === "drop") {
        decisionCounts.relationsAccepted++;
        removeSecondary(document, source.target, relation, kind);
      }
    }
  };

  applyRelations("secondary", item.result.secondary, combinedItem.secondary, "S");
  applyRelations("case", item.result.cases, combinedItem.cases, "C");

  const contract = item.result.contract ?? {};
  const acceptedContractActions = new Set(["attach", "new", "transition"]);
  if (acceptedContractActions.has(contract.action)) {
    if (finiteConfidence(contract.confidence) < policy.contractConfidence) {
      recordDeferred(item, "contract", contract, "Konfidenz unter Grenzwert");
    } else {
      decisionCounts.contractsAccepted++;
      const structuredContract = parseStructured(document).contract ?? {};
      const selectedCandidate = (item.input?.contractCandidates ?? []).find(
        entry => entry.key === contract.candidateKey
      );
      const suppressContractDates = orderWithoutActivation(document);
      const details = {
        contractNumber:
          selectedCandidate?.contractNumber ??
          structuredContract.contract_number ??
          "",
        contractStart: suppressContractDates
          ? ""
          : isoDate(
              selectedCandidate?.start ?? structuredContract.start_date
            ),
        contractEnd: suppressContractDates
          ? ""
          : isoDate(
              selectedCandidate?.end ?? structuredContract.end_date
            )
      };
      for (const [field, value] of Object.entries(details)) {
        if (value && !document[field]) {
          recordChange(document, "contract", field, document[field], value, contract);
        }
      }
      if (
        contract.action === "transition" &&
        details.contractEnd &&
        !document.cancellationDeadline
      ) {
        recordChange(
          document,
          "contract",
          "cancellationDeadline",
          document.cancellationDeadline,
          details.contractEnd,
          contract
        );
      }
      const cancellationInfo = String(
        structuredContract.cancellation_info ?? ""
      );
      if (
        document.autoRenew == null &&
        /verlaengert|verlängert|stillschweigend|automatisch/i.test(cancellationInfo)
      ) {
        recordChange(document, "contract", "autoRenew", document.autoRenew, true, contract);
      }
      const qwenContract = compactObject({
        version: "qwen-v1.5",
        action: contract.action,
        instanceKey: contract.candidateKey,
        predecessorKey: contract.predecessorKey,
        successorKey: contract.successorKey,
        effectiveDate: contract.effectiveDate,
        confidence: finiteConfidence(contract.confidence),
        reason: contract.reason
      });
      recordChange(
        document,
        "contract",
        "qwenContract",
        document.qwenContract,
        qwenContract,
        contract
      );
    }
  }

  const houseBuild = item.result.houseBuild ?? {};
  if (houseBuild.action === "build") {
    if (finiteConfidence(houseBuild.confidence) < policy.houseBuildConfidence) {
      recordDeferred(item, "houseBuild", houseBuild, "Konfidenz unter Grenzwert");
    } else {
      let target = houseBuildByName.get(normalize(houseBuild.tradeLabel));
      const houseBuildEvidence = normalize(
        [houseBuild.reason, analyzerSemanticText(document)].filter(Boolean).join(" ")
      );
      if (
        !target &&
        /bqu|bauqualitat.*uberwachung|bauuberwachung|bauprufung/.test(houseBuildEvidence)
      ) {
        target = houseBuildByName.get(normalize("Bauqualitätsüberwachung"));
      }
      if (!target) {
        recordDeferred(item, "houseBuild", houseBuild, "Gewerk ist nicht eindeutig auflösbar");
      } else {
        decisionCounts.houseBuildAccepted++;
        if (document.tileId !== target.tileId) {
          addSecondary(document, target.tileId, houseBuild, "houseBuild");
        }
        const qwenHouseBuild = compactObject({
          version: "qwen-v1.5",
          action: "build",
          tradeId: target.tileId,
          tradeLabel: target.name,
          confidence: finiteConfidence(houseBuild.confidence),
          reason: houseBuild.reason
        });
        recordChange(
          document,
          "houseBuild",
          "qwenHouseBuild",
          document.qwenHouseBuild,
          qwenHouseBuild,
          houseBuild
        );
      }
    }
  }

  const lifecycle = item.result.lifecycle ?? {};
  if (!new Set(["none", "unclear", undefined]).has(lifecycle.action)) {
    const activeOrderWithoutActivation =
      lifecycle.subjectType === "contract" &&
      lifecycle.action === "active" &&
      orderWithoutActivation(document);

    if (activeOrderWithoutActivation) {
      recordNoChange(
        item,
        "lifecycle",
        lifecycle,
        "Safety-Gate: Auftrag/Bestellung ohne expliziten Aktivierungsbeleg; ACTIVE automatisch verworfen"
      );
    } else if (finiteConfidence(lifecycle.confidence) < policy.lifecycleConfidence) {
      recordDeferred(item, "lifecycle", lifecycle, "Konfidenz unter Grenzwert");
    } else {
      decisionCounts.lifecycleAccepted++;
      const qwenLifecycle = compactObject({
        version: "qwen-v1.5",
        action: lifecycle.action,
        subjectType: lifecycle.subjectType,
        subject: lifecycle.subject,
        effectiveDate: lifecycle.effectiveDate,
        confidence: finiteConfidence(lifecycle.confidence),
        reason: lifecycle.reason
      });
      recordChange(
        document,
        "lifecycle",
        "qwenLifecycle",
        document.qwenLifecycle,
        qwenLifecycle,
        lifecycle
      );

      projectLifecycleToStructure(document, lifecycle);

      if (
        lifecycle.subjectType === "contract" &&
        !document.contractStatusManual &&
        ["active", "inactive"].includes(lifecycle.action)
      ) {
        recordChange(
          document,
          "lifecycle",
          "contractStatus",
          document.contractStatus,
          lifecycle.action,
          lifecycle
        );
      }
    }
  }
}

const reviewTileId = "tile:review:needs-review";
const reviewTarget = pathByUid.get(reviewTileId);
if (reviewTarget) {
  for (const item of report.results) {
    const document = documentById.get(Number(item.id));
    if (!document) continue;
    const before = Array.isArray(document.secondaryTileIds)
      ? [...document.secondaryTileIds]
      : [];
    const after = before.filter(value => value !== reviewTileId);
    recordChange(
      document,
      "review",
      "secondaryTileIds",
      before,
      after,
      {
        confidence: 1,
        reason: "Prüfstatus wird ausschließlich über das primäre Ablageziel abgebildet"
      }
    );
    recordChange(
      document,
      "review",
      "qwenReview",
      document.qwenReview,
      undefined,
      {
        confidence: 1,
        reason: "Prüffälle erhalten kein Markerfeld; maßgeblich ist nur das primäre Ablageziel"
      }
    );

    const needsReview = reviewRequiredIds.has(Number(item.id));
    if (needsReview && !manualPrimaryProtected(document)) {
      const reasons = deferred
        .filter(entry => Number(entry.id) === Number(item.id))
        .map(entry => `${entry.area}: ${entry.reason}`);
      const decision = {
        confidence: 1,
        reason: reasons.join("; ") || "Mindestens eine Entscheidung bleibt unsicher"
      };
      recordChange(document, "review", "area", document.area, reviewTarget.areaId, decision);
      recordChange(document, "review", "subarea", document.subarea, reviewTarget.subareaId, decision);
      recordChange(document, "review", "tileId", document.tileId, reviewTarget.tileId, decision);
      recordChange(document, "review", "group", document.group, "", decision);
      recordChange(
        document,
        "review",
        "assignmentSource",
        document.assignmentSource,
        "qwen-scanner",
        decision
      );
      reviewPlacedIds.add(Number(item.id));
    }
  }
}

if (changedIds.size || changedAreaIds.size) {
  candidate.revision = crypto.randomUUID();
}

const invariantErrors = [];
if (candidate.documents.length !== state.documents.length) {
  invariantErrors.push("Dokumentzahl wurde verändert");
}
if ((candidate.areas ?? []).length !== (state.areas ?? []).length) {
  invariantErrors.push("Bereichszahl wurde verändert");
}

const invalidAssignments = documentsToCheck => {
  const invalid = new Set();
  for (const document of documentsToCheck) {
    if (!pathByUid.has(document.tileId)) {
      invalid.add(`primary:${document.id}:${document.tileId}`);
    }
    for (const uid of document.secondaryTileIds ?? []) {
      if (!pathByUid.has(uid)) {
        invalid.add(`secondary:${document.id}:${uid}`);
      }
    }
    if (
      document.contractStatus != null &&
      !["active", "inactive", "unknown", "expiring"].includes(document.contractStatus)
    ) {
      invalid.add(`contractStatus:${document.id}:${document.contractStatus}`);
    }
  }
  return invalid;
};

const invalidBefore = invalidAssignments(state.documents);
for (const value of invalidAssignments(candidate.documents)) {
  if (!invalidBefore.has(value)) {
    invariantErrors.push(`Neu eingeführte ungültige Referenz: ${value}`);
  }
}

if (invariantErrors.length) {
  throw new Error(
    `Kandidatenprüfung fehlgeschlagen:\n${invariantErrors.slice(0, 20).join("\n")}`
  );
}

const candidateText = `${JSON.stringify(candidate, null, 2)}\n`;
const audit = {
  version: "qwen-apply-v1.5",
  dryRun: true,
  createdAt: new Date().toISOString(),
  source: {
    stateFile: path.resolve(STATE_FILE),
    stateFileSha256: stateHash,
    stateContentSha256: stateContentHash,
    stateRevision: state.revision ?? "",
    reportFile: path.resolve(REPORT_FILE),
    reportFileSha256: sha256(reportText),
    combinedFile: path.resolve(COMBINED_FILE),
    combinedFileSha256: combinedHash
  },
  sourceAreasSha256: sha256(JSON.stringify(state.areas ?? [])),
  sourceChangedAreas: Object.fromEntries(
    [...changedAreaIds].sort().map(id => {
      const sourceArea = state.areas.find(area => area.id === id);
      return [id, sha256(JSON.stringify(sourceArea))];
    })
  ),
  sourceChangedDocuments: Object.fromEntries(
    [...changedIds]
      .sort((a, b) => a - b)
      .map(id => {
        const sourceDocument = state.documents.find(
          document => Number(document.id) === id
        );
        return [String(id), sha256(JSON.stringify(sourceDocument))];
      })
  ),
  candidate: {
    file: path.resolve(CANDIDATE_FILE),
    sha256: sha256(candidateText),
    revision: candidate.revision ?? ""
  },
  policy,
  reportSummary: report.summary,
  summary: {
    documentsReviewed: report.results.length,
    documentsChanged: changedIds.size,
    fieldChanges: changes.length,
    deferredDecisions: deferred.length,
    reviewDocuments: reviewPlacedIds.size,
    autoResolvedNoChange: autoResolvedNoChange.length,
    changedAreas: changedAreaIds.size,
    structureChanges: structureChanges.length,
    decisionCounts,
    invariantErrors: 0
  },
  changes,
  structureChanges,
  deferred,
  autoResolvedNoChange
};

const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, text, "utf8");
  fs.renameSync(temporary, file);
};

writeAtomic(CANDIDATE_FILE, candidateText);
writeAtomic(AUDIT_FILE, `${JSON.stringify(audit, null, 2)}\n`);

console.log("=== PersonalLab Qwen Apply V1.5 — Kandidat ===");
console.log(`Analysiert: ${audit.summary.documentsReviewed}`);
console.log(`Dokumente mit Änderungen: ${audit.summary.documentsChanged}`);
console.log(`Einzeländerungen: ${audit.summary.fieldChanges}`);
console.log(`Zurückgestellt: ${audit.summary.deferredDecisions}`);
console.log(`Dokumente unter „Zuordnung prüfen“: ${audit.summary.reviewDocuments}`);
console.log(`Automatisch ohne Änderung erledigt: ${audit.summary.autoResolvedNoChange}`);
console.log(`Kandidat: ${path.resolve(CANDIDATE_FILE)}`);
console.log(`Audit: ${path.resolve(AUDIT_FILE)}`);
console.log("Die aktive personallab.json wurde NICHT verändert.");

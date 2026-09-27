import crypto from "node:crypto";
import fs from "node:fs";

const sha256File = file =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");

const stateContentSha256 = stateValue => {
  const volatileKeys =
    new Set([
      "lastSync",
      "syncStatus",
      "syncError",
      "syncWarning",
      "revision"
    ]);

  const stableState =
    Object.fromEntries(
      Object.entries(
        stateValue
      ).filter(
        ([key]) =>
          !volatileKeys.has(key)
      )
    );

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        stableState
      )
    )
    .digest("hex");
};

// ============================================================
// PersonalLab Qwen Shadow V1.1
//
// - KEINE Änderung an personallab.json
// - Zeitbudget statt fester Dokumentzahl
// - neutralisierte Primärkandidaten A/B
// - providerbasierte Vertragskandidaten
// - Transition predecessor/successor
// - Retry bei ungültigem JSON
// - Checkpoint nach jedem Dokument
// - Resume-fähig
// ============================================================

const STATE_FILE =
  process.argv[2] ??
  "/data/personallab.json";

const COMBINED_FILE =
  process.argv[3] ??
  "/data/assignment-lifecycle-report-v2.3.json";

const LIFECYCLE_FILE =
  process.argv[4] ??
  "/data/lifecycle-contract-v3.3.json";

const OUTPUT_FILE =
  process.argv[5] ??
  "/data/qwen-shadow-v1.5-report.json";

const NAVIGATION_TAXONOMY_FILE =
  process.env.PERSONALLAB_NAVIGATION_TAXONOMY_FILE ??
  "/config/navigation-taxonomy-v2.1.json";


const OLLAMA_URL =
  process.env.OLLAMA_URL ??
  "http://ollama:11434";

const MODEL =
  process.env.QWEN_SHADOW_MODEL ??
  "qwen3:4b";

const HOURS =
  Math.max(
    0.1,
    Number(
      process.env.QWEN_SHADOW_HOURS ??
      7
    )
  );

const MAX_DOCS =
  Math.max(
    1,
    Number(
      process.env.QWEN_SHADOW_MAX ??
      999999
    )
  );

const RESET =
  process.env.QWEN_SHADOW_RESET ===
  "1";

const FILTER_IDS =
  new Set(
    String(
      process.env.QWEN_SHADOW_IDS ??
      ""
    )
      .split(",")
      .map(
        value =>
          Number(
            value.trim()
          )
      )
      .filter(
        value =>
          Number.isFinite(value) &&
          value > 0
      )
  );

const RELEVANT_FROM =
  process.env.QWEN_RELEVANT_FROM ??
  "2019-01-01";

const RELEVANT_FROM_DATE =
  new Date(
    `${RELEVANT_FROM}T00:00:00`
  );

const BUDGET_MS =
  HOURS *
  60 *
  60 *
  1000;

// Nicht noch einen neuen Fall beginnen,
// wenn weniger als 90 Sekunden übrig sind.
const SAFETY_MS =
  90 * 1000;

const REQUEST_TIMEOUT_MS =
  300 * 1000;

// ============================================================
// Laden
// ============================================================

const state =
  JSON.parse(
    fs.readFileSync(
      STATE_FILE,
      "utf8"
    )
  );

const combined =
  JSON.parse(
    fs.readFileSync(
      COMBINED_FILE,
      "utf8"
    )
  );

const lifecycle =
  JSON.parse(
    fs.readFileSync(
      LIFECYCLE_FILE,
      "utf8"
    )
  );


const navigationTaxonomyText =
  fs.existsSync(NAVIGATION_TAXONOMY_FILE)
    ? fs.readFileSync(NAVIGATION_TAXONOMY_FILE, "utf8")
    : "";

const navigationTaxonomyInstruction =
  navigationTaxonomyText.trim()
    ? `

=== NAVIGATION TAXONOMY V2.1 — HARTE ABLAGEREGELN ===
Diese Regeln sind verbindlich und haben Vorrang vor alten Jahresordner-Gewohnheiten.

Kernregel:
- Jahresordner nur für wiederkehrende Serienbelege.
- Verträge, Mobilfunk, Fahrzeuge, Kredite, Versicherungen, Energieverträge und Objektakten werden nach Objekt oder Vertragsinstanz abgelegt.
- Wenn Rufnummer, Kundennummer, Vertragsnummer, IBAN, FIN, Zählernummer oder Versicherungsnummer vorhanden ist, ist diese Instanz wichtiger als das Jahr.
- Serienbelege kommen unter die passende Instanz und dort optional nach Jahr.

Taxonomie-Datei:
${navigationTaxonomyText}

Antworte weiterhin ausschließlich im geforderten JSON-Format.
=== ENDE NAVIGATION TAXONOMY V2.1 ===
`
    : "";

const documents =
  Array.isArray(state.documents)
    ? state.documents
    : [];

const combinedResults =
  Array.isArray(combined.results)
    ? combined.results
    : [];

const contractInstances =
  Array.isArray(
    lifecycle.contractInstances
  )
    ? lifecycle.contractInstances
    : [];

const documentById =
  new Map(
    documents.map(
      document => [
        Number(document.id),
        document
      ]
    )
  );

const combinedById =
  new Map(
    combinedResults.map(
      item => [
        Number(item.id),
        item
      ]
    )
  );

// ============================================================
// Hilfsfunktionen
// ============================================================

const normalize = value =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(/ß/g, "ss")
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

const alnum = value =>
  normalize(value)
    .replace(
      /[^a-z0-9]/g,
      ""
    );

const safeParse = value => {
  if (!value)
    return {};

  if (
    typeof value ===
    "object"
  ) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const stringsFrom = (
  value,
  result = [],
  depth = 0
) => {
  if (
    depth > 6 ||
    value == null
  ) {
    return result;
  }

  if (
    typeof value ===
      "string" ||
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    result.push(
      String(value)
    );

    return result;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item
      of value
    ) {
      stringsFrom(
        item,
        result,
        depth + 1
      );
    }

    return result;
  }

  if (
    typeof value ===
    "object"
  ) {
    for (
      const item
      of Object.values(value)
    ) {
      stringsFrom(
        item,
        result,
        depth + 1
      );
    }
  }

  return result;
};

const compactValue = (
  value,
  max = 500
) => {
  if (
    value == null
  ) {
    return "";
  }

  const text =
    typeof value ===
    "string"
      ? value
      : JSON.stringify(value);

  if (
    text.length <= max
  ) {
    return text;
  }

  return (
    text.slice(
      0,
      max
    ) +
    "…"
  );
};

const clamp = value => {
  let number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return 0;
  }

  if (
    number > 1 &&
    number <= 100
  ) {
    number =
      number / 100;
  }

  return Math.max(
    0,
    Math.min(
      1,
      number
    )
  );
};

const sleep =
  milliseconds =>
    new Promise(
      resolve =>
        setTimeout(
          resolve,
          milliseconds
        )
    );

const formatDuration =
  milliseconds => {
    const total =
      Math.max(
        0,
        Math.round(
          milliseconds /
          1000
        )
      );

    const hours =
      Math.floor(
        total / 3600
      );

    const minutes =
      Math.floor(
        (
          total %
          3600
        ) / 60
      );

    const seconds =
      total % 60;

    return [
      String(hours)
        .padStart(2, "0"),
      String(minutes)
        .padStart(2, "0"),
      String(seconds)
        .padStart(2, "0")
    ].join(":");
  };

const parseDate =
  value => {
    if (!value)
      return null;

    const raw =
      String(value)
        .trim();

    // Deutsches Format DD.MM.YYYY
    const german =
      raw.match(
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/
      );

    if (german) {
      const [
        ,
        day,
        month,
        year
      ] = german;

      const date =
        new Date(
          Number(year),
          Number(month) - 1,
          Number(day)
        );

      return Number.isNaN(
        date.getTime()
      )
        ? null
        : date;
    }

    // ISO / YYYY-MM-DD usw.
    const date =
      new Date(raw);

    return Number.isNaN(
      date.getTime()
    )
      ? null
      : date;
  };

const normalizeIsoDate =
  value => {
    const raw =
      String(value ?? "")
        .trim();

    if (!raw)
      return "";

    if (
      /^\d{4}-\d{2}-\d{2}$/
        .test(raw)
    ) {
      return raw;
    }

    const german =
      raw.match(
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/
      );

    if (german) {
      const [
        ,
        day,
        month,
        year
      ] = german;

      return [
        year,
        String(month)
          .padStart(2, "0"),
        String(day)
          .padStart(2, "0")
      ].join("-");
    }

    const parsed =
      parseDate(raw);

    if (!parsed)
      return "";

    return parsed
      .toISOString()
      .slice(0, 10);
  };

const relevantByDate =
  document => {
    const date =
      parseDate(
        document.date
      );

    // Dokumente ohne sicheres Datum nicht wegwerfen.
    if (!date)
      return true;

    return (
      date >=
      RELEVANT_FROM_DATE
    );
  };

// ============================================================
// Dokumenttext-Cache
// ============================================================

const structuredCache =
  new Map();

const textCache =
  new Map();

const structuredFor =
  document => {
    if (
      structuredCache.has(
        document.id
      )
    ) {
      return structuredCache.get(
        document.id
      );
    }

    const value =
      safeParse(
        document.analysisSearchText
      );

    structuredCache.set(
      document.id,
      value
    );

    return value;
  };

const documentText =
  document => {
    if (
      textCache.has(
        document.id
      )
    ) {
      return textCache.get(
        document.id
      );
    }

    const data =
      structuredFor(
        document
      );

    const values = [
      document.title,
      document.sourceTitle,
      document.correspondent,
      document.type,
      document.analysisSummary,
      document.presentationSummary,
      document.analysisCategory,
      ...(document.tags ?? []),
      ...(document.analysisKeywords ?? []),
      ...stringsFrom(data)
    ];

    const result =
      normalize(
        values
          .filter(Boolean)
          .join(" ")
      );

    textCache.set(
      document.id,
      result
    );

    return result;
  };

// ============================================================
// Hausbau
//
// Nur tatsächlich verwendete Gewerke werden später materialisiert.
// Vorhandene Hausbau-Kinder werden bevorzugt.
// ============================================================

const existingHouseBuildTrades =
  (() => {
    const result =
      new Set();

    const ignored =
      new Set([
        "hausbau",
        "rechnungen",
        "rechnung",
        "dokumente",
        "sonstiges",
        "schriftverkehr",
        "ubersicht"
      ]);

    const walk =
      (
        node,
        insideHouseBuild = false
      ) => {
        if (!node)
          return;

        const name =
          String(
            node.name ??
            ""
          ).trim();

        const id =
          normalize(
            node.id ??
            ""
          );

        const normalizedName =
          normalize(name);

        const isHouseBuild =
          insideHouseBuild ||
          normalizedName ===
            "hausbau" ||
          normalizedName.includes(
            "hausbau"
          ) ||
          id.includes(
            "hausbau"
          );

        if (
          insideHouseBuild &&
          name &&
          !ignored.has(
            normalizedName
          ) &&
          !/^(?:19|20)\d{2}$/
            .test(name)
        ) {
          result.add(name);
        }

        for (
          const child
          of node.children ?? []
        ) {
          walk(
            child,
            isHouseBuild
          );
        }
      };

    for (
      const area
      of state.areas ?? []
    ) {
      for (
        const root
        of area.subareas ?? []
      ) {
        walk(root);
      }
    }

    return [
      ...result
    ];
  })();

const fallbackHouseBuildTrades =
  [
    "Planung & Genehmigungen",
    "Erdarbeiten & Rohbau",
    "Dach",
    "Fenster & Türen",
    "Elektro",
    "Heizung & Sanitär",
    "Innenausbau",
    "Außenanlagen",
    "Sonstiges"
  ];

const HOUSE_BUILD_TRADES =
  (
    existingHouseBuildTrades
      .length
      ? existingHouseBuildTrades
      : fallbackHouseBuildTrades
  )
    .slice(0, 12)
    .map(
      (
        name,
        index
      ) => ({
        id:
          `T${index + 1}`,

        name
      })
    );

const houseBuildSignal =
  (
    document,
    item
  ) => {
    const text =
      documentText(
        document
      );

    const paths =
      normalize(
        [
          item
            ?.currentPrimaryPath,
          item
            ?.primary
            ?.targetPath
        ]
          .filter(Boolean)
          .join(" ")
      );

    if (
      paths.includes(
        "hausbau"
      )
    ) {
      return true;
    }

    return (
      /\bhausbau\b|\bneubau\b|\bbauvertrag\b|\bbaurechnung\b|\bbauphase\b|\bbauherren\b|\brohbau\b|\berdarbeiten\b|\bbauleistung\b|\bgewerk\b|\bbauabnahme\b/.test(
        text
      )
    );
  };

// ============================================================
// Objekt-Lifecycle
//
// Vertrags-Lifecycle bleibt separat.
// Hier nur echte Objekte/Vorgänge:
// Fahrzeug, Konto, Hausbau, Tier usw.
// ============================================================

const lifecycleSignal =
  document => {
    const text =
      documentText(
        document
      );

    return (
      /\bverkauft\b|\bverkauf\b|\bveraussert\b|\bveraeussert\b|\bstillgelegt\b|\babgemeldet\b|\bkonto geschlossen\b|\baccount closed\b|\bgeschlossen\b|\bschliessung\b|\bbeendet\b|\baufgehoben\b|\baufhebungsvertrag\b|\bendabnahme\b|\bfertigstellung\b|\babgeschlossen\b|\bverstorben\b|\btod\b|\beingeschlafert\b/.test(
        text
      )
    );
  };

// ============================================================
// Vertragsdarstellung
// ============================================================

const contractKey =
  contract =>
    contract.instanceKey ??
    contract.subjectKey ??
    contract.key ??
    contract.id ??
    "";

const contractProvider =
  contract =>
    contract.provider ??
    contract.providerName ??
    contract.identifiers
      ?.provider ??
    "";

const contractNumber =
  contract =>
    contract.contractNumber ??
    contract.identifiers
      ?.contractNumber ??
    contract.identifiers
      ?.policyNumber ??
    "";

const contractStart =
  contract =>
    contract.start ??
    contract.startDate ??
    "";

const contractEnd =
  contract =>
    contract.end ??
    contract.endDate ??
    contract.effectiveDate ??
    "";

const contractStatus =
  contract =>
    contract.status ??
    contract.stateNow ??
    contract.state ??
    "";

const contractConnection =
  contract => {
    const connection =
      contract.connection;

    if (!connection)
      return "";

    if (
      typeof connection ===
      "string"
    ) {
      return connection;
    }

    return (
      connection.value ??
      connection.label ??
      connection.number ??
      ""
    );
  };

const contractPath =
  contract =>
    contract.virtualPath ??
    contract.path ??
    contract.rootPath ??
    "";

// ============================================================
// Provider-Erkennung
// ============================================================

const providerStopWords =
  new Set([
    "gmbh",
    "ag",
    "kg",
    "mbh",
    "co",
    "und",
    "der",
    "die",
    "das",
    "deutschland",
    "europe",
    "sales",
    "service",
    "services",
    "gruppe",
    "gesellschaft",
    "versicherung",
    "versicherungen"
  ]);

const providerTokens =
  provider =>
    normalize(provider)
      .split(" ")
      .filter(
        token =>
          token.length >= 3 &&
          !providerStopWords
            .has(token)
      );

const meaningfulIdentifier =
  value => {
    const raw =
      normalize(value);

    if (
      !raw ||
      raw === "nicht spezifiziert" ||
      raw === "nicht erkannt" ||
      raw === "unbekannt" ||
      raw === "unknown" ||
      raw === "none" ||
      raw === "n a"
    ) {
      return false;
    }

    return (
      alnum(value).length >= 5
    );
  };

// ------------------------------------------------------------
// Manche vom Lifecycle als Vertragsnummer gelesenen Werte
// sind in Wahrheit persönliche Identifikatoren.
//
// Wenn dieselbe Nummer bei mehreren verschiedenen Anbietern
// auftaucht, darf sie daher NICHT als harter Vertragsanker
// verwendet werden.
// ------------------------------------------------------------

const numberProviders =
  new Map();

for (
  const contract
  of contractInstances
) {
  const number =
    contractNumber(
      contract
    );

  if (
    !meaningfulIdentifier(
      number
    )
  ) {
    continue;
  }

  const key =
    alnum(number);

  const provider =
    normalize(
      contractProvider(
        contract
      )
    );

  if (!provider)
    continue;

  if (
    !numberProviders.has(key)
  ) {
    numberProviders.set(
      key,
      new Set()
    );
  }

  numberProviders
    .get(key)
    .add(provider);
}

const ambiguousNumbers =
  new Set(
    [...numberProviders.entries()]
      .filter(
        ([, providers]) =>
          providers.size > 1
      )
      .map(
        ([number]) =>
          number
      )
  );

// ------------------------------------------------------------
// Bereich
// ------------------------------------------------------------

const topDomain =
  path => {
    const value =
      String(path ?? "")
        .split("/")[0]
        ?.trim();

    return normalize(value);
  };

const documentDomains =
  item =>
    new Set(
      [
        item?.currentPrimaryPath,
        item?.primary
          ?.targetPath
      ]
        .filter(Boolean)
        .map(topDomain)
        .filter(Boolean)
    );

// ------------------------------------------------------------
// Anbieter ausschließlich aus Dokumentinhalt bewerten.
//
// Deterministische Lifecycle-Zuordnungen dürfen hier NICHT
// alleine einen Anbieter bestätigen.
// ------------------------------------------------------------

const textualProviderScore = (
  provider,
  document
) => {
  const p =
    normalize(provider);

  if (!p)
    return 0;

  const text =
    documentText(
      document
    );

  const correspondent =
    normalize(
      document.correspondent
    );

  let score = 0;

  if (
    p.length >= 4 &&
    text.includes(p)
  ) {
    score += 10;
  }

  if (
    correspondent &&
    (
      p.includes(
        correspondent
      ) ||
      correspondent.includes(
        p
      )
    )
  ) {
    score += 10;
  }

  const tokens =
    providerTokens(
      provider
    );

  const matches =
    tokens.filter(
      token =>
        text.includes(token)
    );

  if (
    matches.length >= 2
  ) {
    score +=
      Math.min(
        8,
        matches.length * 2
      );
  } else if (
    matches.length === 1 &&
    matches[0].length >= 7
  ) {
    score += 3;
  }

  return score;
};

// ------------------------------------------------------------
// Vertragskandidaten V1.3
// ------------------------------------------------------------

const contractCandidates = (
  document,
  item
) => {
  const text =
    documentText(
      document
    );

  const textAlnum =
    alnum(text);

  const domains =
    documentDomains(
      item
    );

  const directlyKnownKeys =
    new Set(
      [
        ...(item?.contracts ?? []),
        ...(item?.evidence ?? [])
      ]
        .map(
          entry =>
            entry.instanceKey ??
            entry.subjectKey ??
            entry.contractKey ??
            entry.key
        )
        .filter(Boolean)
    );

  const ranked = [];

  for (
    const contract
    of contractInstances
  ) {
    const key =
      contractKey(
        contract
      );

    if (!key)
      continue;

    const provider =
      contractProvider(
        contract
      );

    const providerEvidence =
      textualProviderScore(
        provider,
        document
      );

    const path =
      contractPath(
        contract
      );

    const domain =
      topDomain(path);

    const domainCompatible =
      Boolean(
        domain &&
        domains.has(domain)
      );

    const number =
      contractNumber(
        contract
      );

    const numberKey =
      meaningfulIdentifier(
        number
      )
        ? alnum(number)
        : "";

    const hardNumber =
      Boolean(
        numberKey &&
        !ambiguousNumbers
          .has(numberKey) &&
        textAlnum.includes(
          numberKey
        )
      );

    const connection =
      contractConnection(
        contract
      );

    const connectionKey =
      meaningfulIdentifier(
        connection
      )
        ? alnum(connection)
        : "";

    const hardConnection =
      Boolean(
        connectionKey &&
        textAlnum.includes(
          connectionKey
        )
      );

    const directlyKnown =
      directlyKnownKeys
        .has(key);

    const strongProvider =
      providerEvidence >= 6;

    const veryStrongProvider =
      providerEvidence >= 10;

    // --------------------------------------------------------
    // Harte Zugangsschranke:
    //
    // - eindeutige Vertragsnummer
    // - eindeutiger Anschluss
    // - Anbieter + passender Fachbereich
    // - sehr starker expliziter Anbieterbezug
    //
    // Eine alte deterministische Zuordnung alleine reicht NICHT.
    // --------------------------------------------------------

    if (
      !hardNumber &&
      !hardConnection &&
      !(
        strongProvider &&
        domainCompatible
      ) &&
      !veryStrongProvider
    ) {
      continue;
    }

    let score = 0;

    if (hardNumber) {
      score += 40;
    }

    if (hardConnection) {
      score += 30;
    }

    score +=
      Math.min(
        15,
        providerEvidence
      );

    if (domainCompatible) {
      score += 8;
    }

    if (
      directlyKnown &&
      (
        hardNumber ||
        hardConnection ||
        strongProvider
      )
    ) {
      score += 4;
    }

    ranked.push({
      score,

      key,

      provider,

      path,

      connection,

      contractNumber:
        meaningfulIdentifier(
          number
        )
          ? number
          : "",

      start:
        contractStart(
          contract
        ),

      end:
        contractEnd(
          contract
        ),

      status:
        contractStatus(
          contract
        ),

      match: {
        hardNumber,
        hardConnection,
        providerEvidence,
        domainCompatible,
        directlyKnown
      }
    });
  }

  return ranked
    .sort(
      (a, b) =>
        b.score -
        a.score
    )
    .slice(0, 8)
    .map(
      ({
        score,
        ...entry
      }) =>
        entry
    );
};


// ============================================================
// V1.5 – semantische Sicherheitsgates
// ============================================================

const analyzerData =
  document => {
    const raw =
      document
        ?.analysisSearchText;

    if (!raw)
      return {};

    if (
      typeof raw ===
      "object"
    ) {
      return raw;
    }

    try {
      return JSON.parse(
        raw
      );
    } catch {
      return {};
    }
  };

const analyzerSemanticText =
  document =>
    normalize(
      [
        document
          ?.analysisSummary,
        document
          ?.presentationSummary,
        ...(
          document
            ?.analysisKeywords ??
          []
        ),
        document
          ?.analysisSearchText
      ]
        .filter(Boolean)
        .join(" ")
    );

// Bestellung/Auftrag beschreibt zunaechst nur den Abschluss- bzw.
// Bereitstellungsprozess. ACTIVE ist erst mit einem ausdruecklichen
// Vollzugsbeleg zulaessig; ein blosses (auch vom Analyzer gesetztes)
// contract.status=active reicht dafuer nicht.
const orderProcessEvidence =
  document => {
    const text =
      normalize(
        [
          document?.title,
          document?.sourceTitle,
          analyzerSemanticText(
            document
          )
        ]
          .filter(Boolean)
          .join(" ")
      );

    return (
      /\bauftrag\b|auftragsbestatigung|auftragsbestaetigung|\bbestellung\b|bestellubersicht|bestelluebersicht/.test(
        text
      )
    );
  };

const explicitActivationEvidence =
  document => {
    const text =
      analyzerSemanticText(
        document
      );

    // Zukunft, Planung oder ein fehlender Termin sind kein Vollzug.
    const explicitlyNotCompleted =
      /nicht (?:angegeben|bekannt|erfolgt|bereitgestellt|aktiviert|geschaltet)|noch nicht|voraussichtlich|geplant|planung|soll (?:bereitgestellt|aktiviert|geschaltet|in betrieb genommen) werden|wird (?:bereitgestellt|aktiviert|geschaltet|in betrieb genommen)|vor (?:dem )?bereitstellungstermin/.test(
        text
      );

    if (
      explicitlyNotCompleted
    ) {
      return false;
    }

    return (
      /bereitstellung (?:ist )?erfolgt|erfolgreich bereitgestellt|wurde bereitgestellt|aktivierung (?:ist )?erfolgt|erfolgreich aktiviert|wurde aktiviert|schaltung (?:ist )?erfolgt|erfolgreich geschaltet|wurde geschaltet|inbetriebnahme (?:ist )?erfolgt|erfolgreich in betrieb genommen|wurde in betrieb genommen|anschluss ist (?:aktiv|betriebsbereit)|dienst ist (?:aktiv|nutzbar)/.test(
        text
      )
    );
  };

const explicitNewContractEvidence =
  document => {
    const data =
      analyzerData(
        document
      );

    const contract =
      data?.contract;

    if (
      contract &&
      typeof contract ===
        "object"
    ) {
      if (
        contract.contract_number ||
        contract.contractNumber ||
        contract.start_date ||
        contract.startDate ||
        contract.partner ||
        contract.contract_type
      ) {
        return true;
      }
    }

    const text =
      analyzerSemanticText(
        document
      );

    const explicitContract =
      /vertragsabschluss|vertrag wurde ausgefertigt|vertrag wurde abgeschlossen|auftragsbestatigung|auftragsbestaetigung|kaufvertrag|kaufauftrag|kreditvertrag|darlehensvertrag|verbrauchervertrag|liefervertrag|mobilfunkvertrag|internetvertrag|versicherungsschein|versicherungspolice|vertragsbestatigung|vertragsbestaetigung/.test(
        text
      );

    const concreteAnchor =
      /vertragsnummer|vertrags nr|kaufvertragsnummer|kaufvertrags nummer|vertragsdatum|kaufvertragsdatum|vertragsbeginn|lieferbeginn|kreditbetrag|schlussrate/.test(
        text
      );

    return (
      explicitContract &&
      concreteAnchor
    );
  };

const strongSemanticNewContractEvidence =
  document => {
    const text =
      analyzerSemanticText(
        document
      );

    const explicitConclusion =
      /vertragsabschluss|vertrag wurde ausgefertigt|vertrag wurde abgeschlossen|auftragsbestatigung|auftragsbestaetigung|kaufvertrag|kaufauftrag|kreditvertrag|darlehensvertrag|verbrauchervertrag|liefervertrag|mobilfunkvertrag|internetvertrag|versicherungsschein|versicherungspolice|vertragsbestatigung|vertragsbestaetigung/.test(
        text
      );

    const concreteAnchor =
      /vertragsnummer|vertrags nr|kaufvertragsnummer|kaufvertrags nummer|vertragsdatum|kaufvertragsdatum|vertragsbeginn|lieferbeginn|kreditbetrag|schlussrate/.test(
        text
      );

    return (
      explicitConclusion &&
      concreteAnchor
    );
  };

const relationText =
  entity =>
    normalize(
      [
        entity?.relation,
        entity?.type
      ]
        .filter(Boolean)
        .join(" ")
    );

const userActsAsSeller =
  document => {
    const data =
      analyzerData(
        document
      );

    for (
      const entity
      of data?.entities ?? []
    ) {
      const relation =
        relationText(
          entity
        );

      const isSeller =
        /verkaufer|verkaeufer|verausserer|veraeusserer|fahrzeughalter als verkaufer|fahrzeughalter als verkaeufer/.test(
          relation
        );

      const looksPrivate =
        /person|privat|kunde|fahrzeughalter/.test(
          relation
        );

      const looksBusiness =
        /firma|unternehmen|organisation|organization|company|autohaus|handler|haendler/.test(
          relation
        );

      if (
        isSeller &&
        looksPrivate &&
        !looksBusiness
      ) {
        return true;
      }
    }

    return false;
  };

const explicitTerminalEvidence =
  (
    document,
    action
  ) => {
    // Manuell bestätigte Dokumentrollen.
    // ID 2149 ist der Kaufvertrag des neuen Besitzers
    // und damit aus Nutzersicht der Verkauf von Audi A5 #2.
    if (
      Number(document?.id) === 2149 &&
      action === "sold"
    ) {
      return true;
    }

    const text =
      analyzerSemanticText(
        document
      );

    if (
      action === "sold"
    ) {
      if (
        /ausserbetrieb|ausserbetriebsetzung|außerbetrieb|außerbetriebsetzung|stilllegung|fahrzeug.*abgemeldet|abmeldung.*fahrzeug/.test(
          text
        )
      ) {
        return true;
      }

      if (
        /verkaufsvertrag|fahrzeugverkauf|verkauft an|veraussert an|veraeussert an/.test(
          text
        ) &&
        userActsAsSeller(
          document
        )
      ) {
        return true;
      }

      return false;
    }

    if (
      action === "closed"
    ) {
      return (
        /konto.*geschlossen|account.*closed|kontoschliess|kontoschließ|kontoauflos|kontoaufloes|account closure/.test(
          text
        )
      );
    }

    if (
      action === "deceased"
    ) {
      return (
        /verstorben|eingeschlafert|eingeschläfert|tod|verendet|wegen tod/.test(
          text
        )
      );
    }

    if (
      action === "completed"
    ) {
      return (
        /endabnahme|schlussabnahme|bauabnahme|fertigstellung|hausbau.*abgeschlossen|bauvorhaben.*abgeschlossen/.test(
          text
        )
      );
    }

    if (
      action === "inactive"
    ) {
      const realEnd =
        /gekundigt|gekuendigt|kundigung wirksam|kuendigung wirksam|kündigung wirksam|vertragsende|vertrag endet|vertrag beendet|beendigung zum|aufhebungsvertrag|aufgehoben|storniert|schlussrechnung.*vertrag/.test(
          text
        );

      const onlyNotice =
        /kundigungsfrist|kuendigungsfrist|kündigungsfrist/.test(
          text
        ) &&
        !realEnd;

      return (
        realEnd &&
        !onlyNotice
      );
    }

    return true;
  };

const extractDateValue =
  value => {
    if (
      value === null ||
      value === undefined
    ) {
      return "";
    }

    if (
      typeof value ===
        "string" ||
      typeof value ===
        "number"
    ) {
      const raw =
        String(value);

      const iso =
        raw.match(
          /\b(20\d{2}-\d{2}-\d{2})\b/
        );

      if (iso)
        return iso[1];

      const german =
        raw.match(
          /\b(\d{1,2}\.\d{1,2}\.20\d{2})\b/
        );

      if (german) {
        return normalizeIsoDate(
          german[1]
        );
      }

      return "";
    }

    if (
      Array.isArray(value)
    ) {
      for (
        const entry
        of value
      ) {
        const found =
          extractDateValue(
            entry
          );

        if (found)
          return found;
      }

      return "";
    }

    if (
      typeof value ===
      "object"
    ) {
      for (
        const entry
        of Object.values(
          value
        )
      ) {
        const found =
          extractDateValue(
            entry
          );

        if (found)
          return found;
      }
    }

    return "";
  };

const terminalDateFromAnalyzer =
  document => {
    const data =
      analyzerData(
        document
      );

    const contract =
      data?.contract ??
      {};

    for (
      const value
      of [
        contract.end_date,
        contract.endDate,
        contract.cancellation_date,
        contract.cancellationDate
      ]
    ) {
      const found =
        extractDateValue(
          value
        );

      if (found)
        return found;
    }

    for (
      const fact
      of data?.facts ?? []
    ) {
      const key =
        normalize(
          [
            fact?.key,
            fact?.label
          ]
            .filter(Boolean)
            .join(" ")
        );

      if (
        !/vertragsende|kundigungsdatum|kuendigungsdatum|aufhebungsdatum|verkaufsdatum|abmeldedatum|fertigstellung|endabnahme|todestag|date of end|end date/.test(
          key
        )
      ) {
        continue;
      }

      const found =
        extractDateValue(
          fact?.value ??
          fact
        );

      if (found)
        return found;
    }

    for (
      const event
      of data?.events ?? []
    ) {
      const eventText =
        normalize(
          [
            event?.type,
            event?.description
          ]
            .filter(Boolean)
            .join(" ")
        );

      if (
        !/kundigung|kuendigung|beendigung|verkauf|abmeldung|tod|verstorben|fertigstellung|endabnahme/.test(
          eventText
        )
      ) {
        continue;
      }

      const found =
        extractDateValue(
          event?.date
        );

      if (found)
        return found;
    }

    return "";
  };

const dateVariants =
  value => {
    const iso =
      normalizeIsoDate(
        value
      );

    if (!iso)
      return [];

    const [
      year,
      month,
      day
    ] =
      iso.split("-");

    return [
      ...new Set(
        [
          iso,
          `${day}.${month}.${year}`,
          `${Number(day)}.${Number(month)}.${year}`
        ]
          .map(normalize)
          .filter(Boolean)
      )
    ];
  };

const contractInstanceByKey =
  new Map();

for (
  const contract
  of contractInstances
) {
  for (
    const key
    of [
      contractKey(
        contract
      ),
      contract.instanceKey
    ]
      .filter(Boolean)
  ) {
    contractInstanceByKey.set(
      key,
      contract
    );
  }
}

const transitionIdentifierParts =
  value => {
    const raw =
      String(
        value ??
        ""
      );

    const full =
      alnum(raw);

    const digits =
      raw.replace(
        /\D/g,
        ""
      );

    return [
      ...new Set(
        [
          full,
          digits
        ]
          .filter(
            part =>
              part.length >= 6
          )
      )
    ];
  };

const transitionIdentifierMatch = (
  left,
  right
) => {
  const a =
    transitionIdentifierParts(
      left
    );

  const b =
    transitionIdentifierParts(
      right
    );

  return a.some(
    x =>
      b.some(
        y =>
          x === y ||
          x.includes(y) ||
          y.includes(x)
      )
  );
};

const transitionSideScore = (
  contract,
  transition,
  side
) => {
  if (!contract)
    return -10000;

  let score = 0;

  const expectedProvider =
    normalize(
      transition.provider ??
      ""
    );

  const actualProvider =
    normalize(
      contractProvider(
        contract
      )
    );

  if (
    expectedProvider &&
    actualProvider
  ) {
    if (
      expectedProvider ===
      actualProvider
    ) {
      score += 30;
    } else {
      return -10000;
    }
  }

  const domain =
    normalize(
      transition.domain ??
      ""
    );

  const path =
    normalize(
      contractPath(
        contract
      )
    );

  if (
    domain &&
    path.includes(domain)
  ) {
    score += 15;
  }

  if (
    transitionIdentifierMatch(
      transition.connection,
      contractConnection(
        contract
      )
    )
  ) {
    score += 35;
  }

  const expectedNumber =
    side === "old"
      ? (
          transition
            .oldContractNumber ??
          ""
        )
      : (
          transition
            .newContractNumber ??
          ""
        );

  const actualNumber =
    contractNumber(
      contract
    );

  if (expectedNumber) {
    if (
      transitionIdentifierMatch(
        expectedNumber,
        actualNumber
      )
    ) {
      score += 80;
    } else if (actualNumber) {
      score -= 20;
    }
  }

  const expectedDate =
    side === "old"
      ? (
          transition.oldEnd ??
          transition.fromEnd ??
          ""
        )
      : (
          transition.newStart ??
          transition.toStart ??
          ""
        );

  const actualDate =
    side === "old"
      ? contractEnd(contract)
      : contractStart(contract);

  if (expectedDate) {
    if (
      String(actualDate ?? "") ===
      String(expectedDate)
    ) {
      score += 60;
    } else if (actualDate) {
      score -= 15;
    }
  }

  const status =
    normalize(
      contractStatus(
        contract
      )
    );

  if (
    side === "old" &&
    (
      status.includes(
        "inactive"
      ) ||
      status.includes(
        "active until end"
      ) ||
      status.includes(
        "active-until-end"
      )
    )
  ) {
    score += 10;
  }

  if (
    side === "new" &&
    (
      status.includes(
        "scheduled"
      ) ||
      status === "active"
    )
  ) {
    score += 10;
  }

  return score;
};

const resolveTransitionSide = (
  transition,
  side
) => {
  const directKey =
    String(
      (
        side === "old"
          ? transition.from
          : transition.to
      ) ??
      ""
    );

  if (
    directKey &&
    contractInstanceByKey
      .has(directKey)
  ) {
    return contractInstanceByKey
      .get(directKey);
  }

  let best = null;
  let bestScore = -10000;

  for (
    const contract
    of contractInstances
  ) {
    const score =
      transitionSideScore(
        contract,
        transition,
        side
      );

    if (
      score >
      bestScore
    ) {
      best = contract;
      bestScore = score;
    }
  }

  return bestScore >= 50
    ? best
    : null;
};

const transitionCandidatesForDocument =
  document => {
    const text =
      documentText(
        document
      );

    const textAlnum =
      alnum(text);

    const documentHasIdentifier =
      value =>
        transitionIdentifierParts(
          value
        )
          .some(
            part =>
              textAlnum.includes(
                part
              )
          );

    const explicitTransition =
      /terminverschieb|vertragswechsel|anbieterwechsel|folgevertrag|neuer lieferbeginn|vorgemerkter lieferbeginn|lieferbeginn.*verschob|verschob.*lieferbeginn/.test(
        text
      );

    const result = [];

    for (
      const transition
      of lifecycle.transitions ?? []
    ) {
      const fromContract =
        resolveTransitionSide(
          transition,
          "old"
        );

      const toContract =
        resolveTransitionSide(
          transition,
          "new"
        );

      const from =
        String(
          contractKey(
            fromContract
          ) ||
          transition.from ||
          ""
        );

      const to =
        String(
          contractKey(
            toContract
          ) ||
          transition.to ||
          ""
        );

      if (
        !from ||
        !to ||
        from === to
      ) {
        continue;
      }

      const provider =
        transition.provider ||
        contractProvider(
          fromContract
        ) ||
        contractProvider(
          toContract
        );

      const providerEvidence =
        textualProviderScore(
          provider,
          document
        );

      const connection =
        transition.connection ||
        contractConnection(
          fromContract
        ) ||
        contractConnection(
          toContract
        );

      const connectionMatch =
        documentHasIdentifier(
          connection
        );

      const fromEnd =
        transition.oldEnd ??
        transition.fromEnd ??
        contractEnd(
          fromContract
        ) ??
        "";

      const toStart =
        transition.newStart ??
        transition.toStart ??
        contractStart(
          toContract
        ) ??
        "";

      const oldNumber =
        transition
          .oldContractNumber ??
        contractNumber(
          fromContract
        ) ??
        "";

      const newNumber =
        transition
          .newContractNumber ??
        contractNumber(
          toContract
        ) ??
        "";

      const oldNumberMatch =
        documentHasIdentifier(
          oldNumber
        );

      const newNumberMatch =
        documentHasIdentifier(
          newNumber
        );

      const fromDateMatch =
        dateVariants(
          fromEnd
        )
          .some(
            value =>
              text.includes(
                value
              )
          );

      const toDateMatch =
        dateVariants(
          toStart
        )
          .some(
            value =>
              text.includes(
                value
              )
          );

      const fromEvidence =
        Boolean(
          fromDateMatch ||
          oldNumberMatch
        );

      const toEvidence =
        Boolean(
          toDateMatch ||
          newNumberMatch
        );

      if (
        providerEvidence < 3 &&
        !connectionMatch &&
        !fromEvidence &&
        !toEvidence
      ) {
        continue;
      }

      let score =
        Math.min(
          20,
          providerEvidence
        );

      if (connectionMatch)
        score += 25;

      if (fromDateMatch)
        score += 20;

      if (toDateMatch)
        score += 20;

      if (oldNumberMatch)
        score += 30;

      if (newNumberMatch)
        score += 30;

      if (explicitTransition)
        score += 15;

      result.push({
        from,
        to,
        provider,
        connection,
        oldNumber,
        newNumber,
        fromEnd,
        toStart,

        gapDays:
          transition.gapDays ??
          null,

        type:
          transition.type ??
          "canonical-v3.3",

        connectionMatch,
        oldNumberMatch,
        newNumberMatch,
        fromDateMatch,
        toDateMatch,
        fromEvidence,
        toEvidence,
        explicitTransition,
        score
      });
    }

    return result
      .sort(
        (
          a,
          b
        ) =>
          b.score -
          a.score
      )
      .slice(
        0,
        3
      );
  };

const allowedContractKeys =
  context =>
    new Set(
      [
        ...(
          context
            ?.contractCandidates ??
          []
        )
          .map(
            x =>
              x.key
          ),

        ...(
          context
            ?.transitionCandidates ??
          []
        )
          .flatMap(
            x => [
              x.from,
              x.to
            ]
          )
      ]
        .filter(Boolean)
    );


// ============================================================
// V1.5 – Fahrzeugidentität
//
// Grundregel:
// - exakte belastbare FIN = konkrete Fahrzeuginstanz
// - unterschiedliche FIN = unterschiedliche Fahrzeuge
// - OCR-Abweichungen werden NICHT automatisch fuzzy gemerged
// - bestätigte OCR-Aliase dürfen explizit zusammengeführt werden
// ============================================================

const knownVehicleIdentityAliases =
  new Map([
    [
      "WAUZZZ8TYFA003897",
      "vehicle:manual:audi-a5-2"
    ],
    [
      "WAUZZZ8T9FA003897",
      "vehicle:manual:audi-a5-2"
    ],
    [
      "WAUZZZ8TYIFA003897",
      "vehicle:manual:audi-a5-2"
    ]
  ]);

const strictVin =
  value => {
    const vin =
      String(
        value ?? ""
      )
        .toUpperCase()
        .trim();

    return (
      vin.length === 17 &&
      /^[A-HJ-NPR-Z0-9]{17}$/.test(
        vin
      ) &&
      /[A-Z]/.test(
        vin
      ) &&
      /\d/.test(
        vin
      )
    );
  };

const vehicleIdentityFor =
  document => {
    const data =
      structuredFor(
        document
      );

    const found = [];

    const addToken =
      (
        raw,
        semanticContext
      ) => {
        const text =
          String(
            raw ?? ""
          )
            .toUpperCase();

        const tokens =
          text.match(
            /[A-Z0-9]{17,18}/g
          ) ??
          [];

        for (
          const token
          of tokens
        ) {
          const known =
            knownVehicleIdentityAliases
              .get(
                token
              );

          if (known) {
            found.push({
              token,
              key: known,
              source:
                "confirmed-alias"
            });

            continue;
          }

          const semanticVinField =
            /fahrgestell|fahrzeug.?ident|fzg.?ident|vehicle.?ident|\bvin\b|fzg.?nr|fahrzeug.?nr|bestellschl/.test(
              semanticContext
            );

          if (
            semanticVinField &&
            strictVin(
              token
            )
          ) {
            found.push({
              token,
              key:
                `vehicle:vin:${token}`,
              source:
                "analyzer-fin"
            });
          }
        }
      };

    const walk =
      (
        value,
        context = ""
      ) => {
        if (
          Array.isArray(
            value
          )
        ) {
          for (
            const child
            of value
          ) {
            walk(
              child,
              context
            );
          }

          return;
        }

        if (
          !value ||
          typeof value !==
            "object"
        ) {
          addToken(
            value,
            context
          );

          return;
        }

        const localContext =
          normalize(
            [
              context,
              value.key,
              value.label,
              value.relation,
              value.type,
              value.unit
            ]
              .filter(Boolean)
              .join(" ")
          );

        for (
          const [
            key,
            child
          ]
          of Object.entries(
            value
          )
        ) {
          walk(
            child,
            normalize(
              `${localContext} ${key}`
            )
          );
        }
      };

    walk(
      data
    );

    const identities =
      [
        ...new Map(
          found.map(
            item => [
              `${item.key}|${item.token}`,
              item
            ]
          )
        ).values()
      ];

    const keys =
      [
        ...new Set(
          identities.map(
            item =>
              item.key
          )
        )
      ];

    return {
      key:
        keys.length === 1
          ? keys[0]
          : "",
      ambiguous:
        keys.length > 1,
      identities
    };
  };

const applyRawSafetyGuards =
  (
    original,
    context,
    document
  ) => {
    const answer = {
      ...(original ?? {})
    };

    const vehicleIdentity =
      vehicleIdentityFor(
        document
      );

    // --------------------------------------------------------
    // Manuell bestätigte Dokumentrolle:
    // ID 2149 = Verkauf Audi A5 #2
    // Kein dritter Audi A5.
    // --------------------------------------------------------

    if (
      Number(document?.id) ===
        2149
    ) {
      answer.c =
        "evidence";

      answer.ck = "";
      answer.cf = "";
      answer.ct = "";

      answer.ed =
        "2025-11-04";

      answer.cc =
        0.99;

      answer.cr =
        "V1.5 manuell bestaetigt: Kaufvertrag des neuen Besitzers ist der Verkaufsbeleg fuer Audi A5 #2";

      answer.l =
        "sold";

      answer.lt =
        "vehicle";

      answer.ls =
        "vehicle:manual:audi-a5-2";

      answer.ld =
        "2025-11-04";

      answer.lc =
        0.99;

      answer.lr =
        "V1.5 manuell bestaetigt: Audi A5 #2 am 04.11.2025 verkauft";

      return answer;
    }

    // --------------------------------------------------------
    // SOLD darf nie nur ein Modell / eine Fahrzeugkategorie
    // terminalisieren.
    //
    // Eine konkrete FIN bzw. bestätigte Instanz ist Pflicht.
    // --------------------------------------------------------

    if (
      answer.l ===
        "sold"
    ) {
      if (
        vehicleIdentity.key
      ) {
        answer.lt =
          "vehicle";

        answer.ls =
          vehicleIdentity.key;

        answer.lr =
          [
            answer.lr,
            `V1.5 Fahrzeugidentitaet: ${vehicleIdentity.key}`
          ]
            .filter(Boolean)
            .join("; ");
      } else {
        answer.l =
          "none";

        answer.lt =
          "none";

        answer.ls = "";
        answer.ld = "";

        answer.lc =
          Math.max(
            clamp(
              answer.lc
            ),
            0.95
          );

        answer.lr =
          vehicleIdentity.ambiguous
            ? "V1.5-Fahrzeuggate: SOLD wegen mehrdeutiger Fahrzeugidentitaet verworfen"
            : "V1.5-Fahrzeuggate: SOLD ohne eindeutige FIN/Fahrzeuginstanz verworfen";
      }
    } else if (
      vehicleIdentity.key &&
      answer.lt ===
        "vehicle" &&
      answer.l !==
        "none"
    ) {
      answer.ls =
        vehicleIdentity.key;
    }

    const allowed =
      allowedContractKeys(
        context
      );

    const hint =
      (
        context
          ?.transitionCandidates ??
        []
      )[0];

    // --------------------------------------------------------
    // ATTACH nur bei starker Instanz-Identität
    //
    // Ein Kandidat ist nicht schon deshalb passend, weil
    // Anbieter oder Kategorie ähnlich aussehen.
    // --------------------------------------------------------

    const attachCandidateAllowed =
      key => {
        if (
          !key ||
          !allowed.has(
            key
          )
        ) {
          return false;
        }

        const candidate =
          (
            context
              ?.contractCandidates ??
            []
          )
            .find(
              item =>
                item.key === key
            );

        const match =
          candidate
            ?.match ??
          {};

        const strongIdentity =
          Boolean(
            candidate &&
            match.domainCompatible !==
              false &&
            (
              match.hardNumber ||
              match.hardConnection ||
              match.directlyKnown
            )
          );

        if (
          strongIdentity
        ) {
          return true;
        }

        // Deterministisch erkannter Folgevertrag aus V3.3
        // darf weiterhin ATTACH sein, auch wenn er nur über
        // Transition-Evidenz aufgelöst wurde.
        const transitionTarget =
          (
            context
              ?.transitionCandidates ??
            []
          )
            .some(
              item =>
                item.to === key &&
                item.toEvidence &&
                (
                  (
                    !item.fromEvidence &&
                    item.score >= 30 &&
                    /lieferbeginn|vorgemerkter lieferbeginn|vertragsbeginn/.test(
                      documentText(
                        document
                      )
                    )
                  ) ||
                  (
                    item.fromEvidence &&
                    item.toEvidence &&
                    (
                      item.explicitTransition ||
                      item.score >= 55
                    )
                  )
                )
            );

        if (
          transitionTarget
        ) {
          return true;
        }

        // ----------------------------------------------------
        // Kurzlebige Auftragsinstanz:
        //
        // Ein Auftrag/Antrag darf auch ohne harte Nummer an
        // einen bereits als INAKTIV bekannten Kandidaten
        // gebunden werden, wenn
        // - Anbieterbezug vorhanden ist,
        // - Domain passt,
        // - dessen Ende kurz nach dem Dokument liegt.
        //
        // Das verhindert gleichzeitig, dass bloße Kontakt-
        // Telefonnummern anderer Anbieter als Identität reichen.
        // ----------------------------------------------------

        const semanticText =
          analyzerSemanticText(
            document
          );

        const isOrderDocument =
          /auftrag|antrag|bestellung|auftragsbestatigung|auftragsbestaetigung/.test(
            semanticText
          );

        const documentDate =
          parseDate(
            document?.date
          );

        const candidateEnd =
          parseDate(
            candidate?.end
          );

        const distanceDays =
          (
            documentDate &&
            candidateEnd
          )
            ? Math.round(
                (
                  candidateEnd.getTime() -
                  documentDate.getTime()
                ) /
                86400000
              )
            : null;

        const shortLivedOrderIdentity =
          Boolean(
            candidate &&
            isOrderDocument &&
            candidate.status === "inactive" &&
            match.domainCompatible !== false &&
            Number(
              match.providerEvidence ?? 0
            ) > 0 &&
            distanceDays !== null &&
            distanceDays >= 0 &&
            distanceDays <= 45
          );

        return shortLivedOrderIdentity;
      };

    // --------------------------------------------------------
    // Auftrag vor einer kurz darauf beendeten Instanz
    //
    // Wenn Qwen nur EVIDENCE/NONE/UNCLEAR liefert, aber genau
    // eine passende bekannte Instanz kurz danach endet, wird
    // der Auftrag deterministisch an diese Instanz gebunden.
    // --------------------------------------------------------

    const orderPromotionText =
      analyzerSemanticText(
        document
      );

    const isConcreteOrderDocument =
      /auftrag|antrag|bestellung|auftragsbestatigung|auftragsbestaetigung/.test(
        orderPromotionText
      );

    const orderDocumentDate =
      parseDate(
        document?.date
      );

    const shortLivedOrderCandidates =
      (
        context?.contractCandidates ??
        []
      )
        .filter(candidate => {
          const match =
            candidate?.match ?? {};

          const endDate =
            parseDate(
              candidate?.end
            );

          if (
            !candidate?.key ||
            candidate.status !== "inactive" ||
            match.domainCompatible === false ||
            Number(
              match.providerEvidence ?? 0
            ) <= 0 ||
            !orderDocumentDate ||
            !endDate
          ) {
            return false;
          }

          const days =
            Math.round(
              (
                endDate.getTime() -
                orderDocumentDate.getTime()
              ) /
              86400000
            );

          return (
            days >= 0 &&
            days <= 45
          );
        });

    if (
      isConcreteOrderDocument &&
      (
        answer.c === "evidence" ||
        answer.c === "none" ||
        answer.c === "unclear"
      ) &&
      shortLivedOrderCandidates.length === 1
    ) {
      answer.c =
        "attach";

      answer.ck =
        shortLivedOrderCandidates[0].key;

      answer.cf = "";
      answer.ct = "";
      answer.ed = "";

      answer.cc =
        Math.max(
          clamp(
            answer.cc
          ),
          0.97
        );

      answer.cr =
        "V1.5: Auftrag deterministisch an spaeter stornierte Instanz gebunden";
    }

    // --------------------------------------------------------
    // Explizites Auftrags-Storno:
    //
    // Wenn ein Dokument eindeutig eine Stornierung eines
    // Auftrags beschreibt und genau ein passender inaktiver
    // Kandidat am selben Datum endet, gehört das Dokument
    // deterministisch zu dieser Instanz.
    // --------------------------------------------------------

    const cancellationSemanticText =
      analyzerSemanticText(
        document
      );

    const cancellationDate =
      normalizeIsoDate(
        document?.date
      );

    const isExplicitOrderCancellation =
      (
        /storn/.test(
          cancellationSemanticText
        ) &&
        /auftrag|antrag|bestellung|hausanschluss/.test(
          cancellationSemanticText
        )
      );

    const cancellationCandidates =
      (
        context?.contractCandidates ??
        []
      )
        .filter(candidate => {
          const match =
            candidate?.match ?? {};

          return Boolean(
            candidate?.key &&
            candidate.status === "inactive" &&
            match.domainCompatible !== false &&
            Number(
              match.providerEvidence ?? 0
            ) > 0 &&
            cancellationDate &&
            normalizeIsoDate(
              candidate?.end
            ) === cancellationDate
          );
        });

    const cancelledOrderTarget =
      (
        isExplicitOrderCancellation &&
        cancellationCandidates.length === 1
      )
        ? cancellationCandidates[0]
        : null;

    if (
      cancelledOrderTarget
    ) {
      answer.c = "attach";
      answer.ck =
        cancelledOrderTarget.key;

      answer.cf = "";
      answer.ct = "";

      answer.ed =
        cancellationDate;

      answer.cc =
        Math.max(
          clamp(
            answer.cc
          ),
          0.97
        );

      answer.cr =
        "V1.5: stornierte Auftragsinstanz deterministisch zugeordnet";

      answer.l =
        "inactive";

      answer.lt =
        "contract";

      answer.ls =
        cancelledOrderTarget.key;

      answer.ld =
        cancellationDate;

      answer.lc =
        Math.max(
          clamp(
            answer.lc
          ),
          0.97
        );

      answer.lr =
        "V1.5: explizites Auftrags-Storno beendet konkrete Vertragsinstanz";
    }

    // --------------------------------------------------------
    // Starker deterministischer Vertragswechsel
    // --------------------------------------------------------

    if (
      hint &&
      hint.fromEvidence &&
      hint.toEvidence &&
      (
        hint.explicitTransition ||
        hint.score >= 55
      )
    ) {
      answer.c =
        "transition";

      answer.cf =
        hint.from;

      answer.ct =
        hint.to;

      answer.ck =
        "";

      answer.ed =
        hint.toStart ||
        hint.fromEnd ||
        "";

      answer.cc =
        Math.max(
          clamp(
            answer.cc
          ),
          0.98
        );

      answer.cr =
        "V1.5: deterministischer Vertragswechsel aus Lifecycle V3.3";
    } else if (
      hint &&
      hint.toEvidence &&
      !hint.fromEvidence &&
      hint.score >= 30 &&
      /lieferbeginn|vorgemerkter lieferbeginn|vertragsbeginn/.test(
        documentText(
          document
        )
      )
    ) {
      answer.c =
        "attach";

      answer.ck =
        hint.to;

      answer.cf =
        "";

      answer.ct =
        "";

      answer.ed =
        hint.toStart ??
        "";

      answer.cc =
        Math.max(
          clamp(
            answer.cc
          ),
          0.97
        );

      answer.cr =
        "V1.5: Dokument gehoert zum deterministisch erkannten Folgevertrag";
    }

    // --------------------------------------------------------
    // NEW darf nicht auf bereits vorhandene Instanz zeigen
    // --------------------------------------------------------

    if (
      answer.c ===
        "new" &&
      answer.ck &&
      allowed.has(
        answer.ck
      )
    ) {
      const existingCandidate =
        (
          context
            ?.contractCandidates ??
          []
        )
          .find(
            candidate =>
              candidate.key ===
              answer.ck
          );

      const match =
        existingCandidate
          ?.match ??
        {};

      const strongExistingMatch =
        Boolean(
          existingCandidate &&
          match.domainCompatible !==
            false &&
          (
            match.hardNumber ||
            match.hardConnection ||
            match.directlyKnown
          )
        );

      if (
        strongExistingMatch
      ) {
        answer.c =
          "attach";

        answer.cf = "";
        answer.ct = "";

        answer.cc =
          Math.max(
            clamp(
              answer.cc
            ),
            0.97
          );

        answer.cr =
          "V1.5-Sicherheitsgate: starke Identitaet zu vorhandener Vertragsinstanz, daher ATTACH statt NEW";
      } else {
        answer.ck = "";
        answer.cf = "";
        answer.ct = "";

        if (
          strongSemanticNewContractEvidence(
            document
          )
        ) {
          answer.cc =
            Math.max(
              clamp(
                answer.cc
              ),
              0.95
            );
        }

        answer.cr =
          "V1.5-Sicherheitsgate: unpassenden vorhandenen Vertragskandidaten verworfen; NEW bleibt erhalten";
      }
    }

  // --------------------------------------------------------
  // Starker Analyzer-Abschlussbeleg darf nicht als bloßes
  // EVIDENCE/NONE/UNCLEAR verloren gehen.
  // --------------------------------------------------------

  if (
    (
      answer.c === "evidence" ||
      answer.c === "none" ||
      answer.c === "unclear"
    ) &&
    strongSemanticNewContractEvidence(
      document
    )
  ) {
    const strongExistingCandidate =
      (
        context?.contractCandidates ??
        []
      )
        .some(candidate => {
          const match =
            candidate?.match ?? {};

          return Boolean(
            match.domainCompatible !== false &&
            (
              match.hardNumber ||
              match.hardConnection ||
              match.directlyKnown
            )
          );
        });

    const terminalEvidence =
      [
        "sold",
        "closed",
        "inactive",
        "completed",
        "deceased"
      ]
        .some(
          action =>
            explicitTerminalEvidence(
              document,
              action
            )
        );

    if (
      !strongExistingCandidate &&
      !terminalEvidence
    ) {
      answer.c = "new";

      answer.ck = "";
      answer.cf = "";
      answer.ct = "";
      answer.ed = "";

      answer.cc =
        Math.max(
          clamp(
            answer.cc
          ),
          0.95
        );

      answer.cr =
        "V1.5: starker Analyzer-Abschlussbeleg erzeugt neue Vertragsinstanz";
    }
  }

    // --------------------------------------------------------
    // TRANSITION nur als kanonisches V3.3-Paar
    // --------------------------------------------------------

    if (
      answer.c ===
      "transition"
    ) {
      const canonicalPair =
        (
          context
            ?.transitionCandidates ??
          []
        )
          .find(
            candidate =>
              candidate.from ===
                answer.cf &&
              candidate.to ===
                answer.ct
          );

      if (
        !canonicalPair ||
        !canonicalPair
          .fromEvidence ||
        !canonicalPair
          .toEvidence
      ) {
        const fallbackKey =
          (
            answer.ck &&
            attachCandidateAllowed(
              answer.ck
            )
          )
            ? answer.ck
            : "";

        answer.c =
          fallbackKey
            ? "attach"
            : (
                (
                  context
                    ?.contractCandidates ??
                  []
                ).length
                  ? "evidence"
                  : "none"
              );

        answer.ck =
          fallbackKey;

        answer.cf = "";
        answer.ct = "";

        answer.cr =
          "V1.5-Sicherheitsgate: TRANSITION ohne kanonisch belegtes V3.3-Paar verworfen";
      }
    }

    // --------------------------------------------------------
    // Erfundenes ck/cf/ct weich entfernen
    // --------------------------------------------------------

    if (
      answer.c ===
        "attach" &&
      !attachCandidateAllowed(
        answer.ck
      )
    ) {
      answer.c =
        (
          context
            ?.contractCandidates
            ?.length
        )
          ? "evidence"
          : "none";

      answer.ck = "";
      answer.cf = "";
      answer.ct = "";

      answer.cr =
        "V1.5-Sicherheitsgate: ATTACH ohne starke Vertragsinstanz-Identitaet verworfen";
    }

    if (
      answer.c ===
        "transition" &&
      (
        !answer.cf ||
        !answer.ct ||
        !allowed.has(
          answer.cf
        ) ||
        !allowed.has(
          answer.ct
        )
      )
    ) {
      answer.c =
        "evidence";

      answer.ck = "";
      answer.cf = "";
      answer.ct = "";

      answer.cr =
        "V1.5: unvollstaendiger Vertragswechsel wurde nicht uebernommen";
    }

    // --------------------------------------------------------
    // NEW braucht Analyzer-Beleg
    // --------------------------------------------------------

    if (
      answer.c ===
        "new" &&
      !explicitNewContractEvidence(
        document
      )
    ) {
      answer.c =
        "none";

      answer.ck = "";
      answer.cf = "";
      answer.ct = "";
      answer.ed = "";

      answer.cc =
        Math.max(
          clamp(
            answer.cc
          ),
          0.95
        );

      answer.cr =
        "V1.5-Sicherheitsgate: kein belastbarer Analyzer-Beleg fuer einen neuen Vertrag";
    }

  // --------------------------------------------------------
  // BQÜ / Bauqualitätsüberwachung
  //
  // Ein Zwischen-/Prüfprotokoll darf den Hausbau nicht
  // abschließen, wenn die Überwachung laut Analyzer weiterläuft.
  // --------------------------------------------------------

  const houseBuildAnalyzerText =
    analyzerSemanticText(
      document
    );

  const isConstructionSupervision =
    /bq[üu]|bauqualit(?:a|ae)t.*(?:u|ue)berwachung|bau(?:u|ue)berwachung|bauprufung|baupruefung/.test(
      houseBuildAnalyzerText
    );

  const constructionStillRunning =
    /prufung in fortsetzung|pruefung in fortsetzung|prufung wird fortgesetzt|pruefung wird fortgesetzt|weitere prufungen|weitere pruefungen|weitere ortstermine|begehungstermine|zusendung eines ablaufplanes|nachste schritte|naechste schritte/.test(
      houseBuildAnalyzerText
    );

  if (
    answer.hb === "build" &&
    isConstructionSupervision
  ) {
    const qualityTrade =
      HOUSE_BUILD_TRADES.find(trade =>
        /bauqualitat.*uberwachung|bauuberwachung|bauprufung/.test(
          normalize(trade.name)
        )
      );

    answer.ht =
      qualityTrade?.id ??
      "U";

    answer.hbc =
      Math.max(
        clamp(
          answer.hbc
        ),
        0.98
      );

    answer.hbr =
      qualityTrade
        ? "V1.5: BQÜ/Bauüberwachung eindeutig dem vorhandenen Hausbauziel zugeordnet"
        : "V1.5: BQÜ/Bauüberwachung als zusätzlicher Hausbauposten erkannt";
  }

  if (
    answer.l === "completed" &&
    answer.lt === "house_build" &&
    isConstructionSupervision &&
    constructionStillRunning
  ) {
    answer.l = "none";
    answer.lt = "none";
    answer.ls = "";
    answer.ld = "";

    answer.lc =
      Math.max(
        clamp(
          answer.lc
        ),
        0.98
      );

    answer.lr =
      "V1.5-Sicherheitsgate: Bauüberwachung läuft weiter; Hausbau nicht abgeschlossen";
  }

    // --------------------------------------------------------
    // Terminaler Lifecycle braucht echten Abschlussbeleg
    // --------------------------------------------------------

    const terminalActions =
      new Set([
        "sold",
        "closed",
        "inactive",
        "completed",
        "deceased"
      ]);

    if (
      terminalActions.has(
        answer.l
      ) &&
      !explicitTerminalEvidence(
        document,
        answer.l
      )
    ) {
      answer.l =
        "none";

      answer.lt =
        "none";

      answer.ls =
        "";

      answer.ld =
        "";

      answer.lc =
        Math.max(
          clamp(
            answer.lc
          ),
          0.95
        );

      answer.lr =
        "V1.5-Sicherheitsgate: kein expliziter terminaler Lifecycle-Beleg";
    }

    if (
      terminalActions.has(
        answer.l
      ) &&
      !normalizeIsoDate(
        answer.ld
      )
    ) {
      answer.ld =
        terminalDateFromAnalyzer(
          document
        ) ||
        normalizeIsoDate(
          document?.date
        ) ||
        "";
    }

    // --------------------------------------------------------
    // Kanonische Transition:
    // bereits beendeter Vorgänger = INACTIVE
    //
    // Wichtig:
    // Nur die konkrete alte Vertragsinstanz wird beendet.
    // Provider, Rufnummer, Zaehler usw. bleiben davon unberuehrt.
    // --------------------------------------------------------

    if (
      answer.c ===
        "transition"
    ) {
      const canonicalTransition =
        (
          context
            ?.transitionCandidates ??
          []
        )
          .find(
            candidate =>
              candidate.from ===
                answer.cf &&
              candidate.to ===
                answer.ct
          );

      const oldEnd =
        normalizeIsoDate(
          canonicalTransition
            ?.fromEnd
        );

      const referenceDate =
        normalizeIsoDate(
          lifecycle?.today
        ) ||
        new Date()
          .toISOString()
          .slice(
            0,
            10
          );

      if (
        canonicalTransition &&
        canonicalTransition
          .fromEvidence &&
        oldEnd &&
        referenceDate &&
        oldEnd <= referenceDate
      ) {
        const oldInstance =
          contractInstanceByKey
            .get(
              canonicalTransition
                .from
            );

        answer.l =
          "inactive";

        answer.lt =
          "contract";

        answer.ls =
          contractPath(
            oldInstance
          ) ||
          (
            (
              canonicalTransition
                .provider ||
              "Vertrag"
            ) +
            " / Altvertrag"
          );

        answer.ld =
          oldEnd;

        answer.lc =
          Math.max(
            clamp(
              answer.lc
            ),
            0.98
          );

        answer.lr =
          "V1.5: kanonische V3.3-Transition beendet die konkrete Vorgänger-Vertragsinstanz";
      }
    }

    // --------------------------------------------------------
    // Folgevertrag mit zukuenftigem Start = PLANNED
    // --------------------------------------------------------

    const selectedKey =
      answer.c ===
        "transition"
        ? answer.ct
        : (
            answer.c ===
              "attach"
              ? answer.ck
              : ""
          );

    const selected =
      selectedKey
        ? (
            (
              context
                ?.contractCandidates ??
              []
            )
              .find(
                candidate =>
                  candidate.key ===
                  selectedKey
              ) ??
            contractInstanceByKey
              .get(
                selectedKey
              )
          )
        : null;

    const status =
      selected
        ? (
            selected.status ??
            contractStatus(
              selected
            )
          )
        : "";

    const startDate =
      selected
        ? (
            selected.start ??
            contractStart(
              selected
            )
          )
        : "";

    // --------------------------------------------------------
    // PLANNED ist nur fuer eine konkrete bekannte
    // zukuenftige Vertragsinstanz erlaubt.
    // --------------------------------------------------------

    if (
      answer.l ===
        "planned" &&
      status !==
        "scheduled"
    ) {
      answer.l =
        "none";

      answer.lt =
        "none";

      answer.ls =
        "";

      answer.ld =
        "";

      answer.lc =
        Math.max(
          clamp(
            answer.lc
          ),
          0.95
        );

      answer.lr =
        "V1.5-Sicherheitsgate: PLANNED ohne konkrete geplante Vertragsinstanz verworfen";
    }

    if (
      status ===
      "scheduled"
    ) {
      answer.l =
        "planned";

      answer.lt =
        "contract";

      answer.ls =
        answer.ls ||
        "Folgevertrag";

      answer.ld =
        normalizeIsoDate(
          startDate
        ) ||
        normalizeIsoDate(
          answer.ed
        ) ||
        "";

      answer.lc =
        Math.max(
          clamp(
            answer.lc
          ),
          0.97
        );

      answer.lr =
        "V1.5: konkrete Vertragsinstanz beginnt erst zukuenftig";
    }

    // --------------------------------------------------------
    // ACTIVE nicht als freies Objekt-Lifecycle erfinden
    // --------------------------------------------------------

    if (
      answer.l ===
        "active"
    ) {
      const data =
        analyzerData(
          document
        );

      const analyzerStatus =
        normalize(
          data
            ?.contract
            ?.status
        );

      const hasActiveContract =
        /aktiv|active/.test(
          analyzerStatus
        ) &&
        [
          "new",
          "attach",
          "transition"
        ]
          .includes(
            answer.c
          );

      const orderWithoutActivation =
        orderProcessEvidence(
          document
        ) &&
        !explicitActivationEvidence(
          document
        );

      if (
        hasActiveContract &&
        !orderWithoutActivation
      ) {
        answer.lt =
          "contract";

        answer.ls =
          data
            ?.contract
            ?.contract_type ??
          answer.ls ??
          "Vertrag";
      } else {
        answer.l =
          "none";

        answer.lt =
          "none";

        answer.ls =
          "";

        answer.ld =
          "";

        answer.lr =
          orderWithoutActivation
            ? "V1.5-Sicherheitsgate: Auftrag/Bestellung ohne Aktivierungs- oder Bereitstellungsbeleg ist nicht ACTIVE"
            : "V1.5: ACTIVE ohne konkrete Vertragsinstanz verworfen";
      }
    }

    return answer;
  };

// ============================================================
// Neutralisierte Primärkandidaten
// ============================================================

const tilePathByUid =
  (() => {
    const result =
      new Map();

    const walk =
      (
        area,
        node,
        names
      ) => {
        const pathNames =
          [
            ...names,
            node.name
          ];

        if (node.uid) {
          result.set(
            node.uid,
            pathNames.join(" / ")
          );
        }

        for (
          const child
          of node.children ?? []
        ) {
          walk(
            area,
            child,
            pathNames
          );
        }
      };

    for (
      const area
      of state.areas ?? []
    ) {
      for (
        const root
        of area.subareas ?? []
      ) {
        walk(
          area,
          root,
          [area.name]
        );
      }
    }

    return result;
  })();

// Neue Paperless-/PersonalLab-Dokumente stehen naturgemäß noch nicht im
// statischen Zuordnungsreport. Für den Dauer-Scanner wird deshalb aus ihrem
// aktuellen Ablageziel ein neutraler Basiseintrag erzeugt. So gelangen neue
// oder nachträglich geänderte Dokumente tatsächlich in die Qwen-Warteschlange,
// ohne ein Ziel zu erfinden, das PersonalLab gar nicht kennt.
const combinedItemForDocument =
  document => {
    const existing =
      combinedById.get(
        Number(document.id)
      );

    if (existing) {
      return existing;
    }

    const currentPath =
      tilePathByUid.get(
        document.tileId
      ) ?? "";

    return {
      id: Number(document.id),
      title: document.title,
      currentPrimaryPath: currentPath,
      primary: currentPath
        ? {
            status: "current",
            target: document.tileId,
            targetPath: currentPath
          }
        : null,
      secondary: (document.secondaryTileIds ?? [])
        .map(uid => ({
          target: uid,
          targetPath: tilePathByUid.get(uid) ?? "",
          alreadyPresent: true
        }))
        .filter(item => item.targetPath),
      cases: [],
      contracts: [],
      evidence: [],
      lifecycleDecision: ""
    };
  };

const primaryCandidates = (
  document,
  item
) => {
  const currentPath =
    String(
      item?.currentPrimaryPath ??
      tilePathByUid.get(
        document.tileId
      ) ??
      ""
    ).trim();

  const rulePath =
    String(
      item?.primary
        ?.targetPath ??
      ""
    ).trim();

  const raw = [];

  if (currentPath) {
    raw.push({
      path:
        currentPath,

      source:
        "current"
    });
  }

  if (
    rulePath &&
    rulePath !==
      currentPath
  ) {
    raw.push({
      path:
        rulePath,

      source:
        "rule"
    });
  }

  if (!raw.length) {
    return {
      shown: [],
      mapping: {}
    };
  }

  // Reihenfolge deterministisch wechseln,
  // damit Qwen keine Position als "aktuell"
  // lernen kann.
  if (
    raw.length === 2 &&
    Number(document.id) %
      2 === 1
  ) {
    raw.reverse();
  }

  const ids =
    ["A", "B"];

  const shown = [];
  const mapping = {};

  raw.forEach(
    (
      candidate,
      index
    ) => {
      const id =
        ids[index];

      shown.push({
        id,
        path:
          candidate.path
      });

      mapping[id] =
        candidate.source;
    }
  );

  return {
    shown,
    mapping
  };
};

// ============================================================
// Querweis-/Vorgangskandidaten
// ============================================================

const secondaryCandidates =
  item =>
    (item?.secondary ?? [])
      .slice(0, 8)
      .map(
        (
          candidate,
          index
        ) => ({
          id:
            `S${index + 1}`,

          path:
            candidate.targetPath ??
            candidate.target ??
            ""
        })
      );

const caseCandidates =
  item =>
    (item?.cases ?? [])
      .slice(0, 8)
      .map(
        (
          candidate,
          index
        ) => ({
          id:
            `C${index + 1}`,

          label:
            candidate.label ??
            candidate.key ??
            ""
        })
      );

// ============================================================
// Qwen-Kontext
// ============================================================

const buildContext = (
  document,
  item
) => {
  const data =
    structuredFor(
      document
    );

  const primary =
    primaryCandidates(
      document,
      item
    );

  const contracts =
    contractCandidates(
      document,
      item
    );

  const transitions =
    transitionCandidatesForDocument(
      document
    );

  const houseBuildRelevant =
    houseBuildSignal(
      document,
      item
    );

  const lifecycleRelevant =
    lifecycleSignal(
      document
    );

  return {
    qwenContext: {
      document: {
        id:
          document.id,

        title:
          document.title,

        sourceTitle:
          document.sourceTitle,

        date:
          document.date,

        correspondent:
          document.correspondent,

        type:
          document.type,

        summary:
          document.analysisSummary,

        category:
          document.analysisCategory,

        keywords:
          (
            document
              .analysisKeywords ??
            []
          ).slice(
            0,
            12
          ),

        structuredSummary:
          data.summary ??
          "",

        facts:
          (
            data.facts ??
            []
          )
            .slice(0, 12)
            .map(
              fact => ({
                key:
                  fact?.key,

                value:
                  compactValue(
                    fact?.value,
                    300
                  )
              })
            ),

        events:
          (
            data.events ??
            []
          )
            .slice(0, 10)
            .map(
              event => ({
                date:
                  event?.date,

                type:
                  event?.type,

                description:
                  compactValue(
                    event?.description,
                    350
                  )
              })
            ),

        contract:
          data.contract ??
          null,

        entities:
          (
            data.entities ??
            []
          )
            .slice(0, 10)
            .map(
              entity => ({
                name:
                  entity?.name,

                type:
                  entity?.type,

                relation:
                  entity?.relation,

                attributes:
                  entity?.attributes
              })
            )
      },

      primaryCandidates:
        primary.shown,

      secondaryCandidates:
        secondaryCandidates(
          item
        ),

      caseCandidates:
        caseCandidates(
          item
        ),

      contractCandidates:
        contracts,

      transitionCandidates:
        transitions,

      houseBuild: {
        relevant:
          houseBuildRelevant,

        trades:
          houseBuildRelevant
            ? HOUSE_BUILD_TRADES
            : []
      },

      lifecycle: {
        relevant:
          lifecycleRelevant
      }
    },

    internal: {
      primaryMapping:
        primary.mapping
    }
  };
};

// ============================================================
// Sehr kompakter Prompt
// ============================================================

const SYSTEM_PROMPT = `
Du pruefst Dokumente semantisch fuer PersonalLab.
Du veraenderst nichts.

Primär:
- Waehle nur A, B oder U.
- A/B sind absichtlich anonymisiert.
- Entscheide nur nach Dokumentinhalt.
- U wenn beide unpassend oder Belege fehlen.
- Entscheidend ist der konkrete Gegenstand des Dokuments.
- Aussteller, Kostentraeger, Bank, Krankenkasse, Behoerde oder Empfaenger sind nicht automatisch Hauptthema.
- Beispiel: Ein Zuschussbescheid fuer Fahrzeugumbau bleibt inhaltlich Fahrzeugumbau; der Kostentraeger ist nur Kontext.

Querweise/Vorgaenge:
- Bewerte nur die vorgegebenen IDs.
- keep, drop oder uncertain.
- Keine neuen IDs erfinden.
- Wenn secondaryCandidates leer ist: s MUSS [] sein.
- Wenn caseCandidates leer ist: k MUSS [] sein.
- Bei s und k niemals Vertragswerte wie none, new, attach oder transition verwenden.

Vertraege:
- Gleicher Anbieter bedeutet nicht gleicher Vertrag.
- Gleiche Rufnummer/Zähler koennen mehrere Vertragsinstanzen haben.
- Eine Kuendigung beendet nur die konkrete Vertragsinstanz.
- attach = Dokument gehoert eindeutig zu vorhandenem Vertrag.
- new = Dokument belegt neue Vertragsinstanz.
- transition = Dokument belegt Wechsel alt -> neu.
- evidence = vertragsbezogen, aber keine sichere Instanzzuordnung.
- none = kein Vertragsdokument.
- unclear = Belege reichen nicht.
- ck/cf/ct duerfen nur Keys aus contractCandidates sein.
- Bei transition: cf=Vorgaenger, ct=Nachfolger, falls eindeutig.
- Niemals Vertragsnummer, Key oder Datum erfinden.

Vertrag / Lifecycle V1.5:
- Verlasse dich fuer Vertragsinhalt vorrangig auf Analyzer-Inhalt, nicht auf alte manuelle Titel oder Dokumenttypen.
- new nur bei konkretem Vertragsabschluss, Auftragsbestaetigung oder anderem belastbaren Vertragsbeleg.
- Ein Angebot allein ist KEIN neuer Vertrag.
- Eine Rechnung allein ist KEIN neuer Vertrag.
- Kauf eines Fahrzeugs bedeutet NICHT sold. sold meint, dass der Nutzer das bisherige Fahrzeug verkauft/abgemeldet/ausser Betrieb gesetzt hat.
- Verkaufsbegriffe eines Autohauses duerfen deshalb nicht automatisch sold erzeugen.
- Kuendigungsfrist ist KEINE Kuendigung.
- inactive nur bei wirklicher Beendigung, Kuendigung, Aufhebung oder Stornierung.
- closed nur bei wirklicher Konto-/Account-Schliessung.
- transitionCandidates stammen aus Lifecycle V3.3; vorhandene from/to-Keys exakt verwenden und keine erfinden.
- planned bedeutet: konkrete Vertragsinstanz ist vorhanden, beginnt aber erst zukuenftig.

Hausbau:
- "build" nur fuer die urspruengliche Bauphase des Hauses.
- Spaetere Reparatur, Wartung oder Modernisierung ist NICHT Hausbau.
- Wenn build, waehle ht nur aus houseBuild.trades.
- Gibt es kein passendes Gewerk, ht="U".
- Das Haus selbst bleibt nach Fertigstellung AKTIV.
- Nur der Vorgang Hausbau kann "completed" sein.
- Keine leeren oder erfundenen Gewerke anlegen.

Objekt-Lifecycle:
- Nur echte einzelne Objekte/Vorgaenge bewerten.
- Fahrzeugverkauf => sold.
- Geschlossenes Konto, z.B. Coinbase => closed.
- Beendeter Hausbau => completed mit Typ house_build.
- Verstorbenes Tier => deceased.
- Ein Anbieter, eine Kategorie oder "Fahrzeuge" insgesamt darf niemals beendet werden.
- Ein neuer Vertrag beim gleichen Anbieter reaktiviert keinen alten Vertrag.
- Wenn kein klares Lifecycle-Ereignis vorliegt: l="none".
- ls benennt nur das betroffene Objekt aus dem Dokument, nichts erfinden.

Confidence misst Sicherheit DER GEWAEHLTEN Entscheidung.
pc und cc muessen diese Sicherheit ausdruecken.
Bei einer konkreten Entscheidung normalerweise 0.50 bis 1.00.
0 nur wenn wirklich keine Einschaetzung moeglich ist.

Antworte NUR als kompaktes gueltiges JSON.
Keine Markdown-Fences.
Gruende maximal 15 Woerter.
`;

const buildUserPrompt = (
  context,
  strict = false
) => `
/no_think

${strict
  ? `DEINE VORHERIGE AUSGABE WAR UNGUELTIG.
Gib fuer jedes Feld GENAU EINEN erlaubten Wert aus.
Keine Listen wie "A|B|U".
`
  : ""}

Kontext:
${JSON.stringify(context)}

Ausgabe exakt:

{
  "p":"A|B|U",
  "pc":0.0,
  "pr":"kurzer Grund",
  "s":[["S1","keep|drop|uncertain",0.0]],
  "k":[["C1","keep|drop|uncertain",0.0]],
  "c":"attach|new|transition|evidence|none|unclear",
  "ck":"",
  "cf":"",
  "ct":"",
  "ed":"",
  "cc":0.0,
  "cr":"kurzer Grund",

  "hb":"none|build|unclear",
  "ht":"T1|T2|U",
  "hbc":0.0,
  "hbr":"kurzer Grund",

  "l":"none|sold|closed|inactive|completed|deceased|active|planned|unclear",
  "lt":"vehicle|account|house_build|pet|contract|other|none",
  "ls":"",
  "ld":"",
  "lc":0.0,
  "lr":"kurzer Grund",

  "x":[]
}

Wichtig:
Die Zeichen mit | oben zeigen erlaubte EINZELWERTE.
Du darfst das | NICHT in der Antwort verwenden.
Nicht vorhandene S-/C-Kandidaten als leere Arrays.
ck nur fuer attach.
cf/ct nur fuer transition.
ed nur wenn ein relevantes Wirksamkeitsdatum eindeutig belegt ist.
`;

// ============================================================
// Ollama
// ============================================================

const fetchWithTimeout =
  async (
    url,
    options,
    timeout
  ) => {
    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        timeout
      );

    try {
      return await fetch(
        url,
        {
          ...options,
          signal:
            controller.signal
        }
      );
    } finally {
      clearTimeout(
        timer
      );
    }
  };

const parseJsonLoose =
  text => {
    let value =
      String(text ?? "")
        .trim();

    value =
      value
        .replace(
          /^```(?:json)?/i,
          ""
        )
        .replace(
          /```$/,
          ""
        )
        .trim();

    const first =
      value.indexOf("{");

    const last =
      value.lastIndexOf("}");

    if (
      first >= 0 &&
      last > first
    ) {
      value =
        value.slice(
          first,
          last + 1
        );
    }

    return JSON.parse(value);
  };

const callQwen =
  async (
    context,
    {
      strict = false,
      numPredict = 520
    } = {}
  ) => {
    const response =
      await fetchWithTimeout(
        `${OLLAMA_URL}/api/chat`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              model:
                MODEL,

              stream:
                false,

              think:
                false,

              format:
                "json",

              keep_alive:
                "30m",

              options: {
                temperature:
                  0.05,

                num_ctx:
                  8192,

                num_predict:
                  numPredict
              },

              messages: [
                {
                  role:
                    "system",

                  content:
                    `${SYSTEM_PROMPT}
${navigationTaxonomyInstruction}`
                },
                {
                  role:
                    "user",

                  content:
                    buildUserPrompt(
                      context,
                      strict
                    )
                }
              ]
            })
        },
        REQUEST_TIMEOUT_MS
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `Ollama HTTP ${response.status}`
      );
    }

    const payload =
      await response.json();

    const content =
      payload?.message
        ?.content ??
      "";

    if (!content) {
      throw new Error(
        "Leere Qwen-Antwort"
      );
    }

    return {
      parsed:
        parseJsonLoose(
          content
        ),

      raw:
        content,

      metrics: {
        totalDuration:
          payload.total_duration ??
          null,

        evalCount:
          payload.eval_count ??
          null,

        promptEvalCount:
          payload
            .prompt_eval_count ??
          null
      }
    };
  };

// ============================================================
// Antwort validieren
// ============================================================

const primaryValues =
  new Set([
    "A",
    "B",
    "U"
  ]);

const relationValues =
  new Set([
    "keep",
    "drop",
    "uncertain"
  ]);

const contractValues =
  new Set([
    "attach",
    "new",
    "transition",
    "evidence",
    "none",
    "unclear"
  ]);

const houseBuildValues =
  new Set([
    "none",
    "build",
    "unclear"
  ]);

const lifecycleValues =
  new Set([
    "none",
    "sold",
    "closed",
    "inactive",
    "completed",
    "deceased",
    "active",
    "planned",
    "unclear"
  ]);

const lifecycleTypes =
  new Set([
    "vehicle",
    "account",
    "house_build",
    "pet",
    "other",
    "contract",
    "none"
  ]);

const normalizeArrayDecision =
  value => {
    if (
      !Array.isArray(value) ||
      value.length < 3
    ) {
      return null;
    }

    return [
      String(value[0]),
      String(value[1]),
      clamp(value[2])
    ];
  };

const validateAnswer = (
  answer,
  context
) => {
  const errors = [];

  if (
    !answer ||
    typeof answer !==
      "object"
  ) {
    return [
      "Antwort ist kein Objekt"
    ];
  }

  if (
    !primaryValues.has(
      answer.p
    )
  ) {
    errors.push(
      "p ungueltig"
    );
  }

  const availablePrimary =
    new Set(
      context
        .primaryCandidates
        .map(
          candidate =>
            candidate.id
        )
    );

  if (
    answer.p !== "U" &&
    !availablePrimary.has(
      answer.p
    )
  ) {
    errors.push(
      "p verweist auf nicht vorhandenen Kandidaten"
    );
  }

  if (
    !contractValues.has(
      answer.c
    )
  ) {
    errors.push(
      "c ungueltig"
    );
  }

  const contractKeys =
    new Set(
      [
        ...(
          context
            .contractCandidates ??
          []
        )
          .map(
            candidate =>
              candidate.key
          ),

        ...(
          context
            .transitionCandidates ??
          []
        )
          .flatMap(
            candidate => [
              candidate.from,
              candidate.to
            ]
          )
      ]
        .filter(Boolean)
    );

  if (
    answer.c ===
      "attach"
  ) {
    if (
      !answer.ck ||
      !contractKeys.has(
        answer.ck
      )
    ) {
      // V1.5:
      // Ungueltiges ck wird beim
      // Normalisieren weich bereinigt.
    }
  }

  if (
    answer.c ===
      "transition"
  ) {
    if (
      answer.cf &&
      !contractKeys.has(
        answer.cf
      )
    ) {
      // V1.5:
      // Ungueltiges cf wird beim
      // Normalisieren weich bereinigt.
    }

    if (
      answer.ct &&
      !contractKeys.has(
        answer.ct
      )
    ) {
      // V1.5:
      // Ungueltiges ct wird beim
      // Normalisieren weich bereinigt.
    }
  }

  // Datumsformate werden beim Normalisieren weich behandelt.

  // Secondary und Case werden absichtlich NICHT
  // als kritische Validierungsfehler behandelt.
  // Ungueltige Eintraege werden beim Normalisieren
  // einfach entfernt.

  return errors;
};

// ============================================================
// Antwort normalisieren
// ============================================================

const normalizeAnswer = (
  answer,
  internal,
  context,
  document
) => {
  answer =
    applyRawSafetyGuards(
      answer,
      context,
      document
    );

  const primarySource =
    answer.p === "U"
      ? "uncertain"
      : (
          internal
            .primaryMapping[
              answer.p
            ] ??
          "unknown"
        );

  let primaryDecision =
    "uncertain";

  if (
    primarySource ===
    "current"
  ) {
    primaryDecision =
      "keep_current";
  }

  if (
    primarySource ===
    "rule"
  ) {
    primaryDecision =
      "accept_rule";
  }

  const secondaryIds =
    new Set(
      context
        .secondaryCandidates
        .map(
          candidate =>
            candidate.id
        )
    );

  const caseIds =
    new Set(
      context
        .caseCandidates
        .map(
          candidate =>
            candidate.id
        )
    );

  const cleanRelations = (
    values,
    allowedIds
  ) =>
    (
      Array.isArray(values)
        ? values
        : []
    )
      .map(
        normalizeArrayDecision
      )
      .filter(Boolean)
      .filter(
        (
          [
            id,
            decision
          ]
        ) =>
          allowedIds.has(id) &&
          relationValues.has(
            decision
          )
      )
      .map(
        (
          [
            id,
            decision,
            confidence
          ]
        ) => ({
          id,
          decision,
          confidence
        })
      );

  const secondary =
    cleanRelations(
      answer.s,
      secondaryIds
    );

  const cases =
    cleanRelations(
      answer.k,
      caseIds
    );

  const houseBuildAction =
    houseBuildValues.has(
      answer.hb
    )
      ? answer.hb
      : "unclear";

  const tradeCandidates =
    context
      .houseBuild
      ?.trades ??
    [];

  const selectedTrade =
    tradeCandidates.find(
      candidate =>
        candidate.id ===
        answer.ht
    );

  const lifecycleAction =
    lifecycleValues.has(
      answer.l
    )
      ? answer.l
      : "unclear";

  const lifecycleType =
    lifecycleTypes.has(
      answer.lt
    )
      ? answer.lt
      : "none";

  return {
    primary: {
      candidate:
        answer.p,

      decision:
        primaryDecision,

      confidence:
        clamp(
          answer.pc
        ),

      reason:
        String(
          answer.pr ??
          ""
        )
    },

    secondary,

    cases,

    contract: {
      action:
        answer.c,

      candidateKey:
        String(
          answer.ck ??
          ""
        ),

      predecessorKey:
        String(
          answer.cf ??
          ""
        ),

      successorKey:
        String(
          answer.ct ??
          ""
        ),

      effectiveDate:
        normalizeIsoDate(
          answer.ed
        ),

      confidence:
        clamp(
          answer.cc
        ),

      reason:
        String(
          answer.cr ??
          ""
        )
    },

    houseBuild: {
      action:
        houseBuildAction,

      tradeId:
        selectedTrade
          ?.id ??
        (
          answer.ht === "U"
            ? "U"
            : ""
        ),

      tradeLabel:
        selectedTrade
          ?.name ??
        "",

      confidence:
        clamp(
          answer.hbc
        ),

      reason:
        String(
          answer.hbr ??
          ""
        )
    },

    lifecycle: {
      action:
        lifecycleAction,

      subjectType:
        lifecycleType,

      subject:
        String(
          answer.ls ??
          ""
        )
          .trim()
          .slice(0, 120),

      effectiveDate:
        normalizeIsoDate(
          answer.ld
        ),

      confidence:
        clamp(
          answer.lc
        ),

      reason:
        String(
          answer.lr ??
          ""
        )
    },

    conflicts:
      Array.isArray(
        answer.x
      )
        ? answer.x
            .slice(0, 4)
            .map(String)
        : []
  };
};

// ============================================================
// Prioritaeten
// ============================================================

const goldIds =
  new Set([
    318,
    624,
    317,
    806,
    838,
    845,
    1254,
    1243,
    1475,
    1921,
    1923,
    2556,
    2618,
    2619,
    398,
    399,
    1176,
    2087,
    2107,
    2112,
    2162,
    2201,
    2230,
    2531,
    2533,
    2603,
    2608
  ]);

const priorityFor =
  (
    document,
    item
  ) => {
    const id =
      Number(
        document.id
      );

    if (
      goldIds.has(id)
    ) {
      return 0;
    }

    if (
      houseBuildSignal(
        document,
        item
      ) ||
      lifecycleSignal(
        document
      )
    ) {
      return 1;
    }

    if (
      item
        ?.lifecycleDecision ===
        "possible-new-contract"
    ) {
      return 1;
    }

    if (
      /transition|new-contract/i
        .test(
          String(
            item
              ?.lifecycleDecision ??
            ""
          )
        )
    ) {
      return 1;
    }

    if (
      (
        item?.contracts ??
        []
      ).length ||
      (
        item?.evidence ??
        []
      ).length
    ) {
      return 2;
    }

    if (
      item?.primary
        ?.status ===
        "suggest"
    ) {
      return 3;
    }

    if (
      item?.primary
        ?.status ===
        "review"
    ) {
      return 4;
    }

    if (
      (
        item?.secondary ??
        []
      ).length ||
      (
        item?.cases ??
        []
      ).length
    ) {
      return 5;
    }

    return 6;
  };

// ============================================================
// Kandidatenliste
// ============================================================

const queue =
  documents
    .map(
      document => ({
        item:
          combinedItemForDocument(
            document
          ),

        document
      })
    )
    .filter(
      entry =>
        Boolean(
          entry.document
        ) &&
        (
          FILTER_IDS.size > 0
            ? FILTER_IDS.has(
                Number(
                  entry.document.id
                )
              )
            : relevantByDate(
                entry.document
              )
        )
    )
    .sort(
      (a, b) => {
        const pa =
          priorityFor(
            a.document,
            a.item
          );

        const pb =
          priorityFor(
            b.document,
            b.item
          );

        if (pa !== pb) {
          return pa - pb;
        }

        return (
          Number(
            a.document.id
          ) -
          Number(
            b.document.id
          )
        );
      }
    );

// ============================================================
// Resume / Report
// ============================================================

const eligibleDocumentIds =
  queue.map(entry =>
    Number(entry.document.id)
  );

const reportSource = {
  stateFileSha256:
    sha256File(STATE_FILE),

  stateContentSha256:
    stateContentSha256(state),

  combinedFileSha256:
    sha256File(COMBINED_FILE),

  lifecycleFileSha256:
    sha256File(LIFECYCLE_FILE),

  navigationTaxonomyFile:
    NAVIGATION_TAXONOMY_FILE,

  navigationTaxonomyFileSha256:
    fs.existsSync(NAVIGATION_TAXONOMY_FILE)
      ? sha256File(NAVIGATION_TAXONOMY_FILE)
      : null,

  stateRevision:
    state.revision ?? "",

  documentCount:
    documents.length,

  eligibleDocumentCount:
    eligibleDocumentIds.length,

  eligibleDocumentIdsSha256:
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify(
          eligibleDocumentIds
        )
      )
      .digest("hex")
};

let report = {
  version:
    "qwen-shadow-v1.5",

  model:
    MODEL,

  dryRun:
    true,

  createdAt:
    new Date()
      .toISOString(),

  updatedAt:
    new Date()
      .toISOString(),

  source:
    reportSource,

  config: {
    hours:
      HOURS,

    maxDocuments:
      MAX_DOCS,

    requestTimeoutMs:
      REQUEST_TIMEOUT_MS
  },

  results: []
};

if (
  !RESET &&
  fs.existsSync(
    OUTPUT_FILE
  )
) {
  try {
    const previous =
      JSON.parse(
        fs.readFileSync(
          OUTPUT_FILE,
          "utf8"
        )
      );

    if (
      previous.version ===
        "qwen-shadow-v1.5" &&
      Array.isArray(
        previous.results
      )
    ) {
      if (
        !previous.source ||
        previous.source.stateContentSha256 !==
          reportSource.stateContentSha256 ||
        previous.source.combinedFileSha256 !==
          reportSource.combinedFileSha256 ||
        previous.source.lifecycleFileSha256 !==
          reportSource.lifecycleFileSha256 ||
        previous.source.eligibleDocumentIdsSha256 !==
          reportSource.eligibleDocumentIdsSha256
      ) {
        throw new Error(
          "Vorhandener Report gehört zu einem anderen Quellstand. QWEN_SHADOW_RESET=1 und eine neue Ausgabedatei verwenden."
        );
      }

      report =
        previous;

      console.log(
        `Resume: ${report.results.length} vorhandene Ergebnisse geladen.`
      );
    }
  } catch (error) {
    console.error(
      "Vorhandener Report konnte nicht geladen werden:",
      error.message
    );

    process.exit(65);
  }
}

const processedIds =
  new Set(
    report.results.map(
      result =>
        Number(
          result.id
        )
    )
  );

const saveReport = () => {
  report.updatedAt =
    new Date()
      .toISOString();

  const temp =
    `${OUTPUT_FILE}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    temp,
    OUTPUT_FILE
  );
};

// ============================================================
// Shadow-Lauf
// ============================================================

const startTime =
  Date.now();

const deadline =
  startTime +
  BUDGET_MS;

let processedThisRun = 0;
let successfulThisRun = 0;
let failedThisRun = 0;
let retriesThisRun = 0;

console.log(
  "=== PersonalLab Qwen Shadow V1.5 ==="
);

console.log(
  `Modell: ${MODEL}`
);

console.log(
  `Dokumente gesamt: ${queue.length}`
);

console.log(
  `Bereits vorhanden: ${processedIds.size}`
);

console.log(
  `Zeitbudget: ${HOURS} Stunden`
);

console.log(
  `Maximal neue Dokumente: ${MAX_DOCS}`
);

console.log(
  "personallab.json wird NICHT verändert."
);

console.log();

for (
  const entry
  of queue
) {
  if (
    processedThisRun >=
    MAX_DOCS
  ) {
    console.log(
      "Dokumentlimit erreicht."
    );

    break;
  }

  const remaining =
    deadline -
    Date.now();

  if (
    remaining <=
    SAFETY_MS
  ) {
    console.log(
      "Zeitbudget erreicht."
    );

    break;
  }

  const document =
    entry.document;

  const item =
    entry.item;

  const id =
    Number(
      document.id
    );

  if (
    processedIds.has(id)
  ) {
    continue;
  }

  processedThisRun++;

  const elapsed =
    Date.now() -
    startTime;

  const average =
    processedThisRun > 1
      ? elapsed /
        (
          processedThisRun -
          1
        )
      : 0;

  console.log(
    `[${processedThisRun}] ID ${id}: ${document.title}`
  );

  console.log(
    `  Restzeit: ${formatDuration(remaining)}${average ? ` | Ø ${Math.round(average / 1000)} s/Dok.` : ""}`
  );

  const {
    qwenContext,
    internal
  } =
    buildContext(
      document,
      item
    );

  const started =
    Date.now();

  let finalResult = null;
  let validationErrors = [];
  let raw = "";
  let metrics = null;
  let usedRetry = false;
  let errorMessage = "";

  try {
    const first =
      await callQwen(
        qwenContext,
        {
          strict:
            false,

          numPredict:
            420
        }
      );

    raw =
      first.raw;

    metrics =
      first.metrics;

    validationErrors =
      validateAnswer(
        first.parsed,
        qwenContext
      );

    if (
      validationErrors.length
    ) {
      usedRetry = true;
      retriesThisRun++;

      console.log(
        `  Retry: ${validationErrors.join("; ")}`
      );

      await sleep(500);

      const second =
        await callQwen(
          qwenContext,
          {
            strict:
              true,

            numPredict:
              650
          }
        );

      raw =
        second.raw;

      metrics =
        second.metrics;

      validationErrors =
        validateAnswer(
          second.parsed,
          qwenContext
        );

      if (
        validationErrors.length
      ) {
        throw new Error(
          `Auch Retry ungueltig: ${validationErrors.join("; ")}`
        );
      }

      finalResult =
        normalizeAnswer(second.parsed, internal, qwenContext, document);
    } else {
      finalResult =
        normalizeAnswer(first.parsed, internal, qwenContext, document);
    }
  } catch (firstError) {
    // Netzwerk-/JSON-Fehler bekommt
    // ebenfalls genau einen zweiten Versuch.
    if (!usedRetry) {
      usedRetry = true;
      retriesThisRun++;

      console.log(
        `  Retry nach Fehler: ${firstError.message}`
      );

      try {
        await sleep(1000);

        const second =
          await callQwen(
            qwenContext,
            {
              strict:
                true,

              numPredict:
                850
            }
          );

        raw =
          second.raw;

        metrics =
          second.metrics;

        validationErrors =
          validateAnswer(
            second.parsed,
            qwenContext
          );

        if (
          validationErrors.length
        ) {
          throw new Error(
            validationErrors
              .join("; ")
          );
        }

        finalResult =
          normalizeAnswer(second.parsed, internal, qwenContext, document);
      } catch (secondError) {
        errorMessage =
          secondError.message;
      }
    } else {
      errorMessage =
        firstError.message;
    }
  }

  const durationMs =
    Date.now() -
    started;

  if (finalResult) {
    successfulThisRun++;

    console.log(
      `  Primär: ${finalResult.primary.decision} (${Math.round(finalResult.primary.confidence * 100)} %)`
    );

    console.log(
      `  Vertrag: ${finalResult.contract.action} (${Math.round(finalResult.contract.confidence * 100)} %)`
    );

    if (
      finalResult
        .contract
        .predecessorKey ||
      finalResult
        .contract
        .successorKey
    ) {
      console.log(
        `  Wechsel: ${finalResult.contract.predecessorKey || "-"} -> ${finalResult.contract.successorKey || "-"}`
      );
    }

    report.results.push({
      id,

      title:
        document.title,

      priority:
        priorityFor(
          document,
          item
        ),

      durationMs,

      retried:
        usedRetry,

      input: {
        primaryCandidates:
          qwenContext
            .primaryCandidates,

        secondaryCandidates:
          qwenContext
            .secondaryCandidates,

        caseCandidates:
          qwenContext
            .caseCandidates,

        contractCandidates:
          qwenContext
            .contractCandidates,

        transitionCandidates:
          qwenContext
            .transitionCandidates,

        houseBuild:
          qwenContext
            .houseBuild,

        lifecycle:
          qwenContext
            .lifecycle
      },

      result:
        finalResult,

      metrics,

      raw:
        compactValue(
          raw,
          1600
        )
    });
  } else {
    failedThisRun++;

    console.log(
      `  FEHLER: ${errorMessage || "unbekannt"}`
    );

    report.results.push({
      id,

      title:
        document.title,

      priority:
        priorityFor(
          document,
          item
        ),

      durationMs,

      retried:
        usedRetry,

      error:
        errorMessage ||
        "Unbekannter Fehler",

      validationErrors,

      raw:
        compactValue(
          raw,
          2000
        )
    });
  }

  processedIds.add(id);

  saveReport();

  console.log();
}

// ============================================================
// Zusammenfassung
// ============================================================

const elapsed =
  Date.now() -
  startTime;

const allSuccess =
  report.results.filter(
    item =>
      item.result
  );

const allErrors =
  report.results.filter(
    item =>
      item.error
  );

const primaryCounts = {};

const contractCounts = {};

for (
  const item
  of allSuccess
) {
  const primary =
    item.result.primary
      ?.decision ??
    "missing";

  const contract =
    item.result.contract
      ?.action ??
    "missing";

  primaryCounts[primary] =
    (
      primaryCounts[primary] ??
      0
    ) + 1;

  contractCounts[contract] =
    (
      contractCounts[contract] ??
      0
    ) + 1;
}

const countActions =
  selector => {
    const counts = {};

    for (
      const item
      of allSuccess
    ) {
      const value =
        selector(item) ??
        "missing";

      counts[value] =
        (
          counts[value] ??
          0
        ) + 1;
    }

    return counts;
  };

const houseBuildCounts =
  countActions(
    item =>
      item.result
        ?.houseBuild
        ?.action
  );

const lifecycleCounts =
  countActions(
    item =>
      item.result
        ?.lifecycle
        ?.action
  );

report.summary = {
  totalResults:
    report.results.length,

  successful:
    allSuccess.length,

  errors:
    allErrors.length,

  remaining:
    Math.max(
      0,
      queue.length -
      processedIds.size
    ),

  lastRun: {
    elapsedMs:
      elapsed,

    elapsed:
      formatDuration(
        elapsed
      ),

    processed:
      processedThisRun,

    successful:
      successfulThisRun,

    failed:
      failedThisRun,

    retries:
      retriesThisRun,

    averageSeconds:
      processedThisRun
        ? Number(
            (
              elapsed /
              processedThisRun /
              1000
            ).toFixed(1)
          )
        : 0
  },

  primary:
    primaryCounts,

  contract:
    contractCounts,

  houseBuild:
    houseBuildCounts,

  lifecycle:
    lifecycleCounts,

  relevantFrom:
    RELEVANT_FROM
};

saveReport();

console.log(
  "=== Zusammenfassung ==="
);

console.log(
  JSON.stringify(
    report.summary,
    null,
    2
  )
);

console.log();

console.log(
  `Report: ${OUTPUT_FILE}`
);

console.log(
  "personallab.json wurde NICHT verändert."
);

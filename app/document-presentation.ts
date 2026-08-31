export type DocumentPresentationInput = {
  id?: number;
  title?: string;
  type?: string;
  correspondent?: string;
  date?: string;
  area?: string;
  subarea?: string;
  analysisSummary?: string;
  tags?: string[];
};

export type DocumentSortDirection = "desc" | "asc";

const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function validMonth(value: string | undefined) {
  const month = Number(value);
  return month >= 1 && month <= 12 ? month : undefined;
}

function periodFromTitle(title: string, type: string) {
  const statement = title.match(/(?:auszug|abrechnung)[^\d]*(20\d{2})[_\s-]+0{0,3}(0?[1-9]|1[0-2])(?:\D|$)/i);
  if (statement) return { year: statement[1], month: validMonth(statement[2]) };
  const monthFirst = title.match(/\b(0?[1-9]|1[0-2])[-_.\s/]((?:19|20)\d{2})\b/);
  if (monthFirst) return { year: monthFirst[2], month: validMonth(monthFirst[1]) };
  const yearFirst = title.match(/\b((?:19|20)\d{2})[-_.\s/](0?[1-9]|1[0-2])\b/);
  if (yearFirst) return { year: yearFirst[1], month: validMonth(yearFirst[2]) };
  const compact = title.match(/\b((?:19|20)\d{2})(0[1-9]|1[0-2])(?:[0-3]\d)?\b/);
  if (compact) return { year: compact[1], month: validMonth(compact[2]) };
  if (/gehalt|lohn|steuerbescheinigung|kontoauszug|depotauszug/i.test(`${title} ${type}`)) {
    const yearOnly = title.match(/\b((?:19|20)\d{2})\b/);
    if (yearOnly) return { year: yearOnly[1], month: undefined };
  }
  return null;
}

function periodFromDate(date: string) {
  const german = date.match(/^(\d{2})\.(\d{2})\.((?:19|20)\d{2})$/);
  if (german) return { year: german[3], month: validMonth(german[2]) };
  const iso = date.match(/^((?:19|20)\d{2})-(\d{2})-(\d{2})/);
  if (iso) return { year: iso[1], month: validMonth(iso[2]) };
  const year = date.match(/\b((?:19|20)\d{2})\b/);
  return year ? { year: year[1], month: undefined } : null;
}

export function documentPeriod(document: DocumentPresentationInput) {
  return periodFromTitle(String(document.title ?? ""), String(document.type ?? "")) ?? periodFromDate(String(document.date ?? ""));
}

export function documentYear(document: DocumentPresentationInput) {
  return documentPeriod(document)?.year ?? "Ohne Jahr";
}

function readableDate(date: string) {
  const period = periodFromDate(date);
  if (!period) return "";
  return period.month ? `${monthNames[period.month - 1]} ${period.year}` : period.year;
}

function clean(value: string) {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").replace(/\s+-\s+/g, " – ").trim();
}

function knownCorrespondent(value: string) {
  const candidate = clean(value);
  return candidate && !/^Nicht (?:erkannt|eindeutig)/i.test(candidate) ? candidate : "";
}

function knownDocumentType(value: string) {
  const candidate = clean(value);
  return candidate && !/^Nicht (?:erkannt|eindeutig)/i.test(candidate) ? candidate : "";
}

function readableFullDate(date: string) {
  const german = date.match(/^(\d{2})\.(\d{2})\.((?:19|20)\d{2})$/);
  if (german) return `${Number(german[1])}. ${monthNames[Number(german[2]) - 1]} ${german[3]}`;
  const iso = date.match(/^((?:19|20)\d{2})-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[3])}. ${monthNames[Number(iso[2]) - 1]} ${iso[1]}`;
  return clean(date);
}

function summaryKind(summary: string, document: DocumentPresentationInput) {
  const candidates: Array<[RegExp, string]> = [
    [/kinderwunschbehandlung|icsi|tese|sterilität/i, "Kinderwunschbehandlung"],
    [/ambulanzbericht/i, "Ambulanzbericht"],
    [/entlassungsbericht/i, "Entlassungsbericht"],
    [/neuro-urologischer befundbericht|befundbericht/i, "Befundbericht"],
    [/arztbrief/i, "Arztbrief"],
    [/arztbericht|medizinischer bericht|bericht über/i, "Medizinischer Bericht"],
    [/krankenhausaufnahmevertrag|aufnahmevertrag/i, "Aufnahmevertrag"],
    [/liegebescheinigung/i, "Liegebescheinigung"],
    [/termin.*(?:verschoben|vereinbart|aufnahme)|terminmitteilung/i, "Terminmitteilung"],
    [/lohnabrechnung|gehaltsabrechnung|arbeitsabrechnung/i, "Gehaltsabrechnung"],
    [/jahresabrechnung.*strom|stromlieferung.*zählerstand/i, "Stromabrechnung"],
    [/rechnung/i, "Rechnung"],
    [/kündigung/i, "Kündigung"],
    [/vertrag/i, "Vertrag"],
    [/bescheid/i, "Bescheid"],
    [/bescheinigung/i, "Bescheinigung"],
  ];
  const match = candidates.find(([pattern]) => pattern.test(summary));
  if (match) return match[1];
  const type = knownDocumentType(String(document.type ?? ""));
  if (type) return type;
  if (document.area === "health") return "Medizinischer Bericht";
  return "Dokument";
}

function summaryTopics(summary: string) {
  const candidates: Array<[RegExp, string]> = [
    [/icsi|tese/i, "ICSI/TESE"],
    [/plexusläsion|plexuslähmung/i, "Plexusläsion"],
    [/querschnittlähmung|tetraparese/i, "Querschnittlähmung"],
    [/blasenfunktionsstörung|neuro-urolog/i, "Blasenfunktionsstörung"],
    [/handfunktionsstörung|handfunktion|handchirurg/i, "Handfunktion"],
    [/arbeitsunfall|wegeunfall/i, "Arbeitsunfall"],
    [/sterilität|kinderwunsch/i, "Kinderwunsch"],
    [/stationär(?:e|en|er)? behandlung/i, "Stationäre Behandlung"],
    [/rehabilitation|\breha\b/i, "Rehabilitation"],
    [/therapie|nachsorge/i, "Therapie & Nachsorge"],
    [/zählerstand/i, "Zählerstand"],
  ];
  return candidates.filter(([pattern]) => pattern.test(summary)).map(([, label]) => label).filter((label, index, values) => values.indexOf(label) === index).slice(0, 2);
}

function needsGeneratedTitle(title: string) {
  return !title
    || /^import\b/i.test(title)
    || /^paperless\b/i.test(title)
    || /^re\d+$/i.test(title)
    || /^(?:krankenhaus|dokument|scan|brief|beleg|unterlage)[ _-]*\d+$/i.test(title)
    || /^kinderwunsch(?:\s+kopie)?$/i.test(title)
    || /^\d{1,2}[.-]\d{1,2}[.-](?:19|20)?\d{2}(?:[-_ ]\d+)?$/i.test(title)
    || /^\d{1,2}[-.]\d{4}(?:\s|$)/.test(title)
    || /^\d{4}[-.]\d{1,2}(?:\s|$)/.test(title);
}

export function documentSummary(document: DocumentPresentationInput, maxLength = 180) {
  const summary = clean(String(document.analysisSummary ?? ""));
  if (!summary) {
    const type = knownDocumentType(String(document.type ?? "")) || "Dokument";
    const correspondent = knownCorrespondent(String(document.correspondent ?? ""));
    const date = readableFullDate(String(document.date ?? ""));
    return [`${type}${correspondent ? ` von ${correspondent}` : ""}`, date ? `vom ${date}` : ""].filter(Boolean).join(" ") + ".";
  }
  if (summary.length <= maxLength) return summary;
  const sentence = summary.slice(0, maxLength + 1).match(/^(.{40,}?[.!?])(?:\s|$)/)?.[1];
  if (sentence && sentence.length <= maxLength) return sentence;
  const shortened = summary.slice(0, maxLength - 1).replace(/\s+\S*$/, "").replace(/[,:;\s]+$/, "");
  return `${shortened}…`;
}

function generatedDocumentTitle(document: DocumentPresentationInput, summary: string) {
  const kind = summaryKind(summary, document);
  const topics = summaryTopics(summary).filter(topic => !kind.toLowerCase().includes(topic.toLowerCase()));
  const correspondent = topics.length ? "" : knownCorrespondent(String(document.correspondent ?? ""));
  const date = readableDate(String(document.date ?? ""));
  return [kind, topics.length ? topics.join(" & ") : correspondent, date].filter(Boolean).join(" · ");
}

function sortableDate(value: string) {
  const german = value.match(/^(\d{2})\.(\d{2})\.((?:19|20)\d{2})$/);
  if (german) return `${german[3]}-${german[2]}-${german[1]}`;
  const iso = value.match(/^((?:19|20)\d{2})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "0000-00-00";
}

export function sortDocumentsByDate<T extends DocumentPresentationInput>(documents: T[], direction: DocumentSortDirection) {
  const multiplier = direction === "desc" ? -1 : 1;
  return [...documents].sort((left, right) => {
    const dateOrder = sortableDate(String(left.date ?? "")).localeCompare(sortableDate(String(right.date ?? "")));
    if (dateOrder) return dateOrder * multiplier;
    return (Number(left.id ?? 0) - Number(right.id ?? 0)) * multiplier;
  });
}

export function friendlyDocumentTitle(document: DocumentPresentationInput) {
  const title = clean(String(document.title ?? ""));
  const type = clean(String(document.type ?? "")) || "Dokument";
  const correspondent = knownCorrespondent(String(document.correspondent ?? ""));
  const period = documentPeriod(document);
  const periodLabel = period ? `${period.month ? `${monthNames[period.month - 1]} ` : ""}${period.year}` : readableDate(String(document.date ?? ""));
  const context = `${title} ${type}`;

  if (/gehalt|lohnzettel|entgeltabrechnung/i.test(context) && !/lohnsteuer/i.test(context)) {
    const kind = /differenz/i.test(title) ? "Differenzabrechnung" : /korrektur/i.test(title) ? "Gehaltsabrechnung · Korrektur" : "Gehaltsabrechnung";
    return periodLabel ? `${kind} · ${periodLabel}` : correspondent ? `${kind} · ${correspondent}` : kind;
  }
  if (/lohnsteuerbescheinigung/i.test(context)) return periodLabel ? `Lohnsteuerbescheinigung · ${periodLabel}` : "Lohnsteuerbescheinigung";
  if (/kontoauszug/i.test(context)) return ["Kontoauszug", periodLabel, correspondent].filter(Boolean).join(" · ");
  if (/depotauszug/i.test(context)) return ["Depotauszug", periodLabel, correspondent].filter(Boolean).join(" · ");

  if (needsGeneratedTitle(title)) return generatedDocumentTitle(document, clean(String(document.analysisSummary ?? "")));
  const withoutIdentifiers = title.replace(/\b\d{7,}\b/g, "").replace(/\s+\d+\s*$/, "").replace(/\s+/g, " ").trim();
  if (/^Deine Bestellung$/i.test(withoutIdentifiers)) return ["Bestellbestätigung", correspondent, periodLabel].filter(Boolean).join(" · ");
  return withoutIdentifiers.replace(/\s+Kopie$/i, "");
}

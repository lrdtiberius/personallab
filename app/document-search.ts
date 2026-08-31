export type SearchDocument = {
  id?: number;
  title?: string;
  searchTitle?: string;
  sourceTitle?: string;
  correspondent?: string;
  type?: string;
  analysisSummary?: string;
  tags?: string[];
  date?: string;
};

const stopWords = new Set([
  "alle", "aus", "bei", "das", "dem", "den", "der", "die", "ein", "eine", "einem", "einen", "einer",
  "finde", "fur", "im", "in", "ist", "mit", "mir", "nach", "oder", "show", "suche", "und", "von", "vom", "zu", "zeige",
]);

const synonymGroups = [
  ["auto", "fahrzeug", "kfz", "wagen"],
  ["arzt", "gesundheit", "klinik", "krankenhaus", "medizin"],
  ["befund", "diagnose", "untersuchung"],
  ["entgelt", "gehalt", "lohn", "lohnabrechnung"],
  ["bank", "giro", "konto", "sparkasse"],
  ["beleg", "quittung", "rechnung"],
  ["energie", "strom", "elektrizitat"],
  ["finanzamt", "steuer", "steuerbescheid"],
  ["kundigung", "vertragsende", "beendet", "inaktiv"],
  ["versicherung", "police", "tarif"],
];

export function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(value: string) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function queryTerms(query: string) {
  const terms = words(query).filter(term => !stopWords.has(term));
  return terms.length ? terms : words(query);
}

function alternatives(term: string) {
  const group = synonymGroups.find(items => items.some(item => item === term || item.startsWith(term) || term.startsWith(item)));
  return group ? [...new Set([term, ...group])] : [term];
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function tokenScore(candidate: string, term: string) {
  if (candidate === term) return 32;
  if (candidate.startsWith(term)) return 24;
  if (candidate.length >= 4 && term.startsWith(candidate) && candidate.length / term.length >= 0.6) return 20;
  if (candidate.includes(term)) return 16;
  if (candidate.length >= 4 && term.includes(candidate) && candidate.length / term.length >= 0.6) return 14;
  if (term.length >= 5 && candidate.length >= 5 && editDistance(candidate, term) <= (term.length >= 8 ? 2 : 1)) return 10;
  return 0;
}

export function searchScore(document: SearchDocument, query: string) {
  const terms = queryTerms(query);
  if (!terms.length) return 1;
  const fields = [
    { value: document.searchTitle ?? document.title, weight: 7 },
    { value: document.title, weight: 5 },
    { value: document.sourceTitle, weight: 4 },
    { value: document.correspondent, weight: 4 },
    { value: document.type, weight: 4 },
    { value: document.analysisSummary, weight: 3 },
    { value: document.tags?.join(" "), weight: 2 },
    { value: document.date, weight: 1 },
  ].map(field => ({ ...field, text: normalizeSearchText(field.value), words: words(String(field.value ?? "")) }));

  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const option of alternatives(term)) {
      for (const field of fields) {
        if (!field.text) continue;
        const phrase = field.text === option ? 48 : field.text.includes(option) ? 36 : 0;
        const word = field.words.reduce((current, candidate) => Math.max(current, tokenScore(candidate, option)), 0);
        best = Math.max(best, Math.max(phrase, word) * field.weight);
      }
    }
    if (!best) return 0;
    score += best;
  }
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery && fields[0].text.includes(normalizedQuery)) score += 200;
  if (normalizedQuery && fields[5].text.includes(normalizedQuery)) score += 80;
  return score;
}

export function searchDocuments<T extends SearchDocument>(documents: T[], query: string) {
  if (!normalizeSearchText(query)) return documents;
  return documents
    .map((document, index) => ({ document, index, score: searchScore(document, query) }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(result => result.document);
}

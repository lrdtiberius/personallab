const UNKNOWN = /^Nicht (?:erkannt|eindeutig)(?:\s|$)/i;

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function cleanTitle(value) {
  return clean(value).replace(/_/g, " ").replace(/\s+/g, " ").replace(/\s+Kopie$/i, "").trim();
}

function known(value) {
  const candidate = clean(value);
  return candidate && !UNKNOWN.test(candidate) ? candidate : "";
}

function isoDate(value) {
  const candidate = clean(value);
  const german = candidate.match(/^(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d{2})$/);
  const iso = candidate.match(/^((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})$/);
  const year = Number(german?.[3] ?? iso?.[1]);
  const month = Number(german?.[2] ?? iso?.[2]);
  const day = Number(german?.[1] ?? iso?.[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function readableDate(value) {
  const date = isoDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function extractInvoiceDate(content) {
  const dateToken = "(\\d{1,2}[./-]\\d{1,2}[./-](?:19|20)\\d{2}|(?:19|20)\\d{2}-\\d{1,2}-\\d{1,2})";
  const labeled = content.match(new RegExp(`(?:rechnungsdatum|datum der rechnung|invoice date|belegdatum)[\\s\\S]{0,120}?${dateToken}`, "i"));
  return isoDate(labeled?.[1]);
}

function extractInvoiceNumber(content) {
  const direct = content.match(/(?:rechnungsnummer|rechnungs?[- ]?nr\.?|invoice (?:number|no\.?))\s*[:#]?\s*([A-Z]{1,8}[-/]?\d{4,})/i);
  const heading = content.match(/\brechnung\s+(?!vom\b)([A-Z]{1,8}[-/]?\d{4,})\b/i);
  return clean(direct?.[1] ?? heading?.[1]).toUpperCase();
}

function parseAmount(value) {
  const normalized = clean(value).replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function extractInvoiceAmount(content) {
  const amountToken = "(\\d{1,3}(?:[.\\s]\\d{3})*,\\d{2}|\\d+,\\d{2})";
  const labeled = content.match(new RegExp(`(?:rechnungssumme|rechnungsbetrag|gesamtbetrag|gesamtsumme|endbetrag|zahlbetrag|zu zahlen|summe brutto)[^\\d]{0,80}${amountToken}\\s*(?:€|EUR)`, "i"));
  const preferred = parseAmount(labeled?.[1]);
  if (preferred != null) return preferred;
  const amounts = [...content.matchAll(new RegExp(`${amountToken}\\s*(?:€|EUR)`, "gi"))]
    .map(match => parseAmount(match[1]))
    .filter(value => value != null && value >= 0);
  return amounts.length ? Math.max(...amounts) : null;
}

function smartBrand(value) {
  const candidate = clean(value).replace(/^www\./i, "").replace(/\.(?:de|com|net|eu|shop)$/i, "");
  if (!candidate) return "";
  if (/^[A-Z0-9&.-]{2,8}$/.test(candidate)) return candidate;
  return candidate.charAt(0).toLocaleUpperCase("de-DE") + candidate.slice(1);
}

function extractCorrespondent(content) {
  const labeled = content.match(/(?:rechnung(?:s)?steller|aussteller|verkäufer|anbieter|absender)\s*[:\-]\s*([^\n]{2,80})/i);
  if (labeled) return clean(labeled[1]).replace(/\s{2,}.*$/, "");

  const lines = content.split(/\r?\n/).map(clean).filter(Boolean).slice(0, 40);
  const company = lines.find(line => line.length <= 90 && /\b(?:GmbH(?:\s*&\s*Co\.?\s*KG)?|AG|UG|e\.?K\.?|GbR|OHG|Stadtwerke|Versicherung|Bank)\b/i.test(line));
  if (company) return company.replace(/\s{2,}.*$/, "");

  const domain = content.slice(0, 4000).match(/(?:https?:\/\/|www\.|@)([a-z0-9][a-z0-9-]{2,})\.(?:de|com|net|eu|shop)\b/i)?.[1];
  if (domain && !/^(?:gmail|googlemail|outlook|hotmail|icloud|web|gmx)$/i.test(domain)) return smartBrand(domain);

  const ignored = /^(?:rechnung|invoice|gutschrift|lieferschein|angebot|datum|deutschland|seite|original|kopie)$/i;
  const brand = lines.slice(0, 10).find(line => /^[\p{L}][\p{L}&.-]{2,39}$/u.test(line) && !ignored.test(line));
  return smartBrand(brand ?? "");
}

function meaningfulSubject(title, kind, correspondent) {
  const candidate = cleanTitle(title)
    .replace(/\b\d{7,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!candidate || /^(?:rechnung|invoice|beleg|scan|dokument|import)(?:\s+\S{0,12})?$/i.test(candidate)) return "";
  if (kind && candidate.toLocaleLowerCase("de-DE") === kind.toLocaleLowerCase("de-DE")) return "";
  if (correspondent && candidate.toLocaleLowerCase("de-DE") === correspondent.toLocaleLowerCase("de-DE")) return "";
  return candidate;
}

function formatCurrency(amount) {
  return amount == null ? "" : amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export function enrichPaperlessDocument({ title = "", content = "", correspondent = "", documentType = "", analysisSummary = "", date = "" } = {}) {
  const ocr = String(content ?? "").replace(/\u00a0/g, " ");
  const kind = known(documentType) || (/\brechnung\b|\binvoice\b/i.test(`${title} ${ocr.slice(0, 3000)}`) ? "Rechnung" : "");
  const isInvoice = /rechnung|invoice|quittung|kassenbon|beleg/i.test(`${kind} ${title} ${ocr.slice(0, 3000)}`);
  if (!isInvoice) return { title: "", summary: "", correspondent: "", date: "", invoiceNumber: "", amount: null };

  const inferredCorrespondent = known(correspondent) || extractCorrespondent(ocr);
  const inferredDate = extractInvoiceDate(ocr) || isoDate(date);
  const invoiceNumber = extractInvoiceNumber(ocr);
  const amount = extractInvoiceAmount(ocr);
  const subject = meaningfulSubject(title, kind, inferredCorrespondent);
  const generatedTitle = [kind || "Rechnung", inferredCorrespondent, subject].filter(Boolean).filter((value, index, values) => values.findIndex(item => item.toLocaleLowerCase("de-DE") === value.toLocaleLowerCase("de-DE")) === index).join(" · ");

  const parts = [`${kind || "Rechnung"}${invoiceNumber ? ` ${invoiceNumber}` : ""}`];
  if (inferredCorrespondent) parts.push(`von ${inferredCorrespondent}`);
  if (amount != null) parts.push(`über ${formatCurrency(amount)}`);
  if (subject) parts.push(`für ${subject}`);
  const issued = readableDate(inferredDate);
  const generatedSummary = `${parts.join(" ")}${issued ? `, ausgestellt am ${issued}` : ""}.`;

  return {
    title: generatedTitle,
    summary: generatedSummary.length > 30 ? generatedSummary : clean(analysisSummary),
    correspondent: inferredCorrespondent,
    date: inferredDate,
    invoiceNumber,
    amount,
  };
}

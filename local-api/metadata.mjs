// Foreign keys and presentation text are separate concerns. A numeric foreign
// key must never invalidate an otherwise useful analyzer result.
export function textValue(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return /^(?:null|undefined|none|\[object Object\])$/i.test(text) ? "" : text;
}

export function numericReference(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}

export function referenceName(value, lookup) {
  if (value && typeof value === "object") {
    return referenceName(value.name || value.title || value.id, lookup);
  }
  if (numericReference(value)) return textValue(lookup.get(Number(value)));
  return textValue(value);
}

export function readableMetadata(value, lookup) {
  const name = referenceName(value, lookup);
  return numericReference(name) || /^Nicht (?:erkannt|eindeutig)/i.test(name) ? "" : name;
}

export function usablePresentation(value) {
  const text = textValue(value);
  if (!text || numericReference(text)) return "";
  // Only reject text that itself exhibits the legacy ID template. Dates,
  // prices and useful prose are allowed even if the correspondent is an ID.
  if (/^\d+\s*(?:·|von\s+\d+\b)/i.test(text)) return "";
  if (/^[^·\n]{1,80}·\s*\d+\s*·/.test(text)) return "";
  return text;
}

export function analyzerPresentation(analysis) {
  let structured = {};
  try { structured = JSON.parse(analysis?.search_text ?? "{}"); } catch { /* Search text may be truncated by the upstream API. */ }
  return {
    title: usablePresentation(analysis?.short_title) || usablePresentation(structured?.short_title),
    summary: usablePresentation(analysis?.summary) || usablePresentation(structured?.summary),
  };
}

export function repairReferences(documents, correspondentNames, typeNames) {
  return documents.map(document => {
    const next = { ...document };
    const pending = { ...(document.unresolvedPaperlessReferences ?? {}) };
    for (const [field, lookup] of [["type", typeNames], ["correspondent", correspondentNames], ["group", correspondentNames]]) {
      const value = numericReference(document[field]) ? document[field] : !document[field] ? pending[field] : null;
      if (!numericReference(value)) continue;
      next[field] = readableMetadata(value, lookup);
      if (next[field]) delete pending[field];
      else pending[field] = String(value);
    }
    if (Object.keys(pending).length) next.unresolvedPaperlessReferences = pending;
    else delete next.unresolvedPaperlessReferences;
    // Existing labels and all assignment fields remain untouched.
    return next;
  });
}

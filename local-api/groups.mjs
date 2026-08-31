export function cleanCorrespondentName(value) {
  const name = String(value ?? "").trim();
  if (!name || /^Nicht (?:eindeutig|erkannt)(?:\s|$)/i.test(name)) return "Nicht erkannt";
  return name;
}

export function readableGroup(group, correspondent) {
  const current = String(group ?? "").trim();
  if (!/^\d+$/.test(current)) return current;
  return cleanCorrespondentName(correspondent);
}

export function sanitizeDocumentGroups(documents) {
  return (documents ?? []).map(document => ({
    ...document,
    group: readableGroup(document.group, document.correspondent),
  }));
}

const DAY = 86_400_000;

export function isContract(document) {
  return document?.area === "contracts" || /vertrag|police|abonnement|mitgliedschaft|tarif/i.test(`${document?.title ?? ""} ${document?.type ?? ""}`);
}

export function contractStatusFor(document, now = new Date()) {
  if (!isContract(document)) return null;
  if (document.contractStatusManual && document.contractStatus) return document.contractStatus;
  const end = String(document.contractEnd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return document.contractStatus === "inactive" ? "inactive" : "unknown";
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const endDate = new Date(`${end}T00:00:00`);
  const remainingDays = Math.ceil((endDate.getTime() - today.getTime()) / DAY);
  if (remainingDays < 0 && !document.autoRenew) return "inactive";
  if (remainingDays <= 90) return "expiring";
  return "active";
}

export function refreshContractStatuses(documents, now = new Date()) {
  return documents.map(document => {
    const status = contractStatusFor(document, now);
    return status ? { ...document, contractStatus: status } : document;
  });
}

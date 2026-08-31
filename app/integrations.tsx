"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_ENERGY_METRIC_IDS, orderedEnergyMetricIds, type EnergyMetricId } from "./energy-metrics";
import { energyProviderNames, inferEnergyProviderNames, orderedEnergyContracts } from "./energy-providers";
import { financeAccountId, inferFinanceAccountIds, orderedFinanceAccounts } from "./finance-accounts";
import { DEFAULT_FINANCE_DATA_IDS, DEFAULT_FINANCE_GROUP_DATA_IDS, FINANCE_DATA_IDS, orderedFinanceDataIds, type FinanceDataId } from "./finance-data";

type EnergyFinance = { variable?: number; baseFee?: number; cost?: number; advance?: number; balance?: number };
type EnergyReading = { id?: number; date: string; total: number; delta?: number | null; unit: string; source?: string };
type EnergyContract = { id: number; provider: string; validFrom: string; validTo?: string | null; unitPrice: number; unitPriceLabel: string; baseFeeMonthly: number; advanceMonthly: number; active: boolean };
type EnergySegment = {
  id: "electricity" | "water" | "gas" | "pv";
  label: string;
  unit: string;
  latest?: EnergyReading | null;
  consumption: { month?: number | null; year?: number | null; total?: number | null };
  finances: { month?: EnergyFinance | null; year?: EnergyFinance | null };
  forecast?: { through: string; cost: number; advance: number; balance: number } | null;
  savings?: { month?: number | null; year?: number | null };
  contracts: EnergyContract[];
  history: EnergyReading[];
  invalidCount?: number;
};
type EnergyPayload = { version: string; generatedAt: string; period: { monthStart: string; yearStart: string }; segments: EnergySegment[] };

type FinanceAccount = { id: string; name: string; projected_balance_cents?: number | null; balance_cents?: number | null; anchor_date?: string; overdraft_limit_cents?: number; overdraft_exceeded?: boolean; is_default?: boolean };
type FinanceCredit = { id: string; name: string; credit_type: string; opening_balance_cents: number; paid_cents: number; remaining_balance_cents: number };
type FinanceRate = { id: string; creditId: string; creditName: string; creditType: string; date: string; amountCents: number; remainingAfterCents: number };
type FinancePayload = {
  household: { id: string; name: string };
  asOf: string;
  metrics: { balance_cents?: number; income_cents?: number; expenses_cents?: number; surplus_cents?: number; overdraft_warning_count?: number };
  accounts: FinanceAccount[];
  credits: FinanceCredit[];
  rates: FinanceRate[];
  generatedAt: string;
};

const energyTabs = [
  ["overview", "Übersicht"],
  ["contracts", "Verträge"],
  ["advance", "Abschläge"],
  ["history", "Historie"],
  ["meter", "Zählerstände"],
] as const;

const financeTabs = [["accounts", "Kontostände"], ["credits", "Offene Kredite"], ["rates", "Raten"]] as const;

function number(value?: number | null, digits = 2) {
  return value == null ? "–" : new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function money(value?: number | null) {
  return value == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

function cents(value?: number | null) {
  return value == null ? "–" : money(value / 100);
}

function day(value?: string | null) {
  if (!value) return "–";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat("de-DE").format(parsed);
}

function LoadingCard({ label }: { label: string }) {
  return <section className="integrationState"><span className="integrationSpinner"/><strong>{label} wird geladen …</strong></section>;
}

function ErrorCard({ title, message, retry }: { title: string; message: string; retry: () => void }) {
  return <section className="integrationState error"><strong>{title} ist noch nicht erreichbar</strong><p>{message}</p><button className="quietButton" onClick={retry}>Erneut prüfen</button></section>;
}

type EnergyTabId = (typeof energyTabs)[number][0];
type EnergyIntegrationProps = {
  segmentId: string | null;
  configured: boolean;
  provider?: string | null;
  selectionKey?: string | null;
  selectionLabel?: string | null;
  providerNames?: string[];
  detailId?: EnergyTabId | null;
  editMode?: boolean;
  metricSelectionKey?: string | null;
  metricIds?: string[];
  allowMetricEditing?: boolean;
  onMetricsChange?: (ids: string[] | undefined) => void;
  onProvidersChange?: (providers: string[] | undefined) => void;
};

export function EnergyIntegration({ segmentId, configured, provider = null, selectionKey = null, selectionLabel = null, providerNames: selectedProviderNames, detailId = null, editMode = false, metricSelectionKey = null, metricIds, allowMetricEditing = false, onMetricsChange, onProvidersChange }: EnergyIntegrationProps) {
  const [payload, setPayload] = useState<EnergyPayload | null>(null);
  const [tab, setTab] = useState<EnergyTabId>(detailId ?? "overview");
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState(configured ? "" : "ENERGYLAB_URL ist nicht konfiguriert.");
  const [picker, setPicker] = useState(false);
  const [draftProviderNames, setDraftProviderNames] = useState<string[]>([]);
  const [metricPicker, setMetricPicker] = useState(false);
  const [draftMetricIds, setDraftMetricIds] = useState<string[]>([]);
  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/integrations/energy", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "EnergieLab konnte nicht gelesen werden");
      setPayload(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Verbindung fehlgeschlagen"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!configured) return;
    let active = true;
    fetch("/api/integrations/energy", { cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "EnergieLab konnte nicht gelesen werden");
      return result as EnergyPayload;
    }).then(result => { if (active) { setPayload(result); setError(""); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Verbindung fehlgeschlagen"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [configured]);
  useEffect(() => { setTab(detailId ?? "overview"); }, [detailId, selectionKey]);
  const segment = payload?.segments.find(item => item.id === segmentId);
  const availableProviders = energyProviderNames(segment?.contracts ?? []);
  const providerHeading = selectionLabel ?? provider;
  const inferredProviders = selectionKey && providerHeading ? inferEnergyProviderNames(availableProviders, providerHeading) : [];
  const visibleProviders = selectionKey ? selectedProviderNames ?? inferredProviders : provider ? [provider] : availableProviders;
  const contracts = segment ? orderedEnergyContracts(segment.contracts, visibleProviders) : [];
  const chartValues = [...(segment?.history ?? [])].slice(0, 30).reverse();
  const chartMaximum = Math.max(1, ...chartValues.map(item => Number(item.delta ?? 0)));
  const chart = chartValues.map(item => ({ ...item, height: Math.max(3, Math.round((Number(item.delta ?? 0) / chartMaximum) * 100)) }));
  const openPicker = () => { setDraftProviderNames([...visibleProviders]); setPicker(true); };
  const toggleProvider = (provider: string) => setDraftProviderNames(current => current.includes(provider) ? current.filter(item => item !== provider) : [...current, provider]);
  const moveProvider = (provider: string, direction: -1 | 1) => setDraftProviderNames(current => {
    const index = current.indexOf(provider);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const saveProviders = () => { onProvidersChange?.(draftProviderNames); setPicker(false); };
  const resetProviders = () => { onProvidersChange?.(undefined); setDraftProviderNames(inferredProviders); setPicker(false); };

  if (loading) return <LoadingCard label="EnergieLab"/>;
  if (error || !payload) return <ErrorCard title="EnergieLab" message={error || "Keine Daten empfangen"} retry={load}/>;
  if (!segmentId) return <section className="integrationPanel"><div className="integrationHead"><div><p className="eyebrow">ENERGIELAB LIVE</p><h2>Verbrauch, Kosten und Abschläge</h2><p>Monat, laufendes Jahr und voraussichtliche Abrechnung direkt aus EnergieLab.</p></div><button className="quietButton" onClick={load}>Aktualisieren</button></div><div className="integrationSummaryGrid">{payload.segments.map(item => <article key={item.id}><span>{item.label}</span><strong>{number(item.consumption.month)} <small>{item.unit}</small></strong><p>Verbrauch im aktuellen Monat</p>{item.id === "pv" ? <><b>{money(item.savings?.month)} diesen Monat gespart</b><em>{money(item.savings?.year)} im laufenden Jahr</em></> : <><b>{money(item.finances.month?.cost)} Kosten · {money(item.finances.month?.advance)} Abschlag</b><em>Jahr: {money(item.finances.year?.cost)} Kosten · {money(item.finances.year?.advance)} Abschläge</em>{item.forecast && <em className={item.forecast.balance < 0 ? "negativeText" : "okText"}>{item.forecast.balance >= 0 ? "Voraussichtliche Erstattung" : "Voraussichtliche Nachzahlung"}: {money(Math.abs(item.forecast.balance))}</em>}</>}</article>)}</div><p className="integrationStamp">Stand: {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.generatedAt))}</p></section>;
  if (!segment) return <ErrorCard title="EnergieLab" message="Für diese Kachel existiert noch kein passendes Energiesegment." retry={load}/>;

  const metricOptions: Array<{ id: EnergyMetricId; label: string; value: ReactNode; preview: string; detail: string; available: boolean }> = [
    { id: "latest-reading", label: "Aktueller Zählerstand", value: <>{number(segment.latest?.total)} <small>{segment.unit}</small></>, preview: `${number(segment.latest?.total)} ${segment.unit}`, detail: `Stand vom ${day(segment.latest?.date)}`, available: Boolean(segment.latest) },
    { id: "month-consumption", label: "Verbrauch aktueller Monat", value: <>{number(segment.consumption.month)} <small>{segment.unit}</small></>, preview: `${number(segment.consumption.month)} ${segment.unit}`, detail: "Verbrauch seit Monatsbeginn", available: segment.consumption.month != null },
    { id: "year-consumption", label: "Verbrauch aktuelles Jahr", value: <>{number(segment.consumption.year)} <small>{segment.unit}</small></>, preview: `${number(segment.consumption.year)} ${segment.unit}`, detail: "Verbrauch seit Jahresbeginn", available: segment.consumption.year != null },
    { id: "total-consumption", label: "Verbrauch gesamt", value: <>{number(segment.consumption.total)} <small>{segment.unit}</small></>, preview: `${number(segment.consumption.total)} ${segment.unit}`, detail: "Gesamter gültiger Zeitraum", available: segment.consumption.total != null },
    { id: "month-cost", label: "Kosten aktueller Monat", value: money(segment.finances.month?.cost), preview: money(segment.finances.month?.cost), detail: "Berechnet von EnergieLab", available: segment.finances.month?.cost != null },
    { id: "year-cost", label: "Kosten aktuelles Jahr", value: money(segment.finances.year?.cost), preview: money(segment.finances.year?.cost), detail: "Berechnet von EnergieLab", available: segment.finances.year?.cost != null },
    { id: "month-advance", label: "Abschlag aktueller Monat", value: money(segment.finances.month?.advance), preview: money(segment.finances.month?.advance), detail: "Hinterlegt in EnergieLab", available: segment.finances.month?.advance != null },
    { id: "year-advance", label: "Abschläge aktuelles Jahr", value: money(segment.finances.year?.advance), preview: money(segment.finances.year?.advance), detail: "Hinterlegt in EnergieLab", available: segment.finances.year?.advance != null },
    { id: "forecast", label: segment.forecast && segment.forecast.balance >= 0 ? "Voraussichtliche Erstattung" : "Voraussichtliche Nachzahlung", value: money(Math.abs(segment.forecast?.balance ?? 0)), preview: money(Math.abs(segment.forecast?.balance ?? 0)), detail: segment.forecast ? `Hochrechnung bis ${day(segment.forecast.through)}` : "Noch keine Hochrechnung", available: Boolean(segment.forecast) },
    { id: "data-quality", label: "Datenqualität", value: segment.invalidCount ?? 0, preview: `${segment.invalidCount ?? 0} ausgeschlossene Werte`, detail: "Plausibilitätsprüfung von EnergieLab", available: true },
    { id: "month-savings", label: "Ersparnis aktueller Monat", value: money(segment.savings?.month), preview: money(segment.savings?.month), detail: "Berechnet von EnergieLab", available: segment.savings?.month != null },
    { id: "year-savings", label: "Ersparnis aktuelles Jahr", value: money(segment.savings?.year), preview: money(segment.savings?.year), detail: "Berechnet von EnergieLab", available: segment.savings?.year != null },
  ];
  const viewOptions: Array<{ id: EnergyMetricId; tab: EnergyTabId; label: string; preview: string }> = [
    { id: "view-overview", tab: "overview", label: "Übersicht", preview: "Kennzahlen und Verbrauchsdiagramm" },
    { id: "view-contracts", tab: "contracts", label: "Verträge", preview: "Anbieter, Laufzeit und Preise" },
    { id: "view-advance", tab: "advance", label: "Abschläge", preview: "Abschlag und Grundpreis" },
    { id: "view-history", tab: "history", label: "Historie", preview: "Verbrauch im Zeitverlauf" },
    { id: "view-meter", tab: "meter", label: "Zählerstände", preview: "Alle von EnergieLab gelieferten Messwerte" },
  ];
  const availableMetricOptions = metricOptions.filter(option => option.available);
  const availableDataIds = [...availableMetricOptions.map(option => option.id), ...viewOptions.map(option => option.id)];
  const activeDataIds = orderedEnergyMetricIds(metricIds ?? DEFAULT_ENERGY_METRIC_IDS, availableDataIds);
  const metricById = new Map(availableMetricOptions.map(option => [option.id, option]));
  const visibleMetricOptions = activeDataIds.map(id => metricById.get(id)).filter((option): option is (typeof availableMetricOptions)[number] => Boolean(option));
  const viewById = new Map(viewOptions.map(option => [option.id, option]));
  const visibleEnergyTabs = activeDataIds.map(id => viewById.get(id)).filter((option): option is (typeof viewOptions)[number] => Boolean(option));
  const effectiveTab = visibleEnergyTabs.some(option => option.tab === tab) ? tab : visibleEnergyTabs[0]?.tab ?? null;
  const openMetricPicker = () => { setDraftMetricIds([...activeDataIds]); setMetricPicker(true); };
  const toggleMetric = (id: EnergyMetricId) => setDraftMetricIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const moveMetric = (id: EnergyMetricId, direction: -1 | 1) => setDraftMetricIds(current => {
    const index = current.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const saveMetrics = () => { onMetricsChange?.(draftMetricIds); setMetricPicker(false); };
  const resetMetrics = () => { onMetricsChange?.(undefined); setDraftMetricIds([...DEFAULT_ENERGY_METRIC_IDS]); setMetricPicker(false); };

  return <>
    <section className="integrationPanel energyPanel">
      <div className="integrationHead"><div><p className="eyebrow">ENERGIELAB · {segment.label.toUpperCase()}{providerHeading ? ` · ${providerHeading.toUpperCase()}` : ""}</p><h2>{providerHeading ? `${segment.label} · ${providerHeading}` : `${segment.label} direkt in PersonalLab`}</h2><p>{providerHeading ? "Verträge und Abschläge werden auf die zugeordneten EnergieLab-Anbieter begrenzt." : "Wähle aus, welche von EnergieLab gelieferten Werte hier erscheinen sollen."}</p></div><div className="integrationHeadActions">{metricSelectionKey && allowMetricEditing && editMode && <button className="primaryButton" onClick={openMetricPicker}>EnergieLab-Daten auswählen</button>}{selectionKey && editMode && <button className="quietButton" onClick={openPicker}>Anbieter auswählen</button>}<button className="quietButton" onClick={load}>Aktualisieren</button></div></div>
      {selectionKey && <div className="energyScopeNotice"><strong>{visibleProviders.length ? visibleProviders.join(" · ") : "Noch kein Anbieter zugeordnet"}</strong><span>Vertrag und Abschlag sind anbieterspezifisch. Verbrauch, Historie und Zählerstand gehören zum gesamten Bereich {segment.label}.</span></div>}
      {visibleEnergyTabs.length ? <div className="integrationTabs" role="tablist">{visibleEnergyTabs.map(({ tab: id, label }) => <button key={id} className={effectiveTab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div> : <div className="financeAccountEmpty"><strong>Noch keine EnergieLab-Ansicht ausgewählt</strong><p>Aktiviere Bearbeiten und wähle Übersicht, Verträge, Abschläge, Historie oder Zählerstände aus.</p>{metricSelectionKey && allowMetricEditing && editMode && <button className="primaryButton" onClick={openMetricPicker}>EnergieLab-Daten auswählen</button>}</div>}
      {effectiveTab === "overview" && <>{visibleMetricOptions.length ? <div className="metricStrip energyMetricStrip">{visibleMetricOptions.map(option => <article key={option.id}><span>{option.label}</span><strong>{option.value}</strong><p>{option.detail}</p></article>)}</div> : <div className="financeAccountEmpty"><strong>Noch keine EnergieLab-Kennzahl ausgewählt</strong><p>Aktiviere Bearbeiten und wähle beispielsweise den aktuellen Zählerstand aus.</p>{metricSelectionKey && allowMetricEditing && editMode && <button className="primaryButton" onClick={openMetricPicker}>EnergieLab-Daten auswählen</button>}</div>}{chart.length > 1 && <div className="historyChart" aria-label={`Verbrauchshistorie ${segment.label}`}>{chart.map(item => <span key={`${item.date}-${item.id ?? ""}`} style={{ height: `${item.height}%` }} title={`${day(item.date)}: ${number(item.delta)} ${segment.unit}`}/>)}</div>}</>}
      {effectiveTab === "contracts" && <IntegrationTable headers={["Anbieter", "Laufzeit", "Preis", "Grundpreis", "Status"]} empty="Für diese Auswahl ist kein Vertrag hinterlegt.">{contracts.map(contract => <div className="integrationRow" key={contract.id}><strong>{contract.provider || "Ohne Anbieter"}</strong><span>{day(contract.validFrom)} – {contract.validTo ? day(contract.validTo) : "offen"}</span><span>{contract.unitPriceLabel}</span><span>{money(contract.baseFeeMonthly)} / Monat</span><b className={contract.active ? "okText" : "mutedText"}>{contract.active ? "Aktiv" : "Historie"}</b></div>)}</IntegrationTable>}
      {effectiveTab === "advance" && <IntegrationTable headers={["Anbieter", "Abschlag", "Grundpreis", "Gültig ab", "Status"]} empty="Für diese Auswahl ist kein Abschlag hinterlegt.">{contracts.map(contract => <div className="integrationRow" key={contract.id}><strong>{contract.provider || "Ohne Anbieter"}</strong><span>{money(contract.advanceMonthly)} / Monat</span><span>{money(contract.baseFeeMonthly)} / Monat</span><span>{day(contract.validFrom)}</span><b className={contract.active ? "okText" : "mutedText"}>{contract.active ? "Aktiv" : "Beendet"}</b></div>)}</IntegrationTable>}
      {effectiveTab === "history" && <><div className="metricStrip compact"><article><span>Monat</span><strong>{number(segment.consumption.month)} <small>{segment.unit}</small></strong></article><article><span>Jahr</span><strong>{number(segment.consumption.year)} <small>{segment.unit}</small></strong></article><article><span>Gesamt</span><strong>{number(segment.consumption.total)} <small>{segment.unit}</small></strong></article></div>{chart.length > 1 && <div className="historyChart large">{chart.map(item => <span key={`${item.date}-${item.id ?? ""}`} style={{ height: `${item.height}%` }} title={`${day(item.date)}: ${number(item.delta)} ${segment.unit}`}/>)}</div>}</>}
      {effectiveTab === "meter" && <IntegrationTable headers={["Datum", "Zählerstand", "Verbrauch", "Quelle", "Einheit"]} empty="Noch keine Zählerstände vorhanden.">{segment.history.slice(0, 40).map(reading => <div className="integrationRow" key={`${reading.date}-${reading.id ?? ""}`}><strong>{day(reading.date)}</strong><span>{number(reading.total)}</span><span>{reading.delta == null ? "Erster Stand" : number(reading.delta)}</span><span>{reading.source || "EnergieLab"}</span><span>{reading.unit}</span></div>)}</IntegrationTable>}
      <p className="integrationStamp">Stand: {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.generatedAt))}</p>
    </section>
    {metricPicker && <div className="dialogBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) setMetricPicker(false); }}><section className="editorDialog financeAccountDialog energyMetricDialog"><div className="dialogHead"><div><p className="eyebrow">ENERGIELAB-DATEN</p><h2>Daten für {segment.label}</h2></div><button type="button" onClick={() => setMetricPicker(false)} aria-label="Schließen">×</button></div><p className="dialogLead">Wähle alle gewünschten Kennzahlen und Ansichten aus. Die Pfeile bestimmen ihre Reihenfolge; EnergieLab selbst bleibt unverändert.</p><div className="financeAccountChoices"><p className="dataPickerSectionTitle">KENNZAHLEN</p>{availableMetricOptions.map(option => { const selectedIndex = draftMetricIds.indexOf(option.id); const checked = selectedIndex >= 0; return <div className={`financeAccountChoice ${checked ? "selected" : ""}`} key={option.id}><label><input type="checkbox" checked={checked} onChange={() => toggleMetric(option.id)}/><span><strong>{option.label}</strong><small>{option.preview} · {option.detail}</small></span></label>{checked && <span className="financeAccountOrder"><b>{selectedIndex + 1}</b><button type="button" disabled={selectedIndex === 0} onClick={() => moveMetric(option.id, -1)} aria-label={`${option.label} nach oben`}>↑</button><button type="button" disabled={selectedIndex === draftMetricIds.length - 1} onClick={() => moveMetric(option.id, 1)} aria-label={`${option.label} nach unten`}>↓</button></span>}</div>; })}<p className="dataPickerSectionTitle">ANSICHTEN</p>{viewOptions.map(option => { const selectedIndex = draftMetricIds.indexOf(option.id); const checked = selectedIndex >= 0; return <div className={`financeAccountChoice ${checked ? "selected" : ""}`} key={option.id}><label><input type="checkbox" checked={checked} onChange={() => toggleMetric(option.id)}/><span><strong>{option.label}</strong><small>{option.preview}</small></span></label>{checked && <span className="financeAccountOrder"><b>{selectedIndex + 1}</b><button type="button" disabled={selectedIndex === 0} onClick={() => moveMetric(option.id, -1)} aria-label={`${option.label} nach oben`}>↑</button><button type="button" disabled={selectedIndex === draftMetricIds.length - 1} onClick={() => moveMetric(option.id, 1)} aria-label={`${option.label} nach unten`}>↓</button></span>}</div>; })}</div><div className="dialogActions financeAccountDialogActions"><button type="button" className="quietButton" onClick={resetMetrics}>Standardauswahl</button><span/><button type="button" className="quietButton" onClick={() => setMetricPicker(false)}>Abbrechen</button><button type="button" className="primaryButton" onClick={saveMetrics}>Auswahl speichern</button></div></section></div>}
    {picker && <div className="dialogBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) setPicker(false); }}><section className="editorDialog financeAccountDialog energyProviderDialog"><div className="dialogHead"><div><p className="eyebrow">ENERGIELAB-ANBIETER</p><h2>Anbieter für {selectionLabel}</h2></div><button type="button" onClick={() => setPicker(false)} aria-label="Schließen">×</button></div><p className="dialogLead">Anbieter an- oder abwählen. Die Pfeile legen ihre Reihenfolge bei Verträgen und Abschlägen fest. EnergieLab selbst bleibt unverändert.</p><div className="financeAccountChoices">{availableProviders.map(provider => { const selectedIndex = draftProviderNames.indexOf(provider); const checked = selectedIndex >= 0; const providerContracts = segment.contracts.filter(contract => contract.provider === provider); return <div className={`financeAccountChoice ${checked ? "selected" : ""}`} key={provider}><label><input type="checkbox" checked={checked} onChange={() => toggleProvider(provider)}/><span><strong>{provider}</strong><small>{providerContracts.length} {providerContracts.length === 1 ? "Vertrag" : "Verträge"} aus EnergieLab</small></span></label>{checked && <span className="financeAccountOrder"><b>{selectedIndex + 1}</b><button type="button" disabled={selectedIndex === 0} onClick={() => moveProvider(provider, -1)} aria-label={`${provider} nach oben`}>↑</button><button type="button" disabled={selectedIndex === draftProviderNames.length - 1} onClick={() => moveProvider(provider, 1)} aria-label={`${provider} nach unten`}>↓</button></span>}</div>; })}{!availableProviders.length && <div className="financeAccountEmpty"><strong>Noch keine Anbieter in EnergieLab</strong><p>Sobald dort ein Vertrag mit Anbieter hinterlegt ist, erscheint er hier zur Auswahl.</p></div>}</div><div className="dialogActions financeAccountDialogActions"><button type="button" className="quietButton" onClick={resetProviders}>Automatisch erkennen</button><span/><button type="button" className="quietButton" onClick={() => setPicker(false)}>Abbrechen</button><button type="button" className="primaryButton" onClick={saveProviders}>Auswahl speichern</button></div></section></div>}
  </>;
}

function IntegrationTable({ headers, empty, children }: { headers: string[]; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : children ? [children] : [];
  return <div className="integrationTable"><div className="integrationTableHead">{headers.map(header => <span key={header}>{header}</span>)}</div>{items.length ? children : <p className="integrationEmpty">{empty}</p>}</div>;
}

type FinanceIntegrationProps = {
  configured: boolean;
  selectionKey?: string | null;
  selectionLabel?: string | null;
  accountIds?: string[];
  dataSelectionKey?: string | null;
  dataIds?: string[];
  editMode?: boolean;
  onAccountsChange?: (ids: string[] | undefined) => void;
  onDataChange?: (ids: string[] | undefined) => void;
};

export function FinanceIntegration({ configured, selectionKey = null, selectionLabel = null, accountIds, dataSelectionKey = null, dataIds, editMode = false, onAccountsChange, onDataChange }: FinanceIntegrationProps) {
  const [payload, setPayload] = useState<FinancePayload | null>(null);
  const [tab, setTab] = useState<(typeof financeTabs)[number][0]>("accounts");
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState(configured ? "" : "FINANZLAB_URL ist nicht konfiguriert.");
  const [picker, setPicker] = useState(false);
  const [draftAccountIds, setDraftAccountIds] = useState<string[]>([]);
  const [draftDataIds, setDraftDataIds] = useState<string[]>([]);
  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/integrations/finance", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "FinanzLab konnte nicht gelesen werden");
      setPayload(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Verbindung fehlgeschlagen"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!configured) return;
    let active = true;
    fetch("/api/integrations/finance", { cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "FinanzLab konnte nicht gelesen werden");
      return result as FinancePayload;
    }).then(result => { if (active) { setPayload(result); setError(""); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Verbindung fehlgeschlagen"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [configured]);
  if (loading) return <LoadingCard label="FinanzLab"/>;
  if (error || !payload) return <ErrorCard title="FinanzLab" message={error || "Keine Daten empfangen"} retry={load}/>;
  const activeCredits = payload.credits.filter(credit => Number(credit.remaining_balance_cents) > 0);
  const inferredIds = selectionKey && selectionLabel ? inferFinanceAccountIds(payload.accounts, selectionLabel) : [];
  const defaultAccountIds = selectionKey ? inferredIds : payload.accounts.map(financeAccountId);
  const visibleIds = accountIds ?? defaultAccountIds;
  const visibleAccounts = orderedFinanceAccounts(payload.accounts, visibleIds);
  const visibleBalance = visibleAccounts.reduce((sum, account) => sum + Number(account.projected_balance_cents ?? account.balance_cents ?? 0), 0);
  const creditTotal = activeCredits.reduce((sum, credit) => sum + Number(credit.remaining_balance_cents || 0), 0);
  const defaultDataIds = selectionKey ? DEFAULT_FINANCE_GROUP_DATA_IDS : DEFAULT_FINANCE_DATA_IDS;
  const activeDataIds = orderedFinanceDataIds(dataIds ?? defaultDataIds, FINANCE_DATA_IDS);
  const summaryOptions: Array<{ id: FinanceDataId; label: string; value: ReactNode; preview: string; detail: string; className?: string }> = [
    { id: "balance", label: selectionLabel ? `Kontostände ${selectionLabel}` : "Kontostände gesamt", value: cents(selectionKey ? visibleBalance : payload.metrics.balance_cents), preview: cents(selectionKey ? visibleBalance : payload.metrics.balance_cents), detail: `${visibleAccounts.length} ${visibleAccounts.length === 1 ? "Konto" : "Konten"}` },
    { id: "credit-total", label: selectionLabel ? "Offene Kredite gesamt" : "Offene Kredite", value: cents(creditTotal), preview: cents(creditTotal), detail: `${activeCredits.length} aktive Kredite` },
    { id: "income", label: selectionLabel ? "Monatliche Einnahmen gesamt" : "Monatliche Einnahmen", value: cents(payload.metrics.income_cents), preview: cents(payload.metrics.income_cents), detail: "laut FinanzLab" },
    { id: "expenses", label: selectionLabel ? "Monatliche Ausgaben gesamt" : "Monatliche Ausgaben", value: cents(payload.metrics.expenses_cents), preview: cents(payload.metrics.expenses_cents), detail: "laut FinanzLab" },
    { id: "surplus", label: selectionLabel ? "Monatlicher Überschuss gesamt" : "Monatlicher Überschuss", value: cents(payload.metrics.surplus_cents), preview: cents(payload.metrics.surplus_cents), detail: "laut FinanzLab", className: Number(payload.metrics.surplus_cents ?? 0) < 0 ? "negativeText" : "" },
    { id: "overdraft-warnings", label: "Dispo-Warnungen", value: payload.metrics.overdraft_warning_count ?? 0, preview: `${payload.metrics.overdraft_warning_count ?? 0} Warnungen`, detail: "von FinanzLab gemeldet" },
  ];
  const viewOptions: Array<{ id: FinanceDataId; tab: (typeof financeTabs)[number][0]; label: string; preview: string }> = [
    { id: "view-accounts", tab: "accounts", label: "Kontostände", preview: "Ausgewählte Konten als Karten" },
    { id: "view-credits", tab: "credits", label: "Offene Kredite", preview: "Alle von FinanzLab gelieferten Kredite" },
    { id: "view-rates", tab: "rates", label: "Raten", preview: "Alle von FinanzLab gelieferten Raten" },
  ];
  const summaryById = new Map(summaryOptions.map(option => [option.id, option]));
  const visibleSummaryOptions = activeDataIds.map(id => summaryById.get(id)).filter((option): option is (typeof summaryOptions)[number] => Boolean(option));
  const viewById = new Map(viewOptions.map(option => [option.id, option]));
  const visibleFinanceTabs = activeDataIds.map(id => viewById.get(id)).filter((option): option is (typeof viewOptions)[number] => Boolean(option));
  const effectiveTab = visibleFinanceTabs.some(option => option.tab === tab) ? tab : visibleFinanceTabs[0]?.tab ?? null;
  const openPicker = () => { setDraftAccountIds([...visibleIds]); setDraftDataIds([...activeDataIds]); setPicker(true); };
  const toggleAccount = (id: string) => setDraftAccountIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const moveAccount = (id: string, direction: -1 | 1) => setDraftAccountIds(current => {
    const index = current.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const toggleData = (id: FinanceDataId) => setDraftDataIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const moveData = (id: FinanceDataId, direction: -1 | 1) => setDraftDataIds(current => {
    const index = current.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const saveSelection = () => { onAccountsChange?.(draftAccountIds); onDataChange?.(draftDataIds); setPicker(false); };
  const resetSelection = () => { onAccountsChange?.(undefined); onDataChange?.(undefined); setDraftAccountIds(defaultAccountIds); setDraftDataIds([...defaultDataIds]); setPicker(false); };

  return <>
    <section className="integrationPanel financePanel">
      <div className="integrationHead"><div><p className="eyebrow">FINANZLAB · {payload.household.name.toUpperCase()}</p><h2>{selectionLabel ? `Konten · ${selectionLabel}` : "Konten, Kredite und Raten"}</h2><p>{selectionLabel ? `Konten werden auf ${selectionLabel} begrenzt; weitere Kennzahlen stammen aus dem gesamten FinanzLab.` : `Berechnet zum ${day(payload.asOf)} und direkt aus deinem Haushaltsplaner gelesen.`}</p></div><div className="integrationHeadActions">{dataSelectionKey && editMode && <button className="primaryButton" onClick={openPicker}>FinanzLab-Daten auswählen</button>}<button className="quietButton" onClick={load}>Aktualisieren</button></div></div>
      {visibleSummaryOptions.length > 0 && <div className="metricStrip financeMetrics">{visibleSummaryOptions.map(option => <article key={option.id}><span>{option.label}</span><strong className={option.className}>{option.value}</strong><p>{option.detail}</p></article>)}</div>}
      {visibleFinanceTabs.length ? <div className="integrationTabs" role="tablist">{visibleFinanceTabs.map(({ tab: id, label }) => <button key={id} className={effectiveTab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div> : <div className="financeAccountEmpty"><strong>Noch keine FinanzLab-Ansicht ausgewählt</strong><p>Aktiviere Bearbeiten und wähle Kontostände, offene Kredite oder Raten aus.</p>{dataSelectionKey && editMode && <button className="primaryButton" onClick={openPicker}>FinanzLab-Daten auswählen</button>}</div>}
      {effectiveTab === "accounts" && (visibleAccounts.length ? <div className="accountCards">{visibleAccounts.map(account => { const balance = account.projected_balance_cents ?? account.balance_cents; return <article className={account.overdraft_exceeded ? "warning" : ""} key={account.id}><div><strong>{account.name}</strong>{account.is_default && <small>Standardkonto</small>}</div><b className={Number(balance ?? 0) < 0 ? "negativeText" : ""}>{cents(balance)}</b><p>Stand {day(account.anchor_date)} · Dispo {cents(account.overdraft_limit_cents)}</p></article>; })}</div> : <div className="financeAccountEmpty"><strong>Noch keine Konten zugeordnet</strong><p>{editMode ? "Wähle die Konten aus, die unter diesem Eintrag erscheinen sollen." : "Aktiviere Bearbeiten, um Konten auszuwählen."}</p>{editMode && dataSelectionKey && <button className="primaryButton" onClick={openPicker}>FinanzLab-Daten auswählen</button>}</div>)}
      {effectiveTab === "credits" && <IntegrationTable headers={["Kredit", "Art", "Ausgangssaldo", "Getilgt", "Offen"]} empty="Keine Kredite vorhanden.">{activeCredits.map(credit => <div className="integrationRow" key={credit.id}><strong>{credit.name}</strong><span>{({ consumer_credit: "Konsumkredit", credit: "Kredit", borrowed: "Geliehen" } as Record<string, string>)[credit.credit_type] ?? credit.credit_type}</span><span>{cents(credit.opening_balance_cents)}</span><span>{cents(credit.paid_cents)}</span><b>{cents(credit.remaining_balance_cents)}</b></div>)}</IntegrationTable>}
      {effectiveTab === "rates" && <IntegrationTable headers={["Fälligkeit", "Kredit", "Rate", "Rest danach", "Status"]} empty="Keine kommenden Raten vorhanden.">{payload.rates.slice(0, 40).map(rate => <div className="integrationRow" key={rate.id}><strong>{day(rate.date)}</strong><span>{rate.creditName}</span><span>{cents(rate.amountCents)}</span><span>{cents(rate.remainingAfterCents)}</span><b className="okText">Geplant</b></div>)}</IntegrationTable>}
      <p className="integrationStamp">Stand: {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.generatedAt))}</p>
    </section>
    {picker && <div className="dialogBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) setPicker(false); }}><section className="editorDialog financeAccountDialog"><div className="dialogHead"><div><p className="eyebrow">FINANZLAB-DATEN</p><h2>Daten für {selectionLabel ?? "Konten"}</h2></div><button type="button" onClick={() => setPicker(false)} aria-label="Schließen">×</button></div><p className="dialogLead">Wähle Kennzahlen, Ansichten und Konten aus. Die Pfeile legen die Reihenfolge fest; FinanzLab selbst bleibt unverändert.</p><div className="financeAccountChoices"><p className="dataPickerSectionTitle">KENNZAHLEN</p>{summaryOptions.map(option => { const selectedIndex = draftDataIds.indexOf(option.id); const checked = selectedIndex >= 0; return <div className={`financeAccountChoice ${checked ? "selected" : ""}`} key={option.id}><label><input type="checkbox" checked={checked} onChange={() => toggleData(option.id)}/><span><strong>{option.label}</strong><small>{option.preview} · {option.detail}</small></span></label>{checked && <span className="financeAccountOrder"><b>{selectedIndex + 1}</b><button type="button" disabled={selectedIndex === 0} onClick={() => moveData(option.id, -1)} aria-label={`${option.label} nach oben`}>↑</button><button type="button" disabled={selectedIndex === draftDataIds.length - 1} onClick={() => moveData(option.id, 1)} aria-label={`${option.label} nach unten`}>↓</button></span>}</div>; })}<p className="dataPickerSectionTitle">ANSICHTEN</p>{viewOptions.map(option => { const selectedIndex = draftDataIds.indexOf(option.id); const checked = selectedIndex >= 0; return <div className={`financeAccountChoice ${checked ? "selected" : ""}`} key={option.id}><label><input type="checkbox" checked={checked} onChange={() => toggleData(option.id)}/><span><strong>{option.label}</strong><small>{option.preview}</small></span></label>{checked && <span className="financeAccountOrder"><b>{selectedIndex + 1}</b><button type="button" disabled={selectedIndex === 0} onClick={() => moveData(option.id, -1)} aria-label={`${option.label} nach oben`}>↑</button><button type="button" disabled={selectedIndex === draftDataIds.length - 1} onClick={() => moveData(option.id, 1)} aria-label={`${option.label} nach unten`}>↓</button></span>}</div>; })}<p className="dataPickerSectionTitle">KONTEN</p>{payload.accounts.map(account => { const id = financeAccountId(account); const selectedIndex = draftAccountIds.indexOf(id); const checked = selectedIndex >= 0; return <div className={`financeAccountChoice ${checked ? "selected" : ""}`} key={id}><label><input type="checkbox" checked={checked} onChange={() => toggleAccount(id)}/><span><strong>{account.name}</strong><small>{cents(account.projected_balance_cents ?? account.balance_cents)}</small></span></label>{checked && <span className="financeAccountOrder"><b>{selectedIndex + 1}</b><button type="button" disabled={selectedIndex === 0} onClick={() => moveAccount(id, -1)} aria-label={`${account.name} nach oben`}>↑</button><button type="button" disabled={selectedIndex === draftAccountIds.length - 1} onClick={() => moveAccount(id, 1)} aria-label={`${account.name} nach unten`}>↓</button></span>}</div>; })}</div><div className="dialogActions financeAccountDialogActions"><button type="button" className="quietButton" onClick={resetSelection}>Standardauswahl</button><span/><button type="button" className="quietButton" onClick={() => setPicker(false)}>Abbrechen</button><button type="button" className="primaryButton" onClick={saveSelection}>Auswahl speichern</button></div></section></div>}
  </>;
}

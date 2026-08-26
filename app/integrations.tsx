"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

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

export function EnergyIntegration({ segmentId, provider = null, configured }: { segmentId: string | null; provider?: string | null; configured: boolean }) {
  const [payload, setPayload] = useState<EnergyPayload | null>(null);
  const [tab, setTab] = useState<(typeof energyTabs)[number][0]>("overview");
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState(configured ? "" : "ENERGYLAB_URL ist nicht konfiguriert.");
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
  const segment = payload?.segments.find(item => item.id === segmentId);
  const contracts = segment?.contracts.filter(item => !provider || item.provider === provider) ?? [];
  const chart = useMemo(() => {
    const values = [...(segment?.history ?? [])].slice(0, 30).reverse();
    const maximum = Math.max(1, ...values.map(item => Number(item.delta ?? 0)));
    return values.map(item => ({ ...item, height: Math.max(3, Math.round((Number(item.delta ?? 0) / maximum) * 100)) }));
  }, [segment]);

  if (loading) return <LoadingCard label="EnergieLab"/>;
  if (error || !payload) return <ErrorCard title="EnergieLab" message={error || "Keine Daten empfangen"} retry={load}/>;
  if (!segmentId) return <section className="integrationPanel"><div className="integrationHead"><div><p className="eyebrow">ENERGIELAB LIVE</p><h2>Verbrauch, Kosten und Abschläge</h2><p>Monat, laufendes Jahr und voraussichtliche Abrechnung direkt aus EnergieLab.</p></div><button className="quietButton" onClick={load}>Aktualisieren</button></div><div className="integrationSummaryGrid">{payload.segments.map(item => <article key={item.id}><span>{item.label}</span><strong>{number(item.consumption.month)} <small>{item.unit}</small></strong><p>Verbrauch im aktuellen Monat</p>{item.id === "pv" ? <><b>{money(item.savings?.month)} diesen Monat gespart</b><em>{money(item.savings?.year)} im laufenden Jahr</em></> : <><b>{money(item.finances.month?.cost)} Kosten · {money(item.finances.month?.advance)} Abschlag</b><em>Jahr: {money(item.finances.year?.cost)} Kosten · {money(item.finances.year?.advance)} Abschläge</em>{item.forecast && <em className={item.forecast.balance < 0 ? "negativeText" : "okText"}>{item.forecast.balance >= 0 ? "Voraussichtliche Erstattung" : "Voraussichtliche Nachzahlung"}: {money(Math.abs(item.forecast.balance))}</em>}</>}</article>)}</div><p className="integrationStamp">Stand: {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.generatedAt))}</p></section>;
  if (!segment) return <ErrorCard title="EnergieLab" message="Für diese Kachel existiert noch kein passendes Energiesegment." retry={load}/>;

  return <section className="integrationPanel"><div className="integrationHead"><div><p className="eyebrow">ENERGIELAB · {segment.label.toUpperCase()}{provider ? ` · ${provider.toUpperCase()}` : ""}</p><h2>{provider ? `${provider} in PersonalLab` : `${segment.label} direkt in PersonalLab`}</h2><p>Live-Daten aus EnergieLab, ohne die Anwendung zu wechseln.</p></div><button className="quietButton" onClick={load}>Aktualisieren</button></div><div className="integrationTabs" role="tablist">{energyTabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>{tab === "overview" && <><div className="metricStrip"><article><span>Letzter Zählerstand</span><strong>{number(segment.latest?.total)} <small>{segment.unit}</small></strong><p>vom {day(segment.latest?.date)}</p></article><article><span>Aktueller Monat</span><strong>{number(segment.consumption.month)} <small>{segment.unit}</small></strong><p>{segment.id === "pv" ? `${money(segment.savings?.month)} Ersparnis` : `${money(segment.finances.month?.cost)} Kosten`}</p></article><article><span>Aktuelles Jahr</span><strong>{number(segment.consumption.year)} <small>{segment.unit}</small></strong><p>{segment.id === "pv" ? `${money(segment.savings?.year)} Ersparnis` : `${money(segment.finances.year?.cost)} Kosten`}</p></article><article><span>Datenqualität</span><strong>{segment.invalidCount ?? 0}</strong><p>ausgeschlossene Werte</p></article></div>{chart.length > 1 && <div className="historyChart" aria-label={`Verbrauchshistorie ${segment.label}`}>{chart.map(item => <span key={`${item.date}-${item.id ?? ""}`} style={{ height: `${item.height}%` }} title={`${day(item.date)}: ${number(item.delta)} ${segment.unit}`}/>)}</div>}</>}{tab === "contracts" && <IntegrationTable headers={["Anbieter", "Laufzeit", "Preis", "Grundpreis", "Status"]} empty="Für diese Auswahl ist kein Vertrag hinterlegt.">{contracts.map(contract => <div className="integrationRow" key={contract.id}><strong>{contract.provider || "Ohne Anbieter"}</strong><span>{day(contract.validFrom)} – {contract.validTo ? day(contract.validTo) : "offen"}</span><span>{contract.unitPriceLabel}</span><span>{money(contract.baseFeeMonthly)} / Monat</span><b className={contract.active ? "okText" : "mutedText"}>{contract.active ? "Aktiv" : "Historie"}</b></div>)}</IntegrationTable>}{tab === "advance" && <IntegrationTable headers={["Anbieter", "Abschlag", "Grundpreis", "Gültig ab", "Status"]} empty="Für diese Auswahl ist kein Abschlag hinterlegt.">{contracts.map(contract => <div className="integrationRow" key={contract.id}><strong>{contract.provider || "Ohne Anbieter"}</strong><span>{money(contract.advanceMonthly)} / Monat</span><span>{money(contract.baseFeeMonthly)} / Monat</span><span>{day(contract.validFrom)}</span><b className={contract.active ? "okText" : "mutedText"}>{contract.active ? "Aktiv" : "Beendet"}</b></div>)}</IntegrationTable>}{tab === "history" && <><div className="metricStrip compact"><article><span>Monat</span><strong>{number(segment.consumption.month)} <small>{segment.unit}</small></strong></article><article><span>Jahr</span><strong>{number(segment.consumption.year)} <small>{segment.unit}</small></strong></article><article><span>Gesamt</span><strong>{number(segment.consumption.total)} <small>{segment.unit}</small></strong></article></div>{chart.length > 1 && <div className="historyChart large">{chart.map(item => <span key={`${item.date}-${item.id ?? ""}`} style={{ height: `${item.height}%` }} title={`${day(item.date)}: ${number(item.delta)} ${segment.unit}`}/>)}</div>}</>}{tab === "meter" && <IntegrationTable headers={["Datum", "Zählerstand", "Verbrauch", "Quelle", "Einheit"]} empty="Noch keine Zählerstände vorhanden.">{segment.history.slice(0, 40).map(reading => <div className="integrationRow" key={`${reading.date}-${reading.id ?? ""}`}><strong>{day(reading.date)}</strong><span>{number(reading.total)}</span><span>{reading.delta == null ? "Erster Stand" : number(reading.delta)}</span><span>{reading.source || "EnergieLab"}</span><span>{reading.unit}</span></div>)}</IntegrationTable>}</section>;
}

function IntegrationTable({ headers, empty, children }: { headers: string[]; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : children ? [children] : [];
  return <div className="integrationTable"><div className="integrationTableHead">{headers.map(header => <span key={header}>{header}</span>)}</div>{items.length ? children : <p className="integrationEmpty">{empty}</p>}</div>;
}

export function FinanceIntegration({ configured }: { configured: boolean }) {
  const [payload, setPayload] = useState<FinancePayload | null>(null);
  const [tab, setTab] = useState<(typeof financeTabs)[number][0]>("accounts");
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState(configured ? "" : "FINANZLAB_URL ist nicht konfiguriert.");
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
  return <section className="integrationPanel financePanel"><div className="integrationHead"><div><p className="eyebrow">FINANZLAB · {payload.household.name.toUpperCase()}</p><h2>Konten, Kredite und Raten</h2><p>Berechnet zum {day(payload.asOf)} und direkt aus deinem Haushaltsplaner gelesen.</p></div><button className="quietButton" onClick={load}>Aktualisieren</button></div><div className="metricStrip"><article><span>Kontostände gesamt</span><strong>{cents(payload.metrics.balance_cents)}</strong><p>{payload.accounts.length} Konten</p></article><article><span>Offene Kredite</span><strong>{cents(activeCredits.reduce((sum, credit) => sum + Number(credit.remaining_balance_cents || 0), 0))}</strong><p>{activeCredits.length} aktive Kredite</p></article><article><span>Monatliche Einnahmen</span><strong>{cents(payload.metrics.income_cents)}</strong><p>laut FinanzLab</p></article><article><span>Monatlicher Überschuss</span><strong className={Number(payload.metrics.surplus_cents ?? 0) < 0 ? "negativeText" : ""}>{cents(payload.metrics.surplus_cents)}</strong><p>{payload.metrics.overdraft_warning_count ?? 0} Dispo-Warnungen</p></article></div><div className="integrationTabs" role="tablist">{financeTabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>{tab === "accounts" && <div className="accountCards">{payload.accounts.map(account => { const balance = account.projected_balance_cents ?? account.balance_cents; return <article className={account.overdraft_exceeded ? "warning" : ""} key={account.id}><div><strong>{account.name}</strong>{account.is_default && <small>Standardkonto</small>}</div><b className={Number(balance ?? 0) < 0 ? "negativeText" : ""}>{cents(balance)}</b><p>Stand {day(account.anchor_date)} · Dispo {cents(account.overdraft_limit_cents)}</p></article>; })}</div>}{tab === "credits" && <IntegrationTable headers={["Kredit", "Art", "Ausgangssaldo", "Getilgt", "Offen"]} empty="Keine Kredite vorhanden.">{activeCredits.map(credit => <div className="integrationRow" key={credit.id}><strong>{credit.name}</strong><span>{({ consumer_credit: "Konsumkredit", credit: "Kredit", borrowed: "Geliehen" } as Record<string, string>)[credit.credit_type] ?? credit.credit_type}</span><span>{cents(credit.opening_balance_cents)}</span><span>{cents(credit.paid_cents)}</span><b>{cents(credit.remaining_balance_cents)}</b></div>)}</IntegrationTable>}{tab === "rates" && <IntegrationTable headers={["Fälligkeit", "Kredit", "Rate", "Rest danach", "Status"]} empty="Keine kommenden Raten vorhanden.">{payload.rates.slice(0, 40).map(rate => <div className="integrationRow" key={rate.id}><strong>{day(rate.date)}</strong><span>{rate.creditName}</span><span>{cents(rate.amountCents)}</span><span>{cents(rate.remainingAfterCents)}</span><b className="okText">Geplant</b></div>)}</IntegrationTable>}<p className="integrationStamp">Stand: {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.generatedAt))}</p></section>;
}

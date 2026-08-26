"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { EnergyIntegration, FinanceIntegration } from "./integrations";

type Screen = "overview" | "documents" | "area" | "home-assistant" | "settings";
type Tone = "green" | "blue" | "orange" | "violet" | "sand" | "rose" | "slate" | "teal";

type Subarea = { id: string; name: string; count: number; hint: string };
type Area = {
  id: string;
  name: string;
  count: number;
  description: string;
  tone: Tone;
  icon: IconName;
  subareas: Subarea[];
};
type DocumentItem = {
  id: number;
  title: string;
  correspondent: string;
  type: string;
  date: string;
  area: string;
  subarea: string;
  isNew?: boolean;
  assignmentSource?: "rule" | "manual" | "unassigned";
  metadataSource?: "paperless" | "manual";
};
type AppConfig = { paperless: boolean; paperlessUrl: string; homeAssistant: boolean; homeAssistantUrl: string; energyLab: boolean; financeLab: boolean; autoSync: boolean; syncMinutes: number };
type HASensor = { entityId: string; name: string; state: string; unit: string; icon: string; updated: string };
type DocumentScope = "all" | "unassigned" | "new";
type IconName = "home" | "file" | "grid" | "pulse" | "settings" | "search" | "sync" | "heart" | "work" | "money" | "shield" | "car" | "house" | "chip" | "mail" | "energy" | "inbox" | "clock" | "open" | "back" | "next" | "close" | "check" | "edit" | "plus" | "trash" | "up" | "down" | "move";
type EditorState =
  | { kind: "area"; areaId?: string }
  | { kind: "subarea"; areaId: string; subareaId?: string }
  | null;

const AREA_DATA: Area[] = [
  {
    id: "health", name: "Gesundheit & Befunde", count: 86,
    description: "Befunde, Arztbriefe und gesundheitliche Unterlagen", tone: "teal", icon: "heart",
    subareas: [
      { id: "findings", name: "Befunde", count: 24, hint: "Untersuchungen und Ergebnisse" },
      { id: "medical-letters", name: "Arztbriefe", count: 18, hint: "Berichte von Praxen und Kliniken" },
      { id: "diagnoses", name: "Diagnosen", count: 9, hint: "Diagnosen und Verlauf" },
      { id: "therapy", name: "Therapie & Reha", count: 13, hint: "Behandlung, Reha und Therapie" },
      { id: "aids", name: "Hilfsmittel", count: 8, hint: "Verordnungen und Versorgung" },
      { id: "disability", name: "Schwerbehinderung", count: 14, hint: "Ausweis, Bescheide und Anträge" },
    ],
  },
  {
    id: "work", name: "Arbeit", count: 141,
    description: "Verträge, Gehalt und Unterlagen vom Arbeitgeber", tone: "blue", icon: "work",
    subareas: [
      { id: "contracts", name: "Verträge", count: 8, hint: "Arbeits- und Änderungsverträge" },
      { id: "salary", name: "Gehaltsabrechnungen", count: 79, hint: "Monatliche Abrechnungen" },
      { id: "tax-certificates", name: "Steuerbescheinigungen", count: 12, hint: "Jährliche Lohnsteuerbescheinigungen" },
      { id: "sick-notes", name: "Arbeitsunfähigkeit", count: 15, hint: "AU und Krankmeldungen" },
      { id: "references", name: "Zeugnisse", count: 6, hint: "Arbeitszeugnisse und Nachweise" },
      { id: "employer-mail", name: "Arbeitgeber-Schriftverkehr", count: 21, hint: "Briefe und Bescheinigungen" },
    ],
  },
  {
    id: "finance", name: "Kredite & Finanzen", count: 935,
    description: "Konten, Darlehen, Steuern und Zahlungen", tone: "sand", icon: "money",
    subareas: [
      { id: "accounts", name: "Konten", count: 361, hint: "Konten und Kontoauszüge" },
      { id: "loans", name: "Kredite & Darlehen", count: 94, hint: "Verträge und Abrechnungen" },
      { id: "tax", name: "Steuern", count: 68, hint: "Bescheide und Erklärungen" },
      { id: "invoices", name: "Rechnungen & Belege", count: 382, hint: "Käufe und Zahlungsnachweise" },
      { id: "cards", name: "Karten", count: 18, hint: "Debit- und Kreditkarten" },
      { id: "other-finance", name: "Sonstiges", count: 12, hint: "Weitere Finanzunterlagen" },
    ],
  },
  {
    id: "insurance", name: "Versicherungen", count: 145,
    description: "Policen, Beiträge, Laufzeiten und Schäden", tone: "violet", icon: "shield",
    subareas: [
      { id: "health-insurance", name: "Krankenversicherung", count: 26, hint: "Kasse und Leistungen" },
      { id: "liability", name: "Haftpflicht", count: 12, hint: "Verträge und Schäden" },
      { id: "household", name: "Hausrat", count: 14, hint: "Police und Beiträge" },
      { id: "building", name: "Wohngebäude", count: 18, hint: "Gebäude und Elementar" },
      { id: "vehicle-insurance", name: "Kfz-Versicherung", count: 31, hint: "Fahrzeug und Schaden" },
      { id: "provision", name: "Vorsorge", count: 44, hint: "Leben, Rente und Unfall" },
    ],
  },
  {
    id: "vehicle", name: "Fahrzeug", count: 38,
    description: "Kauf, Steuer, TÜV und Werkstatt", tone: "orange", icon: "car",
    subareas: [
      { id: "purchase", name: "Kauf & Finanzierung", count: 7, hint: "Verträge und Fahrzeugbrief" },
      { id: "vehicle-tax", name: "Steuer", count: 5, hint: "Kfz-Steuer und Zoll" },
      { id: "inspection", name: "TÜV & Prüfung", count: 6, hint: "HU, AU und Berichte" },
      { id: "service", name: "Werkstatt & Wartung", count: 13, hint: "Inspektion und Reparaturen" },
      { id: "tires", name: "Reifen", count: 4, hint: "Räder und Einlagerung" },
      { id: "vehicle-other", name: "Sonstiges", count: 3, hint: "Weitere Fahrzeugdokumente" },
    ],
  },
  {
    id: "energy", name: "Energie", count: 39,
    description: "Strom, Wasser, Gas und Photovoltaik aus EnergieLab", tone: "teal", icon: "energy",
    subareas: [
      { id: "electricity", name: "Strom", count: 14, hint: "Verbrauch, Vertrag, Abschlag und Zählerstand" },
      { id: "water", name: "Wasser", count: 7, hint: "Verbrauch, Vertrag, Abschlag und Zählerstand" },
      { id: "gas", name: "Gas", count: 11, hint: "Verbrauch, Vertrag, Abschlag und Zählerstand" },
      { id: "pv", name: "Photovoltaik", count: 7, hint: "Eigenverbrauch, Ersparnis, Historie und Zählerstand" },
    ],
  },
  {
    id: "contracts", name: "Verträge", count: 0,
    description: "Laufende private Verträge, Tarife und Kündigungsfristen", tone: "violet", icon: "file",
    subareas: [
      { id: "mobile", name: "Mobilfunk", count: 0, hint: "Handyverträge, Tarife und Rechnungen" },
      { id: "internet", name: "Internet & Festnetz", count: 0, hint: "Anschluss, Routermiete und Tarife" },
      { id: "subscriptions", name: "Abonnements", count: 0, hint: "Streaming, Software und Mitgliedschaften" },
      { id: "services", name: "Dienstleistungen", count: 0, hint: "Wartungs- und Serviceverträge" },
      { id: "other-contracts", name: "Sonstige Verträge", count: 0, hint: "Weitere private Vertragsunterlagen" },
    ],
  },
  {
    id: "property", name: "Haus", count: 138,
    description: "Internet, Abgaben, Versicherungen und Versorgung rund ums Zuhause", tone: "green", icon: "house",
    subareas: [
      { id: "ownership", name: "Eigentum & Grundbuch", count: 21, hint: "Notar und Grundbuch" },
      { id: "internet", name: "Internet & Festnetz", count: 0, hint: "Anschluss, Anbieter und Rechnungen" },
      { id: "property-tax", name: "Grundsteuer", count: 19, hint: "Grundsteuerbescheide und Zahlungen" },
      { id: "property-insurance", name: "Versicherungen", count: 18, hint: "Hausrat, Gebäude und Elementar" },
      { id: "waste", name: "Müll & Entsorgung", count: 0, hint: "Gebühren und Entsorgungsverträge" },
      { id: "water", name: "Wasser", count: 0, hint: "Verträge, Gebühren und Abrechnungen" },
      { id: "electricity", name: "Strom", count: 0, hint: "Hausanschluss, Verträge und Abrechnungen" },
      { id: "gas", name: "Gas", count: 0, hint: "Verträge, Abschläge und Abrechnungen" },
      { id: "craft", name: "Handwerker & Wartung", count: 34, hint: "Aufträge und Rechnungen" },
      { id: "property-other", name: "Sonstiges", count: 7, hint: "Weitere Hausunterlagen" },
    ],
  },
  {
    id: "hardware", name: "Hardware & Technik", count: 33,
    description: "PC, NAS, Netzwerk und Geräte", tone: "slate", icon: "chip",
    subareas: [
      { id: "pc", name: "PC & Komponenten", count: 10, hint: "Gaming-PC und Zubehör" },
      { id: "server", name: "NAS & Server", count: 8, hint: "Synology, ZimaOS und Mini-PC" },
      { id: "network", name: "Netzwerk", count: 5, hint: "Router, Switch und WLAN" },
      { id: "av", name: "TV & Audio", count: 6, hint: "Fernseher und Heimkino" },
      { id: "mobile", name: "Mobilgeräte", count: 4, hint: "Smartphone und Tablet" },
    ],
  },
  {
    id: "correspondence", name: "Schriftverkehr", count: 1506,
    description: "Allgemeine Briefe, Nachweise und Mitteilungen", tone: "rose", icon: "mail",
    subareas: [
      { id: "authorities", name: "Behörden", count: 286, hint: "Bescheide und Schreiben" },
      { id: "providers", name: "Anbieter", count: 411, hint: "Verträge und Mitteilungen" },
      { id: "private", name: "Privat", count: 96, hint: "Persönliche Korrespondenz" },
      { id: "proof", name: "Nachweise", count: 202, hint: "Bescheinigungen und Belege" },
      { id: "uncategorized-mail", name: "Nicht weiter zugeordnet", count: 511, hint: "Allgemeiner Schriftverkehr" },
    ],
  },
];

const DOCUMENTS: DocumentItem[] = [
  { id: 2418, title: "Neurologischer Befund · Verlaufskontrolle", correspondent: "Praxis für Neurologie", type: "Befund", date: "24.08.2026", area: "health", subarea: "findings", isNew: true },
  { id: 2411, title: "Schwerbehindertenausweis 2030", correspondent: "Landratsamt", type: "Ausweis", date: "21.08.2026", area: "health", subarea: "disability", isNew: true },
  { id: 2397, title: "Gehaltsabrechnung Juli 2026", correspondent: "Arbeitgeber", type: "Gehaltsabrechnung", date: "31.07.2026", area: "work", subarea: "salary" },
  { id: 2318, title: "Gehaltsabrechnung Juni 2026", correspondent: "Arbeitgeber", type: "Gehaltsabrechnung", date: "30.06.2026", area: "work", subarea: "salary" },
  { id: 2246, title: "Lohnsteuerbescheinigung 2025", correspondent: "Arbeitgeber", type: "Steuerbescheinigung", date: "18.02.2026", area: "work", subarea: "tax-certificates" },
  { id: 2172, title: "Änderungsvertrag zur Arbeitszeit", correspondent: "Arbeitgeber", type: "Vertrag", date: "12.01.2026", area: "work", subarea: "contracts" },
  { id: 2386, title: "Rechnung Inspektion VW T6.1", correspondent: "Volkswagen Service", type: "Rechnung", date: "14.08.2026", area: "vehicle", subarea: "service" },
  { id: 2374, title: "Stromliefervertrag · Tarifwechsel", correspondent: "Energieversorger", type: "Vertrag", date: "11.08.2026", area: "property", subarea: "utilities" },
  { id: 2359, title: "Nachtrag zur Wohngebäudeversicherung", correspondent: "Versicherung", type: "Vertrag", date: "04.08.2026", area: "insurance", subarea: "building" },
];

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    file: <><path d="M6 2h8l4 4v16H6zM14 2v5h5M9 12h6M9 16h6"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    pulse: <><path d="M3 12h4l2-5 4 10 2-5h6"/><path d="M20 6a9 9 0 1 1-14-2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 15l2 2-4 4-2-2a8 8 0 0 1-3 1v3H7v-3a8 8 0 0 1-2-1l-2 2-3-4 2-2a8 8 0 0 1-1-3H-1V7h3a8 8 0 0 1 1-2L1 3l4-3 2 2a8 8 0 0 1 3-1v-3h5v3a8 8 0 0 1 2 1l2-2 3 3-2 2a8 8 0 0 1 1 2h3v5h-3a8 8 0 0 1-2 3Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    sync: <><path d="M20 7h-5V2M4 17h5v5M18 9A7 7 0 0 0 6 5L4 7M6 15a7 7 0 0 0 12 4l2-2"/></>,
    heart: <path d="M20 5a5 5 0 0 0-7 0l-1 1-1-1a5 5 0 0 0-7 7l8 8 8-8a5 5 0 0 0 0-7Z"/>,
    work: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/></>,
    money: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M16 11h6v5h-6a2.5 2.5 0 0 1 0-5Z"/></>,
    shield: <path d="M12 2 20 5v6c0 5-3 9-8 11-5-2-8-6-8-11V5z"/>,
    car: <><path d="m5 17-2-2v-4l2-5h14l2 5v4l-2 2Z"/><circle cx="7" cy="15" r="1"/><circle cx="17" cy="15" r="1"/><path d="M5 11h14"/></>,
    house: <><path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-6h6v6"/></>,
    chip: <><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v5M15 1v5M9 18v5M15 18v5M1 9h5M1 15h5M18 9h5M18 15h5"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    energy: <path d="m13 2-9 12h8l-1 8 9-12h-8z"/>,
    inbox: <><path d="M4 4h16l2 10v6H2v-6z"/><path d="M2 14h6l2 3h4l2-3h6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    open: <><path d="M14 3h7v7M21 3l-9 9M18 13v7H4V6h7"/></>,
    back: <path d="m15 18-6-6 6-6"/>, next: <path d="m9 18 6-6-6-6"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, check: <path d="m5 12 4 4L19 6"/>,
    edit: <><path d="m4 20 4-1 11-11-3-3L5 16z"/><path d="m14 6 3 3"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></>,
    up: <path d="m7 14 5-5 5 5"/>, down: <path d="m7 10 5 5 5-5"/>, move: <><path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"/></>,
  };
  return <svg {...common} aria-hidden="true">{paths[name]}</svg>;
}

function Brand() {
  return <span className="brand"><span className="brandMark">P</span><span className="brandName"><strong>PersonalLab</strong><small>by Lrd.Tiberius</small></span></span>;
}

function Header({ screen, navigate, editMode, toggleEdit }: { screen: Screen; navigate: (screen: Screen) => void; editMode: boolean; toggleEdit: () => void }) {
  const nav: { id: Screen; label: string; icon: IconName }[] = [
    { id: "overview", label: "Übersicht", icon: "home" }, { id: "documents", label: "Dokumente", icon: "file" },
    { id: "home-assistant", label: "Home Assistant", icon: "pulse" }, { id: "settings", label: "Einstellungen", icon: "settings" },
  ];
  return <header className="topbar"><div className="topbarInner"><button className="brandButton" onClick={() => navigate("overview")}><Brand /></button><nav>{nav.map(item => <button key={item.id} className={screen === item.id || (screen === "area" && item.id === "overview") ? "active" : ""} onClick={() => navigate(item.id)}><span className="mobileNavIcon"><Icon name={item.icon} size={17}/></span>{item.label}</button>)}</nav><div className="headerActions"><button className={`editModeButton ${editMode ? "active" : ""}`} onClick={toggleEdit}><Icon name={editMode ? "check" : "edit"} size={16}/>{editMode ? "Fertig" : "Bearbeiten"}</button><span className="systemReady"><i/>System bereit</span></div></div></header>;
}

function SearchBox({ query, setQuery }: { query: string; setQuery: (value: string) => void }) {
  return <label className="searchBox"><Icon name="search" size={19}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Dokument, Arzt, Vertrag oder Stichwort suchen …"/><kbd>⌘ K</kbd></label>;
}

function AreaTile({ area, editMode, onOpen, onEdit }: { area: Area; editMode: boolean; onOpen: () => void; onEdit: () => void }) {
  return <button className={`areaTile tone-${area.tone} ${editMode ? "editable" : ""}`} onClick={editMode ? onEdit : onOpen}>{editMode && <span className="editFlag"><Icon name="edit" size={13}/>Ändern</span>}<span className="areaIcon"><Icon name={area.icon} size={25}/></span><span className="areaText"><strong>{area.name}</strong><small>{area.description}</small></span><span className="areaCount"><strong>{area.count.toLocaleString("de-DE")}</strong><small>Dokumente</small></span><Icon name={editMode ? "move" : "next"} size={18}/></button>;
}

function DocumentList({ title, subtitle, items, onOpen, editMode, selected, setSelected, assign }: { title: string; subtitle: string; items: DocumentItem[]; onOpen: (doc: DocumentItem) => void; editMode: boolean; selected: number[]; setSelected: (ids: number[]) => void; assign: () => void }) {
  const toggle = (id: number) => setSelected(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
  return <section className="documentPanel"><div className="panelHead"><div><p className="eyebrow">DOKUMENTE</p><h2>{title}</h2><p>{subtitle}</p></div>{editMode ? <div className="selectionActions"><span>{selected.length} ausgewählt</span><button className="primaryButton" disabled={!selected.length} onClick={assign}>Neu zuordnen</button></div> : <button className="quietButton">Alle anzeigen</button>}</div><div className="docTable"><div className="docTableHead"><span>Dokument</span><span>Typ</span><span>Datum</span><span/></div>{items.length ? items.map(doc => <button className={`docRow ${selected.includes(doc.id) ? "selected" : ""}`} key={doc.id} onClick={() => editMode ? toggle(doc.id) : onOpen(doc)}>{editMode && <span className="rowCheck">{selected.includes(doc.id) && <Icon name="check" size={14}/>}</span>}<span className="docIdentity"><span className="docIcon"><Icon name="file" size={18}/></span><span><strong>{doc.title}</strong><small>{doc.correspondent} · Paperless #{doc.id}</small></span>{doc.isNew && <em>Neu</em>}</span><span className="typeTag">{doc.type}</span><span className="docDate">{doc.date}</span><Icon name={editMode ? "edit" : "next"} size={18}/></button>) : <div className="empty"><Icon name="search" size={24}/><strong>Keine passenden Dokumente</strong><p>In dieser Auswahl wurde nichts gefunden.</p></div>}</div></section>;
}

function Overview({ areas, documents, openArea, openDocuments, paperlessUrl, query, setQuery, openDocument, editMode, editArea, addArea, selected, setSelected, assign }: { areas: Area[]; documents: DocumentItem[]; openArea: (area: Area) => void; openDocuments: (scope: DocumentScope) => void; paperlessUrl: string; query: string; setQuery: (value: string) => void; openDocument: (doc: DocumentItem) => void; editMode: boolean; editArea: (area: Area) => void; addArea: () => void; selected: number[]; setSelected: (ids: number[]) => void; assign: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const recent = documents.filter(doc => `${doc.title} ${doc.correspondent} ${doc.type}`.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
  const unassigned = documents.filter(doc => !doc.area || !doc.subarea).length;
  const newDocuments = documents.filter(doc => doc.isNew).length;
  const health = documents.filter(doc => doc.area === "health").length;
  const syncNow = async () => {
    setSyncing(true);
    try {
      await fetch("/api/sync", { method: "POST" });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) break;
        const payload = await response.json();
        if (payload.syncStatus !== "running") { window.location.reload(); return; }
      }
    } finally { setSyncing(false); }
  };
  return <>
    {editMode && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>Bearbeitungsmodus aktiv</strong><p>Kacheln ändern oder neu anlegen. Dokumente lassen sich unten gesammelt auswählen und neu zuordnen.</p></div></div>}
    <section className="intro"><div><p className="eyebrow">PERSÖNLICHE ZENTRALE</p><h1>Alles Wichtige auf einen Blick.</h1><p>Wie ein Role Center: Kachel wählen und direkt in den passenden Aktenbereich springen.</p></div><div className="introActions"><button className="quietButton" disabled={!paperlessUrl} onClick={() => paperlessUrl && window.open(`${paperlessUrl}/documents`, "_blank", "noopener,noreferrer")}><Icon name="open" size={17}/>Paperless öffnen</button><button className="primaryButton" disabled={syncing} onClick={syncNow}><Icon name="sync" size={17}/>{syncing ? "Abgleich läuft …" : "Jetzt abgleichen"}</button></div></section>
    <SearchBox query={query} setQuery={setQuery}/>
    <section><div className="sectionTitle"><div><p className="eyebrow">AKTIVITÄTEN</p><h2>Was gerade Aufmerksamkeit braucht</h2></div><p>Klicken öffnet sofort die passende Auswahl.</p></div><div className="cueGrid"><button className="cueTile" onClick={() => openDocuments("all")}><span className="cueIcon"><Icon name="file"/></span><strong>{documents.length.toLocaleString("de-DE")}</strong><b>Alle Dokumente</b><small>aus Paperless-NGX</small><Icon name="next" size={17}/></button><button className="cueTile attention" onClick={() => openDocuments("unassigned")}><span className="cueIcon"><Icon name="inbox"/></span><strong>{unassigned}</strong><b>Nicht zugeordnet</b><small>jetzt einsortieren</small><Icon name="next" size={17}/></button><button className="cueTile positive" onClick={() => openDocuments("new")}><span className="cueIcon"><Icon name="clock"/></span><strong>{newDocuments}</strong><b>Neu seit Abgleich</b><small>zuletzt synchronisiert</small><Icon name="next" size={17}/></button><button className="cueTile health" onClick={() => { const healthArea = areas.find(item => item.id === "health"); if (!editMode && healthArea) openArea(healthArea); }}><span className="cueIcon"><Icon name="heart"/></span><strong>{health}</strong><b>Befunde & Gesundheit</b><small>persönliche Gesundheitsakte</small><Icon name="next" size={17}/></button></div></section>
    <section className="areasSection"><div className="sectionTitle"><div><p className="eyebrow">MEINE BEREICHE</p><h2>Direkt in die persönliche Akte</h2></div><p>{editMode ? "Kachel anklicken, um sie zu bearbeiten." : "Jeder Bereich öffnet seine eigenen Kacheln."}</p></div><div className="areaGrid">{areas.map(area => <AreaTile key={area.id} area={area} editMode={editMode} onOpen={() => openArea(area)} onEdit={() => editArea(area)}/>)}{editMode && <button className="addTile areaAdd" onClick={addArea}><span><Icon name="plus" size={24}/></span><strong>Neue Bereichskachel</strong><small>Eigenen Bereich anlegen</small></button>}</div></section>
    <DocumentList title="Zuletzt hinzugefügt" subtitle="Direkt aus Paperless-NGX" items={recent} onOpen={openDocument} editMode={editMode} selected={selected} setSelected={setSelected} assign={assign}/>
  </>;
}

type AreaViewProps = { area: Area; documents: DocumentItem[]; config: AppConfig; selectedSubarea: string | null; chooseSubarea: (id: string | null) => void; goBack: () => void; query: string; setQuery: (value: string) => void; openDocument: (doc: DocumentItem) => void; editMode: boolean; editSubarea: (id: string) => void; addSubarea: () => void; renameParty: (oldName: string, newName: string, fallback: string) => void; selected: number[]; setSelected: (ids: number[]) => void; assign: () => void };

const energyDetailLevels = [
  { id: "contracts", name: "Verträge", hint: "Verträge und Tarifunterlagen", pattern: /vertrag|tarif|liefer/ },
  { id: "advance", name: "Abschläge", hint: "Abschlagspläne und Zahlungen", pattern: /abschlag|rate|zahlung/ },
  { id: "bills", name: "Abrechnungen", hint: "Jahres- und Verbrauchsabrechnungen", pattern: /abrechnung|rechnung/ },
  { id: "history", name: "Historie", hint: "Frühere Verträge und Auswertungen", pattern: /histor|vorjahr|altvertrag/ },
  { id: "meter", name: "Zählerstände", hint: "Ablesungen und Zählerstände", pattern: /zähler|zaehler|ablesung|meter/ },
];

function PartyAreaView(props: AreaViewProps) {
  const { area, documents, config, selectedSubarea, chooseSubarea, goBack, query, setQuery, openDocument, editMode, editSubarea, addSubarea, renameParty, selected, setSelected, assign } = props;
  const [party, setParty] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [energyProviders, setEnergyProviders] = useState<string[]>([]);
  const areaDocuments = documents.filter(doc => doc.area === area.id);
  const segmentDocuments = areaDocuments.filter(doc => !selectedSubarea || doc.subarea === selectedSubarea);
  const partyFallback = area.id === "work" ? "Ohne Arbeitgeber" : "Ohne Anbieter";
  useEffect(() => {
    if (area.id !== "energy" || !selectedSubarea || !config.energyLab) { setEnergyProviders([]); return; }
    let active = true;
    fetch("/api/integrations/energy", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(payload => {
      if (!active) return;
      const segment = payload?.segments?.find((item: { id?: string }) => item.id === selectedSubarea);
      setEnergyProviders([...(new Set<string>((segment?.contracts ?? []).map((item: { provider?: string }) => item.provider).filter(Boolean)))]);
    }).catch(() => { if (active) setEnergyProviders([]); });
    return () => { active = false; };
  }, [area.id, selectedSubarea, config.energyLab]);
  const parties = [...new Set([...segmentDocuments.map(doc => doc.correspondent.trim() || partyFallback), ...energyProviders])].sort((a, b) => a.localeCompare(b, "de"));
  const partyDocuments = party ? segmentDocuments.filter(doc => (doc.correspondent.trim() || partyFallback) === party) : segmentDocuments;
  const activeSubarea = area.subareas.find(item => item.id === selectedSubarea);
  const detailLevel = energyDetailLevels.find(item => item.id === detail);
  const visibleDocuments = partyDocuments.filter(doc => {
    if (area.id === "work" && selectedSubarea) return doc.subarea === selectedSubarea;
    if (area.id === "energy" && detailLevel) return detailLevel.pattern.test(`${doc.title} ${doc.type} ${doc.correspondent}`.toLowerCase());
    return true;
  }).filter(doc => `${doc.title} ${doc.correspondent} ${doc.type}`.toLowerCase().includes(query.toLowerCase()));
  const resetParty = () => { setParty(null); setDetail(null); if (area.id === "work") chooseSubarea(null); };

  if (area.id === "energy" && !selectedSubarea) return <LegacyAreaView {...props}/>;

  const showParties = !party;
  const levels = area.id === "work" ? area.subareas : energyDetailLevels;
  return <>
    {editMode && area.id === "work" && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>Arbeitgeber und Unterkategorien bearbeiten</strong><p>Arbeitgeber-Kachel anklicken, um den Namen zu ändern. Nach Auswahl eines Arbeitgebers lassen sich die Unterkategorien bearbeiten oder ergänzen.</p></div></div>}
    <div className="breadcrumbs"><button onClick={goBack}><Icon name="back" size={16}/>Übersicht</button><span>/</span><button onClick={resetParty}>{area.name}</button>{activeSubarea && <><span>/</span><button onClick={() => { chooseSubarea(null); setDetail(null); }}>{activeSubarea.name}</button></>}{party && <><span>/</span><button onClick={() => { setDetail(null); chooseSubarea(null); }}>{party}</button></>}{detailLevel && <><span>/</span><strong>{detailLevel.name}</strong></>}</div>
    <section className="areaIntro"><span className={`largeAreaIcon tone-${area.tone}`}><Icon name={area.icon} size={29}/></span><div><p className="eyebrow">AKTENBEREICH</p><h1>{party ?? activeSubarea?.name ?? area.name}</h1><p>{showParties ? (area.id === "work" ? "Wähle zuerst den Arbeitgeber." : "Wähle jetzt den Anbieter.") : "Wähle anschließend die gewünschte Dokumentart."}</p></div><span className="areaTotal"><strong>{partyDocuments.length.toLocaleString("de-DE")}</strong><small>Dokumente</small></span></section>
    <SearchBox query={query} setQuery={setQuery}/>
    <section><div className="sectionTitle"><div><p className="eyebrow">{showParties ? (area.id === "work" ? "ARBEITGEBER" : "ANBIETER") : "UNTERKATEGORIEN"}</p><h2>{showParties ? (parties.length ? "Wen möchtest du öffnen?" : "Noch keine Zuordnung vorhanden") : "Was möchtest du öffnen?"}</h2></div>{party && <button className="quietButton" onClick={resetParty}>Zurück zur Auswahl</button>}</div>
      <div className="subareaGrid">{showParties ? parties.map(name => { const count = segmentDocuments.filter(doc => (doc.correspondent.trim() || partyFallback) === name).length; const editable = editMode && area.id === "work"; return <button key={name} className={`subareaTile ${editable ? "editable" : ""}`} onClick={() => { if (editable) { const nextName = window.prompt("Name des Arbeitgebers", name)?.trim(); if (nextName && nextName !== name) renameParty(name, nextName, partyFallback); return; } setParty(name); setDetail(null); if (area.id === "work") chooseSubarea(null); }}>{editable && <span className="editFlag"><Icon name="edit" size={13}/>Ändern</span>}<span className="subareaSymbol"><Icon name={area.id === "work" ? "work" : "energy"} size={21}/></span><strong>{name}</strong><small>{area.id === "work" ? "Arbeitgeber" : "Energieanbieter"}</small><b>{count}</b><Icon name={editable ? "edit" : "next"} size={17}/></button>; }) : levels.map(level => { const count = area.id === "work" ? partyDocuments.filter(doc => doc.subarea === level.id).length : partyDocuments.filter(doc => "pattern" in level && level.pattern.test(`${doc.title} ${doc.type}`.toLowerCase())).length; const active = area.id === "work" ? selectedSubarea === level.id : detail === level.id; const editable = editMode && area.id === "work"; return <button key={level.id} className={`subareaTile ${active ? "selected" : ""} ${editable ? "editable" : ""}`} onClick={() => editable ? editSubarea(level.id) : area.id === "work" ? chooseSubarea(level.id) : setDetail(level.id)}>{editable && <span className="editFlag"><Icon name="edit" size={13}/>Ändern</span>}<span className="subareaSymbol"><Icon name="file" size={21}/></span><strong>{level.name}</strong><small>{level.hint}</small><b>{count}</b><Icon name={editable ? "edit" : "next"} size={17}/></button>; })}{editMode && area.id === "work" && !showParties && <button className="addTile" onClick={addSubarea}><span><Icon name="plus" size={24}/></span><strong>Neue Unterkategorie</strong><small>Eigene Kachel anlegen</small></button>}</div>
    </section>
    {area.id === "energy" && <EnergyIntegration key={`${selectedSubarea ?? "energy"}-${party ?? "all"}`} segmentId={selectedSubarea} provider={party} configured={config.energyLab}/>}
    {!showParties && <DocumentList title={detailLevel?.name ?? activeSubarea?.name ?? `Dokumente von ${party}`} subtitle={`${visibleDocuments.length} Dokumente`} items={visibleDocuments} onOpen={openDocument} editMode={false} selected={selected} setSelected={setSelected} assign={assign}/>}
  </>;
}

function AreaView(props: AreaViewProps) {
  if (props.area.id === "work" || (!props.editMode && props.area.id === "energy")) return <PartyAreaView {...props}/>;
  return <LegacyAreaView {...props}/>;
}

function LegacyAreaView({ area, documents, config, selectedSubarea, chooseSubarea, goBack, query, setQuery, openDocument, editMode, editSubarea, addSubarea, selected, setSelected, assign }: AreaViewProps) {
  const active = area.subareas.find(item => item.id === selectedSubarea);
  const items = documents.filter(doc => doc.area === area.id && (!selectedSubarea || doc.subarea === selectedSubarea) && `${doc.title} ${doc.correspondent} ${doc.type}`.toLowerCase().includes(query.toLowerCase()));
  return <>{editMode && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>Unterbereiche bearbeiten</strong><p>Kachel anklicken, um Name, Beschreibung oder Reihenfolge zu ändern.</p></div></div>}<div className="breadcrumbs"><button onClick={goBack}><Icon name="back" size={16}/>Übersicht</button><span>/</span><strong>{area.name}</strong>{active && <><span>/</span><strong>{active.name}</strong></>}</div><section className="areaIntro"><span className={`largeAreaIcon tone-${area.tone}`}><Icon name={area.icon} size={29}/></span><div><p className="eyebrow">AKTENBEREICH</p><h1>{area.name}</h1><p>{area.description}</p></div><span className="areaTotal"><strong>{area.count.toLocaleString("de-DE")}</strong><small>Dokumente</small></span></section><SearchBox query={query} setQuery={setQuery}/><section><div className="sectionTitle"><div><p className="eyebrow">UNTERBEREICHE</p><h2>{editMode ? "Kacheln bearbeiten" : "Was möchtest du öffnen?"}</h2></div>{active && !editMode && <button className="quietButton" onClick={() => chooseSubarea(null)}>Auswahl aufheben</button>}</div><div className="subareaGrid">{!editMode && <button className={`subareaTile ${selectedSubarea === null ? "selected" : ""}`} onClick={() => chooseSubarea(null)}><span className="subareaSymbol"><Icon name="grid" size={21}/></span><strong>Alles in {area.name}</strong><small>Gesamten Bereich anzeigen</small><b>{area.count}</b></button>}{area.subareas.map(subarea => <button key={subarea.id} className={`subareaTile ${selectedSubarea === subarea.id ? "selected" : ""} ${editMode ? "editable" : ""}`} onClick={() => editMode ? editSubarea(subarea.id) : chooseSubarea(subarea.id)}>{editMode && <span className="editFlag"><Icon name="edit" size={13}/>Ändern</span>}<span className="subareaSymbol"><Icon name={area.id === "energy" ? "energy" : "file"} size={21}/></span><strong>{subarea.name}</strong><small>{subarea.hint}</small><b>{subarea.count}</b><Icon name={editMode ? "move" : "next"} size={17}/></button>)}{editMode && <button className="addTile" onClick={addSubarea}><span><Icon name="plus" size={24}/></span><strong>Neue Kachel</strong><small>Unterbereich anlegen</small></button>}</div></section>{area.id === "energy" && !editMode && <EnergyIntegration key={selectedSubarea ?? "all-energy"} segmentId={selectedSubarea} configured={config.energyLab}/>} {area.id === "finance" && selectedSubarea === "accounts" && !editMode && <FinanceIntegration configured={config.financeLab}/>}<DocumentList title={active?.name ?? `Alle Dokumente in ${area.name}`} subtitle={active ? active.hint : `${area.count} zugeordnete Dokumente`} items={items} onOpen={openDocument} editMode={editMode} selected={selected} setSelected={setSelected} assign={assign}/></>;
}

function DocumentsView({ documents, scope, query, setQuery, openDocument, editMode, selected, setSelected, assign }: { documents: DocumentItem[]; scope: DocumentScope; query: string; setQuery: (value: string) => void; openDocument: (doc: DocumentItem) => void; editMode: boolean; selected: number[]; setSelected: (ids: number[]) => void; assign: () => void }) {
  const [filters, setFilters] = useState<string[]>(["Alle"]);
  const filtered = useMemo(() => documents.filter(doc => {
    const text = `${doc.title} ${doc.correspondent} ${doc.type}`.toLowerCase();
    if (!text.includes(query.toLowerCase())) return false;
    if (scope === "unassigned" && doc.area && doc.subarea) return false;
    if (scope === "new" && !doc.isNew) return false;
    if (filters.includes("Alle")) return true;
    return filters.some(filter => {
      if (filter === "2026") return doc.date.includes("2026");
      if (filter === "Befunde") return doc.subarea === "findings" || /befund/.test(text);
      if (filter === "Gehaltsabrechnungen") return doc.subarea === "salary" || /gehalt|lohn/.test(text);
      if (filter === "Verträge") return /vertrag/.test(text);
      if (filter === "Rechnungen") return /rechnung|beleg|quittung/.test(text);
      return false;
    });
  }), [documents, filters, query, scope]);
  const filterOptions = ["Alle", "Befunde", "Gehaltsabrechnungen", "Verträge", "Rechnungen", "2026"];
  const toggle = (option: string) => { if (option === "Alle") return setFilters(["Alle"]); const current = filters.filter(x => x !== "Alle"); const next = current.includes(option) ? current.filter(x => x !== option) : [...current, option]; setFilters(next.length ? next : ["Alle"]); };
  const heading = scope === "unassigned" ? "Nicht zugeordnet" : scope === "new" ? "Neue Dokumente" : "Dokumente";
  return <>{editMode && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>Dokumente neu zuordnen</strong><p>Ein oder mehrere Dokumente auswählen und anschließend den Zielbereich festlegen.</p></div></div>}<section className="pageIntro"><div><p className="eyebrow">DOKUMENTENABLAGE</p><h1>{heading}</h1><p>Suchen, filtern und direkt in Paperless öffnen.</p></div></section><SearchBox query={query} setQuery={setQuery}/><section className="filterCard"><p className="eyebrow">SCHNELLAUSWAHL</p><div className="filterPills">{filterOptions.map(option => <button key={option} className={filters.includes(option) ? "active" : ""} onClick={() => toggle(option)}><span>{filters.includes(option) && <Icon name="check" size={14}/>}</span>{option}</button>)}</div></section><DocumentList title="Gefundene Dokumente" subtitle={`${filtered.length} Treffer`} items={filtered} onOpen={openDocument} editMode={editMode} selected={selected} setSelected={setSelected} assign={assign}/></>;
}

function HomeAssistant({ configured, onCountChange }: { configured: boolean; onCountChange: (count: number) => void }) {
  const [sensors, setSensors] = useState<HASensor[]>([]);
  const [available, setAvailable] = useState<HASensor[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState(configured ? "" : "Home Assistant ist noch nicht konfiguriert");
  const loadOverview = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/home-assistant/overview", { cache: "no-store" });
      if (!response.ok) throw new Error("Home Assistant ist nicht erreichbar");
      const payload = await response.json() as { entities?: HASensor[]; selected?: string[] };
      setSensors(payload.entities ?? []); setChosen(payload.selected ?? []); onCountChange((payload.selected ?? []).length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Verbindung fehlgeschlagen"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!configured) return;
    let active = true;
    fetch("/api/home-assistant/overview", { cache: "no-store" }).then(response => {
      if (!response.ok) throw new Error("Home Assistant ist nicht erreichbar");
      return response.json() as Promise<{ entities?: HASensor[]; selected?: string[] }>;
    }).then(payload => {
      if (!active) return;
      setSensors(payload.entities ?? []); setChosen(payload.selected ?? []); onCountChange((payload.selected ?? []).length); setError("");
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Verbindung fehlgeschlagen"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [configured, onCountChange]);
  const openPicker = async () => {
    setPicker(true); setError("");
    try {
      const response = await fetch("/api/home-assistant/entities", { cache: "no-store" });
      if (!response.ok) throw new Error("Sensoren konnten nicht geladen werden");
      const payload = await response.json() as { entities?: HASensor[] };
      setAvailable(payload.entities ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sensoren konnten nicht geladen werden"); }
  };
  const saveSensors = async () => {
    const response = await fetch("/api/home-assistant/sensors", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ entityIds: chosen }) });
    if (!response.ok) { setError("Auswahl konnte nicht gespeichert werden"); return; }
    setPicker(false); await loadOverview();
  };
  const sensorIcon = (sensor: HASensor): IconName => /power|energy|strom|watt/i.test(`${sensor.entityId} ${sensor.name}`) ? "energy" : /home|presence|person|device_tracker/i.test(sensor.entityId) ? "home" : /temp|humidity|feucht|pressure/i.test(`${sensor.entityId} ${sensor.name}`) ? "pulse" : "house";
  return <><section className="pageIntro"><div><p className="eyebrow">HOME ASSISTANT</p><h1>Ausgewählte Messwerte</h1><p>Nur Sensoren, die für deine persönliche Übersicht nützlich sind.</p></div><button className="primaryButton" disabled={!configured} onClick={openPicker}><Icon name="plus" size={17}/>Sensor auswählen</button></section>{loading ? <div className="empty sensorEmpty"><Icon name="sync" size={24}/><strong>Messwerte werden geladen …</strong></div> : sensors.length ? <div className="sensorGrid">{sensors.map(sensor => <article className="sensorCard" key={sensor.entityId}><span><Icon name={sensorIcon(sensor)}/></span><p>{sensor.name}</p><strong>{sensor.state}<small>{sensor.unit}</small></strong><em>{sensor.entityId}</em></article>)}</div> : <div className="empty sensorEmpty"><Icon name="pulse" size={24}/><strong>Noch keine Sensoren ausgewählt</strong><p>Wähle die Werte aus, die auf dieser Seite erscheinen sollen.</p></div>}<section className="infoCard"><div><p className="eyebrow">VERBINDUNG</p><h2>Home Assistant</h2><p>PersonalLab liest Sensoren. Geräte und Automationen bleiben unverändert.</p>{error && <small className="errorText">{error}</small>}</div><span className={configured && !error ? "connected" : "disconnected"}><i/>{configured && !error ? "Verbunden" : "Nicht verbunden"}</span></section>{picker && <div className="dialogBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) setPicker(false); }}><section className="editorDialog sensorDialog"><div className="dialogHead"><div><p className="eyebrow">HOME ASSISTANT</p><h2>Sensoren auswählen</h2></div><button type="button" onClick={() => setPicker(false)}><Icon name="close"/></button></div><p className="dialogLead">Ausgewählte Werte erscheinen als Kacheln. PersonalLab verändert keine Geräte.</p><div className="sensorChoices">{available.map(sensor => <label key={sensor.entityId}><input type="checkbox" checked={chosen.includes(sensor.entityId)} onChange={() => setChosen(current => current.includes(sensor.entityId) ? current.filter(id => id !== sensor.entityId) : [...current, sensor.entityId])}/><span><strong>{sensor.name}</strong><small>{sensor.entityId} · {sensor.state} {sensor.unit}</small></span></label>)}</div><div className="dialogActions"><span/><span/><button type="button" className="quietButton" onClick={() => setPicker(false)}>Abbrechen</button><button type="button" className="primaryButton" onClick={saveSensors}>Auswahl speichern</button></div></section></div>}</>;
}

function Settings({ config, documentCount, sensorCount, lastSync, goSensors }: { config: AppConfig; documentCount: number; sensorCount: number; lastSync: string | null; goSensors: () => void }) {
  const last = lastSync ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSync)) : "Noch kein Abgleich";
  return <><section className="pageIntro"><div><p className="eyebrow">PERSONALLAB</p><h1>Einstellungen</h1><p>Verbindungen, Synchronisation und Bereiche verwalten.</p></div></section><div className="settingsList"><article><span className="settingIcon paperless">P</span><div><h2>Paperless-NGX</h2><p>Dokumente und Metadaten werden ausschließlich gelesen.</p><small className={config.paperless ? "connected" : "disconnected"}><i/>{config.paperless ? `Verbunden · ${documentCount.toLocaleString("de-DE")} Dokumente` : "Nicht konfiguriert"}</small></div>{config.paperlessUrl && <button className="quietButton" onClick={() => window.open(config.paperlessUrl, "_blank", "noopener,noreferrer")}>Öffnen</button>}</article><article><span className="settingIcon"><Icon name="energy"/></span><div><h2>EnergieLab</h2><p>Verbrauch, Kosten, Verträge, Abschläge und Zählerstände.</p><small className={config.energyLab ? "connected" : "disconnected"}><i/>{config.energyLab ? "Verbunden · nur lesend" : "Nicht konfiguriert"}</small></div><span className={config.energyLab ? "statusTag active" : "statusTag"}>{config.energyLab ? "Aktiv" : "Aus"}</span></article><article><span className="settingIcon"><Icon name="money"/></span><div><h2>FinanzLab</h2><p>Kontostände, offene Kredite und kommende Raten.</p><small className={config.financeLab ? "connected" : "disconnected"}><i/>{config.financeLab ? "Verbunden · nur lesend" : "Nicht konfiguriert"}</small></div><span className={config.financeLab ? "statusTag active" : "statusTag"}>{config.financeLab ? "Aktiv" : "Aus"}</span></article><article><span className="settingIcon"><Icon name="home"/></span><div><h2>Home Assistant</h2><p>{sensorCount} Sensoren sind für die Übersicht ausgewählt.</p><small className={config.homeAssistant ? "connected" : "disconnected"}><i/>{config.homeAssistant ? "Verbunden · nur lesend" : "Nicht konfiguriert"}</small></div><button className="quietButton" onClick={goSensors}>Sensoren</button></article><article><span className="settingIcon"><Icon name="sync"/></span><div><h2>Automatischer Abgleich</h2><p>{config.autoSync ? `Neue Paperless-Dokumente werden alle ${config.syncMinutes} Minuten übernommen.` : "Der automatische Abgleich ist ausgeschaltet."}</p><small>Zuletzt: {last}</small></div><span className={config.autoSync ? "statusTag active" : "statusTag"}>{config.autoSync ? "Aktiv" : "Aus"}</span></article></div></>;
}

function Drawer({ document, areas, paperlessUrl, editMode, close, update }: { document: DocumentItem; areas: Area[]; paperlessUrl: string; editMode: boolean; close: () => void; update: (doc: DocumentItem) => void }) {
  const [draft, setDraft] = useState(document);
  const [editing, setEditing] = useState(editMode);
  const [largePreview, setLargePreview] = useState(false);
  const area = areas.find(item => item.id === draft.area);
  const active = area?.subareas.find(item => item.id === draft.subarea);
  const changeArea = (nextArea: string) => { const target = areas.find(item => item.id === nextArea); setDraft(current => ({ ...current, area: nextArea, subarea: target?.subareas[0]?.id ?? "", assignmentSource: "manual" })); };
  const save = () => { update({ ...draft, assignmentSource: "manual", metadataSource: "manual" }); setEditing(false); };
  return <div className="drawerBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><aside className={`drawer ${largePreview ? "previewing" : ""}`}><div className="drawerTop"><span className="docIcon"><Icon name="file"/></span><div className="drawerTopActions">{!editing && <button onClick={() => setEditing(true)} aria-label="Dokument bearbeiten"><Icon name="edit"/></button>}<button onClick={close} aria-label="Schließen"><Icon name="close"/></button></div></div><p className="eyebrow">PAPERLESS #{document.id}</p>{editing ? <div className="drawerForm"><label>Titel<input value={draft.title} onChange={event => setDraft({...draft, title: event.target.value})}/></label><label>Korrespondent<input value={draft.correspondent} onChange={event => setDraft({...draft, correspondent: event.target.value})}/></label><label>Dokumenttyp<input value={draft.type} onChange={event => setDraft({...draft, type: event.target.value})}/></label></div> : <><h2>{draft.title}</h2><p className="drawerLead">{draft.correspondent} · {draft.type}</p></>}{paperlessUrl && <section className={`documentPreview ${largePreview ? "large" : ""}`}><button type="button" onClick={() => setLargePreview(value => !value)}>{largePreview ? <iframe title={`Vorschau ${draft.title}`} src={`/api/documents/${document.id}/preview`}/> : <img src={`/api/documents/${document.id}/thumbnail`} alt={`Miniaturansicht von ${draft.title}`}/>}<span><Icon name={largePreview ? "close" : "open"} size={16}/>{largePreview ? "Vorschau schließen" : "Große Vorschau öffnen"}</span></button></section>}<dl><div><dt>Dokumentdatum</dt><dd>{draft.date}</dd></div><div><dt>Bereich</dt><dd>{area?.name ?? "Nicht zugeordnet"}</dd></div><div><dt>Unterbereich</dt><dd>{active?.name ?? "–"}</dd></div></dl><section className="assignment"><p className="eyebrow">ZUORDNUNG</p>{editing ? <div className="drawerForm assignmentFields"><label>Bereich<select value={draft.area} onChange={event => changeArea(event.target.value)}><option value="">Nicht zugeordnet</option>{areas.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Unterbereich<select value={draft.subarea} disabled={!area} onChange={event => setDraft({...draft, subarea: event.target.value, assignmentSource: "manual"})}><option value="">Bitte wählen</option>{area?.subareas.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div> : <div className="filterPills"><button className={area ? "active" : ""}><span>{area && <Icon name="check" size={14}/>}</span>{area?.name ?? "Nicht zugeordnet"}</button>{active && <button className="active"><span><Icon name="check" size={14}/></span>{active.name}</button>}</div>}</section>{editing ? <div className="drawerActions"><button className="quietButton" onClick={() => { setDraft(document); setEditing(false); }}>Abbrechen</button><button className="primaryButton" onClick={save}><Icon name="check" size={17}/>Änderungen speichern</button></div> : <button className="primaryButton full" disabled={!paperlessUrl} onClick={() => paperlessUrl && window.open(`${paperlessUrl}/documents/${document.id}/details`, "_blank", "noopener,noreferrer")}><Icon name="open" size={17}/>In Paperless öffnen</button>}</aside></div>;
}

function TileEditor({ editor, areas, close, save, remove, move }: { editor: Exclude<EditorState, null>; areas: Area[]; close: () => void; save: (name: string, description: string, tone: Tone, icon: IconName) => void; remove: () => void; move: (direction: -1 | 1) => void }) {
  const area = areas.find(item => item.id === editor.areaId);
  const subarea = editor.kind === "subarea" ? area?.subareas.find(item => item.id === editor.subareaId) : undefined;
  const [name, setName] = useState(subarea?.name ?? area?.name ?? "");
  const [description, setDescription] = useState(subarea?.hint ?? area?.description ?? "");
  const [tone, setTone] = useState<Tone>(area?.tone ?? "green");
  const [icon, setIcon] = useState<IconName>(area?.icon ?? "grid");
  const exists = editor.kind === "area" ? Boolean(editor.areaId) : Boolean(editor.subareaId);
  const title = exists ? (editor.kind === "area" ? "Bereichskachel bearbeiten" : "Unterbereich bearbeiten") : (editor.kind === "area" ? "Neue Bereichskachel" : "Neue Unterbereichskachel");
  return <div className="dialogBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><form className="editorDialog" onSubmit={event => { event.preventDefault(); if (name.trim()) save(name.trim(), description.trim(), tone, icon); }}><div className="dialogHead"><div><p className="eyebrow">BEARBEITUNGSMODUS</p><h2>{title}</h2></div><button type="button" onClick={close} aria-label="Schließen"><Icon name="close"/></button></div><label>Name<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Name der Kachel"/></label><label>Beschreibung<input value={description} onChange={event => setDescription(event.target.value)} placeholder="Kurze Beschreibung"/></label>{editor.kind === "area" && <div className="tileStyleFields"><label>Farbe<select value={tone} onChange={event => setTone(event.target.value as Tone)}><option value="green">Grün</option><option value="teal">Petrol</option><option value="blue">Blau</option><option value="orange">Orange</option><option value="violet">Violett</option><option value="sand">Sand</option><option value="rose">Rosa</option><option value="slate">Grau</option></select></label><label>Symbol<select value={icon} onChange={event => setIcon(event.target.value as IconName)}><option value="grid">Bereich</option><option value="work">Arbeit</option><option value="heart">Gesundheit</option><option value="money">Finanzen</option><option value="shield">Versicherung</option><option value="car">Fahrzeug</option><option value="house">Haus</option><option value="chip">Technik</option><option value="mail">Schriftverkehr</option><option value="energy">Energie</option></select></label></div>}{exists && <div className="orderControls"><span>Reihenfolge</span><button type="button" onClick={() => move(-1)}><Icon name="up" size={17}/>Nach vorn</button><button type="button" onClick={() => move(1)}><Icon name="down" size={17}/>Nach hinten</button></div>}<div className="dialogActions">{exists && <button type="button" className="dangerButton" onClick={remove}><Icon name="trash" size={16}/>Löschen</button>}<span/><button type="button" className="quietButton" onClick={close}>Abbrechen</button><button className="primaryButton" type="submit">Speichern</button></div></form></div>;
}

function AssignmentDialog({ count, areas, close, apply }: { count: number; areas: Area[]; close: () => void; apply: (areaId: string, subareaId: string) => void }) {
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const area = areas.find(item => item.id === areaId) ?? areas[0];
  const [subareaId, setSubareaId] = useState(area?.subareas[0]?.id ?? "");
  const changeArea = (id: string) => { setAreaId(id); const next = areas.find(item => item.id === id); setSubareaId(next?.subareas[0]?.id ?? ""); };
  return <div className="dialogBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><form className="editorDialog assignmentDialog" onSubmit={event => { event.preventDefault(); if (areaId && subareaId) apply(areaId, subareaId); }}><div className="dialogHead"><div><p className="eyebrow">NEU ZUORDNEN</p><h2>{count} {count === 1 ? "Dokument" : "Dokumente"}</h2></div><button type="button" onClick={close}><Icon name="close"/></button></div><p className="dialogLead">Wähle den neuen Bereich und anschließend die passende Kachel.</p><label>Bereich<select value={areaId} onChange={event => changeArea(event.target.value)}>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Unterbereich<select value={subareaId} onChange={event => setSubareaId(event.target.value)}>{area?.subareas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="dialogActions"><span/><span/><button type="button" className="quietButton" onClick={close}>Abbrechen</button><button className="primaryButton" type="submit">Zuordnung übernehmen</button></div></form></div>;
}

export default function PersonalLab() {
  const [screen, setScreen] = useState<Screen>("overview");
  const [areas, setAreas] = useState<Area[]>(AREA_DATA);
  const [documents, setDocuments] = useState<DocumentItem[]>(DOCUMENTS);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [subarea, setSubarea] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [document, setDocument] = useState<DocumentItem | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [documentScope, setDocumentScope] = useState<DocumentScope>("all");
  const [config, setConfig] = useState<AppConfig>({ paperless: false, paperlessUrl: "", homeAssistant: false, homeAssistantUrl: "", energyLab: false, financeLab: false, autoSync: false, syncMinutes: 15 });
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [selectedSensorCount, setSelectedSensorCount] = useState(0);
  useEffect(() => {
    let active = true;
    fetch("/api/state", { cache: "no-store" }).then(response => {
      if (!response.ok) throw new Error("Datendienst nicht erreichbar");
      return response.json();
    }).then((payload: { areas?: Area[]; documents?: DocumentItem[]; config?: AppConfig; lastSync?: string | null; haSensors?: string[] }) => {
      if (!active || !Array.isArray(payload.areas) || !Array.isArray(payload.documents)) return;
      const nextDocuments = payload.documents.map(item => {
        const value = String(item.date ?? "");
        const parts = value.slice(0, 10).split("-");
        return { ...item, date: parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : value };
      });
      const nextAreas = payload.areas.map(item => ({ ...item, count: nextDocuments.filter(doc => doc.area === item.id).length, subareas: item.subareas.map(sub => ({ ...sub, count: nextDocuments.filter(doc => doc.area === item.id && doc.subarea === sub.id).length })) }));
      setAreas(nextAreas);
      setDocuments(nextDocuments);
      if (payload.config) setConfig(payload.config);
      setLastSync(payload.lastSync ?? null);
      setSelectedSensorCount(payload.haSensors?.length ?? 0);
      setHydrated(true);
    }).catch(() => { /* Die interaktive Vorschau bleibt ohne lokalen Datendienst nutzbar. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ areas, documents }) }).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [areas, documents, hydrated]);
  const countedAreas = useMemo(() => hydrated ? areas.map(item => ({ ...item, count: documents.filter(doc => doc.area === item.id).length, subareas: item.subareas.map(sub => ({ ...sub, count: documents.filter(doc => doc.area === item.id && doc.subarea === sub.id).length })) })) : areas, [areas, documents, hydrated]);
  const area = countedAreas.find(item => item.id === areaId) ?? null;
  const navigate = (next: Screen) => { setScreen(next); setQuery(""); setSelected([]); if (next === "documents") setDocumentScope("all"); if (next !== "area") { setAreaId(null); setSubarea(null); } };
  const openDocuments = (scope: DocumentScope) => { setDocumentScope(scope); setQuery(""); setSelected([]); setScreen("documents"); };
  const openArea = (next: Area) => { setAreaId(next.id); setSubarea(null); setQuery(""); setScreen("area"); };
  const toggleEdit = () => { setEditMode(value => !value); setSelected([]); setEditor(null); setAssigning(false); };
  const slug = (name: string) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `kachel-${Date.now()}`;
  const saveTile = (name: string, description: string, tone: Tone, icon: IconName) => {
    if (!editor) return;
    if (editor.kind === "area") {
      if (editor.areaId) setAreas(current => current.map(item => item.id === editor.areaId ? { ...item, name, description, tone, icon } : item));
      else setAreas(current => [...current, { id: `${slug(name)}-${Date.now()}`, name, description, tone, icon, count: 0, subareas: [] }]);
    } else {
      setAreas(current => current.map(item => item.id !== editor.areaId ? item : { ...item, subareas: editor.subareaId ? item.subareas.map(sub => sub.id === editor.subareaId ? { ...sub, name, hint: description } : sub) : [...item.subareas, { id: `${slug(name)}-${Date.now()}`, name, hint: description, count: 0 }] }));
    }
    setEditor(null);
  };
  const removeTile = () => {
    if (!editor) return;
    const hasDocuments = editor.kind === "area" ? documents.some(doc => doc.area === editor.areaId) : documents.some(doc => doc.area === editor.areaId && doc.subarea === editor.subareaId);
    if (hasDocuments) { window.alert("Diese Kachel enthält noch Dokumente. Ordne sie zuerst einer anderen Kachel zu."); return; }
    if (!window.confirm("Kachel wirklich löschen?")) return;
    if (editor.kind === "area") setAreas(current => current.filter(item => item.id !== editor.areaId));
    else setAreas(current => current.map(item => item.id === editor.areaId ? { ...item, subareas: item.subareas.filter(sub => sub.id !== editor.subareaId) } : item));
    setEditor(null);
  };
  const moveTile = (direction: -1 | 1) => {
    if (!editor) return;
    if (editor.kind === "area" && editor.areaId) setAreas(current => { const index = current.findIndex(item => item.id === editor.areaId); const target = index + direction; if (index < 0 || target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
    if (editor.kind === "subarea" && editor.subareaId) setAreas(current => current.map(item => { if (item.id !== editor.areaId) return item; const index = item.subareas.findIndex(sub => sub.id === editor.subareaId); const target = index + direction; if (index < 0 || target < 0 || target >= item.subareas.length) return item; const next = [...item.subareas]; [next[index], next[target]] = [next[target], next[index]]; return { ...item, subareas: next }; }));
  };
  const applyAssignment = (nextArea: string, nextSubarea: string) => { setDocuments(current => current.map(doc => selected.includes(doc.id) ? { ...doc, area: nextArea, subarea: nextSubarea, assignmentSource: "manual" } : doc)); setSelected([]); setAssigning(false); };
  const renameParty = (oldName: string, newName: string, fallback: string) => setDocuments(current => current.map(doc => doc.area === "work" && (doc.correspondent.trim() || fallback) === oldName ? { ...doc, correspondent: newName, assignmentSource: "manual", metadataSource: "manual" } : doc));
  const updateDocument = (next: DocumentItem) => setDocuments(current => current.map(doc => doc.id === next.id ? next : doc));
  const commonList = { editMode, selected, setSelected, assign: () => { if (selected.length) setAssigning(true); } };
  return <div className={`app ${editMode ? "editing" : ""}`}><Header screen={screen} navigate={navigate} editMode={editMode} toggleEdit={toggleEdit}/><main className="page">{screen === "overview" && <Overview areas={countedAreas} documents={documents} openArea={openArea} openDocuments={openDocuments} paperlessUrl={config.paperlessUrl} query={query} setQuery={setQuery} openDocument={setDocument} editMode={editMode} editArea={item => setEditor({ kind: "area", areaId: item.id })} addArea={() => setEditor({ kind: "area" })} {...commonList}/>} {screen === "area" && area && <AreaView area={area} documents={documents} config={config} selectedSubarea={subarea} chooseSubarea={setSubarea} goBack={() => navigate("overview")} query={query} setQuery={setQuery} openDocument={setDocument} editMode={editMode} editSubarea={id => setEditor({ kind: "subarea", areaId: area.id, subareaId: id })} addSubarea={() => setEditor({ kind: "subarea", areaId: area.id })} renameParty={renameParty} {...commonList}/>} {screen === "documents" && <DocumentsView documents={documents} scope={documentScope} query={query} setQuery={setQuery} openDocument={setDocument} {...commonList}/>} {screen === "home-assistant" && <HomeAssistant configured={config.homeAssistant} onCountChange={setSelectedSensorCount}/>} {screen === "settings" && <Settings config={config} documentCount={documents.length} sensorCount={selectedSensorCount} lastSync={lastSync} goSensors={() => navigate("home-assistant")}/>}</main><footer><span>PersonalLab</span><span>lokal auf deinem ZimaOS</span><span>by Lrd.Tiberius</span></footer>{document && <Drawer document={document} areas={countedAreas} paperlessUrl={config.paperlessUrl} editMode={editMode} close={() => setDocument(null)} update={updateDocument}/>} {editor && <TileEditor key={`${editor.kind}-${editor.areaId ?? "new"}-${editor.kind === "subarea" ? editor.subareaId ?? "new" : ""}`} editor={editor} areas={areas} close={() => setEditor(null)} save={saveTile} remove={removeTile} move={moveTile}/>} {assigning && <AssignmentDialog count={selected.length} areas={countedAreas} close={() => setAssigning(false)} apply={applyAssignment}/>}</div>;
}

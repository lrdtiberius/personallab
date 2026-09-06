"use client";

import { useEffect, useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { EnergyIntegration, FinanceIntegration } from "./integrations";
import { DEFAULT_PAGE_LAYOUTS, normalizePageLayouts, type PageBlockId, type PageLayout, type PageLayouts } from "./page-layouts";
import { documentSummary, documentYear, friendlyDocumentTitle, sortDocumentsByDate, type DocumentSortDirection } from "./document-presentation";
import { searchDocuments } from "./document-search";

type Screen = "overview" | "documents" | "area" | "home-assistant" | "settings";
type Tone = "green" | "blue" | "orange" | "violet" | "sand" | "rose" | "slate" | "teal";

type Subarea = { id: string; uid?: string; name: string; count: number; hint: string; groups?: string[]; children?: Subarea[] };
type Area = {
  id: string;
  name: string;
  count: number;
  description: string;
  tone: Tone;
  icon: IconName;
  subareas: Subarea[];
  groups?: string[];
};
type DocumentItem = {
  id: number;
  title: string;
  sourceTitle?: string;
  correspondent: string;
  type: string;
  date: string;
  area: string;
  subarea: string;
  group?: string;
  tileId?: string;
  isNew?: boolean;
  assignmentSource?: "rule" | "manual" | "unassigned" | "review";
  metadataSource?: "paperless" | "manual";
  contractStatus?: "active" | "expiring" | "inactive" | "unknown";
  contractStatusManual?: boolean;
  contractStart?: string;
  contractEnd?: string;
  cancellationDeadline?: string;
  autoRenew?: boolean;
  contractNumber?: string;
  analysisSummary?: string;
  analysisConfidence?: number | null;
  presentationTitle?: string;
  presentationSummary?: string;
  analysisKeywords?: string[];
  analysisCategory?: string;
  analysisSearchText?: string;
  tags?: string[];
};
type AppConfig = { paperless: boolean; paperlessUrl: string; analyzer: boolean; analyzerUrl: string; rag: boolean; ragUrl: string; homeAssistant: boolean; homeAssistantUrl: string; energyLab: boolean; financeLab: boolean; autoSync: boolean; syncMinutes: number };
type RagSource = { documentId: number; title: string; correspondent: string; documentType: string; documentDate: string; excerpt: string; score: number };
type RagSearchState = { status: "idle" | "loading" | "done" | "error"; answer: string; sources: RagSource[] };
type HASensor = { entityId: string; name: string; state: string; unit: string; icon: string; updated: string };
type DocumentScope = "all" | "unassigned" | "new";
type IconName = "home" | "file" | "grid" | "pulse" | "settings" | "search" | "sync" | "heart" | "work" | "money" | "shield" | "car" | "house" | "chip" | "mail" | "energy" | "inbox" | "clock" | "open" | "back" | "next" | "close" | "check" | "edit" | "plus" | "trash" | "up" | "down" | "move";
type EditorState =
  | { kind: "area"; areaId?: string }
  | { kind: "subarea"; areaId: string; subareaId?: string }
  | null;
type TreeNodeEditorState =
  | { areaId: string; uid: string; parentUid?: never }
  | { areaId: string; parentUid: string; uid?: never }
  | null;

type DropDestination = { areaId: string; rootId: string; tileId: string; group?: string; label: string };
type UndoMove = { documents: DocumentItem[]; message: string } | null;
type FinanceAccountAssignments = Record<string, string[]>;
type FinanceDataSelections = Record<string, string[]>;
type EnergyProviderAssignments = Record<string, string[]>;
type EnergyMetricSelections = Record<string, string[]>;

const nodeUid = (areaId: string, node: Subarea) => node.uid ?? `tile:${areaId}:${node.id}`;
const walkNodes = (nodes: Subarea[]): Subarea[] => nodes.flatMap(node => [node, ...walkNodes(node.children ?? [])]);
const descendantUids = (areaId: string, node: Subarea): string[] => walkNodes([node]).map(item => nodeUid(areaId, item));
const normalizeNode = (areaId: string, node: Subarea): Subarea => ({ ...node, uid: nodeUid(areaId, node), hint: node.hint ?? "", groups: Array.isArray(node.groups) ? node.groups : [], children: (node.children ?? []).map(child => normalizeNode(areaId, child)) });
const mapNodeTree = (areaId: string, nodes: Subarea[], uid: string, transform: (node: Subarea) => Subarea): Subarea[] => nodes.map(node => nodeUid(areaId, node) === uid ? transform(node) : { ...node, children: mapNodeTree(areaId, node.children ?? [], uid, transform) });
const removeNodeTree = (areaId: string, nodes: Subarea[], uid: string): Subarea[] => nodes.filter(node => nodeUid(areaId, node) !== uid).map(node => ({ ...node, children: removeNodeTree(areaId, node.children ?? [], uid) }));
const moveNodeTree = (areaId: string, nodes: Subarea[], uid: string, direction: -1 | 1): Subarea[] => {
  const index = nodes.findIndex(node => nodeUid(areaId, node) === uid);
  if (index >= 0) {
    const target = index + direction;
    if (target < 0 || target >= nodes.length) return nodes;
    const next = [...nodes];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }
  return nodes.map(node => ({ ...node, children: moveNodeTree(areaId, node.children ?? [], uid, direction) }));
};
const findNode = (areaId: string, nodes: Subarea[], uid: string) => walkNodes(nodes).find(node => nodeUid(areaId, node) === uid);
const isContract = (doc: DocumentItem) => doc.area === "contracts" || /vertrag|police|abonnement|mitgliedschaft|tarif/i.test(`${doc.title} ${doc.type}`);
const cleanCorrespondent = (value: string) => !value.trim() || /^Nicht (?:eindeutig|erkannt)(?:\s|$)/i.test(value.trim()) ? "Nicht erkannt" : value.trim();
const groupName = (doc: DocumentItem, fallback: string) => {
  const group = doc.group?.trim() ?? "";
  if (/^\d+$/.test(group)) return cleanCorrespondent(doc.correspondent) || fallback;
  return group || cleanCorrespondent(doc.correspondent) || fallback;
};
const documentsForTreeNode = (areaId: string, rootId: string, node: Subarea, documents: DocumentItem[]) => {
  const uids = new Set(descendantUids(areaId, node));
  const names = new Set(walkNodes([node]).map(item => item.name));
  return documents.filter(doc => doc.area === areaId && doc.subarea === rootId && (
    uids.has(doc.tileId ?? "")
    || (node.id === rootId && !doc.tileId)
    || (node.id !== rootId && names.has(groupName(doc, "Sonstiges")))
  ));
};
const findTreeSelection = (area: Area, key: string | null) => {
  if (!key) return null;
  for (const root of area.subareas) {
    const visit = (node: Subarea, path: Subarea[]): { root: Subarea; node: Subarea; path: Subarea[] } | null => {
      const nextPath = [...path, node];
      if (nodeUid(area.id, node) === key || (path.length === 0 && node.id === key)) return { root, node, path: nextPath };
      for (const child of node.children ?? []) {
        const found = visit(child, nextPath);
        if (found) return found;
      }
      return null;
    };
    const found = visit(root, []);
    if (found) return found;
  }
  return null;
};
type HierarchyChoice = { rootId: string; tileId: string; path: Subarea[] };
const hierarchyChoice = (area: Area | undefined, tileId?: string, rootId?: string): HierarchyChoice | null => {
  if (!area) return null;
  const selection = findTreeSelection(area, tileId || rootId || null);
  return selection ? { rootId: selection.root.id, tileId: nodeUid(area.id, selection.node), path: selection.path } : null;
};
const documentSearchText = (doc: DocumentItem) => `${friendlyDocumentTitle(doc)} ${doc.title} ${doc.correspondent} ${doc.type} ${doc.presentationTitle ?? ""} ${doc.presentationSummary ?? ""} ${doc.analysisSummary ?? ""} ${(doc.analysisKeywords ?? []).join(" ")} ${doc.analysisCategory ?? ""} ${doc.analysisSearchText ?? ""}`.toLowerCase();
const documentCorrespondentLabel = (value: string) => cleanCorrespondent(value);
const documentTypeLabel = (value: string) => !value.trim() || /^Nicht (?:eindeutig|erkannt)(?:\s|$)/i.test(value.trim()) ? "Dokumenttyp offen" : value.trim();

function isoDate(value?: string) {
  if (!value) return "";
  const german = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return german ? `${german[3]}-${german[2]}-${german[1]}` : value.slice(0, 10);
}

function contractPresentation(doc: DocumentItem) {
  if (!isContract(doc)) return null;
  if (doc.contractStatusManual && doc.contractStatus) {
    const labels = { active: "Aktiv", expiring: "Läuft bald aus", inactive: "Inaktiv", unknown: "Status prüfen" };
    return { status: doc.contractStatus, label: labels[doc.contractStatus] };
  }
  const end = isoDate(doc.contractEnd);
  if (!end) return { status: doc.contractStatus ?? "unknown", label: doc.contractStatus === "inactive" ? "Inaktiv" : "Status prüfen" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const endDate = new Date(`${end}T00:00:00`);
  const days = Math.ceil((endDate.getTime() - today.getTime()) / 86400000);
  if (days < 0 && !doc.autoRenew) return { status: "inactive" as const, label: "Inaktiv" };
  if (days <= 90) return { status: "expiring" as const, label: doc.autoRenew && days < 0 ? "Verlängerung prüfen" : "Läuft bald aus" };
  return { status: "active" as const, label: "Aktiv" };
}

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
    description: "Strom, Gas, Wasser, Abwasser und Photovoltaik aus EnergieLab", tone: "teal", icon: "energy",
    subareas: [
      { id: "electricity", name: "Strom", count: 14, hint: "Verbrauch, Vertrag, Abschlag und Zählerstand" },
      { id: "water", name: "Wasser", count: 7, hint: "Verbrauch, Vertrag, Abschlag und Zählerstand" },
      { id: "wastewater", name: "Abwasser", count: 0, hint: "Wasserverbrauch, eigener Vertrag, Zahlungen und Kosten" },
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
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  const submit = () => {
    const next = draft.trim();
    if (next.length >= 2) setQuery(next);
  };
  const clear = () => {
    setDraft("");
    setQuery("");
  };
  return <form className="searchBox compactSearch" onSubmit={event => { event.preventDefault(); submit(); }}><Icon name="search" size={17}/><input id="globalDocumentSearch" aria-label="Frage oder Suchbegriff eingeben" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Frage eingeben und mit Enter suchen …"/>{draft ? <button type="button" className="searchClear" onClick={clear} aria-label="Suche löschen"><Icon name="close" size={14}/></button> : <kbd>⌘ K</kbd>}<button type="submit" className="searchSubmit" disabled={draft.trim().length < 2}>Suchen</button></form>;
}

function HierarchySelectors({ area, value, change, prefix = "" }: { area?: Area; value: HierarchyChoice | null; change: (choice: HierarchyChoice | null) => void; prefix?: string }) {
  if (!area) return null;
  const levels: Array<{ options: Subarea[]; selected?: Subarea }> = [];
  let options = area.subareas;
  let depth = 0;
  while (options.length) {
    const selected = value?.path[depth];
    levels.push({ options, selected });
    if (!selected) break;
    options = selected.children ?? [];
    depth += 1;
  }
  const choose = (level: number, uid: string) => {
    const prefixPath = value?.path.slice(0, level) ?? [];
    if (!uid) {
      const deepest = prefixPath.at(-1);
      if (!deepest) return change(null);
      return change({ rootId: prefixPath[0].id, tileId: nodeUid(area.id, deepest), path: prefixPath });
    }
    const selected = levels[level].options.find(node => nodeUid(area.id, node) === uid);
    if (!selected) return;
    const path = [...prefixPath, selected];
    change({ rootId: path[0].id, tileId: nodeUid(area.id, selected), path });
  };
  return <>{levels.map((level, index) => <label key={`${prefix}hierarchy-${index}`}>Ebene {index + 2} · {index === 0 ? "Unterbereich" : index === 1 ? "Untergruppe" : "Unterebene"}<select value={level.selected ? nodeUid(area.id, level.selected) : ""} onChange={event => choose(index, event.target.value)}><option value="">{index === 0 ? "Bitte wählen" : "Auf vorheriger Ebene ablegen"}</option>{level.options.map(node => <option key={nodeUid(area.id, node)} value={nodeUid(area.id, node)}>{node.name}</option>)}</select></label>)}</>;
}

function YearTiles({ documents, choose, back }: { documents: DocumentItem[]; choose: (year: string) => void; back?: () => void }) {
  const years = [...new Set(documents.map(documentYear))].sort((left, right) => {
    if (left === "Ohne Jahr") return 1;
    if (right === "Ohne Jahr") return -1;
    return right.localeCompare(left, "de");
  });
  return <section className="yearSection"><div className="sectionTitle"><div><p className="eyebrow">JAHRE</p><h2>Welches Jahr möchtest du öffnen?</h2></div>{back && <button className="quietButton" onClick={back}><Icon name="back" size={16}/>Eine Ebene zurück</button>}</div><div className="yearGrid">{years.map(year => { const count = documents.filter(doc => documentYear(doc) === year).length; return <button className="yearTile" key={year} onClick={() => choose(year)}><span className="yearIcon"><Icon name="clock" size={19}/></span><strong>{year}</strong><small>{count} {count === 1 ? "Dokument" : "Dokumente"}</small><Icon name="next" size={17}/></button>; })}{years.length === 0 && <div className="yearEmpty"><strong>Noch keine Dokumente</strong><span>Sobald Dokumente vorhanden sind, erscheinen die Jahre automatisch.</span></div>}</div></section>;
}

function CompactYearFilter({ documents, value, change }: { documents: DocumentItem[]; value: string; change: (year: string) => void }) {
  const years = [...new Set(documents.map(documentYear))].sort((a, b) => a === "Ohne Jahr" ? 1 : b === "Ohne Jahr" ? -1 : Number(b) - Number(a));
  return <label className="compactYearFilter"><Icon name="clock" size={17}/><span>Jahr</span><select value={value} onChange={event => change(event.target.value)}><option value="">Alle Jahre</option>{years.map(year => <option key={year} value={year}>{year} · {documents.filter(doc => documentYear(doc) === year).length}</option>)}</select></label>;
}

const blockLabels: Record<PageBlockId, string> = {
  integration: "Import aus Lab",
  navigation: "Unterbereiche und Gruppen",
  documents: "Dokumente",
};

function PageLayoutEditor({ source, layout, change }: { source: "finance" | "energy"; layout: PageLayout; change: (layout: PageLayout) => void }) {
  const labels = { ...blockLabels, integration: source === "finance" ? "FinanzLab-Import" : "EnergieLab-Import" };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= layout.blocks.length) return;
    const blocks = [...layout.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    change({ blocks });
  };
  const drop = (event: DragEvent<HTMLLIElement>, targetId: PageBlockId) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("application/x-personallab-page-block") as PageBlockId;
    if (!draggedId || draggedId === targetId) return;
    const dragged = layout.blocks.find(item => item.id === draggedId);
    const targetIndex = layout.blocks.findIndex(item => item.id === targetId);
    if (!dragged || targetIndex < 0) return;
    const blocks = layout.blocks.filter(item => item.id !== draggedId);
    blocks.splice(targetIndex, 0, dragged);
    change({ blocks });
  };
  return <section className="pageLayoutEditor"><div className="pageLayoutHead"><div><p className="eyebrow">SEITENAUFBAU</p><h2>Ganze Bereiche anordnen</h2><p>Ziehe komplette Bereiche an die gewünschte Stelle oder blende sie aus. Die Änderung wird automatisch gespeichert.</p></div></div><ol>{layout.blocks.map((entry, index) => <li key={entry.id} className={entry.visible ? "" : "hidden"} draggable onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-personallab-page-block", entry.id); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={event => drop(event, entry.id)}><span className="pageBlockDrag" title="Bereich ziehen"><Icon name="move" size={18}/></span><strong>{labels[entry.id]}</strong><span className="pageBlockOrder"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${labels[entry.id]} nach oben`}><Icon name="up" size={16}/></button><button type="button" disabled={index === layout.blocks.length - 1} onClick={() => move(index, 1)} aria-label={`${labels[entry.id]} nach unten`}><Icon name="down" size={16}/></button></span><label><input type="checkbox" checked={entry.visible} onChange={event => change({ blocks: layout.blocks.map(item => item.id === entry.id ? { ...item, visible: event.target.checked } : item) })}/><span>{entry.visible ? "Angezeigt" : "Ausgeblendet"}</span></label></li>)}</ol></section>;
}

function OrderedPageBlocks({ layout, blocks }: { layout: PageLayout; blocks: Partial<Record<PageBlockId, ReactNode>> }) {
  return <>{layout.blocks.filter(item => item.visible).map(item => blocks[item.id] ? <div className="orderedPageBlock" data-block={item.id} key={item.id}>{blocks[item.id]}</div> : null)}</>;
}

function AreaTile({ area, editMode, onOpen, onEdit }: { area: Area; editMode: boolean; onOpen: () => void; onEdit: () => void }) {
  return <button className={`areaTile tone-${area.tone} ${editMode ? "editable" : ""}`} onClick={editMode ? onEdit : onOpen}>{editMode && <span className="editFlag"><Icon name="edit" size={13}/>Ändern</span>}<span className="areaIcon"><Icon name={area.icon} size={25}/></span><span className="areaText"><strong>{area.name}</strong><small>{area.description}</small></span><span className="areaCount"><strong>{area.count.toLocaleString("de-DE")}</strong><small>Dokumente</small></span><Icon name={editMode ? "move" : "next"} size={18}/></button>;
}

function DocumentList({ title, subtitle, items, onOpen, editMode, selected, setSelected, assign, dragDocument, sortDirection = "desc", setSortDirection }: { title: string; subtitle: string; items: DocumentItem[]; onOpen: (doc: DocumentItem) => void; editMode: boolean; selected: number[]; setSelected: (ids: number[]) => void; assign: () => void; dragDocument?: (event: DragEvent<HTMLButtonElement>, doc: DocumentItem) => void; sortDirection?: DocumentSortDirection; setSortDirection?: (direction: DocumentSortDirection) => void }) {
  const toggle = (id: number) => setSelected(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
  const sortedItems = useMemo(() => sortDocumentsByDate(items, sortDirection), [items, sortDirection]);
  return <section className="documentPanel">
    <div className="panelHead"><div><p className="eyebrow">DOKUMENTE</p><h2>{title}</h2><p>{subtitle}</p></div><div className="documentListActions"><label className="sortControl"><Icon name="clock" size={15}/><span>Sortierung</span><select aria-label="Dokumente sortieren" value={sortDirection} onChange={event => setSortDirection?.(event.target.value as DocumentSortDirection)}><option value="desc">Datum: neueste zuerst</option><option value="asc">Datum: älteste zuerst</option></select></label>{editMode ? <div className="selectionActions"><span>{selected.length} ausgewählt</span><button className="primaryButton" disabled={!selected.length} onClick={assign}>Neu zuordnen</button></div> : <span className="dragHint"><Icon name="move" size={15}/>Auf ein Ziel links ziehen</span>}</div></div>
    <div className="docTable"><div className="docTableHead"><span>Dokument und Inhaltsangabe</span><span>Typ</span><span>Datum</span><span/></div>{sortedItems.length ? sortedItems.map(doc => {
      const contract = contractPresentation(doc);
      const displayTitle = friendlyDocumentTitle(doc);
      const summary = documentSummary(doc, 150);
      const correspondent = documentCorrespondentLabel(doc.correspondent);
      const type = documentTypeLabel(doc.type);
      return <button draggable className={`docRow ${selected.includes(doc.id) ? "selected" : ""} ${contract ? `contract-${contract.status}` : ""}`} key={doc.id} onDragStart={event => dragDocument?.(event, doc)} onClick={() => editMode ? toggle(doc.id) : onOpen(doc)} title="Dokument auf einen Ablageort in der linken Liste ziehen">{editMode && <span className="rowCheck">{selected.includes(doc.id) && <Icon name="check" size={14}/>}</span>}<span className="docIdentity"><span className="docIcon"><Icon name="file" size={18}/></span><span className="docIdentityText"><strong title={displayTitle !== doc.title ? `Originaltitel: ${doc.title}` : undefined}>{displayTitle}</strong><small className="documentSummary">{summary}</small><small className="docMeta">{correspondent} · {type} · Paperless #{doc.id}</small></span>{doc.isNew && <em>Neu</em>}{contract && <em className={`contractBadge ${contract.status}`}>{contract.label}</em>}</span><span className="typeTag">{type}</span><span className="docDate">{doc.date}</span><Icon name="move" size={18}/></button>;
    }) : <div className="empty"><Icon name="search" size={24}/><strong>Keine passenden Dokumente</strong><p>In dieser Auswahl wurde nichts gefunden.</p></div>}</div>
  </section>;
}

function SearchResults({ documents, query, searchRevision, setQuery, analyzer, rag, openDocument, editMode, selected, setSelected, assign, dragDocument, sortDirection, setSortDirection }: { documents: DocumentItem[]; query: string; searchRevision: number; setQuery: (value: string) => void; analyzer: boolean; rag: boolean; openDocument: (doc: DocumentItem) => void; editMode: boolean; selected: number[]; setSelected: (ids: number[]) => void; assign: () => void; dragDocument: (event: DragEvent<HTMLButtonElement>, doc: DocumentItem) => void; sortDirection: DocumentSortDirection; setSortDirection: (direction: DocumentSortDirection) => void }) {
  const localResults = useMemo(() => searchDocuments(documents.map(document => ({ ...document, searchTitle: friendlyDocumentTitle(document) })), query), [documents, query]);
  const [ragSearch, setRagSearch] = useState<RagSearchState>({ status: "idle", answer: "", sources: [] });
  useEffect(() => {
    const searchQuery = query.trim();
    if (!rag || searchQuery.length < 2) {
      setRagSearch({ status: "idle", answer: "", sources: [] });
      return;
    }
    const controller = new AbortController();
    setRagSearch({ status: "loading", answer: "", sources: [] });
    fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: searchQuery }), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Paperless KI-Suche nicht erreichbar");
        const payload = await response.json() as { answer?: string; sources?: RagSource[] };
        setRagSearch({ status: "done", answer: String(payload.answer ?? ""), sources: Array.isArray(payload.sources) ? payload.sources : [] });
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRagSearch({ status: "error", answer: "", sources: [] });
      });
    return () => controller.abort();
  }, [query, rag, searchRevision]);
  const results = useMemo(() => {
    if (!rag || ragSearch.status === "error") return localResults;
    if (ragSearch.status !== "done") return [];
    const byId = new Map(documents.map(document => [document.id, document]));
    const seen = new Set<number>();
    return ragSearch.sources.flatMap(source => {
      const document = byId.get(source.documentId);
      if (!document || seen.has(document.id)) return [];
      seen.add(document.id);
      return [{ ...document, presentationSummary: source.excerpt || document.presentationSummary }];
    });
  }, [documents, localResults, rag, ragSearch]);
  const statusText = ragSearch.status === "loading" ? "Paperless KI-Suche läuft …" : ragSearch.status === "done" ? "Antwort der Paperless KI-Suche" : ragSearch.status === "error" ? "Lokale Ausweichsuche" : rag ? "Paperless KI-Suche bereit" : analyzer ? "KI-Metadaten verbunden" : "Lokale Suche";
  const statusActive = ragSearch.status !== "error" && (rag || analyzer);
  const resultSubtitle = rag && ragSearch.status === "done" ? `${results.length} ${results.length === 1 ? "Quelldokument" : "Quelldokumente"} der Paperless KI-Suche` : `${results.length} ${results.length === 1 ? "Treffer" : "Treffer"} in der gesamten Ablage`;
  return <>
    <SearchBox query={query} setQuery={setQuery}/>
    <section className="searchResultsIntro"><div><p className="eyebrow">SUCHE IN ALLEN BEREICHEN</p><h1>Treffer für „{query.trim()}“</h1><p>Die Frage wird erst nach Enter oder einem Klick auf „Suchen“ an den vorhandenen Paperless-KI-Suchcontainer übermittelt. Seine Antwort, Quellenreihenfolge und Textausschnitte werden unverändert übernommen.</p></div><span className={statusActive ? "aiSearchStatus active" : "aiSearchStatus"}><Icon name={ragSearch.status === "loading" ? "sync" : statusActive ? "check" : "search"} size={15}/>{statusText}</span></section>
    {ragSearch.status === "done" && ragSearch.answer && <section className="ragAnswerCard" aria-live="polite"><span className="ragAnswerIcon"><Icon name="search" size={18}/></span><div><p className="eyebrow">ANTWORT DER PAPERLESS KI-SUCHE</p><p>{ragSearch.answer}</p><small>{ragSearch.sources.length} {ragSearch.sources.length === 1 ? "Quelldokument" : "Quelldokumente"} aus Qdrant und Ollama</small></div></section>}
    {ragSearch.status === "loading"
      ? <section className="ragLoadingCard" aria-live="polite"><Icon name="sync" size={20}/><div><strong>Antwort wird erstellt</strong><span>Die Paperless KI-Suche durchsucht deine lokal gespeicherten Dokumente.</span></div></section>
      : <DocumentList title="Suchergebnisse" subtitle={resultSubtitle} items={results} onOpen={openDocument} editMode={editMode} selected={selected} setSelected={setSelected} assign={assign} dragDocument={dragDocument} sortDirection={sortDirection} setSortDirection={setSortDirection}/>
    }
  </>;
}

function DocumentWorkspace({ document, paperlessUrl, editMode, back, edit, deactivate }: { document: DocumentItem; paperlessUrl: string; editMode: boolean; back: () => void; edit: () => void; deactivate: () => Promise<void> }) {
  const title = friendlyDocumentTitle(document);
  const contract = contractPresentation(document);
  const summary = documentSummary(document, 320);
  const [confirmingDeactivation, setConfirmingDeactivation] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivationError, setDeactivationError] = useState("");
  const confirmDeactivation = async () => {
    setDeactivating(true);
    setDeactivationError("");
    try {
      await deactivate();
    } catch (reason) {
      setDeactivationError(reason instanceof Error ? reason.message : "Das Dokument konnte nicht deaktiviert werden.");
      setDeactivating(false);
    }
  };
  return <>
    <div className="documentWorkspace">
      <div className="documentWorkspaceTop">
        <button className="quietButton" onClick={back}><Icon name="back" size={16}/>Zur Dokumentliste</button>
        <div className="documentWorkspaceActions">
          {editMode && <button className="dangerButton" onClick={() => setConfirmingDeactivation(true)} title="Dokument nur in PersonalLab ausblenden"><Icon name="trash" size={16}/>In PersonalLab deaktivieren</button>}
          <button className="quietButton" onClick={edit}><Icon name="edit" size={16}/>Metadaten bearbeiten</button>
          <button className="primaryButton" disabled={!paperlessUrl} onClick={() => paperlessUrl && window.open(`${paperlessUrl}/documents/${document.id}/details`, "_blank", "noopener,noreferrer")}><Icon name="open" size={16}/>In Paperless öffnen</button>
        </div>
      </div>
      <section className="documentWorkspaceIntro"><div><p className="eyebrow">PAPERLESS #{document.id}</p><h1>{title}</h1><p>{documentCorrespondentLabel(document.correspondent)} · {documentTypeLabel(document.type)} · {document.date}</p></div>{contract && <span className={`contractBadge large ${contract.status}`}>{contract.label}</span>}</section>
      <div className="documentWorkspaceGrid"><section className="pdfWorkspace">{paperlessUrl ? <iframe title={`PDF-Vorschau ${title}`} src={`/api/documents/${document.id}/preview`}/> : <div className="pdfWorkspaceEmpty"><Icon name="file" size={34}/><strong>PDF-Vorschau nicht verfügbar</strong><p>Verbinde Paperless-NGX, damit Dokumente hier direkt angezeigt werden.</p></div>}</section><aside className="documentFacts"><p className="eyebrow">DOKUMENTDETAILS</p><dl><div className="factSummary"><dt>Kurze Inhaltsangabe</dt><dd>{summary}</dd></div><div><dt>Lesbarer Name</dt><dd>{title}</dd></div>{title !== document.title && <div><dt>Originaltitel</dt><dd>{document.title}</dd></div>}<div><dt>Korrespondent</dt><dd>{documentCorrespondentLabel(document.correspondent)}</dd></div><div><dt>Dokumenttyp</dt><dd>{documentTypeLabel(document.type)}</dd></div><div><dt>Dokumentdatum</dt><dd>{document.date || "–"}</dd></div><div><dt>Jahr</dt><dd>{documentYear(document)}</dd></div></dl></aside></div>
    </div>
    {confirmingDeactivation && <div className="dialogBackdrop" onMouseDown={event => { if (!deactivating && event.currentTarget === event.target) setConfirmingDeactivation(false); }}><section className="editorDialog deleteDocumentDialog"><div className="dialogHead"><div><p className="eyebrow">IN PERSONALLAB DEAKTIVIEREN</p><h2>Dokument ausblenden?</h2></div><button type="button" disabled={deactivating} onClick={() => setConfirmingDeactivation(false)} aria-label="Schließen"><Icon name="close"/></button></div><p className="dialogLead">Das Dokument verschwindet aus PersonalLab, bleibt aber vollständig in Paperless erhalten. Unter Einstellungen kannst du es jederzeit wieder einblenden.</p><div className="deleteDocumentSummary"><Icon name="file" size={20}/><span><strong>{title}</strong><small>Paperless #{document.id} · {document.date || "ohne Datum"}</small></span></div>{deactivationError && <p className="errorText">{deactivationError}</p>}<div className="dialogActions"><span/><span/><button type="button" className="quietButton" disabled={deactivating} onClick={() => setConfirmingDeactivation(false)}>Abbrechen</button><button type="button" className="dangerButton" disabled={deactivating} onClick={confirmDeactivation}><Icon name="trash" size={16}/>{deactivating ? "Wird deaktiviert …" : "Nur in PersonalLab deaktivieren"}</button></div></section></div>}
  </>;
}

function SidebarNode({ area, rootId, node, depth, documents, editMode, activeKey, open, drop, rename, addChild, remove }: { area: Area; rootId: string; node: Subarea; depth: number; documents: DocumentItem[]; editMode: boolean; activeKey: string | null; open: (area: Area, rootId: string, uid: string) => void; drop: (ids: number[], destination: DropDestination) => void; rename: (areaId: string, uid: string) => void; addChild: (areaId: string, uid: string) => void; remove: (areaId: string, uid: string) => void }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [over, setOver] = useState(false);
  const uid = nodeUid(area.id, node);
  const childNodes = node.children ?? [];
  const count = documentsForTreeNode(area.id, rootId, node, documents).length;
  const destination: DropDestination = { areaId: area.id, rootId, tileId: uid, label: `${area.name} → ${node.name}` };
  const receive = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setOver(false);
    try { const ids = JSON.parse(event.dataTransfer.getData("application/x-personallab-documents")); if (Array.isArray(ids) && ids.length) drop(ids.map(Number), destination); } catch { /* Fremde Drag-Daten ignorieren. */ }
  };
  return <div className="treeNode" style={{ "--tree-depth": depth } as CSSProperties}>
    <div className={`treeRow ${activeKey === uid ? "active" : ""} ${over ? "dropOver" : ""}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(true); }} onDragLeave={() => setOver(false)} onDrop={receive}>
      {childNodes.length ? <button className={`treeToggle ${expanded ? "expanded" : ""}`} onClick={() => setExpanded(value => !value)} aria-label={expanded ? "Einklappen" : "Aufklappen"}><Icon name="next" size={13}/></button> : <span className="treeSpacer"/>}
      <button className="treeLabel" onClick={() => open(area, rootId, uid)}><span>{node.name}</span><b>{count}</b></button>
      {editMode && <span className="treeActions"><button onClick={() => rename(area.id, uid)} title="Umbenennen"><Icon name="edit" size={13}/></button><button onClick={() => addChild(area.id, uid)} title="Unterpunkt anlegen"><Icon name="plus" size={13}/></button><button onClick={() => remove(area.id, uid)} title="Löschen"><Icon name="trash" size={13}/></button></span>}
    </div>
    {expanded && childNodes.length > 0 && <div>{childNodes.map(child => <SidebarNode key={nodeUid(area.id, child)} area={area} rootId={rootId} node={child} depth={depth + 1} documents={documents} editMode={editMode} activeKey={activeKey} open={open} drop={drop} rename={rename} addChild={addChild} remove={remove}/>)}</div>}
  </div>;
}

function NavigationSidebar({ areas, documents, editMode, activeAreaId, activeNodeKey, toggleEdit, openArea, editArea, addArea, drop, renameNode, addChild, removeNode }: { areas: Area[]; documents: DocumentItem[]; editMode: boolean; activeAreaId: string | null; activeNodeKey: string | null; toggleEdit: () => void; openArea: (area: Area, subareaId?: string) => void; editArea: (area: Area) => void; addArea: () => void; drop: (ids: number[], destination: DropDestination) => void; renameNode: (areaId: string, uid: string) => void; addChild: (areaId: string, uid: string) => void; removeNode: (areaId: string, uid: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedAreas, setExpandedAreas] = useState<string[]>(["contracts", "review"]);
  return <aside className={`navigationSidebar ${collapsed ? "collapsed" : ""}`}>
    <div className="sidebarHead"><div><p className="eyebrow">ABLAGE</p><strong>Meine Liste</strong></div><button onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? "Liste öffnen" : "Liste schließen"}><Icon name={collapsed ? "next" : "back"} size={16}/></button></div>
    {!collapsed && <><button className={`sidebarEdit ${editMode ? "active" : ""}`} onClick={toggleEdit}><Icon name={editMode ? "check" : "edit"} size={15}/>{editMode ? "Bearbeiten beenden" : "Liste bearbeiten"}</button><div className="treeHelp"><Icon name="move" size={15}/><span>Dokumente direkt auf ein Ziel ziehen.</span></div><nav className="areaTree">{areas.map(area => <details key={area.id} open={expandedAreas.includes(area.id)} onToggle={event => { const opened = event.currentTarget.open; setExpandedAreas(current => opened ? [...new Set([...current, area.id])] : current.filter(id => id !== area.id)); }}><summary><button className={`areaTreeOpen ${activeAreaId === area.id && !activeNodeKey ? "active" : ""}`} onClick={event => { event.preventDefault(); setExpandedAreas(current => [...new Set([...current, area.id])]); openArea(area); }}><span className={`treeAreaIcon tone-${area.tone}`}><Icon name={area.icon} size={15}/></span><span>{area.name}</span><b>{area.count}</b></button>{editMode && <button className="treeAreaEdit" onClick={event => { event.preventDefault(); editArea(area); }} title="Bereich bearbeiten"><Icon name="edit" size={13}/></button>}</summary><div className="treeChildren">{area.subareas.map(node => <SidebarNode key={nodeUid(area.id, node)} area={area} rootId={node.id} node={node} depth={0} documents={documents} editMode={editMode} activeKey={activeAreaId === area.id ? activeNodeKey : null} open={(target, _rootId, uid) => openArea(target, uid)} drop={drop} rename={renameNode} addChild={addChild} remove={removeNode}/>)}</div></details>)}</nav>{editMode && <button className="sidebarAdd" onClick={addArea}><Icon name="plus" size={15}/>Neuen Bereich anlegen</button>}</>}
  </aside>;
}

function Overview({ documents, openDocuments, paperlessUrl, query, setQuery, openDocument, editMode, selected, setSelected, assign, dragDocument, sortDirection, setSortDirection }: { documents: DocumentItem[]; openDocuments: (scope: DocumentScope) => void; paperlessUrl: string; query: string; setQuery: (value: string) => void; openDocument: (doc: DocumentItem) => void; editMode: boolean; selected: number[]; setSelected: (ids: number[]) => void; assign: () => void; dragDocument: (event: DragEvent<HTMLButtonElement>, doc: DocumentItem) => void; sortDirection: DocumentSortDirection; setSortDirection: (direction: DocumentSortDirection) => void }) {
  const [syncing, setSyncing] = useState(false);
  const recent = documents.filter(doc => documentSearchText(doc).includes(query.toLowerCase())).slice(0, 8);
  const unassigned = documents.filter(doc => !doc.area || !doc.subarea).length;
  const newDocuments = documents.filter(doc => doc.isNew).length;
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
    {editMode && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>Bearbeitungsmodus aktiv</strong><p>Die Ablagestruktur wird links bearbeitet. Dokumente lassen sich unten gesammelt auswählen und neu zuordnen.</p></div></div>}
    <SearchBox query={query} setQuery={setQuery}/>
    <section className="intro compactOverviewIntro"><div><p className="eyebrow">DOKUMENTARBEITSPLATZ</p><h1>Links auswählen, rechts lesen.</h1><p>Die Ablageliste ist jetzt die Navigation. Ein Dokument öffnet sich direkt hier als PDF.</p></div><div className="introActions"><button className="quietButton" disabled={!paperlessUrl} onClick={() => paperlessUrl && window.open(`${paperlessUrl}/documents`, "_blank", "noopener,noreferrer")}><Icon name="open" size={17}/>Paperless öffnen</button><button className="primaryButton" disabled={syncing} onClick={syncNow}><Icon name="sync" size={17}/>{syncing ? "Abgleich läuft …" : "Jetzt abgleichen"}</button></div></section>
    <div className="overviewQuickbar"><button onClick={() => openDocuments("all")}><Icon name="file" size={17}/><strong>{documents.length.toLocaleString("de-DE")}</strong><span>Alle Dokumente</span></button><button onClick={() => openDocuments("unassigned")}><Icon name="inbox" size={17}/><strong>{unassigned}</strong><span>Nicht zugeordnet</span></button><button onClick={() => openDocuments("new")}><Icon name="clock" size={17}/><strong>{newDocuments}</strong><span>Neu seit Abgleich</span></button></div>
    <section className="workspaceWelcome"><span><Icon name="file" size={28}/></span><div><p className="eyebrow">SO FUNKTIONIERT ES</p><h2>Ablagepunkt in „Meine Liste“ wählen</h2><p>Rechts erscheinen sofort die zugehörigen Dokumente. Ein Klick auf ein Dokument öffnet die PDF-Vorschau an dieser Stelle.</p></div></section>
    <DocumentList title="Zuletzt hinzugefügt" subtitle="Dokument anklicken, um es als PDF zu öffnen" items={recent} onOpen={openDocument} editMode={editMode} selected={selected} setSelected={setSelected} assign={assign} dragDocument={dragDocument} sortDirection={sortDirection} setSortDirection={setSortDirection}/>
  </>;
}

type AreaViewProps = { area: Area; documents: DocumentItem[]; config: AppConfig; pageLayouts: PageLayouts; setPageLayouts: (layouts: PageLayouts) => void; financeAccountAssignments: FinanceAccountAssignments; updateFinanceAccountAssignment: (key: string, ids: string[] | undefined) => void; financeDataSelections: FinanceDataSelections; updateFinanceDataSelection: (key: string, ids: string[] | undefined) => void; energyProviderAssignments: EnergyProviderAssignments; updateEnergyProviderAssignment: (key: string, providers: string[] | undefined) => void; energyMetricSelections: EnergyMetricSelections; updateEnergyMetricSelection: (key: string, ids: string[] | undefined) => void; selectedSubarea: string | null; chooseSubarea: (id: string | null) => void; goBack: () => void; query: string; setQuery: (value: string) => void; openDocument: (doc: DocumentItem) => void; editMode: boolean; editSubarea: (id: string) => void; addSubarea: () => void; addGroup: (subareaId: string | null, name: string) => void; renameParty: (oldName: string, newName: string, fallback: string) => void; selected: number[]; setSelected: (ids: number[]) => void; assign: () => void; dragDocument: (event: DragEvent<HTMLButtonElement>, doc: DocumentItem) => void; sortDirection: DocumentSortDirection; setSortDirection: (direction: DocumentSortDirection) => void };

const energyDetailLevels = [
  { id: "contracts", name: "Verträge", hint: "Verträge und Tarifunterlagen", pattern: /vertrag|tarif|liefer/ },
  { id: "advance", name: "Abschläge", hint: "Abschlagspläne und Zahlungen", pattern: /abschlag|rate|zahlung/ },
  { id: "bills", name: "Abrechnungen", hint: "Jahres- und Verbrauchsabrechnungen", pattern: /abrechnung|rechnung/ },
  { id: "history", name: "Historie", hint: "Frühere Verträge und Auswertungen", pattern: /histor|vorjahr|altvertrag/ },
  { id: "meter", name: "Zählerstände", hint: "Ablesungen und Zählerstände", pattern: /zähler|zaehler|ablesung|meter/ },
];

type EnergyDetailId = "overview" | "contracts" | "advance" | "history" | "meter";
const energyDetailId = (node?: Subarea): EnergyDetailId | null => {
  if (!node) return null;
  if (["overview", "contracts", "advance", "history", "meter"].includes(node.id)) return node.id as EnergyDetailId;
  const label = `${node.name} ${node.hint}`.toLocaleLowerCase("de-DE");
  if (/übersicht|uebersicht/.test(label)) return "overview";
  if (/vertrag|tarif/.test(label)) return "contracts";
  if (/abschlag|zahlung/.test(label)) return "advance";
  if (/histor|verlauf/.test(label)) return "history";
  if (/zähler|zaehler|ablesung|messwert/.test(label)) return "meter";
  return null;
};

function SidebarAreaView({ area, documents, config, financeAccountAssignments, updateFinanceAccountAssignment, financeDataSelections, updateFinanceDataSelection, energyProviderAssignments, updateEnergyProviderAssignment, energyMetricSelections, updateEnergyMetricSelection, selectedSubarea, chooseSubarea, goBack, query, setQuery, openDocument, editMode, selected, setSelected, assign, dragDocument, sortDirection, setSortDirection }: AreaViewProps) {
  const [yearState, setYearState] = useState<{ key: string; value: string } | null>(null);
  const active = findTreeSelection(area, selectedSubarea);
  const activeKey = active ? nodeUid(area.id, active.node) : area.id;
  const year = yearState?.key === activeKey ? yearState.value : "";
  const scopedDocuments = active ? documentsForTreeNode(area.id, active.root.id, active.node, documents) : documents.filter(doc => doc.area === area.id);
  const visibleDocuments = scopedDocuments.filter(doc => !year || documentYear(doc) === year).filter(doc => documentSearchText(doc).includes(query.toLowerCase()));
  const financeProviderNode = area.id === "finance" && active?.root.id === "accounts" && active.path.length > 1 ? active.path[1] : null;
  const financeSelectionKey = financeProviderNode ? nodeUid(area.id, financeProviderNode) : null;
  const financeDataKey = area.id === "finance" && active?.root.id === "accounts" ? financeSelectionKey ?? nodeUid(area.id, active.root) : null;
  const financeAccountIds = financeDataKey && Object.prototype.hasOwnProperty.call(financeAccountAssignments, financeDataKey) ? financeAccountAssignments[financeDataKey] : undefined;
  const financeDataIds = financeDataKey && Object.prototype.hasOwnProperty.call(financeDataSelections, financeDataKey) ? financeDataSelections[financeDataKey] : undefined;
  const finance = area.id === "finance" && active?.root.id === "accounts" ? <FinanceIntegration key={financeDataKey ?? "all-finance-accounts"} configured={config.financeLab} selectionKey={financeSelectionKey} selectionLabel={financeProviderNode?.name ?? null} accountIds={financeAccountIds} dataSelectionKey={financeDataKey} dataIds={financeDataIds} editMode={editMode} onAccountsChange={ids => financeDataKey && updateFinanceAccountAssignment(financeDataKey, ids)} onDataChange={ids => financeDataKey && updateFinanceDataSelection(financeDataKey, ids)}/> : null;
  const energyProviderNode = area.id === "energy" && active?.path.length && active.path.length > 1 ? active.path[1] : null;
  const energySelectionKey = energyProviderNode ? nodeUid(area.id, energyProviderNode) : null;
  const selectedEnergyProviders = energySelectionKey && Object.prototype.hasOwnProperty.call(energyProviderAssignments, energySelectionKey) ? energyProviderAssignments[energySelectionKey] : undefined;
  const selectedEnergyDetail = area.id === "energy" && active?.path.length && active.path.length > 2 ? energyDetailId(active.path.at(-1)) : null;
  const energyMetricKey = area.id === "energy" && active ? nodeUid(area.id, active.root) : null;
  const selectedEnergyMetrics = energyMetricKey && Object.prototype.hasOwnProperty.call(energyMetricSelections, energyMetricKey) ? energyMetricSelections[energyMetricKey] : undefined;
  const energy = area.id === "energy" ? <EnergyIntegration key={`${active?.root.id ?? "all-energy"}-${energySelectionKey ?? "all-providers"}`} segmentId={active?.root.id ?? null} configured={config.energyLab} selectionKey={energySelectionKey} selectionLabel={energyProviderNode?.name ?? null} providerNames={selectedEnergyProviders} detailId={selectedEnergyDetail} editMode={editMode} metricSelectionKey={energyMetricKey} metricIds={selectedEnergyMetrics} allowMetricEditing={Boolean(active && active.node.id === active.root.id)} onMetricsChange={ids => energyMetricKey && updateEnergyMetricSelection(energyMetricKey, ids)} onProvidersChange={providers => energySelectionKey && updateEnergyProviderAssignment(energySelectionKey, providers)}/> : null;
  const title = active?.node.name ?? `Alle Dokumente in ${area.name}`;
  return <>
    {editMode && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>Seitenleiste bearbeiten</strong><p>Namen, Reihenfolge und Unterpunkte werden links verwaltet. Rechts bleibt Platz für Dokumente und Vorschauen.</p></div></div>}
    <div className="breadcrumbs"><button onClick={goBack}><Icon name="back" size={16}/>Übersicht</button><span>/</span><button onClick={() => { setYearState(null); chooseSubarea(null); }}>{area.name}</button>{active?.path.map((node, index) => <span key={nodeUid(area.id, node)} className="breadcrumbPart"><span>/</span>{index === active.path.length - 1 ? <strong>{node.name}</strong> : <button onClick={() => { setYearState(null); chooseSubarea(nodeUid(area.id, node)); }}>{node.name}</button>}</span>)}</div>
    <SearchBox query={query} setQuery={setQuery}/>
    <section className="areaIntro compactAreaIntro"><span className={`largeAreaIcon tone-${area.tone}`}><Icon name={area.icon} size={29}/></span><div><p className="eyebrow">{active ? "ABLAGEPUNKT" : "AKTENBEREICH"}</p><h1>{active?.node.name ?? area.name}</h1><p>{active ? active.node.hint || "Dokumente dieses Ablagepunkts" : "Wähle links einen Ablagepunkt oder öffne unten ein Dokument."}</p></div><span className="areaTotal"><strong>{visibleDocuments.length.toLocaleString("de-DE")}</strong><small>Dokumente</small></span></section>
    <div className="documentToolbar"><div><strong>{title}</strong><span>{query ? `${visibleDocuments.length} Treffer` : `${scopedDocuments.length} Dokumente`}</span></div><CompactYearFilter documents={scopedDocuments} value={year} change={value => setYearState({ key: activeKey, value })}/></div>
    {finance}
    {energy}
    <DocumentList title={year ? `${title} · ${year}` : title} subtitle={year ? `${visibleDocuments.length} Dokumente in diesem Jahr` : "Dokument anklicken, um die PDF-Vorschau zu öffnen"} items={visibleDocuments} onOpen={openDocument} editMode={editMode} selected={selected} setSelected={setSelected} assign={assign} dragDocument={dragDocument} sortDirection={sortDirection} setSortDirection={setSortDirection}/>
  </>;
}

function WorkAreaView({ area, documents, selectedSubarea, chooseSubarea, goBack, query, setQuery, openDocument, editMode, selected, setSelected, assign, dragDocument }: AreaViewProps) {
  const [yearState, setYearState] = useState<{ key: string; value: string } | null>(null);
  const active = findTreeSelection(area, selectedSubarea);
  const activeKey = active ? nodeUid(area.id, active.node) : "";
  const year = yearState?.key === activeKey ? yearState.value : null;
  const activeDocuments = active ? documentsForTreeNode(area.id, active.root.id, active.node, documents) : documents.filter(doc => doc.area === area.id);
  const visibleDocuments = activeDocuments.filter(doc => !year || documentYear(doc) === year).filter(doc => documentSearchText(doc).includes(query.toLowerCase()));
  const choices = active ? active.node.children ?? [] : area.subareas;
  const chooseNode = (node: Subarea) => { setYearState(null); chooseSubarea(nodeUid(area.id, node)); };
  const goUp = () => {
    setYearState(null);
    if (!active || active.path.length <= 1) chooseSubarea(null);
    else chooseSubarea(nodeUid(area.id, active.path[active.path.length - 2]));
  };
  const navigationBlock = choices.length ? <section><div className="sectionTitle"><div><p className="eyebrow">ABLAGEPUNKTE</p><h2>Was möchtest du öffnen?</h2></div>{active && <button className="quietButton" onClick={goUp}><Icon name="back" size={16}/>Eine Ebene zurück</button>}</div><div className="subareaGrid">{choices.map(node => {
    const rootId = active?.root.id ?? node.id;
    const count = documentsForTreeNode(area.id, rootId, node, documents).length;
    return <button key={nodeUid(area.id, node)} className="subareaTile" onClick={() => chooseNode(node)}><span className="subareaSymbol"><Icon name="file" size={21}/></span><strong>{node.name}</strong><small>{node.children?.length ? "Enthält weitere Ablagepunkte" : node.hint || "Dokumentart"}</small><b>{count}</b><Icon name="next" size={17}/></button>;
  })}</div></section> : year ? <section><div className="sectionTitle"><div><p className="eyebrow">JAHR {year}</p><h2>{active?.node.name}</h2></div><button className="quietButton" onClick={() => setYearState(null)}><Icon name="back" size={16}/>Zur Jahresauswahl</button></div></section> : <YearTiles documents={activeDocuments} choose={value => setYearState({ key: activeKey, value })} back={goUp}/>;
  const documentsBlock = active && !choices.length && year ? <DocumentList title={`${active.node.name} · ${year}`} subtitle={`${visibleDocuments.length} Dokumente`} items={visibleDocuments} onOpen={openDocument} editMode={false} selected={selected} setSelected={setSelected} assign={assign} dragDocument={dragDocument}/> : null;
  const shownCount = year ? visibleDocuments.length : activeDocuments.length;
  return <>
    {editMode && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>Ablagestruktur bearbeiten</strong><p>Die Kacheln entsprechen deiner linken Liste. Namen, Reihenfolge und Unterpunkte bearbeitest du dort über „Liste bearbeiten“.</p></div></div>}
    <div className="breadcrumbs"><button onClick={goBack}><Icon name="back" size={16}/>Übersicht</button><span>/</span><button onClick={() => { setYearState(null); chooseSubarea(null); }}>{area.name}</button>{active?.path.map((node, index) => <span key={nodeUid(area.id, node)} className="breadcrumbPart"><span>/</span>{index === active.path.length - 1 && !year ? <strong>{node.name}</strong> : <button onClick={() => { setYearState(null); chooseSubarea(nodeUid(area.id, node)); }}>{node.name}</button>}</span>)}{year && <><span>/</span><strong>{year}</strong></>}</div>
    <SearchBox query={query} setQuery={setQuery}/>
    <section className="areaIntro"><span className={`largeAreaIcon tone-${area.tone}`}><Icon name={area.icon} size={29}/></span><div><p className="eyebrow">{year ? "JAHR" : active ? "ABLAGEPUNKT" : "AKTENBEREICH"}</p><h1>{year && active ? `${active.node.name} · ${year}` : active?.node.name ?? area.name}</h1><p>{year ? "Alle Dokumente dieses Jahres." : choices.length ? "Die Kacheln entsprechen der Struktur in deiner linken Liste." : "Wähle das gewünschte Jahr."}</p></div><span className="areaTotal"><strong>{shownCount.toLocaleString("de-DE")}</strong><small>Dokumente</small></span></section>
    {navigationBlock}
    {documentsBlock}
  </>;
}

function PartyAreaView(props: AreaViewProps) {
  const { area, documents, config, pageLayouts, setPageLayouts, selectedSubarea, chooseSubarea, goBack, query, setQuery, openDocument, editMode, addGroup, renameParty, selected, setSelected, assign, dragDocument } = props;
  const [party, setParty] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const [energyProviderState, setEnergyProviderState] = useState<{ key: string; items: string[] }>({ key: "", items: [] });
  const areaDocuments = documents.filter(doc => doc.area === area.id);
  const segmentDocuments = areaDocuments.filter(doc => !selectedSubarea || doc.subarea === selectedSubarea);
  const partyFallback = area.id === "work" ? "Ohne Arbeitgeber" : "Ohne Anbieter";
  const energyProviderKey = area.id === "energy" && selectedSubarea && config.energyLab ? selectedSubarea : "";
  useEffect(() => {
    if (!energyProviderKey) return;
    let active = true;
    fetch("/api/integrations/energy", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(payload => {
      if (!active) return;
      const segment = payload?.segments?.find((item: { id?: string }) => item.id === energyProviderKey);
      setEnergyProviderState({ key: energyProviderKey, items: [...(new Set<string>((segment?.contracts ?? []).map((item: { provider?: string }) => item.provider).filter(Boolean)))] });
    }).catch(() => { if (active) setEnergyProviderState({ key: energyProviderKey, items: [] }); });
    return () => { active = false; };
  }, [energyProviderKey]);
  const energyProviders = energyProviderState.key === energyProviderKey ? energyProviderState.items : [];
  const parties = [...new Set([...segmentDocuments.map(doc => groupName(doc, partyFallback)), ...(area.groups ?? []), ...energyProviders])].sort((a, b) => a.localeCompare(b, "de"));
  const partyDocuments = party ? segmentDocuments.filter(doc => groupName(doc, partyFallback) === party) : segmentDocuments;
  const activeSubarea = area.subareas.find(item => item.id === selectedSubarea);
  const detailLevel = energyDetailLevels.find(item => item.id === detail);
  const visibleDocuments = partyDocuments.filter(doc => {
    if (area.id === "work") return (!selectedSubarea || doc.subarea === selectedSubarea) && (!year || documentYear(doc) === year);
    if (area.id === "energy" && detailLevel) return detailLevel.pattern.test(`${doc.title} ${doc.type} ${doc.correspondent}`.toLowerCase());
    return true;
  }).filter(doc => documentSearchText(doc).includes(query.toLowerCase()));
  const resetParty = () => { setParty(null); setDetail(null); setYear(null); };

  if (area.id === "energy" && !selectedSubarea) return <LegacyAreaView {...props}/>;

  const showParties = !party;
  const selectionBlock = <section><div className="sectionTitle"><div><p className="eyebrow">{showParties ? (area.id === "work" ? "DOKUMENTARTEN" : "ANBIETER") : "UNTERKATEGORIEN"}</p><h2>{showParties ? (parties.length ? "Was möchtest du öffnen?" : "Noch keine Zuordnung vorhanden") : "Was möchtest du öffnen?"}</h2></div>{party && <button className="quietButton" onClick={resetParty}>Zurück zur Auswahl</button>}</div>
    <div className="subareaGrid">{showParties ? parties.map(name => { const count = segmentDocuments.filter(doc => groupName(doc, partyFallback) === name).length; const editable = editMode && area.id === "work"; return <button key={name} className={`subareaTile ${editable ? "editable" : ""}`} onClick={() => { if (editable) { const nextName = window.prompt("Name der Dokumentart", name)?.trim(); if (nextName && nextName !== name) renameParty(name, nextName, partyFallback); return; } setParty(name); setDetail(null); setYear(null); }}>{editable && <span className="editFlag"><Icon name="edit" size={13}/>Ändern</span>}<span className="subareaSymbol"><Icon name={area.id === "work" ? "file" : "energy"} size={21}/></span><strong>{name}</strong><small>{area.id === "work" ? "Dokumentart" : "Energieanbieter"}</small><b>{count}</b><Icon name={editable ? "edit" : "next"} size={17}/></button>; }) : energyDetailLevels.map(level => { const count = partyDocuments.filter(doc => level.pattern.test(`${doc.title} ${doc.type}`.toLowerCase())).length; const active = detail === level.id; return <button key={level.id} className={`subareaTile ${active ? "selected" : ""}`} onClick={() => setDetail(level.id)}><span className="subareaSymbol"><Icon name="file" size={21}/></span><strong>{level.name}</strong><small>{level.hint}</small><b>{count}</b><Icon name="next" size={17}/></button>; })}{showParties && <button className="addTile" onClick={() => { const name = window.prompt(area.id === "work" ? "Neue Dokumentart" : "Neuer Anbieter")?.trim(); if (name) addGroup(null, name); }}><span><Icon name="plus" size={24}/></span><strong>{area.id === "work" ? "Dokumentart anlegen" : "Anbieter anlegen"}</strong><small>Manuelle Untergruppe erstellen</small></button>}</div>
  </section>;
  const navigationBlock = area.id === "work" && party ? (year ? <section><div className="sectionTitle"><div><p className="eyebrow">JAHR {year}</p><h2>{party}</h2></div><button className="quietButton" onClick={() => setYear(null)}><Icon name="back" size={16}/>Zur Jahresauswahl</button></div></section> : <YearTiles documents={partyDocuments} choose={setYear} back={resetParty}/>) : selectionBlock;
  const integrationBlock = area.id === "energy" ? <EnergyIntegration key={`${selectedSubarea ?? "energy"}-${party ?? "all"}`} segmentId={selectedSubarea} provider={party} configured={config.energyLab}/> : null;
  const documentsBlock = area.id === "work" ? (party && year ? <DocumentList title={`${party} · ${year}`} subtitle={`${visibleDocuments.length} Dokumente`} items={visibleDocuments} onOpen={openDocument} editMode={false} selected={selected} setSelected={setSelected} assign={assign} dragDocument={dragDocument}/> : null) : (!showParties ? <DocumentList title={detailLevel?.name ?? activeSubarea?.name ?? `Dokumente von ${party}`} subtitle={`${visibleDocuments.length} Dokumente`} items={visibleDocuments} onOpen={openDocument} editMode={false} selected={selected} setSelected={setSelected} assign={assign} dragDocument={dragDocument}/> : null);
  return <>
    {editMode && area.id === "work" && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>Dokumentarten bearbeiten</strong><p>Eine Dokumentart anklicken, um ihren Namen zu ändern. Die Jahre darunter werden automatisch aus den Dokumenten erzeugt.</p></div></div>}
    <div className="breadcrumbs"><button onClick={goBack}><Icon name="back" size={16}/>Übersicht</button><span>/</span><button onClick={() => { setParty(null); setDetail(null); setYear(null); chooseSubarea(null); }}>{area.name}</button>{area.id === "work" ? <>{activeSubarea && <><span>/</span><button onClick={() => { setParty(null); setYear(null); }}>{activeSubarea.name}</button></>}{party && <><span>/</span><button onClick={() => setYear(null)}>{party}</button></>}{year && <><span>/</span><strong>{year}</strong></>}</> : <>{activeSubarea && <><span>/</span><button onClick={() => { setParty(null); setDetail(null); }}>{activeSubarea.name}</button></>}{party && <><span>/</span><button onClick={() => setDetail(null)}>{party}</button></>}{detailLevel && <><span>/</span><strong>{detailLevel.name}</strong></>}</>}</div>
    <SearchBox query={query} setQuery={setQuery}/>
    <section className="areaIntro"><span className={`largeAreaIcon tone-${area.tone}`}><Icon name={area.icon} size={29}/></span><div><p className="eyebrow">AKTENBEREICH</p><h1>{year ? `${party} · ${year}` : party ?? activeSubarea?.name ?? area.name}</h1><p>{area.id === "work" ? (party ? year ? "Alle Dokumente dieses Jahres." : "Wähle das gewünschte Jahr." : "Wähle die gewünschte Dokumentart.") : showParties ? "Wähle jetzt den Anbieter." : "Wähle anschließend die gewünschte Dokumentart."}</p></div><span className="areaTotal"><strong>{visibleDocuments.length.toLocaleString("de-DE")}</strong><small>Dokumente</small></span></section>
    {area.id === "energy" && editMode && <PageLayoutEditor source="energy" layout={pageLayouts.energy} change={energy => setPageLayouts({ ...pageLayouts, energy })}/>}
    {area.id === "energy" ? <OrderedPageBlocks layout={pageLayouts.energy} blocks={{ integration: integrationBlock, navigation: navigationBlock, documents: documentsBlock }}/> : <>{navigationBlock}{documentsBlock}</>}
  </>;
}

function GroupedAreaView(props: AreaViewProps) {
  const { area, documents, config, pageLayouts, setPageLayouts, selectedSubarea, chooseSubarea, goBack, query, setQuery, openDocument, editMode, addGroup, selected, setSelected, assign, dragDocument } = props;
  const [group, setGroup] = useState<string | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const active = area.subareas.find(item => item.id === selectedSubarea);
  const scoped = documents.filter(doc => doc.area === area.id && doc.subarea === selectedSubarea);
  const fallback = "Ohne Untergruppe";
  const groups = [...new Set([...(active?.groups ?? []), ...scoped.map(doc => groupName(doc, fallback))])].filter(Boolean).sort((a, b) => a.localeCompare(b, "de"));
  const groupDocuments = scoped.filter(doc => !group || groupName(doc, fallback) === group);
  const items = groupDocuments.filter(doc => !year || documentYear(doc) === year).filter(doc => documentSearchText(doc).includes(query.toLowerCase()));
  if (!selectedSubarea || !active) return <LegacyAreaView {...props}/>;
  const finance = area.id === "finance" && selectedSubarea === "accounts" ? <FinanceIntegration configured={config.financeLab}/> : null;
  const navigationBlock = !group ? <section><div className="sectionTitle"><div><p className="eyebrow">UNTERGRUPPEN</p><h2>Was möchtest du öffnen?</h2></div><button className="quietButton" onClick={() => chooseSubarea(null)}><Icon name="back" size={16}/>Eine Ebene zurück</button></div><div className="subareaGrid">{groups.map(name => { const count = scoped.filter(doc => groupName(doc, fallback) === name).length; return <button key={name} className="subareaTile" onClick={() => { setGroup(name); setYear(null); }}><span className="subareaSymbol"><Icon name="house" size={21}/></span><strong>{name}</strong><small>Korrespondent oder eigene Gruppe</small><b>{count}</b><Icon name="next" size={17}/></button>; })}<button className="addTile" onClick={() => { const name = window.prompt("Name der neuen Untergruppe, z. B. Sparkasse oder ING")?.trim(); if (name) addGroup(active.id, name); }}><span><Icon name="plus" size={24}/></span><strong>Untergruppe anlegen</strong><small>Eigene Ebene hinzufügen</small></button></div></section> : year ? <section><div className="sectionTitle"><div><p className="eyebrow">JAHR {year}</p><h2>{group}</h2></div><button className="quietButton" onClick={() => setYear(null)}><Icon name="back" size={16}/>Zur Jahresauswahl</button></div></section> : <YearTiles documents={groupDocuments} choose={setYear} back={() => setGroup(null)}/>;
  const documentsBlock = group && year ? <DocumentList title={`${group} · ${year}`} subtitle={`${items.length} Treffer`} items={items} onOpen={openDocument} editMode={false} selected={selected} setSelected={setSelected} assign={assign} dragDocument={dragDocument}/> : null;
  return <>
    {editMode && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>Seitenbereiche bearbeiten</strong><p>Komplette Bereiche verschieben oder ausblenden. Die Inhalte innerhalb des FinanzLab-Imports bleiben zusammen.</p></div></div>}
    <div className="breadcrumbs"><button onClick={goBack}><Icon name="back" size={16}/>Übersicht</button><span>/</span><button onClick={() => { setGroup(null); setYear(null); chooseSubarea(null); }}>{area.name}</button><span>/</span><button onClick={() => { setGroup(null); setYear(null); }}>{active.name}</button>{group && <><span>/</span><button onClick={() => setYear(null)}>{group}</button></>}{year && <><span>/</span><strong>{year}</strong></>}</div>
    <SearchBox query={query} setQuery={setQuery}/>
    <section className="areaIntro"><span className={`largeAreaIcon tone-${area.tone}`}><Icon name={area.icon} size={29}/></span><div><p className="eyebrow">{year ? "JAHR" : group ? "UNTERGRUPPE" : "AKTENBEREICH"}</p><h1>{year ? `${group} · ${year}` : group ?? active.name}</h1><p>{group ? year ? `${items.length} Dokumente in diesem Jahr` : "Wähle das gewünschte Jahr." : "Wähle eine Untergruppe oder lege eine neue an."}</p></div><span className="areaTotal"><strong>{(year ? items.length : group ? groupDocuments.length : scoped.length).toLocaleString("de-DE")}</strong><small>Dokumente</small></span></section>
    {editMode && <PageLayoutEditor source="finance" layout={pageLayouts.finance} change={financePageLayout => setPageLayouts({ ...pageLayouts, finance: financePageLayout })}/>}
    <OrderedPageBlocks layout={pageLayouts.finance} blocks={{ integration: finance, navigation: navigationBlock, documents: documentsBlock }}/>
  </>;
}

function AreaView(props: AreaViewProps) {
  return <SidebarAreaView {...props}/>;
}

function LegacyAreaView({ area, documents, config, pageLayouts, setPageLayouts, selectedSubarea, chooseSubarea, goBack, query, setQuery, openDocument, editMode, editSubarea, addSubarea, selected, setSelected, assign, dragDocument }: AreaViewProps) {
  const [year, setYear] = useState<string | null>(null);
  const active = area.subareas.find(item => item.id === selectedSubarea);
  const scopedItems = documents.filter(doc => doc.area === area.id && (!selectedSubarea || doc.subarea === selectedSubarea));
  const items = scopedItems.filter(doc => !year || documentYear(doc) === year).filter(doc => documentSearchText(doc).includes(query.toLowerCase()));
  const navigationBlock = <section><div className="sectionTitle"><div><p className="eyebrow">UNTERBEREICHE</p><h2>{editMode ? "Kacheln bearbeiten" : "Was möchtest du öffnen?"}</h2></div>{active && !editMode && <button className="quietButton" onClick={() => { setYear(null); chooseSubarea(null); }}>Auswahl aufheben</button>}</div><div className="subareaGrid">{!editMode && <button className={`subareaTile ${selectedSubarea === null ? "selected" : ""}`} onClick={() => { setYear(null); chooseSubarea(null); }}><span className="subareaSymbol"><Icon name="grid" size={21}/></span><strong>Alles in {area.name}</strong><small>Gesamten Bereich anzeigen</small><b>{area.count}</b></button>}{area.subareas.map(subarea => <button key={subarea.id} className={`subareaTile ${selectedSubarea === subarea.id ? "selected" : ""} ${editMode ? "editable" : ""}`} onClick={() => { setYear(null); if (editMode) editSubarea(subarea.id); else chooseSubarea(subarea.id); }}>{editMode && <span className="editFlag"><Icon name="edit" size={13}/>Ändern</span>}<span className="subareaSymbol"><Icon name={area.id === "energy" ? "energy" : "file"} size={21}/></span><strong>{subarea.name}</strong><small>{subarea.hint}</small><b>{subarea.count}</b><Icon name={editMode ? "move" : "next"} size={17}/></button>)}{editMode && <button className="addTile" onClick={addSubarea}><span><Icon name="plus" size={24}/></span><strong>Neue Kachel</strong><small>Unterbereich anlegen</small></button>}</div></section>;
  const integrationBlock = area.id === "energy" ? <EnergyIntegration key={selectedSubarea ?? "all-energy"} segmentId={selectedSubarea} configured={config.energyLab}/> : area.id === "finance" && selectedSubarea === "accounts" ? <FinanceIntegration configured={config.financeLab}/> : null;
  const documentsBlock = active && !editMode ? (year ? <><section><div className="sectionTitle"><div><p className="eyebrow">JAHR {year}</p><h2>{active.name}</h2></div><button className="quietButton" onClick={() => setYear(null)}><Icon name="back" size={16}/>Zur Jahresauswahl</button></div></section><DocumentList title={`${active.name} · ${year}`} subtitle={`${items.length} Dokumente`} items={items} onOpen={openDocument} editMode={false} selected={selected} setSelected={setSelected} assign={assign} dragDocument={dragDocument}/></> : <YearTiles documents={scopedItems} choose={setYear}/>) : <DocumentList title={active?.name ?? `Alle Dokumente in ${area.name}`} subtitle={active ? active.hint : `${area.count} zugeordnete Dokumente`} items={items} onOpen={openDocument} editMode={editMode} selected={selected} setSelected={setSelected} assign={assign} dragDocument={dragDocument}/>;
  const isEnergyLayout = area.id === "energy";
  return <>
    {editMode && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>{isEnergyLayout ? "Seitenbereiche und Kacheln bearbeiten" : "Unterbereiche bearbeiten"}</strong><p>{isEnergyLayout ? "Ganze Bereiche unten anordnen oder ausblenden. Unterbereichskacheln können weiterhin einzeln bearbeitet werden." : "Kachel anklicken, um Name, Beschreibung oder Reihenfolge zu ändern."}</p></div></div>}
    <div className="breadcrumbs"><button onClick={goBack}><Icon name="back" size={16}/>Übersicht</button><span>/</span><strong>{area.name}</strong>{active && <><span>/</span><button onClick={() => setYear(null)}>{active.name}</button></>}{year && <><span>/</span><strong>{year}</strong></>}</div>
    <SearchBox query={query} setQuery={setQuery}/>
    <section className="areaIntro"><span className={`largeAreaIcon tone-${area.tone}`}><Icon name={area.icon} size={29}/></span><div><p className="eyebrow">AKTENBEREICH</p><h1>{area.name}</h1><p>{area.description}</p></div><span className="areaTotal"><strong>{area.count.toLocaleString("de-DE")}</strong><small>Dokumente</small></span></section>
    {isEnergyLayout && editMode && <PageLayoutEditor source="energy" layout={pageLayouts.energy} change={energy => setPageLayouts({ ...pageLayouts, energy })}/>}
    {isEnergyLayout ? <OrderedPageBlocks layout={pageLayouts.energy} blocks={{ integration: integrationBlock, navigation: navigationBlock, documents: documentsBlock }}/> : <>{navigationBlock}{integrationBlock}{documentsBlock}</>}
  </>;
}

function DocumentsView({ documents, scope, query, setQuery, openDocument, editMode, selected, setSelected, assign, dragDocument, sortDirection, setSortDirection }: { documents: DocumentItem[]; scope: DocumentScope; query: string; setQuery: (value: string) => void; openDocument: (doc: DocumentItem) => void; editMode: boolean; selected: number[]; setSelected: (ids: number[]) => void; assign: () => void; dragDocument: (event: DragEvent<HTMLButtonElement>, doc: DocumentItem) => void; sortDirection: DocumentSortDirection; setSortDirection: (direction: DocumentSortDirection) => void }) {
  const [filters, setFilters] = useState<string[]>(["Alle"]);
  const filtered = useMemo(() => documents.filter(doc => {
    const text = documentSearchText(doc);
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
      if (filter === "Aktive Verträge") return contractPresentation(doc)?.status === "active";
      if (filter === "Läuft bald aus") return contractPresentation(doc)?.status === "expiring";
      if (filter === "Inaktive Verträge") return contractPresentation(doc)?.status === "inactive";
      return false;
    });
  }), [documents, filters, query, scope]);
  const filterOptions = ["Alle", "Befunde", "Gehaltsabrechnungen", "Verträge", "Aktive Verträge", "Läuft bald aus", "Inaktive Verträge", "Rechnungen", "2026"];
  const toggle = (option: string) => { if (option === "Alle") return setFilters(["Alle"]); const current = filters.filter(x => x !== "Alle"); const next = current.includes(option) ? current.filter(x => x !== option) : [...current, option]; setFilters(next.length ? next : ["Alle"]); };
  const heading = scope === "unassigned" ? "Nicht zugeordnet" : scope === "new" ? "Neue Dokumente" : "Dokumente";
  return <>{editMode && <div className="editNotice"><span><Icon name="edit" size={18}/></span><div><strong>Dokumente neu zuordnen</strong><p>Ein oder mehrere Dokumente auswählen und direkt auf ein Ziel in der linken Liste ziehen.</p></div></div>}<SearchBox query={query} setQuery={setQuery}/><section className="pageIntro"><div><p className="eyebrow">DOKUMENTENABLAGE</p><h1>{heading}</h1><p>Suchen, filtern und per Drag-and-drop ablegen.</p></div></section><section className="filterCard"><p className="eyebrow">SCHNELLAUSWAHL</p><div className="filterPills">{filterOptions.map(option => <button key={option} className={filters.includes(option) ? "active" : ""} onClick={() => toggle(option)}><span>{filters.includes(option) && <Icon name="check" size={14}/>}</span>{option}</button>)}</div></section><DocumentList title="Gefundene Dokumente" subtitle={`${filtered.length} Treffer`} items={filtered} onOpen={openDocument} editMode={editMode} selected={selected} setSelected={setSelected} assign={assign} dragDocument={dragDocument} sortDirection={sortDirection} setSortDirection={setSortDirection}/></>;
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

function Settings({ config, documentCount, disabledDocuments, sensorCount, lastSync, goSensors, restoreDocument }: { config: AppConfig; documentCount: number; disabledDocuments: DocumentItem[]; sensorCount: number; lastSync: string | null; goSensors: () => void; restoreDocument: (document: DocumentItem) => Promise<void> }) {
  const [disabledPicker, setDisabledPicker] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const last = lastSync ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSync)) : "Noch kein Abgleich";
  const restore = async (document: DocumentItem) => {
    setRestoringId(document.id);
    setRestoreError("");
    try {
      await restoreDocument(document);
      if (disabledDocuments.length === 1) setDisabledPicker(false);
    } catch (reason) {
      setRestoreError(reason instanceof Error ? reason.message : "Wiederherstellung fehlgeschlagen");
    } finally {
      setRestoringId(null);
    }
  };
  return <>
    <section className="pageIntro"><div><p className="eyebrow">PERSONALLAB</p><h1>Einstellungen</h1><p>Verbindungen, Synchronisation und Bereiche verwalten.</p></div></section>
    <div className="settingsList">
      <article><span className="settingIcon paperless">P</span><div><h2>Paperless-NGX</h2><p>Dokumente und Metadaten werden ausschließlich gelesen. Deaktivierungen gelten nur für PersonalLab.</p><small className={config.paperless ? "connected" : "disconnected"}><i/>{config.paperless ? `Verbunden · ${documentCount.toLocaleString("de-DE")} Dokumente` : "Nicht konfiguriert"}</small></div>{config.paperlessUrl && <button className="quietButton" onClick={() => window.open(config.paperlessUrl, "_blank", "noopener,noreferrer")}>Öffnen</button>}</article>
      <article><span className="settingIcon"><Icon name="file"/></span><div><h2>Digital-Akte-Analyzer</h2><p>Ollama erzeugt lesbare Titel, Beschreibungen und strukturierte Suchbegriffe.</p><small className={config.analyzer ? "connected" : "disconnected"}><i/>{config.analyzer ? "Verbunden · lokale KI-Metadaten" : "Nicht konfiguriert"}</small></div><span className={config.analyzer ? "statusTag active" : "statusTag"}>{config.analyzer ? "Aktiv" : "Aus"}</span></article>
      <article><span className="settingIcon"><Icon name="search"/></span><div><h2>Paperless RAG</h2><p>Qdrant und Ollama durchsuchen den vollständigen Dokumentinhalt semantisch.</p><small className={config.rag ? "connected" : "disconnected"}><i/>{config.rag ? "Verbunden · lokale Inhaltssuche" : "Nicht konfiguriert"}</small></div>{config.ragUrl ? <button className="quietButton" onClick={() => window.open(config.ragUrl, "_blank", "noopener,noreferrer")}>Öffnen</button> : <span className="statusTag">Aus</span>}</article>
      <article><span className="settingIcon"><Icon name="trash"/></span><div><h2>Deaktivierte Dokumente</h2><p>Diese Dokumente bleiben in Paperless erhalten, werden aber in PersonalLab nicht mehr angezeigt.</p><small>{disabledDocuments.length.toLocaleString("de-DE")} {disabledDocuments.length === 1 ? "Dokument deaktiviert" : "Dokumente deaktiviert"}</small></div><button className="quietButton" disabled={!disabledDocuments.length} onClick={() => setDisabledPicker(true)}>Verwalten</button></article>
      <article><span className="settingIcon"><Icon name="energy"/></span><div><h2>EnergieLab</h2><p>Verbrauch, Kosten, Verträge, Abschläge und Zählerstände.</p><small className={config.energyLab ? "connected" : "disconnected"}><i/>{config.energyLab ? "Verbunden · nur lesend" : "Nicht konfiguriert"}</small></div><span className={config.energyLab ? "statusTag active" : "statusTag"}>{config.energyLab ? "Aktiv" : "Aus"}</span></article>
      <article><span className="settingIcon"><Icon name="money"/></span><div><h2>FinanzLab</h2><p>Kontostände, offene Kredite und kommende Raten.</p><small className={config.financeLab ? "connected" : "disconnected"}><i/>{config.financeLab ? "Verbunden · nur lesend" : "Nicht konfiguriert"}</small></div><span className={config.financeLab ? "statusTag active" : "statusTag"}>{config.financeLab ? "Aktiv" : "Aus"}</span></article>
      <article><span className="settingIcon"><Icon name="home"/></span><div><h2>Home Assistant</h2><p>{sensorCount} Sensoren sind für die Übersicht ausgewählt.</p><small className={config.homeAssistant ? "connected" : "disconnected"}><i/>{config.homeAssistant ? "Verbunden · nur lesend" : "Nicht konfiguriert"}</small></div><button className="quietButton" onClick={goSensors}>Sensoren</button></article>
      <article><span className="settingIcon"><Icon name="sync"/></span><div><h2>Automatischer Abgleich</h2><p>{config.autoSync ? `Neue Paperless-Dokumente werden alle ${config.syncMinutes} Minuten übernommen.` : "Der automatische Abgleich ist ausgeschaltet."}</p><small>Zuletzt: {last}</small></div><span className={config.autoSync ? "statusTag active" : "statusTag"}>{config.autoSync ? "Aktiv" : "Aus"}</span></article>
    </div>
    {disabledPicker && <div className="dialogBackdrop" onMouseDown={event => { if (restoringId == null && event.currentTarget === event.target) setDisabledPicker(false); }}><section className="editorDialog disabledDocumentsDialog"><div className="dialogHead"><div><p className="eyebrow">NUR IN PERSONALLAB DEAKTIVIERT</p><h2>Dokumente wieder einblenden</h2></div><button type="button" disabled={restoringId != null} onClick={() => setDisabledPicker(false)}><Icon name="close"/></button></div><p className="dialogLead">Paperless wurde nicht verändert. Wähle ein Dokument, um es wieder in allen PersonalLab-Ansichten anzuzeigen.</p><div className="disabledDocumentChoices">{disabledDocuments.map(document => <article key={document.id}><span><strong>{friendlyDocumentTitle(document)}</strong><small>Paperless #{document.id} · {document.date || "ohne Datum"} · {documentCorrespondentLabel(document.correspondent)}</small></span><button type="button" className="quietButton" disabled={restoringId != null} onClick={() => restore(document)}>{restoringId === document.id ? "Wird eingeblendet …" : "Wieder einblenden"}</button></article>)}</div>{restoreError && <p className="errorText">{restoreError}</p>}<div className="dialogActions"><span/><span/><button type="button" className="quietButton" disabled={restoringId != null} onClick={() => setDisabledPicker(false)}>Schließen</button><span/></div></section></div>}
  </>;
}

function Drawer({ document, areas, correspondents, paperlessUrl, editMode, close, update, addCorrespondent, addGroup }: { document: DocumentItem; areas: Area[]; correspondents: string[]; paperlessUrl: string; editMode: boolean; close: () => void; update: (doc: DocumentItem) => void; addCorrespondent: (name: string) => void; addGroup: (areaId: string, subareaId: string | null, name: string) => void }) {
  const [draft, setDraft] = useState(document);
  const [editing, setEditing] = useState(editMode);
  const [largePreview, setLargePreview] = useState(false);
  const contract = contractPresentation(draft);
  const area = areas.find(item => item.id === draft.area);
  const assignment = hierarchyChoice(area, draft.tileId, draft.subarea);
  const active = assignment?.path[0];
  const availableGroups = [...new Set([...(area?.groups ?? []), ...((assignment?.path ?? []).flatMap(node => node.groups ?? [])), ...correspondents])].sort((a, b) => a.localeCompare(b, "de"));
  const changeArea = (nextArea: string) => setDraft(current => ({ ...current, area: nextArea, subarea: "", tileId: "", group: "", assignmentSource: "manual" }));
  const changeHierarchy = (choice: HierarchyChoice | null) => setDraft(current => ({ ...current, subarea: choice?.rootId ?? "", tileId: choice?.tileId ?? "", group: "", assignmentSource: "manual" }));
  const save = () => { const correspondent = draft.correspondent.trim(); const group = draft.group?.trim() ?? ""; if (correspondent) addCorrespondent(correspondent); if (group && area) addGroup(area.id, assignment?.rootId ?? null, group); update({ ...draft, correspondent, group, assignmentSource: "manual", metadataSource: "manual" }); setEditing(false); };
  return <div className="drawerBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><aside className={`drawer ${largePreview ? "previewing" : ""} ${contract ? `contract-${contract.status}` : ""}`}><div className="drawerTop"><span className="docIcon"><Icon name="file"/></span><div className="drawerTopActions">{!editing && <button onClick={() => setEditing(true)} aria-label="Dokument bearbeiten"><Icon name="edit"/></button>}<button onClick={close} aria-label="Schließen"><Icon name="close"/></button></div></div><p className="eyebrow">PAPERLESS #{document.id}</p>{editing ? <div className="drawerForm"><label>Titel<input value={draft.title} onChange={event => setDraft({...draft, title: event.target.value})}/></label><label>Korrespondent<input list="personallab-correspondents" value={draft.correspondent} onChange={event => setDraft({...draft, correspondent: event.target.value})} placeholder="Auswählen oder neu eingeben"/><datalist id="personallab-correspondents">{correspondents.map(name => <option key={name} value={name}/>)}</datalist><small>Vorhandenen Korrespondenten auswählen oder einen neuen Namen eingeben.</small></label><label>Dokumenttyp<input value={draft.type} onChange={event => setDraft({...draft, type: event.target.value})}/></label>{isContract(draft) && <fieldset className="contractFields"><legend>Vertragsdaten</legend><div><label>Vertragsnummer<input value={draft.contractNumber ?? ""} onChange={event => setDraft({...draft, contractNumber: event.target.value})}/></label><label>Vertragsbeginn<input type="date" value={isoDate(draft.contractStart)} onChange={event => setDraft({...draft, contractStart: event.target.value})}/></label><label>Vertragsende<input type="date" value={isoDate(draft.contractEnd)} onChange={event => setDraft({...draft, contractEnd: event.target.value})}/></label><label>Kündigungsfrist bis<input type="date" value={isoDate(draft.cancellationDeadline)} onChange={event => setDraft({...draft, cancellationDeadline: event.target.value})}/></label></div><label className="contractCheck"><input type="checkbox" checked={Boolean(draft.autoRenew)} onChange={event => setDraft({...draft, autoRenew: event.target.checked})}/>Automatische Verlängerung</label><label>Status<select value={draft.contractStatusManual ? draft.contractStatus ?? "unknown" : "automatic"} onChange={event => setDraft({...draft, contractStatusManual: event.target.value !== "automatic", contractStatus: event.target.value === "automatic" ? undefined : event.target.value as DocumentItem["contractStatus"]})}><option value="automatic">Automatisch aus Laufzeit</option><option value="active">Aktiv</option><option value="inactive">Inaktiv</option><option value="unknown">Status prüfen</option></select></label></fieldset>}</div> : <><h2>{draft.title}</h2><p className="drawerLead">{draft.correspondent} · {draft.type}</p>{contract && <span className={`contractBadge large ${contract.status}`}>{contract.label}</span>}</>}{paperlessUrl && <section className={`documentPreview ${largePreview ? "large" : ""}`}><button type="button" onClick={() => setLargePreview(value => !value)}>{largePreview ? <iframe title={`Vorschau ${draft.title}`} src={`/api/documents/${document.id}/preview`}/> : <img src={`/api/documents/${document.id}/thumbnail`} alt={`Miniaturansicht von ${draft.title}`}/>}<span><Icon name={largePreview ? "close" : "open"} size={16}/>{largePreview ? "Vorschau schließen" : "Große Vorschau öffnen"}</span></button></section>}<dl><div><dt>Dokumentdatum</dt><dd>{draft.date}</dd></div><div><dt>Bereich</dt><dd>{area?.name ?? "Nicht zugeordnet"}</dd></div>{(assignment?.path ?? []).map((node, index) => <div key={nodeUid(area!.id, node)}><dt>Ebene {index + 2}</dt><dd>{node.name}</dd></div>)}<div><dt>Zusatzgruppe</dt><dd>{draft.group || "–"}</dd></div>{contract && <><div><dt>Vertragsende</dt><dd>{draft.contractEnd || "Nicht hinterlegt"}</dd></div><div><dt>Status</dt><dd>{contract.label}</dd></div></>}</dl><section className="assignment"><p className="eyebrow">ZUORDNUNG</p>{editing ? <div className="drawerForm assignmentFields"><label>Ebene 1 · Bereich<select value={draft.area} onChange={event => changeArea(event.target.value)}><option value="">Nicht zugeordnet</option>{areas.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><HierarchySelectors area={area} value={assignment} change={changeHierarchy} prefix={`drawer-${document.id}-`}/><label>Zusatzgruppe · optional<input list="personallab-groups" value={draft.group ?? ""} onChange={event => setDraft({...draft, group: event.target.value, assignmentSource: "manual"})} placeholder="z. B. Sparkasse oder ING"/><datalist id="personallab-groups">{availableGroups.map(name => <option key={name} value={name}/>)}</datalist><small>Auswählen oder eine neue Untergruppe eingeben.</small></label></div> : <div className="filterPills"><button className={area ? "active" : ""}><span>{area && <Icon name="check" size={14}/>}</span>{area?.name ?? "Nicht zugeordnet"}</button>{(assignment?.path ?? []).map(node => <button className="active" key={nodeUid(area!.id, node)}><span><Icon name="check" size={14}/></span>{node.name}</button>)}{draft.group && <button className="active"><span><Icon name="check" size={14}/></span>{draft.group}</button>}</div>}</section>{editing ? <div className="drawerActions"><button className="quietButton" onClick={() => { setDraft(document); setEditing(false); }}>Abbrechen</button><button className="primaryButton" onClick={save}><Icon name="check" size={17}/>Änderungen speichern</button></div> : <button className="primaryButton full" disabled={!paperlessUrl} onClick={() => paperlessUrl && window.open(`${paperlessUrl}/documents/${document.id}/details`, "_blank", "noopener,noreferrer")}><Icon name="open" size={17}/>In Paperless öffnen</button>}</aside></div>;
}

function LegacyDrawer({ document, areas, paperlessUrl, editMode, close, update }: { document: DocumentItem; areas: Area[]; paperlessUrl: string; editMode: boolean; close: () => void; update: (doc: DocumentItem) => void }) {
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

function TreeNodeEditor({ editor, areas, close, save, move }: { editor: Exclude<TreeNodeEditorState, null>; areas: Area[]; close: () => void; save: (name: string, hint: string) => void; move: (direction: -1 | 1) => void }) {
  const area = areas.find(item => item.id === editor.areaId);
  const node = editor.uid ? area && findNode(area.id, area.subareas, editor.uid) : undefined;
  const parent = editor.parentUid ? area && findNode(area.id, area.subareas, editor.parentUid) : undefined;
  const [name, setName] = useState(node?.name ?? "");
  const [hint, setHint] = useState(node?.hint ?? "");
  const title = node ? `„${node.name}“ bearbeiten` : `Unterpunkt in „${parent?.name ?? area?.name ?? "Liste"}“ anlegen`;
  return <div className="dialogBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><form className="editorDialog treeNodeDialog" onSubmit={event => { event.preventDefault(); if (name.trim()) save(name.trim(), hint.trim()); }}><div className="dialogHead"><div><p className="eyebrow">ABLAGELEISTE BEARBEITEN</p><h2>{title}</h2></div><button type="button" onClick={close} aria-label="Schließen"><Icon name="close"/></button></div><p className="dialogLead">Der Eintrag und seine Dokumentzuordnung bleiben verbunden. Änderungen werden automatisch in PersonalLab gespeichert.</p><label>Name<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Name des Listeneintrags"/></label><label>Beschreibung<input value={hint} onChange={event => setHint(event.target.value)} placeholder="Optionale kurze Beschreibung"/></label>{node && <div className="orderControls"><span>Reihenfolge in dieser Ebene</span><button type="button" onClick={() => move(-1)}><Icon name="up" size={17}/>Nach oben</button><button type="button" onClick={() => move(1)}><Icon name="down" size={17}/>Nach unten</button></div>}<div className="dialogActions"><span/><span/><button type="button" className="quietButton" onClick={close}>Abbrechen</button><button className="primaryButton" type="submit"><Icon name="check" size={16}/>{node ? "Änderungen speichern" : "Unterpunkt anlegen"}</button></div></form></div>;
}

function DeepAssignmentDialog({ count, areas, correspondents, close, apply }: { count: number; areas: Area[]; correspondents: string[]; close: () => void; apply: (choice: HierarchyChoice & { areaId: string }, group: string) => void }) {
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const area = areas.find(item => item.id === areaId);
  const [choice, setChoice] = useState<HierarchyChoice | null>(() => {
    const firstArea = areas[0];
    const first = firstArea?.subareas[0];
    return firstArea && first ? { rootId: first.id, tileId: nodeUid(firstArea.id, first), path: [first] } : null;
  });
  const [group, setGroup] = useState("");
  const groups = [...new Set([...(area?.groups ?? []), ...((choice?.path ?? []).flatMap(node => node.groups ?? [])), ...correspondents])].sort((a, b) => a.localeCompare(b, "de"));
  const changeArea = (id: string) => {
    const next = areas.find(item => item.id === id);
    const first = next?.subareas[0];
    setAreaId(id);
    setChoice(next && first ? { rootId: first.id, tileId: nodeUid(next.id, first), path: [first] } : null);
    setGroup("");
  };
  return <div className="dialogBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><form className="editorDialog assignmentDialog" onSubmit={event => { event.preventDefault(); if (area && choice) apply({ ...choice, areaId: area.id }, group.trim()); }}><div className="dialogHead"><div><p className="eyebrow">NEU ZUORDNEN</p><h2>{count} {count === 1 ? "Dokument" : "Dokumente"}</h2></div><button type="button" onClick={close}><Icon name="close"/></button></div><p className="dialogLead">Alle vorhandenen Ebenen werden automatisch eingeblendet. Du kannst bis zum gewünschten Unterpunkt gehen oder auf einer höheren Ebene ablegen.</p><label>Ebene 1 · Bereich<select value={areaId} onChange={event => changeArea(event.target.value)}>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><HierarchySelectors area={area} value={choice} change={next => { setChoice(next); setGroup(""); }} prefix="bulk-"/><label>Zusatzgruppe · optional<input list="assignment-groups-deep" value={group} onChange={event => setGroup(event.target.value)} placeholder="Auswählen oder neu eingeben"/><datalist id="assignment-groups-deep">{groups.map(name => <option key={name} value={name}/>)}</datalist></label><div className="dialogActions"><span/><span/><button type="button" className="quietButton" onClick={close}>Abbrechen</button><button className="primaryButton" type="submit" disabled={!choice}>Zuordnung übernehmen</button></div></form></div>;
}

function AssignmentDialog({ count, areas, correspondents, close, apply }: { count: number; areas: Area[]; correspondents: string[]; close: () => void; apply: (areaId: string, subareaId: string, group: string) => void }) {
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const area = areas.find(item => item.id === areaId) ?? areas[0];
  const [subareaId, setSubareaId] = useState(area?.subareas[0]?.id ?? "");
  const [group, setGroup] = useState("");
  const subarea = area?.subareas.find(item => item.id === subareaId);
  const groups = [...new Set([...(area?.groups ?? []), ...(subarea?.groups ?? []), ...correspondents])].sort((a, b) => a.localeCompare(b, "de"));
  const changeArea = (id: string) => { setAreaId(id); const next = areas.find(item => item.id === id); setSubareaId(next?.subareas[0]?.id ?? ""); setGroup(""); };
  return <div className="dialogBackdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><form className="editorDialog assignmentDialog" onSubmit={event => { event.preventDefault(); if (areaId && subareaId) apply(areaId, subareaId, group.trim()); }}><div className="dialogHead"><div><p className="eyebrow">NEU ZUORDNEN</p><h2>{count} {count === 1 ? "Dokument" : "Dokumente"}</h2></div><button type="button" onClick={close}><Icon name="close"/></button></div><p className="dialogLead">Die Zuordnung unterstützt jetzt drei Ebenen. Untergruppen können direkt neu eingegeben werden.</p><label>Ebene 1 · Bereich<select value={areaId} onChange={event => changeArea(event.target.value)}>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Ebene 2 · Unterbereich<select value={subareaId} onChange={event => { setSubareaId(event.target.value); setGroup(""); }}>{area?.subareas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Ebene 3 · Untergruppe<input list="assignment-groups" value={group} onChange={event => setGroup(event.target.value)} placeholder="Auswählen oder neu eingeben"/><datalist id="assignment-groups">{groups.map(name => <option key={name} value={name}/>)}</datalist></label><div className="dialogActions"><span/><span/><button type="button" className="quietButton" onClick={close}>Abbrechen</button><button className="primaryButton" type="submit">Zuordnung übernehmen</button></div></form></div>;
}

export default function PersonalLab() {
  const [screen, setScreen] = useState<Screen>("overview");
  const [areas, setAreas] = useState<Area[]>(AREA_DATA);
  const [documents, setDocuments] = useState<DocumentItem[]>(DOCUMENTS);
  const [disabledDocuments, setDisabledDocuments] = useState<DocumentItem[]>([]);
  const [correspondents, setCorrespondents] = useState<string[]>([]);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [subarea, setSubarea] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [document, setDocument] = useState<DocumentItem | null>(null);
  const [documentEditor, setDocumentEditor] = useState<DocumentItem | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [treeNodeEditor, setTreeNodeEditor] = useState<TreeNodeEditorState>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [undoMove, setUndoMove] = useState<UndoMove>(null);
  const [hydrated, setHydrated] = useState(false);
  const [documentScope, setDocumentScope] = useState<DocumentScope>("all");
  const [sortDirection, setSortDirection] = useState<DocumentSortDirection>("desc");
  const [config, setConfig] = useState<AppConfig>({ paperless: false, paperlessUrl: "", analyzer: false, analyzerUrl: "", rag: false, ragUrl: "", homeAssistant: false, homeAssistantUrl: "", energyLab: false, financeLab: false, autoSync: false, syncMinutes: 15 });
  const [pageLayouts, setPageLayouts] = useState<PageLayouts>(() => normalizePageLayouts(DEFAULT_PAGE_LAYOUTS));
  const [financeAccountAssignments, setFinanceAccountAssignments] = useState<FinanceAccountAssignments>({});
  const [financeDataSelections, setFinanceDataSelections] = useState<FinanceDataSelections>({});
  const [energyProviderAssignments, setEnergyProviderAssignments] = useState<EnergyProviderAssignments>({});
  const [energyMetricSelections, setEnergyMetricSelections] = useState<EnergyMetricSelections>({});
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [selectedSensorCount, setSelectedSensorCount] = useState(0);
  useEffect(() => {
    let active = true;
    fetch("/api/state", { cache: "no-store" }).then(response => {
      if (!response.ok) throw new Error("Datendienst nicht erreichbar");
      return response.json();
    }).then((payload: { areas?: Area[]; documents?: DocumentItem[]; disabledDocuments?: DocumentItem[]; correspondents?: string[]; pageLayouts?: PageLayouts; financeAccountAssignments?: FinanceAccountAssignments; financeDataSelections?: FinanceDataSelections; energyProviderAssignments?: EnergyProviderAssignments; energyMetricSelections?: EnergyMetricSelections; config?: AppConfig; lastSync?: string | null; haSensors?: string[] }) => {
      if (!active || !Array.isArray(payload.areas) || !Array.isArray(payload.documents)) return;
      const normalizePayloadDocument = (item: DocumentItem) => {
        const value = String(item.date ?? "");
        const parts = value.slice(0, 10).split("-");
        const group = /^\d+$/.test(String(item.group ?? "").trim()) ? cleanCorrespondent(item.correspondent) : item.group;
        return { ...item, group, date: parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : value };
      };
      const nextDocuments = payload.documents.map(normalizePayloadDocument);
      const nextDisabledDocuments = (payload.disabledDocuments ?? []).map(normalizePayloadDocument);
      const nextAreas = payload.areas.map(item => ({ ...item, groups: Array.isArray(item.groups) ? item.groups : [], count: nextDocuments.filter(doc => doc.area === item.id).length, subareas: item.subareas.map(sub => normalizeNode(item.id, sub)) }));
      setAreas(nextAreas);
      setDocuments(nextDocuments);
      setDisabledDocuments(nextDisabledDocuments);
      setCorrespondents([...new Set([...(payload.correspondents ?? []), ...nextDocuments.map(item => item.correspondent).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "de")));
      setPageLayouts(normalizePageLayouts(payload.pageLayouts));
      setFinanceAccountAssignments(payload.financeAccountAssignments && typeof payload.financeAccountAssignments === "object" ? payload.financeAccountAssignments : {});
      setFinanceDataSelections(payload.financeDataSelections && typeof payload.financeDataSelections === "object" ? payload.financeDataSelections : {});
      setEnergyProviderAssignments(payload.energyProviderAssignments && typeof payload.energyProviderAssignments === "object" ? payload.energyProviderAssignments : {});
      setEnergyMetricSelections(payload.energyMetricSelections && typeof payload.energyMetricSelections === "object" ? payload.energyMetricSelections : {});
      if (payload.config) setConfig(payload.config);
      setLastSync(payload.lastSync ?? null);
      setSelectedSensorCount(payload.haSensors?.length ?? 0);
      setHydrated(true);
    }).catch(() => { /* Die interaktive Vorschau bleibt ohne lokalen Datendienst nutzbar. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        window.document.getElementById("globalDocumentSearch")?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ areas, documents, correspondents, pageLayouts, financeAccountAssignments, financeDataSelections, energyProviderAssignments, energyMetricSelections }) }).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [areas, documents, correspondents, pageLayouts, financeAccountAssignments, financeDataSelections, energyProviderAssignments, energyMetricSelections, hydrated]);
  const countedAreas = useMemo(() => {
    const countNode = (areaId: string, rootId: string, node: Subarea): Subarea => {
      const children = (node.children ?? []).map(child => countNode(areaId, rootId, child));
      const ids = new Set(descendantUids(areaId, node));
      const direct = documents.filter(doc => doc.area === areaId && (
        ids.has(doc.tileId ?? "")
        || (node.id === rootId && !doc.tileId && doc.subarea === rootId)
        || (node.id !== rootId && doc.subarea === rootId && groupName(doc, "Sonstiges") === node.name)
      )).length;
      return { ...node, children, count: direct };
    };
    return areas.map(item => ({ ...item, count: documents.filter(doc => doc.area === item.id).length, subareas: item.subareas.map(sub => countNode(item.id, sub.id, sub)) }));
  }, [areas, documents]);
  const area = countedAreas.find(item => item.id === areaId) ?? null;
  const navigate = (next: Screen) => { setDocument(null); setDocumentEditor(null); setScreen(next); setQuery(""); setSelected([]); if (next === "documents") setDocumentScope("all"); if (next !== "area") { setAreaId(null); setSubarea(null); } };
  const openDocuments = (scope: DocumentScope) => { setDocument(null); setDocumentEditor(null); setDocumentScope(scope); setQuery(""); setSelected([]); setScreen("documents"); };
  const openArea = (next: Area, nextSubarea?: string) => { setDocument(null); setDocumentEditor(null); setAreaId(next.id); setSubarea(nextSubarea ?? null); setQuery(""); setScreen("area"); };
  const toggleEdit = () => { setEditMode(value => !value); setSelected([]); setEditor(null); setTreeNodeEditor(null); setAssigning(false); };
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
  const addGroup = (targetArea: string, targetSubarea: string | null, name: string) => setAreas(current => current.map(item => item.id !== targetArea ? item : targetSubarea ? { ...item, subareas: item.subareas.map(sub => sub.id !== targetSubarea ? sub : { ...sub, groups: [...new Set([...(sub.groups ?? []), name])] }) } : { ...item, groups: [...new Set([...(item.groups ?? []), name])] }));
  const renameNode = (targetArea: string, uid: string) => setTreeNodeEditor({ areaId: targetArea, uid });
  const addChildNode = (targetArea: string, parentUid: string) => setTreeNodeEditor({ areaId: targetArea, parentUid });
  const saveTreeNode = (name: string, hint: string) => {
    if (!treeNodeEditor) return;
    const target = areas.find(item => item.id === treeNodeEditor.areaId);
    if (!target) return;
    if (treeNodeEditor.uid) {
      const selection = findTreeSelection(target, treeNodeEditor.uid);
      const previousName = selection?.node.name ?? "";
      setAreas(current => current.map(item => item.id === target.id ? { ...item, subareas: mapNodeTree(target.id, item.subareas, treeNodeEditor.uid!, entry => ({ ...entry, name, hint })) } : item));
      if (selection && previousName !== name) {
        setDocuments(current => current.map(doc => {
          if (doc.area !== target.id || doc.subarea !== selection.root.id || doc.tileId) return doc;
          if (groupName(doc, "Sonstiges") !== previousName) return doc;
          return { ...doc, tileId: treeNodeEditor.uid!, group: doc.group?.trim() ? name : doc.group, assignmentSource: "manual" };
        }));
      }
    } else if (treeNodeEditor.parentUid) {
      const id = `${slug(name)}-${Date.now()}`;
      const uid = `tile:${target.id}:${id}`;
      setAreas(current => current.map(item => item.id === target.id ? { ...item, subareas: mapNodeTree(target.id, item.subareas, treeNodeEditor.parentUid!, entry => ({ ...entry, children: [...(entry.children ?? []), { id, uid, name, hint, count: 0, groups: [], children: [] }] })) } : item));
    }
    setTreeNodeEditor(null);
  };
  const moveTreeNode = (direction: -1 | 1) => {
    if (!treeNodeEditor?.uid) return;
    setAreas(current => current.map(item => item.id === treeNodeEditor.areaId ? { ...item, subareas: moveNodeTree(item.id, item.subareas, treeNodeEditor.uid!, direction) } : item));
  };
  const removeNode = (targetArea: string, uid: string) => {
    const target = areas.find(item => item.id === targetArea); const node = target && findNode(targetArea, target.subareas, uid); if (!node) return;
    const ids = new Set(descendantUids(targetArea, node));
    if (documents.some(doc => doc.area === targetArea && ids.has(doc.tileId ?? ""))) { window.alert("Dieser Listeneintrag enthält noch Dokumente. Verschiebe sie zuerst an ein anderes Ziel."); return; }
    if (!window.confirm(`„${node.name}“ wirklich löschen?`)) return;
    setAreas(current => current.map(item => item.id === targetArea ? { ...item, subareas: removeNodeTree(targetArea, item.subareas, uid) } : item));
  };
  const addCorrespondent = (name: string) => setCorrespondents(current => [...new Set([...current, name])].filter(Boolean).sort((a, b) => a.localeCompare(b, "de")));
  const assignDocuments = (ids: number[], destination: DropDestination) => {
    if (!ids.length) return;
    setDocuments(current => {
      const previous = current.filter(doc => ids.includes(doc.id));
      setUndoMove({ documents: previous, message: `${ids.length} ${ids.length === 1 ? "Dokument" : "Dokumente"} nach ${destination.label} verschoben` });
      return current.map(doc => ids.includes(doc.id) ? { ...doc, area: destination.areaId, subarea: destination.rootId, tileId: destination.tileId, group: destination.group ?? "", assignmentSource: "manual" } : doc);
    });
    setSelected([]);
  };
  const dragDocument = (event: DragEvent<HTMLButtonElement>, doc: DocumentItem) => {
    const ids = selected.includes(doc.id) ? selected : [doc.id];
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-personallab-documents", JSON.stringify(ids));
    event.dataTransfer.setData("text/plain", `${ids.length} PersonalLab-Dokumente`);
  };
  const undoLastMove = () => {
    if (!undoMove) return;
    const previous = new Map(undoMove.documents.map(doc => [doc.id, doc]));
    setDocuments(current => current.map(doc => previous.get(doc.id) ?? doc));
    setUndoMove(null);
  };
  const applyAssignment = (choice: HierarchyChoice & { areaId: string }, nextGroup: string) => {
    const targetArea = countedAreas.find(item => item.id === choice.areaId);
    const targetNode = choice.path.at(-1);
    assignDocuments(selected, {
      areaId: choice.areaId,
      rootId: choice.rootId,
      tileId: choice.tileId,
      group: nextGroup,
      label: `${targetArea?.name ?? choice.areaId} → ${targetNode?.name ?? choice.rootId}`,
    });
    setAssigning(false);
  };
  const renameParty = (oldName: string, newName: string, fallback: string) => setDocuments(current => current.map(doc => {
    if (doc.area !== "work" || groupName(doc, fallback) !== oldName) return doc;
    return doc.group?.trim()
      ? { ...doc, group: newName, assignmentSource: "manual" }
      : { ...doc, correspondent: newName, assignmentSource: "manual", metadataSource: "manual" };
  }));
  const updateDocument = (next: DocumentItem) => {
    setDocuments(current => current.map(doc => doc.id === next.id ? next : doc));
    setDocument(current => current?.id === next.id ? next : current);
    setDocumentEditor(current => current?.id === next.id ? next : current);
  };
  const deactivateDocument = async (target: DocumentItem) => {
    const response = await fetch(`/api/documents/${target.id}/disable`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Das Dokument konnte in PersonalLab nicht deaktiviert werden.");
    setDocuments(current => current.filter(doc => doc.id !== target.id));
    setDisabledDocuments(current => current.some(doc => doc.id === target.id) ? current : [...current, target]);
    setDocument(current => current?.id === target.id ? null : current);
    setDocumentEditor(current => current?.id === target.id ? null : current);
    setSelected(current => current.filter(id => id !== target.id));
  };
  const restoreDocument = async (target: DocumentItem) => {
    const response = await fetch(`/api/documents/${target.id}/restore`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Das Dokument konnte nicht wieder eingeblendet werden.");
    const restored = payload.document ?? target;
    setDisabledDocuments(current => current.filter(doc => doc.id !== target.id));
    setDocuments(current => current.some(doc => doc.id === target.id) ? current : [restored, ...current]);
  };
  const updateFinanceAccountAssignment = (key: string, ids: string[] | undefined) => setFinanceAccountAssignments(current => {
    if (ids === undefined) {
      const next = { ...current };
      delete next[key];
      return next;
    }
    return { ...current, [key]: [...new Set(ids.map(String))] };
  });
  const updateFinanceDataSelection = (key: string, ids: string[] | undefined) => setFinanceDataSelections(current => {
    if (ids === undefined) {
      const next = { ...current };
      delete next[key];
      return next;
    }
    return { ...current, [key]: [...new Set(ids.map(String))] };
  });
  const updateEnergyProviderAssignment = (key: string, providers: string[] | undefined) => setEnergyProviderAssignments(current => {
    if (providers === undefined) {
      const next = { ...current };
      delete next[key];
      return next;
    }
    return { ...current, [key]: [...new Set(providers.map(String))] };
  });
  const updateEnergyMetricSelection = (key: string, ids: string[] | undefined) => setEnergyMetricSelections(current => {
    if (ids === undefined) {
      const next = { ...current };
      delete next[key];
      return next;
    }
    return { ...current, [key]: [...new Set(ids.map(String))] };
  });
  const submitSearch = (value: string) => {
    setQuery(value.trim());
    setSearchRevision(current => current + 1);
  };
  const commonList = { editMode, selected, setSelected, assign: () => { if (selected.length) setAssigning(true); }, dragDocument, sortDirection, setSortDirection };
  return <div className={`app ${editMode ? "editing" : ""}`}>
    <Header screen={screen} navigate={navigate} editMode={editMode} toggleEdit={toggleEdit}/>
    <div className="workspaceShell">
      <NavigationSidebar areas={countedAreas} documents={documents} editMode={editMode} activeAreaId={screen === "area" ? areaId : null} activeNodeKey={screen === "area" ? subarea : null} toggleEdit={toggleEdit} openArea={openArea} editArea={item => setEditor({ kind: "area", areaId: item.id })} addArea={() => setEditor({ kind: "area" })} drop={assignDocuments} renameNode={renameNode} addChild={addChildNode} removeNode={removeNode}/>
      <main className="page">{document && <DocumentWorkspace document={document} paperlessUrl={config.paperlessUrl} editMode={editMode} back={() => setDocument(null)} edit={() => setDocumentEditor(document)} deactivate={() => deactivateDocument(document)}/>}<div className="screenContent" hidden={Boolean(document)}>{query.trim() ? <SearchResults documents={documents} query={query} searchRevision={searchRevision} setQuery={submitSearch} analyzer={config.analyzer} rag={config.rag} openDocument={setDocument} {...commonList}/> : <>{screen === "overview" && <Overview documents={documents} openDocuments={openDocuments} paperlessUrl={config.paperlessUrl} query={query} setQuery={submitSearch} openDocument={setDocument} {...commonList}/>} {screen === "area" && area && <AreaView area={area} documents={documents} config={config} pageLayouts={pageLayouts} setPageLayouts={setPageLayouts} financeAccountAssignments={financeAccountAssignments} updateFinanceAccountAssignment={updateFinanceAccountAssignment} financeDataSelections={financeDataSelections} updateFinanceDataSelection={updateFinanceDataSelection} energyProviderAssignments={energyProviderAssignments} updateEnergyProviderAssignment={updateEnergyProviderAssignment} energyMetricSelections={energyMetricSelections} updateEnergyMetricSelection={updateEnergyMetricSelection} selectedSubarea={subarea} chooseSubarea={setSubarea} goBack={() => navigate("overview")} query={query} setQuery={submitSearch} openDocument={setDocument} editSubarea={id => setEditor({ kind: "subarea", areaId: area.id, subareaId: id })} addSubarea={() => setEditor({ kind: "subarea", areaId: area.id })} addGroup={(subareaId, name) => addGroup(area.id, subareaId, name)} renameParty={renameParty} {...commonList}/>} {screen === "documents" && <DocumentsView documents={documents} scope={documentScope} query={query} setQuery={submitSearch} openDocument={setDocument} {...commonList}/>} {screen === "home-assistant" && <HomeAssistant configured={config.homeAssistant} onCountChange={setSelectedSensorCount}/>} {screen === "settings" && <Settings config={config} documentCount={documents.length} disabledDocuments={disabledDocuments} sensorCount={selectedSensorCount} lastSync={lastSync} goSensors={() => navigate("home-assistant")} restoreDocument={restoreDocument}/>}</>}</div></main>
    </div>
    <footer><span>PersonalLab 2.5.11</span><span>lokal auf deinem ZimaOS</span><span>by Lrd.Tiberius</span></footer>
    {undoMove && <div className="undoToast" role="status"><span><Icon name="check" size={17}/>{undoMove.message}</span><button onClick={undoLastMove}>Rückgängig</button><button className="toastClose" onClick={() => setUndoMove(null)} aria-label="Hinweis schließen"><Icon name="close" size={14}/></button></div>}
    {documentEditor && <Drawer document={documentEditor} areas={countedAreas} correspondents={correspondents} paperlessUrl={config.paperlessUrl} editMode={editMode} close={() => setDocumentEditor(null)} update={updateDocument} addCorrespondent={addCorrespondent} addGroup={addGroup}/>} {editor && <TileEditor key={`${editor.kind}-${editor.areaId ?? "new"}-${editor.kind === "subarea" ? editor.subareaId ?? "new" : ""}`} editor={editor} areas={areas} close={() => setEditor(null)} save={saveTile} remove={removeTile} move={moveTile}/>} {treeNodeEditor && <TreeNodeEditor key={`${treeNodeEditor.areaId}-${treeNodeEditor.uid ?? `new-${treeNodeEditor.parentUid}`}`} editor={treeNodeEditor} areas={areas} close={() => setTreeNodeEditor(null)} save={saveTreeNode} move={moveTreeNode}/>} {assigning && <DeepAssignmentDialog count={selected.length} areas={countedAreas} correspondents={correspondents} close={() => setAssigning(false)} apply={applyAssignment}/>}
  </div>;
}

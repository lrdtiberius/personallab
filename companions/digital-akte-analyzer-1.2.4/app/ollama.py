from __future__ import annotations

import copy
import json
import re
from typing import Any

import requests


PROMPT_VERSION = "digital-akte-v3.3-presentation"


class OllamaError(RuntimeError):
    pass


ANALYSIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "document_type": {
            "type": ["string", "null"],
        },
        "category": {
            "type": ["string", "null"],
        },
        "short_title": {
            "type": ["string", "null"],
        },
        "summary": {
            "type": "string",
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
        },
        "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
        },
        "correspondence": {
            "type": ["object", "null"],
            "properties": {
                "correspondent": {
                    "type": ["string", "null"],
                },
                "subject": {
                    "type": ["string", "null"],
                },
                "topics": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "importance": {
                    "type": ["string", "null"],
                },
                "action_required": {
                    "type": "boolean",
                },
                "action": {
                    "type": ["string", "null"],
                },
            },
            "required": [
                "correspondent",
                "subject",
                "topics",
                "importance",
                "action_required",
                "action",
            ],
        },
        "entities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string"},
                    "name": {"type": "string"},
                    "relation": {"type": "string"},
                    "confidence": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                    },
                    "attributes": {
                        "type": "object",
                    },
                },
                "required": [
                    "type",
                    "name",
                    "relation",
                    "confidence",
                    "attributes",
                ],
            },
        },
        "facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "label": {"type": "string"},
                    "value": {},
                    "unit": {
                        "type": ["string", "null"],
                    },
                    "confidence": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                    },
                },
                "required": [
                    "key",
                    "label",
                    "value",
                    "unit",
                    "confidence",
                ],
            },
        },
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": ["string", "null"],
                    },
                    "type": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": [
                    "date",
                    "type",
                    "description",
                ],
            },
        },
        "payments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "amount": {
                        "type": ["number", "null"],
                    },
                    "currency": {"type": "string"},
                    "interval": {
                        "type": ["string", "null"],
                    },
                    "payment_day": {
                        "type": ["integer", "null"],
                    },
                    "payment_date": {
                        "type": ["string", "null"],
                    },
                    "category": {
                        "type": ["string", "null"],
                    },
                    "recipient": {
                        "type": ["string", "null"],
                    },
                    "account": {
                        "type": ["string", "null"],
                    },
                    "valid_from": {
                        "type": ["string", "null"],
                    },
                    "valid_until": {
                        "type": ["string", "null"],
                    },
                },
                "required": [
                    "amount",
                    "currency",
                    "interval",
                    "payment_day",
                    "payment_date",
                    "category",
                    "recipient",
                    "account",
                    "valid_from",
                    "valid_until",
                ],
            },
        },
        "contract": {
            "type": ["object", "null"],
            "properties": {
                "contract_type": {
                    "type": ["string", "null"],
                },
                "partner": {
                    "type": ["string", "null"],
                },
                "contract_number": {
                    "type": ["string", "null"],
                },
                "start_date": {
                    "type": ["string", "null"],
                },
                "end_date": {
                    "type": ["string", "null"],
                },
                "cancellation_date": {
                    "type": ["string", "null"],
                },
                "cancellation_info": {
                    "type": ["string", "null"],
                },
                "status": {
                    "type": "string",
                },
                "details": {
                    "type": "object",
                },
            },
            "required": [
                "contract_type",
                "partner",
                "contract_number",
                "start_date",
                "end_date",
                "cancellation_date",
                "cancellation_info",
                "status",
                "details",
            ],
        },
    },
    "required": [
        "document_type",
        "category",
        "short_title",
        "summary",
        "keywords",
        "confidence",
        "correspondence",
        "entities",
        "facts",
        "events",
        "payments",
        "contract",
    ],
}

ANALYSIS_SCHEMA["properties"]["summary"]["maxLength"] = 1200
ANALYSIS_SCHEMA["properties"]["keywords"]["maxItems"] = 15
ANALYSIS_SCHEMA["properties"]["correspondence"]["properties"][
    "topics"
]["maxItems"] = 10
for field_name, maximum in (
    ("entities", 25),
    ("facts", 30),
    ("events", 20),
    ("payments", 20),
):
    ANALYSIS_SCHEMA["properties"][field_name]["maxItems"] = maximum

COMPACT_ANALYSIS_SCHEMA = copy.deepcopy(ANALYSIS_SCHEMA)
COMPACT_ANALYSIS_SCHEMA["properties"]["summary"]["maxLength"] = 600
COMPACT_ANALYSIS_SCHEMA["properties"]["keywords"]["maxItems"] = 5
COMPACT_ANALYSIS_SCHEMA["properties"]["correspondence"]["properties"][
    "topics"
]["maxItems"] = 4
for field_name, maximum in (
    ("entities", 6),
    ("facts", 8),
    ("events", 5),
    ("payments", 6),
):
    COMPACT_ANALYSIS_SCHEMA["properties"][field_name]["maxItems"] = maximum


def parse_json_response(text: str) -> dict[str, Any]:
    cleaned = text.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(
            r"^```(?:json)?\\s*",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"\\s*```$", "", cleaned)

    try:
        value = json.loads(cleaned)

    except json.JSONDecodeError as exc:
        # Falls Ollama vor/nach dem JSON noch Text liefert,
        # das erste vollstaendige JSON-Objekt herauslesen.
        start = cleaned.find("{")

        if start < 0:
            raise OllamaError(
                "Ollama hat kein gueltiges JSON geliefert"
            ) from exc

        try:
            decoder = json.JSONDecoder()
            value, _ = decoder.raw_decode(
                cleaned[start:]
            )

        except json.JSONDecodeError as inner_exc:
            raise OllamaError(
                "Ollama-JSON konnte nicht gelesen werden"
            ) from inner_exc

    if not isinstance(value, dict):
        raise OllamaError(
            "Ollama-Antwort muss ein JSON-Objekt sein"
        )

    return value


class OllamaClient:
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout: int = 90,
        *,
        num_ctx: int = 4096,
        num_predict: int = 700,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.num_ctx = num_ctx
        self.num_predict = num_predict
        self.session = requests.Session()

    def ping(self) -> None:
        try:
            response = self.session.get(
                f"{self.base_url}/api/tags",
                timeout=15,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise OllamaError(
                f"Ollama ist nicht erreichbar: {exc}"
            ) from exc

    def analyze(
        self,
        *,
        title: str,
        content: str,
        language: str = "de",
        timeout: int | None = None,
        num_predict: int | None = None,
        compact: bool = False,
    ) -> dict[str, Any]:

        system = (
            "Du analysierst private Dokumente fuer eine lokale "
            "digitale Akte. Extrahiere ausschliesslich Informationen, "
            "die im Dokument belegt sind. Erfinde nichts. "
            "Bei Unsicherheit verwende null, eine leere Liste oder "
            "einen niedrigen Confidence-Wert. "
            "Geldbetraege, Daten, Vertragsangaben, Fristen, "
            "Zahlungsintervalle, Personen, Organisationen und "
            "wichtige Fakten muessen besonders sorgfaeltig behandelt "
            "werden. Schriftverkehr benoetigt eine kurze sachliche "
            "Zusammenfassung, damit der Inhalt ohne Oeffnen des PDFs "
            "erkennbar ist. Typische OCR-Fehler, Seitennummern, "
            "wiederholte Kopfzeilen und unvollstaendige Textfragmente "
            "duerfen nicht als gesicherte Fakten interpretiert werden. "
            "short_title und summary sind sichtbare Texte fuer Menschen, "
            "keine Rohdatenfelder. Formuliere sie in natuerlichem, klarem "
            "Deutsch und beschreibe den tatsaechlichen Zweck oder die "
            "Kernaussage des Dokuments."
        )

        compact_hint = ""
        if compact:
            compact_hint = """
- Dies ist der kompakte letzte Versuch: antworte extrem knapp.
- Keine Wiederholungen oder OCR-Fragmente aufnehmen.
- keywords maximal 5, entities maximal 6, facts maximal 8,
  events maximal 5 und payments maximal 6 Eintraege.
- Nur die wichtigsten eindeutig belegten Angaben ausgeben."""

        prompt = f"""Analysiere dieses Paperless-Dokument auf {language}.

Titel:
{title}

Dokumenttext:
{content}

Hinweise:
- summary: genau ein bis zwei kurze, vollstaendige Saetze. Nenne zuerst,
  worum es konkret geht und danach nur die wichtigste Folge, Entscheidung,
  Frist oder Zahlung. Der Inhalt muss ohne Oeffnen des PDFs verstaendlich sein.
- short_title: konkrete menschenlesbare Bezeichnung mit Thema und bei Bedarf
  Absender oder Zeitraum; keine internen Dateinamen und keine blossen Nummern.
- Niemals Seitenzahlen, Positionsnummern, OCR-Zeilenreste, Anschriften,
  unerklaerte Kennziffern oder Formulierungen wie "6 von 38" als summary
  verwenden. Keine Textfragmente einfach aneinanderreihen.
- Nicht nur "Dokument/Vertrag/Rechnung/Korrespondenz von ... vom ..."
  schreiben. Immer Gegenstand oder Anlass nennen. Wenn er nicht sicher
  erkennbar ist, das ehrlich und in einem vollstaendigen Satz ausdruecken.
- Bei Rechnungen Verkaeufer, gekaufte Ware oder Leistung und Gesamtbetrag
  nennen, sofern belegt. Adressen und einzelne Artikelpositionsnummern
  weglassen.
- Bei Schreiben Anlass, mitgeteilte Entscheidung oder Status und eine
  erforderliche Handlung oder Frist nennen, sofern vorhanden.
- Bei Vertraegen Vertragsart, Partner, Leistungsgegenstand sowie die
  wichtigsten Konditionen, Beginn- oder Kuendigungsdaten nennen.
- short_title und summary duerfen sich nicht lediglich gegenseitig
  wiederholen.
- category: uebergeordneter Lebensbereich.
- correspondence nur bei Schriftverkehr verwenden, sonst null.
- facts enthaelt wichtige strukturierte Einzelangaben.
- payments enthaelt einmalige oder wiederkehrende Zahlungen.
- Bei Kontoauszuegen nicht jede einzelne Buchungszeile als payment
  ausgeben, sondern nur klar erkennbare wiederkehrende Verpflichtungen
  oder besonders wichtige Zahlungen.
- contract nur verwenden, wenn wirklich ein Vertrag oder eine
  Vertragsaenderung vorliegt.
- Zahlungsdatum, Zahlungstag, Konto, Laufzeit und Restschuld
  extrahieren, wenn vorhanden.
- Bei Energievertraegen Preise, Abschlag, Laufzeit und
  Kuendigungsinformationen in contract.details aufnehmen.
- Bei Krediten Kreditgeber, Ursprungssumme, Restschuld, Rate,
  Zinssatz, Laufzeit und Zahlungsinformationen aufnehmen.
- Bei Arbeitsunterlagen Arbeitgeber, Brutto/Netto,
  Wochenstunden, Urlaub und relevante Vertragsdaten aufnehmen.
- Widerspruechliche OCR-Stellen nicht erraten; stattdessen null und
  einen niedrigeren Confidence-Wert verwenden.
- Keine Information aus allgemeinem Wissen ergaenzen.
{compact_hint}"""

        payload = {
            "model": self.model,
            "stream": False,
            "format": (
                COMPACT_ANALYSIS_SCHEMA
                if compact
                else ANALYSIS_SCHEMA
            ),
            "think": False,
            "messages": [
                {
                    "role": "system",
                    "content": system,
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            "options": {
                "temperature": 0,
                "num_ctx": self.num_ctx,
                "num_predict": (
                    num_predict
                    if num_predict is not None
                    else self.num_predict
                ),
            },
            "keep_alive": "30m",
        }

        try:
            response = self.session.post(
                f"{self.base_url}/api/chat",
                json=payload,
                timeout=timeout or self.timeout,
            )
            response.raise_for_status()

            body = response.json()

            message = body.get("message") or {}
            content_value = message.get("content")

            if not content_value:
                raise OllamaError(
                    "Ollama lieferte keinen Antwortinhalt"
                )

            try:
                return parse_json_response(str(content_value))
            except OllamaError as exc:
                if body.get("done_reason") == "length":
                    raise OllamaError(
                        "Ollama-Ausgabe wurde am Tokenlimit abgeschnitten"
                    ) from exc
                raise

        except OllamaError:
            raise
        except requests.Timeout as exc:
            raise OllamaError(
                "Ollama-Analyse Zeitlimit erreicht"
            ) from exc
        except requests.RequestException as exc:
            raise OllamaError(
                f"Ollama-Analyse fehlgeschlagen: {exc}"
            ) from exc
        except (KeyError, ValueError, TypeError) as exc:
            raise OllamaError(
                f"Ollama-Antwort ungueltig: {exc}"
            ) from exc

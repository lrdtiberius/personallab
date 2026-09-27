# PersonalLab-Handbuch

Gültig für Version **2.7.2**. Der optionale Qwen-Scanner besitzt den Komponentenstand **2.2.0**.

## Architektur

PersonalLab besteht aus drei Diensten:

- `personal-lab-api` verwaltet `personallab.json`, synchronisiert Paperless und liefert Integrationen aus.
- `personal-lab-web` stellt die Oberfläche auf dem konfigurierten Host-Port bereit.
- `personal-lab-qwen-scanner` analysiert neue oder geänderte Dokumente über Ollama und übergibt geprüfte Vorschläge an die API.

Persistente Daten liegen unter `/DATA/AppData/personal-lab`. Zugangsdaten werden ausschließlich als Umgebungsvariablen übergeben und gehören nicht in das Repository.

## Dokumente und Navigation

Die linke Ablagestruktur kann beliebig tief verschachtelt werden. Dokumente lassen sich einzeln oder gesammelt zuordnen, deaktivieren und wieder einblenden. PersonalLab verändert dabei keine Dokumente in Paperless.

Die Dokumentansicht zeigt aufbereitete Titel, Inhaltsangaben, strukturierte Metadaten und die PDF-Vorschau. Manuelle Querverknüpfungen verbinden inhaltlich zusammengehörige Dokumente oder Verträge. Manuelle Angaben behalten Vorrang vor automatisch ermittelten Werten.

## Integrationen

Paperless liefert Dokumente und PDF-Inhalte. Der Digital-Akte-Analyzer kann Titel, Zusammenfassungen und strukturierte Fakten ergänzen. Eine Paperless-RAG-Instanz kann semantische Antworten und Quellen liefern. EnergyLab, FinanzLab und Home Assistant werden lesend eingebunden; persönliche Auswahl und Anordnung werden nur in PersonalLab gespeichert.

## Qwen-Scanner

Der Scanner verarbeitet Dokumente in konfigurierbaren Paketen. `processed-state.json`, Tracker und Statusdatei verhindern unnötige Mehrfachanalysen und ermöglichen die Fortsetzung nach einem Neustart. Die Analyse läuft gegen `OLLAMA_URL`; Standard ist ein Container mit dem Netzwerknamen `ollama`.

Wichtige Einstellungen:

| Variable | Zweck |
| --- | --- |
| `OLLAMA_URL` | erreichbare Ollama-Adresse |
| `QWEN_SHADOW_MODEL` | verwendetes Modell, standardmäßig `qwen3:4b` |
| `QWEN_SCANNER_INTERVAL_SECONDS` | Prüfintervall |
| `QWEN_SCANNER_BATCH_SIZE` | Dokumente je Lauf |
| `QWEN_SCANNER_APPLY` | `1` übernimmt geprüfte Änderungen über die API |
| `QWEN_RELEVANT_FROM` | frühestes relevantes Dokumentdatum |

Der Scanner schreibt nicht unkontrolliert direkt in Paperless. Änderungen an PersonalLab werden revisionsbezogen über die API angewandt.

## Installation und Update

Die benötigten Werte werden in einer lokalen `.env` hinterlegt. Danach:

```bash
docker compose build
docker compose up -d
```

Vor einem Update muss `/DATA/AppData/personal-lab` extern gesichert werden. Nach dem Start sollten API, Web und Scanner als `healthy` erscheinen; `/api/health` muss Version `2.7.2` melden.

## Bekannte Grenzen

- Die Images enthalten keine Paperless-, Home-Assistant-, FinanzLab- oder EnergyLab-Zugangsdaten.
- Ollama muss aus dem Scanner-Container erreichbar sein; `localhost` bezeichnet den Scanner selbst.
- Automatische Klassifikation bleibt eine Heuristik. Wichtige Vertrags-, Steuer- und Personaldaten sollten in der Oberfläche kontrolliert werden.
- PersonalLab ist für ein vertrauenswürdiges lokales Netzwerk gedacht und sollte nicht ungeschützt veröffentlicht werden.

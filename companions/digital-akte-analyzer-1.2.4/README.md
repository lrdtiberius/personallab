# Digital-Akte-Analyzer 1.2.4 – bessere KI-Texte für PersonalLab

Diese kleine, offline baubare Erweiterung verwendet das vorhandene Image
`digital-akte-analyzer:1.2.2` als Basis. Datenbank, Paperless-Dokumente und
das bestehende Ollama-Modell `qwen3:4b` bleiben unverändert.

Zusätzlich liefert `/api/documents` nun die bereits von Ollama erzeugten Felder:

- `short_title`
- `summary`
- `keywords`
- `category`
- einen kompakten `search_text` aus der strukturierten Analyse

Damit kann PersonalLab den KI-Titel und die KI-Beschreibung verwenden. Das
Originaldokument und sämtliche Paperless-Daten bleiben unverändert.

Version 1.2.4 verbessert zusätzlich den Ollama-Prompt für natürliche,
inhaltliche Beschreibungen. Alte Ergebnisse werden als noch zu verbessern
markiert, aber nicht gelöscht. Über die Analyzer-Oberfläche können sie mit
„25 neue oder alte KI-Texte verbessern“ kontrolliert in kleinen Paketen
erneuert werden. Eine einzelne Paperless-ID lässt sich gezielt neu analysieren.

Build:

```sh
docker build -t digital-akte-analyzer:1.2.4 .
```

Danach im bestehenden Analyzer-Stack nur das Image auf
`digital-akte-analyzer:1.2.4` ändern und den Container neu erstellen. Volumes,
Umgebungsvariablen und Datenbank bleiben unverändert.

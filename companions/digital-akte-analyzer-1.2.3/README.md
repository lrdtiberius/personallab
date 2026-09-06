# Digital-Akte-Analyzer 1.2.3 – PersonalLab-Erweiterung

Diese kleine, offline baubare Erweiterung verwendet das vorhandene Image
`digital-akte-analyzer:1.2.2` als Basis. Sie ändert weder Datenbank noch
Analysemodell und startet keine Neuanalyse.

Zusätzlich liefert `/api/documents` nun die bereits von Ollama erzeugten Felder:

- `short_title`
- `summary`
- `keywords`
- `category`
- einen kompakten `search_text` aus der strukturierten Analyse

Damit kann PersonalLab den KI-Titel und die KI-Beschreibung verwenden. Das
Originaldokument und sämtliche Paperless-Daten bleiben unverändert.

Build:

```sh
docker build -t digital-akte-analyzer:1.2.3 .
```

Danach im bestehenden Analyzer-Stack nur das Image auf
`digital-akte-analyzer:1.2.3` ändern und den Container neu erstellen. Volumes,
Umgebungsvariablen und Datenbank bleiben unverändert.

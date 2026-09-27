# Changelog

## 2.7.2

- API- und Webquellen mit dem geprüften Produktionsstand vom 23. September 2026 synchronisiert
- manuelle Querverknüpfungen und Zielauswahl in der Dokumentoberfläche ergänzt
- Dokumentdarstellung, Gruppenlogik und Metadatenaufbereitung aktualisiert
- `metadata.mjs` als eigener API-Baustein ergänzt
- Qwen-Scanner 2.2.0 einschließlich persistentem Verarbeitungsstatus, Wiederholschutz, Apply-/Commit-Schritten und Navigationstaxonomie aufgenommen
- Compose- und Build-Dateien auf API/Web 2.7.2 sowie Scanner 2.2.0 aktualisiert
- private AM06-Adresse aus dem veröffentlichten Scanner-Standard entfernt; `OLLAMA_URL` ist konfigurierbar und verwendet standardmäßig `http://ollama:11434`
- produktive Web-Abhängigkeiten auf fehlerbereinigte Versionen von Next.js 16.3.6 und React 19.3.0 aktualisiert; die kritische `npm audit`-Meldung ist damit behoben
- Vite, Cloudflare-Plugin, Wrangler und ESLint-Konfiguration auf kompatible aktuelle Stände angehoben

## 2.5.11

- Abwasser als eigener Energiebereich mit getrennten Verträgen, Zahlungen und Kosten ergänzt
- Wasser und Abwasser verwenden denselben Messwert, bleiben kaufmännisch jedoch getrennt

Ältere Änderungen sind weiterhin im Versionsabschnitt der README dokumentiert.

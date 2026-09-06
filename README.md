# PersonalLab 2.5.11

## Neu in 2.5.11

- eigener Energiepunkt `Abwasser` mit Übersicht, Vertrag, Zahlungen, Kosten, Historie und Zählerständen aus EnergieLab 0.6.6
- Wasser und Abwasser zeigen denselben Wasserzähler, behalten aber getrennte Anbieter, Tarife, Grundpreise und Zahlungen
- vorhandene `personallab.json`-Dateien werden beim Update ergänzt; eigene Ablagestruktur, Zuordnungen und Dokumente bleiben erhalten
- das Build-Paket verändert weder EnergieLab noch den Analyzer, sondern aktualisiert ausschließlich PersonalLab

## Neu in 2.5.10

- die Suche beginnt erst nach Enter oder einem Klick auf `Suchen`; während der Eingabe werden weder die Dokumentliste neu berechnet noch Anfragen an Ollama gesendet
- bei verbundener Paperless KI-Suche übernimmt PersonalLab deren Antwort, Quellenreihenfolge und Textausschnitte direkt statt sie mit schwächeren lokalen Treffern zu vermischen
- die lokale Suche wird nur noch verwendet, wenn kein RAG-Container konfiguriert ist oder dieser nicht erreichbar ist
- Digital-Akte-Analyzer 1.2.4 erzeugt mit `qwen3:4b` konkretere, natürlich formulierte Titel und Inhaltsangaben ohne Seitennummern, OCR-Fragmente oder bloße Standardfloskeln
- vorhandene Analyzer-Ergebnisse bleiben erhalten und können kontrolliert in Paketen zu je 25 Dokumenten mit dem verbesserten Prompt erneuert werden
- ein bereits vorhandenes EnergieLab 0.5.0 wird vom Build-Skript erkannt und nicht auf die enthaltene Rückfallversion 0.4.5 zurückgestuft

## Neu in 2.5.9

- der bereits lokal von Ollama erzeugte `short_title` wird jetzt aus dem Digital-Akte-Analyzer übernommen und vor regelbasierten Ersatznamen angezeigt
- die KI-Zusammenfassung des Analyzers hat Vorrang; die OCR-Rechnungslogik aus 2.5.8 bleibt als zuverlässige Rückfallebene erhalten
- Analyzer-Schlagwörter, Kategorie und strukturierte Fakten fließen zusätzlich in die schnelle lokale Suche ein
- der vorhandene Container `paperless-rag-webui:3.0.4` kann über `PAPERLESS_RAG_URL` für semantische Qdrant-/Ollama-Suche angebunden werden
- Treffer aus dem vollständigen Dokumentinhalt werden mit lokalen Titel- und Metadatentreffern zusammengeführt; bei Ausfall des RAG-Dienstes funktioniert die lokale Suche weiter
- die enthaltene Analyzer-Erweiterung 1.2.3 legt keine neue Datenbank an und startet keine Neuanalyse, sondern macht die bereits gespeicherten Ollama-Ergebnisse für PersonalLab lesbar

## Neu in 2.5.8

- neue Rechnungen erhalten automatisch einen PersonalLab-Titel aus Dokumenttyp, Händler und Gegenstand statt nur den Paperless-Titel anzuzeigen
- der nur lesend abgerufene Paperless-OCR-Text liefert dafür Rechnungssteller, Rechnungsnummer, Gesamtbetrag und echtes Rechnungsdatum
- die Kurzbeschreibung fasst diese Angaben verständlich zusammen, zum Beispiel `Rechnung RE923362 von Janado über 669,90 € für Roborock Qrevo Curv2 ProX`
- der vollständige OCR-Text wird nicht in der PersonalLab-Datendatei gespeichert
- manuell in PersonalLab vergebene Titel und Metadaten behalten weiterhin Vorrang

## Neu in 2.5.7

- geöffnete Dokumente lassen sich im Bearbeitungsmodus ausschließlich in PersonalLab deaktivieren
- deaktivierte Dokumente verschwinden aus allen PersonalLab-Listen und bleiben vollständig in Paperless erhalten
- unter `Einstellungen → Deaktivierte Dokumente` lassen sich einzelne Dokumente jederzeit wieder einblenden
- ein Paperless-Abgleich oder noch laufendes automatisches Speichern kann deaktivierte Dokumente nicht versehentlich wieder aktivieren
- Paperless, FinanzLab, EnergieLab und Home Assistant bleiben vollständig nur lesend

> **Wichtig:** Version 2.5.7 ersetzt die zurückgezogene Version 2.5.6. Bitte 2.5.6 nicht installieren; dort war das Entfernen eines Dokuments fälschlich als Löschung in Paperless umgesetzt.

## Neu in 2.5.5

- FinanzLab-Kennzahlen wie Kontostände, offene Kredite, Einnahmen, Ausgaben, Überschuss und Dispo-Warnungen lassen sich einzeln an- oder abwählen und anordnen
- auch die FinanzLab-Ansichten `Kontostände`, `Offene Kredite` und `Raten` sind je Ablagepunkt frei auswählbar
- Kennzahlen, Ansichten und einzelne Konten werden gemeinsam über `FinanzLab-Daten auswählen` gepflegt
- EnergieLab bietet im selben Prinzip alle gelieferten Kennzahlen sowie `Übersicht`, `Verträge`, `Abschläge`, `Historie` und `Zählerstände` zur Auswahl an
- für Photovoltaik erscheinen zusätzlich die von EnergieLab gelieferten monatlichen und jährlichen Ersparnisse
- jede Auswahl wird ausschließlich in PersonalLab gespeichert; FinanzLab und EnergieLab bleiben unverändert und nur lesend

## Neu in 2.5.4

- direkt bei `Strom`, `Wasser`, `Abwasser`, `Gas` oder `Photovoltaik` lassen sich die von EnergieLab gelieferten Kennzahlen auswählen
- der `Aktuelle Zählerstand` aus EnergieLab steht mit Wert, Einheit und Datum als eigene auswählbare Kachel bereit
- zusätzlich können Verbrauch, Kosten, Abschläge, Hochrechnung und Datenqualität an- oder abgewählt werden, sofern EnergieLab diese Werte liefert
- die Reihenfolge der Energiekacheln lässt sich im selben Dialog festlegen
- jede Energieart besitzt eine eigene dauerhaft gespeicherte Auswahl

## Neu in 2.5.3

- EnergieLab-Anbieter lassen sich je Eintrag der linken Energieleiste auswählen, abwählen und anordnen
- `Strom → Vattenfall` zeigt bei Verträgen und Abschlägen nur die Vattenfall-Daten aus EnergieLab
- tiefere Einträge wie `Strom → Vattenfall → Verträge` öffnen direkt die passende EnergieLab-Ansicht
- passende Anbieter werden beim ersten Öffnen automatisch am Namen erkannt; die manuelle Auswahl wird dauerhaft in PersonalLab gespeichert
- Verbrauch, Historie und Zählerstände bleiben sichtbar als gemeinsame Messwerte des jeweiligen Segments, da EnergieLab sie nicht pro Anbieter führt

## Neu in 2.5.2

- wird links eine Bank wie `Sparkasse` ausgewählt, erscheinen rechts nur noch die ihr zugeordneten FinanzLab-Konten
- im Bearbeitungsmodus lassen sich Konten je Bank über `Konten auswählen` hinzufügen und abwählen
- die Reihenfolge der Kontokarten kann im selben Dialog mit den Pfeiltasten festgelegt werden
- beim ersten Öffnen erkennt PersonalLab passende Konten automatisch am Banknamen; eine manuelle Auswahl überschreibt diese Erkennung dauerhaft
- die Zuordnung wird ausschließlich in PersonalLab gespeichert und verändert keine Daten in FinanzLab

## Neu in 2.5.1

- die Konten- und Ablageleiste lässt sich jetzt zuverlässig über einen eigenen Dialog bearbeiten
- Namen und Beschreibungen können direkt geändert werden, ohne Browser-Pop-up
- Einträge lassen sich innerhalb ihrer Ebene nach oben oder unten verschieben
- neue Unterpunkte werden über denselben Dialog angelegt
- beim Umbenennen älterer Einträge bleibt die vorhandene Dokumentzuordnung erhalten

## Neu in 2.5.0

- Dokumente lassen sich beim Bearbeiten über beliebig viele vorhandene Ebenen zuordnen; Ebene 3, 4, 5 usw. erscheinen automatisch
- dieselbe vollständige Tiefenauswahl steht bei der Sammelzuordnung mehrerer Dokumente bereit
- die Suche arbeitet jetzt immer bereichsübergreifend über die gesamte Ablage
- KI-Zusammenfassungen des bereits verbundenen Digital-Akte-Analyzers fließen direkt in die Suchergebnisse ein
- ähnliche Begriffe wie `Auto`/`Kfz`, `Lohn`/`Gehalt` sowie kleine Tippfehler werden berücksichtigt
- die Suche zeigt sichtbar an, ob die Analyzer-Inhalte verbunden sind, und funktioniert andernfalls zuverlässig lokal weiter

## Neu in 2.4.0

- verständliche Anzeigenamen aus Dokumenttyp, Inhaltsanalyse und Zeitraum statt generischer Scan- oder Nummernnamen
- lange interne Nummern werden im Anzeigenamen ausgeblendet; der unveränderte Originaltitel bleibt in den Dokumentdetails sichtbar
- kurze Inhaltsangabe direkt unter jedem Dokumentnamen und ausführlicher im PDF-Arbeitsbereich
- kompakte Bezeichnungen wie „Dokumenttyp offen“ statt technischer Paperless-Platzhalter
- Datumsreihenfolge in jeder Dokumentliste zwischen „neueste zuerst“ und „älteste zuerst“ umschaltbar
- die gewählte Sortierung bleibt beim Wechsel zwischen Bereichen erhalten

## Neu in 2.3.0

- jeder Eintrag in der linken Ablageliste öffnet zuverlässig den passenden Bereich
- der aktive Ablagepunkt bleibt in der Seitenleiste sichtbar markiert
- doppelte Bereichs- und Unterbereichskacheln im Arbeitsbereich wurden entfernt
- rechts erscheinen direkt die Dokumente des gewählten Ablagepunkts
- kompakte Jahresauswahl oberhalb der Dokumentliste statt zusätzlicher Jahreskacheln
- ein Dokument öffnet sich direkt als große PDF-Vorschau mit den wichtigsten Metadaten daneben
- über „Zur Dokumentliste“ gelangt man in dieselbe Auswahl und dasselbe Jahr zurück

## Neu in 2.2.0

- automatische Jahresebene innerhalb einer Dokumentart, zum Beispiel `Arbeit → Thomaflor GmbH → Gehaltsabrechnung → 2021`
- Kacheln in `Arbeit & Beruf` entsprechen exakt der linken Ablageliste – mit identischer Reihenfolge, Hierarchie und Dokumentanzahl
- Jahre werden aus dem Abrechnungszeitraum im Dokumentnamen ermittelt; das spätere Importdatum verfälscht die Ablage nicht
- besser lesbare Dokumentnamen wie `Gehaltsabrechnung · Juni 2024` und `Kontoauszug · Juli 2026 · Sparkasse`
- ursprüngliche Paperless-Titel bleiben unverändert erhalten und werden bei Bedarf als Originaltitel angezeigt
- Dokumentensuche berücksichtigt sowohl den lesbaren Namen als auch den ursprünglichen Dateinamen

## Enthalten seit 2.1.0

- FinanzLab- und EnergieLab-Import erscheinen standardmäßig oben
- komplette Seitenbereiche statt einzelner Kennzahlen frei anordnen
- Import, Unterbereiche/Anbieter und Dokumente per Drag-and-drop oder Pfeiltasten verschieben
- komplette Seitenbereiche ein- oder ausblenden
- kompakte Dokumentensuche oben statt einer großen Suchleiste im Inhalt
- alle Seiteneinstellungen werden dauerhaft in `personallab.json` gespeichert

## Enthalten seit 2.0.0

- dauerhaft sichtbare, aufklappbare Ablageliste links
- vollständige Anzeige vorhandener mehrstufiger Hierarchien
- Dokumente einzeln oder gesammelt per Drag-and-drop neu zuordnen
- direkte Rückgängig-Funktion nach jeder Verschiebung
- Liste bearbeiten: Einträge umbenennen, Unterpunkte ergänzen oder leere Punkte löschen
- Vertragsdaten mit Beginn, Ende, Kündigungsfrist, Verlängerung und Vertragsnummer
- automatische Statusberechnung für aktive, bald auslaufende und inaktive Verträge
- ausgelaufene Verträge werden grau und mit „Inaktiv“ gekennzeichnet
- Filter für aktive, bald auslaufende und inaktive Verträge
- vorhandene PersonalLab-Struktur wird beim Update unverändert übernommen statt mit Standardkacheln vermischt
- manuelle und zur Prüfung markierte Zuordnungen bleiben beim Paperless-Abgleich geschützt
- alte rein numerische Paperless-Untergruppen werden automatisch in lesbare Korrespondentennamen umgewandelt
- eigenständige hellgraue Arbeitsfläche statt der bisherigen beigefarbenen Darstellung

PersonalLab ist eine lokale, bearbeitbare Dokumentenzentrale für Paperless-NGX, EnergieLab, FinanzLab und Home Assistant. Die linke Ablageliste bildet die vollständige Navigation; rechts werden ohne doppelte Zwischenkacheln Dokumentlisten, Jahresauswahl, PDF-Vorschau und eingebettete Live-Daten angezeigt.

## Funktionen

- interaktive Bereichs- und Unterbereichskacheln
- eigener Bereich `Arbeit` mit Verträgen, Gehaltsabrechnungen, Steuerbescheinigungen, Arbeitsunfähigkeit, Zeugnissen und Arbeitgeber-Schriftverkehr
- Gesundheitsakte mit Befunden, Arztbriefen, Diagnosen, Therapie, Hilfsmitteln und Schwerbehinderung
- eigener Hauptbereich `Energie` mit Strom, Gas, Wasser, Abwasser und Photovoltaik
- EnergieLab-Liveansichten für Übersicht, Verträge, Abschläge, Historie und Zählerstände
- FinanzLab-Liveansichten für Kontostände, offene Kredite und kommende Raten
- globales Suchen und Filtern
- Dokumentdetails mit direktem Link zum Original in Paperless
- Bearbeitungsmodus für neue, umbenannte, gefärbte, verschobene und gelöschte Kacheln
- Einzel- und Mehrfachzuordnung von Dokumenten
- direktes Drag-and-drop auf Ziele in der linken Ablageliste
- Vertragsstatus und Laufzeitüberwachung
- lokale Titel-, Korrespondenten- und Dokumenttyp-Anpassungen
- automatischer Paperless-Abgleich mit erster regelbasierter Zuordnung neuer Dokumente
- auswählbare, nur lesende Home-Assistant-Sensorkacheln
- persistente Konfiguration in `/DATA/AppData/personal-lab/personallab.json`

PersonalLab verändert weder Paperless noch EnergieLab oder FinanzLab. Eigene Dokumentnamen und Zuordnungen werden ausschließlich in der PersonalLab-Datendatei gespeichert. Die Fachanbindungen sind nur lesend. EnergieLab 0.6.6 liefert über `/api/personallab` exakt die bereits im EnergieLab berechneten Dashboardwerte; PersonalLab rechnet Kosten, Abschläge, Erstattungen und Nachzahlungen nicht selbst aus. Für Abwasser übernimmt EnergieLab die Messreihe des Wasserzählers, berechnet Vertrag, Preis und Zahlungen jedoch getrennt.

Der Digital-Akte-Analyzer 1.2.4 wird über `ANALYZER_URL` nur lesend angebunden. PersonalLab verbindet dessen Ergebnisse anhand der Paperless-ID mit dem Originaldokument. KI-Titel, Zusammenfassung, Dokumentart, Schlagwörter, Kategorie und strukturierte Suchdaten ergänzen dabei Paperless-Tags, Dokumentart und Korrespondent. Manuelle PersonalLab-Metadaten und Zuordnungen werden nie automatisch überschrieben.

Für die Suche kann zusätzlich der bereits vorhandene Container `paperless-rag-webui:3.0.4` über `PAPERLESS_RAG_URL` angebunden werden. Erst nach der ausdrücklichen Bestätigung mit Enter oder `Suchen` sendet PersonalLab die fertige Frage an dessen `/api/ask`-Schnittstelle. Antwort, Reihenfolge, Textausschnitte und Paperless-IDs der Quellen werden direkt übernommen. Qdrant, Ollama und Paperless bleiben unverändert.

## Voraussetzungen

- ZimaOS oder ein anderer Docker-Host
- Paperless-NGX mit API-Token
- EnergieLab 0.6.6
- Digital-Akte-Analyzer 1.2.2 als vorhandenes Basisimage; die enthaltene Erweiterung baut daraus 1.2.4
- optional `paperless-rag-webui:3.0.4` aus `images.tar` für semantische Inhaltssuche
- FinanzLab 0.13.4
- optional Home Assistant mit langlebigem Zugriffstoken
- Portainer oder Docker Compose

## 1. Konfiguration vorbereiten

Das Paket nach `/DATA/AppData/personal-lab-stack` entpacken:

```bash
mkdir -p /DATA/AppData/personal-lab
chown 10001:10001 /DATA/AppData/personal-lab
cd /DATA/AppData/personal-lab-stack
cp .env.example .env
nano .env
```

In `.env` mindestens eintragen:

```dotenv
PERSONALLAB_BIND_ADDRESS=0.0.0.0
PAPERLESS_URL=http://DEIN-SERVER:8001
PAPERLESS_TOKEN=DEIN_PAPERLESS_API_TOKEN
```

Für KI-Titel und semantische Suche zusätzlich die bereits laufenden lokalen Dienste eintragen:

```dotenv
ANALYZER_URL=http://DEIN-SERVER:8093
PAPERLESS_RAG_URL=http://ADRESSE-DES-RAG-CONTAINERS
```

`PAPERLESS_RAG_URL` ist die Adresse, unter der die Oberfläche des Containers
`paperless-rag-webui:3.0.4` erreichbar ist. Bleibt sie leer, arbeitet die lokale
PersonalLab-Suche weiterhin mit Titel, Metadaten und Analyzer-Inhalten.

Für Home Assistant zusätzlich:

```dotenv
HOME_ASSISTANT_URL=http://homeassistant.local:8123
HOME_ASSISTANT_TOKEN=DEIN_LANGZEIT_TOKEN
```

Wenn Home Assistant zunächst nicht genutzt werden soll, bleiben URL und Token leer.

Die beiden Fachanwendungen werden über ihre lokalen Adressen angebunden:

```dotenv
ENERGYLAB_URL=http://DEIN-SERVER:8090
FINANZLAB_URL=http://DEIN-SERVER:8798
FINANZLAB_HOUSEHOLD_ID=
```

Eine leere `FINANZLAB_HOUSEHOLD_ID` verwendet automatisch den ersten angelegten Haushalt.

## 2. Images lokal bauen

```bash
cd /DATA/AppData/personal-lab-stack
bash ./build-images.sh
```

Bei einer bestehenden, per Docker Compose angelegten Installation genügt nach
dem Ersetzen der Projektdateien:

```bash
cd /DATA/AppData/personal-lab-stack
chmod +x update.sh build-images.sh build-and-export.sh
./update.sh
```

`update.sh` sichert zuerst `/DATA/AppData/personal-lab/personallab.json`, baut
beide PersonalLab-Images und erstellt die Container anhand der vorhandenen
`.env` und `compose.yaml` neu. Deshalb muss der in Portainer als `Limited`
angezeigte Stack nicht dort bearbeitet oder entsperrt werden.

Erwartete Images:

```text
personal-lab-api:2.5.11
personal-lab-web:2.5.11
```

## 3. EnergieLab-Verbindung prüfen

Für den getrennten Abwasserbereich wird EnergieLab 0.6.6 benötigt. Das
PersonalLab-Build-Skript verändert EnergieLab nicht. Die gelieferten Verbrauchs-,
Kosten- und Zahlungswerte stammen direkt aus der nur lesenden EnergieLab-Schnittstelle.

Die Schnittstelle lässt sich danach prüfen mit:

```bash
curl -fsS http://DEIN-SERVER:8090/api/personallab
```

## 4. PersonalLab starten

```bash
docker compose --env-file .env -f compose.yaml up -d
```

Danach ist PersonalLab standardmäßig erreichbar unter:

```text
http://DEIN-SERVER:8094
```

## Portainer

Alternativ den Inhalt von `compose.yaml` als neuen Stack `personal-lab` einfügen. Unter **Environment variables** dieselben Werte wie aus `.env` hinterlegen. Da die Images lokal gebaut werden, beim Aktualisieren **Re-pull image** nicht aktivieren.

Der veröffentlichte Web-Port wird bewusst an die in `.env` konfigurierte LAN-Adresse gebunden. Die interne API besitzt keinen Host-Port. Dadurch ist PersonalLab nicht über andere Netzwerkschnittstellen des Servers veröffentlicht.

## Bedienung

1. Links einen Bereich aufklappen und das gewünschte Ziel öffnen.
2. Innerhalb einer Dokumentart das gewünschte Jahr auswählen. Die Jahresebene entsteht automatisch aus den vorhandenen Dokumenten.
3. Ein Dokument anklicken, um es direkt rechts als PDF zu lesen; die Metadaten stehen daneben.
4. Zum schnellen Umsortieren ein Dokument direkt auf ein Ziel in der linken Liste ziehen.
5. Für mehrere Dokumente **Bearbeiten** aktivieren, Dokumente markieren und die Auswahl gemeinsam ziehen.
6. Nach einer Verschiebung kann unten sofort **Rückgängig** gewählt werden.
7. Mit **Liste bearbeiten** lassen sich Ablagepunkte über den Stift umbenennen, beschreiben und verschieben. Über **+** werden Unterpunkte ergänzt; leere Punkte können gelöscht werden.
8. Zum Ausblenden eines Dokuments **Bearbeiten** aktivieren, das Dokument öffnen und **In PersonalLab deaktivieren** wählen. Paperless bleibt dabei unverändert. Unter **Einstellungen → Deaktivierte Dokumente** kann das Dokument jederzeit wieder eingeblendet werden.

Vertragsdaten werden im Dokumentdetail bearbeitet. Ist ein Vertragsende hinterlegt, berechnet PersonalLab den Status automatisch. Ein abgelaufener Vertrag ohne automatische Verlängerung erscheint grau als **Inaktiv**. Bei automatischer Verlängerung wird der Status nicht vorschnell auf inaktiv gesetzt, sondern zur Prüfung markiert. Der Status kann jederzeit manuell überschrieben werden.

## Update von 1.x

Der bestehende Datenordner `/DATA/AppData/personal-lab` bleibt unverändert eingebunden. PersonalLab 2.5.11 übernimmt die vorhandene `personallab.json`, ergänzt den fehlenden Energiepunkt `Abwasser` direkt hinter `Wasser` sowie fehlende interne Zielverweise, Seiteneinstellungen und Auswahlen. Die vorhandene Hierarchie, Dokumente und eigenen Zuordnungen bleiben erhalten. Lokal deaktivierte Dokumente werden in derselben Datei gespeichert und bei weiteren Paperless-Abgleichen ausgeblendet. Vor dem Update wird dennoch eine Sicherung der Datei empfohlen.

Im Bereich **Energie** führt die Auswahl **Strom**, **Wasser**, **Abwasser**, **Gas** oder **Photovoltaik** zu den eingebetteten Ansichten **Übersicht**, **Verträge**, **Abschläge**, **Historie** und **Zählerstände**. Wasser und Abwasser greifen auf denselben Zählerstand zu; die finanziellen Angaben stammen jeweils aus dem eigenen EnergieLab-Vertrag. Unter **Kredite & Finanzen → Konten** stehen die FinanzLab-Ansichten **Kontostände**, **Offene Kredite** und **Raten** bereit.

Neue Paperless-Dokumente werden beim Start und danach standardmäßig alle 15 Minuten eingelesen. Der Knopf **Jetzt abgleichen** startet den Vorgang sofort. Regelbasierte Erstzuordnungen können jederzeit manuell überschrieben werden.

## Home Assistant

Unter **Home Assistant** auf **Sensor auswählen** klicken. PersonalLab zeigt nur die ausgewählten Entitäten an und verwendet ausschließlich lesende API-Aufrufe. Lichter, Geräte und Automationen werden nicht verändert.

## Status und Protokolle

```bash
docker compose --env-file .env -f compose.yaml ps
docker logs -f personal-lab-api
docker logs -f personal-lab-web
curl -fsS http://DEIN-SERVER:8094/api/health
```

## Sicherung

Für eine vollständige Sicherung der PersonalLab-Struktur genügt:

```text
/DATA/AppData/personal-lab/personallab.json
```

Die eigentlichen Dokumentdateien verbleiben in Paperless-NGX und gehören weiterhin in dessen normale Sicherung.

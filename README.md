# PersonalLab 1.5.0

PersonalLab ist eine lokale, bearbeitbare Dokumentenzentrale für Paperless-NGX, EnergieLab, FinanzLab und Home Assistant. Die Oberfläche orientiert sich an einem Microsoft-Dynamics-Role-Center: erst einen Aktenbereich öffnen, dann eine Unterkachel wählen, anschließend Dokumente und eingebettete Live-Daten sehen.

## Funktionen

- interaktive Bereichs- und Unterbereichskacheln
- eigener Bereich `Arbeit` mit Verträgen, Gehaltsabrechnungen, Steuerbescheinigungen, Arbeitsunfähigkeit, Zeugnissen und Arbeitgeber-Schriftverkehr
- Gesundheitsakte mit Befunden, Arztbriefen, Diagnosen, Therapie, Hilfsmitteln und Schwerbehinderung
- eigener Hauptbereich `Energie` mit Strom, Wasser, Gas und Photovoltaik
- EnergieLab-Liveansichten für Übersicht, Verträge, Abschläge, Historie und Zählerstände
- FinanzLab-Liveansichten für Kontostände, offene Kredite und kommende Raten
- globales Suchen und Filtern
- Dokumentdetails mit direktem Link zum Original in Paperless
- Bearbeitungsmodus für neue, umbenannte, gefärbte, verschobene und gelöschte Kacheln
- Einzel- und Mehrfachzuordnung von Dokumenten
- lokale Titel-, Korrespondenten- und Dokumenttyp-Anpassungen
- automatischer Paperless-Abgleich mit erster regelbasierter Zuordnung neuer Dokumente
- auswählbare, nur lesende Home-Assistant-Sensorkacheln
- persistente Konfiguration in `/DATA/AppData/personal-lab/personallab.json`

PersonalLab verändert weder Paperless noch EnergieLab oder FinanzLab. Eigene Dokumentnamen und Zuordnungen werden ausschließlich in der PersonalLab-Datendatei gespeichert. Die Fachanbindungen sind nur lesend. EnergieLab 0.4.5 liefert über `/api/personallab` exakt die bereits im EnergieLab berechneten Dashboardwerte; PersonalLab rechnet Kosten, Abschläge, Erstattungen und Nachzahlungen nicht selbst aus.

Der Digital-Akte-Analyzer 1.2.2 wird über `ANALYZER_URL` nur lesend angebunden. PersonalLab verbindet dessen Ergebnisse anhand der Paperless-ID mit dem Originaldokument. Analyzer-Dokumentart, Zusammenfassung und Konfidenz ergänzen dabei Paperless-Tags, Dokumentart und Korrespondent. Manuelle PersonalLab-Zuordnungen werden nie automatisch überschrieben.

## Voraussetzungen

- ZimaOS oder ein anderer Docker-Host
- Paperless-NGX mit API-Token
- EnergieLab 0.4.5 (im Paket enthalten)
- Digital-Akte-Analyzer 1.2.2 unter Port 8092
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
PERSONALLAB_BIND_ADDRESS=192.168.1.100
PAPERLESS_URL=http://192.168.1.100:8001
PAPERLESS_TOKEN=DEIN_PAPERLESS_API_TOKEN
```

Für Home Assistant zusätzlich:

```dotenv
HOME_ASSISTANT_URL=http://homeassistant.local:8123
HOME_ASSISTANT_TOKEN=DEIN_LANGZEIT_TOKEN
```

Wenn Home Assistant zunächst nicht genutzt werden soll, bleiben URL und Token leer.

Die beiden Fachanwendungen werden über ihre lokalen Adressen angebunden:

```dotenv
ENERGYLAB_URL=http://192.168.1.100:8090
FINANZLAB_URL=http://192.168.1.100:8798
FINANZLAB_HOUSEHOLD_ID=
```

Eine leere `FINANZLAB_HOUSEHOLD_ID` verwendet automatisch den ersten angelegten Haushalt.

## 2. Images lokal bauen

```bash
cd /DATA/AppData/personal-lab-stack
bash ./build-images.sh
```

Erwartete Images:

```text
energylab:0.4.5
personal-lab-api:1.5.0
personal-lab-web:1.5.0
```

## 3. EnergieLab aktualisieren

Im bestehenden EnergieLab-Stack nur das Image ändern:

```yaml
image: energylab:0.4.5
```

Anschließend den bestehenden EnergieLab-Stack ohne **Re-pull image** aktualisieren. Alle Volumes und sonstigen Einstellungen bleiben unverändert. Version 0.4.5 ergänzt lediglich die nur lesende PersonalLab-Schnittstelle. Die gelieferten Kostenwerte stammen direkt aus denselben EnergieLab-Funktionen wie das EnergieLab-Dashboard.

Die Schnittstelle lässt sich danach prüfen mit:

```bash
curl -fsS http://192.168.1.100:8090/api/personallab
```

## 4. PersonalLab starten

```bash
docker compose --env-file .env -f compose.yaml up -d
```

Danach ist PersonalLab standardmäßig erreichbar unter:

```text
http://192.168.1.100:8094
```

## Portainer

Alternativ den Inhalt von `compose.yaml` als neuen Stack `personal-lab` einfügen. Unter **Environment variables** dieselben Werte wie aus `.env` hinterlegen. Da die Images lokal gebaut werden, beim Aktualisieren **Re-pull image** nicht aktivieren.

Der veröffentlichte Web-Port wird bewusst an die in `.env` konfigurierte LAN-Adresse gebunden. Die interne API besitzt keinen Host-Port. Dadurch ist PersonalLab nicht über andere Netzwerkschnittstellen des Servers veröffentlicht.

## Bedienung

1. Auf der Übersicht eine Bereichskachel wie **Arbeit** öffnen.
2. Eine Unterkachel wie **Gehaltsabrechnungen** wählen.
3. Ein Dokument anklicken, um Details zu sehen oder es in Paperless zu öffnen.
4. Oben **Bearbeiten** aktivieren, um Kacheln oder Dokumentzuordnungen zu ändern.
5. In der Dokumentenansicht mehrere Zeilen markieren und **Neu zuordnen** wählen.

Im Bereich **Energie** führt die Auswahl **Strom**, **Wasser**, **Gas** oder **Photovoltaik** zu den eingebetteten Ansichten **Übersicht**, **Verträge**, **Abschläge**, **Historie** und **Zählerstände**. Unter **Kredite & Finanzen → Konten** stehen die FinanzLab-Ansichten **Kontostände**, **Offene Kredite** und **Raten** bereit.

Neue Paperless-Dokumente werden beim Start und danach standardmäßig alle 15 Minuten eingelesen. Der Knopf **Jetzt abgleichen** startet den Vorgang sofort. Regelbasierte Erstzuordnungen können jederzeit manuell überschrieben werden.

## Home Assistant

Unter **Home Assistant** auf **Sensor auswählen** klicken. PersonalLab zeigt nur die ausgewählten Entitäten an und verwendet ausschließlich lesende API-Aufrufe. Lichter, Geräte und Automationen werden nicht verändert.

## Status und Protokolle

```bash
docker compose --env-file .env -f compose.yaml ps
docker logs -f personal-lab-api
docker logs -f personal-lab-web
curl -fsS http://192.168.1.100:8094/api/health
```

## Sicherung

Für eine vollständige Sicherung der PersonalLab-Struktur genügt:

```text
/DATA/AppData/personal-lab/personallab.json
```

Die eigentlichen Dokumentdateien verbleiben in Paperless-NGX und gehören weiterhin in dessen normale Sicherung.

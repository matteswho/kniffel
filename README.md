# Kniffel – mobiler Spielbogen

Eine mobile Web-App (PWA) für das Würfelspiel **Kniffel**. Du rufst sie einfach
im Browser auf – kein Build, keine Installation, keine Abhängigkeiten.

## Funktionen

- **Mobiler Spielbogen** mit allen Standard-Feldern (oberer & unterer Teil).
- **Drei Spalten** – du verteilst deine Würfe auf drei parallele Spiele.
  Jede Spalte hat ihren eigenen Bonus.
- **Tipp-Knopf (💡)** – schlägt vor, wo du deinen aktuellen Wurf am besten
  einträgst, mit besonderem Fokus auf den **35-Punkte-Bonus** im oberen Teil.
- **Würfel** zum Antippen (Augen ändern) oder zufällig würfeln.
- **Geister-Vorschau**: leere Felder zeigen blass, wie viele Punkte der aktuelle
  Wurf dort bringen würde.
- **Dark Mode** und automatisches Speichern (localStorage).
- **Offline nutzbar** und zum Homescreen hinzufügbar (PWA / Service Worker).

## Bonus-Regel

Erreichst du im oberen Teil einer Spalte mindestens **63 Punkte**, gibt es
**35 Extrapunkte** (Bonus). 63 entspricht genau drei gleichen Augen pro Feld –
der Tipp bewertet jeden Eintrag danach, ob er über oder unter diesem Schnitt
liegt.

## So spielst du

1. Würfel oben antippen (oder „Würfeln") bis sie deinem echten Wurf entsprechen.
2. **💡 Tipp** drücken für eine Empfehlung – oder direkt ein Feld antippen.
3. Im Dialog „Würfel eintragen", „Streichen" oder einen eigenen Wert wählen.
4. Spalte frei wählbar – verteile clever auf alle drei.

## Lokal starten

Einfach `index.html` im Browser öffnen. Für die PWA-/Offline-Funktion über einen
kleinen Webserver ausliefern, z. B.:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 im Handy-Browser öffnen
```

## Dateien

| Datei                  | Zweck                                  |
|------------------------|----------------------------------------|
| `index.html`           | Aufbau der Seite                       |
| `styles.css`           | Dark-Mode-Layout, responsiv            |
| `app.js`               | Spiel-Logik, Scoring, Tipp-Engine      |
| `manifest.webmanifest` | PWA-Metadaten                          |
| `sw.js`                | Service Worker für Offline-Betrieb     |
| `icon.svg`             | App-Icon                               |

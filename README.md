# Kniffel – mobiler Spielbogen

Eine mobile Web-App (PWA) für das Würfelspiel **Kniffel**. Du rufst sie einfach
im Browser auf – kein Build, keine Installation, keine Abhängigkeiten.

## Funktionen

- **Mobiler Spielbogen** mit allen Standard-Feldern (oberer & unterer Teil).
- **Drei Spalten** – du verteilst deine Würfe auf drei parallele Spiele.
  Jede Spalte hat ihren eigenen Bonus.
- **Zwei Spielmodi** (⚙ Einstellungen):
  - *Digital* – die App würfelt: bis zu 3 Würfe pro Runde, Würfel **halten**,
    „Nochmal" würfelt nur die übrigen; nach dem Eintrag startet die nächste Runde.
  - *Manuell* – für eigene, echte Würfel: der digitale Würfelbereich verschwindet.
    Beim Klick auf eine Zelle wählst du dein Ergebnis: im oberen Teil tippst du
    die passenden Würfel an (Einser 1–5, Zweier 2–10, …), bei Pasch/Chance stellst
    du die 5 Augen ein, Full House/Straßen/Kniffel per „Geschafft / Streichen".
- **Geister-Vorschau**: leere Felder zeigen blass, wie viele Punkte der aktuelle
  Wurf dort bringen würde.
- **Dark Mode** und automatisches Speichern (localStorage).
- **Offline nutzbar** und zum Homescreen hinzufügbar (PWA / Service Worker).

## Bonus-Regel

Erreichst du im oberen Teil einer Spalte mindestens **63 Punkte**, gibt es
**35 Extrapunkte** (Bonus). 63 entspricht genau drei gleichen Augen pro Feld.

## So spielst du

1. **Würfeln** tippen (1. Wurf). Würfel antippen, die du behalten willst.
2. Bis zu zweimal **Nochmal** würfeln (max. 3 Würfe pro Runde).
3. Ein Feld antippen und im Dialog „Würfel eintragen", „Streichen" oder einen
   eigenen Wert wählen. Damit endet die Runde und der nächste Wurf startet
   automatisch.
4. Spalte frei wählbar – verteile clever auf alle drei.

## Mehrspieler-Version (V2)

Unter `multiplayer/` liegt eine zweite Version für **mehrere Handys**: Jede Person
spielt am eigenen Gerät, alle sehen die Punkte aller Mitspieler live.

- Der **Spielleiter** tippt auf „Spiel leiten", bekommt einen kurzen **Code** und
  fügt bei Bedarf Spieler hinzu.
- **Mitspieler** öffnen die Seite, wählen „Beitreten", geben Code + Namen ein.
- Gemeinsame Tabelle: **Zeilen = Felder, Spalten = Spieler**. Jedes Gerät bearbeitet
  nur die **eigene** Spalte, die anderen aktualisieren sich automatisch.
- **Reihum-Modus**: Die Spieler sind der Reihe nach dran. Nur die Spalte des Spielers,
  der **gerade am Zug** ist, lässt sich bearbeiten (▶ markiert, Banner „Du bist dran").
  Nach einem Eintrag wechselt der Zug automatisch zum nächsten Spieler.
- **Kein Überschreiben**: Ein einmal eingetragenes (oder gestrichenes) Feld ist
  gesperrt und kann nicht geändert werden. Sind alle Felder voll, zeigt die App den
  **Gewinner**.
- **Würfeln am Handy**: Jedes Gerät hat einen eigenen Würfelbereich (bis zu 3 Würfe,
  Würfel halten) wie in der Einzel-Version. Über ⚙ Einstellungen kann man auf den
  **manuellen Modus** (eigene, echte Würfel) umschalten.

Die Synchronisation läuft über **Firebase Realtime Database**: Der Spielstand liegt
zentral in der Datenbank, jedes Gerät liest/schreibt per Transaktion. Dadurch muss
**kein Gerät „Host" bleiben** – auch über Mobilfunk zuverlässig, kein WLAN-Zwang.

### Firebase einrichten (einmalig)

1. In der [Firebase-Konsole](https://console.firebase.google.com) im Projekt
   **Build → Realtime Database → Datenbank erstellen** (Region wählen, z. B.
   *europe-west1*).
2. Unter **Regeln** diese Regeln setzen und veröffentlichen:
   ```json
   {
     "rules": {
       "games": {
         "$code": { ".read": true, ".write": true }
       }
     }
   }
   ```
3. **⚙ Projekteinstellungen → Allgemein → Meine Apps** → Web-App (`</>`) anlegen
   und den `firebaseConfig`-Block kopieren.
4. Die Werte in `multiplayer/firebase-config.js` eintragen (besonders `databaseURL`).

Die Config (inkl. `apiKey`) darf im öffentlichen Code stehen – das sind bei Firebase
keine Geheimnisse; der Schutz erfolgt über die Datenbank-Regeln. Bei den offenen
Regeln oben könnte theoretisch jemand, der einen 5‑stelligen Code errät, mitlesen –
für ein lockeres Spiel unter Freunden ist das in Ordnung.

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
| `app.js`               | Spiel-Logik, Scoring, Rundenlogik      |
| `manifest.webmanifest` | PWA-Metadaten                          |
| `sw.js`                | Service Worker für Offline-Betrieb     |
| `icon.svg`             | App-Icon                               |

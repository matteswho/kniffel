/* ============================================================
   Firebase-Konfiguration für die Mehrspieler-Version.

   So füllst du diese Datei:
   1. Firebase-Konsole → dein Projekt → ⚙ Projekteinstellungen → „Allgemein"
      → Abschnitt „Meine Apps" → Web-App (</>) hinzufügen/auswählen.
   2. Den dort gezeigten `firebaseConfig`-Block hierher kopieren (die Werte
      unten ersetzen). Wichtig ist besonders `databaseURL`.
   3. In der Konsole „Realtime Database" aktivieren (Build → Realtime Database
      → Datenbank erstellen) und die Regeln aus der README setzen.

   Hinweis: Diese Werte sind KEIN Geheimnis – Firebase-Web-Keys gehören in den
   Client. Der Zugriffsschutz erfolgt über die Datenbank-Regeln.
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "DEINE_API_KEY",
  authDomain: "DEIN_PROJEKT.firebaseapp.com",
  databaseURL: "https://DEIN_PROJEKT-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "DEIN_PROJEKT",
  storageBucket: "DEIN_PROJEKT.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxx"
};

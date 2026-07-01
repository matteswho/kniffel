/* ============================================================
   Firebase-Konfiguration für die Mehrspieler-Version (Projekt: kniffel-go).

   Die Werte stammen aus der Firebase-Konsole (Projekteinstellungen → Meine Apps).
   Firebase-Web-Keys sind KEIN Geheimnis – der Schutz läuft über die
   Datenbank-Regeln.

   HINWEIS: `databaseURL` muss die URL deiner Realtime Database sein. Sie wird
   angezeigt, sobald du unter „Build → Realtime Database" eine Datenbank
   erstellt hast (oben auf der Seite), z. B.:
     https://kniffel-go-default-rtdb.europe-west1.firebasedatabase.app
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCPQJWCmguiMLcuBNZLnp_AgGIvgBvTmzs",
  authDomain: "kniffel-go.firebaseapp.com",
  databaseURL: "https://kniffel-go-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kniffel-go",
  storageBucket: "kniffel-go.firebasestorage.app",
  messagingSenderId: "304761175301",
  appId: "1:304761175301:web:fa35befd4c3fe09fe4cb6c",
  measurementId: "G-CBDWN1XGZ5"
};

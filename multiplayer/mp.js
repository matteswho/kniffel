/* ============================================================
   Kniffel Mehrspieler (V2) – Firebase Realtime Database
   - Der Spielstand liegt zentral in der Datenbank; jedes Gerät
     liest/schreibt per Transaktion. Kein Gerät muss „Host" bleiben.
   - Gemeinsame Tabelle: Zeilen = Felder, Spalten = Spieler.
     Reihum-Zug; nur die eigene Spalte, nur wenn man dran ist;
     einmal eingetragene Felder sind gesperrt (kein Überschreiben).
   ============================================================ */

// ---------------- Felder & Scoring ----------------
const UPPER_FIELDS = [
  { key: 'ones',   label: 'Einser',  face: 1 },
  { key: 'twos',   label: 'Zweier',  face: 2 },
  { key: 'threes', label: 'Dreier',  face: 3 },
  { key: 'fours',  label: 'Vierer',  face: 4 },
  { key: 'fives',  label: 'Fünfer',  face: 5 },
  { key: 'sixes',  label: 'Sechser', face: 6 },
];
const LOWER_FIELDS = [
  { key: 'threeKind', label: 'Dreierpasch' },
  { key: 'fourKind',  label: 'Viererpasch' },
  { key: 'fullHouse', label: 'Full House' },
  { key: 'smallStr',  label: 'Kleine Straße' },
  { key: 'largeStr',  label: 'Große Straße' },
  { key: 'kniffel',   label: 'Kniffel' },
  { key: 'chance',    label: 'Chance' },
];
const ALL_FIELDS = [...UPPER_FIELDS, ...LOWER_FIELDS];
const UPPER_KEYS = UPPER_FIELDS.map(f => f.key);
const SUM_LOWER_KEYS = ['threeKind', 'fourKind', 'chance'];
const FIXED_LOWER = { fullHouse: 25, smallStr: 30, largeStr: 40, kniffel: 50 };
const BONUS_THRESHOLD = 63, BONUS_POINTS = 35;

function counts(d) { const c = [0,0,0,0,0,0,0]; d.forEach(v => c[v]++); return c; }
function sumDice(d) { return d.reduce((a, b) => a + b, 0); }
function hasStraight(c, len) { let r = 0; for (let i = 1; i <= 6; i++) { if (c[i]) { if (++r >= len) return true; } else r = 0; } return false; }
function scoreFor(key, d) {
  const c = counts(d), s = sumDice(d);
  switch (key) {
    case 'ones': return c[1]; case 'twos': return c[2]*2; case 'threes': return c[3]*3;
    case 'fours': return c[4]*4; case 'fives': return c[5]*5; case 'sixes': return c[6]*6;
    case 'threeKind': return c.some(n => n >= 3) ? s : 0;
    case 'fourKind':  return c.some(n => n >= 4) ? s : 0;
    case 'fullHouse': { const h3 = c.some(n => n === 3), h2 = c.some(n => n === 2), h5 = c.some(n => n === 5); return (h3 && h2) || h5 ? 25 : 0; }
    case 'smallStr': return hasStraight(c, 4) ? 30 : 0;
    case 'largeStr': return hasStraight(c, 5) ? 40 : 0;
    case 'kniffel':  return c.some(n => n === 5) ? 50 : 0;
    case 'chance':   return s;
    default: return 0;
  }
}

function computeTotals(scores) {
  let upper = 0, lower = 0;
  UPPER_FIELDS.forEach(f => { if (scores[f.key] != null) upper += scores[f.key]; });
  LOWER_FIELDS.forEach(f => { if (scores[f.key] != null) lower += scores[f.key]; });
  const bonus = upper >= BONUS_THRESHOLD ? BONUS_POINTS : 0;
  return { upper, bonus, upperTotal: upper + bonus, lower, grand: upper + bonus + lower,
           remaining: Math.max(0, BONUS_THRESHOLD - upper) };
}

// ---------------- Zustand ----------------
const SESSION_KEY = 'kniffel-mp-session';
const rid = () => Math.random().toString(36).slice(2, 9);

const deviceId = (() => {
  let id = localStorage.getItem('kniffel-mp-device');
  if (!id) { id = rid() + rid(); localStorage.setItem('kniffel-mp-device', id); }
  return id;
})();

let game = null;        // normalisierter Spielstand { code, host, turn, players:[{pid,name,owner,scores}] }
let isHost = false;     // bin ich der Ersteller (Spielleiter)?
let myPid = null;
let code = null;        // Spiel-Code
let db = null, gameRef = null;
let fbConnected = false, subscribed = false;
let lastName = null;    // Name für Erstellen/Beitreten (Retry)
let connectTimer = null;

// Lokaler Würfel-Zustand (pro Gerät, nicht synchronisiert)
const MAX_ROLLS = 3;
let rollsUsed = 0;
let held = [false, false, false, false, false];
let dice = [1, 2, 3, 4, 5];
const hasRolled = () => rollsUsed > 0;

// Lokale Einstellungen (Würfel- vs. manueller Modus)
const MP_SETTINGS_KEY = 'kniffel-mp-settings';
let settings = (() => {
  try { const r = localStorage.getItem(MP_SETTINGS_KEY); if (r) return Object.assign({ manualMode: false }, JSON.parse(r)); } catch (e) {}
  return { manualMode: false };
})();
function saveSettings() { try { localStorage.setItem(MP_SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }

function playerById(pid) { return game && game.players.find(p => p.pid === pid); }
function myPlayer() { return game && game.players.find(p => p.owner === deviceId); }

// ---------------- Zug-Logik (lesend auf dem normalisierten Stand) ----------------
function currentPlayer() { return game && game.turn >= 0 ? game.players[game.turn] : null; }
function gameOver() { return !!game && game.turn === -1; }
function isSheetFull(p) { return ALL_FIELDS.every(f => p.scores[f.key] != null); }
function canControl(p) { return !!p && (p.owner === deviceId || (isHost && !p.owner)); }
function canEnter(p) { const cp = currentPlayer(); return !gameOver() && !!cp && cp.pid === p.pid && canControl(p); }
function isMyTurn() { return canControl(currentPlayer()); }

// ---------------- Reine Reducer (laufen in Firebase-Transaktionen) ----------------
function playersArr(g) { let p = g.players || []; if (!Array.isArray(p)) p = Object.values(p); return p; }
function advanceTurnIdx(players, turn) {
  const n = players.length; if (!n) return -1;
  for (let s = 1; s <= n; s++) { const i = (turn + s) % n; if (!isSheetFull(players[i])) return i; }
  return -1; // alle Blätter voll → Spiel beendet
}
// Eintrag setzen: nur wer dran ist, nur eigene Spalte, nur leeres Feld.
function applyMove(g, pid, key, value, dev) {
  if (!g) return;                       // undefined = Transaktion abbrechen
  const players = playersArr(g); g.players = players;
  const p = players.find(x => x.pid === pid); if (!p) return;
  const cp = g.turn >= 0 ? players[g.turn] : null;
  const isCurrent = cp && cp.pid === pid;
  const owns = p.owner ? (dev === p.owner) : (g.host === dev);
  const valOk = Number.isInteger(value) && value >= 0 && value <= 375;
  const fieldOk = ALL_FIELDS.some(f => f.key === key);
  const empty = !p.scores || p.scores[key] == null;
  if (g.turn !== -1 && isCurrent && owns && valOk && fieldOk && empty) {
    p.scores = p.scores || {};
    p.scores[key] = value;
    g.turn = advanceTurnIdx(players, g.turn);
    return g;
  }
  return; // abbrechen
}
// Beitreten: bestehenden gleichnamigen Platzhalter übernehmen oder neu anlegen.
function applyJoin(g, dev, name) {
  const players = playersArr(g); g.players = players;
  let p = players.find(x => !x.owner && String(x.name).toLowerCase() === String(name).toLowerCase());
  if (p) p.owner = dev;
  else players.push({ pid: rid(), name: name || 'Gast', owner: dev, scores: {} });
  return g;
}
function applyAddPlayer(g, name) {
  if (!g) return g;
  const players = playersArr(g); g.players = players;
  players.push({ pid: rid(), name: name || 'Spieler', owner: null, scores: {} });
  return g;
}
// DB-Rohdaten in einen vollständigen Stand mit expliziten null-Feldern wandeln.
function normalizeGame(g) {
  if (!g) return null;
  const players = playersArr(g);
  players.forEach(p => {
    const sc = p.scores || {}; const full = {};
    ALL_FIELDS.forEach(f => { full[f.key] = (sc[f.key] == null ? null : sc[f.key]); });
    p.scores = full;
  });
  return { code: g.code, host: g.host, turn: (g.turn == null ? 0 : g.turn), players };
}

// ---------------- Firebase ----------------
function firebaseReady() {
  const c = window.FIREBASE_CONFIG;
  return !!(window.firebase && c && c.databaseURL && !String(c.databaseURL).includes('DEINE_'));
}
function fbInit() {
  if (db) return true;
  if (!firebaseReady()) return false;
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    db = firebase.database();
    db.ref('.info/connected').on('value', s => { fbConnected = !!s.val(); refreshConn(); });
    return true;
  } catch (e) { return false; }
}
function notConfigured() {
  alert('Firebase ist noch nicht eingerichtet.\n\nBitte multiplayer/firebase-config.js mit den Daten deines Projekts füllen (siehe Kommentar in der Datei).');
}

function createGame(name) {
  if (!fbInit()) { notConfigured(); return; }
  isHost = true; lastName = name;
  showBoard(); setStatus('connecting');
  const attempt = () => {
    code = genCode();
    gameRef = db.ref('games/' + code);
    gameRef.transaction(g => {
      if (g) return; // Code bereits vergeben → abbrechen
      return { code, host: deviceId, createdAt: Date.now(), turn: 0,
               players: [{ pid: rid(), name, owner: deviceId, scores: {} }] };
    }, (err, committed) => {
      if (err) { setStatus('error', err.message); return; }
      if (!committed) { attempt(); return; } // Kollision → neuer Code
      subscribe(); saveSession();
    });
  };
  attempt();
}

function joinGame(joinCode, name) {
  if (!fbInit()) { notConfigured(); return; }
  isHost = false; code = joinCode; lastName = name;
  showBoard(); setStatus('connecting');
  document.getElementById('boardHint').textContent = 'Verbinde mit Spiel ' + code + ' …';
  armConnectTimeout();
  gameRef = db.ref('games/' + code);
  gameRef.transaction(g => {
    if (g === null) return null;      // Spiel existiert nicht
    return applyJoin(g, deviceId, name);
  }, (err, committed, snap) => {
    clearTimeout(connectTimer);
    if (err) { setStatus('error', err.message); return; }
    if (!snap || !snap.exists() || !snap.val()) { setStatus('error', 'not-found'); return; }
    subscribe(); saveSession();
  });
}

function subscribe() {
  subscribed = true;
  if (gameRef) gameRef.off();
  gameRef = db.ref('games/' + code);
  gameRef.on('value', snap => {
    const g = normalizeGame(snap.val());
    if (!g) { setStatus('error', 'gone'); game = null; renderBoard(); return; }
    game = g;
    isHost = (g.host === deviceId);
    const mine = myPlayer(); myPid = mine ? mine.pid : null;
    showBoard();
    refreshConn();
    renderBoard();
  }, err => setStatus('error', err && err.message));
}

// Eintrag / Spieler-Aktionen als Transaktion (setzt Regeln serverseitig durch)
function editCell(pid, key, value) {
  if (!gameRef) return;
  gameRef.transaction(g => applyMove(g, pid, key, value, deviceId));
}
function addPlayerRemote(name) {
  if (!gameRef) return;
  gameRef.transaction(g => applyAddPlayer(g, name));
}

function armConnectTimeout() {
  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => { if (!subscribed) setStatus('error', 'timeout'); }, 20000);
}
function retryConnect() {
  if (code && isHost) subscribe();
  else if (code && lastName != null) joinGame(code, lastName);
  else showScreen('screen-home');
}
function leaveGame() {
  clearTimeout(connectTimer);
  try { if (gameRef) gameRef.off(); } catch (e) {}
  gameRef = null; game = null; isHost = false; myPid = null; code = null; subscribed = false;
  rollsUsed = 0; held = [false, false, false, false, false];
  clearSession();
  setStatus('offline');
  document.getElementById('settingsBtn').hidden = true;
  document.getElementById('btnRetry').hidden = true;
  showScreen('screen-home');
}

function genCode() {
  const alph = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O/1/I
  let s = '';
  for (let i = 0; i < 5; i++) s += alph[Math.floor(Math.random() * alph.length)];
  return s;
}

// ---------------- Sitzung merken ----------------
function saveSession() { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ code, name: lastName })); } catch (e) {} }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

// ---------------- UI: Screens ----------------
function showScreen(id) { document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; }); }
function showBoard() {
  showScreen('screen-board');
  document.getElementById('gameCode').textContent = code || '----';
  document.getElementById('btnAddPlayer').hidden = !isHost;
  document.getElementById('settingsBtn').hidden = false;
  applyMode();
}

// ---------------- UI: Würfelbereich (lokal, pro Gerät) ----------------
function renderDice() {
  const diceRow = document.getElementById('diceRow');
  diceRow.innerHTML = '';
  const rolled = hasRolled();
  dice.forEach((v, i) => {
    let die;
    if (!rolled) { die = document.createElement('div'); die.className = 'die die--empty'; die.textContent = '?'; }
    else { die = buildDie(v); if (held[i]) die.classList.add('held'); }
    die.dataset.i = i;
    die.addEventListener('click', () => onDieClick(i));
    diceRow.appendChild(die);
  });
}
function onDieClick(i) {
  if (rollsUsed === 0 || rollsUsed >= MAX_ROLLS) return;
  held[i] = !held[i];
  renderDice();
}
function rollDice() {
  if (rollsUsed >= MAX_ROLLS) return;
  rollsUsed++;
  const first = rollsUsed === 1;
  document.querySelectorAll('#diceRow .die').forEach((el, i) => { if (first || !held[i]) el.classList.add('is-rolling'); });
  let ticks = 0;
  const iv = setInterval(() => {
    for (let i = 0; i < 5; i++) if (first || !held[i]) dice[i] = 1 + Math.floor(Math.random() * 6);
    renderDice();
    if (++ticks >= 6) { clearInterval(iv); updateControls(); renderBoard(); }
  }, 70);
}
function nextRound() {
  rollsUsed = 0;
  held = [false, false, false, false, false];
  renderDice();
  updateControls();
  renderBoard();
}
function updateControls() {
  const remaining = MAX_ROLLS - rollsUsed;
  const rollBtn = document.getElementById('rollBtn');
  const status = document.getElementById('rollStatus');
  if (remaining > 0) {
    rollBtn.disabled = false;
    rollBtn.textContent = rollsUsed === 0 ? '🎲 Würfeln' : `🎲 Nochmal (${remaining})`;
  } else { rollBtn.disabled = true; rollBtn.textContent = 'Keine Würfe mehr'; }
  status.textContent = [
    'Bereit – tippe „Würfeln"',
    '1. Wurf · Würfel antippen zum Halten',
    '2. Wurf · Würfel antippen zum Halten',
    '3. Wurf · jetzt in deine Spalte eintragen',
  ][rollsUsed];
}

function applyMode() {
  document.getElementById('manualToggle').checked = settings.manualMode;
  if (!settings.manualMode) { renderDice(); updateControls(); }
  if (game) updateTurnUI();
  else document.getElementById('dicePanel').hidden = settings.manualMode;
}

// ---------------- UI: Verbindungsstatus ----------------
function refreshConn() { if (subscribed) setStatus(fbConnected ? 'online' : 'connecting'); }
function errorHint(detail) {
  switch (detail) {
    case 'not-found': return 'Kein Spiel mit diesem Code gefunden. Prüfe den Code (Groß-/Kleinschreibung egal).';
    case 'gone': return 'Dieses Spiel gibt es nicht mehr. Bitte ein neues Spiel starten.';
    case 'timeout': return 'Keine Verbindung nach 20 s. Internet prüfen und „Erneut verbinden" tippen.';
    default: return 'Verbindung fehlgeschlagen' + (detail ? ' (' + detail + ')' : '') + '. Erneut verbinden oder Code prüfen.';
  }
}
function setStatus(state, detail) {
  const badge = document.getElementById('connBadge');
  const map = {
    online: ['conn-badge--on', 'online'],
    connecting: ['conn-badge--wait', 'verbinde …'],
    offline: ['conn-badge--off', 'getrennt'],
    error: ['conn-badge--off', 'Fehler'],
  };
  const [cls, text] = map[state] || map.offline;
  badge.className = 'conn-badge ' + cls;
  badge.textContent = text;
  const hint = document.getElementById('boardHint');
  const retryBtn = document.getElementById('btnRetry');
  if (state === 'error') hint.textContent = errorHint(detail);
  else if (state === 'online') hint.textContent = isHost ? 'Teile den Code – Mitspieler treten damit bei.' : 'Verbunden. Du bist dabei!';
  else if (state === 'offline') hint.textContent = 'Verbindung getrennt.';
  if (retryBtn) retryBtn.hidden = !(state === 'error');
}

// ---------------- UI: Spielbrett ----------------
function renderBoard() {
  const table = document.getElementById('boardTable');
  if (!game) { table.innerHTML = ''; return; }
  const players = game.players;

  let html = '<thead><tr><th class="row-label">Feld</th>';
  players.forEach((p, idx) => {
    const you = p.owner === deviceId;
    const isTurn = idx === game.turn;
    const tag = you ? ' 📱' : (p.owner ? '' : ' •');
    const cls = [you ? 'col-you' : '', isTurn ? 'col-turn' : ''].filter(Boolean).join(' ');
    html += `<th class="${cls}">${isTurn ? '▶ ' : ''}${esc(p.name)}${tag}</th>`;
  });
  html += '</tr></thead><tbody>';

  html += sectionRow('Oberer Teil', players.length);
  UPPER_FIELDS.forEach(f => { html += fieldRow(f); });
  html += calcRow('Zw.-Summe', p => `${computeTotals(p.scores).upper}<span class="sub">/63</span>`);
  html += calcRow('Bonus', p => { const t = computeTotals(p.scores); return t.bonus ? '+35' : `<span class="sub">noch ${t.remaining}</span>`; },
    p => computeTotals(p.scores).bonus ? 'bonus-ok' : 'bonus-miss');
  html += sectionRow('Unterer Teil', players.length);
  LOWER_FIELDS.forEach(f => { html += fieldRow(f); });

  html += '<tr class="grand-row"><td class="row-label">Gesamt</td>';
  players.forEach(p => { html += `<td>${computeTotals(p.scores).grand}</td>`; });
  html += '</tr></tbody>';
  table.innerHTML = html;

  table.querySelectorAll('td.cell').forEach(td => {
    td.addEventListener('click', () => {
      const pid = td.dataset.pid, key = td.dataset.key;
      const p = playerById(pid);
      if (p && canEnter(p) && p.scores[key] === null) openEntry(pid, key);
    });
  });

  updateTurnUI();
}

function fieldRow(f) {
  let html = `<tr><td class="row-label">${f.label}</td>`;
  game.players.forEach(p => {
    const v = p.scores[f.key];
    const editable = canEnter(p) && v === null;
    let cls = 'cell' + (editable ? ' editable' : '') + (p.owner === deviceId ? ' col-you' : '') + (p.pid === (currentPlayer() || {}).pid ? ' col-turn' : '');
    let inner = '';
    if (v != null) { if (v === 0) cls += ' struck'; inner = v === 0 ? '✕' : v; }
    else if (editable && !settings.manualMode && hasRolled()) inner = `<span class="tap ghost">${scoreFor(f.key, dice)}</span>`;
    else if (editable) inner = '<span class="tap">+</span>';
    html += `<td class="${cls}" data-pid="${p.pid}" data-key="${f.key}">${inner}</td>`;
  });
  return html + '</tr>';
}

function updateTurnUI() {
  const banner = document.getElementById('turnBanner');
  const dp = document.getElementById('dicePanel');
  if (!game) { banner.textContent = ''; return; }
  if (gameOver()) {
    let best = null;
    game.players.forEach(p => { const g = computeTotals(p.scores).grand; if (!best || g > best.g) best = { p, g }; });
    banner.className = 'turn-banner turn-banner--over';
    banner.textContent = best ? `🏆 ${best.p.name} gewinnt mit ${best.g} Punkten!` : 'Spiel beendet';
  } else {
    const cp = currentPlayer();
    const mine = canControl(cp);
    banner.className = 'turn-banner' + (mine ? ' turn-banner--you' : '');
    if (mine) banner.textContent = cp.owner === deviceId ? '🎲 Du bist dran' : `🎲 ${cp.name} ist dran – du trägst ein`;
    else banner.textContent = cp ? `⏳ ${cp.name} ist dran …` : '';
  }
  dp.hidden = settings.manualMode || gameOver() || !isMyTurn();
}
function calcRow(label, fn, clsFn) {
  let html = `<tr class="calc-row"><td class="row-label">${label}</td>`;
  game.players.forEach(p => { html += `<td class="calc-cell ${clsFn ? clsFn(p) : ''}">${fn(p)}</td>`; });
  return html + '</tr>';
}
function sectionRow(label, n) { return `<tr class="section-row"><td colspan="${n + 1}">${label}</td></tr>`; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------------- UI: Eintrags-Dialog ----------------
const modal = document.getElementById('cellModal');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');
const modalActions = document.getElementById('modalActions');
const modalPicker = document.getElementById('modalPicker');
const manualInput = document.getElementById('manualInput');
let entryTarget = null;

function fieldDef(key) { return ALL_FIELDS.find(f => f.key === key); }
function buildDie(value) {
  const die = document.createElement('div');
  die.className = 'die'; die.dataset.v = value;
  for (let p = 0; p < value; p++) { const pip = document.createElement('span'); pip.className = 'pip'; die.appendChild(pip); }
  return die;
}
function addBtn(cls, text, onClick) {
  const b = document.createElement('button');
  b.className = 'btn ' + cls; b.textContent = text; b.addEventListener('click', onClick);
  modalActions.appendChild(b); return b;
}
function makeStrike(pid, key) {
  const b = document.createElement('button');
  b.className = 'btn btn--ghost'; b.textContent = 'Streichen (0 Punkte)';
  b.addEventListener('click', () => commitEntry(pid, key, 0));
  return b;
}
function openEntry(pid, key) {
  entryTarget = { pid, key };
  const f = fieldDef(key);
  const p = playerById(pid);
  modalTitle.textContent = `${f.label} – ${p.name}`;
  modalPicker.innerHTML = ''; modalActions.innerHTML = ''; manualInput.value = '';
  if (!settings.manualMode) buildDiceEntry(pid, key, f);
  else if (UPPER_KEYS.includes(key)) buildUpperPicker(pid, key, f);
  else if (SUM_LOWER_KEYS.includes(key)) buildSumPicker(pid, key, f);
  else buildFixedPicker(pid, key, f);
  modal.hidden = false;
}
function buildUpperPicker(pid, key, f) {
  modalSub.textContent = `Tippe die ${f.label} an, die du gewürfelt hast.`;
  const active = [false, false, false, false, false];
  const row = document.createElement('div'); row.className = 'dice-row--modal'; modalPicker.appendChild(row);
  const confirm = addBtn('btn--accent', '', () => commitEntry(pid, key, active.filter(Boolean).length * f.face));
  modalActions.appendChild(makeStrike(pid, key));
  const upd = () => { confirm.textContent = `Eintragen: ${active.filter(Boolean).length * f.face} Punkte`; };
  for (let i = 0; i < 5; i++) {
    const die = buildDie(f.face); die.classList.add('die--off');
    die.addEventListener('click', () => { active[i] = !active[i]; die.classList.toggle('die--off', !active[i]); upd(); });
    row.appendChild(die);
  }
  upd();
}
function buildSumPicker(pid, key, f) {
  modalSub.textContent = 'Stelle deine 5 Würfel ein (antippen erhöht die Augen).';
  const vals = [1, 1, 1, 1, 1];
  const row = document.createElement('div'); row.className = 'dice-row--modal'; modalPicker.appendChild(row);
  const confirm = addBtn('btn--accent', '', () => commitEntry(pid, key, scoreFor(key, vals)));
  modalActions.appendChild(makeStrike(pid, key));
  const upd = () => { const pts = scoreFor(key, vals); confirm.textContent = pts > 0 ? `Eintragen: ${pts} Punkte` : 'Eintragen: 0 (nicht erfüllt)'; };
  const render = () => {
    row.innerHTML = '';
    vals.forEach((v, i) => { const die = buildDie(v); die.addEventListener('click', () => { vals[i] = (vals[i] % 6) + 1; render(); upd(); }); row.appendChild(die); });
  };
  render(); upd();
}
function buildFixedPicker(pid, key, f) {
  const pts = FIXED_LOWER[key];
  modalSub.textContent = `${f.label} ist ${pts} Punkte wert – erreicht?`;
  addBtn('btn--accent', `Geschafft: ${pts} Punkte`, () => commitEntry(pid, key, pts));
  modalActions.appendChild(makeStrike(pid, key));
}
function buildDiceEntry(pid, key, f) {
  const rolled = hasRolled();
  const ghost = scoreFor(key, dice);
  modalSub.textContent = rolled ? `Dein Wurf ergibt hier ${ghost} Punkte.` : 'Noch nicht gewürfelt – oben würfeln oder von Hand eintragen.';
  if (rolled) addBtn('btn--accent', `Würfel eintragen: ${ghost} Punkte`, () => commitEntry(pid, key, ghost));
  modalActions.appendChild(makeStrike(pid, key));
}
function commitEntry(pid, key, value) {
  editCell(pid, key, value);
  closeModal();
  if (!settings.manualMode && value !== null) nextRound();
}
function closeModal() { modal.hidden = true; modalPicker.innerHTML = ''; entryTarget = null; }

document.getElementById('modalBackdrop').addEventListener('click', closeModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);
document.getElementById('manualOk').addEventListener('click', () => {
  if (!entryTarget) return;
  const raw = manualInput.value.trim(); if (raw === '') return;
  commitEntry(entryTarget.pid, entryTarget.key, Math.max(0, Math.min(375, parseInt(raw, 10) || 0)));
});

// ---------------- UI: Spieler hinzufügen (Spielleiter) ----------------
const addModal = document.getElementById('addModal');
document.getElementById('btnAddPlayer').addEventListener('click', () => { addModal.hidden = false; document.getElementById('addName').value = ''; document.getElementById('addName').focus(); });
document.getElementById('addBackdrop').addEventListener('click', () => addModal.hidden = true);
document.getElementById('addCancel').addEventListener('click', () => addModal.hidden = true);
document.getElementById('addOk').addEventListener('click', () => {
  const name = document.getElementById('addName').value.trim();
  if (name) addPlayerRemote(name);
  document.getElementById('addName').value = '';
  document.getElementById('addName').focus();
});

// ---------------- UI: Einstellungen ----------------
const settingsModal = document.getElementById('settingsModal');
document.getElementById('settingsBtn').addEventListener('click', () => { settingsModal.hidden = false; });
document.getElementById('settingsBackdrop').addEventListener('click', () => settingsModal.hidden = true);
document.getElementById('settingsClose').addEventListener('click', () => settingsModal.hidden = true);
document.getElementById('manualToggle').addEventListener('change', (e) => {
  settings.manualMode = e.target.checked; saveSettings(); applyMode(); renderBoard();
});

// ---------------- UI: Navigation ----------------
document.getElementById('btnHostStart').addEventListener('click', () => { showScreen('screen-host'); document.getElementById('hostName').focus(); });
document.getElementById('btnJoinStart').addEventListener('click', () => { showScreen('screen-join'); });
document.getElementById('btnHostBack').addEventListener('click', () => showScreen('screen-home'));
document.getElementById('btnJoinBack').addEventListener('click', () => showScreen('screen-home'));

document.getElementById('rollBtn').addEventListener('click', rollDice);
document.getElementById('nextRoundBtn').addEventListener('click', nextRound);
document.getElementById('btnRetry').addEventListener('click', () => { document.getElementById('btnRetry').hidden = true; retryConnect(); });

document.getElementById('btnCreate').addEventListener('click', () => {
  createGame(document.getElementById('hostName').value.trim() || 'Spielleiter');
});
document.getElementById('btnJoin').addEventListener('click', () => {
  const c = document.getElementById('joinCode').value.trim().toUpperCase();
  const name = document.getElementById('joinName').value.trim() || 'Gast';
  if (c.length < 3) { document.getElementById('joinHint').textContent = 'Bitte gültigen Code eingeben.'; return; }
  joinGame(c, name);
});
document.getElementById('btnLeave').addEventListener('click', () => { if (confirm('Spiel verlassen?')) leaveGame(); });

// ---------------- Sitzung wiederherstellen ----------------
(function restore() {
  try {
    const raw = localStorage.getItem(SESSION_KEY); if (!raw) return;
    const s = JSON.parse(raw); if (!s.code) return;
    if (!fbInit()) return;
    code = s.code; lastName = s.name || '';
    showBoard(); setStatus('connecting');
    subscribe();
  } catch (e) {}
})();

// Für Tests zugänglich machen
window.__mp = { get game() { return game; }, applyMove, applyJoin, applyAddPlayer, advanceTurnIdx, normalizeGame,
  computeTotals, scoreFor, currentPlayer, gameOver, isSheetFull, renderBoard, deviceId };

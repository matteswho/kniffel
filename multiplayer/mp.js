/* ============================================================
   Kniffel Mehrspieler (V2)
   - Spielleiter (Host) hält den Spielstand, Gäste verbinden sich
     per WebRTC über den kostenlosen PeerJS-Broker (kein Konto).
   - Gemeinsame Tabelle: Zeilen = Felder, Spalten = Spieler.
     Jedes Gerät bearbeitet nur seine eigene Spalte.
   ============================================================ */

// ---------------- Felder & Scoring (wie Einzel-Version) ----------------
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

function emptyScores() { const o = {}; ALL_FIELDS.forEach(f => { o[f.key] = null; }); return o; }

function computeTotals(scores) {
  let upper = 0, lower = 0;
  UPPER_FIELDS.forEach(f => { if (scores[f.key] != null) upper += scores[f.key]; });
  LOWER_FIELDS.forEach(f => { if (scores[f.key] != null) lower += scores[f.key]; });
  const bonus = upper >= BONUS_THRESHOLD ? BONUS_POINTS : 0;
  return { upper, bonus, upperTotal: upper + bonus, lower, grand: upper + bonus + lower,
           remaining: Math.max(0, BONUS_THRESHOLD - upper) };
}

// ---------------- Zustand ----------------
const PEER_PREFIX = 'kniffel-mp-';
const SESSION_KEY = 'kniffel-mp-session';
const rid = () => Math.random().toString(36).slice(2, 9);

const deviceId = (() => {
  let id = localStorage.getItem('kniffel-mp-device');
  if (!id) { id = rid() + rid(); localStorage.setItem('kniffel-mp-device', id); }
  return id;
})();

let game = null;        // { code, players: [{pid, name, owner, scores}] }
let isHost = false;
let myPid = null;
let peer = null;        // PeerJS-Instanz
let conn = null;        // Gast: Verbindung zum Host
const conns = {};       // Host: deviceId -> DataConnection

// Lokaler Würfel-Zustand (pro Gerät, nicht synchronisiert) – wie in V1
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

function newPlayer(name, owner = null) { return { pid: rid(), name: name || 'Spieler', owner, scores: emptyScores() }; }
function playerById(pid) { return game && game.players.find(p => p.pid === pid); }
function myPlayer() { return game && game.players.find(p => p.owner === deviceId); }

// ---------------- Zug-Logik ----------------
function currentPlayer() { return game && game.turn >= 0 ? game.players[game.turn] : null; }
function gameOver() { return !!game && game.turn === -1; }
function isSheetFull(p) { return ALL_FIELDS.every(f => p.scores[f.key] != null); }
// Kann dieses Gerät für p eintragen (eigener Spieler oder Host für Platzhalter)?
function canControl(p) { return !!p && (p.owner === deviceId || (isHost && !p.owner)); }
// Ist p gerade am Zug und darf dieses Gerät für p eintragen?
function canEnter(p) { const cp = currentPlayer(); return !gameOver() && !!cp && cp.pid === p.pid && canControl(p); }
function isMyTurn() { return canControl(currentPlayer()); }

// Zug an den nächsten Spieler mit noch offenen Feldern weitergeben.
function advanceTurn() {
  const n = game.players.length;
  if (!n) { game.turn = -1; return; }
  for (let step = 1; step <= n; step++) {
    const idx = (game.turn + step) % n;
    if (!isSheetFull(game.players[idx])) { game.turn = idx; return; }
  }
  game.turn = -1; // alle Blätter voll → Spiel beendet
}

// ---------------- Host: Nachrichten-Reducer ----------------
// Wendet eine (validierte) Aktion auf den Spielstand an. Nur der Host ruft dies auf.
function hostApply(msg) {
  switch (msg.type) {
    case 'join': {
      let p = game.players.find(x => !x.owner && x.name.toLowerCase() === String(msg.name).toLowerCase());
      if (!p) { p = newPlayer(msg.name, msg.deviceId); game.players.push(p); }
      else { p.owner = msg.deviceId; }
      break;
    }
    case 'claim': {
      const p = playerById(msg.pid);
      if (p && (!p.owner || p.owner === msg.deviceId)) p.owner = msg.deviceId;
      break;
    }
    case 'set': {
      const p = playerById(msg.pid);
      if (!p) break;
      const cp = currentPlayer();
      const isCurrent = cp && cp.pid === p.pid;                 // nur wer dran ist
      const owns = p.owner ? (msg.deviceId === p.owner) : (msg.deviceId === deviceId); // eigener Spieler / Host-Platzhalter
      const valOk = Number.isInteger(msg.value) && msg.value >= 0 && msg.value <= 375; // kein null → kein Löschen
      const fieldOk = ALL_FIELDS.some(f => f.key === msg.key);
      const empty = p.scores[msg.key] === null;                 // kein Überschreiben
      if (!gameOver() && isCurrent && owns && valOk && fieldOk && empty) {
        p.scores[msg.key] = msg.value;
        advanceTurn();
      }
      break;
    }
    case 'addPlayer': game.players.push(newPlayer(msg.name, null)); break;
    case 'removePlayer': game.players = game.players.filter(p => p.pid !== msg.pid); break;
  }
}

// ---------------- Sync: Host ----------------
function startHost(hostName) {
  isHost = true;
  game = { code: genCode(), players: [newPlayer(hostName, deviceId)], turn: 0 };
  myPid = game.players[0].pid;
  saveSession();
  showBoard();
  connectHostPeer();
}

function connectHostPeer() {
  setStatus('connecting');
  if (peer) { try { peer.destroy(); } catch (e) {} }
  peer = new Peer(PEER_PREFIX + game.code, peerOpts());
  peer.on('open', () => setStatus('online'));
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { game.code = genCode(); saveSession(); connectHostPeer(); }
    else setStatus('error', e.type);
  });
  peer.on('disconnected', () => { setStatus('connecting'); try { peer.reconnect(); } catch (e) {} });
  peer.on('connection', (c) => {
    c.on('open', () => c.send({ type: 'state', game }));
    c.on('data', (msg) => onHostData(c, msg));
    c.on('close', () => { for (const k in conns) if (conns[k] === c) delete conns[k]; renderBoard(); });
  });
  renderBoard();
}

function onHostData(c, msg) {
  if (msg && msg.deviceId) conns[msg.deviceId] = c;
  hostApply(msg);
  afterHostChange();
}

function hostAction(msg) { hostApply(msg); afterHostChange(); }

function afterHostChange() { saveSession(); broadcast(); renderBoard(); }

function broadcast() {
  Object.values(conns).forEach((c) => { try { if (c.open) c.send({ type: 'state', game }); } catch (e) {} });
}

// ---------------- Sync: Gast ----------------
let lastJoin = null;        // { code, name } für „Erneut verbinden"
let connectTimer = null;    // Timeout-Wächter für den Verbindungsaufbau

function startGuest(code, name) {
  isHost = false;
  game = null;
  lastJoin = { code, name };
  showBoard();
  setStatus('connecting');
  document.getElementById('boardHint').textContent = 'Verbinde mit Spiel ' + code + ' …';
  armConnectTimeout();
  if (peer) { try { peer.destroy(); } catch (e) {} }
  peer = new Peer(peerOpts());
  peer.on('open', () => {
    conn = peer.connect(PEER_PREFIX + code, { reliable: true, metadata: { deviceId } });
    wireGuestConn(name);
  });
  peer.on('error', (e) => setStatus('error', e.type));
  peer.on('disconnected', () => { setStatus('connecting'); try { peer.reconnect(); } catch (e) {} });
}

function wireGuestConn(name) {
  conn.on('open', () => {
    clearTimeout(connectTimer);
    setStatus('online');
    conn.send({ type: 'join', deviceId, name });
  });
  conn.on('data', (msg) => {
    if (msg && msg.type === 'state') {
      game = msg.game;
      const mine = myPlayer();
      myPid = mine ? mine.pid : null;
      renderBoard();
    }
  });
  conn.on('close', () => setStatus('offline'));
  conn.on('error', (e) => setStatus('error', e && e.type));
}

// Wenn nach 20 s keine Verbindung steht: klare Meldung statt ewigem „verbinde".
function armConnectTimeout() {
  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => {
    if (!(conn && conn.open)) setStatus('error', 'timeout');
  }, 20000);
}

function retryConnect() {
  if (isHost) { connectHostPeer(); }
  else if (lastJoin) { startGuest(lastJoin.code, lastJoin.name); }
}

// Gast/Host: eine Zelle setzen
function editCell(pid, key, value) {
  if (isHost) {
    hostAction({ type: 'set', deviceId, pid, key, value });
  } else {
    // optimistisch lokal anzeigen, dann an Host senden (Host bestätigt per state)
    const p = playerById(pid);
    if (p) p.scores[key] = value;
    renderBoard();
    if (conn && conn.open) conn.send({ type: 'set', deviceId, pid, key, value });
  }
}

// ---------------- PeerJS-Optionen / Code ----------------
// STUN für die NAT-Erkennung + kostenlose TURN-Relays, falls eine direkte
// Verbindung (z. B. im Mobilfunknetz) nicht möglich ist.
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
function peerOpts() { return { debug: 1, config: { iceServers: ICE_SERVERS } }; }

function genCode() {
  const alph = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O/1/I
  let s = '';
  for (let i = 0; i < 4; i++) s += alph[Math.floor(Math.random() * alph.length)];
  return s;
}

// ---------------- Sitzung merken ----------------
function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      role: isHost ? 'host' : 'guest',
      code: game ? game.code : null,
      game: isHost ? game : null,
      name: isHost ? (myPlayer() ? myPlayer().name : '') : (document.getElementById('joinName').value || ''),
    }));
  } catch (e) {}
}
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

// ---------------- UI: Screens ----------------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
}
function showBoard() {
  showScreen('screen-board');
  document.getElementById('gameCode').textContent = game ? game.code : '----';
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

// Würfel- vs. manueller Modus anwenden
function applyMode() {
  document.getElementById('manualToggle').checked = settings.manualMode;
  if (!settings.manualMode) { renderDice(); updateControls(); }
  if (game) updateTurnUI(); // Sichtbarkeit hängt zusätzlich vom Zug ab
  else document.getElementById('dicePanel').hidden = settings.manualMode;
}

// ---------------- UI: Verbindungsstatus ----------------
function errorHint(detail) {
  switch (detail) {
    case 'peer-unavailable':
      return 'Kein Spiel mit diesem Code gefunden. Prüfe den Code und dass das Leiter-Handy die Seite geöffnet lässt.';
    case 'timeout':
      return 'Keine Verbindung nach 20 s. Am besten sind alle im selben WLAN. Auf „Erneut verbinden" tippen.';
    case 'network':
    case 'server-error':
      return 'Verbindungsserver nicht erreichbar. Internet prüfen und erneut verbinden.';
    default:
      return 'Verbindung fehlgeschlagen' + (detail ? ' (' + detail + ')' : '') + '. Erneut verbinden oder Code prüfen.';
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
  else if (state === 'online') hint.textContent = isHost ? 'Teile den Code – Mitspieler treten damit bei.' : 'Verbunden. Tippe in deine Spalte, um einzutragen.';
  else if (state === 'offline') hint.textContent = 'Verbindung getrennt.';
  // Retry-Button bei Fehler/Trennung zeigen
  if (retryBtn) retryBtn.hidden = !(state === 'error' || state === 'offline');
}

// ---------------- UI: Spielbrett rendern ----------------
function renderBoard() {
  const table = document.getElementById('boardTable');
  if (!game) { table.innerHTML = ''; return; }
  const players = game.players;

  // Kopf
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

  // Gesamt
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
    const editable = canEnter(p) && v === null; // nur aktueller Spieler, nur leere Felder
    let cls = 'cell' + (editable ? ' editable' : '') + (p.owner === deviceId ? ' col-you' : '') + (p.pid === (currentPlayer() || {}).pid ? ' col-turn' : '');
    let inner = '';
    if (v != null) { if (v === 0) cls += ' struck'; inner = v === 0 ? '✕' : v; }
    else if (editable && !settings.manualMode && hasRolled()) inner = `<span class="tap ghost">${scoreFor(f.key, dice)}</span>`;
    else if (editable) inner = '<span class="tap">+</span>';
    html += `<td class="${cls}" data-pid="${p.pid}" data-key="${f.key}">${inner}</td>`;
  });
  return html + '</tr>';
}

// Zug-Banner + Sichtbarkeit des Würfelbereichs aktualisieren
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

// ---------------- UI: Eintrags-Dialog (wie manueller Modus V1) ----------------
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
  die.className = 'die';
  die.dataset.v = value;
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

  if (!settings.manualMode) {
    buildDiceEntry(pid, key, f);
  } else if (UPPER_KEYS.includes(key)) buildUpperPicker(pid, key, f);
  else if (SUM_LOWER_KEYS.includes(key)) buildSumPicker(pid, key, f);
  else buildFixedPicker(pid, key, f);

  // Kein „Löschen" – einmal eingetragene Felder bleiben stehen (kein Überschreiben).
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
    vals.forEach((v, i) => {
      const die = buildDie(v);
      die.addEventListener('click', () => { vals[i] = (vals[i] % 6) + 1; render(); upd(); });
      row.appendChild(die);
    });
  };
  render(); upd();
}
function buildFixedPicker(pid, key, f) {
  const pts = FIXED_LOWER[key];
  modalSub.textContent = `${f.label} ist ${pts} Punkte wert – erreicht?`;
  addBtn('btn--accent', `Geschafft: ${pts} Punkte`, () => commitEntry(pid, key, pts));
  modalActions.appendChild(makeStrike(pid, key));
}

// Würfel-Modus: den auf dem Handy gewürfelten Wurf übernehmen.
function buildDiceEntry(pid, key, f) {
  const rolled = hasRolled();
  const ghost = scoreFor(key, dice);
  modalSub.textContent = rolled
    ? `Dein Wurf ergibt hier ${ghost} Punkte.`
    : 'Noch nicht gewürfelt – oben würfeln oder von Hand eintragen.';
  if (rolled) addBtn('btn--accent', `Würfel eintragen: ${ghost} Punkte`, () => commitEntry(pid, key, ghost));
  modalActions.appendChild(makeStrike(pid, key));
}

function commitEntry(pid, key, value) {
  editCell(pid, key, value);
  closeModal();
  // Im Würfel-Modus beendet ein Eintrag die Runde → neuer Wurf
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

// ---------------- UI: Spieler hinzufügen (Host) ----------------
const addModal = document.getElementById('addModal');
document.getElementById('btnAddPlayer').addEventListener('click', () => { addModal.hidden = false; document.getElementById('addName').value = ''; document.getElementById('addName').focus(); });
document.getElementById('addBackdrop').addEventListener('click', () => addModal.hidden = true);
document.getElementById('addCancel').addEventListener('click', () => addModal.hidden = true);
document.getElementById('addOk').addEventListener('click', () => {
  const name = document.getElementById('addName').value.trim();
  if (name) hostAction({ type: 'addPlayer', name });
  document.getElementById('addName').value = '';
  document.getElementById('addName').focus();
});

// ---------------- UI: Einstellungen (Würfel- vs. manueller Modus) ----------------
const settingsModal = document.getElementById('settingsModal');
document.getElementById('settingsBtn').addEventListener('click', () => { settingsModal.hidden = false; });
document.getElementById('settingsBackdrop').addEventListener('click', () => settingsModal.hidden = true);
document.getElementById('settingsClose').addEventListener('click', () => settingsModal.hidden = true);
document.getElementById('manualToggle').addEventListener('change', (e) => {
  settings.manualMode = e.target.checked;
  saveSettings();
  applyMode();
  renderBoard();
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
  const name = document.getElementById('hostName').value.trim() || 'Spielleiter';
  startHost(name);
});
document.getElementById('btnJoin').addEventListener('click', () => {
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  const name = document.getElementById('joinName').value.trim() || 'Gast';
  if (code.length < 3) { document.getElementById('joinHint').textContent = 'Bitte gültigen Code eingeben.'; return; }
  startGuest(code, name);
});
document.getElementById('btnLeave').addEventListener('click', () => {
  if (!confirm('Spiel verlassen?')) return;
  clearTimeout(connectTimer);
  try { if (peer) peer.destroy(); } catch (e) {}
  peer = null; conn = null; game = null; isHost = false; myPid = null; lastJoin = null;
  for (const k in conns) delete conns[k];
  rollsUsed = 0; held = [false, false, false, false, false];
  clearSession();
  setStatus('offline');
  document.getElementById('settingsBtn').hidden = true;
  document.getElementById('btnRetry').hidden = true;
  showScreen('screen-home');
});

// ---------------- Sitzung wiederherstellen (nur Host: voller Stand) ----------------
(function restore() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.role === 'host' && s.game) {
      game = s.game; isHost = true;
      const mine = myPlayer(); myPid = mine ? mine.pid : null;
      showBoard();
      connectHostPeer();
    }
  } catch (e) {}
})();

// Für Tests zugänglich machen
window.__mp = { get game() { return game; }, hostApply, computeTotals, scoreFor, afterHostChange, renderBoard,
  currentPlayer, gameOver, isSheetFull, advanceTurn,
  setGame(g) { game = g; }, setHost(v) { isHost = v; }, deviceId };

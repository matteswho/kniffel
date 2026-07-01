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

function newPlayer(name, owner = null) { return { pid: rid(), name: name || 'Spieler', owner, scores: emptyScores() }; }
function playerById(pid) { return game && game.players.find(p => p.pid === pid); }
function myPlayer() { return game && game.players.find(p => p.owner === deviceId); }

// Darf dieses Gerät die Spalte von p bearbeiten?
function canEdit(p) { return p.owner === deviceId || (isHost && !p.owner); }

function validScore(key, value) {
  if (value === null) return true;
  return Number.isInteger(value) && value >= 0 && value <= 375;
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
      const allowed = msg.deviceId === deviceId || p.owner === msg.deviceId || (!p.owner && msg.deviceId === deviceId);
      if (allowed && validScore(msg.key, msg.value) && ALL_FIELDS.some(f => f.key === msg.key)) {
        p.scores[msg.key] = msg.value;
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
  game = { code: genCode(), players: [newPlayer(hostName, deviceId)] };
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
function startGuest(code, name) {
  isHost = false;
  game = null;
  showBoard();
  setStatus('connecting');
  document.getElementById('boardHint').textContent = 'Verbinde mit Spiel ' + code + ' …';
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
  conn.on('error', () => setStatus('error'));
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
function peerOpts() { return { debug: 1 }; }

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
}

// ---------------- UI: Verbindungsstatus ----------------
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
  if (state === 'error') hint.textContent = 'Verbindung fehlgeschlagen' + (detail ? ' (' + detail + ')' : '') + '. Prüfe den Code / Internet und versuche es erneut.';
  else if (state === 'online') hint.textContent = isHost ? 'Teile den Code – Mitspieler treten damit bei.' : 'Verbunden. Tippe in deine Spalte, um einzutragen.';
}

// ---------------- UI: Spielbrett rendern ----------------
function renderBoard() {
  const table = document.getElementById('boardTable');
  if (!game) { table.innerHTML = ''; return; }
  const players = game.players;

  // Kopf
  let html = '<thead><tr><th class="row-label">Feld</th>';
  players.forEach(p => {
    const you = p.owner === deviceId;
    const online = p.owner && (isHost ? (p.owner === deviceId || conns[p.owner]) : true);
    const tag = you ? ' 📱' : (p.owner ? '' : ' •');
    html += `<th class="${you ? 'col-you' : ''}">${esc(p.name)}${tag}</th>`;
  });
  html += '</tr></thead><tbody>';

  html += sectionRow('Oberer Teil', players.length);
  UPPER_FIELDS.forEach(f => { html += fieldRow(f); });
  html += calcRow('Zwischensumme', p => `${computeTotals(p.scores).upper}<span class="sub">/63</span>`);
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
      if (p && canEdit(p)) openEntry(pid, key);
    });
  });
}

function fieldRow(f) {
  let html = `<tr><td class="row-label">${f.label}</td>`;
  game.players.forEach(p => {
    const v = p.scores[f.key];
    const editable = canEdit(p);
    let cls = 'cell' + (editable ? ' editable' : '') + (p.owner === deviceId ? ' col-you' : '');
    let inner = '';
    if (v != null) { if (v === 0) cls += ' struck'; inner = v === 0 ? '✕' : v; }
    else if (editable) inner = '<span class="tap">+</span>';
    html += `<td class="${cls}" data-pid="${p.pid}" data-key="${f.key}">${inner}</td>`;
  });
  return html + '</tr>';
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

  if (UPPER_KEYS.includes(key)) buildUpperPicker(pid, key, f);
  else if (SUM_LOWER_KEYS.includes(key)) buildSumPicker(pid, key, f);
  else buildFixedPicker(pid, key, f);

  if (p.scores[key] != null) {
    const clr = document.createElement('button');
    clr.className = 'btn btn--ghost'; clr.textContent = 'Eintrag löschen';
    clr.addEventListener('click', () => commitEntry(pid, key, null));
    modalActions.appendChild(clr);
  }
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

function commitEntry(pid, key, value) {
  editCell(pid, key, value);
  closeModal();
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

// ---------------- UI: Navigation ----------------
document.getElementById('btnHostStart').addEventListener('click', () => { showScreen('screen-host'); document.getElementById('hostName').focus(); });
document.getElementById('btnJoinStart').addEventListener('click', () => { showScreen('screen-join'); });
document.getElementById('btnHostBack').addEventListener('click', () => showScreen('screen-home'));
document.getElementById('btnJoinBack').addEventListener('click', () => showScreen('screen-home'));

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
  try { if (peer) peer.destroy(); } catch (e) {}
  peer = null; conn = null; game = null; isHost = false; myPid = null;
  for (const k in conns) delete conns[k];
  clearSession();
  setStatus('offline');
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
  setGame(g) { game = g; }, setHost(v) { isHost = v; }, deviceId };

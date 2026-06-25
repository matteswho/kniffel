/* ============================================================
   Kniffel – mobiler Spielbogen mit 3 Spalten
   Reines Vanilla-JS, Zustand in localStorage.
   ============================================================ */

const COLUMNS = 3;
const STORAGE_KEY = 'kniffel-state-v1';
const SETTINGS_KEY = 'kniffel-settings-v1';
const BONUS_THRESHOLD = 63;
const BONUS_POINTS = 35;

// Feld-Definitionen --------------------------------------------------
const UPPER_FIELDS = [
  { key: 'ones',   label: 'Einser',  face: 1, hint: 'nur Einser zählen' },
  { key: 'twos',   label: 'Zweier',  face: 2, hint: 'nur Zweier zählen' },
  { key: 'threes', label: 'Dreier',  face: 3, hint: 'nur Dreier zählen' },
  { key: 'fours',  label: 'Vierer',  face: 4, hint: 'nur Vierer zählen' },
  { key: 'fives',  label: 'Fünfer',  face: 5, hint: 'nur Fünfer zählen' },
  { key: 'sixes',  label: 'Sechser', face: 6, hint: 'nur Sechser zählen' },
];

const LOWER_FIELDS = [
  { key: 'threeKind', label: 'Dreierpasch',   hint: 'alle Augen, ≥3 gleiche' },
  { key: 'fourKind',  label: 'Viererpasch',   hint: 'alle Augen, ≥4 gleiche' },
  { key: 'fullHouse', label: 'Full House',    hint: '25 Punkte' },
  { key: 'smallStr',  label: 'Kleine Straße', hint: '30 Punkte' },
  { key: 'largeStr',  label: 'Große Straße',  hint: '40 Punkte' },
  { key: 'kniffel',   label: 'Kniffel',       hint: '50 Punkte' },
  { key: 'chance',    label: 'Chance',        hint: 'alle Augen' },
];

const ALL_FIELDS = [...UPPER_FIELDS, ...LOWER_FIELDS];

// ------------------------------------------------------------------
// Zustand
// ------------------------------------------------------------------
let state = loadState();
let settings = loadSettings();
let dice = [1, 2, 3, 4, 5];

// Rundenlogik: max. 3 Würfe, Würfel können gehalten werden
const MAX_ROLLS = 3;
let rollsUsed = 0;
let held = [false, false, false, false, false];
const hasRolled = () => rollsUsed > 0;

// Feld-Kategorien für den manuellen Modus
const UPPER_KEYS = UPPER_FIELDS.map(f => f.key);
const SUM_LOWER_KEYS = ['threeKind', 'fourKind', 'chance']; // Wert = Augensumme
const FIXED_LOWER = { fullHouse: 25, smallStr: 30, largeStr: 40, kniffel: 50 };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return Object.assign({ manualMode: false }, JSON.parse(raw));
  } catch (e) { /* ignore */ }
  return { manualMode: false };
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

function emptyScores() {
  // scores[col][key] = number | null
  return Array.from({ length: COLUMNS }, () => {
    const o = {};
    ALL_FIELDS.forEach(f => { o[f.key] = null; });
    return o;
  });
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.scores) && parsed.scores.length === COLUMNS) {
        return parsed;
      }
    }
  } catch (e) { /* ignore */ }
  return { scores: emptyScores() };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------
// Würfel-Logik / Scoring
// ------------------------------------------------------------------
function counts(d) {
  const c = [0, 0, 0, 0, 0, 0, 0]; // index 1..6
  d.forEach(v => { c[v]++; });
  return c;
}
function sum(d) { return d.reduce((a, b) => a + b, 0); }

function hasStraight(c, len) {
  let run = 0;
  for (let i = 1; i <= 6; i++) {
    if (c[i] > 0) { run++; if (run >= len) return true; }
    else run = 0;
  }
  return false;
}

// Punktzahl, die der aktuelle Wurf in einem Feld bringen würde
function scoreFor(key, d) {
  const c = counts(d);
  const s = sum(d);
  switch (key) {
    case 'ones':   return c[1] * 1;
    case 'twos':   return c[2] * 2;
    case 'threes': return c[3] * 3;
    case 'fours':  return c[4] * 4;
    case 'fives':  return c[5] * 5;
    case 'sixes':  return c[6] * 6;
    case 'threeKind': return c.some(n => n >= 3) ? s : 0;
    case 'fourKind':  return c.some(n => n >= 4) ? s : 0;
    case 'fullHouse': {
      const has3 = c.some(n => n === 3);
      const has2 = c.some(n => n === 2);
      const has5 = c.some(n => n === 5);
      return (has3 && has2) || has5 ? 25 : 0;
    }
    case 'smallStr': return hasStraight(c, 4) ? 30 : 0;
    case 'largeStr': return hasStraight(c, 5) ? 40 : 0;
    case 'kniffel':  return c.some(n => n === 5) ? 50 : 0;
    case 'chance':   return s;
    default: return 0;
  }
}

// ------------------------------------------------------------------
// Spaltensummen
// ------------------------------------------------------------------
function columnTotals(col) {
  const sc = state.scores[col];
  let upper = 0, lower = 0;
  UPPER_FIELDS.forEach(f => { if (sc[f.key] != null) upper += sc[f.key]; });
  LOWER_FIELDS.forEach(f => { if (sc[f.key] != null) lower += sc[f.key]; });
  const bonus = upper >= BONUS_THRESHOLD ? BONUS_POINTS : 0;
  return {
    upper,
    bonus,
    upperTotal: upper + bonus,
    lower,
    grand: upper + bonus + lower,
    remainingForBonus: Math.max(0, BONUS_THRESHOLD - upper),
  };
}

// ------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------
const diceRow = document.getElementById('diceRow');
const sheetTable = document.getElementById('sheetTable');

// Erzeugt ein Würfel-Element mit den passenden Pips für einen Wert.
function buildDie(value) {
  const die = document.createElement('div');
  die.className = 'die';
  die.dataset.v = value;
  for (let p = 0; p < value; p++) {
    const pip = document.createElement('span');
    pip.className = 'pip';
    die.appendChild(pip);
  }
  return die;
}

function renderDice() {
  diceRow.innerHTML = '';
  const rolled = hasRolled();
  dice.forEach((v, i) => {
    let die;
    if (!rolled) {
      die = document.createElement('div');
      die.className = 'die die--empty';
      die.textContent = '?';
    } else {
      die = buildDie(v);
      if (held[i]) die.classList.add('held');
    }
    die.dataset.i = i;
    die.addEventListener('click', () => onDieClick(i));
    diceRow.appendChild(die);
  });
}

// Würfel halten/freigeben – nur sinnvoll nach einem Wurf und solange
// noch Würfe übrig sind.
function onDieClick(i) {
  if (rollsUsed === 0 || rollsUsed >= MAX_ROLLS) return;
  held[i] = !held[i];
  renderDice();
}

// Einen Wurf ausführen: beim 1. Wurf alle Würfel, danach nur die nicht
// gehaltenen.
function rollDice() {
  if (rollsUsed >= MAX_ROLLS) return;
  rollsUsed++;
  const first = rollsUsed === 1;
  diceRow.querySelectorAll('.die').forEach((el, i) => {
    if (first || !held[i]) el.classList.add('is-rolling');
  });
  let ticks = 0;
  const iv = setInterval(() => {
    for (let i = 0; i < 5; i++) {
      if (first || !held[i]) dice[i] = 1 + Math.floor(Math.random() * 6);
    }
    renderDice();
    if (++ticks >= 6) {
      clearInterval(iv);
      updateControls();
      renderSheet();
    }
  }, 70);
}

// Neue Runde starten: Würfe und Halte-Markierungen zurücksetzen.
function nextRound() {
  rollsUsed = 0;
  held = [false, false, false, false, false];
  renderDice();
  updateControls();
  renderSheet();
}

// Würfel-Button und Status-Text aktualisieren.
function updateControls() {
  const remaining = MAX_ROLLS - rollsUsed;
  const rollBtn = document.getElementById('rollBtn');
  const status = document.getElementById('rollStatus');
  if (remaining > 0) {
    rollBtn.disabled = false;
    rollBtn.textContent = rollsUsed === 0 ? '🎲 Würfeln' : `🎲 Nochmal (${remaining})`;
  } else {
    rollBtn.disabled = true;
    rollBtn.textContent = 'Keine Würfe mehr';
  }
  const labels = [
    'Bereit – tippe „Würfeln" für die nächste Runde',
    '1. Wurf · Würfel antippen zum Halten',
    '2. Wurf · Würfel antippen zum Halten',
    '3. Wurf · jetzt ein Feld eintragen',
  ];
  status.textContent = labels[rollsUsed];
}

function colHeader() {
  let html = '<thead><tr><th class="row-label">Feld</th>';
  for (let c = 0; c < COLUMNS; c++) html += `<th>Spalte ${c + 1}</th>`;
  html += '</tr></thead>';
  return html;
}

function fieldRow(f, isUpper) {
  let html = `<tr><td class="row-label">${f.label}<small>${f.hint}</small></td>`;
  for (let c = 0; c < COLUMNS; c++) {
    const v = state.scores[c][f.key];
    let classes = 'cell';
    let inner = '';
    if (v != null) {
      if (v === 0) classes += ' struck';
      inner = `<span class="val">${v === 0 ? '✕' : v}</span>`;
    } else if (hasRolled()) {
      // Geister-Vorschau anhand der aktuellen Würfel (nur nach dem Wurf)
      const ghost = scoreFor(f.key, dice);
      inner = `<span class="ghost">${ghost}</span>`;
    }
    html += `<td class="${classes}" data-col="${c}" data-key="${f.key}">${inner}</td>`;
  }
  html += '</tr>';
  return html;
}

function calcRow(label, valuesFn, opts = {}) {
  let html = `<tr class="calc-row"><td class="row-label">${label}</td>`;
  for (let c = 0; c < COLUMNS; c++) {
    const cellHtml = valuesFn(c);
    html += `<td class="calc-cell ${opts.cls ? opts.cls(c) : ''}">${cellHtml}</td>`;
  }
  html += '</tr>';
  return html;
}

function renderSheet() {
  let html = colHeader() + '<tbody>';

  html += '<tr class="section-row"><td colspan="' + (COLUMNS + 1) + '">Oberer Teil</td></tr>';
  UPPER_FIELDS.forEach(f => { html += fieldRow(f, true); });

  // Zwischensumme oben
  html += calcRow('Zwischensumme', c => {
    const t = columnTotals(c);
    return `${t.upper}<span class="sub">von 63</span>`;
  });

  // Bonus
  html += calcRow('Bonus (+35)', c => {
    const t = columnTotals(c);
    if (t.bonus > 0) return `+35`;
    return `<span class="sub">noch ${t.remainingForBonus}</span>`;
  }, { cls: c => columnTotals(c).bonus > 0 ? 'bonus-ok' : 'bonus-miss' });

  // Summe oben
  html += calcRow('Summe oben', c => `${columnTotals(c).upperTotal}`);

  html += '<tr class="section-row"><td colspan="' + (COLUMNS + 1) + '">Unterer Teil</td></tr>';
  LOWER_FIELDS.forEach(f => { html += fieldRow(f, false); });

  html += calcRow('Summe unten', c => `${columnTotals(c).lower}`);

  // Gesamt je Spalte
  let grandHtml = `<tr class="grand-row"><td class="row-label">Gesamt</td>`;
  for (let c = 0; c < COLUMNS; c++) grandHtml += `<td>${columnTotals(c).grand}</td>`;
  grandHtml += '</tr>';
  html += grandHtml;

  html += '</tbody>';
  sheetTable.innerHTML = html;

  // Zell-Listener
  sheetTable.querySelectorAll('td.cell').forEach(td => {
    td.addEventListener('click', () => openCellModal(+td.dataset.col, td.dataset.key));
  });
}

// ------------------------------------------------------------------
// Zellen-Modal
// ------------------------------------------------------------------
const modal = document.getElementById('cellModal');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');
const modalActions = document.getElementById('modalActions');
const manualInput = document.getElementById('manualInput');
let modalTarget = null;

const modalPicker = document.getElementById('modalPicker');

function fieldDef(key) { return ALL_FIELDS.find(f => f.key === key); }

function openCellModal(col, key) {
  modalTarget = { col, key };
  const f = fieldDef(key);
  modalTitle.textContent = `${f.label} – Spalte ${col + 1}`;
  modalPicker.innerHTML = '';
  modalActions.innerHTML = '';
  manualInput.value = '';

  if (settings.manualMode) {
    buildManualModal(col, key, f);
  } else {
    buildDigitalModal(col, key, f);
  }

  // „Eintrag löschen" gibt es in beiden Modi, falls belegt.
  if (state.scores[col][key] != null) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn--ghost';
    clearBtn.textContent = 'Eintrag löschen';
    clearBtn.addEventListener('click', () => setCell(col, key, null));
    modalActions.appendChild(clearBtn);
  }

  modal.hidden = false;
}

// --- Standardmodus: Übernahme der gewürfelten Augen ---------------------
function buildDigitalModal(col, key, f) {
  const current = state.scores[col][key];
  const rolled = hasRolled();
  const ghost = scoreFor(key, dice);

  modalSub.textContent = current != null
    ? `Aktuell: ${current === 0 ? 'gestrichen' : current + ' Punkte'}`
    : (rolled
        ? `Aktuelle Würfel ergeben hier ${ghost} Punkte.`
        : `Noch nicht gewürfelt – Wert von Hand eintragen oder streichen.`);

  if (rolled) {
    addBtn('btn--accent', `Würfel eintragen: ${ghost} Punkte`, () => setCell(col, key, ghost));
  }
  addBtn('btn--ghost', 'Streichen (0 Punkte)', () => setCell(col, key, 0));
}

// --- Manueller Modus: eigene Würfel anklicken ---------------------------
function buildManualModal(col, key, f) {
  if (UPPER_KEYS.includes(key)) {
    buildUpperPicker(col, key, f);
  } else if (SUM_LOWER_KEYS.includes(key)) {
    buildSumPicker(col, key, f);
  } else {
    buildFixedPicker(col, key, f); // Full House, Straßen, Kniffel
  }
}

// Oberer Teil: 5 Würfel der jeweiligen Augenzahl an-/abwählen.
function buildUpperPicker(col, key, f) {
  modalSub.textContent = `Tippe die ${f.label} an, die du gewürfelt hast.`;
  const active = [false, false, false, false, false];
  const row = document.createElement('div');
  row.className = 'dice-row dice-row--modal';
  modalPicker.appendChild(row);

  const confirm = addBtn('btn--accent', '', () =>
    setCell(col, key, active.filter(Boolean).length * f.face));
  modalActions.appendChild(makeStrike(col, key));

  const update = () => {
    confirm.textContent = `Eintragen: ${active.filter(Boolean).length * f.face} Punkte`;
  };
  for (let i = 0; i < 5; i++) {
    const die = buildDie(f.face);
    die.classList.add('die--off');
    die.addEventListener('click', () => {
      active[i] = !active[i];
      die.classList.toggle('die--off', !active[i]);
      update();
    });
    row.appendChild(die);
  }
  update();
}

// Pasch / Chance: 5 Würfel mit echten Augen einstellen → Augensumme.
function buildSumPicker(col, key, f) {
  modalSub.textContent = 'Stelle deine 5 Würfel ein (antippen erhöht die Augen).';
  const vals = [1, 1, 1, 1, 1];
  const row = document.createElement('div');
  row.className = 'dice-row dice-row--modal';
  modalPicker.appendChild(row);

  const confirm = addBtn('btn--accent', '', () => setCell(col, key, scoreFor(key, vals)));
  modalActions.appendChild(makeStrike(col, key));

  const update = () => {
    const pts = scoreFor(key, vals);
    confirm.textContent = pts > 0 ? `Eintragen: ${pts} Punkte` : 'Eintragen: 0 (nicht erfüllt)';
  };
  const renderRow = () => {
    row.innerHTML = '';
    vals.forEach((v, i) => {
      const die = buildDie(v);
      die.addEventListener('click', () => {
        vals[i] = (vals[i] % 6) + 1;
        renderRow();
        update();
      });
      row.appendChild(die);
    });
  };
  renderRow();
  update();
}

// Full House / Straßen / Kniffel: Festwert erreicht oder streichen.
function buildFixedPicker(col, key, f) {
  const pts = FIXED_LOWER[key];
  modalSub.textContent = `${f.label} ist ${pts} Punkte wert – erreicht?`;
  addBtn('btn--accent', `Geschafft: ${pts} Punkte`, () => setCell(col, key, pts));
  modalActions.appendChild(makeStrike(col, key));
}

function makeStrike(col, key) {
  const b = document.createElement('button');
  b.className = 'btn btn--ghost';
  b.textContent = 'Streichen (0 Punkte)';
  b.addEventListener('click', () => setCell(col, key, 0));
  return b;
}

// Kleiner Helfer: Button erzeugen, an modalActions hängen, zurückgeben.
function addBtn(cls, text, onClick) {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.addEventListener('click', onClick);
  modalActions.appendChild(b);
  return b;
}

function setCell(col, key, value) {
  state.scores[col][key] = value;
  saveState();
  closeModal();
  if (value !== null && !settings.manualMode) {
    // Standardmodus: Eintrag (auch Streichen) beendet die Runde → neuer Wurf
    nextRound();
  } else {
    renderSheet();
  }
}

function closeModal() {
  modal.hidden = true;
  modalPicker.innerHTML = '';
  modalTarget = null;
}

document.getElementById('modalBackdrop').addEventListener('click', closeModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);
document.getElementById('manualOk').addEventListener('click', () => {
  if (!modalTarget) return;
  const raw = manualInput.value.trim();
  if (raw === '') return;
  const v = Math.max(0, Math.min(375, parseInt(raw, 10) || 0));
  setCell(modalTarget.col, modalTarget.key, v);
});

// ------------------------------------------------------------------
// Buttons
// ------------------------------------------------------------------
document.getElementById('rollBtn').addEventListener('click', rollDice);
document.getElementById('nextRoundBtn').addEventListener('click', nextRound);

// ------------------------------------------------------------------
// Einstellungen / Spielmodus
// ------------------------------------------------------------------
const settingsModal = document.getElementById('settingsModal');
const manualToggle = document.getElementById('manualToggle');
const dicePanel = document.querySelector('.dice-panel');

// Würfelbereich passend zum Modus ein-/ausblenden.
function applyMode() {
  manualToggle.checked = settings.manualMode;
  dicePanel.hidden = settings.manualMode;
  document.body.classList.toggle('manual-mode', settings.manualMode);
  if (settings.manualMode) {
    rollsUsed = 0;
    held = [false, false, false, false, false];
  }
  renderSheet();
}

function openSettings() { settingsModal.hidden = false; }
function closeSettings() { settingsModal.hidden = true; }

document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('settingsBackdrop').addEventListener('click', closeSettings);
document.getElementById('settingsClose').addEventListener('click', closeSettings);
manualToggle.addEventListener('change', () => {
  settings.manualMode = manualToggle.checked;
  saveSettings();
  applyMode();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('Neues Spiel starten? Alle Eintragungen werden gelöscht.')) {
    state = { scores: emptyScores() };
    saveState();
    nextRound();
  }
});

// ------------------------------------------------------------------
// Service Worker (offline)
// ------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// Start
renderDice();
updateControls();
applyMode();
renderSheet();

/* ============================================================
   Kniffel – mobiler Spielbogen mit 3 Spalten und Bonus-Tipp
   Reines Vanilla-JS, Zustand in localStorage.
   ============================================================ */

const COLUMNS = 3;
const STORAGE_KEY = 'kniffel-state-v1';
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
const UPPER_KEYS = UPPER_FIELDS.map(f => f.key);

// ------------------------------------------------------------------
// Zustand
// ------------------------------------------------------------------
let state = loadState();
let dice = [1, 2, 3, 4, 5];
let activeTip = null; // { col, key }

// Rundenlogik: max. 3 Würfe, Würfel können gehalten werden
const MAX_ROLLS = 3;
let rollsUsed = 0;
let held = [false, false, false, false, false];
const hasRolled = () => rollsUsed > 0;

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
// Tipp-Engine
// ------------------------------------------------------------------
// Bewertet jede offene Zelle. Für den oberen Teil wird der "Schnitt"
// von 3 gleichen Augen als Maßstab genommen (3×Augenzahl = genau die
// 63-Punkte-Grenze). Überschuss ist gut für den Bonus, Defizit schlecht.
const BONUS_WEIGHT = BONUS_POINTS / BONUS_THRESHOLD; // ≈ 0.56 Punkte je Augen-Überschuss

function buildTips(d) {
  const options = [];
  for (let col = 0; col < COLUMNS; col++) {
    const sc = state.scores[col];
    const totals = columnTotals(col);
    for (const f of ALL_FIELDS) {
      if (sc[f.key] != null) continue; // belegt
      const base = scoreFor(f.key, d);
      let value = base;
      let reason = '';
      const isUpper = UPPER_KEYS.includes(f.key);

      if (isUpper) {
        const par = 3 * f.face;          // 3 gleiche = Bonus-Schnitt
        const surplus = base - par;      // >0 hilft dem Bonus
        // Bonus nur relevant, solange er noch nicht sicher ist
        const bonusStillOpen = totals.upper < BONUS_THRESHOLD;
        const weight = bonusStillOpen ? BONUS_WEIGHT : 0;
        value = base + surplus * weight;
        if (base === 0) {
          reason = 'leer – nur als Streichfeld sinnvoll';
        } else if (surplus > 0) {
          reason = `${base} Pkt · +${surplus} über dem Bonus-Schnitt 👍`;
        } else if (surplus === 0) {
          reason = `${base} Pkt · genau auf Bonus-Kurs`;
        } else {
          reason = `${base} Pkt · ${surplus} unter dem Schnitt (Bonus leidet)`;
        }
      } else {
        reason = base > 0 ? `${base} Punkte` : 'leer – Streichfeld';
        // Kleiner Bonus-Anreiz, schwache Würfe NICHT in Chance zu kippen,
        // damit gute obere Felder frei bleiben – rein über value=base genug.
      }

      options.push({ col, key: f.key, label: f.label, base, value, reason, isUpper });
    }
  }

  // Sortierung: höchster gewichteter Wert zuerst; bei Gleichstand mehr Rohpunkte
  options.sort((a, b) => (b.value - a.value) || (b.base - a.base));
  return options;
}

// ------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------
const diceRow = document.getElementById('diceRow');
const sheetTable = document.getElementById('sheetTable');

function renderDice() {
  diceRow.innerHTML = '';
  const rolled = hasRolled();
  dice.forEach((v, i) => {
    const die = document.createElement('div');
    die.className = 'die';
    die.dataset.i = i;
    if (!rolled) {
      die.classList.add('die--empty');
      die.textContent = '?';
    } else {
      die.dataset.v = v;
      if (held[i]) die.classList.add('held');
      for (let p = 0; p < v; p++) {
        const pip = document.createElement('span');
        pip.className = 'pip';
        die.appendChild(pip);
      }
    }
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
  clearTip();
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
  clearTip();
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
    const isTip = activeTip && activeTip.col === c && activeTip.key === f.key;
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
    if (isTip) classes += ' tip-target tip-best';
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
// Tipp-Anzeige
// ------------------------------------------------------------------
const tipBox = document.getElementById('tipBox');
const tipList = document.getElementById('tipList');

function showTips() {
  if (!hasRolled()) {
    tipList.innerHTML = '<li>Würfle zuerst – dann zeige ich dir die beste Eintragung.</li>';
    tipBox.hidden = false;
    return;
  }
  const options = buildTips(dice).filter(o => o.base > 0); // sinnvolle Einträge zuerst
  const fallback = buildTips(dice);                        // falls alles 0 ist
  const list = (options.length ? options : fallback).slice(0, 4);

  if (!list.length) {
    tipBox.hidden = true;
    return;
  }

  activeTip = { col: list[0].col, key: list[0].key };

  tipList.innerHTML = list.map((o, idx) => {
    const cls = idx === 0 ? 'best' : '';
    const pts = o.base > 0 ? `<span class="tip-pts">${o.base} Pkt</span>` : `<span class="tip-pts">streichen</span>`;
    return `<li class="${cls}">Spalte ${o.col + 1} · ${o.label} — ${pts}
      <span class="tip-reason">${o.reason}</span></li>`;
  }).join('');

  tipBox.hidden = false;
  renderSheet();
  tipBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearTip() {
  if (activeTip) {
    activeTip = null;
    tipBox.hidden = true;
  }
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

function fieldDef(key) { return ALL_FIELDS.find(f => f.key === key); }

function openCellModal(col, key) {
  modalTarget = { col, key };
  const f = fieldDef(key);
  const current = state.scores[col][key];
  const rolled = hasRolled();
  const ghost = scoreFor(key, dice);

  modalTitle.textContent = `${f.label} – Spalte ${col + 1}`;
  modalSub.textContent = current != null
    ? `Aktuell: ${current === 0 ? 'gestrichen' : current + ' Punkte'}`
    : (rolled
        ? `Aktuelle Würfel ergeben hier ${ghost} Punkte.`
        : `Noch nicht gewürfelt – Wert von Hand eintragen oder streichen.`);

  modalActions.innerHTML = '';

  // Aktuelle Würfel eintragen (nur nach dem Wurf)
  if (rolled) {
    const enterBtn = document.createElement('button');
    enterBtn.className = 'btn btn--accent';
    enterBtn.textContent = `Würfel eintragen: ${ghost} Punkte`;
    enterBtn.addEventListener('click', () => setCell(col, key, ghost));
    modalActions.appendChild(enterBtn);
  }

  // Streichen
  const strikeBtn = document.createElement('button');
  strikeBtn.className = 'btn btn--ghost';
  strikeBtn.textContent = 'Streichen (0 Punkte)';
  strikeBtn.addEventListener('click', () => setCell(col, key, 0));
  modalActions.appendChild(strikeBtn);

  // Leeren (nur falls belegt)
  if (current != null) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn--ghost';
    clearBtn.textContent = 'Eintrag löschen';
    clearBtn.addEventListener('click', () => setCell(col, key, null));
    modalActions.appendChild(clearBtn);
  }

  manualInput.value = '';
  modal.hidden = false;
}

function setCell(col, key, value) {
  state.scores[col][key] = value;
  saveState();
  closeModal();
  if (value !== null) {
    // Eintrag (auch Streichen) beendet die Runde → neuer Wurf
    nextRound();
  } else {
    clearTip();
    renderSheet();
  }
}

function closeModal() { modal.hidden = true; modalTarget = null; }

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
document.getElementById('tipBtn').addEventListener('click', showTips);
document.getElementById('tipClose').addEventListener('click', () => clearTip() || renderSheet());

document.getElementById('rollBtn').addEventListener('click', rollDice);
document.getElementById('nextRoundBtn').addEventListener('click', nextRound);

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
renderSheet();

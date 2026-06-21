'use strict';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let STATE = { categories: [], games: [], members: [], imports: [] };

async function api(path, opts) {
  const res = await fetch('/api/' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind || '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}

async function refresh() {
  STATE = await api('state');
  renderAll();
}

function renderAll() {
  renderLeaderboard();
  renderUploadGames();
  renderGames();
  renderCategories();
  renderHistory();
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function showTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
}
$$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('click', (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) { e.preventDefault(); showTab(goto.dataset.goto); }
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
function renderLeaderboard() {
  const q = ($('#memberSearch').value || '').toLowerCase();
  const members = STATE.members.filter(
    (m) => !q || m.email.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)
  );
  const tbody = $('#memberRows');
  tbody.innerHTML = members
    .map((m, i) => `<tr>
      <td class="rank">${i + 1}</td>
      <td>${esc(m.name || '—')}</td>
      <td>${esc(m.email)}</td>
      <td class="num points-cell">${m.points}</td>
    </tr>`)
    .join('');
  const total = STATE.members.reduce((a, b) => a + b.points, 0);
  $('#memberSummary').textContent =
    `${STATE.members.length} people · ${total} points awarded total`;
  $('#memberEmpty').hidden = STATE.members.length > 0;
}
$('#memberSearch').addEventListener('input', renderLeaderboard);

$('#exportBtn').addEventListener('click', () => {
  if (!STATE.members.length) return toast('Nothing to export yet.', 'bad');
  const rows = [['Name', 'Email', 'Points']].concat(
    STATE.members.map((m) => [m.name || '', m.email, m.points])
  );
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  download('leaderboard.csv', csv);
});

function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function download(name, text) {
  const blob = new Blob([text], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// CSV parsing (handles quoted fields, commas, CRLF)
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  text = text.replace(/^﻿/, ''); // strip BOM
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); field = ''; row = [];
    } else if (c === '\r') {
      // ignore; \n handles row break
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj = {};
      header.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
      return obj;
    });
}

// ---------------------------------------------------------------------------
// Upload flow
// ---------------------------------------------------------------------------
let pendingRows = null;
let pendingFileName = '';

function renderUploadGames() {
  const sel = $('#uploadGame');
  sel.innerHTML = STATE.games
    .map((g) => `<option value="${g.id}">${esc(g.name)} — ${g.categoryName} (${g.effectivePoints} pts/ticket)</option>`)
    .join('');
  const none = STATE.games.length === 0;
  $('#noGamesHint').hidden = !none;
  sel.disabled = none;
}

function currentCountMode() {
  return $$('input[name="countMode"]').find((r) => r.checked).value;
}

function handleFile(file) {
  if (!file) return;
  pendingFileName = file.name;
  $('#fileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      pendingRows = parseCSV(reader.result);
      if (!pendingRows.length) { toast('No data rows found in that file.', 'bad'); return; }
      doPreview();
    } catch (e) {
      toast('Could not read that CSV: ' + e.message, 'bad');
    }
  };
  reader.readAsText(file);
}

async function doPreview() {
  const gameId = $('#uploadGame').value;
  if (!gameId) { toast('Pick a game first.', 'bad'); return; }
  if (!pendingRows) { toast('Choose a CSV file first.', 'bad'); return; }
  try {
    const p = await api('preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, rows: pendingRows, countMode: currentCountMode() }),
    });
    $('#previewStats').innerHTML = `
      <div class="card"><div class="big">${p.ticketsCounted}</div><div class="lbl">tickets counted</div></div>
      <div class="card"><div class="big">${p.emailsAffected}</div><div class="lbl">people</div></div>
      <div class="card"><div class="big">${p.pointsPerTicket}</div><div class="lbl">points / ticket</div></div>
      <div class="card"><div class="big">${p.totalPoints}</div><div class="lbl">total points</div></div>`;
    $('#previewRows').innerHTML = p.perEmail
      .map((e) => `<tr><td>${esc(e.name || '—')}</td><td>${esc(e.email)}</td><td class="num">${e.tickets}</td><td class="num points-cell">${e.points}</td></tr>`)
      .join('');
    $('#previewBox').hidden = false;
    $('#applyBtn').dataset.game = gameId;
  } catch (e) {
    toast(e.message, 'bad');
  }
}

$('#browseBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
$('#uploadGame').addEventListener('change', () => { if (pendingRows) doPreview(); });
$$('input[name="countMode"]').forEach((r) => r.addEventListener('change', () => { if (pendingRows) doPreview(); }));

const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); }));
drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

$('#cancelPreview').addEventListener('click', resetUpload);
function resetUpload() {
  pendingRows = null; pendingFileName = '';
  $('#previewBox').hidden = true;
  $('#fileName').textContent = '';
  $('#fileInput').value = '';
}

$('#applyBtn').addEventListener('click', async () => {
  const gameId = $('#applyBtn').dataset.game;
  try {
    await api('import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, rows: pendingRows, countMode: currentCountMode(), fileName: pendingFileName }),
    });
    resetUpload();
    await refresh();
    showTab('leaderboard');
    toast('Points applied!', 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
});

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------
function renderGames() {
  const wrap = $('#gamesByCategory');
  $('#gamesEmpty').hidden = STATE.games.length > 0;
  if (!STATE.games.length) { wrap.innerHTML = ''; return; }
  const byCat = {};
  STATE.games.forEach((g) => { (byCat[g.categoryId] = byCat[g.categoryId] || []).push(g); });
  wrap.innerHTML = STATE.categories
    .filter((c) => byCat[c.id])
    .map((c) => {
      const games = byCat[c.id]
        .map((g) => `<div class="game-row">
          <div>
            <div>${esc(g.name)}</div>
            <div class="meta">${g.usesDefault ? 'uses category default' : 'custom points'}</div>
          </div>
          <div class="row-actions">
            <span class="pts">${g.effectivePoints} pts</span>
            <button class="btn small" data-edit-game="${g.id}">Edit</button>
            <button class="btn small danger" data-del-game="${g.id}">Delete</button>
          </div>
        </div>`).join('');
      return `<div class="cat-group"><h3>${esc(c.name)} <span class="badge">${c.defaultPoints} default pts/ticket</span></h3>${games}</div>`;
    }).join('');
}

$('#addGameBtn').addEventListener('click', () => {
  if (!STATE.categories.length) return toast('Add a category first.', 'bad');
  openGameModal(null);
});
document.addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit-game]');
  if (edit) openGameModal(STATE.games.find((g) => g.id === edit.dataset.editGame));
  const del = e.target.closest('[data-del-game]');
  if (del) deleteGame(del.dataset.delGame);
});

function openGameModal(game) {
  const catOpts = STATE.categories
    .map((c) => `<option value="${c.id}" ${game && game.categoryId === c.id ? 'selected' : ''}>${esc(c.name)} (${c.defaultPoints} pts)</option>`)
    .join('');
  const usesDefault = !game || game.usesDefault;
  modal(game ? 'Edit game' : 'Add game', `
    <label class="field"><span>Game name</span>
      <input type="text" id="m_name" placeholder="e.g. Football vs. Lincoln (Oct 4)" value="${game ? esc(game.name) : ''}" /></label>
    <label class="field"><span>Category</span><select id="m_cat">${catOpts}</select></label>
    <label class="field"><input type="checkbox" id="m_useDefault" ${usesDefault ? 'checked' : ''} /> Use category default points</label>
    <label class="field"><span>Points per ticket</span>
      <input type="number" id="m_points" value="${game && !game.usesDefault ? game.points : ''}" ${usesDefault ? 'disabled' : ''} /></label>
  `, async () => {
    const useDefault = $('#m_useDefault').checked;
    const body = {
      id: game ? game.id : undefined,
      name: $('#m_name').value,
      categoryId: $('#m_cat').value,
      points: useDefault ? null : $('#m_points').value,
    };
    STATE = await api('games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    renderAll();
    toast('Game saved.', 'good');
  });
  // wire default checkbox -> toggle points input, prefill with category default
  const sync = () => {
    const use = $('#m_useDefault').checked;
    const ptsInput = $('#m_points');
    ptsInput.disabled = use;
    if (use) {
      const cat = STATE.categories.find((c) => c.id === $('#m_cat').value);
      ptsInput.value = cat ? cat.defaultPoints : '';
    }
  };
  $('#m_useDefault').addEventListener('change', sync);
  $('#m_cat').addEventListener('change', sync);
  sync();
}

async function deleteGame(id) {
  const g = STATE.games.find((x) => x.id === id);
  if (!confirm(`Delete game "${g ? g.name : ''}"?`)) return;
  try {
    STATE = await api('games/' + id, { method: 'DELETE' });
    renderAll();
    toast('Game deleted.', 'good');
  } catch (e) { toast(e.message, 'bad'); }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
function renderCategories() {
  const counts = {};
  STATE.games.forEach((g) => { counts[g.categoryId] = (counts[g.categoryId] || 0) + 1; });
  $('#catRows').innerHTML = STATE.categories
    .map((c) => `<tr>
      <td>${esc(c.name)}</td>
      <td class="num">${c.defaultPoints}</td>
      <td class="num">${counts[c.id] || 0}</td>
      <td class="num row-actions" style="justify-content:flex-end;display:flex;gap:.4rem">
        <button class="btn small" data-edit-cat="${c.id}">Edit</button>
        <button class="btn small danger" data-del-cat="${c.id}">Delete</button>
      </td></tr>`)
    .join('');
}

$('#addCatBtn').addEventListener('click', () => openCatModal(null));
document.addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit-cat]');
  if (edit) openCatModal(STATE.categories.find((c) => c.id === edit.dataset.editCat));
  const del = e.target.closest('[data-del-cat]');
  if (del) deleteCat(del.dataset.delCat);
});

function openCatModal(cat) {
  modal(cat ? 'Edit category' : 'Add category', `
    <label class="field"><span>Category name</span>
      <input type="text" id="c_name" placeholder="e.g. Wrestling" value="${cat ? esc(cat.name) : ''}" /></label>
    <label class="field"><span>Default points per ticket</span>
      <input type="number" id="c_points" value="${cat ? cat.defaultPoints : 10}" /></label>
  `, async () => {
    const body = { id: cat ? cat.id : undefined, name: $('#c_name').value, defaultPoints: $('#c_points').value };
    STATE = await api('categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    renderAll();
    toast('Category saved.', 'good');
  });
}

async function deleteCat(id) {
  const c = STATE.categories.find((x) => x.id === id);
  if (!confirm(`Delete category "${c ? c.name : ''}"?`)) return;
  try {
    STATE = await api('categories/' + id, { method: 'DELETE' });
    renderAll();
    toast('Category deleted.', 'good');
  } catch (e) { toast(e.message, 'bad'); }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
function renderHistory() {
  $('#historyEmpty').hidden = STATE.imports.length > 0;
  $('#historyRows').innerHTML = STATE.imports
    .map((imp) => `<tr>
      <td>${new Date(imp.timestamp).toLocaleString()}</td>
      <td>${esc(imp.gameName)}</td>
      <td>${esc(imp.fileName)}</td>
      <td class="num">${imp.ticketsCounted}</td>
      <td class="num">${imp.emailsAffected}</td>
      <td class="num points-cell">${imp.totalPoints}</td>
      <td class="num"><button class="btn small danger" data-undo="${imp.id}">Undo</button></td>
    </tr>`)
    .join('');
}
document.addEventListener('click', async (e) => {
  const undo = e.target.closest('[data-undo]');
  if (!undo) return;
  if (!confirm('Undo this import? The points it awarded will be subtracted.')) return;
  try {
    STATE = await api('imports/' + undo.dataset.undo, { method: 'DELETE' });
    renderAll();
    toast('Import undone.', 'good');
  } catch (err) { toast(err.message, 'bad'); }
});

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
let modalSaveHandler = null;
function modal(title, bodyHtml, onSave) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  modalSaveHandler = onSave;
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; modalSaveHandler = null; }
$('#modalCancel').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
$('#modalSave').addEventListener('click', async () => {
  if (!modalSaveHandler) return;
  try { await modalSaveHandler(); closeModal(); }
  catch (e) { toast(e.message, 'bad'); }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
showTab('leaderboard');
refresh().catch((e) => toast('Could not load data: ' + e.message, 'bad'));

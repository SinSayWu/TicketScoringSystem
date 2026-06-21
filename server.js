'use strict';

// Ticket Scoring System — tiny zero-dependency local server.
// Serves the web UI from ./public and persists all data to ./data.json.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 4321;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------

const PRESET_CATEGORIES = [
  { name: 'Baseball', defaultPoints: 10 },
  { name: 'Football', defaultPoints: 10 },
  { name: 'Basketball', defaultPoints: 10 },
  { name: 'Softball', defaultPoints: 10 },
  { name: 'Tennis', defaultPoints: 10 },
];

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function defaultState() {
  return {
    categories: PRESET_CATEGORIES.map((c) => ({ id: newId(), ...c })),
    games: [],
    members: {}, // keyed by lowercased email
    imports: [],
  };
}

let state;

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    state = JSON.parse(raw);
    // Backfill any missing top-level keys for forward compatibility.
    if (!Array.isArray(state.categories)) state.categories = [];
    if (!Array.isArray(state.games)) state.games = [];
    if (!state.members || typeof state.members !== 'object') state.members = {};
    if (!Array.isArray(state.imports)) state.imports = [];
  } catch (err) {
    state = defaultState();
    saveState();
  }
}

let saveTimer = null;
function saveState() {
  // Debounced atomic write so rapid edits don't thrash the disk.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 50);
}

function writeNow() {
  saveTimer = null;
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

function categoryById(id) {
  return state.categories.find((c) => c.id === id) || null;
}

function gameById(id) {
  return state.games.find((g) => g.id === id) || null;
}

// Effective per-ticket points for a game: its own override, or its category default.
function effectivePoints(game) {
  if (game.points !== null && game.points !== undefined) return game.points;
  const cat = categoryById(game.categoryId);
  return cat ? cat.defaultPoints : 0;
}

function gameView(game) {
  const cat = categoryById(game.categoryId);
  return {
    id: game.id,
    name: game.name,
    categoryId: game.categoryId,
    categoryName: cat ? cat.name : '(no category)',
    points: game.points, // null => inherits
    effectivePoints: effectivePoints(game),
    usesDefault: game.points === null || game.points === undefined,
  };
}

function publicState() {
  const members = Object.values(state.members)
    .map((m) => ({ email: m.email, name: m.name || '', points: m.points }))
    .sort((a, b) => b.points - a.points || a.email.localeCompare(b.email));
  return {
    categories: state.categories.slice(),
    games: state.games.map(gameView),
    members,
    imports: state.imports
      .map((imp) => ({
        id: imp.id,
        gameId: imp.gameId,
        gameName: imp.gameName,
        fileName: imp.fileName,
        timestamp: imp.timestamp,
        ticketsCounted: imp.ticketsCounted,
        emailsAffected: Object.keys(imp.perEmail).length,
        pointsPerTicket: imp.pointsPerTicket,
        countMode: imp.countMode,
        totalPoints: Object.values(imp.perEmail).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
  };
}

function ensureMember(email, name) {
  const key = email.toLowerCase();
  if (!state.members[key]) {
    state.members[key] = { email: email, name: name || '', points: 0 };
  } else if (name && !state.members[key].name) {
    state.members[key].name = name;
  }
  return state.members[key];
}

const NON_NAMES = new Set(['apple pay', 'credit card', 'terminal transaction', 'cash']);

// Given parsed CSV rows (array of objects keyed by header), compute the
// per-email ticket counts honoring the count mode.
function tallyRows(rows, countMode) {
  const counts = {}; // email -> { count, name }
  let ticketsCounted = 0;
  for (const row of rows) {
    const status = String(row['Status'] || '').trim().toLowerCase();
    if (status && status !== 'active') continue; // skip refunded/void if present

    if (countMode === 'checked') {
      const checked = String(row['Checked'] || '').trim().toLowerCase();
      if (checked !== 'yes') continue;
    }

    const rawEmail = String(row['Ticket Email'] || row['Cart Email'] || '').trim();
    if (!rawEmail || !rawEmail.includes('@')) continue; // skip terminal/cash rows
    const key = rawEmail.toLowerCase();

    const owner = String(row['Cart Owner'] || '').trim();
    const name = NON_NAMES.has(owner.toLowerCase()) ? '' : owner;

    if (!counts[key]) counts[key] = { count: 0, email: rawEmail, name: '' };
    counts[key].count += 1;
    if (name && !counts[key].name) counts[key].name = name;
    ticketsCounted += 1;
  }
  return { counts, ticketsCounted };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 50 * 1024 * 1024) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // Prevent path traversal outside PUBLIC_DIR.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

async function handleApi(req, res, parts) {
  const [, , resource, id] = parts; // ['', 'api', resource, id?]
  const method = req.method;

  // --- State ---
  if (resource === 'state' && method === 'GET') {
    return sendJson(res, 200, publicState());
  }

  // --- Categories ---
  if (resource === 'categories') {
    if (method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const pts = Number(body.defaultPoints);
      if (!name) return sendJson(res, 400, { error: 'Category name is required.' });
      if (!Number.isFinite(pts)) return sendJson(res, 400, { error: 'Default points must be a number.' });
      if (body.id) {
        const cat = categoryById(body.id);
        if (!cat) return sendJson(res, 404, { error: 'Category not found.' });
        cat.name = name;
        cat.defaultPoints = pts;
      } else {
        state.categories.push({ id: newId(), name, defaultPoints: pts });
      }
      saveState();
      return sendJson(res, 200, publicState());
    }
    if (method === 'DELETE' && id) {
      const used = state.games.some((g) => g.categoryId === id);
      if (used) return sendJson(res, 400, { error: 'Cannot delete a category that still has games. Reassign or delete those games first.' });
      state.categories = state.categories.filter((c) => c.id !== id);
      saveState();
      return sendJson(res, 200, publicState());
    }
  }

  // --- Games ---
  if (resource === 'games') {
    if (method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const categoryId = String(body.categoryId || '');
      if (!name) return sendJson(res, 400, { error: 'Game name is required.' });
      if (!categoryById(categoryId)) return sendJson(res, 400, { error: 'Pick a valid category.' });
      // points: null => inherit category default; otherwise a number.
      let points = null;
      if (body.points !== null && body.points !== undefined && body.points !== '') {
        points = Number(body.points);
        if (!Number.isFinite(points)) return sendJson(res, 400, { error: 'Points must be a number.' });
      }
      if (body.id) {
        const game = gameById(body.id);
        if (!game) return sendJson(res, 404, { error: 'Game not found.' });
        game.name = name;
        game.categoryId = categoryId;
        game.points = points;
      } else {
        state.games.push({ id: newId(), name, categoryId, points });
      }
      saveState();
      return sendJson(res, 200, publicState());
    }
    if (method === 'DELETE' && id) {
      const imported = state.imports.some((imp) => imp.gameId === id);
      if (imported) return sendJson(res, 400, { error: 'This game has imported tickets. Undo those imports (in History) before deleting it.' });
      state.games = state.games.filter((g) => g.id !== id);
      saveState();
      return sendJson(res, 200, publicState());
    }
  }

  // --- Import preview (does not mutate state) ---
  if (resource === 'preview' && method === 'POST') {
    const body = await readBody(req);
    const game = gameById(String(body.gameId || ''));
    if (!game) return sendJson(res, 400, { error: 'Pick a valid game.' });
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const countMode = body.countMode === 'checked' ? 'checked' : 'all';
    const { counts, ticketsCounted } = tallyRows(rows, countMode);
    const pts = effectivePoints(game);
    const perEmail = Object.values(counts)
      .map((c) => ({ email: c.email, name: c.name, tickets: c.count, points: c.count * pts }))
      .sort((a, b) => b.points - a.points);
    return sendJson(res, 200, {
      gameName: game.name,
      pointsPerTicket: pts,
      ticketsCounted,
      emailsAffected: perEmail.length,
      totalPoints: perEmail.reduce((a, b) => a + b.points, 0),
      perEmail,
    });
  }

  // --- Import (mutates state) ---
  if (resource === 'import' && method === 'POST') {
    const body = await readBody(req);
    const game = gameById(String(body.gameId || ''));
    if (!game) return sendJson(res, 400, { error: 'Pick a valid game.' });
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const countMode = body.countMode === 'checked' ? 'checked' : 'all';
    const fileName = String(body.fileName || 'upload.csv');
    const { counts, ticketsCounted } = tallyRows(rows, countMode);
    const pts = effectivePoints(game);

    const perEmail = {}; // email -> points awarded (for precise undo)
    for (const c of Object.values(counts)) {
      const award = c.count * pts;
      const m = ensureMember(c.email, c.name);
      m.points += award;
      perEmail[m.email.toLowerCase()] = (perEmail[m.email.toLowerCase()] || 0) + award;
    }

    const imp = {
      id: newId(),
      gameId: game.id,
      gameName: game.name,
      fileName,
      timestamp: new Date().toISOString(),
      ticketsCounted,
      pointsPerTicket: pts,
      countMode,
      perEmail,
    };
    state.imports.push(imp);
    saveState();
    return sendJson(res, 200, publicState());
  }

  // --- Undo an import ---
  if (resource === 'imports' && method === 'DELETE' && id) {
    const idx = state.imports.findIndex((imp) => imp.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Import not found.' });
    const imp = state.imports[idx];
    for (const [emailKey, pts] of Object.entries(imp.perEmail)) {
      const m = state.members[emailKey];
      if (m) {
        m.points -= pts;
        if (m.points < 0) m.points = 0;
      }
    }
    state.imports.splice(idx, 1);
    saveState();
    return sendJson(res, 200, publicState());
  }

  return sendJson(res, 404, { error: 'Unknown API route.' });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const parts = req.url.split('?')[0].split('/');
  if (parts[1] === 'api') {
    handleApi(req, res, parts).catch((err) => {
      sendJson(res, 400, { error: err.message || 'Request failed.' });
    });
    return;
  }
  serveStatic(req, res);
});

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  try {
    if (process.platform === 'win32') {
      // Prefer a known Chromium browser by its real path. This sidesteps the
      // Windows "default browser" registry, which can be wrong/stuck (e.g.
      // Settings shows Chrome but the handler is still Opera).
      const pf = process.env.ProgramFiles || 'C:\\Program Files';
      const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const local = process.env.LOCALAPPDATA || '';
      const candidates = [
        pf + '\\Google\\Chrome\\Application\\chrome.exe',
        pf86 + '\\Google\\Chrome\\Application\\chrome.exe',
        local + '\\Google\\Chrome\\Application\\chrome.exe',
        pf + '\\Microsoft\\Edge\\Application\\msedge.exe',
        pf86 + '\\Microsoft\\Edge\\Application\\msedge.exe',
      ];
      const browser = candidates.find((p) => p && fs.existsSync(p));
      if (browser) {
        spawn(browser, [url], { detached: true, stdio: 'ignore' }).unref();
      } else {
        // Fall back to whatever the system default is.
        spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
      }
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    /* user can open the URL manually */
  }
}

// Use an explicit IPv4 address, not "localhost": some browsers resolve
// "localhost" to IPv6 (::1) first, but we bind to IPv4 (127.0.0.1).
const URL = 'http://127.0.0.1:' + PORT;

loadState();
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log('  Port ' + PORT + ' is already in use.');
    console.log('  The app may already be running in another window —');
    console.log('  try opening ' + URL + ' in your browser.');
    console.log('');
  } else {
    console.log('  Could not start the server: ' + err.message);
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Ticket Scoring System is running.');
  console.log('  Opening your browser to:  ' + URL);
  console.log('  (If it does not open, paste that address into your browser.)');
  console.log('');
  console.log('  Data is saved to: ' + DATA_FILE);
  console.log('  Keep this window open while you use the app. Close it to stop.');
  console.log('');
  openBrowser(URL);
});

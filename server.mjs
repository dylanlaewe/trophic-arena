import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeEntry, observation, scoreEntries } from './arena-rules.mjs';
import { BOT_NAME, botForecast } from './bot.mjs';
import { ENGINE_VERSION, simulate } from './engine.mjs';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const maxBodyBytes = 4096;
const maxEntries = 64;

function reject(status, message) {
  throw Object.assign(new Error(message), { status });
}
const digest = text => createHash('sha256').update(text).digest('hex');
const commitment = seed => digest(ENGINE_VERSION + ':' + seed);

async function readBody(req) {
  if (Number(req.headers['content-length']) > maxBodyBytes) {
    req.resume();
    reject(413, 'Request body exceeds 4 KiB.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      req.resume();
      reject(413, 'Request body exceeds 4 KiB.');
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    reject(415, 'Use application/json.');
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { reject(400, 'Invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) reject(400, 'Expected a JSON object.');
  return body;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveFile(path, req, res) {
  const name = path === '/' ? 'index.html' : path.slice(1);
  if (name !== 'index.html' && name !== 'styles.css' && !/^[a-zA-Z0-9_-]+\.js$/.test(name)) {
    reject(404, 'Not found.');
  }
  let contents;
  try { contents = readFileSync(join(publicDir, name)); }
  catch (error) {
    if (error.code === 'ENOENT') reject(404, 'Not found.');
    throw error;
  }
  const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
  res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Content-Length': contents.length, 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : contents);
}

export function createArena({ dataDir = process.env.ARENA_DATA_DIR || '.arena-data' } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'rooms.sqlite'));
  db.exec(`
    PRAGMA busy_timeout = 3000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY, version TEXT NOT NULL, seed TEXT NOT NULL,
      host_hash TEXT NOT NULL, bot TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE IF NOT EXISTS forecasts (
      room TEXT NOT NULL REFERENCES rooms(code), name_key TEXT NOT NULL, name TEXT NOT NULL,
      probabilities TEXT NOT NULL, PRIMARY KEY(room, name_key)
    );
  `);
  const byCode = db.prepare('SELECT rooms.*, (SELECT count(*) FROM forecasts WHERE room = rooms.code) AS entries FROM rooms WHERE code = ?');
  const addRoom = db.prepare('INSERT INTO rooms(code, version, seed, host_hash, bot) VALUES (?, ?, ?, ?, ?)');
  const addEntry = db.prepare('INSERT INTO forecasts(room, name_key, name, probabilities) VALUES (?, ?, ?, ?)');
  const lookupEntry = db.prepare('SELECT name, probabilities FROM forecasts WHERE room = ? AND name_key = ?');
  const entriesFor = db.prepare('SELECT name, probabilities FROM forecasts WHERE room = ? ORDER BY rowid');
  const settleRoom = db.prepare("UPDATE rooms SET phase = 'settled' WHERE code = ?");
  const worlds = new Map();

  function getRoom(code) {
    const record = byCode.get(code);
    if (!record) reject(404, 'Room not found.');
    if (record.version !== ENGINE_VERSION) reject(409, 'Reopen this room with engine ' + record.version + '.');
    return record;
  }

  function worldFor(seed) {
    if (!worlds.has(seed)) {
      const world = simulate(seed);
      if (worlds.size >= 4) worlds.delete(worlds.keys().next().value);
      worlds.set(seed, world);
    }
    return worlds.get(seed);
  }

  function openRoom() {
    const seed = randomBytes(32).toString('hex');
    const hostToken = randomBytes(32).toString('base64url');
    const bot = botForecast(observation(worldFor(seed)));
    let code;
    do { code = randomBytes(5).toString('hex').toUpperCase(); } while (byCode.get(code));
    addRoom.run(code, ENGINE_VERSION, seed, digest(hostToken), JSON.stringify(bot));
    return { code, hostToken, commitment: commitment(seed) };
  }

  function describe(room) {
    const world = worldFor(room.seed);
    const visible = observation(world);
    const result = { code: room.code, phase: room.phase, engineVersion: room.version,
      commitment: commitment(room.seed), entries: room.entries, ...visible };
    if (room.phase === 'settled') {
      const entries = entriesFor.all(room.code).map(row => ({ name: row.name, probabilities: JSON.parse(row.probabilities) }));
      entries.push({ name: BOT_NAME, isBot: true, probabilities: JSON.parse(room.bot) });
      Object.assign(result, { seed: room.seed, frames: world.frames, events: world.events,
        outcomes: world.outcomes, leaderboard: scoreEntries(world.questions, world.outcomes, entries) });
    }
    return result;
  }

  function forecast(room, body) {
    let entry;
    try { entry = normalizeEntry(worldFor(room.seed).questions, body); }
    catch (error) { reject(400, error.message); }
    const nameKey = entry.name.normalize('NFKC').toLowerCase();
    if (nameKey === BOT_NAME.toLowerCase()) reject(400, 'Choose a different forecaster name.');
    const existing = lookupEntry.get(room.code, nameKey);
    if (existing) {
      const previous = JSON.parse(existing.probabilities);
      if (existing.name === entry.name && Object.keys(previous).every(id => previous[id] === entry.probabilities[id])) {
        return { accepted: true, name: existing.name };
      }
      reject(409, 'That forecaster name is already locked in this room.');
    }
    if (room.phase !== 'open') reject(409, 'This room has settled.');
    if (room.entries >= maxEntries) reject(409, 'This room has reached its entry limit.');
    addEntry.run(room.code, nameKey, entry.name, JSON.stringify(entry.probabilities));
    return { accepted: true, name: entry.name };
  }

  function settle(room, authorization) {
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] || '';
    if (!timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(room.host_hash, 'hex'))) {
      reject(403, 'Only the host can settle this room.');
    }
    if (!room.entries) reject(409, 'Lock at least one forecast before settling.');
    settleRoom.run(room.code);
    return { phase: 'settled' };
  }

  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/api/rooms' && req.method === 'POST') {
        await readBody(req);
        return json(res, 201, openRoom());
      }
      const route = /^\/api\/rooms\/([a-f0-9]{10})(?:\/(status|forecasts|settle|refuge))?$/i.exec(path);
      if (!route) {
        if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method)) reject(404, 'Not found.');
        return serveFile(path, req, res);
      }
      const [, rawCode, action] = route;
      const code = rawCode.toUpperCase();
      if (req.method === 'GET' && (!action || action === 'status')) {
        const room = getRoom(code);
        return json(res, 200, action ? { phase: room.phase, entries: room.entries } : describe(room));
      }
      if (req.method === 'GET' && action === 'refuge') {
        const room = getRoom(code);
        if (room.phase !== 'settled') reject(409, 'Settle the room before running an experiment.');
        const alternative = simulate(room.seed, { intervention: 'refuge' });
        return json(res, 200, { frames: alternative.frames.map(({ tick, grazers, hunters, food }) =>
          ({ tick, grazers, hunters, food })) });
      }
      if (req.method !== 'POST' || !['forecasts', 'settle'].includes(action)) reject(405, 'Method not allowed.');
      const body = await readBody(req);
      const result = transaction(() => {
        const room = getRoom(code);
        return action === 'forecasts' ? forecast(room, body) : settle(room, req.headers.authorization);
      });
      json(res, 200, result);
    } catch (error) {
      if (!error.status) console.error(error);
      json(res, error.status || 500, { error: error.status ? error.message : 'Unable to complete this request.' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.once('close', () => db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT ?? '3000');
  const server = createArena();
  server.listen(port, host, () => console.log('Trophic Arena listening at http://' + host + ':' + server.address().port));
}

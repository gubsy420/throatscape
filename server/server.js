/* ============================================================
   Throatscape server
   ------------------------------------------------------------
   Serves the client, owns the authoritative game world, and
   holds the accounts. The WebSocket layer (RFC 6455) is
   implemented here directly on the upgrade socket, so the whole
   project installs nothing.
   ============================================================ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { initStore, readPlayer, writePlayer, DATA_DIR } from './store.js';
import { Accounts, keyFor } from './accounts.js';
import { Sim, TICK_MS } from './sim.js';
import { loadContent, loadedPacks } from '../js/data/content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;

/*
 * The bulletin, and when the file it came from was last written. Declared up
 * here because the boot below reads it before the rest of the file has run,
 * and a `let` further down would still be in its dead zone. See
 * readPatchNotes().
 */
const PATCH_FILE = path.join(ROOT, 'content/patchnotes.json');
let patchNotes = null;
let patchStamp = 0;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 100;

/**
 * Where this instance lives, as the outside world sees it. Only used to fill
 * in the link-preview tags, which have to carry absolute URLs - most crawlers
 * will not resolve a relative one.
 *
 * Set PUBLIC_URL to pin it. Otherwise it is read from the request, which is
 * what makes the previews work behind a Cloudflare tunnel or any other proxy
 * without the container being told its own address.
 */
const PUBLIC_URL = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

function originFor(req) {
  if (PUBLIC_URL) return PUBLIC_URL;

  // proxies append rather than replace, so the first hop is the client's
  const first = h => String(h || '').split(',')[0].trim();
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host);
  // the Host header is attacker-controlled; anything unusual and we give up
  // rather than reflecting it into the page
  if (!HOST_RE.test(host || '')) return '';

  let proto = first(req.headers['x-forwarded-proto']).toLowerCase();
  if (!proto) {
    // Cloudflare sends this even when x-forwarded-proto is missing
    try { proto = JSON.parse(req.headers['cf-visitor'] || '{}').scheme || ''; }
    catch { proto = ''; }
  }
  if (proto !== 'http' && proto !== 'https') {
    proto = /^(localhost|127\.|\[?::1)/i.test(host) ? 'http' : 'https';
  }
  return `${proto}://${host}`;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/* ============================================================
   Boot
   ============================================================ */

initStore();

/*
 * Content packs go in before anything reads the game data, and certainly
 * before the world is generated: the map is produced from these definitions
 * at both ends and never transmitted, so a server running a pack the client
 * has not loaded would be a server nobody can walk around in.
 */
await loadContent();
await readPatchNotes();

const accounts = new Accounts();
await accounts.load();
const sim = new Sim(accounts);

/* ============================================================
   Static files
   ============================================================ */

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: sim.playerCount, accounts: accounts.count, tick: sim.tick }));
    return;
  }

  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }

    let body = data;
    if (urlPath === '/index.html') {
      // the only templated file in the project: the preview tags need to know
      // the address this request came in on
      body = data.toString('utf8').replaceAll('%ORIGIN%', originFor(req));
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // the page changes with every content delivery; the artwork does not
      'Cache-Control': ext === '.jpg' || ext === '.png' || ext === '.webp'
        ? 'public, max-age=86400'
        : 'no-cache'
    });
    res.end(body);
  });
});

/* ============================================================
   WebSocket
   ============================================================ */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);

  const client = {
    socket,
    ip: req.socket.remoteAddress || 'unknown',
    session: null,           // set once authenticated
    buffer: Buffer.alloc(0),
    msgCount: 0,
    lastMsg: Date.now(),
    authBusy: false
  };
  clients.add(client);

  socket.on('data', chunk => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    if (client.buffer.length > 1 << 20) { drop(client); return; }
    let frame;
    while ((frame = readFrame(client.buffer))) {
      client.buffer = client.buffer.subarray(frame.total);
      handleFrame(client, frame);
    }
  });

  socket.on('error', () => drop(client));
  socket.on('close', () => drop(client));

  // the bulletin is checked for freshness per greeting, so a delivery posted
  // while the ward is up reaches the next person through the door
  readPatchNotes().then(patch => {
    if (!clients.has(client)) return;
    send(client, {
      t: 'hello',
      players: sim.playerCount,
      accounts: accounts.count,
      // the login screen shows the notes when this is newer than what the
      // browser remembers having read
      patch
    });
  });
});

function drop(client) {
  if (!clients.has(client)) return;
  clients.delete(client);
  try { client.socket.destroy(); } catch {}

  if (client.session) {
    const s = client.session;
    savePlayer(s).catch(e => console.warn(`[save] ${s.key}: ${e.message}`));
    sim.remove(s.key);
    client.session = null;
    console.log(`[-] ${s.name} left (${sim.playerCount} online)`);
    broadcastSystem(`${s.name} has gone off shift.`);
  }
}

/* ---------------- framing ----------------------------------- */

function readFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    const big = buf.readBigUInt64BE(offset);
    if (big > 1_000_000n) return { total: buf.length, opcode: 0x8, payload: Buffer.alloc(0) };
    len = Number(big);
    offset += 8;
  }

  let mask = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;

  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

  return { fin, opcode, payload, total: offset + len };
}

function encodeFrame(data, opcode = 0x1) {
  const payload = Buffer.from(data);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function send(client, obj) {
  try { client.socket.write(encodeFrame(JSON.stringify(obj))); }
  catch { drop(client); }
}

function broadcastSystem(text) {
  for (const c of clients) if (c.session) send(c, { t: 'msg', text, cls: 'system' });
}

function broadcastChat(from, text) {
  for (const c of clients) {
    if (!c.session) continue;
    send(c, { t: 'chat', who: from, text });
  }
}

/* ---------------- protocol ---------------------------------- */

async function handleFrame(client, frame) {
  if (frame.opcode === 0x8) { drop(client); return; }
  if (frame.opcode === 0x9) {
    try { client.socket.write(encodeFrame(frame.payload, 0xA)); } catch {}
    return;
  }
  if (frame.opcode !== 0x1) return;

  const now = Date.now();
  if (now - client.lastMsg > 1000) { client.lastMsg = now; client.msgCount = 0; }
  if (++client.msgCount > 40) return;

  let msg;
  try { msg = JSON.parse(frame.payload.toString('utf8')); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;

  /* -------- unauthenticated -------- */
  if (!client.session) {
    if (msg.t === 'register' || msg.t === 'login' || msg.t === 'resume') {
      if (client.authBusy) return;
      client.authBusy = true;
      try { await authenticate(client, msg); }
      catch (e) {
        console.warn('[auth]', e.message);
        send(client, { t: 'authfail', error: 'Something went wrong. Try again.' });
      }
      client.authBusy = false;
    }
    return;
  }

  /* -------- authenticated -------- */
  const s = client.session;

  if (msg.t === 'chat') {
    const text = String(msg.text ?? '').slice(0, 120).replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!text) return;
    sim.setChat(s, text);
    broadcastChat(s.name, text);
    return;
  }

  if (msg.t === 'logout') {
    if (msg.token) accounts.revoke(String(msg.token));
    drop(client);
    return;
  }

  sim.handle(s, msg);
}

async function authenticate(client, msg) {
  if (sim.playerCount >= MAX_PLAYERS) {
    send(client, { t: 'authfail', error: 'The ward is full. Try again shortly.' });
    return;
  }

  let account = null;
  let token = null;

  if (msg.t === 'register') {
    const res = await accounts.register(msg.name, msg.password);
    if (res.error) { send(client, { t: 'authfail', error: res.error }); return; }
    account = res;
    token = accounts.issue(res.key);
    console.log(`[*] new account: ${res.name}`);
  } else if (msg.t === 'login') {
    const res = await accounts.login(msg.name, msg.password, client.ip);
    if (res.error) { send(client, { t: 'authfail', error: res.error }); return; }
    account = res;
    token = res.token;
  } else {
    const res = accounts.resume(msg.token);
    if (!res) { send(client, { t: 'authfail', error: 'Session expired. Please log in.', expired: true }); return; }
    account = res;
    token = String(msg.token);
  }

  // one live session per account: kick the older connection
  const existing = sim.get(account.key);
  if (existing) {
    for (const c of clients) {
      if (c.session && c.session.key === account.key) {
        send(c, { t: 'kicked', reason: 'You logged in from somewhere else.' });
        drop(c);
      }
    }
  }

  const saved = await readPlayer(account.key);
  const session = sim.add(account.key, account.name, saved);
  client.session = session;

  send(client, { t: 'auth', name: account.name, token });
  send(client, sim.initPacket(session));

  console.log(`[+] ${account.name} joined (${sim.playerCount} online)`);
  broadcastSystem(`${account.name} has arrived on the ward.`);
}

/* ---------------- patch notes ------------------------------- */

/**
 * Only the newest few entries travel with the greeting; the client fetches
 * the whole file if the player asks to read further back.
 *
 * Re-read when the file changes on disk rather than once at boot. The daily
 * pipeline commits a bulletin while the ward is up, and reading this once
 * meant nobody was told about anything until somebody happened to restart
 * the server - which is most of why the bulletin stopped appearing at all.
 */
async function readPatchNotes() {
  try {
    const stat = await fs.promises.stat(PATCH_FILE);
    if (patchNotes && stat.mtimeMs === patchStamp) return patchNotes;
    const all = JSON.parse(await fs.promises.readFile(PATCH_FILE, 'utf8'));
    const list = Array.isArray(all) ? all : all.entries || [];
    patchStamp = stat.mtimeMs;
    patchNotes = list.length ? { latest: list[0].version, entries: list.slice(0, 3) } : null;
    return patchNotes;
  } catch {
    return patchNotes;                  // a bad write must not lose the last good read
  }
}

/* ---------------- persistence ------------------------------- */

async function savePlayer(session) {
  await writePlayer(session.key, session.serialize());
}

async function saveAll() {
  for (const c of clients) {
    if (!c.session) continue;
    try { await savePlayer(c.session); }
    catch (e) { console.warn(`[save] ${c.session.key}: ${e.message}`); }
  }
  await accounts.save();
}

/* ============================================================
   Main loop
   ============================================================ */

let ticking = false;
const tickTimer = setInterval(() => {
  if (ticking) return;                    // never overlap a slow tick
  ticking = true;
  try {
    sim.step();
    for (const c of clients) {
      if (!c.session) continue;
      const out = c.session.outbox;
      if (!out.length) continue;
      for (const m of out) send(c, m);
      out.length = 0;
    }
  } catch (e) {
    console.error('[tick]', e);
  }
  ticking = false;
}, TICK_MS);

/* periodic autosave, staggered off the tick */
const saveTimer = setInterval(() => {
  saveAll().catch(e => console.warn('[autosave]', e.message));
}, 30_000);

const sweepTimer = setInterval(() => accounts.sweep(), 60 * 60 * 1000);

const pingTimer = setInterval(() => {
  for (const c of clients) {
    try { c.socket.write(encodeFrame(Buffer.alloc(0), 0x9)); } catch { drop(c); }
  }
}, 25_000);

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Throatscape is open.');
  console.log(`  Play at   http://localhost:${PORT}`);
  console.log(`  Data in   ${DATA_DIR}`);
  const packs = loadedPacks();
  if (packs.length) {
    const newest = packs[packs.length - 1];
    console.log(`  Content   ${packs.length} pack${packs.length === 1 ? '' : 's'}` +
                ` — newest: ${newest.title || newest.id}`);
  }
  console.log('  Ctrl+C to close the ward.');
  if (HOST === '0.0.0.0') {
    console.log('');
    console.log('  Note: accounts are sent over this connection in the clear.');
    console.log('  Put the server behind HTTPS before exposing it to the internet.');
  }
  console.log('');
});

/* ---------------- graceful shutdown ------------------------- */

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n  ${signal} received - closing the ward.`);

  clearInterval(tickTimer);
  clearInterval(saveTimer);
  clearInterval(sweepTimer);
  clearInterval(pingTimer);

  try { await saveAll(); console.log('  Players saved.'); }
  catch (e) { console.warn('  Save failed:', e.message); }

  for (const c of [...clients]) {
    try { c.socket.end(); } catch {}
    clients.delete(c);
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

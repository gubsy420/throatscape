/* ============================================================
   Throatscape server
   ------------------------------------------------------------
   Serves the client and runs a small presence/chat relay.
   No dependencies: the WebSocket layer (RFC 6455) is implemented
   here directly on top of the raw upgrade socket.
   ============================================================ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

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

  const filePath = path.join(ROOT, urlPath);
  // never serve outside the project directory
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

/* ============================================================
   WebSocket
   ============================================================ */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Map();          // id -> client
let nextId = 1;

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') {
    socket.destroy();
    return;
  }
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
    id: nextId++,
    socket,
    name: 'Nurse',
    x: 30, y: 152,
    joined: false,
    buffer: Buffer.alloc(0),
    alive: true,
    lastMsg: Date.now(),
    msgCount: 0
  };
  clients.set(client.id, client);

  socket.on('data', chunk => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    // a socket that never sends a valid frame should not eat memory
    if (client.buffer.length > 1 << 20) { drop(client); return; }
    let frame;
    while ((frame = readFrame(client.buffer))) {
      client.buffer = client.buffer.subarray(frame.total);
      handleFrame(client, frame);
    }
  });

  socket.on('error', () => drop(client));
  socket.on('close', () => drop(client));

  send(client, { t: 'welcome', id: client.id, count: clients.size });
});

function drop(client) {
  if (!clients.has(client.id)) return;
  clients.delete(client.id);
  try { client.socket.destroy(); } catch {}
  if (client.joined) {
    broadcast({ t: 'left', id: client.id });
    console.log(`[-] ${client.name} left (${clients.size} online)`);
  }
}

/* ---------------- framing ----------------------------------- */

/** Decodes one frame from the head of `buf`, or null if incomplete. */
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
  if (!client.alive) return;
  try {
    client.socket.write(encodeFrame(JSON.stringify(obj)));
  } catch {
    drop(client);
  }
}

function broadcast(obj, except) {
  const frame = encodeFrame(JSON.stringify(obj));
  for (const c of clients.values()) {
    if (c.id === except) continue;
    try { c.socket.write(frame); } catch { drop(c); }
  }
}

/* ---------------- protocol ---------------------------------- */

function handleFrame(client, frame) {
  if (frame.opcode === 0x8) { drop(client); return; }
  if (frame.opcode === 0x9) {                     // ping -> pong
    try { client.socket.write(encodeFrame(frame.payload, 0xA)); } catch {}
    return;
  }
  if (frame.opcode !== 0x1) return;

  /* light rate limit: 30 messages per second, sustained */
  const now = Date.now();
  if (now - client.lastMsg > 1000) { client.lastMsg = now; client.msgCount = 0; }
  if (++client.msgCount > 30) return;

  let msg;
  try { msg = JSON.parse(frame.payload.toString('utf8')); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;

  switch (msg.t) {
    case 'join': {
      client.name = sanitizeName(msg.name);
      client.x = clampInt(msg.x, 0, 191, 30);
      client.y = clampInt(msg.y, 0, 191, 152);
      client.joined = true;
      broadcast({ t: 'join', id: client.id, name: client.name }, client.id);
      console.log(`[+] ${client.name} joined (${clients.size} online)`);
      break;
    }
    case 'move':
      client.x = clampInt(msg.x, 0, 191, client.x);
      client.y = clampInt(msg.y, 0, 191, client.y);
      break;

    case 'chat': {
      const text = String(msg.text ?? '').slice(0, 120).replace(/[\x00-\x1f\x7f]/g, '');
      if (!text.trim()) break;
      broadcast({ t: 'chat', id: client.id, name: client.name, text });
      break;
    }
  }
}

function sanitizeName(raw) {
  const s = String(raw ?? '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 12);
  return s.length >= 2 ? s : 'Nurse';
}

function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/* ---------------- presence broadcast ------------------------ */

const presenceTimer = setInterval(() => {
  const joined = [...clients.values()].filter(c => c.joined);
  if (!joined.length) return;
  const players = joined.map(c => ({ id: c.id, name: c.name, x: c.x, y: c.y }));
  broadcast({ t: 'state', players });
}, 300);

/* keep-alive ping so dead sockets get collected */
const pingTimer = setInterval(() => {
  for (const c of clients.values()) {
    try { c.socket.write(encodeFrame(Buffer.alloc(0), 0x9)); } catch { drop(c); }
  }
}, 25000);

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Throatscape is open.');
  console.log(`  Play at  http://localhost:${PORT}`);
  console.log('  Ctrl+C to close the ward.');
  console.log('');
});

/* ---------------- graceful shutdown ------------------------- */

/**
 * Containers stop the process with SIGTERM. Node installs no default handler
 * for it when running as PID 1, so without this `docker stop` would sit through
 * its whole timeout before killing us.
 */
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n  ${signal} received - closing the ward.`);

  clearInterval(presenceTimer);
  clearInterval(pingTimer);

  for (const c of [...clients.values()]) {
    try { c.socket.end(); } catch {}
    clients.delete(c.id);
  }

  server.close(() => process.exit(0));
  // do not hang forever on a socket that will not close
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

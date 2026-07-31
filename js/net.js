/* ============================================================
   Multiplayer client
   ------------------------------------------------------------
   Entirely optional. If the socket will not open (opened from
   file://, server not running) the game carries on single-player
   and simply says so in chat.
   ============================================================ */

import { log } from './game/state.js';

const HELLO_DELAY = 400;

export class Net {
  constructor(state) {
    this.state = state;
    this.ws = null;
    this.connected = false;
    this.id = null;
    this.retry = 0;
    this.lastSent = { x: -1, y: -1 };
    this.enabled = false;
  }

  connect() {
    if (!this.state.settings.multiplayer) return;
    if (location.protocol === 'file:') {
      log(this.state, 'Playing solo — open the game through the local server to meet other nurses.', 'system');
      return;
    }
    this.enabled = true;
    this.open();
  }

  open() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.fail();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.connected = true;
      this.retry = 0;
      this.send({ t: 'join', name: this.state.name, x: this.state.player.x, y: this.state.player.y });
      log(this.state, 'Connected to the Throat.', 'system');
    });

    ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.handle(msg);
    });

    ws.addEventListener('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.state.others.clear();
      if (!this.enabled) return;
      if (wasConnected) log(this.state, 'Disconnected. Trying to reconnect…', 'system');
      this.scheduleRetry();
    });

    ws.addEventListener('error', () => { /* close handler does the work */ });
  }

  fail() {
    log(this.state, 'No server found — playing solo.', 'system');
    this.enabled = false;
  }

  scheduleRetry() {
    if (this.retry > 4) { this.fail(); return; }
    const delay = 1500 * Math.pow(2, this.retry++);
    setTimeout(() => { if (this.enabled) this.open(); }, delay);
  }

  disconnect() {
    this.enabled = false;
    this.state.others.clear();
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.ws = null;
    this.connected = false;
  }

  send(obj) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify(obj)); } catch {}
  }

  handle(msg) {
    const s = this.state;
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        if (msg.count > 1) {
          log(s, `${msg.count - 1} other nurse${msg.count === 2 ? ' is' : 's are'} on shift.`, 'system');
        }
        break;

      case 'state': {
        const seen = new Set();
        for (const p of msg.players) {
          if (p.id === this.id) continue;
          seen.add(p.id);
          let o = s.others.get(p.id);
          if (!o) {
            o = { id: p.id, name: p.name, x: p.x, y: p.y, rx: p.x, ry: p.y, px: p.x, py: p.y,
                  color: colorFor(p.id), chat: null, moving: false };
            s.others.set(p.id, o);
          } else {
            o.px = o.x; o.py = o.y;
            o.moving = o.x !== p.x || o.y !== p.y;
            o.x = p.x; o.y = p.y;
            o.name = p.name;
          }
        }
        for (const id of [...s.others.keys()]) {
          if (!seen.has(id)) s.others.delete(id);
        }
        break;
      }

      case 'join':
        if (msg.id !== this.id) log(s, `${msg.name} has arrived on the ward.`, 'system');
        break;

      case 'left':
        if (s.others.has(msg.id)) {
          log(s, `${s.others.get(msg.id).name} has gone off shift.`, 'system');
          s.others.delete(msg.id);
        }
        break;

      case 'chat': {
        if (msg.id === this.id) break;
        const o = s.others.get(msg.id);
        if (o) o.chat = { text: msg.text, ttl: 180 };
        s.bus.emit('public', { who: msg.name, text: msg.text });
        break;
      }
    }
  }

  /** Called each tick; only sends when the player has actually moved. */
  pushPosition() {
    const p = this.state.player;
    if (p.x === this.lastSent.x && p.y === this.lastSent.y) return;
    this.lastSent = { x: p.x, y: p.y };
    this.send({ t: 'move', x: p.x, y: p.y });
  }

  say(text) {
    this.send({ t: 'chat', text });
  }
}

/** Stable per-player tunic colour so people are recognisable. */
function colorFor(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
  const hues = ['#7fbf8f', '#86b7e0', '#d9c0e0', '#e0b357', '#c9b48f', '#b8687a', '#6fd1a5'];
  return hues[h % hues.length];
}

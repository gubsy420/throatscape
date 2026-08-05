/* ============================================================
   Network client
   ------------------------------------------------------------
   The server owns the game. This module sends what the player
   would like to do, and folds what the server says back into
   the local state, which from here on is a replica used only
   for drawing and for the interface to read.
   ============================================================ */

import { ITEMS } from './data/items.js';
import { SKILL_IDS } from './data/skills.js';
import { log, toast } from './game/state.js';

export const TOKEN_KEY = 'throatscape.token';
export const TICK_MS = 600;

export class Net {
  constructor(state, world) {
    this.state = state;
    this.world = world;
    this.ws = null;
    this.open = false;
    this.authed = false;
    this.retry = 0;
    this.wantReconnect = false;
    this.lastSnapAt = 0;
    this.queue = [];
    this.npcById = new Map();
  }

  /* ---------------- connection ---------------------------- */

  connect() {
    return new Promise((resolve, reject) => {
      if (location.protocol === 'file:') {
        reject(new Error('Throatscape must be opened through the server, not from a file.'));
        return;
      }
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try { ws = new WebSocket(`${proto}//${location.host}/ws`); }
      catch (e) { reject(e); return; }

      this.ws = ws;
      const failFast = () => reject(new Error('Could not reach the server.'));

      ws.addEventListener('open', () => {
        this.open = true;
        this.retry = 0;
        ws.removeEventListener('error', failFast);
        for (const m of this.queue) this.send(m);
        this.queue.length = 0;
        resolve();
      });
      ws.addEventListener('error', failFast);

      ws.addEventListener('message', ev => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this.handle(msg);
      });

      ws.addEventListener('close', () => {
        this.open = false;
        const wasAuthed = this.authed;
        this.authed = false;
        this.state.others.clear();
        if (wasAuthed) {
          log(this.state, 'Connection lost. Reconnecting…', 'bad');
          this.state.bus.emit('disconnected');
          this.reconnect();
        }
      });
    });
  }

  reconnect() {
    if (this.retry > 6) {
      log(this.state, 'Could not reconnect. Reload the page to try again.', 'bad');
      return;
    }
    const delay = Math.min(1000 * Math.pow(1.8, this.retry++), 15000);
    setTimeout(async () => {
      try {
        await this.connect();
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) this.send({ t: 'resume', token });
      } catch {
        this.reconnect();
      }
    }, delay);
  }

  send(msg) {
    if (!this.open || !this.ws || this.ws.readyState !== 1) { this.queue.push(msg); return; }
    try { this.ws.send(JSON.stringify(msg)); } catch {}
  }

  /* ---------------- auth ---------------------------------- */

  register(name, password) { this.send({ t: 'register', name, password }); }
  login(name, password)    { this.send({ t: 'login', name, password }); }
  resume(token)            { this.send({ t: 'resume', token }); }
  logout() {
    this.send({ t: 'logout', token: localStorage.getItem(TOKEN_KEY) });
    localStorage.removeItem(TOKEN_KEY);
  }

  /* ---------------- inbound ------------------------------- */

  handle(msg) {
    const s = this.state;
    switch (msg.t) {
      case 'hello':
        s.bus.emit('hello', msg);
        break;

      case 'auth':
        this.authed = true;
        s.name = msg.name;
        if (msg.token) localStorage.setItem(TOKEN_KEY, msg.token);
        s.bus.emit('auth', msg);
        break;

      case 'authfail':
        if (msg.expired) localStorage.removeItem(TOKEN_KEY);
        s.bus.emit('authfail', msg);
        break;

      case 'kicked':
        this.wantReconnect = false;
        this.retry = 99;
        log(s, msg.reason || 'Disconnected.', 'bad');
        toast(s, msg.reason || 'Disconnected.', 'bad');
        break;

      case 'init':      this.applyInit(msg); break;
      case 'snap':      this.applySnapshot(msg); break;

      case 'inv': {
        const before = countBy(s.inventory);
        s.inventory = msg.inv.map(e => e && ITEMS[e[0]] ? { id: e[0], n: e[1] } : null);
        // the server sends the whole pack, so what actually happened has to be
        // worked out by comparing - it is the only way to know what to play
        for (const [id, n] of Object.entries(countBy(s.inventory))) {
          if (n > (before[id] || 0)) { s.bus.emit('gained', { id }); break; }
        }
        s.bus.emit('inv');
        break;
      }

      case 'equip':
        s.equipment = msg.eq || {};
        s.bus.emit('equip');
        break;

      case 'skills':
        for (const id of SKILL_IDS) {
          if (typeof msg.xp[id] === 'number') s.skills[id].xp = msg.xp[id];
        }
        s.bus.emit('xp', { skill: null, amount: 0 });
        break;

      case 'quests':
        s.quests = msg.q || {};
        s.bus.emit('quest');
        break;

      case 'bank':
        s.bank = (msg.bank || []).filter(e => ITEMS[e[0]]).map(e => ({ id: e[0], n: e[1] }));
        s.bus.emit('bank');
        break;

      case 'msg':      log(s, msg.text, msg.cls || 'game'); break;
      case 'toast':    toast(s, msg.text, msg.cls || ''); break;
      case 'levelup':  s.bus.emit('levelup', { skill: msg.skill, level: msg.level }); break;
      case 'chat':     s.bus.emit('public', { who: msg.who, text: msg.text }); break;
      case 'ui':
        // a shop invitation carries the shelf with it, so the panel it is
        // about to open has the real numbers on its first draw
        if (msg.kind === 'shop' && msg.stock) this.applyStock([{ id: msg.id, stock: msg.stock }]);
        s.bus.emit('serverui', msg);
        break;
      case 'dialogue': s.bus.emit('dialogue', msg); break;
      case 'cue':      s.bus.emit('cue', msg.name); break;

      case 'friends':
        s.friends = msg.list || [];
        s.bus.emit('friends');
        break;

      case 'private':
        if (msg.dir === 'out') this.lastWhisperTo = msg.who;
        else this.lastWhisperFrom = msg.who;
        s.bus.emit('private', msg);
        break;

      case 'trade':
        s.trade = msg.open ? msg : null;
        s.bus.emit('trade', msg);
        break;

      case 'tradereq':
        s.bus.emit('tradereq', msg);
        break;

      case 'teleport':
        s.player.x = s.player.ix = msg.x;
        s.player.y = s.player.iy = msg.y;
        s.snapCam = true;
        break;
    }
  }

  applyInit(msg) {
    const s = this.state;
    s.name = msg.name;
    s.player.x = s.player.ix = s.player.rx = msg.pos.x;
    s.player.y = s.player.iy = s.player.ry = msg.pos.y;
    s.snapCam = true;

    s.inventory = msg.inv.map(e => e && ITEMS[e[0]] ? { id: e[0], n: e[1] } : null);
    s.equipment = msg.eq || {};
    for (const id of SKILL_IDS) {
      if (typeof msg.xp[id] === 'number') s.skills[id].xp = msg.xp[id];
    }
    s.quests = msg.quests || {};
    s.bank = (msg.bank || []).filter(e => ITEMS[e[0]]).map(e => ({ id: e[0], n: e[1] }));
    s.vigil.points = msg.vigil.points;
    s.vigil.max = msg.vigil.max;
    s.vigil.active = msg.vigil.active || [];
    s.attackStyle = msg.style || 'accurate';
    s.autocast = msg.cast || null;

    for (const o of msg.objs || []) {
      const obj = this.world.objectAt(o.x, o.y);
      if (!obj) continue;
      obj.depleted = o.d ? 1 : 0;
      // doors are drawn mid-swing, so the renderer eases towards this
      if ('p' in o) obj.open = !!o.p;
    }

    this.lastSnapAt = performance.now();
    s.bus.emit('inv');
    s.bus.emit('equip');
    s.bus.emit('xp', { skill: null, amount: 0 });
    s.bus.emit('quest');
    s.bus.emit('ready');
  }

  /**
   * Folds one server tick into the replica. Positions become interpolation
   * targets rather than being applied instantly, so movement still looks smooth
   * at 600 ms between updates.
   */
  applySnapshot(msg) {
    const s = this.state;
    const p = s.player;
    this.lastSnapAt = performance.now();

    /* -- self -- */
    const self = msg.self;
    const wasDead = p.dead;
    const moved = p.x !== self.x || p.y !== self.y;
    /*
     * Whether a tile actually changed, recorded rather than inferred.
     *
     * The renderer used to work this out by asking whether the interpolated
     * position had reached the real one, which is a float comparison that
     * never comes out true: a snapshot arriving a few milliseconds early
     * leaves the interpolation a hair short, and every tick after that only
     * halves the gap. So the legs kept walking on the spot forever, and
     * headingOf read the leftover hair as a direction and snapped whoever it
     * was to face east.
     */
    p.stepping = moved;
    p.ix = p.rx; p.iy = p.ry;
    if (p.x !== self.x) p.facing = self.x > p.x ? 1 : -1;
    p.x = self.x; p.y = self.y;
    p.hp = self.hp; p.maxHp = self.mx;
    p.energy = self.en; p.running = !!self.run;
    p.venom = self.ven;
    p.dead = !!self.dead;
    p.inCombat = self.cmb;
    p.moving = !!self.act;
    if (!!self.dead && !wasDead) s.bus.emit('died');
    if (moved) { p.steps = (p.steps || 0) + 1; s.bus.emit('stepped'); }

    /*
     * Swings arrive as a one-tick pulse and are played out locally against the
     * wall clock, so the animation runs at frame rate instead of stepping once
     * every 600 ms with the rest of the snapshot.
     */
    if (self.sw) p.swingAt = performance.now();
    s.gatherNode = self.gn ? { x: self.gn[0], y: self.gn[1] } : null;
    // the bubble over your own head expires on the server's clock, in step
    // with the one everyone else sees over you
    p.chat = self.c ? { text: self.c, ttl: 1 } : null;
    s.vigil.points = self.vp;
    s.vigil.max = self.vm;
    s.vigil.active = self.va || [];
    s.attackStyle = self.style;
    s.autocast = self.cast;
    s.boosts = self.boosts || {};

    /*
     * Announced last, once the rest of this snapshot is in place. Anyone
     * listening has to know which spell was being cast and whether it was a
     * spell at all, and both of those arrive in the same message as the
     * swing itself.
     */
    if (self.sw) s.bus.emit('swing');

    /* -- npcs -- */
    const seen = new Set();
    for (const n of msg.npcs) {
      seen.add(n.u);
      let e = this.npcById.get(n.u);
      if (!e) {
        e = { uid: n.u, id: n.i, x: n.x, y: n.y, ix: n.x, iy: n.y, rx: n.x, ry: n.y,
              hp: n.hp, maxHp: n.mx, dead: false, path: [], hurtFlash: 0 };
        this.npcById.set(n.u, e);
      } else {
        e.ix = e.rx; e.iy = e.ry;
        e.path = (e.x !== n.x || e.y !== n.y) ? [1] : [];   // drives the walk bob
        e.stepping = e.path.length > 0;
        if (e.stepping) e.steps = (e.steps || 0) + 1;
        e.x = n.x; e.y = n.y;
        if (n.hp < e.hp) e.hurtFlash = 3;
        e.hp = n.hp;
      }
      if (n.sw) e.swingAt = performance.now();
    }
    for (const uid of [...this.npcById.keys()]) {
      if (!seen.has(uid)) this.npcById.delete(uid);
    }
    s.npcs = [...this.npcById.values()];

    s.target = self.tgt != null && this.npcById.has(self.tgt)
      ? { kind: 'npc', ref: this.npcById.get(self.tgt) }
      : null;

    /* -- other players -- */
    const alive = new Set();
    for (const o of msg.players) {
      alive.add(o.u);
      let e = s.others.get(o.u);
      if (!e) {
        e = { id: o.u, name: o.n, x: o.x, y: o.y, ix: o.x, iy: o.y, rx: o.x, ry: o.y,
              color: colorFor(o.u), chat: null, moving: false };
        s.others.set(o.u, e);
      } else {
        e.ix = e.rx; e.iy = e.ry;
        e.moving = e.x !== o.x || e.y !== o.y;
        e.stepping = e.moving;
        if (e.moving) e.steps = (e.steps || 0) + 1;
        e.x = o.x; e.y = o.y;
        e.name = o.n;
      }
      e.body = o.b; e.head = o.h; e.weapon = o.w;
      e.chat = o.c ? { text: o.c, ttl: 1 } : null;
      if (o.sw) e.swingAt = performance.now();
    }
    for (const id of [...s.others.keys()]) if (!alive.has(id)) s.others.delete(id);

    /* -- ground, scenery, effects -- */
    s.ground = msg.ground.map(g => ({ id: g.i, n: g.n, x: g.x, y: g.y, ttl: 999 }));

    for (const o of msg.objs || []) {
      const obj = this.world.objectAt(o.x, o.y);
      if (!obj) continue;
      obj.depleted = o.d ? 1 : 0;
      // doors are drawn mid-swing, so the renderer eases towards this
      if ('p' in o) obj.open = !!o.p;
    }

    this.applyStock(msg.shops);

    for (const f of msg.fx || []) {
      s.hitsplats.push({ x: f.x, y: f.y, dmg: f.d, self: !!f.s, ttl: 30,
                         off: Math.floor(Math.random() * 12) - 6 });
      // only the blows you are part of are worth hearing; the rest is someone
      // else's fight happening across the room
      const mine = f.s || (s.target?.ref && f.x === s.target.ref.x && f.y === s.target.ref.y);
      if (mine) s.bus.emit('blow', { self: !!f.s, dmg: f.d });
    }
    for (const f of msg.floaters || []) {
      s.floaters.push({ x: f.x, y: f.y, text: f.t, color: f.c, ttl: 60 });
    }
  }

  /** 0..1 through the current server tick, for render interpolation. */
  alpha() {
    return Math.min(1, (performance.now() - this.lastSnapAt) / TICK_MS);
  }

  /* ---------------- outbound intents ---------------------- */

  move(x, y)                 { this.send({ t: 'move', x, y }); }
  attack(uid)                { this.send({ t: 'attack', u: uid }); }
  interact(x, y)             { this.send({ t: 'interact', x, y }); }
  pickup(x, y, id)           { this.send({ t: 'pickup', x, y, i: id }); }
  talk(uid)                  { this.send({ t: 'talk', u: uid }); }
  /**
   * What is on the shelves, as the server last told us.
   *
   * Kept beside the player's state rather than in it: this is world state on
   * loan, shared with everyone else in the Throat, and it is the server's to
   * change. The panel falls back to the numbers the shop was written with for
   * any shop we have not been told about yet.
   */
  applyStock(list) {
    if (!list || !list.length) return;
    const s = this.state;
    s.shopStock ||= {};
    for (const { id, stock } of list) s.shopStock[id] = Object.fromEntries(stock);
    s.bus.emit('shopstock', list.map(e => e.id));
  }

  dialogue(choice)           { this.send({ t: 'dialogue', choice }); }
  useItem(idx)               { this.send({ t: 'use', idx }); }
  equip(idx)                 { this.send({ t: 'equip', idx }); }
  unequip(slot)              { this.send({ t: 'unequip', slot }); }
  drop(idx)                  { this.send({ t: 'drop', idx }); }
  swap(a, b)                 { this.send({ t: 'swap', a, b }); }
  useOnItem(idx, target)     { this.send({ t: 'useon', idx, kind: 'item', target }); }
  useOnNpc(idx, uid)         { this.send({ t: 'useon', idx, kind: 'npc', u: uid }); }
  useOnObj(idx, x, y)        { this.send({ t: 'useon', idx, kind: 'obj', x, y }); }
  craft(station, out, qty)   { this.send({ t: 'craft', station, out, qty }); }
  buy(shop, item, n)         { this.send({ t: 'buy', shop, item, n }); }
  sell(shop, idx, n)         { this.send({ t: 'sell', shop, idx, n }); }
  bank(op, extra = {})       { this.send({ t: 'bank', op, ...extra }); }
  vigil(id)                  { this.send({ t: 'vigil', id }); }
  autocast(id)               { this.send({ t: 'autocast', id }); }
  style(id)                  { this.send({ t: 'style', id }); }
  castUtility(id)            { this.send({ t: 'castutil', id }); }
  toggleRun()                { this.send({ t: 'run' }); }
  say(text)                  { this.send({ t: 'chat', text }); }
  addFriend(name)            { this.send({ t: 'friend', op: 'add', name }); }
  delFriend(name)            { this.send({ t: 'friend', op: 'del', name }); }
  tell(name, text)           { this.send({ t: 'tell', name, text }); }
  tradeRequest(uid)          { this.send({ t: 'trade', op: 'req', u: uid }); }
  tradeOffer(idx, n)         { this.send({ t: 'trade', op: 'offer', idx, n }); }
  tradeWithdraw(idx, n)      { this.send({ t: 'trade', op: 'withdraw', idx, n }); }
  tradeAccept(stage)         { this.send({ t: 'trade', op: 'accept', stage }); }
  tradeDecline()             { this.send({ t: 'trade', op: 'decline' }); }
}

/** id -> total held, so two packs can be compared for what arrived. */
function countBy(inv) {
  const out = {};
  for (const s of inv) if (s) out[s.id] = (out[s.id] || 0) + s.n;
  return out;
}

/** Stable per-player tunic colour so people are recognisable. */
function colorFor(id) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hues = ['#7fbf8f', '#86b7e0', '#d9c0e0', '#e0b357', '#c9b48f', '#b8687a', '#6fd1a5'];
  return hues[h % hues.length];
}

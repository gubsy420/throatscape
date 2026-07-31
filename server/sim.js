/* ============================================================
   Sim - the authoritative game world
   ------------------------------------------------------------
   One world, one NPC population, one ground-item list, and a
   session per logged-in player. Every rule that used to run in
   the browser runs here instead; the client only draws what it
   is told and asks for things it would like to happen.
   ============================================================ */

import { buildWorld, OBJ, RESPAWN } from '../js/data/world.js';
import { NPCS } from '../js/data/npcs.js';
import { ITEMS } from '../js/data/items.js';
import { SHOPS } from '../js/data/shops.js';
import { DIALOGUE } from '../js/data/quests.js';
import { SPELL_BY_ID, VIGIL_BY_ID, conflicts } from '../js/data/magic.js';
import * as MagicData from '../js/data/magic.js';
import { SKILL_IDS, SKILL_BY_ID } from '../js/data/skills.js';

import { cheb, findPath, randInt, chance, weightedPick, clamp } from '../js/util.js';
import {
  createState, deserialize, serialize, addItem, removeItem, removeSlot,
  invCount, canHold, addXp, baseLevel, effLevel, equipBonuses, equipFromSlot,
  unequip, bankDeposit, bankDepositAll, bankWithdraw, log, toast, floater,
  questProgress
} from '../js/game/state.js';
import {
  spawnNpcs, npcAt, npcProfile, hitChance, playerCombatProfile,
  playerAttackTick, tickPlayerEffects, dealDamageToNpc, playerDeath,
  bindVigilData, STYLES
} from '../js/game/combat.js';
import {
  walkTo, movePlayer, tickAction, interactObject, pickUp, dropItem,
  useItem, useItemOn, tickGround, tickResourceRespawn, tickDoors, clearAction
} from '../js/game/actions.js';
import { makeQuestApi, questHook } from '../js/game/questapi.js';
import { craft, buy, sell, findRecipe } from '../js/game/economy.js';

bindVigilData(MagicData);

export const TICK_MS = 600;
const VIEW = 26;                 // tiles of visibility around a player
const SAVE_EVERY_TICKS = 50;     // ~30 seconds

/* ============================================================
   Player session
   ============================================================ */

class Session {
  constructor(sim, key, name, saved) {
    this.sim = sim;
    this.key = key;
    this.name = name;
    this.outbox = [];
    this.dirty = { inv: true, equip: true, skills: true, quests: true, bank: false };
    this.dialogue = null;
    this.lastSave = 0;
    this.chatTtl = 0;

    const st = saved ? deserialize(saved) : createState(name);
    st.name = name;
    // shared code writes this onto anything it hits, so the sim knows who swung
    st.key = key;

    // share the one world population rather than each player having their own
    st.npcs = sim.npcs;
    st.ground = sim.ground;
    st.occupied = (x, y) => sim.playerAt(x, y, this) !== null;

    this.state = st;
    this.bindBus();
  }

  /** The existing game code already announces everything we need to relay. */
  bindBus() {
    const b = this.state.bus;
    b.on('inv',    () => { this.dirty.inv = true; });
    b.on('equip',  () => { this.dirty.equip = true; });
    b.on('bank',   () => { this.dirty.bank = true; });
    b.on('xp',     () => { this.dirty.skills = true; });
    b.on('quest',  () => { this.dirty.quests = true; });
    b.on('vigil',  () => { /* folded into the per-tick self block */ });

    b.on('chat',   ({ text, cls }) => this.send({ t: 'msg', text, cls }));
    b.on('toast',  ({ text, cls }) => this.send({ t: 'toast', text, cls }));
    b.on('levelup', ({ skill, level }) => this.send({ t: 'levelup', skill, level }));

    b.on('openbank', () => this.send({ t: 'ui', kind: 'bank' }));
    b.on('openshop', id => this.send({ t: 'ui', kind: 'shop', id }));
    b.on('openmake', station => this.send({ t: 'ui', kind: 'make', station }));

    // quests advance on kills; in the browser main.js wired this up
    b.on('kill', ({ npcId }) => questHook(makeQuestApi(this.state), 'onKill', npcId));
  }

  send(msg) { this.outbox.push(msg); }

  get p() { return this.state.player; }

  serialize() { return serialize(this.state); }
}

/* ============================================================
   Simulation
   ============================================================ */

export class Sim {
  constructor() {
    this.world = buildWorld();
    this.npcs = [];
    this.ground = [];
    this.sessions = new Map();      // key -> Session
    this.tick = 0;
    this.fx = [];                   // public hitsplats for this tick
    this.objectChanges = [];        // scenery depletion changes this tick
    this.depletedState = new Map(); // object -> 0|1, for diffing

    // spawnNpcs writes into state.npcs, so lend it a shim
    const shim = { npcs: [] };
    spawnNpcs(shim, this.world);
    this.npcs = shim.npcs;
    this.npcByUid = new Map(this.npcs.map(n => [n.uid, n]));
  }

  /* ---------------- sessions ------------------------------ */

  add(key, name, saved) {
    const s = new Session(this, key, name, saved);
    this.sessions.set(key, s);
    s.state.npcs = this.npcs;
    s.state.ground = this.ground;
    return s;
  }

  remove(key) {
    const s = this.sessions.get(key);
    if (!s) return null;
    for (const n of this.npcs) if (n.targetKey === key) { n.targetKey = null; n.path = []; }
    this.sessions.delete(key);
    return s;
  }

  get(key) { return this.sessions.get(key); }
  get playerCount() { return this.sessions.size; }

  playerAt(x, y, except) {
    for (const s of this.sessions.values()) {
      if (s === except || s.p.dead) continue;
      if (s.p.x === x && s.p.y === y) return s;
    }
    return null;
  }

  /* ---------------- the tick ------------------------------ */

  step() {
    this.tick++;
    this.fx.length = 0;
    this.objectChanges.length = 0;

    for (const s of this.sessions.values()) {
      const st = s.state;
      st.tick = this.tick;
      st.player.ix = st.player.x;
      st.player.iy = st.player.y;

      movePlayer(st, this.world);
      tickAction(st, this.world, null);
      playerAttackTick(st, this.world);
      tickPlayerEffects(st);

      if (s.chatTtl > 0 && --s.chatTtl === 0) st.player.chatText = null;

      // hitsplats are public; floaters (xp drops) stay with their owner
      if (st.hitsplats.length) {
        for (const h of st.hitsplats) this.fx.push({ x: h.x, y: h.y, d: h.dmg, s: h.self ? 1 : 0 });
        st.hitsplats.length = 0;
      }
    }

    this.tickNpcs();
    this.tickDoors();
    tickGround({ ground: this.ground });
    this.tickResources();
    this.syncObjects();

    for (const s of this.sessions.values()) this.buildSnapshot(s);
  }

  /* ---------------- scenery ------------------------------- */

  tickResources() {
    for (const o of this.world.objects) if (o.depleted > 0) o.depleted--;
  }

  /** Emits a change whenever a node flips between full and exhausted. */
  syncObjects() {
    for (const o of this.world.objects) {
      if (!OBJ[o.type]?.skill) continue;
      const now = o.depleted > 0 ? 1 : 0;
      if ((this.depletedState.get(o) ?? 0) !== now) {
        this.depletedState.set(o, now);
        this.objectChanges.push(o);
      }
    }
  }

  /**
   * Doors open for anyone standing next to them. This has to consider every
   * player at once, which is why it does not use the client's tickDoors.
   */
  tickDoors() {
    if (!this._doors) {
      this._doors = this.world.objects.filter(o => o.type === 'door' || o.type === 'gate');
    }
    for (const d of this._doors) {
      if (d.held) continue;
      let near = false;
      for (const s of this.sessions.values()) {
        if (cheb(s.p.x, s.p.y, d.x, d.y) <= 1) { near = true; break; }
      }
      d.open = near;
    }
  }

  /* ---------------- NPCs ---------------------------------- */

  /**
   * Multiplayer NPC behaviour: aggressive NPCs pick the nearest eligible
   * player rather than the only one, and give up if that player leaves.
   */
  tickNpcs() {
    const world = this.world;

    for (const n of this.npcs) {
      const d = NPCS[n.id];

      if (n.dead) {
        if (--n.respawnIn <= 0) {
          n.dead = false;
          n.hp = n.maxHp;
          n.x = n.px = n.spawnX;
          n.y = n.py = n.spawnY;
          n.venom = 0;
          n.targetKey = null;
        }
        continue;
      }

      if (n.hurtFlash > 0) n.hurtFlash--;
      if (n.cd > 0) n.cd--;

      if (!d.hostile) { this.wander(n, d); continue; }

      /*
       * Retaliation. Most of the early mobs have aggroRange 0 - they never
       * pick a fight - but hitting one has to make it fight back, or a ward
       * rat is a training dummy. dealDamageToNpc stamps the attacker's key
       * onto n.target; adopting it here is what turns a hit into a fight.
       */
      if (n.target && n.target !== n.targetKey && this.sessions.has(n.target)) {
        n.targetKey = n.target;
        n.path = [];
      }
      n.target = null;

      let target = n.targetKey ? this.sessions.get(n.targetKey) : null;
      if (target && (target.p.dead || cheb(n.x, n.y, target.p.x, target.p.y) > 12)) {
        target = null;
        n.targetKey = null;
        n.path = [];
      }

      if (!target && d.aggroRange > 0) {
        const reg = world.regionAt(n.x, n.y);
        if (!reg?.safe) {
          let best = null, bd = Infinity;
          for (const s of this.sessions.values()) {
            if (s.p.dead) continue;
            const dd = cheb(n.x, n.y, s.p.x, s.p.y);
            if (dd <= d.aggroRange && dd < bd) { bd = dd; best = s; }
          }
          if (best) { target = best; n.targetKey = best.key; }
        }
      }

      if (!target) { this.wander(n, d); continue; }

      const p = target.p;
      const range = d.magic ? 5 : d.attackRange || 1;
      const dd = cheb(n.x, n.y, p.x, p.y);

      if (dd > range) {
        if (!n.path.length || this.tick % 3 === 0) {
          n.path = findPath(n.x, n.y, p.x, p.y,
            (x, y) => world.isWalkable(x, y) &&
                      !(x === p.x && y === p.y) &&
                      !this.playerAt(x, y) &&
                      !(npcAt({ npcs: this.npcs }, x, y) && npcAt({ npcs: this.npcs }, x, y) !== n),
            600).slice(0, 6);
        }
        this.stepNpc(n);
      } else {
        n.path = [];
        if (n.cd <= 0) {
          n.cd = d.speed || 4;
          this.npcAttack(n, d, target);
        }
      }
    }
  }

  wander(n, d) {
    if (!d.wander) return;
    if (n.path.length) { this.stepNpc(n); return; }
    if (--n.wanderCd > 0) return;
    n.wanderCd = randInt(6, 20);
    const tx = n.spawnX + randInt(-d.wander, d.wander);
    const ty = n.spawnY + randInt(-d.wander, d.wander);
    if (!this.world.isWalkable(tx, ty)) return;
    n.path = findPath(n.x, n.y, tx, ty,
      (x, y) => this.world.isWalkable(x, y) &&
                !npcAt({ npcs: this.npcs }, x, y) && !this.playerAt(x, y),
      300).slice(0, 4);
  }

  stepNpc(n) {
    const next = n.path.shift();
    if (!next) return;
    if (!this.world.isWalkable(next.x, next.y) ||
        npcAt({ npcs: this.npcs }, next.x, next.y) ||
        this.playerAt(next.x, next.y)) { n.path = []; return; }
    n.px = n.x; n.py = n.y;
    n.x = next.x; n.y = next.y;
  }

  npcAttack(n, d, session) {
    const st = session.state;
    const p = st.player;
    if (p.dead) return;

    const prof = playerCombatProfile(st);
    const npd = npcProfile(n);
    const acc = hitChance(npd.attRoll, prof.defRoll);
    const dmg = Math.random() < acc ? Math.floor(Math.random() * (npd.maxHit + 1)) : 0;

    p.inCombat = 12;
    p.hp = Math.max(0, p.hp - dmg);
    this.fx.push({ x: p.x, y: p.y, d: dmg, s: 1 });

    if (d.venomous && dmg > 0 && chance(0.22) && p.venom <= 0) {
      p.venom = 10;
      log(st, 'You have been venomed!', 'bad');
    }
    if (p.hp <= 0) playerDeath(st);
  }

  /* ---------------- snapshots ----------------------------- */

  buildSnapshot(s) {
    const st = s.state;
    const p = st.player;
    const near = (x, y) => Math.abs(x - p.x) <= VIEW && Math.abs(y - p.y) <= VIEW;

    const snap = {
      t: 'snap',
      k: this.tick,
      self: {
        x: p.x, y: p.y, hp: Math.ceil(p.hp), mx: p.maxHp,
        en: Math.round(p.energy), run: p.running ? 1 : 0,
        vp: +st.vigil.points.toFixed(1), vm: st.vigil.max,
        va: st.vigil.active,
        ven: p.venom > 0 ? 1 : 0,
        dead: p.dead ? 1 : 0,
        cmb: p.inCombat > 0 ? 1 : 0,
        tgt: st.target?.ref ? st.target.ref.uid : null,
        act: st.action ? 1 : 0,
        style: st.attackStyle,
        cast: st.autocast,
        boosts: st.boosts,
        c: p.chatText || null
      },
      npcs: [],
      players: [],
      ground: [],
      objs: [],
      fx: []
    };

    for (const n of this.npcs) {
      if (n.dead || !near(n.x, n.y)) continue;
      snap.npcs.push({ u: n.uid, i: n.id, x: n.x, y: n.y, hp: n.hp, mx: n.maxHp });
    }

    for (const other of this.sessions.values()) {
      if (other === s || other.p.dead || !near(other.p.x, other.p.y)) continue;
      snap.players.push({
        u: other.key, n: other.name, x: other.p.x, y: other.p.y,
        b: other.state.equipment.body || null,
        h: other.state.equipment.head || null,
        w: other.state.equipment.weapon || null,
        c: other.p.chatText || null
      });
    }

    for (const g of this.ground) {
      if (!near(g.x, g.y)) continue;
      snap.ground.push({ i: g.id, n: g.n, x: g.x, y: g.y });
    }

    for (const o of this.objectChanges) {
      if (near(o.x, o.y)) snap.objs.push({ x: o.x, y: o.y, d: o.depleted > 0 ? 1 : 0 });
    }

    for (const f of this.fx) {
      if (near(f.x, f.y)) snap.fx.push(f);
    }

    if (st.floaters.length) {
      snap.floaters = st.floaters.map(f => ({ x: f.x, y: f.y, t: f.text, c: f.color }));
      st.floaters.length = 0;
    }

    s.send(snap);

    /*
     * Re-assert the slow-moving state periodically. Nothing depends on the
     * client believing it, but a replica that has drifted - through a dropped
     * packet or a player poking at the console - should heal itself rather
     * than display numbers that are quietly wrong.
     */
    if (this.tick % 50 === 0) {
      s.dirty.inv = s.dirty.equip = s.dirty.skills = true;
    }

    if (s.dirty.inv)    { s.send({ t: 'inv', inv: st.inventory.map(x => x ? [x.id, x.n] : null) }); s.dirty.inv = false; }
    if (s.dirty.equip)  { s.send({ t: 'equip', eq: st.equipment }); s.dirty.equip = false; }
    if (s.dirty.skills) { s.send({ t: 'skills', xp: Object.fromEntries(SKILL_IDS.map(i => [i, Math.round(st.skills[i].xp)])) }); s.dirty.skills = false; }
    if (s.dirty.quests) { s.send({ t: 'quests', q: st.quests }); s.dirty.quests = false; }
    if (s.dirty.bank)   { s.send({ t: 'bank', bank: st.bank.map(b => [b.id, b.n]) }); s.dirty.bank = false; }
  }

  /** Everything the client needs once, at login. */
  initPacket(s) {
    const st = s.state;
    return {
      t: 'init',
      name: s.name,
      tick: this.tick,
      pos: { x: st.player.x, y: st.player.y },
      inv: st.inventory.map(x => x ? [x.id, x.n] : null),
      eq: st.equipment,
      xp: Object.fromEntries(SKILL_IDS.map(i => [i, Math.round(st.skills[i].xp)])),
      quests: st.quests,
      bank: st.bank.map(b => [b.id, b.n]),
      vigil: { points: st.vigil.points, max: st.vigil.max, active: st.vigil.active },
      style: st.attackStyle,
      cast: st.autocast,
      // scenery that is currently depleted, so new arrivals see stumps
      objs: this.world.objects.filter(o => o.depleted > 0).map(o => ({ x: o.x, y: o.y, d: 1 }))
    };
  }

  /** Speech bubbles are relayed through the snapshot, not a separate channel. */
  setChat(s, text) {
    s.state.player.chatText = text;
    s.chatTtl = 6;
  }

  /* ============================================================
     Intents - everything a client is allowed to ask for
     ============================================================ */

  handle(s, msg) {
    const st = s.state;
    if (st.player.dead && msg.t !== 'chat') return;

    switch (msg.t) {
      case 'move': {
        const x = int(msg.x), y = int(msg.y);
        if (x === null || y === null) return;
        clearAction(st);
        st.target = null;
        s.dialogue = null;
        walkTo(st, this.world, clamp(x, 0, this.world.w - 1), clamp(y, 0, this.world.h - 1));
        break;
      }

      case 'attack': {
        const n = this.npcByUid.get(int(msg.u));
        if (!n || n.dead || !NPCS[n.id].hostile) return;
        if (cheb(st.player.x, st.player.y, n.x, n.y) > 20) return;
        clearAction(st);
        st.target = { kind: 'npc', ref: n };
        log(st, `You attack the ${NPCS[n.id].name.toLowerCase()}.`);
        break;
      }

      case 'interact': {
        const o = this.world.objectAt(int(msg.x), int(msg.y));
        if (!o) return;
        if (cheb(st.player.x, st.player.y, o.x, o.y) > 30) return;
        st.target = null;
        s.dialogue = null;
        interactObject(st, this.world, o, null);
        break;
      }

      case 'pickup': {
        const g = this.ground.find(g => g.x === int(msg.x) && g.y === int(msg.y) && g.id === msg.i);
        if (!g) return;
        pickUp(st, this.world, g);
        break;
      }

      case 'talk': {
        const n = this.npcByUid.get(int(msg.u));
        if (!n || n.dead || NPCS[n.id].hostile) return;
        this.startTalk(s, n);
        break;
      }

      case 'dialogue': this.advanceDialogue(s, msg); break;

      case 'use':    useItem(st, int(msg.idx)); break;
      case 'equip':  equipFromSlot(st, int(msg.idx)); break;
      case 'unequip': unequip(st, String(msg.slot)); break;
      case 'drop':   dropItem(st, int(msg.idx)); break;

      case 'swap': {
        const a = int(msg.a), b = int(msg.b);
        if (a === null || b === null) return;
        if (a < 0 || b < 0 || a >= st.inventory.length || b >= st.inventory.length) return;
        const t = st.inventory[a];
        st.inventory[a] = st.inventory[b];
        st.inventory[b] = t;
        s.dirty.inv = true;
        break;
      }

      case 'useon': {
        const idx = int(msg.idx);
        if (idx === null || !st.inventory[idx]) return;
        if (msg.kind === 'npc') {
          const n = this.npcByUid.get(int(msg.u));
          if (n && !n.dead) useItemOn(st, this.world, idx, { kind: 'npc', ref: n });
        } else if (msg.kind === 'obj') {
          const o = this.world.objectAt(int(msg.x), int(msg.y));
          if (o) useItemOn(st, this.world, idx, { kind: 'obj', ref: o });
        } else if (msg.kind === 'item') {
          useItemOn(st, this.world, idx, { kind: 'item', idx: int(msg.target) });
        }
        break;
      }

      case 'craft': {
        const station = String(msg.station || '');
        const recipe = findRecipe(station, String(msg.out || ''));
        if (!recipe) return;
        if (!this.nearStation(st, station)) { log(st, 'I am not standing at the right station.', 'bad'); return; }
        craft(st, station, recipe, msg.qty);
        break;
      }

      case 'buy': {
        const shop = SHOPS[String(msg.shop || '')];
        if (!shop || !this.nearShop(st, shop.id)) return;
        buy(st, shop, String(msg.item || ''), int(msg.n) ?? 1);
        break;
      }

      case 'sell': {
        const shop = SHOPS[String(msg.shop || '')];
        if (!shop || !this.nearShop(st, shop.id)) return;
        sell(st, shop, int(msg.idx), int(msg.n) ?? 1);
        break;
      }

      case 'bank': {
        if (!this.nearBank(st)) { log(st, 'I am not at a bank.', 'bad'); return; }
        if (msg.op === 'dep') bankDeposit(st, int(msg.idx), int(msg.n) ?? 1);
        else if (msg.op === 'depall') bankDepositAll(st, String(msg.id || ''));
        else if (msg.op === 'wd') bankWithdraw(st, int(msg.idx), int(msg.n) ?? 1);
        else if (msg.op === 'depeverything') {
          const ids = [...new Set(st.inventory.filter(Boolean).map(x => x.id))];
          for (const id of ids) bankDepositAll(st, id);
        }
        break;
      }

      case 'vigil': {
        const v = VIGIL_BY_ID[String(msg.id || '')];
        if (!v) return;
        if (baseLevel(st, 'vigil') < v.level) return;
        const on = st.vigil.active.includes(v.id);
        if (on) {
          st.vigil.active = st.vigil.active.filter(x => x !== v.id);
        } else {
          if (st.vigil.points <= 0) { log(st, 'I have no vigil left. I should rest at an altar.', 'bad'); return; }
          st.vigil.active = st.vigil.active.filter(x => !conflicts(x, v.id));
          st.vigil.active.push(v.id);
          log(st, `You begin ${v.name}.`, 'good');
        }
        break;
      }

      case 'autocast': {
        const sp = SPELL_BY_ID[String(msg.id || '')];
        if (msg.id && (!sp || baseLevel(st, 'anatomancy') < sp.level)) return;
        st.autocast = st.autocast === msg.id ? null : (msg.id || null);
        log(st, st.autocast ? `Autocasting ${SPELL_BY_ID[st.autocast].name}.` : 'Autocast cleared.');
        break;
      }

      case 'style': {
        if (!STYLES[msg.id]) return;
        st.attackStyle = msg.id;
        log(st, `Attack style: ${STYLES[msg.id].name}.`);
        break;
      }

      case 'castutil': this.castUtility(s, String(msg.id || '')); break;

      case 'run': {
        if (!st.player.running && st.player.energy < 5) { log(st, 'I am too tired to run.'); return; }
        st.player.running = !st.player.running;
        break;
      }
    }
  }

  /* ---------------- station proximity --------------------- */

  nearObject(st, predicate, radius = 2) {
    const p = st.player;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const o = this.world.objectAt(p.x + dx, p.y + dy);
        if (o && predicate(o)) return true;
      }
    }
    return false;
  }

  nearStation(st, station) {
    const wanted = {
      smelting: ['furnace'], forging: ['anvil'], apothecary: ['cauldron'],
      suturing: ['sewing_table'], cooking: ['cook_range']
    }[station];
    if (!wanted) return false;
    return this.nearObject(st, o => wanted.includes(o.type));
  }

  nearBank(st) {
    if (this.nearObject(st, o => o.type === 'bank_booth')) return true;
    // bankers double as booths
    return this.npcs.some(n => !n.dead && NPCS[n.id].bank &&
      cheb(n.x, n.y, st.player.x, st.player.y) <= 3);
  }

  nearShop(st, shopId) {
    return this.npcs.some(n => !n.dead && NPCS[n.id].shop === shopId &&
      cheb(n.x, n.y, st.player.x, st.player.y) <= 4);
  }

  /* ---------------- dialogue ------------------------------ */

  startTalk(s, n) {
    const st = s.state;
    const d = NPCS[n.id];
    clearAction(st);
    st.target = null;

    // walk into range first, exactly as the client used to
    const self = this;
    st.action = {
      at: { x: n.x, y: n.y }, range: 2, walkTo: { x: n.x, y: n.y },
      run() {
        st.player.facing = n.x >= st.player.x ? 1 : -1;
        if (d.bank) { st.bus.emit('openbank'); return; }
        const tree = DIALOGUE[d.talk];
        if (!tree) { log(st, d.examine || `${d.name} has nothing to say.`); return; }
        s.dialogue = { talk: d.talk, npcId: n.id, node: null };
        const g = makeQuestApi(st);
        const start = typeof tree.start === 'function' ? tree.start(g) : tree.start;
        self.showNode(s, start);
      }
    };
    walkTo(st, this.world, n.x, n.y, true);
  }

  /** Resolves a dialogue node, running its side effects, and sends it down. */
  showNode(s, id, guard = 0) {
    const st = s.state;
    if (!s.dialogue || guard > 24) { this.endDialogue(s); return; }
    if (!id || id === 'end') { this.endDialogue(s); return; }

    const tree = DIALOGUE[s.dialogue.talk];
    const node = tree?.nodes?.[id];
    if (!node) { this.endDialogue(s); return; }

    const g = makeQuestApi(st);
    if (node.act) node.act(g);

    const text = typeof node.text === 'function' ? node.text(g) : node.text;
    if (!text) return this.showNode(s, node.to, guard + 1);   // pure action node

    s.dialogue.node = id;
    const opts = (node.opts || [])
      .filter(o => !o.if || o.if(g))
      .map((o, i) => ({ i, label: typeof o.label === 'function' ? o.label(g) : o.label }));

    s.send({
      t: 'dialogue',
      npc: NPCS[s.dialogue.npcId]?.name || '',
      face: NPCS[s.dialogue.npcId]?.art?.k === 'patient' ? 'patient' : 'person',
      text, opts,
      cont: opts.length === 0
    });
  }

  advanceDialogue(s, msg) {
    if (!s.dialogue) return;
    const tree = DIALOGUE[s.dialogue.talk];
    const node = tree?.nodes?.[s.dialogue.node];
    if (!node) { this.endDialogue(s); return; }

    const g = makeQuestApi(s.state);
    const opts = (node.opts || []).filter(o => !o.if || o.if(g));

    if (opts.length) {
      const choice = opts[int(msg.choice)];
      if (!choice) return;
      if (choice.act) choice.act(g);
      this.showNode(s, choice.to);
    } else {
      this.showNode(s, node.to);
    }
  }

  endDialogue(s) {
    s.dialogue = null;
    s.send({ t: 'dialogue', close: true });
  }

  /* ---------------- utility spells ------------------------ */

  castUtility(s, id) {
    const st = s.state;
    const sp = SPELL_BY_ID[id];
    if (!sp || sp.kind === 'attack' || sp.kind === 'drain') return;
    if (baseLevel(st, 'anatomancy') < sp.level) {
      log(st, `I need Anatomancy ${sp.level} for that.`, 'bad'); return;
    }
    for (const r in sp.runes) {
      if (invCount(st, r) < sp.runes[r]) { log(st, 'I do not have the runes for that.', 'bad'); return; }
    }

    const spend = () => { for (const r in sp.runes) removeItem(st, r, sp.runes[r]); };
    const p = st.player;

    if (sp.kind === 'teleport') {
      if (p.inCombat > 0) { log(st, 'Not while I am in combat.', 'bad'); return; }
      spend();
      p.x = p.px = p.ix = sp.dest.x;
      p.y = p.py = p.iy = sp.dest.y;
      p.path = [];
      clearAction(st);
      st.target = null;
      addXp(st, 'anatomancy', sp.xp);
      log(st, `You blink across the Throat to ${sp.place}.`, 'good');
      s.send({ t: 'teleport', x: p.x, y: p.y });
      return;
    }

    if (sp.kind === 'heal') {
      if (p.hp >= p.maxHp) { log(st, 'I am not injured.'); return; }
      spend();
      const healed = Math.min(sp.amount, p.maxHp - p.hp);
      p.hp += healed;
      addXp(st, 'anatomancy', sp.xp);
      addXp(st, 'triage', sp.amount);
      floater(st, p.x, p.y, '+' + healed, '#6fd1a5');
      log(st, 'You knit your own wounds shut.', 'good');
      return;
    }

    if (sp.kind === 'inspect') {
      const t = st.target;
      if (!t || t.kind !== 'npc') { log(st, 'I need to select a creature first.', 'bad'); return; }
      spend();
      const d = NPCS[t.ref.id];
      addXp(st, 'anatomancy', sp.xp);
      log(st, `${d.name} - combat level ${d.lvl}, ${t.ref.hp}/${t.ref.maxHp} hitpoints.`, 'system');
      log(st, `Attack ${d.stats.att}, Strength ${d.stats.str}, Defence ${d.stats.def}. ${d.examine}`, 'system');
    }
  }
}

/* ---------------- helpers ----------------------------------- */

function int(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

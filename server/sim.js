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
  bindVigilData, STYLES, meleeAdjacent, pathAdjacentFrom
} from '../js/game/combat.js';
import {
  walkTo, movePlayer, tickAction, interactObject, pickUp, dropItem,
  useItem, useItemOn, tickGround, tickResourceRespawn, tickDoors, clearAction
} from '../js/game/actions.js';
import { makeQuestApi, questHook } from '../js/game/questapi.js';
import { craft, buy, sell, findRecipe } from '../js/game/economy.js';
import { MAX_FRIENDS } from '../js/game/state.js';
import { keyFor, NAME_RE } from './accounts.js';
import { Trades, TRADE_RANGE } from './trade.js';

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
    this.trade = null;         // the Trade this session is in, if any
    this.tradeReq = null;      // an outstanding request to someone else
    /*
     * What this player has been told about each piece of changeable scenery.
     * Per session rather than global: two nurses standing in different parts
     * of the ward know different things, and a change nobody was near to see
     * still has to reach whoever walks up to it later.
     */
    this.objSent = new Map();  // object -> depleted|open bits, as last sent

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
    b.on('kill', ({ npcId }) => {
      this.send({ t: 'cue', name: 'kill' });
      questHook(makeQuestApi(this.state), 'onKill', npcId);
    });
    // a snapshot cannot express "you finished a quest", so say so directly
    b.on('questcomplete', () => this.send({ t: 'cue', name: 'quest' }));
  }

  send(msg) { this.outbox.push(msg); }

  get p() { return this.state.player; }

  /**
   * Items sitting in a trade offer are saved as if they were still in the
   * pack. They belong to this player either way, and a crash between the
   * offer and the handshake must not be able to eat them. Anything that will
   * not fit back into 28 slots is put in the vault rather than dropped.
   */
  serialize() {
    const data = serialize(this.state);
    const escrow = this.sim.trades.escrowOf(this);
    if (!escrow.length) return data;

    for (const e of escrow) {
      const stack = ITEMS[e.id]?.stack;
      const slot = stack ? data.inventory.findIndex(s => s && s[0] === e.id) : -1;
      if (slot >= 0) { data.inventory[slot][1] += e.n; continue; }

      let left = e.n;
      while (left > 0) {
        const free = data.inventory.indexOf(null);
        if (free < 0) break;
        const take = stack ? left : 1;
        data.inventory[free] = [e.id, take];
        left -= take;
      }
      if (left > 0) {
        const b = data.bank.find(x => x[0] === e.id);
        if (b) b[1] += left; else data.bank.push([e.id, left]);
      }
    }
    return data;
  }
}

/* ============================================================
   Simulation
   ============================================================ */

export class Sim {
  /** `accounts` is only consulted to check a friend's name really exists. */
  constructor(accounts) {
    this.accounts = accounts || null;
    this.world = buildWorld();
    this.npcs = [];
    this.ground = [];
    this.sessions = new Map();      // key -> Session
    this.tick = 0;
    this.fx = [];                   // public hitsplats for this tick
    this.trades = new Trades(this);

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
    this.sendFriends(s);
    this.announceToFriends(key, name, true);
    return s;
  }

  remove(key) {
    const s = this.sessions.get(key);
    if (!s) return null;
    // hand the escrow back before anything else, so the save that follows
    // this includes it in the pack rather than in a trade that no longer exists
    if (s.trade) this.trades.close(s.trade, `${s.name} went off shift.`);
    for (const n of this.npcs) if (n.targetKey === key) { n.targetKey = null; n.path = []; }
    this.sessions.delete(key);
    this.announceToFriends(key, s.name, false);
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

    for (const s of this.sessions.values()) {
      const st = s.state;
      st.tick = this.tick;
      st.player.ix = st.player.x;
      st.player.iy = st.player.y;
      const wasAt = st.player.x * 100000 + st.player.y;

      /*
       * A swing is a single frame's worth of event, so the snapshot carries a
       * pulse rather than a countdown: the shared code bumps attackAnim on the
       * tick it strikes, and a rising edge is exactly "started swinging now".
       */
      const anim0 = st.player.attackAnim;

      movePlayer(st, this.world);

      // walking away ends the conversation, the way it does in the originals
      if (s.dialogue && st.player.x * 100000 + st.player.y !== wasAt) this.endDialogue(s);
      // what was being worked before the tick ran, because a successful
      // harvest ends the action and would otherwise take the node with it
      const wasWorking = st.action && st.action.kind === 'gather' && !st.player.path.length
        ? st.action.obj : null;
      tickAction(st, this.world, null);
      playerAttackTick(st, this.world);
      s.swung = st.player.attackAnim > anim0;
      tickPlayerEffects(st);

      /*
       * The node being worked, so the client can shake it, throw chips, swing
       * the right tool at it and keep quiet about spells.
       *
       * The blow that finishes a node clears the action, so reading it only
       * from st.action afterwards reports nothing on the one tick that
       * matters most - the client then drew the last chop as a weapon swing
       * and, with a staff equipped, played a spell for it.
       */
      const act = st.action;
      s.gathering = act && act.kind === 'gather' && act.obj && !st.player.path.length
        ? act.obj
        : (s.swung ? wasWorking : null);

      if (s.chatTtl > 0 && --s.chatTtl === 0) st.player.chatText = null;

      // hitsplats are public; floaters (xp drops) stay with their owner
      if (st.hitsplats.length) {
        for (const h of st.hitsplats) this.fx.push({ x: h.x, y: h.y, d: h.dmg, s: h.self ? 1 : 0 });
        st.hitsplats.length = 0;
      }
    }

    this.trades.tick();
    this.tickNpcs();
    this.tickDoors();
    tickGround({ ground: this.ground });
    this.tickResources();

    for (const s of this.sessions.values()) this.buildSnapshot(s);
  }

  /* ---------------- scenery ------------------------------- */

  tickResources() {
    for (const o of this.world.objects) if (o.depleted > 0) o.depleted--;
  }

  /**
   * The scenery that can be in more than one state: a node that empties and
   * fills again, and a door that swings. Everything else is generated
   * identically at both ends and never transmitted.
   */
  changeable() {
    if (!this._changeable) {
      this._changeable = this.world.objects.filter(o =>
        !!OBJ[o.type]?.skill || o.type === 'door' || o.type === 'gate');
    }
    return this._changeable;
  }

  /** The two bits of an object's state that the client is allowed to know. */
  static bitsOf(o) {
    return (o.depleted > 0 ? 1 : 0) | (o.open ? 2 : 0);
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
      // a melee npc has to come round to a cardinal square, same as the player
      const melee = !d.magic && range === 1;
      const reach = melee
        ? meleeAdjacent(n.x, n.y, p.x, p.y)
        : cheb(n.x, n.y, p.x, p.y) <= range;

      if (!reach) {
        if (!n.path.length || this.tick % 3 === 0) {
          const free = (x, y) => world.isWalkable(x, y) &&
                                 !this.playerAt(x, y) &&
                                 !(npcAt({ npcs: this.npcs }, x, y) &&
                                   npcAt({ npcs: this.npcs }, x, y) !== n);
          n.path = (melee
            ? pathAdjacentFrom(n.x, n.y, p.x, p.y, free, 600)
            : findPath(n.x, n.y, p.x, p.y, free, 600)).slice(0, 6);
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
    n.swingAt = this.tick;

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
        c: p.chatText || null,
        sw: s.swung ? 1 : 0,
        gn: s.gathering ? [s.gathering.x, s.gathering.y] : null
      },
      npcs: [],
      players: [],
      ground: [],
      objs: [],
      fx: []
    };

    for (const n of this.npcs) {
      if (n.dead || !near(n.x, n.y)) continue;
      snap.npcs.push({ u: n.uid, i: n.id, x: n.x, y: n.y, hp: n.hp, mx: n.maxHp,
                       sw: n.swingAt === this.tick ? 1 : 0 });
    }

    for (const other of this.sessions.values()) {
      if (other === s || other.p.dead || !near(other.p.x, other.p.y)) continue;
      snap.players.push({
        u: other.key, n: other.name, x: other.p.x, y: other.p.y,
        b: other.state.equipment.body || null,
        h: other.state.equipment.head || null,
        w: other.state.equipment.weapon || null,
        c: other.p.chatText || null,
        sw: other.swung ? 1 : 0
      });
    }

    for (const g of this.ground) {
      if (!near(g.x, g.y)) continue;
      snap.ground.push({ i: g.id, n: g.n, x: g.x, y: g.y });
    }

    /*
     * Scenery is reconciled against what this player has actually been told,
     * rather than broadcast at the moment it changes.
     *
     * Broadcasting the moment is a message you have to be standing there to
     * receive: chop a tree, walk away, and the tick where it grows back finds
     * you out of range and is dropped. Come back and it is still a stump,
     * for as long as you stay logged in. Diffing against what was sent means
     * walking back into range is itself the thing that corrects it.
     */
    for (const o of this.changeable()) {
      if (!near(o.x, o.y)) continue;
      const bits = Sim.bitsOf(o);
      // an unrecorded object at rest is already what the client generated
      if (!s.objSent.has(o) && bits === 0) { s.objSent.set(o, 0); continue; }
      if (s.objSent.get(o) === bits) continue;
      s.objSent.set(o, bits);
      snap.objs.push({ x: o.x, y: o.y, d: bits & 1 ? 1 : 0, p: bits & 2 ? 1 : 0 });
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
      // scenery that is currently depleted, so new arrivals see stumps.
      // Recorded as sent, because that is exactly what it is: from here on
      // the snapshot only mentions one when this player's picture is wrong.
      objs: this.world.objects.filter(o => o.depleted > 0).map(o => {
        s.objSent.set(o, Sim.bitsOf(o));
        return { x: o.x, y: o.y, d: 1 };
      })
    };
  }

  /** Speech bubbles are relayed through the snapshot, not a separate channel. */
  setChat(s, text) {
    s.state.player.chatText = text;
    s.chatTtl = 6;
  }

  /* ---------------- friends and whispers ------------------ */

  /**
   * Names are immutable, so the save holds display names and the key is
   * derived. That keeps the friends list readable in the JSON and means an
   * offline friend can still be listed by name.
   */
  friendList(s) {
    return s.state.friends.map(name => ({
      name,
      online: this.sessions.has(keyFor(name))
    }));
  }

  sendFriends(s) { s.send({ t: 'friends', list: this.friendList(s) }); }

  /** Tells everyone who has you listed that you came on or went off shift. */
  announceToFriends(key, name, online) {
    for (const other of this.sessions.values()) {
      if (other.key === key) continue;
      if (!other.state.friends.some(n => keyFor(n) === key)) continue;
      other.send({ t: 'msg', cls: 'private',
                   text: `${name} has ${online ? 'logged in' : 'logged out'}.` });
      this.sendFriends(other);
    }
  }

  addFriend(s, rawName) {
    const name = String(rawName || '').trim().slice(0, 12);
    const key = keyFor(name);
    if (!NAME_RE.test(name)) { log(s.state, 'That is not a name.', 'bad'); return; }
    if (key === s.key) { log(s.state, 'You cannot befriend yourself.', 'bad'); return; }
    if (this.accounts && !this.accounts.users.has(key)) {
      log(s.state, 'No nurse by that name.', 'bad');
      return;
    }
    if (s.state.friends.some(n => keyFor(n) === key)) {
      log(s.state, `${name} is already on your list.`);
      return;
    }
    if (s.state.friends.length >= MAX_FRIENDS) {
      log(s.state, 'Your friends list is full.', 'bad');
      return;
    }
    // store the account's own capitalisation, not whatever was typed
    const proper = this.accounts?.users.get(key)?.name || name;
    s.state.friends.push(proper);
    log(s.state, `${proper} added to your friends list.`);
    this.sendFriends(s);
  }

  removeFriend(s, rawName) {
    const key = keyFor(String(rawName || ''));
    const i = s.state.friends.findIndex(n => keyFor(n) === key);
    if (i < 0) return;
    const [gone] = s.state.friends.splice(i, 1);
    log(s.state, `${gone} removed from your friends list.`);
    this.sendFriends(s);
  }

  /**
   * A whisper needs no friendship in either direction - the friends list is
   * for knowing who is about, not for permission to speak.
   */
  whisper(s, rawName, rawText) {
    const text = String(rawText ?? '').slice(0, 120).replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!text) return;
    const name = String(rawName || '').trim();
    const target = this.sessions.get(keyFor(name));
    if (!target) {
      log(s.state, `${name || 'That nurse'} is not on shift.`, 'bad');
      return;
    }
    if (target === s) { log(s.state, 'Talking to yourself already?', 'bad'); return; }

    target.send({ t: 'private', dir: 'in', who: s.name, text });
    s.send({ t: 'private', dir: 'out', who: target.name, text });
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
        this.closeDialogue(s);
        walkTo(st, this.world, clamp(x, 0, this.world.w - 1), clamp(y, 0, this.world.h - 1));
        break;
      }

      case 'attack': {
        const n = this.npcByUid.get(int(msg.u));
        if (!n || n.dead || !NPCS[n.id].hostile) return;
        if (cheb(st.player.x, st.player.y, n.x, n.y) > 20) return;
        clearAction(st);
        this.closeDialogue(s);
        st.target = { kind: 'npc', ref: n };
        log(st, `You attack the ${NPCS[n.id].name.toLowerCase()}.`);
        break;
      }

      case 'interact': {
        const o = this.world.objectAt(int(msg.x), int(msg.y));
        if (!o) return;
        if (cheb(st.player.x, st.player.y, o.x, o.y) > 30) return;
        st.target = null;
        this.closeDialogue(s);
        interactObject(st, this.world, o, null);
        break;
      }

      case 'pickup': {
        const g = this.ground.find(g => g.x === int(msg.x) && g.y === int(msg.y) && g.id === msg.i);
        if (!g) return;
        this.closeDialogue(s);
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

      case 'friend':
        if (msg.op === 'add') this.addFriend(s, msg.name);
        else if (msg.op === 'del') this.removeFriend(s, msg.name);
        else this.sendFriends(s);
        break;

      case 'tell': this.whisper(s, msg.name, msg.text); break;

      case 'trade':
        if (msg.op === 'req') this.trades.request(s, msg.u);
        else if (msg.op === 'offer') this.trades.offer(s, int(msg.idx), int(msg.n) ?? 1);
        else if (msg.op === 'withdraw') this.trades.withdraw(s, int(msg.idx), int(msg.n) ?? 1);
        else if (msg.op === 'accept') this.trades.accept(s, int(msg.stage));
        else if (msg.op === 'decline') this.trades.decline(s);
        break;

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
      at: { x: n.x, y: n.y }, range: 2, arrive: true, walkTo: { x: n.x, y: n.y },
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
      // the id as well as the name: the client draws whoever is talking, and
      // it already has the model for every creature in the game
      id: s.dialogue.npcId,
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

  /**
   * Forgetting the conversation server-side is not enough - the box is drawn
   * by the client and stays up until it is told otherwise, which is what left
   * it hanging over the screen after walking off mid-sentence.
   */
  closeDialogue(s) { if (s.dialogue) this.endDialogue(s); }

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

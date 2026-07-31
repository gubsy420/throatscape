/* ============================================================
   Game state - the single mutable world the whole client shares
   ============================================================ */

import { makeBus, clamp } from '../util.js';
import { ITEMS, item, EQUIP_SLOTS } from '../data/items.js';
import { SKILLS, SKILL_IDS, startingSkills, levelForXp, xpForLevel,
         combatLevel, MAX_XP, MAX_LEVEL } from '../data/skills.js';
import { QUESTS, QUEST_BY_ID, DONE } from '../data/quests.js';
import { SPAWN } from '../data/world.js';

export const INV_SIZE = 28;
export const MAX_FRIENDS = 200;
export const BANK_SIZE = 320;
export const SAVE_KEY = 'throatscape.save.v1';

export function createState(name) {
  return {
    name: name || 'Nurse',
    created: Date.now(),
    playtime: 0,

    player: {
      x: SPAWN.x, y: SPAWN.y,
      rx: SPAWN.x, ry: SPAWN.y,          // render position (interpolated)
      px: SPAWN.x, py: SPAWN.y,          // previous tile, for interpolation
      path: [],
      facing: 1,
      hp: 10, maxHp: 10,
      running: true, energy: 100,
      attackAnim: 0,
      combatCd: 0,
      inCombat: 0,
      venom: 0,
      chat: null,
      dead: false
    },

    skills: startingSkills(),
    boosts: {},                          // skillId -> temporary level delta
    inventory: new Array(INV_SIZE).fill(null),
    equipment: {},
    bank: [],
    friends: [],                 // display names; the server resolves them
    quests: {},
    // vigil points track the vigil level, which starts at 1
    vigil: { points: 1, max: 1, active: [] },
    attackStyle: 'accurate',
    autocast: null,

    /* runtime-only, never saved */
    npcs: [],
    others: new Map(),
    ground: [],
    hitsplats: [],
    floaters: [],
    projectiles: [],
    target: null,
    action: null,
    trade: null,                 // the open trade, as the server last described it
    hoverObj: null,
    moveMarker: null,
    snapCam: true,
    tick: 0,
    bus: makeBus(),

    settings: {
      multiplayer: true,
      lowDetail: false,
      flatView: false,
      showTooltips: true,
      music: true,
      sfx: true,
      musicVol: 0.5,
      sfxVol: 0.7
    }
  };
}

/* ---------------- messaging --------------------------------- */

const raf = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : fn => setTimeout(fn, 16);

/**
 * Coalesces high-frequency UI events into one emit per frame. Crafting 500
 * potions should redraw the inventory once, not fifteen hundred times.
 */
export function emitLater(state, evt) {
  if (!state._pendingEmits) state._pendingEmits = new Set();
  if (state._pendingEmits.has(evt)) return;
  state._pendingEmits.add(evt);
  raf(() => {
    state._pendingEmits.delete(evt);
    state.bus.emit(evt);
  });
}

export function log(state, text, cls = 'game') {
  state.bus.emit('chat', { text, cls });
}

export function toast(state, text, cls = '') {
  state.bus.emit('toast', { text, cls });
}

export function floater(state, x, y, text, color) {
  state.floaters.push({ x, y, text, color, ttl: 60 });
}

/* ---------------- skills ------------------------------------ */

export const skillXp = (state, id) => state.skills[id]?.xp ?? 0;
export const baseLevel = (state, id) => levelForXp(skillXp(state, id));

/** Level after temporary boosts and vigil multipliers. */
export function effLevel(state, id) {
  const base = baseLevel(state, id);
  const boost = state.boosts[id] || 0;
  return Math.max(1, base + boost);
}

export function levelMap(state) {
  const out = {};
  for (const id of SKILL_IDS) out[id] = baseLevel(state, id);
  return out;
}

export function addXp(state, id, amount) {
  if (!state.skills[id] || amount <= 0) return;
  const before = baseLevel(state, id);
  state.skills[id].xp = Math.min(MAX_XP, state.skills[id].xp + amount);
  const after = baseLevel(state, id);

  state.bus.emit('xp', { skill: id, amount });

  if (after > before) {
    if (id === 'vitality') {
      state.player.maxHp = after;
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + (after - before));
    }
    if (id === 'vigil') state.vigil.max = after;
    state.bus.emit('levelup', { skill: id, level: after, gained: after - before });
  }
}

export const totalLevel = state =>
  SKILL_IDS.reduce((a, id) => a + baseLevel(state, id), 0);

export const totalXp = state =>
  SKILL_IDS.reduce((a, id) => a + skillXp(state, id), 0);

export const combatLvl = state => combatLevel(levelMap(state));

/* ---------------- inventory --------------------------------- */

export const invCount = (state, id) =>
  state.inventory.reduce((a, s) => a + (s && s.id === id ? s.n : 0), 0);

export const hasItem = (state, id, n = 1) => invCount(state, id) >= n;

export const freeSlots = state =>
  state.inventory.reduce((a, s) => a + (s ? 0 : 1), 0);

/**
 * Adds items, stacking where the item allows it.
 * Returns the number actually added.
 */
export function addItem(state, id, n = 1) {
  const def = ITEMS[id];
  if (!def || n <= 0) return 0;
  let left = n;

  if (def.stack) {
    const slot = state.inventory.find(s => s && s.id === id);
    if (slot) { slot.n += left; emitLater(state, 'inv'); return n; }
    const idx = state.inventory.indexOf(null);
    if (idx < 0) return 0;
    state.inventory[idx] = { id, n: left };
    emitLater(state, 'inv');
    return n;
  }

  while (left > 0) {
    const idx = state.inventory.indexOf(null);
    if (idx < 0) break;
    state.inventory[idx] = { id, n: 1 };
    left--;
  }
  emitLater(state, 'inv');
  return n - left;
}

/** Removes up to n. Returns how many were actually taken. */
export function removeItem(state, id, n = 1) {
  let left = n;
  for (let i = 0; i < state.inventory.length && left > 0; i++) {
    const s = state.inventory[i];
    if (!s || s.id !== id) continue;
    const take = Math.min(s.n, left);
    s.n -= take;
    left -= take;
    if (s.n <= 0) state.inventory[i] = null;
  }
  emitLater(state, 'inv');
  return n - left;
}

export function removeSlot(state, idx, n = Infinity) {
  const s = state.inventory[idx];
  if (!s) return 0;
  const take = Math.min(s.n, n);
  s.n -= take;
  if (s.n <= 0) state.inventory[idx] = null;
  emitLater(state, 'inv');
  return take;
}

export function swapSlots(state, a, b) {
  const t = state.inventory[a];
  state.inventory[a] = state.inventory[b];
  state.inventory[b] = t;
  emitLater(state, 'inv');
}

/**
 * True if the right tool for a job is on you — carried or worn. Some of them
 * are weapons you would be holding anyway, which is why the equipment counts.
 */
export function hasTool(state, tool) {
  if (!tool) return true;
  for (const s of state.inventory) {
    if (s && ITEMS[s.id]?.tool === tool) return true;
  }
  for (const k in state.equipment) {
    if (ITEMS[state.equipment[k]]?.tool === tool) return true;
  }
  return false;
}

/** True if there is room for n of this item. */
export function canHold(state, id, n = 1) {
  const def = ITEMS[id];
  if (!def) return false;
  if (def.stack) return freeSlots(state) > 0 || state.inventory.some(s => s && s.id === id);
  return freeSlots(state) >= n;
}

/**
 * True if a whole parcel would fit at once — the question a trade has to ask
 * before it moves anything, since handing over half of an agreed offer would
 * be worse than refusing it.
 */
export function canHoldAll(state, entries) {
  let free = freeSlots(state);
  const held = new Set(state.inventory.filter(Boolean).map(s => s.id));
  for (const e of entries || []) {
    const def = ITEMS[e.id];
    if (!def) return false;
    if (def.stack) {
      if (held.has(e.id)) continue;
      if (free < 1) return false;
      free--;
      held.add(e.id);
    } else {
      if (free < e.n) return false;
      free -= e.n;
    }
  }
  return true;
}

/* ---------------- equipment --------------------------------- */

export function equipBonuses(state) {
  const b = { aStab: 0, aSlash: 0, aCrush: 0, aRange: 0, aMagic: 0,
              dStab: 0, dSlash: 0, dCrush: 0, dRange: 0, dMagic: 0,
              str: 0, rStr: 0, mDmg: 0, vigil: 0 };
  for (const slot of EQUIP_SLOTS) {
    const id = state.equipment[slot];
    if (!id) continue;
    const def = ITEMS[id];
    if (!def) continue;
    for (const k in def.b) b[k] = (b[k] || 0) + def.b[k];
  }
  return b;
}

/** Checks a `req: { skill: level }` block against current base levels. */
export function meetsReq(state, req) {
  if (!req) return { ok: true };
  for (const k in req) {
    if (baseLevel(state, k) < req[k]) {
      return { ok: false, skill: k, level: req[k] };
    }
  }
  return { ok: true };
}

export function equipFromSlot(state, idx) {
  const s = state.inventory[idx];
  if (!s) return false;
  const def = ITEMS[s.id];
  if (!def || !def.slot) { log(state, "I can't wear that.", 'bad'); return false; }

  const req = meetsReq(state, def.req);
  if (!req.ok) {
    const sk = SKILLS.find(x => x.id === req.skill);
    log(state, `I need ${sk ? sk.name : req.skill} level ${req.level} to wear that.`, 'bad');
    return false;
  }

  const slot = def.slot;

  /* Ammunition equips as a whole stack, tracked by equipment.ammoN. */
  if (slot === 'ammo') {
    const qty = s.n;
    const prevAmmo = state.equipment.ammo;
    if (prevAmmo && prevAmmo !== def.id) {
      const n = state.equipment.ammoN || 1;
      delete state.equipment.ammo; delete state.equipment.ammoN;
      removeSlot(state, idx, qty);
      addItem(state, prevAmmo, n);
      state.equipment.ammo = def.id;
      state.equipment.ammoN = qty;
    } else {
      removeSlot(state, idx, qty);
      state.equipment.ammo = def.id;
      state.equipment.ammoN = (prevAmmo === def.id ? (state.equipment.ammoN || 0) : 0) + qty;
    }
    emitLater(state, 'equip');
    emitLater(state, 'inv');
    return true;
  }

  const prev = state.equipment[slot];
  // two-handed-ish rule: bows and staves keep the off-hand free
  const twoHand = slot === 'weapon' && ['bow', 'blowpipe', 'staff', 'spear'].includes(def.art?.k);

  removeSlot(state, idx, 1);
  if (prev) addItem(state, prev, 1);
  if (twoHand && state.equipment.shield) {
    const sh = state.equipment.shield;
    delete state.equipment.shield;
    addItem(state, sh, 1);
  }
  if (slot === 'shield' && state.equipment.weapon) {
    const w = ITEMS[state.equipment.weapon];
    if (w && ['bow', 'blowpipe', 'staff', 'spear'].includes(w.art?.k)) {
      addItem(state, state.equipment.weapon, 1);
      delete state.equipment.weapon;
    }
  }
  state.equipment[slot] = def.id;
  emitLater(state, 'equip');
  emitLater(state, 'inv');
  return true;
}

export function unequip(state, slot) {
  const id = state.equipment[slot];
  if (!id) return false;
  if (freeSlots(state) < 1 && !(ITEMS[id].stack && invCount(state, id) > 0)) {
    log(state, 'My hands are full.', 'bad');
    return false;
  }
  const n = slot === 'ammo' ? (state.equipment.ammoN || 1) : 1;
  delete state.equipment[slot];
  if (slot === 'ammo') delete state.equipment.ammoN;
  addItem(state, id, n);
  emitLater(state, 'equip');
  return true;
}

/* ---------------- bank -------------------------------------- */

export function bankDeposit(state, invIdx, n = 1) {
  const s = state.inventory[invIdx];
  if (!s) return;
  const amount = Math.min(s.n, n);
  const found = state.bank.find(b => b.id === s.id);
  if (found) found.n += amount;
  else {
    if (state.bank.length >= BANK_SIZE) { log(state, 'My bank is full.', 'bad'); return; }
    state.bank.push({ id: s.id, n: amount });
  }
  removeSlot(state, invIdx, amount);
  emitLater(state, 'bank');
}

export function bankDepositAll(state, id) {
  const total = invCount(state, id);
  if (!total) return;
  const found = state.bank.find(b => b.id === id);
  if (found) found.n += total;
  else {
    if (state.bank.length >= BANK_SIZE) { log(state, 'My bank is full.', 'bad'); return; }
    state.bank.push({ id, n: total });
  }
  removeItem(state, id, total);
  emitLater(state, 'bank');
}

export function bankWithdraw(state, bankIdx, n = 1) {
  const b = state.bank[bankIdx];
  if (!b) return;
  const def = ITEMS[b.id];
  let amount = Math.min(b.n, n);
  if (!def.stack) amount = Math.min(amount, freeSlots(state));
  if (amount <= 0) { log(state, 'My inventory is full.', 'bad'); return; }
  const added = addItem(state, b.id, amount);
  b.n -= added;
  if (b.n <= 0) state.bank.splice(bankIdx, 1);
  emitLater(state, 'bank');
}

/* ---------------- quests ------------------------------------ */

export function questProgress(state, id) {
  if (!state.quests[id]) state.quests[id] = { stage: 0, n: 0 };
  return state.quests[id];
}

export const questStage = (state, id) => questProgress(state, id).stage;
export const questDone = (state, id) => questStage(state, id) >= DONE;

export const questPoints = state =>
  QUESTS.reduce((a, q) => a + (questDone(state, q.id) ? q.qp : 0), 0);

export function canStartQuest(state, id) {
  const q = QUEST_BY_ID[id];
  if (!q || questStage(state, id) !== 0) return false;
  if (q.reqs.quests && !q.reqs.quests.every(r => questDone(state, r))) return false;
  if (q.reqs.skills) {
    for (const k in q.reqs.skills) if (baseLevel(state, k) < q.reqs.skills[k]) return false;
  }
  return true;
}

/* ---------------- save / load ------------------------------- */

export function serialize(state) {
  return {
    v: 1,
    name: state.name,
    created: state.created,
    playtime: state.playtime,
    pos: { x: state.player.x, y: state.player.y },
    hp: state.player.hp,
    energy: state.player.energy,
    running: state.player.running,
    skills: Object.fromEntries(SKILL_IDS.map(id => [id, Math.round(state.skills[id].xp)])),
    inventory: state.inventory.map(s => s ? [s.id, s.n] : null),
    equipment: { ...state.equipment },
    bank: state.bank.map(b => [b.id, b.n]),
    friends: state.friends,
    quests: state.quests,
    vigilPoints: state.vigil.points,
    attackStyle: state.attackStyle,
    autocast: state.autocast,
    settings: state.settings
  };
}

export function deserialize(data) {
  const s = createState(data.name);
  s.created = data.created || Date.now();
  s.playtime = data.playtime || 0;

  for (const id of SKILL_IDS) {
    const xp = data.skills?.[id];
    if (typeof xp === 'number') s.skills[id].xp = clamp(xp, 0, MAX_XP);
  }

  s.player.x = s.player.rx = s.player.px = data.pos?.x ?? SPAWN.x;
  s.player.y = s.player.ry = s.player.py = data.pos?.y ?? SPAWN.y;
  s.player.maxHp = baseLevel(s, 'vitality');
  s.player.hp = clamp(data.hp ?? s.player.maxHp, 1, s.player.maxHp);
  s.player.energy = data.energy ?? 100;
  s.player.running = data.running !== false;

  if (Array.isArray(data.inventory)) {
    s.inventory = data.inventory
      .slice(0, INV_SIZE)
      .map(e => e && ITEMS[e[0]] ? { id: e[0], n: e[1] } : null);
    while (s.inventory.length < INV_SIZE) s.inventory.push(null);
  }
  for (const k in (data.equipment || {})) {
    if (ITEMS[data.equipment[k]]) s.equipment[k] = data.equipment[k];
  }
  s.bank = (data.bank || [])
    .filter(e => ITEMS[e[0]])
    .map(e => ({ id: e[0], n: e[1] }));
  s.friends = (Array.isArray(data.friends) ? data.friends : [])
    .filter(n => typeof n === 'string').slice(0, MAX_FRIENDS);
  s.quests = data.quests || {};
  s.vigil.max = baseLevel(s, 'vigil');
  s.vigil.points = clamp(data.vigilPoints ?? s.vigil.max, 0, s.vigil.max);
  s.attackStyle = data.attackStyle || 'accurate';
  s.autocast = data.autocast || null;
  Object.assign(s.settings, data.settings || {});
  return s;
}

export function save(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(state)));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

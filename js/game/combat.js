/* ============================================================
   Combat - NPC lifecycle, AI, and hit resolution
   ============================================================ */

import { NPCS } from '../data/npcs.js';
import { ITEMS } from '../data/items.js';
import { SPELL_BY_ID } from '../data/magic.js';
import { RESPAWN } from '../data/world.js';
import { cheb, findPath, randInt, chance, weightedPick, clamp } from '../util.js';
import { addXp, effLevel, equipBonuses, log, toast, floater,
         removeItem, invCount, addItem, canHold } from './state.js';

/* ---------------- attack styles ----------------------------- */

export const STYLES = {
  accurate:   { name: 'Accurate',   bonus: { lancing: 3 },   xp: ['lancing'],  icon: '🎯' },
  aggressive: { name: 'Aggressive', bonus: { vigour: 3 },    xp: ['vigour'],   icon: '💢' },
  defensive:  { name: 'Defensive',  bonus: { warding: 3 },   xp: ['warding'],  icon: '🛡️' },
  controlled: { name: 'Controlled', bonus: { lancing: 1, vigour: 1, warding: 1 },
                xp: ['lancing', 'vigour', 'warding'], icon: '⚖️' }
};

/* ---------------- spawning ---------------------------------- */

export function spawnNpcs(state, world) {
  state.npcs = [];
  let uid = 0;
  for (const sp of world.npcSpawns) {
    const d = NPCS[sp.npc];
    if (!d) continue;
    state.npcs.push(makeNpc(d, sp.x, sp.y, uid++));
  }
}

function makeNpc(d, x, y, uid) {
  const hp = d.stats?.hp ?? 5;
  return {
    id: d.id, uid, x, y, rx: x, ry: y, px: x, py: y,
    spawnX: x, spawnY: y,
    hp, maxHp: hp,
    dead: false, respawnIn: 0,
    path: [], cd: 0, wanderCd: randInt(3, 12),
    target: null, hurtFlash: 0, venom: 0, aggroCd: 0
  };
}

export function npcAt(state, x, y) {
  for (const n of state.npcs) {
    if (n.dead) continue;
    const d = NPCS[n.id];
    const sz = d.size || 1;
    if (x >= n.x && x < n.x + sz && y >= n.y && y < n.y + sz) return n;
  }
  return null;
}

/** Blocked by living NPCs, so entities do not stack. */
export const npcBlocks = (state, x, y) => !!npcAt(state, x, y);

/**
 * Blocked by anything that occupies a tile. On the server `state.occupied`
 * additionally reports other players; in the browser it is absent, because
 * the client does not decide who may stand where.
 */
export const tileBlocked = (state, x, y) =>
  npcBlocks(state, x, y) || (state.occupied ? state.occupied(x, y) : false);

/* ---------------- rolls ------------------------------------- */

const roll = max => Math.floor(Math.random() * (max + 1));

/** Standard accuracy: attacker roll vs defender roll. */
export function hitChance(attRoll, defRoll) {
  return attRoll > defRoll
    ? 1 - (defRoll + 2) / (2 * (attRoll + 1))
    : attRoll / (2 * (defRoll + 1));
}

export function playerCombatProfile(state) {
  const b = equipBonuses(state);
  const wid = state.equipment.weapon;
  const w = wid ? ITEMS[wid] : null;
  const wstyle = w?.wstyle || 'melee';
  const style = STYLES[state.attackStyle] || STYLES.accurate;

  const bonusFor = sk => (style.bonus[sk] || 0);
  const vig = vigilMultiplier(state);

  const lvl = sk => Math.floor(effLevel(state, sk) * (vig[sk] || 1)) + bonusFor(sk) + 8;

  let attRoll, maxHit, skillUsed;
  if (wstyle === 'ranged') {
    const atk = Math.floor(effLevel(state, 'injection') * (vig.injection || 1)) + bonusFor('lancing') + 8;
    const ammoId = state.equipment.ammo;
    const ammoStr = ammoId ? (ITEMS[ammoId]?.b?.rStr || 0) : 0;
    attRoll = atk * (b.aRange + 64);
    maxHit = Math.floor(0.5 + atk * (b.rStr + ammoStr + 64) / 640);
    skillUsed = 'injection';
  } else if (wstyle === 'magic') {
    const atk = Math.floor(effLevel(state, 'anatomancy') * (vig.anatomancy || 1)) + 8;
    attRoll = atk * (b.aMagic + 64);
    maxHit = 0;                                    // set per spell
    skillUsed = 'anatomancy';
  } else {
    const atkBonus = Math.max(b.aStab, b.aSlash, b.aCrush);
    attRoll = lvl('lancing') * (atkBonus + 64);
    maxHit = Math.floor(0.5 + lvl('vigour') * (b.str + 64) / 640);
    skillUsed = 'melee';
  }

  const defBonus = Math.round((b.dStab + b.dSlash + b.dCrush) / 3);
  const defRoll = lvl('warding') * (defBonus + 64);
  const speed = w?.speed ?? 4;

  return { attRoll, maxHit, defRoll, speed, wstyle, skillUsed, style, bonuses: b };
}

/** Vigil boosts as a multiplier per skill. */
export function vigilMultiplier(state) {
  const out = {};
  if (!state.vigil.active.length || state.vigil.points <= 0) return out;
  const { VIGIL_BY_ID } = vigilData;
  for (const id of state.vigil.active) {
    const v = VIGIL_BY_ID[id];
    if (!v) continue;
    for (const k in v.boost) out[k] = (out[k] || 1) + v.boost[k];
  }
  return out;
}

// Late-bound to dodge a circular import at module load.
const vigilData = {};
export function bindVigilData(mod) { vigilData.VIGIL_BY_ID = mod.VIGIL_BY_ID; }

export function npcProfile(n) {
  const d = NPCS[n.id];
  const s = d.stats, b = d.bon;
  return {
    attRoll: (s.att + 9) * (b.atk + 64),
    defRoll: (s.def + 9) * (b.def + 64),
    maxHit: Math.floor(0.5 + (s.str + 9) * (b.str + 64) / 640),
    speed: d.speed || 4
  };
}

/* ---------------- standing next to things ------------------- */

const CARDINALS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Melee reaches along the cardinals only, as in the games this copies -
 * you cannot hit a thing that is on your corner, and it cannot hit you.
 */
export const meleeAdjacent = (ax, ay, bx, by) =>
  Math.abs(ax - bx) + Math.abs(ay - by) === 1;

/**
 * A path to a tile beside (tx, ty), preferring a cardinal one. findPath is
 * best-effort - it returns the closest tile it reached when the goal is
 * unreachable - so each candidate is checked for actually having arrived.
 *
 * Falls back to any adjacent tile when no cardinal one can be reached, since
 * a crate wedged in a corner is better reached diagonally than not at all.
 */
export function pathAdjacentFrom(sx, sy, tx, ty, free, maxNodes) {
  for (const [dx, dy] of CARDINALS) {
    if (sx === tx + dx && sy === ty + dy) return [];
  }

  let best = null;
  for (const [dx, dy] of CARDINALS) {
    const x = tx + dx, y = ty + dy;
    if (!free(x, y)) continue;
    const path = findPath(sx, sy, x, y, free, maxNodes);
    const end = path[path.length - 1];
    if (!end || end.x !== x || end.y !== y) continue;
    if (!best || path.length < best.length) best = path;
  }
  if (best) return best;

  const path = findPath(sx, sy, tx, ty, free, maxNodes);
  const end = path[path.length - 1];
  if (end && end.x === tx && end.y === ty) path.pop();
  return path;
}

/** pathAdjacentFrom, starting from the player and using the world's rules. */
export function pathAdjacent(state, world, tx, ty, maxNodes) {
  return pathAdjacentFrom(state.player.x, state.player.y, tx, ty,
    (x, y) => world.isWalkable(x, y) && !tileBlocked(state, x, y), maxNodes);
}

/* ---------------- player attacking -------------------------- */

export function playerAttackTick(state, world) {
  const t = state.target;
  const p = state.player;
  if (!t || t.kind !== 'npc') return;
  const n = t.ref;
  const d = NPCS[n.id];
  if (n.dead) { state.target = null; state.action = null; return; }

  const prof = playerCombatProfile(state);
  const melee = prof.wstyle === 'melee';
  const range = prof.wstyle === 'ranged' ? 7 : 6;
  const reach = melee
    ? meleeAdjacent(p.x, p.y, n.x, n.y)
    : cheb(p.x, p.y, n.x, n.y) <= range;

  if (!reach) {
    // walk into range: melee wants a cardinal square, the rest just want closer
    if (!p.path.length) {
      if (melee) {
        p.path = pathAdjacent(state, world, n.x, n.y);
      } else {
        const path = findPath(p.x, p.y, n.x, n.y,
          (x, y) => world.isWalkable(x, y) && !tileBlocked(state, x, y));
        if (path.length) { path.pop(); p.path = path; }
      }
    }
    return;
  }
  p.path = [];
  p.facing = n.x >= p.x ? 1 : -1;

  if (p.combatCd > 0) return;
  p.combatCd = prof.speed;
  p.attackAnim = 4;
  p.inCombat = 12;
  n.target = state.key || 'player';
  n.aggroCd = 20;

  if (prof.wstyle === 'magic' && state.autocast) {
    castCombatSpell(state, n, state.autocast);
    return;
  }

  if (prof.wstyle === 'ranged') {
    const ammoId = state.equipment.ammo;
    if (!ammoId || invCountEquip(state) <= 0) {
      log(state, 'I have no ammunition equipped.', 'bad');
      state.target = null;
      return;
    }
    state.projectiles.push({
      x: p.x, y: p.y, tx: n.x, ty: n.y, ttl: 6, life: 6,
      angle: Math.atan2(n.y - p.y, n.x - p.x),
      color: ITEMS[ammoId]?.art?.c || '#c6ced6'
    });
    consumeAmmo(state);
  }

  const npd = npcProfile(n);
  const acc = hitChance(prof.attRoll, npd.defRoll);
  const dmg = Math.random() < acc ? roll(prof.maxHit) : 0;
  dealDamageToNpc(state, n, dmg, prof.skillUsed === 'melee' ? null : prof.skillUsed);
}

function invCountEquip(state) {
  // Ammo lives in the equipment slot; the stack size is tracked on the slot itself.
  return state.equipment.ammoN ?? 1;
}

function consumeAmmo(state) {
  const id = state.equipment.ammo;
  if (!id) return;
  state.equipment.ammoN = (state.equipment.ammoN ?? 1) - 1;
  if (state.equipment.ammoN <= 0) {
    delete state.equipment.ammo;
    delete state.equipment.ammoN;
    state.bus.emit('equip');
    log(state, 'That was my last dart.', 'bad');
  } else {
    state.bus.emit('equip');
  }
}

export function castCombatSpell(state, n, spellId) {
  const sp = SPELL_BY_ID[spellId];
  if (!sp || sp.kind !== 'attack' && sp.kind !== 'drain') return false;
  if (effLevel(state, 'anatomancy') < sp.level) {
    log(state, `I need Anatomancy ${sp.level} for that.`, 'bad'); return false;
  }
  for (const r in sp.runes) {
    if (invCount(state, r) < sp.runes[r]) {
      log(state, `I don't have enough ${ITEMS[r].name.toLowerCase()}s.`, 'bad');
      state.autocast = null;
      return false;
    }
  }
  for (const r in sp.runes) removeItem(state, r, sp.runes[r]);

  const prof = playerCombatProfile(state);
  const npd = npcProfile(n);
  const b = equipBonuses(state);
  const attRoll = (effLevel(state, 'anatomancy') + 9) * (b.aMagic + 64);
  const acc = hitChance(attRoll, npd.defRoll);
  const maxHit = Math.floor(sp.max * (1 + b.mDmg / 100));
  const dmg = Math.random() < acc ? roll(maxHit) : 0;

  state.projectiles.push({
    x: state.player.x, y: state.player.y, tx: n.x, ty: n.y, ttl: 6, life: 6,
    angle: Math.atan2(n.y - state.player.y, n.x - state.player.x),
    color: sp.id === 'bile_lance' ? '#c9c14a' : sp.id === 'vital_rend' ? '#c0303f' : '#d4586b'
  });

  addXp(state, 'anatomancy', sp.xp + dmg * 2);
  dealDamageToNpc(state, n, dmg, 'anatomancy', true);

  if (sp.kind === 'drain' && dmg > 0) {
    const p = state.player;
    const heal = Math.ceil(dmg / 2);
    p.hp = Math.min(p.maxHp, p.hp + heal);
    floater(state, p.x, p.y, '+' + heal, '#6fd1a5');
  }
  return true;
}

export function dealDamageToNpc(state, n, dmg, skillOverride, noXpBase) {
  const d = NPCS[n.id];
  n.hp = Math.max(0, n.hp - dmg);
  n.hurtFlash = 3;
  // whoever swung becomes the problem: state.key names them on a shared world
  n.target = state.key || 'player';
  state.hitsplats.push({ x: n.x, y: n.y, dmg, ttl: 30, off: randInt(-6, 6) });

  if (!noXpBase && dmg > 0) {
    const style = STYLES[state.attackStyle] || STYLES.accurate;
    if (skillOverride) {
      addXp(state, skillOverride, dmg * 4);
    } else {
      const each = (dmg * 4) / style.xp.length;
      for (const s of style.xp) addXp(state, s, each);
    }
    addXp(state, 'vitality', dmg * 1.33);
  }

  if (n.hp <= 0) killNpc(state, n);
}

function killNpc(state, n) {
  const d = NPCS[n.id];
  n.dead = true;
  n.respawnIn = d.respawn || 25;
  n.path = [];
  n.target = null;
  if (state.target?.ref === n) { state.target = null; state.action = null; }

  log(state, `You defeat the ${d.name.toLowerCase()}.`, 'good');
  state.bus.emit('kill', { npcId: n.id, x: n.x, y: n.y });

  dropLoot(state, n, d);
}

function dropLoot(state, n, d) {
  if (!d.drops) return;
  const always = d.drops.filter(e => e.weight >= 100);
  const table = d.drops.filter(e => e.weight < 100);

  const drops = [];
  for (const e of always) drops.push(e);
  if (table.length) {
    const e = weightedPick(table);
    if (e.id) drops.push(e);
  }

  for (const e of drops) {
    if (!e.id || !ITEMS[e.id]) continue;
    const qty = e.n ? randInt(e.n[0], e.n[1]) : 1;
    state.ground.push({ id: e.id, n: qty, x: n.x, y: n.y, ttl: 900, mine: true });
  }
}

/* ---------------- NPC AI ------------------------------------ */

export function tickNpcs(state, world) {
  const p = state.player;

  for (const n of state.npcs) {
    const d = NPCS[n.id];

    if (n.dead) {
      if (--n.respawnIn <= 0) {
        n.dead = false;
        n.hp = n.maxHp;
        n.x = n.px = n.rx = n.spawnX;
        n.y = n.py = n.ry = n.spawnY;
        n.venom = 0;
      }
      continue;
    }

    if (n.hurtFlash > 0) n.hurtFlash--;
    if (n.cd > 0) n.cd--;
    if (n.aggroCd > 0) n.aggroCd--;

    if (n.venom > 0 && state.tick % 5 === 0) {
      n.venom--;
      dealDamageToNpc(state, n, 2, null, true);
      if (n.dead) continue;
    }

    if (!d.hostile) {
      wander(state, world, n, d);
      continue;
    }

    /* aggression */
    const dd = cheb(n.x, n.y, p.x, p.y);
    if (!n.target && !p.dead && d.aggroRange > 0 && dd <= d.aggroRange) {
      const reg = world.regionAt(n.x, n.y);
      if (!reg?.safe) n.target = 'player';
    }
    if (n.target === 'player' && (p.dead || dd > 12)) { n.target = null; n.path = []; }

    if (n.target === 'player') {
      const range = d.magic ? 5 : d.attackRange || 1;
      if (dd > range) {
        if (!n.path.length || state.tick % 3 === 0) {
          const path = findPath(n.x, n.y, p.x, p.y,
            (x, y) => world.isWalkable(x, y) && !(x === p.x && y === p.y) &&
                      !(npcAt(state, x, y) && npcAt(state, x, y) !== n),
            600);
          n.path = path.slice(0, 6);
        }
        stepNpc(state, world, n);
      } else {
        n.path = [];
        if (n.cd <= 0) {
          n.cd = d.speed || 4;
          npcAttacksPlayer(state, n, d);
        }
      }
    } else {
      wander(state, world, n, d);
    }
  }
}

function wander(state, world, n, d) {
  if (!d.wander) return;
  if (n.path.length) { stepNpc(state, world, n); return; }
  if (--n.wanderCd > 0) return;
  n.wanderCd = randInt(6, 20);
  const tx = n.spawnX + randInt(-d.wander, d.wander);
  const ty = n.spawnY + randInt(-d.wander, d.wander);
  if (!world.isWalkable(tx, ty) || npcBlocks(state, tx, ty)) return;
  const path = findPath(n.x, n.y, tx, ty,
    (x, y) => world.isWalkable(x, y) && !npcBlocks(state, x, y), 300);
  n.path = path.slice(0, 4);
}

function stepNpc(state, world, n) {
  const next = n.path.shift();
  if (!next) return;
  if (!world.isWalkable(next.x, next.y) || npcAt(state, next.x, next.y)) { n.path = []; return; }
  n.px = n.x; n.py = n.y;
  n.x = next.x; n.y = next.y;
}

function npcAttacksPlayer(state, n, d) {
  const p = state.player;
  if (p.dead) return;
  const prof = playerCombatProfile(state);
  const npd = npcProfile(n);
  const acc = hitChance(npd.attRoll, prof.defRoll);
  const dmg = Math.random() < acc ? roll(npd.maxHit) : 0;

  p.inCombat = 12;
  state.hitsplats.push({ x: p.x, y: p.y, dmg, ttl: 30, self: true, off: randInt(-6, 6) });
  p.hp = Math.max(0, p.hp - dmg);

  if (d.venomous && dmg > 0 && chance(0.22) && p.venom <= 0) {
    p.venom = 10;
    log(state, 'You have been venomed!', 'bad');
  }

  if (p.hp <= 0) playerDeath(state);
}

/* ---------------- player death ------------------------------ */

export function playerDeath(state) {
  const p = state.player;
  if (p.dead) return;
  p.dead = true;
  p.path = [];
  p.venom = 0;
  state.target = null;
  state.action = null;
  state.vigil.active = [];

  log(state, 'Oh dear, you are dead!', 'bad');
  toast(state, 'You died. You wake in the Mercy House.', 'bad');
  state.bus.emit('death');

  setTimeout(() => {
    p.x = p.px = p.rx = RESPAWN.x;
    p.y = p.py = p.ry = RESPAWN.y;
    p.hp = p.maxHp;
    p.dead = false;
    p.inCombat = 0;
    state.snapCam = true;
    const me = state.key || 'player';
    for (const n of state.npcs) if (n.target === me) { n.target = null; n.path = []; }
    log(state, 'An orderly found you on the Gullet Road and carried you back.', 'system');
  }, 1400);
}

/* ---------------- effects ----------------------------------- */

export function tickPlayerEffects(state) {
  const p = state.player;
  if (p.dead) return;

  if (p.inCombat > 0) p.inCombat--;
  if (p.combatCd > 0) p.combatCd--;
  if (p.attackAnim > 0) p.attackAnim--;

  /* venom */
  if (p.venom > 0 && state.tick % 5 === 0) {
    p.venom--;
    const dmg = 2;
    p.hp = Math.max(0, p.hp - dmg);
    state.hitsplats.push({ x: p.x, y: p.y, dmg, ttl: 30, self: true, off: 0 });
    if (p.venom === 0) log(state, 'The venom wears off.', 'system');
    if (p.hp <= 0) playerDeath(state);
  }

  /* natural regeneration, roughly one hitpoint per minute */
  if (state.tick % 100 === 0 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + 1);
  }

  /* run energy */
  if (p.path.length && p.running) {
    p.energy = Math.max(0, p.energy - 0.8);
    if (p.energy === 0) {
      p.running = false;
      log(state, 'I am too tired to run.', 'system');
    }
  } else if (p.energy < 100) {
    p.energy = Math.min(100, p.energy + 0.45);
  }

  /* vigil drain */
  if (state.vigil.active.length) {
    const { VIGIL_BY_ID } = vigilData;
    let drain = 0;
    for (const id of state.vigil.active) drain += VIGIL_BY_ID?.[id]?.drain || 0;
    const bonus = 1 + equipBonuses(state).vigil / 30;
    state.vigil.points -= (drain / 100) / bonus;
    if (state.vigil.points <= 0) {
      state.vigil.points = 0;
      state.vigil.active = [];
      log(state, 'You have run out of vigil. The candles gutter.', 'bad');
      state.bus.emit('vigil');
    }
  }

  /* stat boosts decay one level at a time */
  if (state.tick % 25 === 0) {
    for (const k in state.boosts) {
      if (state.boosts[k] > 0) state.boosts[k]--;
      else if (state.boosts[k] < 0) state.boosts[k]++;
      if (state.boosts[k] === 0) delete state.boosts[k];
    }
  }
}

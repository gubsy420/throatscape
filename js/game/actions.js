/* ============================================================
   Actions - what happens when the player clicks on the world
   ============================================================ */

import { OBJ, T } from '../data/world.js';
import { ITEMS, item, itemName, toolName } from '../data/items.js';
import { NPCS } from '../data/npcs.js';
import { SKILL_BY_ID } from '../data/skills.js';
import { cheb, findPath, randInt, chance, pick, clamp, weightedPick } from '../util.js';
import {
  addXp, baseLevel, effLevel, addItem, removeItem, removeSlot, invCount, hasItem,
  canHold, freeSlots, log, toast, floater, meetsReq, equipFromSlot, hasTool, markClick
} from './state.js';
import { npcBlocks, tileBlocked, npcAt, pathAdjacent } from './combat.js';
import { makeQuestApi, questHook } from './questapi.js';

/* ---------------- movement ---------------------------------- */

export function walkTo(state, world, tx, ty, adjacentOk = false) {
  const p = state.player;
  if (p.dead) return;
  p.path = adjacentOk
    ? pathAdjacent(state, world, tx, ty)
    : findPath(p.x, p.y, tx, ty,
        (x, y) => world.isWalkable(x, y) && !tileBlocked(state, x, y));
  markClick(state, tx, ty, 'walk');
}

/** Steps the player one tile (or two, when running). */
export function movePlayer(state, world) {
  const p = state.player;
  if (p.dead || !p.path.length) return;

  const steps = p.running && p.energy > 0 ? 2 : 1;
  for (let i = 0; i < steps; i++) {
    const next = p.path[0];
    if (!next) break;
    if (!world.isWalkable(next.x, next.y) || tileBlocked(state, next.x, next.y)) {
      // something moved into the way; recompute once
      const goal = p.path[p.path.length - 1];
      p.path = findPath(p.x, p.y, goal.x, goal.y,
        (x, y) => world.isWalkable(x, y) && !tileBlocked(state, x, y));
      if (!p.path.length) break;
      continue;
    }
    p.path.shift();
    p.px = p.x; p.py = p.y;
    if (next.x !== p.x) p.facing = next.x > p.x ? 1 : -1;
    p.x = next.x; p.y = next.y;

    if (world.tileAt(p.x, p.y) === T.BOG) break;   // bog costs you the second step
  }
}

/* ---------------- action queue ------------------------------ */

/**
 * Queues an interaction. The player walks into range first; the handler
 * runs on the tick they arrive.
 */
export function setAction(state, world, action) {
  state.action = action;
  state.target = null;
  if (action.walkTo) {
    // range 0 means the action happens on the tile itself - picking an item
    // up, for instance - so walk onto it rather than stopping beside it
    const beside = action.range !== 0;
    if (beside && action.arrive === undefined) action.arrive = true;
    walkTo(state, world, action.walkTo.x, action.walkTo.y, beside);
  }
}

export function clearAction(state) {
  state.action = null;
}

export function tickAction(state, world, ui) {
  const p = state.player;
  const a = state.action;
  if (!a || p.dead) return;

  /*
   * `arrive` actions run only once the walk is finished, not the moment the
   * target is nominally in range. Talking has a range of 2 so that an NPC
   * behind a counter still works, but without this you would stop short and
   * hold the conversation from across the room.
   */
  const inRange = a.range === undefined
    ? true
    : cheb(p.x, p.y, a.at.x, a.at.y) <= a.range && !(a.arrive && p.path.length);

  if (!inRange) {
    if (!p.path.length) {
      // could not reach it
      if (a.tries === undefined) a.tries = 0;
      if (++a.tries > 2) { state.action = null; log(state, "I can't reach that."); }
      else walkTo(state, world, a.at.x, a.at.y, a.range !== 0);
    }
    return;
  }

  if (a.delay && a.delay > 0) { a.delay--; return; }
  p.path.length = 0;

  const done = a.run(state, world, ui, a);
  if (done !== false) state.action = null;
}

/* ---------------- scenery interaction ----------------------- */

export function interactObject(state, world, obj, ui, verbOverride) {
  const d = OBJ[obj.type];
  if (!d) return;
  const p = state.player;
  const g = makeQuestApi(state);

  /* stations just open an interface */
  if (d.station) {
    setAction(state, world, {
      at: { x: obj.x, y: obj.y }, range: 1, walkTo: { x: obj.x, y: obj.y },
      run: () => { runStation(state, world, obj, d, ui, g); }
    });
    return;
  }

  /* gathering nodes */
  if (d.skill) {
    startGathering(state, world, obj, d);
    return;
  }

  log(state, d.examine || 'Nothing interesting happens.');
}

function runStation(state, world, obj, d, ui, g) {
  switch (d.station) {
    case 'bank':
      state.bus.emit('openbank');
      break;
    case 'apothecary': case 'suturing': case 'cooking':
      state.bus.emit('openmake', d.station);
      break;
    case 'forging':
      state.bus.emit('openmake', 'forging');
      break;
    case 'smelting':
      state.bus.emit('openmake', 'smelting');
      break;
    case 'altar':
      prayAtAltar(state, world, obj, g);
      break;
    case 'bed':
      restInBed(state);
      break;
    case 'water':
      fillVials(state);
      break;
    case 'sign':
      log(state, obj.text || 'The paint has flaked away.', 'system');
      toast(state, obj.text || 'Unreadable.');
      break;
    case 'door':
      obj.open = !obj.open;
      obj.held = obj.open;
      log(state, obj.open ? 'You open the door.' : 'You close the door.');
      break;
    case 'gate':
      obj.open = !obj.open;
      obj.held = obj.open;
      log(state, obj.open ? 'You swing the gate open.' : 'You shut the gate.');
      break;
    case 'crate':
      searchContainer(state, obj, g);
      break;
    case 'grave':
      log(state, pick([
        'Here lies a nurse who went back for the second patient.',
        'The name has worn away. The dates have not.',
        '"She finished her shift." — the whole inscription.',
        'Someone has left fresh lint on this one.'
      ]), 'system');
      break;
    default:
      log(state, 'Nothing interesting happens.');
  }
}

function prayAtAltar(state, world, obj, g) {
  const before = state.vigil.points;
  state.vigil.points = state.vigil.max;
  addXp(state, 'vigil', 15);
  state.bus.emit('vigil');
  if (state.vigil.points > before) {
    log(state, 'You keep a moment of watch. Your vigil is restored.', 'good');
    floater(state, state.player.x, state.player.y, 'Vigil restored', '#86b7e0');
  } else {
    log(state, 'You keep a moment of watch.');
  }
  // the region, not the tile: a quest that asks for three places wants to know
  // which place this is, and only the world can say
  questHook(g, 'onPray', obj.x, obj.y,
            world.regionAt(obj.x, obj.y)?.id || `${obj.x},${obj.y}`);
}

function restInBed(state) {
  const p = state.player;
  if (p.inCombat > 0) { log(state, 'Not while something is trying to kill me.', 'bad'); return; }
  if (p.hp >= p.maxHp && p.energy >= 100) { log(state, 'I do not need to rest.'); return; }
  p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.35));
  p.energy = 100;
  log(state, 'You sit a while on the ward bed. Better.', 'good');
  floater(state, p.x, p.y, 'Rested', '#6fd1a5');
}

function fillVials(state) {
  const empties = invCount(state, 'vial');
  if (!empties) { log(state, 'I have no empty vials.'); return; }
  removeItem(state, 'vial', empties);
  addItem(state, 'vial_of_water', empties);
  log(state, `You fill ${empties} vial${empties > 1 ? 's' : ''} with water.`);
}

function searchContainer(state, obj, g) {
  if (questHook(g, 'onSearch', obj.type, obj.x, obj.y)) return;
  if (obj.searched && obj.searched > state.tick) {
    log(state, 'I have already been through this one.');
    return;
  }
  obj.searched = state.tick + 300;
  const table = [
    { weight: 30, id: null },
    { weight: 20, id: 'lint', n: [1, 3] },
    { weight: 14, id: 'coins', n: [5, 60] },
    { weight: 10, id: 'gauze_wrap', n: [1, 1] },
    { weight: 8, id: 'vial', n: [1, 3] },
    { weight: 6, id: 'bones', n: [1, 1] },
    { weight: 5, id: 'gut_thread', n: [1, 4] },
    { weight: 4, id: 'rocksalt', n: [1, 2] },
    { weight: 3, id: 'coughcap', n: [1, 1] }
  ];
  const e = weightedPick(table);
  if (!e.id) { log(state, 'You find nothing of use.'); return; }
  const qty = e.n ? randInt(e.n[0], e.n[1]) : 1;
  if (!canHold(state, e.id, qty)) { log(state, 'My inventory is full.', 'bad'); return; }
  addItem(state, e.id, qty);
  addXp(state, 'salvage', 8);
  log(state, `You find ${qty > 1 ? qty + ' x ' : ''}${itemName(e.id)}.`, 'good');
}

/* ---------------- gathering --------------------------------- */

const HERB_TABLE = [
  ['coughcap', 1], ['sootleaf', 8], ['palate_root', 16], ['fevermoss', 26],
  ['bile_lily', 34], ['numbthistle', 42], ['suture_vine', 50], ['bloodbell', 58]
];

function rollHerb(level) {
  const avail = HERB_TABLE.filter(([, l]) => l <= level);
  // weight toward the lower herbs, exactly like a real drop table
  const table = avail.map(([id, l], i) => ({ id, weight: Math.pow(0.55, i) * 100 }));
  return weightedPick(table).id;
}

export function startGathering(state, world, obj, d) {
  const p = state.player;

  if (obj.depleted > 0) { log(state, 'There is nothing left here just now.'); return; }

  const lvl = baseLevel(state, d.skill);
  if (lvl < d.level) {
    const sk = SKILL_BY_ID[d.skill];
    log(state, `I need ${sk.name} level ${d.level} to do that. Mine is ${lvl}.`, 'bad');
    return;
  }
  if (d.tool && !hasTool(state, d.tool)) {
    log(state, `I need ${toolName(d.tool)} for that.`, 'bad');
    return;
  }

  setAction(state, world, {
    at: { x: obj.x, y: obj.y }, range: 1, walkTo: { x: obj.x, y: obj.y },
    kind: 'gather', obj, def: d, delay: 0,
    run: (st, wd, ui, a) => gatherTick(st, wd, a)
  });
  log(state, `You begin to ${d.act.toLowerCase()} the ${d.name.toLowerCase()}.`);
}

function gatherTick(state, world, a) {
  const { obj, def: d } = a;
  const p = state.player;

  if (obj.depleted > 0) { log(state, 'It is exhausted for now.'); return true; }
  if (freeSlots(state) <= 0) { log(state, 'My inventory is full.', 'bad'); return true; }

  p.facing = obj.x >= p.x ? 1 : -1;
  p.attackAnim = 3;

  const lvl = effLevel(state, d.skill);
  // higher level = faster success, mirroring the classic roll
  const successChance = clamp(0.20 + (lvl - d.level) * 0.022 + toolBonus(state, d.tool), 0.12, 0.88);

  /*
   * One roll every three ticks, not every other tick. Combined with the
   * chance above that is roughly nine seconds a log at the level the node
   * asks for, and under seven with the right tool - close to the games this
   * is imitating, and slow enough that the swing animation is worth watching.
   */
  if (!chance(successChance)) { a.delay = 2; return false; }

  let yieldId = d.yield;
  let xp = d.xp;
  if (d.herbRoll) {
    yieldId = rollHerb(lvl);
    const herbDef = ITEMS[yieldId];
    xp = 12 + (herbDef.herbLevel || 1) * 2.4;
  }

  addItem(state, yieldId, 1);
  addXp(state, d.skill, xp);
  floater(state, p.x, p.y, `+${Math.round(xp)} ${SKILL_BY_ID[d.skill].name}`, '#7fbf8f');
  log(state, `You get ${itemName(yieldId).toLowerCase()}.`);

  if (d.extra && chance(d.extra.chance) && canHold(state, d.extra.id, 1)) {
    addItem(state, d.extra.id, 1);
    log(state, `You also collect ${itemName(d.extra.id).toLowerCase()}.`, 'good');
  }

  if (d.respawn > 0) {
    obj.depleted = d.respawn;
    return true;
  }
  a.delay = 3;
  return false;                                   // pools keep going
}

export function tickResourceRespawn(state, world) {
  for (const o of world.objects) {
    if (o.depleted > 0) o.depleted--;
  }
}

/**
 * Doors swing open for whoever is standing next to them and fall shut again
 * once the corridor is clear. A door the player opened by hand stays open.
 */
export function tickDoors(state, world) {
  if (!world._doors) {
    world._doors = world.objects.filter(o => o.type === 'door' || o.type === 'gate');
  }
  const p = state.player;
  for (const d of world._doors) {
    if (d.held) continue;
    let near = cheb(p.x, p.y, d.x, d.y) <= 1;
    if (!near) {
      for (const o of state.others.values()) {
        if (cheb(Math.round(o.x), Math.round(o.y), d.x, d.y) <= 1) { near = true; break; }
      }
    }
    d.open = near;
  }
}

function toolBonus(state, tool) {
  if (!tool) return 0;
  return hasTool(state, tool) ? 0.08 : 0;
}

/* ---------------- ground items ------------------------------ */

export function pickUp(state, world, gitem) {
  setAction(state, world, {
    at: { x: gitem.x, y: gitem.y }, range: 0, walkTo: { x: gitem.x, y: gitem.y },
    run: () => {
      const i = state.ground.indexOf(gitem);
      if (i < 0) return;
      if (!canHold(state, gitem.id, gitem.n)) { log(state, 'My inventory is full.', 'bad'); return; }
      addItem(state, gitem.id, gitem.n);
      state.ground.splice(i, 1);
      log(state, `You pick up ${gitem.n > 1 ? gitem.n + ' x ' : ''}${itemName(gitem.id)}.`);
    }
  });
}

export function dropItem(state, idx) {
  const s = state.inventory[idx];
  if (!s) return;
  const def = ITEMS[s.id];
  if (def.questItem) { log(state, 'I should hold onto this.', 'bad'); return; }
  const n = s.n;
  removeSlot(state, idx, n);
  state.ground.push({ id: s.id, n, x: state.player.x, y: state.player.y, ttl: 900, mine: true });
  log(state, `You drop ${itemName(s.id).toLowerCase()}.`);
}

export function tickGround(state) {
  for (let i = state.ground.length - 1; i >= 0; i--) {
    if (--state.ground[i].ttl <= 0) state.ground.splice(i, 1);
  }
}

/* ---------------- item use ---------------------------------- */

export function useItem(state, idx) {
  const s = state.inventory[idx];
  if (!s) return;
  const def = ITEMS[s.id];
  const p = state.player;

  /* food and dressings */
  if (def.heal) {
    if (p.hp >= p.maxHp) { log(state, 'I am not injured.'); return; }
    removeSlot(state, idx, 1);
    const healed = Math.min(def.heal, p.maxHp - p.hp);
    p.hp += healed;
    addXp(state, 'triage', def.heal * 1.5);
    floater(state, p.x, p.y, '+' + healed, '#6fd1a5');
    log(state, def.art?.k === 'bandage'
      ? `You bind the wound. It closes a little. (+${healed})`
      : `You eat the ${itemName(s.id).toLowerCase()}. (+${healed})`, 'good');
    return;
  }

  /* potions */
  if (def.potion) {
    const e = def.potion;
    removeSlot(state, idx, 1);
    addItem(state, 'vial', 1);
    if (e.heal) {
      const healed = Math.min(e.heal, p.maxHp - p.hp);
      p.hp += healed;
      floater(state, p.x, p.y, '+' + healed, '#6fd1a5');
      addXp(state, 'triage', e.heal * 2);
    }
    if (e.cure) {
      p.venom = 0;
      log(state, 'The venom stops moving.', 'good');
    }
    if (e.vigil) {
      state.vigil.points = Math.min(state.vigil.max, state.vigil.points + e.vigil);
      state.bus.emit('vigil');
      floater(state, p.x, p.y, '+vigil', '#86b7e0');
    }
    if (e.boost) {
      const list = Array.isArray(e.boost) ? e.boost : [e.boost];
      for (const sk of list) {
        const lvl = baseLevel(state, sk);
        const amt = Math.floor(e.base + lvl * e.pct);
        state.boosts[sk] = Math.max(state.boosts[sk] || 0, amt);
        floater(state, p.x, p.y, `+${amt} ${SKILL_BY_ID[sk].name}`, '#e0b357');
      }
    }
    log(state, `You drink the ${itemName(def.id).toLowerCase()}.`, 'good');
    state.bus.emit('inv');
    return;
  }

  /* burying */
  if (def.buryXp) {
    removeSlot(state, idx, 1);
    addXp(state, 'vigil', def.buryXp);
    floater(state, p.x, p.y, `+${def.buryXp} Vigil`, '#86b7e0');
    log(state, 'You bury the bones and stand a moment.', 'good');
    return;
  }

  if (def.slot) { equipFromSlot(state, idx); return; }

  if (def.teleport && def.charges) {
    log(state, 'Nothing happens. Perhaps it needs to be worn.');
    return;
  }

  log(state, ITEMS[s.id].examine || 'Nothing interesting happens.');
}

/**
 * "Use A on B". Handles item-on-item, item-on-NPC and item-on-object,
 * giving quest scripts the first refusal on each.
 */
export function useItemOn(state, world, srcIdx, target) {
  const s = state.inventory[srcIdx];
  if (!s) return;
  const g = makeQuestApi(state);

  if (target.kind === 'npc') {
    const n = target.ref;
    setAction(state, world, {
      at: { x: n.x, y: n.y }, range: 1, walkTo: { x: n.x, y: n.y },
      run: () => {
        if (questHook(g, 'onUseOnNpc', s.id, n.id)) return;
        const d = NPCS[n.id];
        if (d.patient && ITEMS[s.id].heal) {
          removeSlot(state, srcIdx, 1);
          addXp(state, 'triage', ITEMS[s.id].heal * 3);
          log(state, 'You dress the patient\'s wound. They thank you quietly.', 'good');
          return;
        }
        log(state, `The ${d.name.toLowerCase()} has no use for that.`);
      }
    });
    return;
  }

  if (target.kind === 'obj') {
    const o = target.ref;
    const d = OBJ[o.type];
    setAction(state, world, {
      at: { x: o.x, y: o.y }, range: 1, walkTo: { x: o.x, y: o.y },
      run: () => {
        if (questHook(g, 'onUseOnObject', s.id, o.type, o.x, o.y)) return;
        if (d.station === 'water' && s.id === 'vial') { fillVials(state); return; }
        if (d.station === 'apothecary' || d.station === 'suturing' ||
            d.station === 'cooking' || d.station === 'smelting' || d.station === 'forging') {
          state.bus.emit('openmake', d.station);
          return;
        }
        log(state, `Nothing happens.`);
      }
    });
    return;
  }

  if (target.kind === 'item') {
    const t = state.inventory[target.idx];
    if (!t) return;
    // herb + water is the one combination that works without a station
    const pair = [s.id, t.id];
    if (pair.includes('vial_of_water') && pair.some(id => ITEMS[id]?.herbLevel)) {
      state.bus.emit('openmake', 'apothecary');
      return;
    }
    log(state, 'Nothing interesting happens.');
  }
}

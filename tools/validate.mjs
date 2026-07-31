/* ============================================================
   Pack validator
   ------------------------------------------------------------
   The gate. Nothing reaches the live game without passing this,
   whether a person wrote it or a machine did.

   It answers four questions:
     1. Is the pack well formed and additive only?
     2. Does everything it mentions actually exist?
     3. Is it in keeping with the game's own numbers?
     4. Will it fit into the world without breaking the map?

   Usage:  node tools/validate.mjs content/packs/whatever.json
           node tools/validate.mjs --all
   ============================================================ */

import { readFile } from 'node:fs/promises';
import {
  rel, readJson, loadGame, envelope, artKinds, listPackFiles, baseOnly
} from './lib.mjs';

const TOP_KEYS = new Set([
  'id', 'version', 'date', 'beat', 'title', 'generated', 'author', 'summary',
  'skills', 'items', 'objects', 'npcs', 'recipes', 'shopStock',
  'regions', 'sites', 'spawns', 'scatter', 'quests', 'notes'
]);

const ID_RE = /^[a-z][a-z0-9_]{2,39}$/;

/** Nothing a pack adds may be bigger than this. One day is one delivery. */
const LIMITS = {
  items: 6, npcs: 5, objects: 3, recipes: 4, quests: 2, skills: 1,
  regions: 1, sites: 2, spawns: 6, scatter: 6, shopStock: 4,
  siteArea: 26 * 26, spawnCount: 24, scatterCount: 30, notes: 12
};

/**
 * What each beat is allowed to touch. A day that was supposed to add a
 * creature must not quietly rewrite the map as well; this is what keeps
 * "one delivery" meaning one delivery.
 */
const BEATS = {
  bestiary:  ['npcs', 'items', 'spawns'],
  arsenal:   ['items', 'recipes', 'shopStock', 'npcs'],
  resource:  ['items', 'objects', 'recipes', 'scatter', 'skills', 'shopStock'],
  boss:      ['npcs', 'items', 'sites', 'spawns', 'recipes'],
  quest:     ['quests', 'npcs', 'items', 'sites', 'spawns', 'objects'],
  expansion: ['regions', 'sites', 'npcs', 'items', 'objects', 'spawns', 'scatter', 'recipes']
};

const STATIONS = ['smelting', 'forging', 'apothecary', 'suturing', 'cooking'];
const SLOTS = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield',
               'legs', 'hands', 'feet', 'ring'];
const STEP_KINDS = ['kill', 'fetch', 'search', 'treat'];
const DIFFICULTY = ['Novice', 'Intermediate', 'Experienced', 'Master'];

export async function validate(pack, opts = {}) {
  const problems = [];
  const notes = [];
  const bad = (m) => problems.push(m);
  const note = (m) => notes.push(m);

  /* ---- 1. shape ------------------------------------------- */

  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
    return { ok: false, problems: ['pack is not a JSON object'], notes };
  }
  for (const k of Object.keys(pack)) {
    if (!TOP_KEYS.has(k)) bad(`unknown top-level key "${k}"`);
  }
  if (!ID_RE.test(pack.id || '')) bad(`pack id "${pack.id}" is not a plain lower-case id`);
  if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(pack.version || '')) {
    bad(`pack version "${pack.version}" should look like 2026.08.01`);
  }
  if (!pack.title) bad('pack has no title');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pack.date || '')) bad('pack has no date (YYYY-MM-DD)');
  if (!BEATS[pack.beat]) bad(`pack beat "${pack.beat}" is not one of ${Object.keys(BEATS).join(', ')}`);

  for (const [key, limit] of Object.entries(LIMITS)) {
    if (Array.isArray(pack[key]) && pack[key].length > limit) {
      bad(`${key}: ${pack[key].length} is more than one delivery (limit ${limit})`);
    }
  }

  // a delivery only brings what its kind is for
  const allowed = BEATS[pack.beat];
  if (allowed) {
    for (const key of ['skills', 'items', 'objects', 'npcs', 'recipes', 'shopStock',
                       'regions', 'sites', 'spawns', 'scatter', 'quests']) {
      if ((pack[key] || []).length && !allowed.includes(key)) {
        bad(`a "${pack.beat}" delivery may not add ${key} — that belongs to another day`);
      }
    }
    const core = { bestiary: 'npcs', arsenal: 'items', resource: 'objects',
                   boss: 'npcs', quest: 'quests', expansion: 'regions' }[pack.beat];
    if (!(pack[core] || []).length) {
      bad(`a "${pack.beat}" delivery has to actually add ${core}`);
    }
  }
  if (pack.beat === 'boss' && !(pack.npcs || []).some(n => n.boss)) {
    bad('a "boss" delivery has to include a creature marked boss: true');
  }

  /* ---- 2. does it apply at all? ---------------------------- */

  // the game as it would be without this pack, even if it has already shipped
  const game = await loadGame({ withPacks: true, skip: [pack.id] });
  const before = {
    items: new Set(Object.keys(game.ITEMS)),
    npcs: new Set(Object.keys(game.NPCS)),
    obj: new Set(Object.keys(game.OBJ)),
    quests: new Set(game.QUESTS.map(q => q.id)),
    skills: new Set(game.SKILLS.map(s => s.id))
  };

  // ids must be new and well formed before we try to apply anything
  before.regions = new Set(game.REGIONS.map(r => r.id));
  const declared = [
    ...(pack.regions || []).map(x => ['region', x.id, before.regions]),
    ...(pack.items || []).map(x => ['item', x.id, before.items]),
    ...(pack.npcs || []).map(x => ['creature', x.id, before.npcs]),
    ...(pack.objects || []).map(x => ['scenery', x.id, before.obj]),
    ...(pack.quests || []).map(x => ['quest', x.id, before.quests]),
    ...(pack.skills || []).map(x => ['skill', x.id, before.skills])
  ];
  const seen = new Set();
  for (const [kind, id, existing] of declared) {
    if (!ID_RE.test(id || '')) { bad(`${kind} id "${id}" is not a plain lower-case id`); continue; }
    if (existing.has(id)) bad(`${kind} "${id}" already exists — packs may only add`);
    if (seen.has(id)) bad(`"${id}" is declared twice in this pack`);
    seen.add(id);
  }

  if (problems.length) return { ok: false, problems, notes };

  try {
    game.content.applyPack(pack);
  } catch (e) {
    return { ok: false, problems: [`pack will not apply: ${e.message}`], notes };
  }

  // nothing that existed before may have gone missing or changed identity
  for (const id of before.items) {
    if (!game.ITEMS[id]) bad(`item "${id}" disappeared`);
  }
  for (const id of before.quests) {
    if (!game.QUESTS.some(q => q.id === id)) bad(`quest "${id}" disappeared`);
  }

  /* ---- 3. references --------------------------------------- */

  const art = await artKinds();
  const env = envelope(game);
  const has = {
    item: id => !!game.ITEMS[id],
    npc: id => !!game.NPCS[id],
    obj: id => !!game.OBJ[id],
    skill: id => game.SKILLS.some(s => s.id === id),
    region: id => game.REGIONS.some(r => r.id === id)
  };
  const need = (cond, msg) => { if (!cond) bad(msg); };

  /* -- skills -- */
  for (const s of pack.skills || []) {
    need(s.name && s.blurb, `skill "${s.id}" needs a name and a blurb`);
    need(!s.combat, `skill "${s.id}" may not be a combat skill — the combat formula is fixed`);
    const trains = [
      ...(pack.objects || []).some(o => o.skill === s.id),
      ...(pack.recipes || []).some(r => r.skill === s.id)
    ];
    need(trains.some(Boolean), `skill "${s.id}" has no way to train it in the same pack`);
  }

  /* -- items -- */
  for (const it of pack.items || []) {
    need(it.name, `item "${it.id}" has no name`);
    need(it.examine, `item "${it.id}" has no examine text`);
    need(typeof it.value === 'number' && it.value >= 0, `item "${it.id}" has no value`);
    /*
     * Quest items are untradeable and worthless, so they must not be able to
     * arrive by any other route: only a quest delivery may add one, and only
     * if one of its own quests actually asks for it.
     */
    if (it.questItem) {
      const wanted = (pack.quests || []).some(q =>
        (q.steps || []).some(s => s.item === it.id) ||
        (q.rewards?.items || []).some(([id]) => id === it.id));
      need(pack.beat === 'quest' && wanted,
           `item "${it.id}" is a quest item, but no quest in this pack asks for it`);
    }
    if (it.slot) need(SLOTS.includes(it.slot), `item "${it.id}": unknown slot "${it.slot}"`);
    if (it.art) need(art.item.has(it.art.k), `item "${it.id}": nothing can draw a "${it.art?.k}"`);
    for (const sk of Object.keys(it.req || {})) {
      need(has.skill(sk), `item "${it.id}" requires unknown skill "${sk}"`);
    }
    for (const k of Object.keys(it.b || {})) {
      need([...env.ATT, ...env.DEF, 'str', 'rStr', 'mDmg', 'vigil'].includes(k),
           `item "${it.id}": unknown bonus "${k}"`);
    }
  }

  /* -- scenery -- */
  for (const o of pack.objects || []) {
    need(o.name && o.examine, `scenery "${o.id}" needs a name and examine text`);
    need(art.scenery.has(o.art), `scenery "${o.id}": nothing can draw a "${o.art}"`);
    if (o.skill) {
      need(has.skill(o.skill), `scenery "${o.id}" trains unknown skill "${o.skill}"`);
      need(has.item(o.yield), `scenery "${o.id}" yields unknown item "${o.yield}"`);
      need(o.level >= 1 && o.level <= 99, `scenery "${o.id}": level out of range`);
      need(o.respawn >= 0 && o.respawn <= 400, `scenery "${o.id}": respawn out of range`);
      if (o.tool) {
        need(baseOnly(game.ITEMS).concat(Object.values(game.ITEMS))
               .some(i => i.tool === o.tool),
             `scenery "${o.id}" needs tool "${o.tool}", which no item provides`);
      }
    }
  }

  /* -- creatures -- */
  for (const n of pack.npcs || []) {
    need(n.name && n.examine, `creature "${n.id}" needs a name and examine text`);
    need(art.npc.has(n.art?.k), `creature "${n.id}": nothing can draw a "${n.art?.k}"`);
    if (n.hostile) {
      need(n.lvl >= 1 && n.lvl <= 99, `creature "${n.id}": combat level out of range`);
      need(n.stats && n.bon, `creature "${n.id}" needs stats and bonuses`);
      need(!n.boss || pack.npcs.length === 1, `creature "${n.id}": one boss at a time, please`);
      need((n.size || 1) <= 2, `creature "${n.id}": too large`);
      need((n.respawn ?? 25) >= 10, `creature "${n.id}": respawns too fast`);
      need((n.aggroRange ?? 0) <= 9, `creature "${n.id}": aggression range too wide`);
      for (const d of n.drops || []) {
        if (d.id !== null && d.id !== undefined) {
          need(has.item(d.id), `creature "${n.id}" drops unknown item "${d.id}"`);
        }
        need(d.weight > 0 && d.weight <= 100, `creature "${n.id}": bad drop weight`);
        if (d.n) need(d.n[1] >= d.n[0] && d.n[1] <= 20000, `creature "${n.id}": bad drop quantity`);
      }
    } else {
      need(!n.shop || game.SHOPS[n.shop], `creature "${n.id}" runs unknown shop "${n.shop}"`);
    }
  }

  /* -- recipes -- */
  for (const r of pack.recipes || []) {
    need(STATIONS.includes(r.station), `recipe: unknown station "${r.station}"`);
    need(has.item(r.out), `recipe makes unknown item "${r.out}"`);
    need(has.skill(r.skill), `recipe trains unknown skill "${r.skill}"`);
    need(r.level >= 1 && r.level <= 99, `recipe for "${r.out}": level out of range`);
    need(Object.keys(r.need || {}).length > 0, `recipe for "${r.out}" needs ingredients`);
    for (const id of Object.keys(r.need || {})) {
      need(has.item(id), `recipe for "${r.out}" needs unknown item "${id}"`);
    }
  }

  /* -- shop stock -- */
  for (const s of pack.shopStock || []) {
    need(game.SHOPS[s.shop], `shop stock: unknown shop "${s.shop}"`);
    need(has.item(s.item), `shop stock: unknown item "${s.item}"`);
  }

  /* -- quests -- */
  const quest = { givers: [] };
  for (const q of pack.quests || []) {
    need(q.name && q.desc, `quest "${q.id}" needs a name and a description`);
    need(DIFFICULTY.includes(q.difficulty || 'Novice'), `quest "${q.id}": odd difficulty`);
    need(q.qp >= 1 && q.qp <= 5, `quest "${q.id}": quest points out of range`);
    need((q.steps || []).length >= 1 && q.steps.length <= 4,
         `quest "${q.id}": between one and four steps, please`);
    for (const s of q.steps || []) {
      need(STEP_KINDS.includes(s.kind), `quest "${q.id}": unknown step "${s.kind}"`);
      need(s.text, `quest "${q.id}": every step needs journal text`);
      if (s.npc) need(has.npc(s.npc), `quest "${q.id}" mentions unknown creature "${s.npc}"`);
      if (s.item) need(has.item(s.item), `quest "${q.id}" mentions unknown item "${s.item}"`);
      if (s.obj) need(has.obj(s.obj), `quest "${q.id}" mentions unknown scenery "${s.obj}"`);
      if (s.skill) need(has.skill(s.skill), `quest "${q.id}" mentions unknown skill "${s.skill}"`);
      need((s.count || 1) <= 30, `quest "${q.id}": ${s.count} of anything is a grind, not a step`);
    }
    for (const sk of Object.keys(q.rewards?.xp || {})) {
      need(has.skill(sk), `quest "${q.id}" rewards unknown skill "${sk}"`);
    }
    for (const [id] of q.rewards?.items || []) {
      need(has.item(id), `quest "${q.id}" rewards unknown item "${id}"`);
    }
    for (const rq of q.reqs?.quests || []) {
      need(game.QUESTS.some(x => x.id === rq), `quest "${q.id}" requires unknown quest "${rq}"`);
    }
    // the giver has to be somewhere a player can reach
    const tree = q.dialogue?.tree || q.id;
    const giver = Object.values(game.NPCS).find(n => n.talk === tree);
    need(!!giver, `quest "${q.id}": nobody has the dialogue tree "${tree}" — give an NPC talk: "${tree}"`);
    if (giver) quest.givers.push([q.id, giver.id]);
  }

  /* -- new ground -- */

  const oldRegions = game.REGIONS.filter(r => !(pack.regions || []).some(n => n.id === r.id));
  const edge = {
    east: Math.max(...oldRegions.map(r => r.x + r.w)),
    south: Math.max(...oldRegions.map(r => r.y + r.h))
  };

  for (const r of pack.regions || []) {
    need(r.name && r.blurb, `region "${r.id}" needs a name and a blurb`);
    need(r.w >= 24 && r.h >= 24, `region "${r.id}" is too small to be worth the trip`);
    need(r.w <= 96 && r.h <= 96, `region "${r.id}" is too large for one delivery`);
    need(!r.safe, `region "${r.id}": new ground may not be a safe zone`);

    /*
     * Only east or south. Every coordinate in every saved game is measured
     * from the same origin, so ground opened to the north or the west would
     * move every player in the world by the width of the new region.
     */
    need(r.x >= 0 && r.y >= 0, `region "${r.id}" starts off the map`);
    need(r.x >= edge.east || r.y >= edge.south,
         `region "${r.id}" overlaps the existing map — new ground attaches east (x ≥ ${edge.east}) or south (y ≥ ${edge.south})`);
    for (const old of oldRegions) {
      const overlaps = r.x < old.x + old.w && r.x + r.w > old.x &&
                       r.y < old.y + old.h && r.y + r.h > old.y;
      need(!overlaps, `region "${r.id}" overlaps ${old.id}`);
    }

    // it has to actually touch something, or it is an island
    const touches = oldRegions.some(old => {
      const sharesX = r.x === old.x + old.w || old.x === r.x + r.w;
      const sharesY = r.y === old.y + old.h || old.y === r.y + r.h;
      const overlapY = Math.min(r.y + r.h, old.y + old.h) - Math.max(r.y, old.y);
      const overlapX = Math.min(r.x + r.w, old.x + old.w) - Math.max(r.x, old.x);
      return (sharesX && overlapY >= 4) || (sharesY && overlapX >= 4);
    });
    need(touches, `region "${r.id}" does not share a border with anything — it would be an island`);

    need((r.links || []).length >= 1, `region "${r.id}" needs at least one road linking it to the map`);
    for (const rule of r.terrain?.rules || []) {
      need(rule.tile, 'every terrain rule needs a tile');
      need(rule.coarse || rule.fine, 'every terrain rule needs a coarse or fine threshold');
    }
  }

  /* -- world -- */
  for (const s of pack.sites || []) {
    need(has.region(s.region), `site "${s.id}": unknown region "${s.region}"`);
    need(s.w * s.h <= LIMITS.siteArea, `site "${s.id}" is too large`);
    for (const o of s.objects || []) {
      need(has.obj(o.type), `site "${s.id}" places unknown scenery "${o.type}"`);
    }
    for (const sp of s.spawns || []) {
      need(has.npc(sp.npc), `site "${s.id}" spawns unknown creature "${sp.npc}"`);
    }
    const R = game.REGIONS.find(r => r.id === s.region);
    if (R) {
      const inside = s.x >= R.x + 1 && s.y >= R.y + 1 &&
                     s.x + s.w <= R.x + R.w - 1 && s.y + s.h <= R.y + R.h - 1;
      need(inside, `site "${s.id}" does not fit inside ${s.region}`);
    }
  }
  for (const s of pack.spawns || []) {
    need(has.npc(s.npc), `spawn: unknown creature "${s.npc}"`);
    if (s.region !== undefined) {
      need(has.region(s.region), `spawn: unknown region "${s.region}"`);
      need(s.count > 0 && s.count <= LIMITS.spawnCount, `spawn: ${s.count} is too many`);
    }
  }
  for (const s of pack.scatter || []) {
    need(has.obj(s.type), `scatter: unknown scenery "${s.type}"`);
    need(has.region(s.region), `scatter: unknown region "${s.region}"`);
    need(s.count > 0 && s.count <= LIMITS.scatterCount, `scatter: ${s.count} is too many`);
  }

  /* ---- 4. balance ------------------------------------------ */

  const CEILING = 1.15;      // a little above the best that exists, never more
  const overBy = (got, allowed) => got > Math.max(4, Math.round(allowed * CEILING));

  for (const it of pack.items || []) {
    const req = env.reqOf(it);
    const att = env.sum(it.b || {}, env.ATT);
    const def = env.sum(it.b || {}, env.DEF);
    const str = (it.b?.str || 0) + (it.b?.rStr || 0) + (it.b?.mDmg || 0) * 2;

    if (it.slot === 'weapon') {
      need(!overBy(att, env.weaponAttack(req)),
           `item "${it.id}": attack ${att} beats everything at requirement ${req} (best is ${env.weaponAttack(req)})`);
      need(!overBy(str, env.weaponStr(req)),
           `item "${it.id}": strength ${str} beats everything at requirement ${req} (best is ${env.weaponStr(req)})`);
      need((it.speed || 4) >= 2, `item "${it.id}": faster than anything in the game`);
    } else if (it.slot) {
      need(!overBy(def, env.armourDefence(req)),
           `item "${it.id}": defence ${def} beats everything at requirement ${req} (best is ${env.armourDefence(req)})`);
    }
    if (it.heal) {
      need(!overBy(it.heal, env.healAt(req)), `item "${it.id}": heals more than anything else does`);
    }
    need(!overBy(it.value, env.value(req) * 1.6),
         `item "${it.id}": worth ${it.value}, which is out of step with the rest of the game`);
    need((it.b?.vigil || 0) <= 8, `item "${it.id}": vigil bonus too generous`);
  }

  for (const n of (pack.npcs || []).filter(x => x.hostile)) {
    const worst = Math.max(n.stats.att || 0, n.stats.str || 0, n.stats.def || 0);
    need(!overBy(n.stats.hp, env.mobHp(n.lvl)),
         `creature "${n.id}": ${n.stats.hp} hitpoints is too much for level ${n.lvl}`);
    need(!overBy(worst, env.mobStat(n.lvl)),
         `creature "${n.id}": levels too high for combat level ${n.lvl}`);
    need(!overBy(Math.max(n.bon.atk, n.bon.str, n.bon.def), env.mobBonus(n.lvl)),
         `creature "${n.id}": bonuses too high for combat level ${n.lvl}`);
    need((n.speed || 4) >= 3, `creature "${n.id}": attacks faster than anything in the game`);

    // a drop table that pays better than the best existing one at that level
    const coins = (n.drops || []).find(d => d.id === 'coins');
    const bestCoins = Math.max(0, ...baseOnly(game.NPCS)
      .filter(m => (m.lvl || 0) <= n.lvl)
      .map(m => (m.drops || []).find(d => d.id === 'coins')?.n?.[1] || 0));
    if (coins) {
      need(!overBy(coins.n[1], bestCoins || 50),
           `creature "${n.id}": drops up to ${coins.n[1]} coins, more than anything its size`);
    }
    for (const d of n.drops || []) {
      const val = game.ITEMS[d.id]?.value || 0;
      need(!overBy(val, env.value(n.lvl) * 3),
           `creature "${n.id}": dropping "${d.id}" is too rich for level ${n.lvl}`);
    }
  }

  for (const o of (pack.objects || []).filter(x => x.skill)) {
    need(!overBy(o.xp, env.gatherXp(o.level)),
         `scenery "${o.id}": ${o.xp} xp is more than anything at level ${o.level}`);
  }
  for (const r of pack.recipes || []) {
    need(!overBy(r.xp, env.craftXp(r.level)),
         `recipe for "${r.out}": ${r.xp} xp is more than anything at level ${r.level}`);
    const outValue = (game.ITEMS[r.out]?.value || 0) * (r.count || 1);
    const inValue = Object.entries(r.need)
      .reduce((a, [id, n]) => a + (game.ITEMS[id]?.value || 0) * n, 0);
    if (inValue > 0 && outValue > inValue * 6) {
      note(`recipe for "${r.out}" turns ${inValue} gp of stock into ${outValue} gp — check that is intended`);
    }
  }
  for (const q of pack.quests || []) {
    const xp = Object.values(q.rewards?.xp || {}).reduce((a, b) => a + b, 0);
    need(xp <= 20000 * q.qp, `quest "${q.id}": ${xp} experience for ${q.qp} quest points is too much`);
  }

  /* ---- 5. does the world still build? ---------------------- */

  let world = null;
  try {
    world = game.world.buildWorld();
  } catch (e) {
    bad(`the world no longer builds: ${e.message}`);
  }

  if (world) {
    /*
     * The check that matters most for new ground: can a nurse standing at the
     * respawn point actually walk there? A region nobody can reach is worse
     * than no region at all, and nothing else in this file would notice.
     */
    const reach = walkableFrom(world, game.world.RESPAWN);
    for (const r of pack.regions || []) {
      let reached = 0, walkable = 0;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (!world.isWalkable(x, y)) continue;
          walkable++;
          if (reach.has(x + ',' + y)) reached++;
        }
      }
      need(walkable >= r.w * r.h * 0.25,
           `region "${r.id}" is almost entirely impassable (${walkable} walkable tiles)`);
      need(reached >= walkable * 0.5,
           `region "${r.id}": only ${reached} of ${walkable} walkable tiles can be reached on foot from the ward — check the linking road`);
    }

    // and everything placed anywhere has to be reachable too
    for (const s of pack.sites || []) {
      const anchor = [...Array(s.h).keys()].flatMap(j =>
        [...Array(s.w).keys()].map(i => [s.x + i, s.y + j]));
      need(anchor.some(([x, y]) => reach.has(x + ',' + y)),
           `site "${s.id}" cannot be walked to from the ward`);
    }

    for (const n of pack.npcs || []) {
      const count = world.npcSpawns.filter(s => s.npc === n.id).length;
      need(count > 0, `creature "${n.id}" is defined but never appears in the world`);
    }
    // a quest whose giver is nowhere on the map is a quest nobody can start
    for (const [questId, giverId] of quest.givers) {
      const spot = world.npcSpawns.find(s => s.npc === giverId);
      need(!!spot, `quest "${questId}": its giver ${giverId} is never placed in the world`);
      if (spot) {
        need(reach.has(spot.x + ',' + spot.y),
             `quest "${questId}": its giver ${giverId} stands somewhere unreachable (${spot.x}, ${spot.y})`);
      }
    }
    for (const o of (pack.objects || []).filter(x => x.skill)) {
      const count = world.objects.filter(x => x.type === o.id).length;
      need(count > 0, `scenery "${o.id}" is defined but never placed in the world`);
    }
    for (const s of pack.sites || []) {
      // a site nobody can walk into is a site nobody will ever see
      let walkable = 0;
      for (let y = s.y; y < s.y + s.h; y++) {
        for (let x = s.x; x < s.x + s.w; x++) if (world.isWalkable(x, y)) walkable++;
      }
      need(walkable >= s.w * s.h * 0.3,
           `site "${s.id}" is mostly impassable (${walkable} of ${s.w * s.h} tiles)`);
    }
  }

  return { ok: problems.length === 0, problems, notes };
}

/** Every tile a nurse could walk to from here, doors and all. */
function walkableFrom(world, start) {
  const seen = new Set([start.x + ',' + start.y]);
  const queue = [[start.x, start.y]];
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (seen.has(k) || !world.isWalkable(nx, ny)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

/* ---------------- command line ------------------------------ */

if (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('validate.mjs')) {
  const args = process.argv.slice(2);
  const files = args.includes('--all')
    ? (await listPackFiles()).map(f => 'content/packs/' + f)
    : args.filter(a => !a.startsWith('--'));

  if (!files.length) {
    console.error('usage: node tools/validate.mjs <pack.json> | --all');
    process.exit(2);
  }

  /*
   * Applying a pack mutates the game's registries, so two packs cannot be
   * judged in one process without the first one colouring the second. More
   * than one file means one child process each.
   */
  if (files.length > 1) {
    const { spawnSync } = await import('node:child_process');
    let failed = 0;
    for (const file of files) {
      const r = spawnSync(process.execPath, [process.argv[1], file],
                          { stdio: 'inherit' });
      if (r.status !== 0) failed++;
    }
    console.log(`\n${files.length - failed} of ${files.length} packs pass.`);
    process.exit(failed ? 1 : 0);
  }

  const file = files[0];
  const pack = JSON.parse(await readFile(rel(file.replace(/^\.\//, '')), 'utf8'));
  const res = await validate(pack);
  console.log(`\n${file}  —  ${pack.title || pack.id}`);
  for (const n of res.notes) console.log(`  note  ${n}`);
  for (const p of res.problems) console.log(`  FAIL  ${p}`);
  console.log(res.ok ? '  passed' : `  ${res.problems.length} problem(s)`);
  process.exit(res.ok ? 0 : 1);
}

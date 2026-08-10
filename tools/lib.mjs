/* ============================================================
   Shared plumbing for the content tools
   ------------------------------------------------------------
   Loading the live game, a repeatable random source, and the
   curves that describe what "in keeping with the rest of the
   game" actually means numerically.
   ============================================================ */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const rel = p => path.join(ROOT, p);

export const readJson = async p => JSON.parse(await readFile(rel(p), 'utf8'));
export const writeJson = async (p, v) =>
  writeFile(rel(p), JSON.stringify(v, null, 2) + '\n', 'utf8');

/* ============================================================
   The live game
   ============================================================ */

/**
 * Imports the game's data modules and applies every pack currently in
 * content/index.json, which is exactly what the server does at boot. The
 * result is "the game as it will be", against which a candidate is judged.
 */
export async function loadGame({ withPacks = true, skip = [] } = {}) {
  const content = await import('../js/data/content.js');
  if (withPacks) await content.loadContent({ skip });

  const [items, npcs, world, recipes, shops, skills, quests] = await Promise.all([
    import('../js/data/items.js'),
    import('../js/data/npcs.js'),
    import('../js/data/world.js'),
    import('../js/data/recipes.js'),
    import('../js/data/shops.js'),
    import('../js/data/skills.js'),
    import('../js/data/quests.js')
  ]);

  return { content, items, npcs, world, recipes, shops, skills, quests,
           ITEMS: items.ITEMS, NPCS: npcs.NPCS, OBJ: world.OBJ,
           RECIPES: recipes.RECIPES, SHOPS: shops.SHOPS,
           SKILLS: skills.SKILLS, QUESTS: quests.QUESTS,
           REGIONS: world.REGIONS };
}

/** Only what shipped with the game, ignoring anything a pack added. */
export const baseOnly = reg =>
  Object.values(reg).filter(v => v && !v.fromPack);

/* ============================================================
   Repeatable randomness
   ============================================================ */

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** xorshift32 — small, fast, and identical on every machine. */
export function makeRng(seed) {
  let s = (hashSeed(seed) || 1) >>> 0;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  next.picks = (arr, n) => {
    const pool = [...arr];
    const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
    return out;
  };
  next.chance = p => next() < p;
  next.shuffle = arr => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  return next;
}

/* ============================================================
   Curves
   ------------------------------------------------------------
   Fitted to what the game already contains. The generator aims
   below these lines and the validator refuses anything above
   them, so the two have to agree without ever sharing a number.
   ============================================================ */

export const CURVE = {
  /** A creature of this combat level: hitpoints, levels, and gear-equivalents. */
  mobHp:    lvl => Math.round(2.1 * lvl + 4),
  mobStat:  lvl => Math.round(1.05 * lvl),
  mobBonus: lvl => Math.round(0.95 * lvl),

  /** Total attack bonus and strength a weapon at this requirement may carry. */
  weaponAttack: req => Math.round(2.9 * req + 14),
  weaponStr:    req => Math.round(1.7 * req + 6),

  /** Total defence across every style for an armour piece. */
  armourDefence: (req, scale) => Math.round((req * 0.85 + 5) * scale * 4),

  /** Roughly what a thing at this level is worth, in coins. */
  value: lvl => Math.round(14 * Math.exp(0.155 * lvl)),

  /** Experience for one action at this level. */
  gatherXp: lvl => Math.round(12 * Math.pow(1.06, lvl)),
  craftXp:  lvl => Math.round(14 * Math.pow(1.055, lvl))
};

/** The strongest thing the base game has at or below a requirement level. */
export function envelope(game) {
  const items = baseOnly(game.ITEMS);
  const npcs = baseOnly(game.NPCS);

  const reqOf = it => Math.max(0, ...Object.values(it.req || { _: 0 }));
  const sum = (b, keys) => keys.reduce((a, k) => a + (b[k] || 0), 0);
  const ATT = ['aStab', 'aSlash', 'aCrush', 'aRange', 'aMagic'];
  const DEF = ['dStab', 'dSlash', 'dCrush', 'dRange', 'dMagic'];

  return {
    /** Best attack total among base weapons needing this level or less. */
    weaponAttack: req => Math.max(0, ...items
      .filter(i => i.slot === 'weapon' && reqOf(i) <= req)
      .map(i => sum(i.b, ATT))),
    weaponStr: req => Math.max(0, ...items
      .filter(i => i.slot === 'weapon' && reqOf(i) <= req)
      .map(i => i.b.str || 0)),
    armourDefence: req => Math.max(0, ...items
      .filter(i => i.slot && i.slot !== 'weapon' && reqOf(i) <= req)
      .map(i => sum(i.b, DEF))),
    value: lvl => Math.max(0, ...items.filter(i => reqOf(i) <= lvl).map(i => i.value || 0)),
    healAt: lvl => Math.max(0, ...items.map(i => i.heal || 0)),
    mobHp: lvl => Math.max(0, ...npcs.filter(n => (n.lvl || 0) <= lvl).map(n => n.stats?.hp || 0)),
    mobStat: lvl => Math.max(0, ...npcs.filter(n => (n.lvl || 0) <= lvl)
      .map(n => Math.max(n.stats?.att || 0, n.stats?.str || 0, n.stats?.def || 0))),
    mobBonus: lvl => Math.max(0, ...npcs.filter(n => (n.lvl || 0) <= lvl)
      .map(n => Math.max(n.bon?.atk || 0, n.bon?.str || 0, n.bon?.def || 0))),
    gatherXp: lvl => Math.max(0, ...Object.values(game.OBJ)
      .filter(o => !o.fromPack && (o.level || 0) <= lvl).map(o => o.xp || 0)),
    craftXp: lvl => Math.max(0, ...Object.values(game.RECIPES).flat()
      .filter(r => r.level <= lvl).map(r => r.xp)),
    sum, ATT, DEF, reqOf
  };
}

/* ============================================================
   Art kinds
   ============================================================ */

/**
 * Pulled out of the painters themselves rather than kept in a list here, so
 * a pack asking for a shape nobody can draw is caught rather than shipped as
 * a grey blob.
 */
export async function artKinds() {
  const { SHAPE_KINDS } = await import('../js/engine/icons.js');
  const render = await readFile(rel('js/engine/render.js'), 'utf8');

  /*
   * The renderer paints scenery and creatures in two separate switches. They
   * have to be read separately, or a pack could give a bush the shape of a rat
   * and be told it was fine, then draw nothing at all in the world.
   */
  const cases = src => new Set([...src.matchAll(/case\s+'([a-z_]+)'/g)].map(m => m[1]));
  const sceneryAt = render.indexOf('switch (d.art)');
  const npcAt = render.indexOf('switch (d.art.k)');
  if (sceneryAt < 0 || npcAt < 0) {
    throw new Error('cannot find the art switches in render.js — has it been restructured?');
  }

  return {
    item: new Set(SHAPE_KINDS),
    scenery: cases(render.slice(sceneryAt, npcAt)),
    npc: cases(render.slice(npcAt))
  };
}

/* ============================================================
   Misc
   ============================================================ */

/**
 * Walkable tiles a region must keep for every creature standing in it.
 *
 * Nothing used to relate what a pack added to how much room there was. The
 * Cartilage Rings opened at 48×44 holding twenty-two creatures, which was fine;
 * then two bestiary deliveries put thirty more in each, and eighty-four
 * creatures in under two thousand walkable tiles is one every twenty-four -
 * ground you cannot cross rather than ground you fight through.
 *
 * The busiest region in the base game is the Palate Wilds at 88 tiles each and
 * the calmest inhabited one is around 260. Sixty leaves a delivery real room to
 * fill new ground while refusing what happened to the Rings. One number for
 * everywhere on purpose: a rule per region is a rule nobody remembers.
 *
 * tools/validate.mjs enforces it and tools/beat.mjs tells the author how much
 * headroom is left, so they must agree - hence living here.
 */
export const TILES_PER_CREATURE = 60;

export const today = (d = new Date()) => d.toISOString().slice(0, 10);

export const slug = s => String(s).toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export function listPackFiles() {
  return readdir(rel('content/packs')).catch(() => []);
}

export const say = (...a) => console.log(...a);
export const warn = (...a) => console.warn(...a);

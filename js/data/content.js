/* ============================================================
   Content packs - additive game data loaded at boot
   ------------------------------------------------------------
   A pack is plain JSON. It may add items, scenery, creatures,
   recipes, shop stock, quests, skills and small built sites; it
   may not change or remove anything that already exists. That
   restriction is the whole point: a pack can be written by a
   machine and shipped without a human reading every line,
   because the worst it can do is add something nobody likes.

   No pack ever carries code. Quests arrive as a list of steps
   and are compiled here into the same hooks a hand-written
   quest uses, so the only behaviour in the game is behaviour
   that was written by hand in this file.

   world.js imports CONTENT and this module imports OBJ from
   world.js. The cycle is deliberate and safe: neither side
   reads the other during module evaluation.
   ============================================================ */

import { ITEMS, ALL_ITEM_IDS } from './items.js';
import { NPCS } from './npcs.js';
import { OBJ, REGIONS, T, regionById } from './world.js';
import { RECIPES, STATION_SKILL } from './recipes.js';
import { SHOPS } from './shops.js';
import { SKILLS, SKILL_BY_ID, SKILL_IDS } from './skills.js';
import { QUESTS, QUEST_BY_ID, DIALOGUE, DONE } from './quests.js';

export const CONTENT_VERSION = 1;

/**
 * What buildWorld asks for once the packs are in. Kept as one live object so
 * world.js can read it without importing anything that might not exist yet.
 */
export const CONTENT = {
  packs: [],          // every pack applied, in order
  sites: [],          // built places to stamp into the map
  spawns: [],         // { npc, region, count, allow } or { npc, x, y }
  scatter: [],        // { type, region, count, allow }
  links: []           // roads joining new ground to the old
};

export const loadedPacks = () => CONTENT.packs;

/* ============================================================
   Applying a pack
   ============================================================ */

/**
 * Adds one pack to the running game. Throws on anything malformed rather
 * than limping on, because a half-applied pack is a world where two clients
 * disagree about what exists.
 */
export function applyPack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('pack is not an object');
  if (!pack.id) throw new Error('pack has no id');
  if (CONTENT.packs.some(p => p.id === pack.id)) return;   // already applied

  // ground first: everything else may want to stand on it
  for (const r of pack.regions || []) addRegion(r);
  for (const s of pack.skills || []) addSkill(s);
  for (const i of pack.items || []) addItem(i);
  for (const o of pack.objects || []) addObject(o);
  for (const n of pack.npcs || []) addNpc(n);
  for (const r of pack.recipes || []) addRecipe(r);
  for (const s of pack.shopStock || []) addStock(s);
  for (const q of pack.quests || []) addQuest(q);

  for (const s of pack.sites || []) CONTENT.sites.push(s);
  for (const s of pack.spawns || []) CONTENT.spawns.push(s);
  for (const s of pack.scatter || []) CONTENT.scatter.push(s);

  CONTENT.packs.push(pack);
}

const taken = (where, id, kind) => {
  if (where[id]) throw new Error(`${kind} "${id}" already exists — packs may only add`);
};

/** A tile named in JSON, resolved to the number the engine uses. */
const tileOf = (name, fallback) => {
  if (typeof name === 'number') return name;
  const t = T[String(name).toUpperCase()];
  if (t === undefined && name !== undefined) throw new Error(`unknown tile "${name}"`);
  return t ?? fallback;
};

/**
 * New ground. Regions may only be added east or south of what already exists,
 * because every coordinate in every save is measured from the same origin —
 * opening land to the north would silently move every player in the world.
 */
function addRegion(r) {
  if (regionById(r.id)) throw new Error(`region "${r.id}" already exists — packs may only add`);
  if (REGIONS.length >= 200) throw new Error('too many regions');
  if (r.x < 0 || r.y < 0) throw new Error(`region "${r.id}" starts off the map`);

  REGIONS.push({
    id: r.id,
    name: r.name,
    x: r.x, y: r.y, w: r.w, h: r.h,
    base: tileOf(r.base, T.TURF),
    tint: r.tint || '#7a5a5e',
    safe: !!r.safe,
    blurb: r.blurb || '',
    fromPack: true,
    terrain: {
      rules: (r.terrain?.rules || []).map(rule => ({
        tile: tileOf(rule.tile),
        coarse: rule.coarse,
        fine: rule.fine
      }))
    }
  });

  for (const l of r.links || []) CONTENT.links.push({ ...l, region: r.id });
}

function addSkill(s) {
  taken(SKILL_BY_ID, s.id, 'skill');
  const def = { id: s.id, name: s.name, icon: s.icon || '🔸', blurb: s.blurb || '' };
  if (s.start) def.start = s.start;
  SKILLS.push(def);
  SKILL_BY_ID[def.id] = def;
  SKILL_IDS.push(def.id);
}

function addItem(i) {
  taken(ITEMS, i.id, 'item');
  const def = { ...i };
  def.b = def.b || {};
  def.value = def.value ?? 1;
  def.fromPack = true;
  ITEMS[def.id] = def;
  ALL_ITEM_IDS.push(def.id);
}

function addObject(o) {
  taken(OBJ, o.id, 'scenery');
  const { id, ...rest } = o;
  OBJ[id] = { ...rest, fromPack: true };
}

function addNpc(n) {
  taken(NPCS, n.id, 'creature');
  NPCS[n.id] = {
    hostile: false, wander: 0, respawn: 25, aggroRange: 0,
    speed: 4, attackRange: 1, size: 1,
    ...n,
    fromPack: true
  };
}

function addRecipe(r) {
  const list = RECIPES[r.station];
  if (!list) throw new Error(`unknown station "${r.station}"`);
  if (list.some(x => x.out === r.out && x.level === r.level)) return;
  list.push({
    skill: r.skill || STATION_SKILL[r.station],
    level: r.level, xp: r.xp, need: r.need, out: r.out, count: r.count || 1
  });
  list.sort((a, b) => a.level - b.level);
}

function addStock(s) {
  const shop = SHOPS[s.shop];
  if (!shop) throw new Error(`unknown shop "${s.shop}"`);
  if (shop.stock.some(e => e[0] === s.item)) return;
  shop.stock.push([s.item, s.n ?? 5]);
}

/* ============================================================
   Quests, compiled from steps
   ============================================================ */

/**
 * Step kinds a pack may use. Each one owns a stage: stage 1 is the first
 * step, stage 2 the second, and so on, with DONE at the end. Everything a
 * step can do is listed here, and a pack can only choose from this list.
 */
const STEP_KINDS = {
  /** Kill n of a creature. */
  kill: {
    hook: 'onKill',
    match: (step, id) => id === step.npc,
    progress: step => `${step.count} × ${step.npc}`
  },
  /** Bring n of an item to the giver (checked when you talk to them). */
  fetch: {
    deliver: true,
    progress: step => `${step.count} × ${step.item}`
  },
  /** Search a kind of scenery until it gives up the item. */
  search: {
    hook: 'onSearch',
    match: (step, type) => type === step.obj,
    progress: step => `search the ${step.obj}`
  },
  /** Use an item on a creature n times. */
  treat: {
    hook: 'onUseOnNpc',
    progress: step => `${step.count} × ${step.npc}`
  }
};

export const stepKinds = () => Object.keys(STEP_KINDS);

function addQuest(q) {
  taken(QUEST_BY_ID, q.id, 'quest');
  const steps = q.steps || [];
  if (!steps.length) throw new Error(`quest "${q.id}" has no steps`);
  for (const s of steps) {
    if (!STEP_KINDS[s.kind]) throw new Error(`quest "${q.id}": unknown step "${s.kind}"`);
  }

  const finalStage = steps.length + 1;      // "go back and report"
  const def = {
    id: q.id,
    name: q.name,
    difficulty: q.difficulty || 'Novice',
    length: q.length || 'Short',
    qp: q.qp || 1,
    start: q.start || '',
    reqs: q.reqs || {},
    desc: q.desc || '',
    fromPack: true,
    stageText: buildStageText(q, steps, finalStage),
    rewards: q.rewards || { qp: q.qp || 1 }
  };

  /* -- one hook per kind, dispatching to whichever step is live -- */
  for (const kind of new Set(steps.map(s => s.kind))) {
    const spec = STEP_KINDS[kind];
    if (!spec.hook) continue;
    def[spec.hook] = (g, ...args) => runStep(g, def, steps, kind, args);
  }

  QUESTS.push(def);
  QUEST_BY_ID[def.id] = def;

  if (q.dialogue) {
    const tree = buildTree(q, steps, finalStage);
    // say plainly which quest this tree hands out; a compiled tree carries the
    // id in a closure, where nothing outside can see it
    tree.quest = q.id;
    DIALOGUE[q.dialogue.tree || q.id] = tree;
  }
}

function buildStageText(q, steps, finalStage) {
  const out = {
    0: q.stageText?.[0] || q.start || `Someone in the Throat needs a nurse.`
  };
  steps.forEach((s, i) => {
    out[i + 1] = g => {
      const p = g.q(q.id);
      const done = s.kind === 'fetch' ? g.count(s.item) : (p.n || 0);
      const need = s.count || 1;
      return `${s.text || 'Get on with it.'} (${Math.min(done, need)}/${need})`;
    };
  });
  out[finalStage] = q.reportText || `That is done. I should report back.`;
  out[DONE] = q.doneText || `Finished. The Throat is marginally less awful.`;
  return out;
}

/**
 * Advances whichever step is currently live. Returns true if the event was
 * consumed, which is what stops two quests claiming the same kill.
 */
function runStep(g, def, steps, kind, args) {
  const stage = g.stage(def.id);
  const step = steps[stage - 1];
  if (!step || step.kind !== kind) return false;

  const spec = STEP_KINDS[kind];
  if (kind === 'kill' && !spec.match(step, args[0])) return false;
  if (kind === 'search') {
    const [objType] = args;
    if (!spec.match(step, objType)) return false;
    if (g.has(step.item)) return false;
    g.give(step.item, 1);
    finishStep(g, def, steps, stage, step);
    return true;
  }
  if (kind === 'treat') {
    const [itemId, npcId] = args;
    if (itemId !== step.item || npcId !== step.npc) return false;
    g.take(step.item, 1);
  }

  const p = g.q(def.id);
  const need = step.count || 1;
  if ((p.n || 0) >= need) return false;
  p.n = (p.n || 0) + 1;
  if (step.xp && step.skill) g.xp(step.skill, step.xp);

  if (p.n >= need) finishStep(g, def, steps, stage, step);
  else g.quest(`${step.tick || 'Progress.'} (${p.n}/${need})`);
  return true;
}

function finishStep(g, def, steps, stage, step) {
  g.setStage(def.id, stage + 1);
  g.q(def.id).n = 0;
  g.quest(step.done || 'That part is done.');
}

/**
 * The giver's dialogue: an opening, a nudge while you are working, and a
 * hand-over at the end. Written from the pack's lines, wired by shape.
 */
function buildTree(q, steps, finalStage) {
  const d = q.dialogue;
  const id = q.id;
  const nodes = {};

  const intro = [].concat(d.intro || ['I could use a hand.']);
  intro.forEach((line, i) => {
    const isLast = i === intro.length - 1;
    nodes['i' + i] = isLast
      ? { text: line, opts: [
          { label: d.accept || "I'll do it.", to: 'start' },
          { label: d.refuse || 'Not just now.', to: 'end' }
        ] }
      : { text: line, to: 'i' + (i + 1) };
  });

  nodes.start = {
    act: g => { g.startQuest(id); },
    text: d.briefing || steps[0]?.text || 'Good. Off you go.',
    to: 'end'
  };

  nodes.prog = {
    text: g => {
      const stage = g.stage(id);
      const step = steps[stage - 1];
      if (!step) return d.ready || 'You have done it? Let me see.';
      return step.text || d.nudge || 'Not finished yet.';
    },
    to: 'end'
  };

  /* the fetch step is the one that completes by talking, so it is checked here */
  nodes.hand = {
    text: g => {
      const stage = g.stage(id);
      const step = steps[stage - 1];
      if (!step || step.kind !== 'fetch') return d.nudge || 'Not yet.';
      if (g.count(step.item) < (step.count || 1)) {
        return step.text || 'You do not have them all yet.';
      }
      g.take(step.item, step.count || 1);
      g.setStage(id, stage + 1);
      return step.done || 'That is the lot. Thank you.';
    },
    to: 'end'
  };

  const outro = [].concat(d.finish || ['That is that.']);
  outro.forEach((line, i) => {
    const isLast = i === outro.length - 1;
    nodes['f' + i] = {
      text: line,
      ...(i === 0 ? { act: g => g.completeQuest(id) } : {}),
      ...(isLast ? { to: 'end' } : { to: 'f' + (i + 1) })
    };
  });

  nodes.after = { text: d.after || 'Thank you again, nurse.', to: 'end' };

  return {
    start(g) {
      const stage = g.stage(id);
      if (stage === 0) return g.canStart(id) ? 'i0' : 'locked';
      if (stage >= DONE) return 'after';
      if (stage === finalStage) return 'f0';
      const step = steps[stage - 1];
      return step && step.kind === 'fetch' ? 'hand' : 'prog';
    },
    nodes: {
      ...nodes,
      locked: { text: d.locked || 'Come back when you are readier than this.', to: 'end' }
    }
  };
}

/* ============================================================
   Loading
   ============================================================ */

/**
 * Reads content/index.json and every pack it lists. Works in the browser
 * over fetch and in node off the disk, because both ends must end up with
 * exactly the same world - the map is generated, never transmitted.
 */
export async function loadContent({ read, skip = [] } = {}) {
  const get = read || defaultReader();
  let index;
  try {
    index = await get('content/index.json');
  } catch {
    return { packs: [], patch: null };      // a game with no packs is fine
  }

  const packs = [];
  for (const file of index.packs || []) {
    try {
      const pack = await get('content/' + file);
      // the validator loads the game as it would be without the pack it is
      // about to judge, so that re-checking a shipped pack still works
      if (skip.includes(pack.id)) continue;
      applyPack(pack);
      packs.push(pack);
    } catch (e) {
      // one bad pack must not take the ward down with it
      console.warn(`[content] skipped ${file}: ${e.message}`);
    }
  }
  return { packs, index };
}

function defaultReader() {
  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    return async path => {
      const r = await fetch('/' + path, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return r.json();
    };
  }
  return async path => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../../', import.meta.url));
    return JSON.parse(await readFile(root + path, 'utf8'));
  };
}

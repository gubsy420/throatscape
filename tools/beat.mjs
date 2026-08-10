/* ============================================================
   The beat
   ------------------------------------------------------------
   Decides what today's delivery should be, and writes the brief
   the author works from.

   Nothing here writes content. It looks at the world as it
   stands — which region is newest, what is living in it, what
   can be gathered there, whether anything has a reason to go —
   and picks the one addition that would do that place the most
   good. When the newest ground is properly furnished, and not
   before, the map is allowed to grow again.

   That is the whole cycle: open ground, fill it, open more.

   Usage:  node tools/beat.mjs                 # today's brief
           node tools/beat.mjs --beat boss     # force a beat
           node tools/beat.mjs --out brief.json
   ============================================================ */

import { readFile } from 'node:fs/promises';
import {
  loadGame, envelope, artKinds, readJson, writeJson, rel, today, listPackFiles, say,
  TILES_PER_CREATURE
} from './lib.mjs';

/* ============================================================
   What is already here
   ============================================================ */

/** Every pack that has shipped, newest last, with the day it landed. */
export async function history() {
  const files = await listPackFiles();
  const packs = [];
  for (const f of files) {
    try {
      const p = JSON.parse(await readFile(rel('content/packs/' + f), 'utf8'));
      packs.push({ id: p.id, beat: p.beat, title: p.title, date: p.date || p.version?.replace(/\./g, '-') });
    } catch { /* a pack that will not parse is the validator's problem */ }
  }
  return packs.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

const daysBetween = (a, b) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** How long since a beat of this kind last landed. Infinity if never. */
function sinceLast(packs, beat, date) {
  const last = [...packs].reverse().find(p => p.beat === beat);
  if (!last || !last.date) return Infinity;
  const d = daysBetween(last.date, date);
  return Number.isFinite(d) ? d : Infinity;
}

/**
 * A census of one region: what lives there, what grows there, and whether
 * anybody has a reason to walk into it.
 */
export function census(game, world, regionId) {
  const R = game.REGIONS.find(r => r.id === regionId);
  const inRegion = (x, y) => world.regionAt(x, y)?.id === regionId;

  const hostiles = new Set();
  const friendlies = new Set();
  let bosses = 0;
  for (const s of world.npcSpawns) {
    if (!inRegion(s.x, s.y)) continue;
    const d = game.NPCS[s.npc];
    if (!d) continue;
    if (d.hostile) { hostiles.add(s.npc); if (d.boss) bosses++; }
    else friendlies.add(s.npc);
  }

  const gathers = new Set();
  for (const o of world.objects) {
    if (!inRegion(o.x, o.y)) continue;
    if (game.OBJ[o.type]?.skill) gathers.add(o.type);
  }

  /*
   * A quest belongs to the region its giver stands in. Which quest a giver
   * starts is not recorded anywhere - it is a call inside a dialogue node -
   * so this reads the node itself. A heuristic, but it only decides what to
   * write next, and being wrong costs a day of the wrong kind of content.
   */
  const quests = new Set();
  for (const id of friendlies) {
    const tree = game.quests.DIALOGUE[game.NPCS[id]?.talk];
    if (!tree) continue;
    // a compiled tree says so outright; a hand-written one has to be read
    if (tree.quest) { quests.add(tree.quest); continue; }
    const src = Object.values(tree.nodes || {})
      .flatMap(n => [n.act, n.text, ...(n.opts || []).map(o => o.act)])
      .filter(f => typeof f === 'function')
      .map(String).join(' ');
    for (const m of src.matchAll(/(?:startQuest|completeQuest)\(\s*'([a-z0-9_]+)'/g)) {
      quests.add(m[1]);
    }
  }

  const levels = [...hostiles].map(id => game.NPCS[id]?.lvl || 0).filter(Boolean);

  /*
   * How full the place already is. The validator refuses a region holding a
   * creature per fewer than TILES_PER_CREATURE walkable tiles, and the only way
   * an author can aim below that ceiling is to be told where it is - otherwise
   * a bestiary day writes thirty creatures, gets rejected, and the whole
   * delivery is lost to arithmetic nobody could see.
   */
  let walkable = 0, living = 0;
  if (R) {
    for (let y = R.y; y < R.y + R.h; y++) {
      for (let x = R.x; x < R.x + R.w; x++) if (world.isWalkable(x, y)) walkable++;
    }
    living = world.npcSpawns.filter(s =>
      s.x >= R.x && s.x < R.x + R.w && s.y >= R.y && s.y < R.y + R.h).length;
  }

  return {
    id: regionId,
    name: R?.name || regionId,
    blurb: R?.blurb || '',
    bounds: R ? { x: R.x, y: R.y, w: R.w, h: R.h } : null,
    safe: !!R?.safe,
    fromPack: !!R?.fromPack,
    walkable,
    living,
    tilesEach: living ? Math.floor(walkable / living) : null,
    /** How many more creatures this region can take before it is too crowded. */
    roomForMore: Math.max(0, Math.floor(walkable / TILES_PER_CREATURE) - living),
    hostileKinds: hostiles.size,
    friendlyKinds: friendlies.size,
    gatherKinds: gathers.size,
    bosses,
    quests: quests.size,
    levelBand: levels.length ? [Math.min(...levels), Math.max(...levels)] : null,
    creatures: [...hostiles],
    gatherables: [...gathers]
  };
}

const isFurnished = (c, rule) =>
  c.hostileKinds >= rule.hostileKinds &&
  c.gatherKinds >= rule.gatherKinds &&
  c.bosses >= rule.bosses &&
  c.quests >= rule.quests;

/* ============================================================
   Choosing
   ============================================================ */

export async function chooseBeat({ date = today(), force = null } = {}) {
  const schedule = await readJson('content/schedule.json');
  const game = await loadGame();
  const world = game.world.buildWorld();
  const packs = await history();

  /*
   * The frontier is the newest region — the last one opened up. Everything
   * gets poured into it until it stands on its own, which is what stops the
   * map sprawling into a hundred empty fields.
   */
  const regions = game.REGIONS;
  const frontier = census(game, world, regions[regions.length - 1].id);
  const all = regions.map(r => census(game, world, r.id));
  const furnished = isFurnished(frontier, schedule.furnished);

  const gapOk = beat =>
    sinceLast(packs, beat, date) >= (schedule.beats[beat]?.minDaysBetween ?? 1);

  let beat = force;
  let reason = force ? 'asked for on the command line' : '';

  if (!beat) {
    if (furnished && gapOk('expansion')) {
      beat = 'expansion';
      reason = `${frontier.name} is furnished — ${frontier.hostileKinds} kinds of creature, ` +
               `${frontier.gatherKinds} things to gather, ${frontier.bosses} boss, ` +
               `${frontier.quests} quest. Time to open new ground.`;
    } else {
      // whatever the newest ground is shortest of, ordered by what a place
      // needs first: something living in it, then something to take from it,
      // then something at the end of it, then a reason to go
      const wants = [
        ['bestiary', frontier.hostileKinds < schedule.furnished.hostileKinds,
         `${frontier.name} has only ${frontier.hostileKinds} kind(s) of creature in it`],
        ['resource', frontier.gatherKinds < schedule.furnished.gatherKinds,
         `${frontier.name} has only ${frontier.gatherKinds} thing(s) worth gathering`],
        ['boss', frontier.bosses < schedule.furnished.bosses,
         `${frontier.name} has nothing at the end of it`],
        ['quest', frontier.quests < schedule.furnished.quests,
         `nobody has a reason to walk into ${frontier.name}`]
      ];
      const want = wants.find(([b, missing]) => missing && gapOk(b));
      if (want) { beat = want[0]; reason = want[2]; }
      else {
        beat = gapOk('arsenal') ? 'arsenal' : 'bestiary';
        reason = `${frontier.name} is coming along; something to carry, then.`;
      }
    }
  }

  return { schedule, game, world, packs, frontier, all, furnished, beat, reason, date };
}

/* ============================================================
   The brief
   ============================================================ */

/**
 * Everything the author needs and nothing it has to go and look up: what to
 * write, where it goes, what numbers will be accepted, and what already
 * exists so it does not invent a second Ward rat.
 */
export async function brief(opts = {}) {
  const { schedule, game, world, packs, frontier, all, furnished, beat, reason, date }
    = await chooseBeat(opts);

  const env = envelope(game);
  const art = await artKinds();
  const spec = schedule.beats[beat];

  // aim new content at the frontier unless it is a safe town, in which case
  // put it somewhere it can bite
  const target = frontier.safe
    ? all.filter(r => !r.safe).sort((a, b) => (a.hostileKinds - b.hostileKinds))[0] || frontier
    : frontier;

  const band = target.levelBand || [5, 20];
  const mid = Math.round((band[0] + band[1]) / 2);
  const req = Math.max(1, Math.round(mid * 0.6));

  const out = {
    date,
    beat,
    reason,
    summary: spec?.summary,
    budget: spec?.budget || {},

    target: {
      region: target.id,
      name: target.name,
      blurb: target.blurb,
      bounds: target.bounds,
      existingCreatures: target.creatures,
      existingGatherables: target.gatherables,
      combatLevelBand: band,
      suggestedRequirementLevel: req,
      /*
       * How full it already is. Without this an author picks a spawn count out
       * of the air, and the validator - which refuses a region holding a
       * creature per fewer than TILES_PER_CREATURE walkable tiles - throws away
       * the whole delivery over arithmetic nobody could see.
       */
      crowding: {
        walkableTiles: target.walkable,
        creaturesAlready: target.living,
        tilesEachNow: target.tilesEach,
        roomForMoreCreatures: target.roomForMore,
        note: `Every creature in a region needs ${TILES_PER_CREATURE} walkable tiles to itself. ` +
              `${target.name} has room for ${target.roomForMore} more; spawn counts across this ` +
              `pack must add up to no more than that, or the gate refuses it.`
      }
    },

    /* what the validator will and will not accept, at the levels in play */
    ceilings: {
      note: 'The validator refuses anything more than 15% above these. Aim below them.',
      atCombatLevel: Object.fromEntries([band[0], mid, band[1]].map(l => [l, {
        hitpoints: env.mobHp(l), levels: env.mobStat(l), bonuses: env.mobBonus(l),
        richestCoinDrop: Math.max(0, ...Object.values(game.NPCS)
          .filter(n => !n.fromPack && (n.lvl || 0) <= l)
          .map(n => (n.drops || []).find(d => d.id === 'coins')?.n?.[1] || 0))
      }])),
      atRequirementLevel: Object.fromEntries([Math.max(1, req - 5), req, req + 5].map(l => [l, {
        weaponAttackTotal: env.weaponAttack(l), weaponStrength: env.weaponStr(l),
        armourDefenceTotal: env.armourDefence(l), itemValue: env.value(l),
        gatherXp: env.gatherXp(l), craftXp: env.craftXp(l)
      }]))
    },

    world: {
      size: { w: world.w, h: world.h },
      regions: all.map(r => ({
        id: r.id, name: r.name, bounds: r.bounds, safe: r.safe,
        creatures: r.hostileKinds, gatherables: r.gatherKinds,
        bosses: r.bosses, quests: r.quests, opened: r.fromPack ? 'by a pack' : 'original'
      })),
      frontier: frontier.id,
      frontierFurnished: furnished
    },

    existingIds: {
      items: Object.keys(game.ITEMS),
      creatures: Object.keys(game.NPCS),
      scenery: Object.keys(game.OBJ),
      quests: game.QUESTS.map(q => q.id),
      skills: game.SKILLS.map(s => s.id),
      regions: game.REGIONS.map(r => r.id),
      shops: Object.keys(game.SHOPS),
      stations: Object.keys(game.RECIPES)
    },

    art: {
      note: 'Only these can be drawn. Anything else is rejected.',
      itemShapes: [...art.item].sort(),
      scenery: [...art.scenery].sort(),
      creatures: [...art.npc].sort()
    },

    recent: packs.slice(-8).map(p => ({ date: p.date, beat: p.beat, title: p.title }))
  };

  if (beat === 'expansion') out.expansion = expansionSites(game, world, schedule);
  return out;
}

/**
 * Where new ground could legally attach. Regions may only be added east or
 * south, and must share a real border with something already on the map, so
 * this works out the candidates rather than leaving the author to guess at
 * coordinates it cannot check.
 */
function expansionSites(game, world, schedule) {
  const R = game.REGIONS;
  const maxX = Math.max(...R.map(r => r.x + r.w));
  const maxY = Math.max(...R.map(r => r.y + r.h));
  const [minW, minH] = schedule.expansion.minSize;
  const [maxW, maxH] = schedule.expansion.maxSize;

  // the run of regions flush against each edge is what a new region can join
  const eastEdge = R.filter(r => r.x + r.w === maxX)
    .map(r => ({ region: r.id, y: r.y, h: r.h }))
    .sort((a, b) => a.y - b.y);
  const southEdge = R.filter(r => r.y + r.h === maxY)
    .map(r => ({ region: r.id, x: r.x, w: r.w }))
    .sort((a, b) => a.x - b.x);

  const candidates = [];
  for (const e of eastEdge) {
    candidates.push({
      side: 'east', joins: e.region,
      x: maxX, y: e.y,
      w: Math.min(maxW, Math.max(minW, 48)),
      h: Math.min(maxH, Math.max(minH, e.h)),
      link: { x1: maxX - 8, y1: e.y + Math.floor(e.h / 2),
              x2: maxX + 20, y2: e.y + Math.floor(e.h / 2), w: 4 }
    });
  }
  for (const e of southEdge) {
    candidates.push({
      side: 'south', joins: e.region,
      x: e.x, y: maxY,
      w: Math.min(maxW, Math.max(minW, e.w)),
      h: Math.min(maxH, Math.max(minH, 48)),
      link: { x1: e.x + Math.floor(e.w / 2), y1: maxY - 8,
              x2: e.x + Math.floor(e.w / 2), y2: maxY + 20, w: 4 }
    });
  }

  return {
    note: schedule.expansion.note,
    currentEdge: { east: maxX, south: maxY },
    sizeRange: { min: schedule.expansion.minSize, max: schedule.expansion.maxSize },
    candidates
  };
}

/* ---------------- command line ------------------------------ */

if (process.argv[1]?.endsWith('beat.mjs')) {
  const args = process.argv.slice(2);
  const arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const b = await brief({ date: arg('--date') || today(), force: arg('--beat') });

  const out = arg('--out');
  if (out) {
    await writeJson(out, b);
    say(`wrote ${out}`);
  }
  if (args.includes('--quiet')) {
    say(b.beat);
  } else if (!out || args.includes('--print')) {
    say(JSON.stringify(b, null, 2));
  } else {
    say(`  beat    ${b.beat}`);
    say(`  why     ${b.reason}`);
    say(`  target  ${b.target.name} (levels ${b.target.combatLevelBand.join('–')})`);
    say(`  budget  ${JSON.stringify(b.budget)}`);
  }
}

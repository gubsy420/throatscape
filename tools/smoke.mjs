/* ============================================================
   Smoke test
   ------------------------------------------------------------
   The validator asks whether a pack is well formed. This asks
   whether it can be played: it boots the real simulation, puts
   scripted nurses in the world, and makes them go and use the
   new content — walk to it, hit it, gather it, make it, take
   the quest from start to finish — then boots the real server
   and connects a real client to it.

   Nothing here knows what today's pack contains. It reads the
   packs, works out what is new, and exercises that.

   Usage:  node tools/smoke.mjs                     # everything
           node tools/smoke.mjs content/packs/x.json  # one pack
   ============================================================ */

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { rel, loadGame, say } from './lib.mjs';

let fails = 0;
const ok = (c, m) => { say((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const head = m => say('\n== ' + m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Which piece of furniture each crafting station is. */
const BENCH = {
  smelting: 'furnace', forging: 'anvil', apothecary: 'cauldron',
  suturing: 'sewing_table', cooking: 'cook_range'
};

/* ============================================================
   The world, played headlessly
   ============================================================ */

async function playtest(candidate) {
  const game = await loadGame();

  /*
   * A pack is smoke tested before it is published, so it is usually not in
   * the load order yet. Apply it here if it is not already in - otherwise
   * this would quietly test nothing and report success, which is the one
   * failure a gate must never have.
   */
  if (candidate && !game.content.loadedPacks().some(p => p.id === candidate.id)) {
    game.content.applyPack(candidate);
    say(`applied ${candidate.id} on top of the published packs`);
  }

  const { Sim } = await import('../server/sim.js');
  const state = await import('../js/game/state.js');

  const packs = game.content.loadedPacks()
    .filter(p => !candidate || p.id === candidate.id);
  if (candidate && !packs.length) {
    ok(false, `${candidate.id} did not apply`);
    return fails;
  }
  const newIds = {
    items: new Set(packs.flatMap(p => (p.items || []).map(i => i.id))),
    npcs: new Set(packs.flatMap(p => (p.npcs || []).map(n => n.id))),
    objects: new Set(packs.flatMap(p => (p.objects || []).map(o => o.id))),
    quests: packs.flatMap(p => p.quests || []),
    regions: new Set(packs.flatMap(p => (p.regions || []).map(r => r.id)))
  };

  head('The world builds and holds together');
  const sim = new Sim(null);
  const world = sim.world;
  ok(world.objects.length > 0, `${world.objects.length} pieces of scenery, ${world.npcSpawns.length} spawns`);
  ok(sim.npcs.length > 0, `${sim.npcs.length} creatures alive at boot`);

  /*
   * The test nurse is deliberately overpowered. The question this file asks
   * is "can this content be used at all", not "is it survivable at level
   * ten" — and a nurse who dies half way through would make every check after
   * that point pass or fail for the wrong reason, since a dead player's
   * intents are ignored.
   */
  // the sharpest thing in the game, so a fight is decided by the creature's
  // numbers rather than by how long a bare-handed nurse takes
  const bestWeapon = Object.values(game.ITEMS)
    .filter(i => i.slot === 'weapon' && !i.fromPack)
    .sort((a, b) => sumAttack(b) - sumAttack(a))[0];

  const equip = session => {
    for (const id of Object.keys(session.state.skills)) {
      session.state.skills[id].xp = 4000000;             // level 90-odd
    }
    const p = session.state.player;
    p.dead = false;
    p.maxHp = 400;
    p.hp = 400;
    p.venom = 0;
    if (bestWeapon && session.state.equipment.weapon !== bestWeapon.id) {
      state.addItem(session.state, bestWeapon.id, 1);
      const idx = session.state.inventory.findIndex(s => s && s.id === bestWeapon.id);
      state.equipFromSlot(session.state, idx);
    }
  };

  head('It survives being left running');
  let threw = null;
  const A = sim.add('smoke_a', 'Smokea', null);
  const B = sim.add('smoke_b', 'Smokeb', null);
  try {
    for (let i = 0; i < 400; i++) sim.step();
  } catch (e) { threw = e; }
  ok(!threw, threw ? `400 ticks threw: ${threw.message}` : '400 ticks with two players, no exceptions');

  /* ---- every new creature can be found and fought ---------- */

  if (newIds.npcs.size) {
    head('New creatures can be reached and fought');
    for (const id of newIds.npcs) {
      const def = game.NPCS[id];
      const npc = sim.npcs.find(n => n.id === id);
      if (!npc) { ok(false, `${id} never spawned`); continue; }
      if (!def.hostile) { ok(true, `${def.name} stands at ${npc.x}, ${npc.y}`); continue; }

      // stand next to it and swing until it stops
      equip(A);
      const p = A.state.player;
      const spot = beside(world, npc.x, npc.y) || { x: npc.x, y: npc.y - 1 };
      p.x = p.ix = spot.x; p.y = p.iy = spot.y;
      sim.handle(A, { t: 'attack', u: npc.uid });

      const groundBefore = new Set(sim.ground);
      let hits = 0, dead = false;
      for (let i = 0; i < 300 && !dead; i++) {
        sim.step();
        p.hp = p.maxHp;                    // this is not a test of survival
        if (npc.hp < npc.maxHp) hits++;
        if (npc.dead) dead = true;
      }
      ok(dead, dead
        ? `${def.name} (level ${def.lvl}, ${def.stats.hp} hp) fought and killed`
        : `${def.name} survived 300 ticks of a level-90 nurse (${npc.hp}/${npc.maxHp} left, ${hits ? 'was being hit' : 'never took a hit — can it be reached?'})`);
      if (dead) {
        // it dies wherever the chase ended, so compare the ground before and
        // after rather than guessing at where the body fell
        const table = new Set((def.drops || []).map(d => d.id).filter(Boolean));
        const loot = sim.ground.filter(g => !groundBefore.has(g) && table.has(g.id));
        const always = (def.drops || []).some(d => d.weight >= 100 && d.id);
        ok(loot.length > 0 || !always,
           loot.length
             ? `it dropped ${[...new Set(loot.map(l => l.id))].join(', ')}`
             : 'it dropped nothing, which its table allows');
      }
      p.hp = p.maxHp;
    }
  }

  /* ---- every new node can be gathered ---------------------- */

  const gatherables = [...newIds.objects].filter(id => game.OBJ[id]?.skill);
  if (gatherables.length) {
    head('New resources can be gathered');
    for (const id of gatherables) {
      const def = game.OBJ[id];
      const node = world.objects.find(o => o.type === id);
      if (!node) { ok(false, `${id} is nowhere in the world`); continue; }

      equip(A);
      const p = A.state.player;
      const spot = beside(world, node.x, node.y);
      if (!spot) { ok(false, `${def.name} has nowhere to stand beside it`); continue; }
      p.x = p.ix = spot.x; p.y = p.iy = spot.y;
      if (def.tool) {
        const tool = Object.values(game.ITEMS).find(i => i.tool === def.tool);
        if (tool) state.addItem(A.state, tool.id, 1);
      }
      const before = state.invCount(A.state, def.yield);
      sim.handle(A, { t: 'interact', x: node.x, y: node.y });
      for (let i = 0; i < 300; i++) sim.step();
      const got = state.invCount(A.state, def.yield) - before;
      ok(got > 0, got > 0
        ? `${def.name}: gathered ${got} × ${game.ITEMS[def.yield]?.name || def.yield} at ${def.skill} ${def.level}`
        : `${def.name}: nothing gathered in 300 ticks${def.tool ? ` (needs the ${def.tool} tool)` : ''}`);
    }
  }

  /* ---- every new recipe can be made ------------------------ */

  /*
   * Walk a nurse up to the right bench with everything the recipe asks for and
   * see whether the thing comes out. One function, used both for what a pack
   * adds and for the game's own recipes at every bench, because the two used
   * to be set up separately and drifted: this path forgot the bench's tool.
   *
   * The anvil, the cauldron and the sewing table all refuse to work without
   * one - a rule the game means and the section below deliberately proves -
   * while the furnace and the range need none. So a smelting recipe sailed
   * through and a forging recipe could not pass however good it was, which is
   * how 2026-08-05 rejected a perfectly sound cleaver with "I need a hammer
   * for that".
   */
  const canBeMade = (session, station, out) => {
    const recipe = findRecipe(station, out);
    if (!recipe) return { why: `no recipe for ${out} at the ${station}` };

    const bench = BENCH[station];
    const at = world.objects.find(o => o.type === bench);
    if (!at) return { why: `there is no ${bench} in the world` };

    equip(session);
    const p = session.state.player;
    const spot = beside(world, at.x, at.y) || { x: at.x, y: at.y + 1 };
    p.x = p.ix = spot.x; p.y = p.iy = spot.y;
    for (const [id, n] of Object.entries(recipe.need)) state.addItem(session.state, id, n * 2);

    const tool = STATION_TOOL[station];
    if (tool) {
      const item = Object.values(game.ITEMS).find(i => i.tool === tool);
      if (!item) return { why: `nothing in the game is a ${tool} tool, so the ${bench} can never be used` };
      state.addItem(session.state, item.id, 1);
    }

    /*
     * craft() says why it refused, and this used to throw that away - the whole
     * failure was the line "FAIL Chalkbone cleaver made at the anvil", which
     * says what was attempted and nothing about what went wrong.
     */
    let why = '';
    const off = session.state.bus.on('chat', m => { if (m.cls === 'bad') why = m.text; });
    const before = state.invCount(session.state, out);
    sim.handle(session, { t: 'craft', station, out, qty: 1 });
    for (let i = 0; i < 40; i++) sim.step();
    off();

    const made = state.invCount(session.state, out) > before;
    return { made, bench, why: made ? '' : (why || 'nothing came out, and nothing was said about why') };
  };

  const { findRecipe, buy, sell } = await import('../js/game/economy.js');
  const { STATION_TOOL } = game.recipes;

  const newRecipes = packs.flatMap(p => p.recipes || []);
  if (newRecipes.length) {
    head('New recipes can be made');
    for (const r of newRecipes) {
      const name = game.ITEMS[r.out]?.name || r.out;
      const { made, bench, why } = canBeMade(A, r.station, r.out);
      ok(made, made
        ? `${name} made at the ${bench}`
        : `${name} could not be made at the ${bench || r.station} — ${why}`);
    }
  }

  /*
   * And the same walk-up-and-make-it path against the game's own recipes, at
   * every bench, every run.
   *
   * This exists because the check above only ever exercises the benches that
   * today's pack happens to use. For five days that was the furnace alone, so
   * a setup that could not work an anvil sat there passing until the first
   * arsenal delivery arrived and was blamed for it. A gate that is only as
   * good as the content that shows up is not a gate.
   */
  head('Every bench can be worked, whatever today brought');
  for (const [station, bench] of Object.entries(BENCH)) {
    const own = (game.RECIPES[station] || [])[0];
    if (!own) { ok(false, `nothing can be made at the ${bench} at all`); continue; }
    const name = game.ITEMS[own.out]?.name || own.out;
    const { made, why } = canBeMade(B, station, own.out);
    ok(made, made
      ? `the ${bench} works: ${name}`
      : `the ${bench} cannot be worked even with the game's own ${name} — ${why}`);
  }

  /* ---- what the client is told about scenery --------------- */

  head('A node that grows back says so, even if nobody was watching');
  {
    const s = sim.add('smoke_obj', 'Smokeobj', null);
    const node = sim.world.objects.find(o => game.OBJ[o.type]?.skill && game.OBJ[o.type].respawn > 0);
    ok(!!node, node ? `watching ${node.type} at ${node.x},${node.y}` : 'no respawning node to watch');

    // what this player would be told about that node, if a snapshot went now
    const told = () => {
      s.outbox.length = 0;
      sim.buildSnapshot(s);
      const snap = s.outbox.find(m => m.t === 'snap');
      return (snap.objs || []).find(o => o.x === node.x && o.y === node.y) || null;
    };

    // stand next to it, and see it emptied
    s.p.x = node.x; s.p.y = node.y + 1;
    node.depleted = 5;
    const emptied = told();
    ok(emptied && emptied.d === 1, 'standing next to it, being emptied is reported');

    /*
     * Now walk out of sight and let it fill again. Broadcasting the moment it
     * changes is a message you have to be standing there to receive, and this
     * is the tick you are not: chop a tree, walk away, come back, and it was
     * still a stump until you logged out.
     */
    s.p.x = node.x + 200; s.p.y = node.y;
    let guard = 0;
    while (node.depleted > 0 && guard++ < 500) sim.step();
    ok(node.depleted === 0, 'it has grown back while we were away');
    ok(!told(), 'and nothing is said about it while it is out of range');

    // walk back: arriving is itself what corrects the picture
    s.p.x = node.x; s.p.y = node.y + 1;
    const back = told();
    ok(back && back.d === 0,
       back ? 'walking back into range is told it is full again'
            : 'walking back into range is told NOTHING — it stays a stump');

    // and it is not repeated once the client knows
    ok(!told(), 'and it is not repeated every tick after that');
    sim.remove('smoke_obj');
  }

  head('The blow that empties a node is still a harvest');
  {
    const s = sim.add('smoke_gather', 'Smokegather', null);
    const type = Object.entries(game.OBJ)
      .find(([, d]) => d.skill === 'foraging' && d.respawn > 0 && !d.tool);
    const node = type ? sim.world.objects.find(o => o.type === type[0]) : null;
    ok(!!node, node ? `foraging ${node.type} at ${node.x},${node.y}` : 'no bare-handed node');

    if (node) {
      s.p.x = node.x + 1; s.p.y = node.y;
      node.depleted = 0;
      sim.handle(s, { t: 'interact', x: node.x, y: node.y });

      /*
       * The tick that finishes a node ends the action, so reading the node
       * only from st.action afterwards reports nothing on the one tick that
       * matters. The client then drew the last swing as a weapon swing, and
       * with a staff equipped it played a spell sound for picking a herb.
       */
      let swings = 0, silent = 0;
      for (let i = 0; i < 60 && node.depleted === 0; i++) {
        sim.step();
        if (s.swung) { swings++; if (!s.gathering) silent++; }
      }
      ok(swings > 0, `${swings} swing(s) at it before it emptied`);
      ok(node.depleted > 0, 'and it emptied');
      ok(!silent, silent
        ? `${silent} of ${swings} swings reported no node — those are the ones that sounded like a spell`
        : 'every swing at it was reported as a harvest, including the last');
    }
    sim.remove('smoke_gather');
  }

  /* ---- how long the dead stay dead ------------------------- */

  head('Nothing comes back before you have picked up what it dropped');
  {
    const { respawnTicks, RESPAWN_MIN } = await import('../js/game/combat.js');
    const TICK = 0.6;
    const hostiles = Object.values(game.NPCS).filter(n => n.hostile);
    ok(hostiles.length > 5, `${hostiles.length} things in the Throat fight back`);

    /*
     * The old default was 25 ticks - fifteen seconds - which is not long
     * enough to loot a kill, let alone to work a herb patch sharing the
     * ground with it. The floor is applied to whatever a definition asks
     * for, so a content pack cannot undercut it either.
     */
    const quick = hostiles.filter(n => respawnTicks(n) < RESPAWN_MIN);
    ok(!quick.length, quick.length
      ? `back too fast: ${quick.map(n => `${n.id} (${respawnTicks(n)})`).join(', ')}`
      : `the fastest respawn in the game is ${Math.min(...hostiles.map(respawnTicks)) * TICK}s`);

    const fromPack = hostiles.filter(n => n.fromPack);
    if (fromPack.length) {
      ok(fromPack.every(n => respawnTicks(n) >= RESPAWN_MIN),
         `including the ${fromPack.length} that arrived in a content pack`);
    }
    ok(respawnTicks({ respawn: 1 }) >= RESPAWN_MIN, 'a definition asking for one tick is refused');
    ok(respawnTicks({}) >= RESPAWN_MIN, 'and so is one that forgets to ask');
    ok(respawnTicks({ respawn: 400 }) === 400, 'but a boss that wants longer keeps it');
  }

  /* ---- no tool is sold for nothing ------------------------- */

  head('Every tool has something to use it on');
  const wanted = new Set([
    ...Object.values(game.OBJ).map(o => o.tool).filter(Boolean),
    ...Object.values(STATION_TOOL).filter(Boolean)
  ]);
  for (const it of Object.values(game.ITEMS)) {
    if (!it.tool) continue;
    ok(wanted.has(it.tool),
       wanted.has(it.tool)
         ? `${it.name} (${it.tool}) is required somewhere`
         : `${it.name} declares the "${it.tool}" tool, which nothing in the game asks for — it does nothing`);
  }

  // and the benches that need one really do refuse without it
  for (const [station, tool] of Object.entries(STATION_TOOL)) {
    if (!tool) continue;
    const recipe = (game.RECIPES[station] || [])[0];
    if (!recipe) continue;
    const bench = BENCH[station];
    const at = world.objects.find(o => o.type === bench);
    if (!at) { ok(false, `no ${bench} in the world`); continue; }

    equip(B);
    const p = B.state.player;
    const spot = beside(world, at.x, at.y) || { x: at.x, y: at.y + 1 };
    p.x = p.ix = spot.x; p.y = p.iy = spot.y;
    // clear any tool the loadout happened to include
    for (let i = 0; i < B.state.inventory.length; i++) {
      const s = B.state.inventory[i];
      if (s && game.ITEMS[s.id]?.tool === tool) state.removeSlot(B.state, i, s.n);
    }
    for (const k in B.state.equipment) {
      if (game.ITEMS[B.state.equipment[k]]?.tool === tool) state.unequip(B.state, k);
    }
    for (const [id, n] of Object.entries(recipe.need)) state.addItem(B.state, id, n * 2);

    const before = state.invCount(B.state, recipe.out);
    sim.handle(B, { t: 'craft', station, out: recipe.out, qty: 1 });
    for (let i = 0; i < 20; i++) sim.step();
    ok(state.invCount(B.state, recipe.out) === before,
       `the ${bench} refuses to work without ${tool}`);

    const toolItem = Object.values(game.ITEMS).find(i => i.tool === tool);
    state.addItem(B.state, toolItem.id, 1);
    sim.handle(B, { t: 'craft', station, out: recipe.out, qty: 1 });
    for (let i = 0; i < 20; i++) sim.step();
    ok(state.invCount(B.state, recipe.out) > before,
       `and works once you are holding ${toolItem.name}`);
  }

  /* ---- new gear can be worn -------------------------------- */

  const wearable = [...newIds.items].filter(id => game.ITEMS[id]?.slot);
  if (wearable.length) {
    head('New equipment can be worn');
    equip(A);
    for (const id of wearable) {
      const def = game.ITEMS[id];
      state.addItem(A.state, id, 1);
      const idx = A.state.inventory.findIndex(s => s && s.id === id);
      sim.handle(A, { t: 'equip', idx });
      ok(A.state.equipment[def.slot] === id || def.slot === 'ammo',
         `${def.name} equips to ${def.slot}`);
      const b = state.equipBonuses(A.state);
      ok(Number.isFinite(b.str), `and its bonuses add up`);
      sim.handle(A, { t: 'unequip', slot: def.slot });
    }
  }

  /* ---- every new quest can be finished --------------------- */

  if (newIds.quests.length) {
    head('New quests can be completed');
    const { makeQuestApi } = await import('../js/game/questapi.js');
    const { DONE } = game.quests;

    for (const q of newIds.quests) {
      const def = game.quests.QUEST_BY_ID[q.id];
      if (!def) { ok(false, `${q.id} did not register`); continue; }

      const st = B.state;
      const g = makeQuestApi(st);
      equip(B);
      // meet the requirements the honest way round: just be good enough
      for (const rq of q.reqs?.quests || []) g.setStage(rq, DONE);

      const giver = Object.values(game.NPCS).find(n => n.talk === (q.dialogue?.tree || q.id));
      const spot = world.npcSpawns.find(s => s.npc === giver?.id);
      ok(!!spot, `${def.name}: ${giver?.name || 'its giver'} is in the world`);
      if (!spot) continue;

      // walk the dialogue tree the way a player clicking through would
      const npc = sim.npcs.find(n => n.id === giver.id);
      st.player.x = st.player.ix = spot.x; st.player.y = st.player.iy = spot.y + 1;
      B.outbox.length = 0;
      sim.handle(B, { t: 'talk', u: npc.uid });
      for (let i = 0; i < 6; i++) sim.step();
      clickThrough(sim, B, 12);
      ok(g.stage(q.id) === 1, `${def.name}: started by talking to ${giver.name}`);

      // then do what it asked, step by step
      for (let s = 0; s < q.steps.length; s++) {
        const step = q.steps[s];
        const stageBefore = g.stage(q.id);
        if (step.kind === 'kill') {
          for (let k = 0; k < (step.count || 1); k++) {
            st.bus.emit('kill', { npcId: step.npc });
            const { questHook } = await import('../js/game/questapi.js');
            questHook(makeQuestApi(st), 'onKill', step.npc);
          }
        } else if (step.kind === 'fetch') {
          state.addItem(st, step.item, step.count || 1);
          st.player.x = st.player.ix = spot.x; st.player.y = st.player.iy = spot.y + 1;
          sim.handle(B, { t: 'talk', u: npc.uid });
          for (let i = 0; i < 6; i++) sim.step();
          clickThrough(sim, B, 12);
        } else if (step.kind === 'search') {
          const { questHook } = await import('../js/game/questapi.js');
          questHook(makeQuestApi(st), 'onSearch', step.obj, st.player.x, st.player.y);
        } else if (step.kind === 'treat') {
          const { questHook } = await import('../js/game/questapi.js');
          state.addItem(st, step.item, step.count || 1);
          for (let k = 0; k < (step.count || 1); k++) {
            questHook(makeQuestApi(st), 'onUseOnNpc', step.item, step.npc);
          }
        }
        ok(g.stage(q.id) > stageBefore,
           `${def.name}: step ${s + 1} (${step.kind}) advanced the quest`);
      }

      // and report back
      st.player.x = st.player.ix = spot.x; st.player.y = st.player.iy = spot.y + 1;
      sim.handle(B, { t: 'talk', u: npc.uid });
      for (let i = 0; i < 6; i++) sim.step();
      clickThrough(sim, B, 12);
      ok(g.stage(q.id) >= DONE, `${def.name}: finished, and paid out`);

      for (const [id, n] of def.rewards?.items || []) {
        ok(state.invCount(st, id) >= n || st.ground.some(x => x.id === id),
           `  reward: ${n} × ${game.ITEMS[id]?.name || id}`);
      }
    }
  }

  /* ---- new ground can be walked to ------------------------- */

  if (newIds.regions.size) {
    head('New ground can be walked to');
    const { findPath } = await import('../js/util.js');
    const { RESPAWN } = game.world;
    for (const id of newIds.regions) {
      const R = game.REGIONS.find(r => r.id === id);
      let target = null;
      for (let y = R.y; y < R.y + R.h && !target; y += 2) {
        for (let x = R.x; x < R.x + R.w && !target; x += 2) {
          if (world.isWalkable(x, y)) target = { x, y };
        }
      }
      ok(!!target, `${R.name} has somewhere to stand`);
      if (!target) continue;
      const path = findPath(RESPAWN.x, RESPAWN.y, target.x, target.y,
                            (x, y) => world.isWalkable(x, y), 400000);
      const arrived = path.length && path[path.length - 1].x === target.x &&
                      path[path.length - 1].y === target.y;
      ok(arrived, `${R.name} is ${path.length} steps from the ward respawn`);
    }
  }

  /* ---- room to move ---------------------------------------- */

  /*
   * The Cartilage Rings opened at 48×44 with twenty-two creatures in it, which
   * was reasonable, and then two bestiary deliveries put thirty more in each.
   * Eighty-four creatures in 1,992 walkable tiles is one every twenty-four, and
   * half of them within three tiles of another - ground you cannot cross rather
   * than ground you fight through. Nothing related what a pack added to how
   * much room there was, and nothing measured how far apart it ended up.
   */
  head('Every region has room to move in');
  {
    const { TILES_PER_CREATURE } = await import('./lib.mjs');
    for (const r of game.REGIONS) {
      let walkable = 0;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) if (world.isWalkable(x, y)) walkable++;
      }
      const here = world.npcSpawns.filter(s =>
        s.x >= r.x && s.x < r.x + r.w && s.y >= r.y && s.y < r.y + r.h);
      if (!here.length) continue;

      const each = Math.floor(walkable / here.length);
      ok(each >= TILES_PER_CREATURE,
         `${r.name}: ${here.length} creatures in ${walkable} tiles — one every ${each}` +
         (each >= TILES_PER_CREATURE ? '' : `, and ${TILES_PER_CREATURE} is the floor`));
    }
  }

  /*
   * And that they are spread through it rather than heaped. Size and spacing are
   * separate faults: giving the Rings four times the room still left creatures
   * standing on the same tile as each other, because placement picked positions
   * at random and never looked at what was already there.
   */
  head('Creatures are spread through a region, not heaped in it');
  {
    for (const r of game.REGIONS) {
      const here = world.npcSpawns.filter(s =>
        s.x >= r.x && s.x < r.x + r.w && s.y >= r.y && s.y < r.y + r.h);
      // the hand-placed people of a settlement stand where they are put
      if (here.length < 8 || r.safe) continue;

      let touching = 0;
      for (const a of here) {
        let nearest = Infinity;
        for (const b of here) {
          if (a === b) continue;
          const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
          if (d < nearest) nearest = d;
        }
        if (nearest <= 2) touching++;
      }
      ok(touching === 0,
         touching === 0
           ? `${r.name}: none of its ${here.length} creatures stands within two tiles of another`
           : `${r.name}: ${touching} of ${here.length} creatures are within two tiles of another — that is a knot, not a population`);
    }
  }

  /* ---- shelves are finite ---------------------------------- */

  /*
   * Shop stock used to be decoration: the number was written in the data,
   * drawn in the panel, and consulted by nothing. You could buy four hundred
   * ironblood bars out of a stock of fourteen, and the general store's
   * `['bones', 0]` sold unlimited two-gold bones to bury for Vigil.
   */
  head('A shop can be sold out, and gets more in');
  {
    const { ShopStock, RESTOCK_TICKS } = await import('../js/game/shopstock.js');
    const shop = game.SHOPS.forge;
    const stock = new ShopStock();
    const S = sim.add('smoke_shop', 'Smokeshop', null);
    const buyer = S.state;

    // stand at the counter with money to burn
    const keeper = sim.npcs.find(n => !n.dead && game.NPCS[n.id].shop === shop.id);
    ok(!!keeper, keeper ? `${game.NPCS[keeper.id].name} keeps the ${shop.id}` : 'nobody keeps the forge');
    if (keeper) {
      buyer.player.x = buyer.player.ix = keeper.x;
      buyer.player.y = buyer.player.iy = keeper.y;
    }
    state.addItem(buyer, 'coins', 100000000);

    const [item, base] = shop.stock.find(([, n]) => n > 0 && n < 20);
    ok(stock.count(shop.id, item) === base,
       `the ${shop.id} opens with ${base} × ${game.ITEMS[item].name}, as written`);

    // clear the shelf, one at a time, and then ask for one more
    let got = 0;
    for (let i = 0; i < base; i++) {
      got += buy(buyer, shop, item, 1, stock).bought;
    }
    ok(got === base, `bought all ${base} of them`);
    ok(stock.count(shop.id, item) === 0, 'and the shelf is empty');

    const after = buy(buyer, shop, item, 1, stock);
    ok(after.bought === 0, 'the next one is refused rather than conjured');

    // asking for ten when there are two gets two, not ten
    stock.give(shop.id, item, 2);
    const grab = buy(buyer, shop, item, 10, stock);
    ok(grab.bought === 2, `asking for ten of two got ${grab.bought}`);

    /*
     * Selling puts it back. Three calls rather than one because bars do not
     * stack, so a slot holds exactly one and `sell(..., 3)` can only ever take
     * what that slot has - the same as the panel's "sell all" on a single item.
     */
    const held = state.invCount(buyer, item);
    for (let i = 0; i < 3; i++) {
      sell(buyer, shop, buyer.inventory.findIndex(s => s && s.id === item), 1, stock);
    }
    ok(stock.count(shop.id, item) === 3, 'three sold back are three on the shelf');
    ok(state.invCount(buyer, item) === held - 3, 'and they left the pack');

    /*
     * One clock for every drift from here on. `drift` only fires when enough
     * ticks have passed since the last one, so a loop that restarts its own
     * count silently does nothing at all.
     */
    let clock = 0;
    const restock = rounds => {
      let fired = 0;
      for (let i = 0; i < rounds; i++) { clock += RESTOCK_TICKS; if (stock.drift(clock)) fired++; }
      return fired;
    };

    // back up to what the shop is meant to keep
    const climbed = restock(base + 4);
    ok(stock.count(shop.id, item) === base,
       `restocked to ${base} after ${climbed} restock(s)`);

    // and down again, from the other side
    stock.give(shop.id, item, 40);
    restock(60);
    ok(stock.count(shop.id, item) === base, 'and a shelf piled too high settles back down');

    /*
     * `['bones', 0]` is written as nothing-in-stock on purpose: bones are junk
     * creatures drop, wanted by no recipe and no quest, so the store only has
     * any because somebody sold theirs. Buying them was free Vigil experience
     * for as long as the shelf meant nothing.
     */
    const gen = game.SHOPS.general;
    if (gen.stock.some(([id]) => id === 'bones')) {
      ok(stock.count('general', 'bones') === 0, 'the general store has no bones of its own');
      ok(buy(buyer, gen, 'bones', 1, stock).bought === 0, 'so none can be bought');
      stock.give('general', 'bones', 4);
      ok(buy(buyer, gen, 'bones', 1, stock).bought === 1, 'until somebody sells some');
      restock(6);
      ok(stock.count('general', 'bones') === 0, 'and then they go again');
    }

    sim.sessions.delete('smoke_shop');
  }

  /*
   * The shelf is one shelf. Somebody else buying the last antivenin is a change
   * this player was not present for, so it cannot be announced as it happens -
   * it is reconciled against what each player was last told, the same way a
   * stump that grew back while nobody watched is.
   */
  head('One shelf, shared: what you buy, the next nurse sees');
  {
    const one = sim.add('smoke_shop_1', 'Shopone', null);
    const two = sim.add('smoke_shop_2', 'Shoptwo', null);
    const keeper = sim.npcs.find(n => !n.dead && game.NPCS[n.id].shop === 'forge');
    for (const s of [one, two]) {
      s.state.player.x = s.state.player.ix = keeper.x;
      s.state.player.y = s.state.player.iy = keeper.y + 1;
      state.addItem(s.state, 'coins', 500000);
    }

    /** What this player's next snapshot would say about the forge, if anything. */
    const told = s => {
      s.outbox.length = 0;
      sim.buildSnapshot(s);
      const snap = s.outbox.find(m => m.t === 'snap');
      const sh = (snap.shops || []).find(x => x.id === 'forge');
      return sh ? Object.fromEntries(sh.stock) : null;
    };

    const standing = sim.stock.count('forge', 'ironblood_bar');
    const first = told(two);
    ok(first && first.ironblood_bar === standing,
       `standing at the counter, two is told the forge has ${standing} bars`);
    ok(told(two) === null, 'and is not told again every tick while nothing moves');

    // the other nurse buys, through the real handler, range check and all
    sim.handle(one, { t: 'buy', shop: 'forge', item: 'ironblood_bar', n: 3 });
    ok(sim.stock.count('forge', 'ironblood_bar') === standing - 3,
       'the other nurse takes three off the shelf');

    const after = told(two);
    ok(after && after.ironblood_bar === standing - 3,
       'and two is told about it, having done nothing at all');
    ok(told(two) === null, 'once, not for ever');

    sim.sessions.delete('smoke_shop_1');
    sim.sessions.delete('smoke_shop_2');
  }

  /* ---- quantities mean quantities -------------------------- */

  /*
   * "Deposit 5" of something that does not stack used to deposit one, because
   * five ironblood ore is five slots holding one each and the ceiling was the
   * clicked slot's own count. Selling had that and a second fault: it removed
   * by item id from the top of the pack, so the slot that emptied was never the
   * slot that was clicked.
   */
  head('Five of something means five, stacked or not');
  {
    const S = sim.add('smoke_qty', 'Smokeqty', null);
    const st = S.state;
    const bulk = 'ironblood_ore';            // does not stack
    const stackable = 'coins';

    /** A clean pack: n of the bulk item, in known slots, nothing else. */
    const load = n => {
      for (let i = 0; i < st.inventory.length; i++) st.inventory[i] = null;
      st.bank.length = 0;
      state.addItem(st, bulk, n);
      return st.inventory.map((s, i) => (s && s.id === bulk ? i : -1)).filter(i => i >= 0);
    };

    ok(!game.ITEMS[bulk].stack, `${game.ITEMS[bulk].name} does not stack`);

    // -- the bank --
    let slots = load(5);
    state.bankDeposit(st, slots[0], 5);
    ok(state.invCount(st, bulk) === 0, 'depositing 5 of 5 leaves none in the pack');
    ok(st.bank[0]?.n === 5, 'and puts 5 in the vault');

    slots = load(5);
    state.bankDeposit(st, slots[2], 2);
    ok(state.invCount(st, bulk) === 3, 'depositing 2 of 5 leaves 3');
    ok(st.inventory[slots[2]] === null, 'and it is the slot that was clicked that empties');
    ok(!!st.inventory[slots[0]] && !!st.inventory[slots[1]],
       'the ones above it are left alone');
    ok(st.inventory[slots[3]] === null, 'and the shortfall comes from below it');

    // and wraps back to the top when there is not enough below
    slots = load(5);
    state.bankDeposit(st, slots[4], 3);
    ok(state.invCount(st, bulk) === 2, 'clicking the last of 5 and asking for 3 leaves 2');
    ok(st.inventory[slots[4]] === null && st.inventory[slots[0]] === null &&
       st.inventory[slots[1]] === null, 'having wrapped round to the top for the rest');

    // -- the shop --
    const shop = game.SHOPS.general;
    slots = load(5);
    const coinsBefore = state.invCount(st, stackable);
    const sold = sell(st, shop, slots[3], 4, null);
    ok(sold.sold === 4, `selling 4 of 5 sold ${sold.sold}`);
    ok(state.invCount(st, bulk) === 1, 'and one is left');
    ok(st.inventory[slots[3]] === null, 'the clicked slot went first');
    ok(state.invCount(st, stackable) === coinsBefore + sold.price * 4,
       'and the money is for four of them');

    // asking for more than you have is not an error, it is however many you had
    slots = load(3);
    ok(sell(st, shop, slots[0], 99, null).sold === 3, 'asking to sell 99 of 3 sells 3');

    // -- and a stackable is still one slot, taken from that slot --
    for (let i = 0; i < st.inventory.length; i++) st.inventory[i] = null;
    st.bank.length = 0;
    state.addItem(st, stackable, 5000);
    const coinSlot = st.inventory.findIndex(s => s && s.id === stackable);
    state.bankDeposit(st, coinSlot, 1200);
    ok(state.invCount(st, stackable) === 3800, 'depositing 1200 of 5000 coins leaves 3800');
    ok(st.bank[0]?.n === 1200, 'and banks 1200');

    // -- removeFrom on its own, since three counters lean on it --
    slots = load(4);
    ok(state.removeFrom(st, slots[1], 3) === 3, 'removeFrom takes what it is asked for');
    ok(state.invCount(st, bulk) === 1, 'leaving the rest');
    ok(state.removeFrom(st, slots[1], 3) === 0, 'and an empty slot yields nothing');

    /*
     * A quantity that is not a whole positive number takes nothing. The wire
     * cannot deliver one - sim.js runs every count through int() - but a NaN
     * reaching the arithmetic would not throw, it would bank NaN of something
     * and leave the vault entry broken for good, and 1.7 would leave fractional
     * coins in the pack. Cheaper to refuse it here than to trust four callers.
     */
    for (let i = 0; i < st.inventory.length; i++) st.inventory[i] = null;
    st.bank.length = 0;
    state.addItem(st, stackable, 1000);
    const cs = st.inventory.findIndex(s => s && s.id === stackable);
    // `undefined` is left out on purpose: that is the default argument, and one
    // is the right answer. `Infinity` is left out too - it means all of them.
    for (const bad of [NaN, 'abc', -5, 0, null]) state.bankDeposit(st, cs, bad);
    ok(state.invCount(st, stackable) === 1000,
       'a count that is not a whole positive number moves nothing');
    ok(st.bank.length === 0, 'and leaves no broken entry in the vault');

    state.bankDeposit(st, cs, 2.7);
    ok(state.invCount(st, stackable) === 998 && st.bank[0]?.n === 2,
       'and 2.7 of something banks 2, not 2.7');

    sim.sessions.delete('smoke_qty');
  }

  /* ---- company --------------------------------------------- */

  /*
   * A companion is the only creature in the game that is not part of the world:
   * she is conjured per session, walks to heel, fights nothing, and has to
   * disappear when her owner does. Every one of those is a way to leak a
   * creature into the ward permanently, so all of them are checked here.
   */
  head('A thousand coins buys company, and the locket shuts again');
  {
    const { cheb } = await import('../js/util.js');
    const combat = await import('../js/game/combat.js');
    const companions = Object.values(game.NPCS).filter(n => n.companion);
    const lockets = Object.values(game.ITEMS).filter(i => i.companion);
    ok(companions.length > 0, `${companions.length} companion(s) defined`);

    // both directions, so neither a companion nobody can fetch nor a locket
    // naming somebody who was renamed out from under it can survive a run
    for (const c of companions) {
      ok(lockets.some(i => i.companion === c.id), `${c.name} has a locket that fetches her`);
    }
    for (const i of lockets) {
      ok(!!game.NPCS[i.companion]?.companion, `${i.name} names a companion that exists`);
    }
    // she must not also be scattered across the map: a companion standing in the
    // Fen on her own would be counted by every density check as a creature
    for (const c of companions) {
      ok(!world.npcSpawns.some(s => s.npc === c.id), `${c.name} is not spawned into the world`);
      ok(!sim.npcs.some(n => n.id === c.id), 'and is not part of the population at boot');
    }

    const locket = lockets[0];
    const shopId = Object.keys(game.SHOPS)
      .find(id => game.SHOPS[id].stock.some(([it]) => it === locket.id));
    ok(!!shopId, `${locket.name} is on a shelf (${shopId})`);
    const keeper = sim.npcs.find(n => !n.dead && game.NPCS[n.id].shop === shopId);
    ok(!!keeper, `and somebody stands behind it at ${keeper?.x}, ${keeper?.y}`);
    const reg = world.regionAt(keeper.x, keeper.y);
    ok(!!reg?.safe, `in ${reg?.name}, which is a safe region`);
    ok(game.shops.buyPrice(game.SHOPS[shopId], locket.value) === 1000,
       'and the price is a round thousand coins');

    const her = sim.add('smoke_gf', 'Smokegf', null);
    const p = her.state.player;
    p.x = p.ix = keeper.x; p.y = p.iy = keeper.y + 1;

    // bought through the real handler, so the range check and the shelf count
    state.addItem(her.state, 'coins', 1000);
    sim.handle(her, { t: 'buy', shop: shopId, item: locket.id, n: 1 });
    const idx = her.state.inventory.findIndex(s => s && s.id === locket.id);
    ok(idx >= 0, 'a nurse with exactly a thousand coins can buy one');
    ok(state.invCount(her.state, 'coins') === 0, 'and it costs her all of it');

    sim.handle(her, { t: 'use', idx });
    const pet = sim.petOf(her);
    ok(!!pet, 'opening the locket puts her in the world');
    ok(her.state.pet === locket.companion, 'and the save knows who is out');
    ok(pet && cheb(pet.x, pet.y, p.x, p.y) <= 3, 'she arrives beside you, not across the ward');
    ok(pet && pet.uid < 0, `her uid is negative (${pet?.uid}), so no world creature shares it`);

    /*
     * The doorway question. Companions must block nothing: shopkeepers occupy
     * their tile and a follower who did the same could wedge her owner into a
     * corner they cannot walk out of.
     */
    ok(!combat.npcAt({ npcs: sim.npcs }, pet.x, pet.y), 'she occupies no tile as far as the world is concerned');
    ok(!combat.tileBlocked(her.state, pet.x, pet.y), 'and nothing is blocked by standing where she stands');

    // she cannot be fought, whatever a client asks for
    const before = { ...pet };
    sim.handle(her, { t: 'attack', u: pet.uid });
    ok(her.state.target === null, 'asking to attack her does nothing');
    ok(pet.x === before.x && pet.y === before.y, 'and she is not moved by being asked');

    // she can be spoken to, which needs the uid to resolve outside npcByUid
    her.outbox.length = 0;
    sim.handle(her, { t: 'talk', u: pet.uid });
    for (let i = 0; i < 4; i++) sim.step();
    ok(her.outbox.some(m => m.t === 'dialogue' && m.text), 'and she can be spoken to');

    /* she is drawn by whatever draws every other creature */
    her.outbox.length = 0;
    sim.buildSnapshot(her);
    const snap = her.outbox.find(m => m.t === 'snap');
    ok(snap.npcs.some(n => n.u === pet.uid && n.i === pet.id),
       'she rides in the snapshot alongside the creatures, so the same painter draws her');

    /*
     * Following, on the open road through Lumbrisdale so the distance is the
     * only thing being measured. Both ends are pinned: talking to her queues a
     * walk towards her, and a nurse still drifting along a stale path while the
     * gap is measured makes this check say whatever it likes.
     */
    her.state.action = null;
    her.state.target = null;
    p.path.length = 0;
    p.x = p.ix = 44; p.y = p.iy = 152;
    pet.x = 34; pet.y = 152; pet.path = [];
    let gap = cheb(pet.x, pet.y, p.x, p.y);
    ok(gap === 10, `ten tiles apart on the ward road (gap ${gap})`);
    /*
     * Ten tiles in six ticks is only possible at two steps a tick. At one - the
     * rate every creature in the game moves - she would still be four tiles back
     * here, and against a nurse who keeps running she would drift out to the
     * twelve-tile limit and teleport, over and over, for the whole journey.
     */
    for (let i = 0; i < 6; i++) sim.step();
    gap = cheb(pet.x, pet.y, p.x, p.y);
    ok(gap <= 2, `she closes it at a run within six ticks (gap ${gap})`);

    /* a teleport is further than anyone can walk in a tick */
    p.x = p.ix = 92; p.y = p.iy = 71;                 // the wayside altar
    sim.step();
    gap = cheb(pet.x, pet.y, p.x, p.y);
    ok(gap <= 3, `and a teleport across the Throat does not lose her (gap ${gap})`);

    /* the locket is a toggle, not a purchase */
    const idx2 = her.state.inventory.findIndex(s => s && s.id === locket.id);
    sim.handle(her, { t: 'use', idx: idx2 });
    ok(sim.petOf(her) === null, 'shutting the locket sends her away');
    ok(her.state.pet === null, 'and the save agrees');
    ok(her.state.inventory.some(s => s && s.id === locket.id), 'the locket is not spent');

    /* she comes back with you */
    sim.handle(her, { t: 'use', idx: idx2 });
    const saved = state.serialize(her.state);
    ok(saved.pet === locket.companion, 'a save written now remembers her');
    const reloaded = state.deserialize(saved);
    ok(reloaded.pet === locket.companion, 'and reading it back brings her out again');
    ok(state.deserialize({ ...saved, pet: 'nobody_by_that_name' }).pet === null,
       'while a save naming somebody who no longer exists quietly forgets her');

    /*
     * The leak that matters. A dropped connection removes the session without
     * anybody shutting the locket, and a companion left behind would stand in
     * the ward for the rest of the server's life.
     */
    ok(sim.petOf(her) !== null, 'she is out when the connection drops');
    sim.sessions.delete('smoke_gf');
    sim.step();
    ok(sim.pets.length === 0, 'and the next tick clears her rather than leaving her standing there');
  }

  /* ---- nothing exists that cannot be got ------------------- */

  /*
   * An item that can be worn, priced and drawn but obtained by no route at all
   * is invisible to every other check here: it validates, it renders, it
   * equips. The canvas ward sat like that from the beginning - armourSet()
   * makes a ward for every non-magic set, and the sewing table had only ever
   * learned three of the canvas pieces.
   *
   * KNOWN_UNOBTAINABLE is a ratchet, not an excuse. It may only get shorter
   * without somebody editing this list on purpose, so a pack cannot quietly
   * add a fourteenth.
   */
  const KNOWN_UNOBTAINABLE = new Set([
    // the ranged style is unfinished: a tier ladder of launchers, and the
    // armour that goes with them, none of it made or sold anywhere
    'dart_bandolier', 'bile_blowpipe', 'gasper_bow',
    'leather_helm', 'leather_body', 'leather_legs',
    'leather_gloves', 'leather_boots', 'leather_ward',
    'rod_reknitting',                 // the anatomancy equivalent
    'amulet_mercy', 'recall_ring'     // uniques, waiting for something to award them
  ]);
  /*
   * Not on that list because this check is about things you wear: mercy_key and
   * anatomy_notes are quest items with no slot, and nothing in the game
   * references either of them - no dialogue hands them over and no step wants
   * them. They are groundwork for content never written, and harmless.
   */

  head('Nothing can be worn that cannot be got');
  {
    const source = new Map();
    const note = (id, how) => {
      if (!game.ITEMS[id]) return;
      if (!source.has(id)) source.set(id, new Set());
      source.get(id).add(how);
    };

    for (const s of Object.values(game.SHOPS)) for (const [id] of s.stock) note(id, 'shop');
    for (const list of Object.values(game.RECIPES)) for (const r of list) note(r.out, 'recipe');
    for (const n of Object.values(game.NPCS)) for (const d of n.drops || []) note(d.id, 'drop');
    for (const o of Object.values(game.OBJ)) {
      if (o.yield) note(o.yield, 'gathered');
      if (o.extra?.id) note(o.extra.id, 'gathered');
    }
    for (const q of Object.values(game.quests.QUESTS)) {
      for (const it of q.rewards?.items || []) note(Array.isArray(it) ? it[0] : it.id, 'quest');
      for (const st of q.steps || []) if (st?.item) note(st.item, 'quest');
    }
    // handed over in dialogue, which only the source text knows about
    const questSrc = await readFile(rel('js/data/quests.js'), 'utf8');
    for (const m of questSrc.matchAll(/give\(\s*['"]([a-z0-9_]+)/g)) note(m[1], 'quest');
    note('burnt_offering', 'the range, on a bad day');

    const orphans = Object.values(game.ITEMS)
      .filter(i => i.slot && !source.has(i.id))
      .map(i => i.id);

    const fresh = orphans.filter(id => !KNOWN_UNOBTAINABLE.has(id));
    ok(!fresh.length, fresh.length
      ? `no way to obtain: ${fresh.map(id => game.ITEMS[id].name).join(', ')}`
      : `every one of ${Object.values(game.ITEMS).filter(i => i.slot).length} wearable items has a way in, bar ${orphans.length} known`);

    // and the list may not rot: anything on it that became obtainable comes off
    const stale = [...KNOWN_UNOBTAINABLE].filter(id => game.ITEMS[id] && source.has(id));
    ok(!stale.length, stale.length
      ? `now obtainable, so take them off the known list: ${stale.join(', ')}`
      : 'and the known list has nothing stale on it');
  }

  /* ---- saves still load ------------------------------------ */

  head('Saves survive the new content');
  const saved = A.serialize();
  const round = state.deserialize(JSON.parse(JSON.stringify(saved)));
  ok(round.inventory.filter(Boolean).length === saved.inventory.filter(Boolean).length,
     'a save written now reads back with the same pack');
  ok(Object.keys(round.skills).length >= Object.keys(saved.skills).length,
     'and the same skills');

  return fails;
}

/** Every attack bonus an item carries, added up. */
function sumAttack(item) {
  return ['aStab', 'aSlash', 'aCrush', 'aRange', 'aMagic']
    .reduce((a, k) => a + (item.b?.[k] || 0), 0);
}

/** A walkable tile cardinally beside this one, if there is one. */
function beside(world, x, y) {
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (world.isWalkable(x + dx, y + dy)) return { x: x + dx, y: y + dy };
  }
  return null;
}

/** Clicks "continue" through a dialogue until it closes. */
function clickThrough(sim, session, limit) {
  for (let i = 0; i < limit; i++) {
    const last = [...session.outbox].reverse().find(m => m.t === 'dialogue');
    if (!last || last.close) return;
    session.outbox.length = 0;
    // take the first option, which is always the one that gets on with it
    sim.handle(session, { t: 'dialogue', choice: last.opts?.length ? 0 : null });
    sim.step();
  }
}

/* ============================================================
   The real server, over a real socket
   ============================================================ */

async function serverTest() {
  head('The real server boots and serves a real client');
  const port = 8300 + (process.pid % 400);
  const dir = rel('.smoke-data');

  const proc = spawn(process.execPath, [rel('server/server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });

  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await sleep(250);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`);
        up = r.ok;
      } catch { /* not yet */ }
    }
    ok(up, up ? `server answering on ${port}` : `server never came up:\n${log}`);
    if (!up) return;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const seen = [];
    ws.addEventListener('message', e => { try { seen.push(JSON.parse(e.data)); } catch {} });
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
      setTimeout(rej, 5000);
    });

    const name = 'Smoke' + (process.pid % 1000);
    ws.send(JSON.stringify({ t: 'register', name, password: 'smoke test password' }));

    const waitFor = async t => {
      for (let i = 0; i < 60; i++) {
        const m = seen.find(x => x.t === t);
        if (m) return m;
        await sleep(200);
      }
      return null;
    };

    const auth = await waitFor('auth');
    ok(!!auth, auth ? `registered as ${auth.name}` : `no auth reply: ${JSON.stringify(seen.slice(0, 3))}`);
    const init = await waitFor('init');
    ok(!!init, 'received the world');
    const snap = await waitFor('snap');
    ok(!!snap, `receiving snapshots (tick ${snap?.k})`);

    const hello = seen.find(x => x.t === 'hello');
    ok(!!hello, 'greeted, with ' + (hello?.patch ? `patch notes at ${hello.patch.latest}` : 'no patch notes'));

    // walk somewhere and check the server moves us
    if (init) {
      ws.send(JSON.stringify({ t: 'move', x: init.pos.x + 4, y: init.pos.y }));
      await sleep(4000);
      const last = [...seen].reverse().find(x => x.t === 'snap');
      ok(last && last.self.x !== init.pos.x, `walked from ${init.pos.x} to ${last?.self.x}`);
    }

    ws.close();
    await sleep(300);
  } finally {
    proc.kill('SIGTERM');
    await sleep(600);
    proc.kill('SIGKILL');
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ---------------- command line ------------------------------ */

const arg = process.argv[2];
let candidate = null;
if (arg && !arg.startsWith('--')) {
  candidate = JSON.parse(await readFile(rel(arg.replace(/^\.\//, '')), 'utf8'));
  say(`smoke testing ${candidate.title} (${candidate.id})`);
}

await playtest(candidate);
if (!process.argv.includes('--no-server')) await serverTest();

say('\n' + (fails ? `${fails} CHECK(S) FAILED` : 'ALL SMOKE CHECKS PASSED'));
process.exit(fails ? 1 : 0);

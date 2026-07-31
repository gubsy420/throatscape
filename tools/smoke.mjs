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

  const newRecipes = packs.flatMap(p => p.recipes || []);
  if (newRecipes.length) {
    head('New recipes can be made');
    const { findRecipe } = await import('../js/game/economy.js');
    for (const r of newRecipes) {
      const recipe = findRecipe(r.station, r.out);
      if (!recipe) { ok(false, `no recipe for ${r.out} at the ${r.station}`); continue; }

      // stand at a station of the right kind with the ingredients in hand
      const wanted = { smelting: 'furnace', forging: 'anvil', apothecary: 'cauldron',
                       suturing: 'sewing_table', cooking: 'cook_range' }[r.station];
      const station = world.objects.find(o => o.type === wanted);
      equip(A);
      const p = A.state.player;
      const spot = beside(world, station.x, station.y) || { x: station.x, y: station.y + 1 };
      p.x = p.ix = spot.x; p.y = p.iy = spot.y;
      for (const [id, n] of Object.entries(recipe.need)) state.addItem(A.state, id, n * 2);

      const before = state.invCount(A.state, r.out);
      sim.handle(A, { t: 'craft', station: r.station, out: r.out, qty: 1 });
      for (let i = 0; i < 40; i++) sim.step();
      ok(state.invCount(A.state, r.out) > before,
         `${game.ITEMS[r.out]?.name || r.out} made at the ${wanted}`);
    }
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

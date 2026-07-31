/* ============================================================
   Quest playthrough
   ------------------------------------------------------------
   Plays the hand-written campaign end to end against the real
   simulation: talks to every giver through the real dialogue
   trees, and checks that everything each quest asks for is
   actually in the world and actually reachable.

   This exists because a quest can be broken in a way nothing
   else notices. The dialogue can send you somewhere that does
   not exist. A drop can be named that no creature carries. A
   content pack can add a step that claims a kill before the
   quest that was waiting for it. None of that stops the server
   booting, and none of it shows up in a diff.

   Usage:  node tools/quests.mjs
   ============================================================ */

import { loadGame, say } from './lib.mjs';

let fails = 0;
const ok = (c, m) => { say((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const head = m => say('\n== ' + m);

const game = await loadGame();
const { Sim } = await import('../server/sim.js');
const state = await import('../js/game/state.js');
const { makeQuestApi, questHook } = await import('../js/game/questapi.js');
const { QUESTS, DONE } = game.quests;

const sim = new Sim(null);
const world = sim.world;
const S = sim.add('questcheck', 'Questcheck', null);
const st = S.state;
const g = makeQuestApi(st);

/* A nurse who meets every requirement, so this tests the quests and not the
   grind that leads to them. */
for (const id of Object.keys(st.skills)) st.skills[id].xp = 4000000;
st.player.maxHp = st.player.hp = 500;
st.vigil.max = 99;
st.vigil.points = 99;

const spotOf = id => world.npcSpawns.find(s => s.npc === id);
const stand = (x, y) => { st.player.x = st.player.ix = x; st.player.y = st.player.iy = y; };

/** Walks up to an NPC and clicks through their dialogue, taking option one. */
function talk(npcId) {
  const spot = spotOf(npcId);
  if (!spot) { ok(false, `${npcId} is nowhere in the world`); return false; }
  const npc = sim.npcs.find(n => n.id === npcId);
  stand(spot.x, spot.y + 1);
  S.outbox.length = 0;
  sim.handle(S, { t: 'talk', u: npc.uid });
  for (let i = 0; i < 8; i++) sim.step();

  for (let i = 0; i < 24; i++) {
    const node = [...S.outbox].reverse().find(m => m.t === 'dialogue');
    if (!node || node.close) break;
    S.outbox.length = 0;
    sim.handle(S, { t: 'dialogue', choice: node.opts?.length ? 0 : null });
    sim.step();
  }
  return true;
}

function use(objType, x, y) {
  stand(x, y + 1);
  sim.handle(S, { t: 'interact', x, y });
  for (let i = 0; i < 20; i++) sim.step();
}

/** Rolls a random-chance hook until it pays out, so a flaky drop is not a flaky test. */
function grind(questId, stage, npcId, limit = 500) {
  let n = 0;
  while (g.stage(questId) === stage && n < limit) { questHook(g, 'onKill', npcId); n++; }
  return n;
}

const held = id => state.invCount(st, id) > 0 || st.ground.some(x => x.id === id);

/* ============================================================ */

head('Ward Duties');
talk('orderly_punn');
ok(g.stage('ward_duties') === 1, 'Orderly Punn starts it');
state.addItem(st, 'gauze_wrap', 5);
for (let i = 0; i < 3; i++) questHook(g, 'onUseOnNpc', 'gauze_wrap', 'patient_row');
ok(g.stage('ward_duties') === 2, 'three bedbound patients can be dressed');
ok(world.npcSpawns.filter(s => s.npc === 'patient_row').length >= 3,
   `and there are ${world.npcSpawns.filter(s => s.npc === 'patient_row').length} of them to dress`);
talk('matron_vell');
ok(g.stage('ward_duties') >= DONE, 'Matron Vell signs it off');

head('The Ledger Lies');
talk('matron_vell');
ok(g.stage('ledger_lies') === 1, 'Vell starts it');
const crate = world.objects.find(o => o.type === 'crate' && o.x >= 120);
ok(!!crate, crate ? `a searchable crate stands in Vellumhaven at ${crate.x},${crate.y}`
                  : 'NO crate east of x=120 — the ledger cannot be found');
if (crate) use('crate', crate.x, crate.y);
ok(g.stage('ledger_lies') === 2, 'the ward ledger turns up in it');
talk('matron_vell');
ok(g.stage('ledger_lies') >= DONE, 'and Vell burns it');

head('Passage to the Fen');
talk('fenwarden_gob');
ok(g.stage('fen_passage') === 1, 'Fenwarden Gob starts it');
ok(world.npcSpawns.some(s => s.npc === 'bile_slug'), 'bile slugs exist to be dealt with');
for (let i = 0; i < 5; i++) questHook(g, 'onKill', 'bile_slug');
state.addItem(st, 'lint', 10);
talk('fenwarden_gob');
ok(g.stage('fen_passage') >= DONE, 'and he stamps the permit');
ok(held('fen_permit'), 'the permit is real');

head('The Long Vigil');
talk('sister_ambrose');
ok(g.stage('long_vigil') === 1, 'Sister Ambrose starts it');

/*
 * She asks for three watches in three places. That is only possible if there
 * are altars in three places - and for a long time there were only two, both
 * of them chapels, while she sent you looking for "one more that is not in a
 * chapel at all".
 */
const altars = world.objects.filter(o => o.type === 'altar');
const places = new Set(altars.map(a => world.regionAt(a.x, a.y)?.id));
ok(places.size >= 3,
   `altars stand in ${places.size} separate places: ${[...places].join(', ')}`);

const chapel = altars.filter(a => world.regionAt(a.x, a.y)?.id === 'uvula');
for (const a of chapel) use('altar', a.x, a.y);
ok(g.stage('long_vigil') === 1,
   `${chapel.length} altars in one chapel counts as one watch, not three`);

for (const a of altars) {
  if (g.stage('long_vigil') !== 1) break;
  use('altar', a.x, a.y);
}
ok(g.stage('long_vigil') === 2,
   `three watches kept, in ${JSON.stringify(g.q('long_vigil').set)}`);

ok(world.npcSpawns.some(s => s.npc === 'bog_spinner'), 'bog spinners live in the Fen');
const spinners = grind('long_vigil', 2, 'bog_spinner');
ok(g.stage('long_vigil') === 3, `the tonsil charm is recoverable (took ${spinners} spinners)`);
ok(held('tonsil_charm'), 'and it lands in the pack');
talk('sister_ambrose');
ok(g.stage('long_vigil') >= DONE, 'Ambrose finally sleeps');
ok(held('vigil_pendant'), 'and hands over the pendant');

head('The Choking Matron');
talk('matron_vell');
ok(g.stage('choking_matron') >= 1, 'Vell starts it');
talk('tomas');
ok(g.stage('choking_matron') >= 2, 'Tomas the Unclosed points at the monks');
ok(world.npcSpawns.some(s => s.npc === 'plague_monk'), 'plague monks are in the Heights');
const monks = grind('choking_matron', 2, 'plague_monk');
ok(g.stage('choking_matron') === 3, `three seals are collectable (took ${monks} monks)`);
talk('sister_ambrose');
ok(g.stage('choking_matron') === 4, 'Ambrose works them into the lozenge');
ok(held('xavins_lozenge'), 'and it is in hand');
ok(world.npcSpawns.some(s => s.npc === 'choking_matron'), 'the Matron waits in the Larynx Deep');
questHook(g, 'onKill', 'choking_matron');
ok(g.stage('choking_matron') === 5, 'she can be relieved');
talk('matron_vell');
ok(g.stage('choking_matron') >= DONE, 'and Vell hears it first-hand');
ok(held('matrons_cape'), 'the cape is handed over');

/* ---------------- everything, in the end -------------------- */

head('Every giver stands where their quest says they do');

/*
 * A quest giver in two places is a trap. Ambrose used to stand in the Uvula
 * chapel and in the Vellumhaven Guild of Physicians, and the copy in the guild
 * would happily start the Long Vigil and then tell you to keep watch at the
 * altar "here" — in a room containing two cauldrons and a sewing table.
 * Shopkeepers and bankers are services and may be in both towns.
 */
const givers = new Map();
for (const [tree, def] of Object.entries(game.quests.DIALOGUE)) {
  const src = Object.values(def.nodes || {})
    .flatMap(n => [n.act, n.text, ...(n.opts || []).map(o => o.act)])
    .filter(f => typeof f === 'function').map(String).join(' ');
  const starts = [...src.matchAll(/startQuest\(\s*'([a-z0-9_]+)'/g)].map(m => m[1]);
  if (def.quest) starts.push(def.quest);
  if (!starts.length) continue;
  const npc = Object.values(game.NPCS).find(n => n.talk === tree);
  if (npc) givers.set(npc.id, { npc, quests: [...new Set(starts)] });
}

for (const [id, { npc, quests }] of givers) {
  const spots = world.npcSpawns.filter(s => s.npc === id);
  ok(spots.length > 0, `${npc.name} is in the world`);
  if (npc.shop || npc.bank) continue;             // services may be in both towns
  ok(spots.length === 1,
     spots.length === 1
       ? `${npc.name} stands in exactly one place (${spots[0].x},${spots[0].y})`
       : `${npc.name} is spawned ${spots.length} times — a quest giver in two places sends players to the wrong one: ` +
         spots.map(s => `${s.x},${s.y} in ${world.regionAt(s.x, s.y)?.name}`).join(' / '));
}

/*
 * Ambrose says "Lumbrisdale chapel, here, and one more that is not in a chapel
 * at all". "Here" has to be true wherever she is standing.
 */
for (const s of world.npcSpawns.filter(s => s.npc === 'sister_ambrose')) {
  const altar = world.objects.some(o => o.type === 'altar' &&
    Math.abs(o.x - s.x) <= 8 && Math.abs(o.y - s.y) <= 8);
  ok(altar, altar
    ? `Sister Ambrose has an altar within sight of her, as her dialogue claims`
    : `Sister Ambrose stands at ${s.x},${s.y} with no altar within 8 tiles, but tells you to keep watch "here"`);
}

head('Nothing is left unfinishable');
for (const q of QUESTS) {
  if (q.fromPack) continue;             // pack quests are the smoke test's job
  ok(g.stage(q.id) >= DONE, `${q.name}`);
}

// every reward a quest promises has to be a real item
for (const q of QUESTS) {
  for (const [id] of q.rewards?.items || []) {
    ok(!!game.ITEMS[id], `${q.name} rewards "${id}", which ${game.ITEMS[id] ? 'exists' : 'DOES NOT EXIST'}`);
  }
  for (const sk of Object.keys(q.rewards?.xp || {})) {
    ok(game.SKILLS.some(s => s.id === sk), `${q.name} rewards ${sk} experience`);
  }
}

say('\n' + (fails ? `${fails} PROBLEM(S) WITH THE CAMPAIGN` : 'the whole campaign can be played through'));
process.exit(fails ? 1 : 0);

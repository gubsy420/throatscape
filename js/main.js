/* ============================================================
   Throatscape - boot, input, and the game loop
   ============================================================ */

import { TICK_MS, clamp, lerp, cheb, escapeHtml } from './util.js';
import { buildWorld, OBJ, TILE_INFO, SPAWN } from './data/world.js';
import { NPCS } from './data/npcs.js';
import { ITEMS, itemName } from './data/items.js';
import { SPELL_BY_ID, VIGIL_BY_ID } from './data/magic.js';
import * as MagicData from './data/magic.js';
import {
  createState, deserialize, serialize, save, loadSave, clearSave,
  log, toast, floater, addXp, baseLevel, invCount, removeItem, hasItem, canHold
} from './game/state.js';
import {
  spawnNpcs, tickNpcs, tickPlayerEffects, playerAttackTick, npcAt,
  bindVigilData
} from './game/combat.js';
import {
  walkTo, movePlayer, tickAction, setAction, interactObject, pickUp,
  tickGround, tickResourceRespawn, tickDoors, useItemOn, clearAction
} from './game/actions.js';
import { makeQuestApi, questHook } from './game/questapi.js';
import { Renderer } from './engine/render.js';
import { Hud } from './ui/hud.js';
import { Panels } from './ui/panels.js';
import { Windows } from './ui/windows.js';
import { Net } from './net.js';

bindVigilData(MagicData);

const $ = s => document.querySelector(s);

/* ============================================================
   Boot
   ============================================================ */

const BOOT_STEPS = [
  'Warming the autoclave…',
  'Folding gauze…',
  'Mapping the Throat…',
  'Waking the patients…',
  'Counting the ledger…'
];

let world = null;

async function boot() {
  const fill = $('#boot-fill'), status = $('#boot-status');
  for (let i = 0; i < BOOT_STEPS.length; i++) {
    status.textContent = BOOT_STEPS[i];
    fill.style.width = ((i + 1) / (BOOT_STEPS.length + 1) * 100) + '%';
    if (i === 2) world = buildWorld();
    await frame(90);
  }
  if (!world) world = buildWorld();
  fill.style.width = '100%';
  await frame(180);
  $('#boot').hidden = true;
  showLogin();
}

const frame = ms => new Promise(r => setTimeout(r, ms));

function showLogin() {
  const login = $('#login');
  login.hidden = false;
  const nameInput = $('#login-name');
  const saved = loadSave();

  if (saved) {
    nameInput.value = saved.name || '';
    const cont = $('#btn-continue');
    cont.hidden = false;
    cont.textContent = `Continue as ${saved.name}`;
    cont.addEventListener('click', () => startGame(deserialize(saved)));
  }

  const begin = () => {
    const raw = nameInput.value.trim();
    if (!/^[A-Za-z][A-Za-z0-9 _-]{1,11}$/.test(raw)) {
      $('#login-error').textContent = 'Names are 2-12 characters and start with a letter.';
      return;
    }
    if (saved && saved.name !== raw) clearSave();
    const st = createState(raw);
    st.settings.multiplayer = $('#opt-multiplayer').checked;
    startGame(st, true);
  };

  $('#btn-play').addEventListener('click', begin);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') begin(); });
  nameInput.focus();
}

/* ============================================================
   Game
   ============================================================ */

function startGame(state, fresh) {
  $('#login').hidden = true;
  $('#game').hidden = false;

  state.settings.multiplayer = $('#opt-multiplayer').checked && state.settings.multiplayer !== false;

  const canvas = $('#view');
  const renderer = new Renderer(canvas, world);
  const hud = new Hud(state);
  const panels = new Panels(state, world, hud);
  const windows = new Windows(state, world, hud, panels);
  const net = new Net(state);

  spawnNpcs(state, world);
  renderer.lowDetail = state.settings.lowDetail;
  state.snapCam = true;

  const game = { state, world, renderer, hud, panels, windows, net };
  window.__throatscape = game;                 // handy in the console

  wireQuestHooks(state);
  wireInput(game);
  wireChat(game);
  wireSpells(game);
  wireSettings(game);

  if (fresh) {
    log(state, 'Welcome to Throatscape.', 'quest');
    log(state, 'You wake on a cot in the Mercy House with someone else\'s blood on your apron.', 'system');
    log(state, 'Speak to Orderly Punn to begin. Left-click to walk.', 'system');
    toast(state, `Welcome to Xavin's Throat, ${state.name}`);
  } else {
    log(state, `Welcome back, ${state.name}.`, 'quest');
  }

  if (state.settings.multiplayer) net.connect();

  /* autosave */
  setInterval(() => save(state), 30000);
  window.addEventListener('beforeunload', () => save(state));

  startLoop(game);
}

/* ---------------- quest hooks ------------------------------- */

function wireQuestHooks(state) {
  const g = makeQuestApi(state);
  state.bus.on('kill', ({ npcId }) => questHook(g, 'onKill', npcId));
}

/* ---------------- loop -------------------------------------- */

function startLoop(game) {
  const { state, world, renderer, hud, net } = game;
  let last = performance.now();
  let acc = 0;
  let lastRegion = null;

  function tick() {
    state.tick++;

    /* remember pre-tick positions so rendering can interpolate */
    const p = state.player;
    p.ix = p.x; p.iy = p.y;
    for (const n of state.npcs) { n.ix = n.x; n.iy = n.y; }
    for (const o of state.others.values()) { o.ix = o.rx; o.iy = o.ry; }

    movePlayer(state, world);
    tickAction(state, world, game);
    playerAttackTick(state, world);
    tickNpcs(state, world);
    tickPlayerEffects(state);
    tickGround(state);
    tickResourceRespawn(state, world);
    tickDoors(state, world);

    if (state.tick % 100 === 0) state.playtime += 60;
    net.pushPosition();

    /* chat bubbles fade on the tick clock */
    if (p.chat && --p.chat.ttl <= 0) p.chat = null;
    for (const o of state.others.values()) {
      if (o.chat && --o.chat.ttl <= 0) o.chat = null;
    }
  }

  function loop(now) {
    const dt = Math.min(now - last, 250);
    last = now;
    acc += dt;
    while (acc >= TICK_MS) { acc -= TICK_MS; tick(); }

    const alpha = clamp(acc / TICK_MS, 0, 1);

    /* interpolate render positions */
    const p = state.player;
    p.rx = lerp(p.ix ?? p.x, p.x, alpha);
    p.ry = lerp(p.iy ?? p.y, p.y, alpha);
    for (const n of state.npcs) {
      n.rx = lerp(n.ix ?? n.x, n.x, alpha);
      n.ry = lerp(n.iy ?? n.y, n.y, alpha);
    }
    for (const o of state.others.values()) {
      o.rx = lerp(o.ix ?? o.x, o.x, alpha);
      o.ry = lerp(o.iy ?? o.y, o.y, alpha);
    }

    /* transient visual timers run on frames, not ticks */
    for (let i = state.hitsplats.length - 1; i >= 0; i--) {
      if (--state.hitsplats[i].ttl <= 0) state.hitsplats.splice(i, 1);
    }
    for (let i = state.floaters.length - 1; i >= 0; i--) {
      if (--state.floaters[i].ttl <= 0) state.floaters.splice(i, 1);
    }
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const pr = state.projectiles[i];
      const t = 1 - pr.ttl / pr.life;
      pr.x = lerp(pr.x, pr.tx, 0.35);
      pr.y = lerp(pr.y, pr.ty, 0.35);
      if (--pr.ttl <= 0) state.projectiles.splice(i, 1);
    }
    if (state.moveMarker && --state.moveMarker.ttl <= 0) state.moveMarker = null;

    renderer.draw(state, alpha);
    hud.updateOrbs();

    const reg = world.regionAt(p.x, p.y);
    const rname = reg ? reg.name : 'the edge of the world';
    if (rname !== lastRegion) {
      lastRegion = rname;
      hud.setRegion(rname);
      if (reg) toast(state, reg.name + ' — ' + reg.blurb);
    }

    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', () => renderer.resize());
  requestAnimationFrame(loop);
}

/* ---------------- what is under the cursor ------------------ */

function probe(game, sx, sy) {
  const { state, world, renderer } = game;
  const t = renderer.screenToTile(sx, sy);

  const n = npcAt(state, t.x, t.y);
  if (n && !n.dead) return { kind: 'npc', ref: n, x: t.x, y: t.y };

  for (let i = state.ground.length - 1; i >= 0; i--) {
    const g = state.ground[i];
    if (g.x === t.x && g.y === t.y) return { kind: 'ground', ref: g, x: t.x, y: t.y };
  }

  const o = world.objectAt(t.x, t.y);
  if (o) return { kind: 'obj', ref: o, x: t.x, y: t.y };

  return { kind: 'tile', x: t.x, y: t.y };
}

function labelFor(hit) {
  switch (hit.kind) {
    case 'npc': {
      const d = NPCS[hit.ref.id];
      return d.hostile
        ? { verb: 'Attack', name: `${d.name} (level ${d.lvl})` }
        : { verb: d.talk ? 'Talk to' : 'Examine', name: d.name };
    }
    case 'ground':
      return { verb: 'Take', name: itemName(hit.ref.id) };
    case 'obj': {
      const d = OBJ[hit.ref.type];
      return { verb: d.act || 'Examine', name: d.name };
    }
    default:
      return { verb: 'Walk here', name: '' };
  }
}

/* ---------------- input ------------------------------------- */

function wireInput(game) {
  const { state, world, renderer, hud, windows, panels } = game;
  const canvas = $('#view');
  const stage = $('#stage');

  const local = e => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('mousemove', e => {
    const m = local(e);
    const hit = probe(game, m.x, m.y);
    state.hoverObj = hit.kind === 'obj' ? hit.ref : null;
    const l = labelFor(hit);
    if (hit.kind === 'tile') hud.hideTooltip();
    else hud.showTooltip(m.x, m.y, l.verb, l.name);
  });

  canvas.addEventListener('mouseleave', () => {
    hud.hideTooltip();
    state.hoverObj = null;
  });

  canvas.addEventListener('click', e => {
    if (hud.ctxOpen) { hud.closeCtx(); return; }
    const m = local(e);
    const hit = probe(game, m.x, m.y);

    /* "use item on…" takes priority while something is selected */
    if (state.useSel != null) {
      if (hit.kind === 'npc' || hit.kind === 'obj') {
        useItemOn(state, world, state.useSel, hit);
        state.useSel = null;
        panels.render();
        return;
      }
      state.useSel = null;
      panels.render();
    }

    doDefault(game, hit);
  });

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const m = local(e);
    const hit = probe(game, m.x, m.y);
    hud.openCtx(m.x, m.y, contextEntries(game, hit));
  });

  /* run toggle */
  $('#orb-run').addEventListener('click', () => {
    const p = state.player;
    if (!p.running && p.energy < 5) { log(state, 'I am too tired to run.'); return; }
    p.running = !p.running;
    log(state, p.running ? 'Run enabled.' : 'Run disabled.');
  });

  /* keyboard */
  window.addEventListener('keydown', e => {
    const chat = $('#chat-input');
    if (document.activeElement === chat) return;
    if (e.key === 'Enter') { chat.focus(); e.preventDefault(); return; }
    if (e.key >= '1' && e.key <= '7') {
      const tabs = ['inventory', 'equipment', 'skills', 'quests', 'vigil', 'magic', 'settings'];
      panels.show(tabs[+e.key - 1]);
    }
    if (e.key === 'Escape') {
      state.useSel = null;
      clearAction(state);
      state.target = null;
      hud.closeCtx();
      panels.render();
    }
  });
}

function doDefault(game, hit) {
  const { state, world, windows } = game;
  clearAction(state);
  state.target = null;

  switch (hit.kind) {
    case 'npc': {
      const n = hit.ref;
      const d = NPCS[n.id];
      if (d.hostile) attack(game, n);
      else talkTo(game, n);
      break;
    }
    case 'ground':
      pickUp(state, world, hit.ref);
      break;
    case 'obj':
      interactObject(state, world, hit.ref, game);
      break;
    default:
      // A* falls back to the closest reachable tile, so clicking a wall
      // still walks you up against it rather than doing nothing.
      walkTo(state, world, hit.x, hit.y);
  }
}

function attack(game, n) {
  const { state } = game;
  const d = NPCS[n.id];
  if (n.dead) return;
  state.target = { kind: 'npc', ref: n };
  state.action = null;
  log(state, `You attack the ${d.name.toLowerCase()}.`);
}

function talkTo(game, n) {
  const { state, world, windows } = game;
  const d = NPCS[n.id];
  setAction(state, world, {
    at: { x: n.x, y: n.y }, range: 1, walkTo: { x: n.x, y: n.y },
    run: () => {
      state.player.facing = n.x >= state.player.x ? 1 : -1;
      if (d.bank) { state.bus.emit('openbank'); return; }
      if (!windows.openDialogue(n.id)) {
        log(state, d.examine || `${d.name} has nothing to say.`);
      }
    }
  });
}

function contextEntries(game, hit) {
  const { state, world, windows } = game;
  const out = [];

  if (hit.kind === 'npc') {
    const n = hit.ref, d = NPCS[n.id];
    if (d.hostile) out.push({ label: 'Attack', obj: `${d.name} (level ${d.lvl})`, run: () => attack(game, n) });
    if (d.talk) out.push({ label: 'Talk to', obj: d.name, run: () => talkTo(game, n) });
    if (d.shop) out.push({ label: 'Trade with', obj: d.name, run: () => talkTo(game, n) });
    if (d.bank) out.push({ label: 'Bank with', obj: d.name, run: () => talkTo(game, n) });
    out.push({ label: 'Examine', obj: d.name, run: () => log(state, d.examine) });
  } else if (hit.kind === 'ground') {
    const g = hit.ref;
    out.push({ label: 'Take', obj: itemName(g.id), run: () => pickUp(state, world, g) });
    out.push({ label: 'Examine', obj: itemName(g.id), run: () => log(state, ITEMS[g.id]?.examine || '') });
  } else if (hit.kind === 'obj') {
    const o = hit.ref, d = OBJ[o.type];
    out.push({ label: d.act || 'Use', obj: d.name, run: () => interactObject(state, world, o, game) });
    out.push({ label: 'Examine', obj: d.name, run: () => log(state, d.examine || d.name) });
  }

  out.push({ label: 'Walk here', obj: '', run: () => walkTo(state, world, hit.x, hit.y) });

  if (hit.kind === 'tile') {
    const t = world.tileAt(hit.x, hit.y);
    out.push({ label: 'Examine', obj: TILE_INFO[t]?.name || 'ground',
      run: () => log(state, `Just ${TILE_INFO[t]?.name || 'ground'}.`) });
  }
  return out;
}

/* ---------------- chat -------------------------------------- */

function wireChat(game) {
  const { state, net } = game;
  const input = $('#chat-input');

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.blur(); return; }
    if (e.key !== 'Enter') return;
    const text = input.value.trim().slice(0, 120);
    input.value = '';
    if (!text) { input.blur(); return; }

    if (text.startsWith('/')) { command(game, text.slice(1)); return; }

    state.player.chat = { text, ttl: 180 };
    state.bus.emit('public', { who: state.name, text });
    net.say(text);
  });
}

function command(game, cmd) {
  const { state } = game;
  const [name, ...rest] = cmd.split(/\s+/);
  switch (name.toLowerCase()) {
    case 'help':
      log(state, 'Commands: /save, /where, /players, /help', 'system');
      break;
    case 'save':
      log(state, save(state) ? 'Progress saved.' : 'Could not save.', 'system');
      break;
    case 'where': {
      const r = world.regionAt(state.player.x, state.player.y);
      log(state, `You are at ${state.player.x}, ${state.player.y} in ${r ? r.name : 'nowhere'}.`, 'system');
      break;
    }
    case 'players':
      log(state, `${state.others.size + 1} nurse${state.others.size ? 's' : ''} on this shard.`, 'system');
      break;
    default:
      log(state, `Unknown command: ${name}`, 'system');
  }
}

/* ---------------- utility spells ---------------------------- */

function wireSpells(game) {
  const { state, world, renderer } = game;

  state.bus.on('castutility', sp => {
    for (const r in sp.runes) {
      if (invCount(state, r) < sp.runes[r]) {
        log(state, 'I do not have the runes for that.', 'bad');
        return;
      }
    }

    if (sp.kind === 'teleport') {
      if (state.player.inCombat > 0) { log(state, 'Not while I am in combat.', 'bad'); return; }
      spend(state, sp);
      const p = state.player;
      p.x = p.px = p.ix = sp.dest.x;
      p.y = p.py = p.iy = sp.dest.y;
      p.path = [];
      state.snapCam = true;
      addXp(state, 'anatomancy', sp.xp);
      log(state, `You blink across the Throat to ${sp.place}.`, 'good');
      return;
    }

    if (sp.kind === 'heal') {
      const p = state.player;
      if (p.hp >= p.maxHp) { log(state, 'I am not injured.'); return; }
      spend(state, sp);
      const healed = Math.min(sp.amount, p.maxHp - p.hp);
      p.hp += healed;
      addXp(state, 'anatomancy', sp.xp);
      addXp(state, 'triage', sp.amount);
      floater(state, p.x, p.y, '+' + healed, '#6fd1a5');
      log(state, 'You knit your own wounds shut.', 'good');
      return;
    }

    if (sp.kind === 'inspect') {
      const t = state.target;
      if (!t || t.kind !== 'npc') { log(state, 'I need to select a creature first.', 'bad'); return; }
      spend(state, sp);
      const d = NPCS[t.ref.id];
      addXp(state, 'anatomancy', sp.xp);
      log(state, `${d.name} — combat level ${d.lvl}, ${t.ref.hp}/${t.ref.maxHp} hitpoints.`, 'system');
      log(state, `Attack ${d.stats.att}, Strength ${d.stats.str}, Defence ${d.stats.def}. ${d.examine}`, 'system');
    }
  });
}

function spend(state, sp) {
  for (const r in sp.runes) removeItem(state, r, sp.runes[r]);
}

/* ---------------- settings hooks ---------------------------- */

function wireSettings(game) {
  const { state, renderer, net } = game;
  state.bus.on('detail', v => { renderer.lowDetail = v; });
  state.bus.on('netToggle', v => {
    if (v) net.connect();
    else { net.disconnect(); log(state, 'Disconnected. Playing solo.', 'system'); }
  });
  state.bus.on('export', () => {
    const blob = new Blob([JSON.stringify(serialize(state), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `throatscape-${state.name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    log(state, 'Save exported.', 'system');
  });
}

/* ---------------- go ---------------------------------------- */

boot();

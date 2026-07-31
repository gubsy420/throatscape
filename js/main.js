/* ============================================================
   Throatscape - boot, authentication, input, and the render loop
   ------------------------------------------------------------
   The server runs the game. This file draws it and reports what
   the player would like to do.
   ============================================================ */

import { clamp, lerp } from './util.js';
import { buildWorld, OBJ, TILE_INFO } from './data/world.js';
import { NPCS } from './data/npcs.js';
import { ITEMS, itemName } from './data/items.js';
import { createState, log, toast } from './game/state.js';
import { Renderer } from './engine/render.js';
import { Audio } from './engine/audio.js';
import { Hud } from './ui/hud.js';
import { Panels } from './ui/panels.js';
import { Windows } from './ui/windows.js';
import { Net, TOKEN_KEY, TICK_MS } from './net.js';
import { COLOURS, MOTIONS } from './game/chatfx.js';

const COLOUR_NAMES = Object.keys(COLOURS);
const MOTION_NAMES = Object.keys(MOTIONS);

const $ = s => document.querySelector(s);

let world = null;
let game = null;

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

const wait = ms => new Promise(r => setTimeout(r, ms));

async function boot() {
  const fill = $('#boot-fill'), status = $('#boot-status');
  for (let i = 0; i < BOOT_STEPS.length; i++) {
    status.textContent = BOOT_STEPS[i];
    fill.style.width = ((i + 1) / (BOOT_STEPS.length + 1) * 100) + '%';
    if (i === 2) world = buildWorld();
    await wait(90);
  }
  if (!world) world = buildWorld();
  fill.style.width = '100%';
  await wait(160);
  $('#boot').hidden = true;
  await showLogin();
}

/* ============================================================
   Authentication
   ============================================================ */

async function showLogin() {
  const login = $('#login');
  login.hidden = false;

  const nameInput = $('#login-name');
  const passInput = $('#login-pass');
  const pass2Input = $('#login-pass2');
  const confirmField = $('#field-confirm');
  const errorEl = $('#login-error');
  const statusEl = $('#login-status');
  const submit = $('#btn-play');
  let mode = 'login';

  if (location.protocol !== 'https:' && location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1') {
    $('#login-tls').hidden = false;
  }

  const state = createState('Nurse');
  const net = new Net(state, world);

  const setMode = m => {
    mode = m;
    document.querySelectorAll('.auth-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === m));
    confirmField.hidden = m !== 'register';
    passInput.autocomplete = m === 'register' ? 'new-password' : 'current-password';
    submit.textContent = m === 'register' ? 'Create nurse' : 'Enter the Throat';
    errorEl.textContent = '';
  };

  document.querySelectorAll('.auth-tab').forEach(b =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));

  const busy = on => {
    submit.disabled = on;
    statusEl.textContent = on ? 'Talking to the ward…' : '';
  };

  /*
   * Wire the form before the socket exists. The panel is on screen from the
   * moment showLogin runs, so a submit that reached the browser's default
   * handler would reload the page out from under us. The button stays
   * disabled until we are connected; this listener is the backstop for
   * anyone who hits Enter in the meantime.
   */
  $('#auth-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!net.open) return;

    const name = nameInput.value.trim();
    const password = passInput.value;

    if (!name) { errorEl.textContent = 'Enter your nurse name.'; return; }
    if (!password) { errorEl.textContent = 'Enter your password.'; return; }
    if (mode === 'register' && password !== pass2Input.value) {
      errorEl.textContent = 'Those passwords do not match.';
      return;
    }
    if (mode === 'register' && password.length < 8) {
      errorEl.textContent = 'Passwords must be at least 8 characters.';
      return;
    }

    busy(true);
    if (mode === 'register') net.register(name, password);
    else net.login(name, password);
  });

  state.bus.on('hello', m => {
    statusEl.textContent = m.players
      ? `${m.players} nurse${m.players === 1 ? '' : 's'} on shift.`
      : 'The ward is quiet.';
  });

  state.bus.on('authfail', m => {
    busy(false);
    errorEl.textContent = m.error;
  });

  state.bus.on('auth', () => {
    busy(false);
    errorEl.textContent = '';
  });

  state.bus.on('ready', () => {
    if (game) return;                       // a reconnect, not a fresh login
    login.hidden = true;
    startGame(state, net);
  });

  statusEl.textContent = 'Connecting…';
  try {
    await net.connect();
    statusEl.textContent = '';
  } catch (e) {
    errorEl.textContent = e.message;
    statusEl.textContent = '';
    return;
  }
  submit.disabled = false;

  /* a stored session skips the form entirely */
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    busy(true);
    statusEl.textContent = 'Resuming your shift…';
    net.resume(token);
  }

  nameInput.focus();
}

/* ============================================================
   Game
   ============================================================ */

function startGame(state, net) {
  $('#game').hidden = false;

  const renderer = new Renderer($('#view'), world);
  const hud = new Hud(state);
  const audio = new Audio(state, world);
  const panels = new Panels(state, world, hud, net, audio);
  const windows = new Windows(state, world, hud, panels, net);
  panels.windows = windows;              // the skills tab opens the guide window

  renderer.lowDetail = state.settings.lowDetail;
  state.snapCam = true;

  game = { state, world, renderer, hud, panels, windows, net, audio };
  window.__throatscape = game;

  wireInput(game);
  wireChat(game);
  wireServerUi(game);
  wireSettings(game);
  wireAudio(game);

  log(state, `Welcome to Throatscape, ${state.name}.`, 'quest');
  log(state, 'Left-click to walk and interact. Right-click for more options.', 'system');
  log(state, 'Your progress is kept on the server. Speak to Orderly Punn to begin.', 'system');

  startLoop(game);
}

/* ---------------- render loop ------------------------------- */

function startLoop(game) {
  const { state, world, renderer, hud, net } = game;
  let lastRegion = null;

  function frame() {
    const alpha = net.alpha();
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

    for (let i = state.hitsplats.length - 1; i >= 0; i--) {
      if (--state.hitsplats[i].ttl <= 0) state.hitsplats.splice(i, 1);
    }
    for (let i = state.floaters.length - 1; i >= 0; i--) {
      if (--state.floaters[i].ttl <= 0) state.floaters.splice(i, 1);
    }
    if (state.moveMarker && --state.moveMarker.ttl <= 0) state.moveMarker = null;

    renderer.draw(state, alpha);
    hud.updateOrbs();
    game.audio.update();

    const reg = world.regionAt(p.x, p.y);
    const rname = reg ? reg.name : 'the edge of the world';
    if (rname !== lastRegion) {
      lastRegion = rname;
      hud.setRegion(rname);
      if (reg) toast(state, reg.name + ' — ' + reg.blurb);
    }

    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => renderer.resize());
  requestAnimationFrame(frame);
}

/* ---------------- hit testing ------------------------------- */

function probe(game, sx, sy) {
  const { state, world, renderer } = game;
  const t = renderer.screenToTile(sx, sy);

  for (const n of state.npcs) {
    const d = NPCS[n.id];
    const sz = d.size || 1;
    if (t.x >= n.x && t.x < n.x + sz && t.y >= n.y && t.y < n.y + sz) {
      return { kind: 'npc', ref: n, x: t.x, y: t.y };
    }
  }
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
    case 'ground': return { verb: 'Take', name: itemName(hit.ref.id) };
    case 'obj':    return { verb: OBJ[hit.ref.type].act || 'Examine', name: OBJ[hit.ref.type].name };
    default:       return { verb: 'Walk here', name: '' };
  }
}

/* ---------------- input ------------------------------------- */

function wireInput(game) {
  const { state, world, renderer, hud, panels, net } = game;
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

    if (state.useSel != null) {
      if (hit.kind === 'npc') net.useOnNpc(state.useSel, hit.ref.uid);
      else if (hit.kind === 'obj') net.useOnObj(state.useSel, hit.ref.x, hit.ref.y);
      state.useSel = null;
      panels.render();
      return;
    }
    doDefault(game, hit);
  });

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const m = local(e);
    hud.openCtx(m.x, m.y, contextEntries(game, probe(game, m.x, m.y)));
  });

  $('#orb-run').addEventListener('click', () => net.toggleRun());

  window.addEventListener('keydown', e => {
    const chat = $('#chat-input');
    if (document.activeElement === chat) return;
    if (e.key === 'Enter') { chat.focus(); e.preventDefault(); return; }
    if (e.key >= '1' && e.key <= '7') {
      panels.show(['inventory', 'equipment', 'skills', 'quests', 'vigil', 'magic', 'settings'][+e.key - 1]);
    }
    if (e.key === 'Escape') {
      state.useSel = null;
      hud.closeCtx();
      panels.render();
    }
  });
}

function doDefault(game, hit) {
  const { state, net } = game;
  switch (hit.kind) {
    case 'npc':
      if (NPCS[hit.ref.id].hostile) net.attack(hit.ref.uid);
      else net.talk(hit.ref.uid);
      break;
    case 'ground':
      net.pickup(hit.ref.x, hit.ref.y, hit.ref.id);
      break;
    case 'obj':
      net.interact(hit.ref.x, hit.ref.y);
      break;
    default:
      state.moveMarker = { x: hit.x, y: hit.y, ttl: 24 };
      net.move(hit.x, hit.y);
  }
}

function contextEntries(game, hit) {
  const { state, world, net } = game;
  const out = [];

  if (hit.kind === 'npc') {
    const n = hit.ref, d = NPCS[n.id];
    if (d.hostile) out.push({ label: 'Attack', obj: `${d.name} (level ${d.lvl})`, run: () => net.attack(n.uid) });
    if (d.talk) out.push({ label: 'Talk to', obj: d.name, run: () => net.talk(n.uid) });
    if (d.shop) out.push({ label: 'Trade with', obj: d.name, run: () => net.talk(n.uid) });
    if (d.bank) out.push({ label: 'Bank with', obj: d.name, run: () => net.talk(n.uid) });
    out.push({ label: 'Examine', obj: d.name, run: () => log(state, d.examine) });
  } else if (hit.kind === 'ground') {
    const g = hit.ref;
    out.push({ label: 'Take', obj: itemName(g.id), run: () => net.pickup(g.x, g.y, g.id) });
    out.push({ label: 'Examine', obj: itemName(g.id), run: () => log(state, ITEMS[g.id]?.examine || '') });
  } else if (hit.kind === 'obj') {
    const o = hit.ref, d = OBJ[o.type];
    out.push({ label: d.act || 'Use', obj: d.name, run: () => net.interact(o.x, o.y) });
    out.push({ label: 'Examine', obj: d.name, run: () => log(state, d.examine || d.name) });
  }

  out.push({ label: 'Walk here', obj: '', run: () => {
    state.moveMarker = { x: hit.x, y: hit.y, ttl: 24 };
    net.move(hit.x, hit.y);
  } });

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
    net.say(text);
  });
}

function command(game, cmd) {
  const { state, net } = game;
  const [name, ...rest] = cmd.split(/\s+/);
  const args = rest.join(' ');
  /**
   * Names may contain spaces, so "Nurse Vell hello" is ambiguous. One word is
   * the name unless it is quoted: /tell "Nurse Vell" hello.
   */
  const splitTarget = () => {
    const quoted = /^"([^"]+)"\s*(.*)$/.exec(args);
    if (quoted) return { who: quoted[1].trim(), text: quoted[2].trim() };
    const m = /^(\S+)\s+(.+)$/.exec(args);
    return m ? { who: m[1], text: m[2] } : { who: args.trim(), text: '' };
  };

  switch (name.toLowerCase()) {
    case 'help':
      log(state, 'Commands: /tell <name> <message>, /r <message>, /add <name>, ' +
                 '/remove <name>, /friends, /where, /players, /effects, /logout', 'system');
      log(state, 'Names with a space need quotes: /tell "Nurse Vell" hello.', 'system');
      break;
    case 'effects':
      log(state, 'Prefix a message with a colour and a motion, e.g. ' +
                 '"rainbow:wave:hello". Colours: ' + COLOUR_NAMES.join(', ') +
                 '. Motions: ' + MOTION_NAMES.join(', ') + '.', 'system');
      break;
    case 'tell': case 'w': case 'msg': case 'whisper': {
      const { who, text } = splitTarget();
      if (!who || !text) { log(state, 'Usage: /tell <name> <message>', 'system'); break; }
      net.tell(who, text);
      break;
    }
    case 'r': case 'reply': {
      const who = net.lastWhisperFrom || net.lastWhisperTo;
      if (!who) { log(state, 'Nobody has whispered you yet.', 'system'); break; }
      if (!args.trim()) { log(state, 'Usage: /r <message>', 'system'); break; }
      net.tell(who, args);
      break;
    }
    case 'add': case 'friend':
      if (args.trim()) net.addFriend(args.trim());
      else log(state, 'Usage: /add <name>', 'system');
      break;
    case 'remove': case 'unfriend': case 'del':
      if (args.trim()) net.delFriend(args.trim());
      else log(state, 'Usage: /remove <name>', 'system');
      break;
    case 'friends': {
      const on = state.friends.filter(f => f.online).map(f => f.name);
      log(state, state.friends.length
        ? `${on.length} of ${state.friends.length} friends on shift${on.length ? ': ' + on.join(', ') : '.'}`
        : 'Your friends list is empty.', 'system');
      break;
    }
    case 'where': {
      const r = world.regionAt(state.player.x, state.player.y);
      log(state, `You are at ${state.player.x}, ${state.player.y} in ${r ? r.name : 'nowhere'}.`, 'system');
      break;
    }
    case 'players':
      log(state, `${state.others.size + 1} nurse${state.others.size ? 's' : ''} nearby.`, 'system');
      break;
    case 'logout':
      net.logout();
      location.reload();
      break;
    default:
      log(state, `Unknown command: ${name}`, 'system');
  }
}

/* ---------------- server-driven interfaces ------------------ */

function wireServerUi(game) {
  const { state, windows } = game;
  state.bus.on('serverui', m => {
    if (m.kind === 'bank') windows.openBank();
    else if (m.kind === 'shop') windows.openShop(m.id);
    else if (m.kind === 'make') windows.openMake(m.station);
  });
  state.bus.on('dialogue', m => {
    if (m.close) windows.closeDialogue();
    else windows.showDialogue(m);
  });
  state.bus.on('disconnected', () => windows.closeAll());
}

/* ---------------- settings ---------------------------------- */

function wireSettings(game) {
  const { state, renderer } = game;
  state.bus.on('detail', v => { renderer.lowDetail = v; });
}

/* ---------------- audio ------------------------------------- */

/**
 * Nothing here decides anything; it listens to the events the game already
 * announces and picks a sound. Most of them are inferred from the snapshot,
 * because the server has no idea the client is making noise.
 */
function wireAudio(game) {
  const { state, audio } = game;

  // browsers will not start an AudioContext until the page has been touched
  const wake = () => audio.unlock();
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });

  state.bus.on('blow', ({ self, dmg }) =>
    audio.play(dmg > 0 ? (self ? 'hurt' : 'hit') : 'miss'));
  state.bus.on('died', () => audio.play('death'));
  state.bus.on('stepped', () => audio.footstep());
  state.bus.on('cue', name => audio.play(name));
  state.bus.on('levelup', () => audio.play('levelup'));
  state.bus.on('bank', () => audio.play('bank'));
  state.bus.on('toast', () => audio.play('toast'));
  state.bus.on('public', () => audio.play('chat'));
  state.bus.on('private', m => audio.play(m.dir === 'in' ? 'toast' : 'chat'));
  state.bus.on('vigil', () => audio.play('vigil'));
  state.bus.on('serverui', () => audio.play('open'));
  state.bus.on('dialogue', m => audio.play(m.close ? 'close' : 'talk'));

  state.bus.on('gained', ({ id }) => {
    const def = ITEMS[id] || {};
    if (id === 'coins') audio.play('coin');
    else if (def.potion || def.heal) audio.play('item');
    else audio.play('gather');
  });
}

boot();

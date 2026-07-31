/* ============================================================
   Sidebar panels - inventory, worn gear, skills, quests,
   vigil, anatomancy and settings
   ============================================================ */

import { ITEMS, item, itemName, EQUIP_SLOTS, SLOT_LABEL, SLOT_GLYPH,
         BONUS_KEYS, DEF_KEYS, OTHER_KEYS } from '../data/items.js';
import { SKILLS, SKILL_BY_ID, levelProgress, xpForLevel, levelForXp, MAX_LEVEL } from '../data/skills.js';
import { QUESTS, QUEST_BY_ID, DONE, totalQp } from '../data/quests.js';
import { VIGILS, VIGIL_BY_ID, SPELLS, SPELL_BY_ID, conflicts } from '../data/magic.js';
import { STYLES } from '../game/combat.js';
import { fmt, fmtStack, escapeHtml, clamp } from '../util.js';
import { iconImg } from '../engine/icons.js';
import {
  baseLevel, effLevel, skillXp, totalLevel, totalXp, combatLvl, questPoints,
  questStage, questDone, equipBonuses, invCount, log
} from '../game/state.js';
import { makeQuestApi } from '../game/questapi.js';

const TABS = [
  { id: 'inventory', icon: '🎒', title: 'Inventory' },
  { id: 'equipment', icon: '🥼', title: 'Worn equipment' },
  { id: 'skills',    icon: '📊', title: 'Skills' },
  { id: 'quests',    icon: '📜', title: 'Quest journal' },
  { id: 'vigil',     icon: '🕯️', title: 'Vigil' },
  { id: 'magic',     icon: '✨', title: 'Anatomancy' },
  { id: 'friends',   icon: '👥', title: 'Friends' },
  { id: 'settings',  icon: '⚙️', title: 'Settings' }
];

export class Panels {
  constructor(state, world, hud, net, audio) {
    this.state = state;
    this.world = world;
    this.hud = hud;
    this.net = net;
    this.audio = audio;
    loadSettings(state);
    this.active = 'inventory';
    this.questOpen = null;
    this.strip = document.getElementById('tab-strip');
    this.panel = document.getElementById('panel');

    this.buildTabs();
    this.render();

    const s = state;
    const rerender = () => this.render();
    s.bus.on('inv', () => { if (this.active === 'inventory') this.render(); });
    s.bus.on('equip', () => { if (this.active === 'equipment' || this.active === 'inventory') this.render(); });
    s.bus.on('xp', () => { if (this.active === 'skills') this.renderThrottled(); });
    s.bus.on('levelup', rerender);
    s.bus.on('quest', () => { if (this.active === 'quests') this.render(); });
    s.bus.on('vigil', () => { if (this.active === 'vigil') this.render(); });
    s.bus.on('questcomplete', () => this.flashTab('quests'));
    s.bus.on('friends', () => { if (this.active === 'friends') this.render(); });
    s.bus.on('private', m => { if (m.dir === 'in') this.flashTab('friends'); });
  }

  buildTabs() {
    this.strip.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('div');
      b.className = 'tab-btn' + (t.id === this.active ? ' active' : '');
      b.textContent = t.icon;
      b.title = t.title;
      b.dataset.tab = t.id;
      b.addEventListener('click', () => this.show(t.id));
      this.strip.appendChild(b);
    }
  }

  show(id) {
    this.active = id;
    this.questOpen = null;
    this.strip.querySelectorAll('.tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === id));
    this.render();
  }

  flashTab(id) {
    const b = this.strip.querySelector(`[data-tab="${id}"]`);
    if (!b) return;
    b.classList.add('flash');
    setTimeout(() => b.classList.remove('flash'), 3000);
  }

  renderThrottled() {
    if (this._pending) return;
    this._pending = true;
    setTimeout(() => { this._pending = false; this.render(); }, 250);
  }

  render() {
    const fn = this['render_' + this.active];
    this.panel.innerHTML = '';
    if (fn) fn.call(this);
  }

  /* ============ inventory =================================== */

  render_inventory() {
    const s = this.state;
    const head = el('div', 'panel-head', 'Inventory');
    const grid = el('div', 'inv-grid');

    for (let i = 0; i < s.inventory.length; i++) {
      grid.appendChild(this.invSlot(i));
    }

    const foot = el('div', 'inv-foot');
    foot.innerHTML =
      `<span>${s.inventory.filter(Boolean).length}/28 slots</span>` +
      `<span class="coin-count">${fmt(invCount(s, 'coins'))} gp</span>`;

    this.panel.append(head, grid, foot);

    if (s.useSel != null) {
      const note = el('div', 'panel-sub');
      note.style.marginTop = '6px';
      note.textContent = `Using ${itemName(s.inventory[s.useSel]?.id || '')} — pick a target`;
      this.panel.appendChild(note);
    }
  }

  invSlot(i) {
    const s = this.state;
    const slot = s.inventory[i];
    const d = el('div', 'slot ' + (slot ? 'filled' : 'empty'));
    d.dataset.idx = i;

    if (slot) {
      const def = ITEMS[slot.id];
      d.appendChild(iconImg(slot.id, 34));
      if (def.stack && slot.n > 1) {
        const q = el('span', 'qty' + (slot.n >= 100000 ? ' huge' : slot.n >= 10000 ? ' big' : ''));
        q.textContent = fmtStack(slot.n);
        d.appendChild(q);
      }
      if (s.useSel === i) d.classList.add('selected');

      d.addEventListener('pointerenter', e => this.hud.itemTip(e, slot.id, slot.n));
      d.addEventListener('pointermove', e => this.hud.moveItemTip(e));
      d.addEventListener('pointerleave', () => this.hud.hideItemTip());
      d.addEventListener('pointerdown', () => this.hud.hideItemTip());

      d.addEventListener('click', e => {
        e.stopPropagation();
        if (s.useSel != null && s.useSel !== i) {
          this.net.useOnItem(s.useSel, i);
          s.useSel = null;
          this.render();
          return;
        }
        if (s.useSel === i) { s.useSel = null; this.render(); return; }
        this.net.useItem(i);
      });

      d.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        this.itemMenu(e, i, slot);
      });

      /* drag to rearrange */
      d.draggable = true;
      d.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', String(i));
        d.classList.add('dragging');
      });
      d.addEventListener('dragend', () => d.classList.remove('dragging'));
    }

    d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('drop-target'); });
    d.addEventListener('dragleave', () => d.classList.remove('drop-target'));
    d.addEventListener('drop', e => {
      e.preventDefault();
      d.classList.remove('drop-target');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (Number.isInteger(from) && from !== i) this.net.swap(from, i);
    });

    return d;
  }

  itemMenu(e, i, slot) {
    const s = this.state;
    const def = ITEMS[slot.id];
    const entries = [];
    const rect = document.getElementById('stage').getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;

    if (def.slot) entries.push({ label: 'Wear', obj: def.name, run: () => this.net.equip(i) });
    if (def.heal) entries.push({ label: 'Eat', obj: def.name, run: () => this.net.useItem(i) });
    if (def.potion) entries.push({ label: 'Drink', obj: def.name, run: () => this.net.useItem(i) });
    if (def.buryXp) entries.push({ label: 'Bury', obj: def.name, run: () => this.net.useItem(i) });
    entries.push({ label: 'Use', obj: def.name, run: () => { s.useSel = i; this.render(); } });
    if (!def.questItem) {
      entries.push({ label: 'Drop', obj: def.name, run: () => this.net.drop(i) });
    }
    entries.push({ label: 'Examine', obj: def.name, run: () => log(s, def.examine || def.name) });

    this.hud.openCtx(x, y, entries);
  }

  /* ============ equipment ================================== */

  render_equipment() {
    const s = this.state;
    this.panel.appendChild(el('div', 'panel-head', 'Worn Equipment'));

    const layout = [
      [null, 'head', null],
      ['cape', 'neck', 'ammo'],
      ['weapon', 'body', 'shield'],
      [null, 'legs', null],
      ['hands', 'feet', 'ring']
    ];

    const fig = el('div', 'equip-fig');
    for (const row of layout) {
      for (const slot of row) {
        if (!slot) { fig.appendChild(el('div', 'slot blank')); continue; }
        const d = el('div', 'slot');
        const id = s.equipment[slot];
        if (id) {
          d.classList.add('filled');
          d.appendChild(iconImg(id, 42));
          if (slot === 'ammo' && s.equipment.ammoN > 1) {
            const q = el('span', 'qty');
            q.textContent = fmtStack(s.equipment.ammoN);
            d.appendChild(q);
          }
          d.title = ITEMS[id].name;
          d.addEventListener('pointerenter', ev => this.hud.itemTip(ev, id));
          d.addEventListener('pointermove', ev => this.hud.moveItemTip(ev));
          d.addEventListener('pointerleave', () => this.hud.hideItemTip());
          d.addEventListener('click', () => { this.hud.hideItemTip(); this.net.unequip(slot); });
          d.addEventListener('contextmenu', ev => {
            ev.preventDefault();
            const rect = document.getElementById('stage').getBoundingClientRect();
            this.hud.openCtx(ev.clientX - rect.left, ev.clientY - rect.top, [
              { label: 'Remove', obj: ITEMS[id].name, run: () => this.net.unequip(slot) },
              { label: 'Examine', obj: ITEMS[id].name, run: () => log(s, ITEMS[id].examine) }
            ]);
          });
        } else {
          const ph = el('span', 'ph', SLOT_GLYPH[slot]);
          d.appendChild(ph);
          d.title = SLOT_LABEL[slot];
        }
        fig.appendChild(d);
      }
    }
    this.panel.appendChild(fig);

    const b = equipBonuses(s);
    const list = el('div', 'bonus-list');
    const section = (title, keys) => {
      list.appendChild(el('h4', '', title));
      for (const [k, label] of keys) {
        const row = el('div', 'bonus-row');
        row.innerHTML = `<span>${label}</span><span>${b[k] >= 0 ? '+' : ''}${b[k]}</span>`;
        list.appendChild(row);
      }
    };
    section('Attack bonus', BONUS_KEYS);
    section('Defence bonus', DEF_KEYS);
    section('Other', OTHER_KEYS);
    this.panel.appendChild(list);

    /* attack style */
    this.panel.appendChild(el('h4', '', 'Attack style'));
    const styleRow = el('div', 'prayer-grid');
    for (const key in STYLES) {
      const st = STYLES[key];
      const b2 = el('div', 'pbtn' + (s.attackStyle === key ? ' on' : ''));
      b2.textContent = st.icon;
      b2.title = st.name + ' — trains ' + st.xp.map(x => SKILL_BY_ID[x].name).join(', ');
      b2.addEventListener('click', () => this.net.style(key));
      styleRow.appendChild(b2);
    }
    this.panel.appendChild(styleRow);
  }

  /* ============ skills ===================================== */

  render_skills() {
    const s = this.state;
    this.panel.appendChild(el('div', 'panel-head', 'Skills'));

    const grid = el('div', 'skill-grid');
    for (const sk of SKILLS) {
      const base = baseLevel(s, sk.id);
      const eff = effLevel(s, sk.id);
      const xp = skillXp(s, sk.id);
      const cell = el('div', 'skill-cell' + (eff > base ? ' boosted' : eff < base ? ' drained' : ''));
      cell.innerHTML =
        `<div class="sk-icon">${sk.icon}</div>` +
        `<div class="sk-name">${sk.name}</div>` +
        `<div class="sk-lvl">${eff}${eff !== base ? `<small>/${base}</small>` : ''}</div>`;
      const bar = el('div', 'sk-bar');
      bar.style.width = Math.round(levelProgress(xp) * 100) + '%';
      cell.appendChild(bar);

      const next = base < MAX_LEVEL ? xpForLevel(base + 1) : null;
      cell.title = `${sk.name} — level ${base}\n` +
        `XP: ${fmt(xp)}\n` +
        (next ? `Next level: ${fmt(next)} (${fmt(next - xp)} to go)\n` : 'Maximum level reached\n') +
        `\n${sk.blurb}\n\nClick to see what it unlocks.`;
      cell.addEventListener('click', () => this.windows?.openSkillGuide(sk.id));
      grid.appendChild(cell);
    }
    this.panel.appendChild(grid);

    const total = el('div', 'total-row');
    total.innerHTML =
      `Combat level <b>${combatLvl(s)}</b><br>` +
      `Total level <b>${totalLevel(s)}</b><br>` +
      `Total XP <b>${fmt(totalXp(s))}</b><br>` +
      `Quest points <b>${questPoints(s)}/${totalQp()}</b>`;
    this.panel.appendChild(total);
  }

  /* ============ quests ===================================== */

  render_quests() {
    const s = this.state;
    if (this.questOpen) return this.renderQuestDetail(this.questOpen);

    this.panel.appendChild(el('div', 'panel-head', 'Quest Journal'));
    this.panel.appendChild(el('div', 'panel-sub',
      `${questPoints(s)} of ${totalQp()} quest points`));

    for (const q of QUESTS) {
      const st = questStage(s, q.id);
      const cls = st >= DONE ? 'done' : st > 0 ? 'started' : 'notstarted';
      const d = el('div', 'quest-item ' + cls);
      d.innerHTML =
        `<div class="q-name">${escapeHtml(q.name)}</div>` +
        `<div class="q-meta">${q.difficulty} &middot; ${q.length} &middot; ${q.qp} QP</div>`;
      d.addEventListener('click', () => { this.questOpen = q.id; this.render(); });
      this.panel.appendChild(d);
    }
  }

  renderQuestDetail(id) {
    const s = this.state;
    const q = QUEST_BY_ID[id];
    const st = questStage(s, id);

    const back = el('div', 'quest-item');
    back.innerHTML = '<div class="q-name">&larr; Back to journal</div>';
    back.addEventListener('click', () => { this.questOpen = null; this.render(); });
    this.panel.appendChild(back);

    const box = el('div', 'quest-detail');
    box.appendChild(el('h3', '', q.name));
    box.appendChild(el('div', 'q-diff', `${q.difficulty} · ${q.length} · ${q.qp} quest points`));

    const body = el('div', 'q-body');
    body.appendChild(el('p', '', q.desc));

    if (st === 0) {
      body.appendChild(el('h4', '', 'Requirements'));
      const ul = document.createElement('ul');
      const add = (text, met) => {
        const li = document.createElement('li');
        li.className = met ? 'met' : 'unmet';
        li.textContent = text;
        ul.appendChild(li);
      };
      let any = false;
      for (const rq of (q.reqs.quests || [])) {
        any = true;
        add(`Completion of ${QUEST_BY_ID[rq].name}`, questDone(s, rq));
      }
      for (const sk in (q.reqs.skills || {})) {
        any = true;
        add(`${SKILL_BY_ID[sk].name} ${q.reqs.skills[sk]}`, baseLevel(s, sk) >= q.reqs.skills[sk]);
      }
      if (!any) add('None', true);
      body.appendChild(ul);
      body.appendChild(el('p', '', 'Start point: ' + q.start));
    }

    const text = q.stageText[st >= DONE ? DONE : st];
    if (text) {
      const p = el('div', 'q-step');
      p.textContent = typeof text === 'function' ? text(this.qapi()) : text;
      body.appendChild(p);
    }

    body.appendChild(el('h4', '', 'Rewards'));
    const ul2 = document.createElement('ul');
    ul2.appendChild(liText(`${q.qp} quest point${q.qp > 1 ? 's' : ''}`));
    for (const sk in (q.rewards.xp || {})) {
      ul2.appendChild(liText(`${fmt(q.rewards.xp[sk])} ${SKILL_BY_ID[sk].name} XP`));
    }
    for (const [it, n] of (q.rewards.items || [])) {
      ul2.appendChild(liText(`${n > 1 ? n + ' x ' : ''}${itemName(it)}`));
    }
    body.appendChild(ul2);

    box.appendChild(body);
    this.panel.appendChild(box);
  }

  /** Quest stage text is written against the live quest facade. */
  qapi() {
    return this._qapi || (this._qapi = makeQuestApi(this.state));
  }

  /* ============ vigil ====================================== */

  render_vigil() {
    const s = this.state;
    this.panel.appendChild(el('div', 'panel-head', 'The Vigil'));
    this.panel.appendChild(el('div', 'panel-sub',
      `${Math.ceil(s.vigil.points)} / ${s.vigil.max} points`));

    const grid = el('div', 'prayer-grid');
    for (const v of VIGILS) {
      const lvl = baseLevel(s, 'vigil');
      const locked = lvl < v.level;
      const on = s.vigil.active.includes(v.id);
      const b = el('div', 'pbtn' + (locked ? ' locked' : '') + (on ? ' on' : ''));
      b.innerHTML = v.icon + `<span class="plvl">${v.level}</span>`;
      b.title = `${v.name} (level ${v.level})\n${v.desc}`;
      if (!locked) b.addEventListener('click', () => this.net.vigil(v.id));
      grid.appendChild(b);
    }
    this.panel.appendChild(grid);

    const hint = el('div', 'hint');
    hint.style.marginTop = '10px';
    hint.textContent = 'Vigils burn points while active. Bury bones to train, and pray at an altar to restore.';
    this.panel.appendChild(hint);
  }

  /* ============ magic ====================================== */

  render_magic() {
    const s = this.state;
    this.panel.appendChild(el('div', 'panel-head', 'Anatomancy'));
    const lvl = baseLevel(s, 'anatomancy');
    this.panel.appendChild(el('div', 'panel-sub', `Level ${lvl}`));

    const grid = el('div', 'spell-grid');
    for (const sp of SPELLS) {
      const locked = lvl < sp.level;
      const runesOk = Object.entries(sp.runes).every(([r, n]) => invCount(s, r) >= n);
      const b = el('div', 'pbtn' + (locked ? ' locked' : runesOk ? ' castable' : ''));
      if (s.autocast === sp.id) b.classList.add('on');
      b.innerHTML = sp.icon + `<span class="plvl">${sp.level}</span>`;
      const runeText = Object.entries(sp.runes)
        .map(([r, n]) => `${n} x ${itemName(r)}`).join('\n');
      b.title = `${sp.name} (level ${sp.level})\n${sp.desc}\n\n${runeText}`;

      if (!locked) {
        b.addEventListener('click', () => this.castSpell(sp));
      }
      grid.appendChild(b);
    }
    this.panel.appendChild(grid);

    const hint = el('div', 'hint');
    hint.style.marginTop = '10px';
    hint.innerHTML = 'Attack spells set your autocast — equip a staff and click a target.<br>' +
                     'Gold border means you have the runes.';
    this.panel.appendChild(hint);
  }

  castSpell(sp) {
    if (sp.kind === 'attack' || sp.kind === 'drain') this.net.autocast(sp.id);
    else this.net.castUtility(sp.id);
  }

  /* ============ friends ==================================== */

  render_friends() {
    const s = this.state;
    this.panel.appendChild(el('div', 'panel-head', 'Friends'));

    const add = el('div', 'friend-add');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 12;
    input.placeholder = 'Add a nurse by name';
    input.className = 'friend-input';
    const submit = () => {
      const name = input.value.trim();
      if (!name) return;
      this.net.addFriend(name);
      input.value = '';
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      e.stopPropagation();                  // the number keys switch tabs
    });
    const btn = el('button', 'btn', 'Add');
    btn.addEventListener('click', submit);
    add.append(input, btn);
    this.panel.appendChild(add);

    const list = s.friends || [];
    if (!list.length) {
      this.panel.appendChild(el('div', 'hint',
        'Nobody yet. Add a name here, or type /add <name> in the chat box.'));
      return;
    }

    // on shift first, then alphabetically, so the useful half is at the top
    const sorted = [...list].sort((a, b) =>
      (b.online - a.online) || a.name.localeCompare(b.name));

    const wrap = el('div', 'friend-list');
    for (const f of sorted) {
      const row = el('div', 'friend-row' + (f.online ? ' online' : ''));
      row.append(el('span', 'friend-dot', ''), el('span', 'friend-name', f.name));
      row.append(el('span', 'friend-where', f.online ? 'On shift' : 'Off'));

      if (f.online) {
        row.title = `Message ${f.name}`;
        row.addEventListener('click', () => {
          // prime the chat box rather than sending: you have not typed anything yet
          const box = document.getElementById('chat-input');
          box.value = `/tell ${f.name} `;
          box.focus();
        });
      }
      row.addEventListener('contextmenu', e => {
        e.preventDefault();
        const r = document.getElementById('stage').getBoundingClientRect();
        this.hud.openCtx(e.clientX - r.left, e.clientY - r.top, [
          { label: 'Message', obj: f.name, run: () => {
            const box = document.getElementById('chat-input');
            box.value = `/tell ${f.name} `;
            box.focus();
          } },
          { label: 'Remove', obj: f.name, run: () => this.net.delFriend(f.name) }
        ]);
      });
      wrap.appendChild(row);
    }
    this.panel.appendChild(wrap);

    const on = list.filter(f => f.online).length;
    this.panel.appendChild(el('div', 'hint', `${on} of ${list.length} on shift.`));
  }

  /* ============ settings =================================== */

  render_settings() {
    const s = this.state;
    this.panel.appendChild(el('div', 'panel-head', 'Settings'));

    const toggle = (label, key, onChange) => {
      const row = el('div', 'set-row');
      const sw = document.createElement('label');
      sw.className = 'switch';
      sw.innerHTML = `<input type="checkbox" ${s.settings[key] ? 'checked' : ''}>
                      <span class="track"><span class="knob"></span></span>`;
      sw.querySelector('input').addEventListener('change', e => {
        s.settings[key] = e.target.checked;
        onChange && onChange(e.target.checked);
        saveSettings(s);
      });
      row.append(el('span', '', label), sw);
      this.panel.appendChild(row);
    };

    const slider = (label, key, onChange) => {
      const row = el('div', 'set-row');
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'set-slider';
      input.min = 0; input.max = 100; input.step = 1;
      input.value = Math.round((s.settings[key] ?? 0.5) * 100);
      input.addEventListener('input', e => {
        s.settings[key] = e.target.value / 100;
        onChange && onChange();
        saveSettings(s);
      });
      row.append(el('span', '', label), input);
      this.panel.appendChild(row);
    };

    const audio = this.audio;
    const refreshAudio = () => audio && audio.applySettings();

    toggle('Show hover tooltips', 'showTooltips');
    toggle('Reduced effects', 'lowDetail', v => s.bus.emit('detail', v));

    this.panel.appendChild(el('div', 'panel-head', 'Sound'));
    toggle('Music', 'music', refreshAudio);
    slider('Music volume', 'musicVol', refreshAudio);
    toggle('Sound effects', 'sfx', refreshAudio);
    slider('Effects volume', 'sfxVol', () => {
      refreshAudio();
      audio && audio.play('item');          // so you can hear what you just set
    });

    const info = el('div', 'hint');
    info.style.margin = '12px 0';
    info.innerHTML =
      `Nurse <b>${escapeHtml(s.name)}</b><br>` +
      `Combat level ${combatLvl(s)} &middot; Total level ${totalLevel(s)}<br>` +
      `<span style="color:#7c6a72">Progress is kept on the server and saves itself.</span>`;
    this.panel.appendChild(info);

    const acts = el('div', 'set-actions');

    const news = el('button', 'btn', 'Ward bulletins');
    news.addEventListener('click', () => {
      import('./patchnotes.js').then(async m => {
        try { await m.showPatchNotes(await m.fetchAllNotes(), { all: true }); }
        catch { log(s, 'No ward bulletins have been posted.', 'system'); }
      });
    });
    acts.append(news);

    const logout = el('button', 'btn danger', 'Log out');
    logout.addEventListener('click', () => {
      this.net.logout();
      location.reload();
    });

    acts.append(logout);
    this.panel.appendChild(acts);
  }
}

/* ---------------- small DOM helpers ------------------------- */

function el(tag, cls = '', text = '') {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text) d.textContent = text;
  return d;
}

function liText(t) {
  const li = document.createElement('li');
  li.textContent = t;
  return li;
}

/* ---------------- settings storage --------------------------- */

const SETTINGS_KEY = 'throatscape.settings';

/**
 * Settings live in this browser, not on the server: how loud the music is
 * belongs to the machine you are sitting at, not to the nurse.
 */
function loadSettings(state) {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch { /* corrupt or unavailable - the defaults are fine */ }
}

function saveSettings(state) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch {}
}

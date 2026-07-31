/* ============================================================
   HUD - chat log, orbs, toasts, tooltips and the context menu
   ============================================================ */

import { escapeHtml, clamp } from '../util.js';
import { combatLvl } from '../game/state.js';
import { parseChat } from '../game/chatfx.js';

const $ = sel => document.querySelector(sel);

export class Hud {
  constructor(state) {
    this.state = state;
    this.log = $('#chat-log');
    this.filter = 'all';
    this.lines = [];
    this.ctx = $('#ctxmenu');
    this.ctxList = $('#ctx-list');
    this.tooltip = $('#tooltip');
    this.toasts = $('#toasts');
    this.stage = $('#stage');
    this.levelup = $('#levelup');
    this.ctxOpen = false;

    this.bindChatTabs();
    this.bindBus();
    this.bindDismiss();

    $('#hud-name').textContent = state.name;
    $('#chat-prompt').textContent = state.name + ':';
  }

  bindBus() {
    const s = this.state;
    s.bus.on('chat', ({ text, cls }) => this.addLine(text, cls));
    s.bus.on('toast', ({ text, cls }) => this.toast(text, cls));
    s.bus.on('levelup', e => this.levelUp(e));
    s.bus.on('public', ({ who, text }) => this.addLine(text, 'public', who));
    s.bus.on('private', ({ dir, who, text }) =>
      this.addLine(text, 'private', dir === 'in' ? `From ${who}` : `To ${who}`));
  }

  bindChatTabs() {
    document.querySelectorAll('.chat-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chat-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filter = btn.dataset.filter;
        this.redrawLog();
      });
    });
  }

  bindDismiss() {
    window.addEventListener('mousedown', e => {
      if (this.ctxOpen && !this.ctx.contains(e.target)) this.closeCtx();
    }, true);
    window.addEventListener('blur', () => this.closeCtx());
  }

  /* ---------------- chat ------------------------------------ */

  addLine(text, cls = 'game', who = null) {
    this.lines.push({ text, cls, who });
    if (this.lines.length > 300) this.lines.shift();
    if (this.matches(cls)) {
      this.log.appendChild(this.lineEl({ text, cls, who }));
      while (this.log.childElementCount > 300) this.log.removeChild(this.log.firstChild);
      this.log.scrollTop = this.log.scrollHeight;
    }
  }

  matches(cls) {
    if (this.filter === 'all') return true;
    if (this.filter === 'public') return cls === 'public';
    if (this.filter === 'private') return cls === 'private';
    if (this.filter === 'quest') return cls === 'quest';
    return cls !== 'public' && cls !== 'private';
  }

  lineEl(l) {
    const div = document.createElement('div');
    div.className = 'line ' + l.cls;
    if (l.who) {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = l.who + ':';
      div.append(who, ' ');
    }

    // only players get effects; a system line saying "red:" means "red:"
    const fx = l.cls === 'public' || l.cls === 'private'
      ? parseChat(l.text) : { colour: null, motion: null, text: l.text };

    if (!fx.colour && !fx.motion) {
      div.append(fx.text);
      return div;
    }

    /*
     * One span per character with a staggered animation delay: that is what
     * makes a wave travel along the word instead of the whole line bouncing
     * as a block. The CSS does the moving, so an old line costs nothing.
     */
    const wrap = document.createElement('span');
    wrap.className = 'fx' +
      (fx.colour ? ' fx-' + fx.colour : '') +
      (fx.motion ? ' fx-' + fx.motion : '');
    [...fx.text].forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch;
      s.style.animationDelay = `${(-i * 0.06).toFixed(2)}s`;
      wrap.appendChild(s);
    });
    div.appendChild(wrap);
    return div;
  }

  redrawLog() {
    this.log.innerHTML = '';
    for (const l of this.lines) {
      if (this.matches(l.cls)) this.log.appendChild(this.lineEl(l));
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  /* ---------------- toasts / level up ----------------------- */

  toast(text, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  levelUp({ skill, level }) {
    import('../data/skills.js').then(({ SKILL_BY_ID }) => {
      const s = SKILL_BY_ID[skill];
      this.levelup.hidden = false;
      this.levelup.querySelector('.lu-icon').textContent = s.icon;
      this.levelup.querySelector('.lu-text').innerHTML =
        `Congratulations, you just advanced a <b>${s.name}</b> level.<br>You are now level <b>${level}</b>.`;
      clearTimeout(this._luTimer);
      this._luTimer = setTimeout(() => { this.levelup.hidden = true; }, 3400);
      this.addLine(`Congratulations, you just advanced a ${s.name} level. You are now level ${level}.`, 'good');
    });
  }

  /* ---------------- orbs ------------------------------------ */

  updateOrbs() {
    const s = this.state, p = s.player;
    const set = (id, frac, val) => {
      const el = document.getElementById(id);
      const fill = el.querySelector('.orb-fill');
      fill.style.strokeDashoffset = String(107 * (1 - clamp(frac, 0, 1)));
      el.querySelector('.orb-val').textContent = val;
      return el;
    };
    const hp = set('orb-hp', p.hp / p.maxHp, Math.ceil(p.hp));
    hp.classList.toggle('low', p.hp / p.maxHp < 0.25);
    set('orb-vigil', s.vigil.points / Math.max(1, s.vigil.max), Math.ceil(s.vigil.points));
    const run = set('orb-run', p.energy / 100, Math.round(p.energy));
    run.classList.toggle('active', p.running);

    const region = this._region;
    if (region) document.getElementById('hud-region').textContent = region;
  }

  setRegion(name) {
    this._region = name;
    document.getElementById('hud-region').textContent = name;
  }

  /* ---------------- tooltip --------------------------------- */

  showTooltip(x, y, verb, obj) {
    if (!this.state.settings.showTooltips) return this.hideTooltip();
    this.tooltip.innerHTML = `<span class="tt-verb">${escapeHtml(verb)}</span> <span class="tt-obj">${escapeHtml(obj)}</span>`;
    this.tooltip.classList.add('on');
    const r = this.stage.getBoundingClientRect();
    const w = this.tooltip.offsetWidth, h = this.tooltip.offsetHeight;
    this.tooltip.style.left = clamp(x + 14, 0, r.width - w - 4) + 'px';
    this.tooltip.style.top = clamp(y + 16, 0, r.height - h - 4) + 'px';
  }

  hideTooltip() { this.tooltip.classList.remove('on'); }

  /* ---------------- context menu ---------------------------- */

  /** entries: [{ label, obj, run }] - `obj` is coloured gold. */
  openCtx(x, y, entries) {
    if (!entries.length) return;
    this.ctxList.innerHTML = '';
    for (const e of entries) {
      const li = document.createElement('li');
      li.innerHTML = escapeHtml(e.label) +
        (e.obj ? ` <span class="ctx-obj">${escapeHtml(e.obj)}</span>` : '');
      li.addEventListener('click', ev => {
        ev.stopPropagation();
        this.closeCtx();
        e.run();
      });
      this.ctxList.appendChild(li);
    }
    this.ctx.hidden = false;
    this.ctxOpen = true;
    const r = this.stage.getBoundingClientRect();
    const w = this.ctx.offsetWidth, h = this.ctx.offsetHeight;
    this.ctx.style.left = clamp(x, 2, r.width - w - 4) + 'px';
    this.ctx.style.top = clamp(y, 2, r.height - h - 4) + 'px';
    this.hideTooltip();
  }

  closeCtx() {
    this.ctx.hidden = true;
    this.ctxOpen = false;
  }
}

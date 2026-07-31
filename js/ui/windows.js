/* ============================================================
   Overlay windows - dialogue, bank, shop, and production
   ============================================================ */

import { ITEMS, itemName } from '../data/items.js';
import { RECIPES, STATION_TITLE, STATION_SKILL } from '../data/recipes.js';
import { SHOPS, buyPrice, sellPrice } from '../data/shops.js';
import { SKILL_BY_ID } from '../data/skills.js';
import { skillGuide, KIND_LABEL } from '../game/skillguide.js';
import { fmt, fmtStack, escapeHtml } from '../util.js';
import { iconImg } from '../engine/icons.js';
import { invCount, baseLevel, log } from '../game/state.js';

export class Windows {
  constructor(state, world, hud, panels, net) {
    this.state = state;
    this.world = world;
    this.hud = hud;
    this.panels = panels;
    this.net = net;
    this.stage = document.getElementById('stage');
    this.overlay = null;
    this.dlg = null;
    this.qty = 1;

    // Which interface to open is the server's call; main.js routes that.
    // These only keep an already-open window in step with new state.
    state.bus.on('inv', () => this.refreshOpen());
    state.bus.on('bank', () => this.refreshOpen());

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.closeAll();
    });
  }

  get anyOpen() { return !!this.overlay || !!this.dlg; }

  closeAll() {
    this.dismiss();
    this.closeDialogue();
  }

  /**
   * Closing a window on purpose, as opposed to tearing it down to rebuild it.
   * Only this path runs the window's parting shot - walking away from a trade
   * has to decline it, and rebuilding the window every time an offer changes
   * must not.
   */
  dismiss() {
    const open = this._open;
    this.closeOverlay();
    if (open && open.onClose) open.onClose();
  }

  closeOverlay() {
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    this._open = null;
  }

  refreshOpen() {
    if (!this._open) return;
    const { kind, arg } = this._open;
    if (kind === 'bank') this.openBank();
    else if (kind === 'shop') this.openShop(arg);
    else if (kind === 'make') this.openMake(arg);
    else if (kind === 'guide') this.openSkillGuide(arg);
    else if (kind === 'trade') this.openTrade(this.state.trade);
  }

  /* ---------------- shell ----------------------------------- */

  /**
   * `open` records which interface this is so refreshOpen can rebuild it.
   * It has to be set here rather than by the caller: closeOverlay clears it,
   * and the first thing this does is close whatever was open.
   */
  frame(title, bodyBuilder, note, open) {
    this.closeOverlay();
    this._open = open || null;
    const ov = document.createElement('div');
    ov.id = 'overlay';
    const win = document.createElement('div');
    win.className = 'window';

    const head = document.createElement('div');
    head.className = 'win-head';
    head.innerHTML = `<span class="win-title">${escapeHtml(title)}</span>`;
    const close = document.createElement('div');
    close.className = 'win-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.dismiss());
    head.appendChild(close);

    const body = document.createElement('div');
    body.className = 'win-body';
    bodyBuilder(body);

    win.append(head, body);
    if (note) {
      const n = document.createElement('div');
      n.className = 'win-note';
      n.textContent = note;
      win.appendChild(n);
    }
    ov.appendChild(win);
    ov.addEventListener('mousedown', e => { if (e.target === ov) this.dismiss(); });
    this.stage.appendChild(ov);
    this.overlay = ov;
    return body;
  }

  /* ---------------- dialogue -------------------------------- */

  /**
   * Dialogue is resolved on the server, because choosing an option can start
   * a quest or hand over an item. The client only paints the node it is sent
   * and reports which option was clicked.
   */
  showDialogue(msg) {
    if (!this.dlg) {
      const box = document.createElement('div');
      box.id = 'dialogue';
      box.innerHTML =
        `<div class="dlg-head">
           <div class="dlg-face"></div>
           <div class="dlg-name"></div>
         </div>
         <div class="dlg-text"></div>
         <ul class="dlg-opts"></ul>
         <div class="dlg-cont" hidden>Click to continue &rsaquo;</div>`;
      this.stage.appendChild(box);
      this.dlg = box;
    }

    this.dlg.querySelector('.dlg-face').textContent = msg.face === 'patient' ? '🛏️' : '🧑‍⚕️';
    this.dlg.querySelector('.dlg-name').textContent = msg.npc || '';
    this.dlg.querySelector('.dlg-text').textContent = msg.text || '';

    const opts = this.dlg.querySelector('.dlg-opts');
    const cont = this.dlg.querySelector('.dlg-cont');
    opts.innerHTML = '';

    if (msg.opts && msg.opts.length) {
      cont.hidden = true;
      for (const o of msg.opts) {
        const li = document.createElement('li');
        li.textContent = o.label;
        li.addEventListener('click', () => this.net.dialogue(o.i));
        opts.appendChild(li);
      }
    } else {
      cont.hidden = false;
      cont.onclick = () => this.net.dialogue(null);
    }
  }

  closeDialogue() {
    if (this.dlg) { this.dlg.remove(); this.dlg = null; }
  }

  /* ---------------- bank ------------------------------------ */

  openBank() {
    const s = this.state;

    this.frame('Bank of Xavin\'s Throat', body => {
      const cols = document.createElement('div');
      cols.className = 'win-cols';

      const left = document.createElement('div');
      left.appendChild(sub('Vault — click to withdraw one, right-click for more'));
      const bank = document.createElement('div');
      bank.className = 'bank-grid';

      if (!s.bank.length) {
        left.appendChild(note('Your vault is empty. Deposit something and Hollis will count it twice.'));
      }
      s.bank.forEach((b, i) => {
        const d = slotEl(b.id, b.n, true);
        d.addEventListener('click', () => this.net.bank('wd', { idx: i, n: 1 }));
        d.addEventListener('contextmenu', e => {
          e.preventDefault();
          const r = this.stage.getBoundingClientRect();
          this.hud.openCtx(e.clientX - r.left, e.clientY - r.top, [
            { label: 'Withdraw 1', obj: itemName(b.id), run: () => this.net.bank('wd', { idx: i, n: 1 }) },
            { label: 'Withdraw 5', obj: '', run: () => this.net.bank('wd', { idx: i, n: 5 }) },
            { label: 'Withdraw 10', obj: '', run: () => this.net.bank('wd', { idx: i, n: 10 }) },
            { label: 'Withdraw all', obj: '', run: () => this.net.bank('wd', { idx: i, n: b.n }) },
            { label: 'Examine', obj: itemName(b.id), run: () => log(s, ITEMS[b.id].examine || '') }
          ]);
        });
        bank.appendChild(d);
      });
      left.appendChild(bank);

      const right = document.createElement('div');
      right.appendChild(sub('Carrying — click to deposit'));
      const inv = document.createElement('div');
      inv.className = 'inv-grid';
      s.inventory.forEach((it, i) => {
        if (!it) { inv.appendChild(emptySlot()); return; }
        const d = slotEl(it.id, it.n);
        d.addEventListener('click', () => this.net.bank('dep', { idx: i, n: 1 }));
        d.addEventListener('contextmenu', e => {
          e.preventDefault();
          const r = this.stage.getBoundingClientRect();
          this.hud.openCtx(e.clientX - r.left, e.clientY - r.top, [
            { label: 'Deposit 1', obj: itemName(it.id), run: () => this.net.bank('dep', { idx: i, n: 1 }) },
            { label: 'Deposit 5', obj: '', run: () => this.net.bank('dep', { idx: i, n: 5 }) },
            { label: 'Deposit all', obj: '', run: () => this.net.bank('depall', { id: it.id }) }
          ]);
        });
        inv.appendChild(d);
      });
      right.appendChild(inv);

      const depAll = document.createElement('button');
      depAll.className = 'btn';
      depAll.style.width = '100%';
      depAll.style.marginTop = '8px';
      depAll.textContent = 'Deposit everything';
      depAll.addEventListener('click', () => this.net.bank('depeverything'));
      right.appendChild(depAll);

      cols.append(left, right);
      body.appendChild(cols);
    }, `${s.bank.length} of 320 vault slots used`, { kind: 'bank' });
  }

  /* ---------------- trade ----------------------------------- */

  /**
   * The two-screen trade. The server owns every number on it; this only draws
   * what it was last told and reports clicks, which is why an offer that
   * changed on the other side of the ward turns up here without being asked
   * for.
   */
  openTrade(t) {
    if (!t || !t.open) return;
    const s = this.state;
    const mine = (t.mine || []).map(e => ({ id: e[0], n: e[1] }));
    const theirs = (t.theirs || []).map(e => ({ id: e[0], n: e[1] }));
    const stage2 = t.stage === 2;

    const title = stage2
      ? `Confirm trade with ${t.with}`
      : `Trading with ${t.with}`;

    const body = this.frame(title, body => {
      const cols = document.createElement('div');
      cols.className = 'trade-cols';

      cols.appendChild(this.tradeSide('Your offer', mine, !stage2, t));
      cols.appendChild(this.tradeSide(`${t.with}'s offer`, theirs, false, t));
      body.appendChild(cols);

      /* -- screen one keeps your pack in reach -- */
      if (!stage2) {
        body.appendChild(sub('Your pack — click to offer one, right-click for more'));
        const inv = document.createElement('div');
        inv.className = 'inv-grid trade-inv';
        s.inventory.forEach((it, i) => {
          if (!it) { inv.appendChild(emptySlot()); return; }
          const def = ITEMS[it.id];
          const d = slotEl(it.id, it.n);
          if (def.questItem || def.untradeable) d.classList.add('untradeable');
          d.addEventListener('pointerenter', e => this.hud.itemTip(e, it.id, it.n));
          d.addEventListener('pointermove', e => this.hud.moveItemTip(e));
          d.addEventListener('pointerleave', () => this.hud.hideItemTip());
          d.addEventListener('click', () => this.net.tradeOffer(i, 1));
          d.addEventListener('contextmenu', e => {
            e.preventDefault();
            this.qtyMenu(e, def, 'Offer', n => this.net.tradeOffer(i, n), it.n);
          });
          inv.appendChild(d);
        });
        body.appendChild(inv);
      } else {
        body.appendChild(note(
          'Look carefully. Once you both accept this screen the items change hands.'));
      }

      /* -- acceptance -- */
      const row = document.createElement('div');
      row.className = 'trade-actions';

      const status = document.createElement('div');
      status.className = 'trade-status';
      status.innerHTML =
        `<span class="${t.iAccept ? 'yes' : 'no'}">You: ${t.iAccept ? 'accepted' : 'waiting'}</span>` +
        `<span class="${t.theyAccept ? 'yes' : 'no'}">${escapeHtml(t.with)}: ${t.theyAccept ? 'accepted' : 'waiting'}</span>`;

      const accept = document.createElement('button');
      accept.className = 'btn primary';
      accept.textContent = stage2 ? 'Accept trade' : 'Accept';
      accept.disabled = !!t.iAccept;
      accept.addEventListener('click', () => {
        accept.disabled = true;
        this.net.tradeAccept(t.stage);
      });

      const decline = document.createElement('button');
      decline.className = 'btn danger';
      decline.textContent = 'Decline';
      decline.addEventListener('click', () => this.net.tradeDecline());

      row.append(status, accept, decline);
      body.appendChild(row);
    },
    stage2
      ? `Screen two of two — nothing has moved yet.`
      : `${t.with} has ${t.theirFree} free slot${t.theirFree === 1 ? '' : 's'}.`,
    { kind: 'trade', onClose: () => this.net.tradeDecline() });

    // wider than the other interfaces, because it has to show two packs at once
    body.parentElement.classList.add('trade-window');
  }

  /** The server ended the trade; take the window down without declining again. */
  closeTrade() {
    if (this._open && this._open.kind === 'trade') this.closeOverlay();
  }

  tradeSide(heading, entries, editable, t) {
    const col = document.createElement('div');
    col.appendChild(sub(heading));
    const grid = document.createElement('div');
    grid.className = 'trade-grid';

    entries.forEach((e, i) => {
      const def = ITEMS[e.id];
      const d = slotEl(e.id, e.n, true);
      d.addEventListener('pointerenter', ev => this.hud.itemTip(ev, e.id, e.n));
      d.addEventListener('pointermove', ev => this.hud.moveItemTip(ev));
      d.addEventListener('pointerleave', () => this.hud.hideItemTip());
      if (editable) {
        d.addEventListener('click', () => this.net.tradeWithdraw(i, 1));
        d.addEventListener('contextmenu', ev => {
          ev.preventDefault();
          this.qtyMenu(ev, def, 'Take back', n => this.net.tradeWithdraw(i, n), e.n);
        });
      }
      grid.appendChild(d);
    });
    // a fixed number of empty slots, so the panel does not jump about
    for (let i = entries.length; i < 12; i++) grid.appendChild(emptySlot());
    col.appendChild(grid);

    const total = entries.reduce((a, e) => a + (ITEMS[e.id]?.value || 0) * e.n, 0);
    col.appendChild(el('div', 'trade-total',
      entries.length ? `${entries.length} lot${entries.length === 1 ? '' : 's'} · about ${fmt(total)} gp` : 'Nothing offered'));
    return col;
  }

  /** 1 / 5 / 10 / All, the quantities every interface in the game offers. */
  qtyMenu(e, def, verb, run, max) {
    const r = this.stage.getBoundingClientRect();
    const entries = [1, 5, 10].filter(n => n <= max || n === 1)
      .map(n => ({ label: `${verb} ${n}`, obj: n === 1 ? def.name : '', run: () => run(n) }));
    entries.push({ label: `${verb} all`, obj: '', run: () => run(max) });
    entries.push({ label: 'Examine', obj: def.name, run: () => log(this.state, def.examine || def.name) });
    this.hud.openCtx(e.clientX - r.left, e.clientY - r.top, entries);
  }

  /* ---------------- shop ------------------------------------ */

  openShop(id) {
    const s = this.state;
    const shop = SHOPS[id];
    if (!shop) return;

    this.frame(shop.name, body => {
      const cols = document.createElement('div');
      cols.className = 'win-cols';

      const left = document.createElement('div');
      left.appendChild(sub('For sale — click to buy one'));
      const grid = document.createElement('div');
      grid.className = 'shop-grid';
      for (const [itemId, stockN] of shop.stock) {
        const def = ITEMS[itemId];
        if (!def) continue;
        const price = buyPrice(shop, def.value);
        const d = slotEl(itemId, stockN, true);
        d.title = `${def.name}\n${fmt(price)} gp\n\n${def.examine || ''}`;
        d.addEventListener('click', () => this.net.buy(shop.id, itemId, 1));
        d.addEventListener('contextmenu', e => {
          e.preventDefault();
          const r = this.stage.getBoundingClientRect();
          this.hud.openCtx(e.clientX - r.left, e.clientY - r.top, [
            { label: 'Buy 1', obj: def.name, run: () => this.net.buy(shop.id, itemId, 1) },
            { label: 'Buy 5', obj: '', run: () => this.net.buy(shop.id, itemId, 5) },
            { label: 'Buy 10', obj: '', run: () => this.net.buy(shop.id, itemId, 10) },
            { label: `Value: ${fmt(price)} gp`, obj: '', run: () => {} },
            { label: 'Examine', obj: def.name, run: () => log(s, def.examine || '') }
          ]);
        });
        grid.appendChild(d);
      }
      left.appendChild(grid);

      const right = document.createElement('div');
      right.appendChild(sub('Your pack — click to sell'));
      const inv = document.createElement('div');
      inv.className = 'inv-grid';
      s.inventory.forEach((it, i) => {
        if (!it) { inv.appendChild(emptySlot()); return; }
        const def = ITEMS[it.id];
        const price = def.questItem ? 0 : sellPrice(shop, def.value);
        const d = slotEl(it.id, it.n);
        d.title = `${def.name}\nSells for ${fmt(price)} gp`;
        d.addEventListener('click', () => this.net.sell(shop.id, i, 1));
        d.addEventListener('contextmenu', e => {
          e.preventDefault();
          const r = this.stage.getBoundingClientRect();
          this.hud.openCtx(e.clientX - r.left, e.clientY - r.top, [
            { label: 'Sell 1', obj: def.name, run: () => this.net.sell(shop.id, i, 1) },
            { label: 'Sell 5', obj: '', run: () => this.net.sell(shop.id, i, 5) },
            { label: 'Sell all', obj: '', run: () => this.net.sell(shop.id, i, it.n) },
            { label: 'Examine', obj: def.name, run: () => log(s, def.examine || '') }
          ]);
        });
        inv.appendChild(d);
      });
      right.appendChild(inv);

      cols.append(left, right);
      body.appendChild(cols);
    }, `${shop.greeting}   —   You have ${fmt(invCount(s, 'coins'))} gp`,
       { kind: 'shop', arg: id });
  }

  /**
   * What a skill unlocks, level by level, with the ones you can already do
   * marked. Everything shown here is read from the same data the game runs
   * on, so it cannot drift out of date.
   */
  openSkillGuide(skillId) {
    const s = this.state;
    const sk = SKILL_BY_ID[skillId];
    if (!sk) return;
    const lvl = baseLevel(s, skillId);
    const rows = skillGuide(skillId);

    this.frame(`${sk.name} — what it unlocks`, body => {
      if (!rows.length) {
        body.appendChild(note(
          `${sk.name} has nothing to unlock — it is trained by doing, and it ` +
          `raises what you can already do.`));
        return;
      }

      const list = document.createElement('div');
      list.className = 'guide-list';
      let lastBand = null;

      for (const r of rows) {
        const have = lvl >= r.level;
        // a heading each time the required level changes, like a level table
        if (r.level !== lastBand) {
          lastBand = r.level;
          const band = document.createElement('div');
          band.className = 'guide-band' + (have ? ' have' : '');
          band.textContent = `Level ${r.level}`;
          list.appendChild(band);
        }

        const row = document.createElement('div');
        row.className = 'guide-row' + (have ? '' : ' locked');
        if (r.id && ITEMS[r.id]) {
          const ic = document.createElement('div');
          ic.className = 'guide-icon';
          ic.appendChild(iconImg(r.id, 26));
          row.appendChild(ic);
          ic.addEventListener('pointerenter', e => this.hud.itemTip(e, r.id));
          ic.addEventListener('pointermove', e => this.hud.moveItemTip(e));
          ic.addEventListener('pointerleave', () => this.hud.hideItemTip());
        } else {
          row.appendChild(el('div', 'guide-icon glyph', KIND_GLYPH[r.kind] || '•'));
        }

        const mid = document.createElement('div');
        mid.className = 'guide-body';
        mid.append(el('div', 'guide-name', r.name));
        mid.append(el('div', 'guide-detail',
          `${KIND_LABEL[r.kind]}${r.detail ? ' · ' + r.detail : ''}`));
        row.appendChild(mid);

        if (r.xp) row.appendChild(el('div', 'guide-xp', `${r.xp} xp`));
        list.appendChild(row);
      }
      body.appendChild(list);
    }, `You are level ${lvl}. ${rows.filter(r => lvl >= r.level).length} of ` +
       `${rows.length} unlocked.`, { kind: 'guide', arg: skillId });
  }

  openMake(station) {
    const s = this.state;
    const list = RECIPES[station];
    if (!list) return;
    const skill = STATION_SKILL[station];
    const lvl = baseLevel(s, skill);

    this.frame(STATION_TITLE[station] || 'Make', body => {
      const qtyRow = document.createElement('div');
      qtyRow.className = 'qty-row';
      for (const q of [1, 5, 10, 'All']) {
        const b = document.createElement('button');
        b.className = 'btn' + (this.qty === q ? ' on' : '');
        b.textContent = q;
        b.addEventListener('click', () => { this.qty = q; this.openMake(station); });
        qtyRow.appendChild(b);
      }
      body.appendChild(qtyRow);

      const wrap = document.createElement('div');
      wrap.className = 'make-list';

      for (const r of list) {
        const out = ITEMS[r.out];
        if (!out) continue;
        const levelOk = lvl >= r.level;
        const haveAll = Object.entries(r.need).every(([id, n]) => invCount(s, id) >= n);
        const row = document.createElement('div');
        row.className = 'make-row' + (levelOk && haveAll ? '' : ' disabled');

        const ic = document.createElement('div');
        ic.className = 'mk-icon';
        ic.appendChild(iconImg(r.out, 34));

        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'mk-body';
        const needTxt = Object.entries(r.need)
          .map(([id, n]) => `${n} x ${itemName(id)} (${invCount(s, id)})`).join(', ');
        bodyDiv.innerHTML =
          `<div class="mk-name">${escapeHtml(out.name)}${r.count > 1 ? ' x' + r.count : ''}</div>` +
          `<div class="mk-need">${levelOk ? '' : `Requires ${SKILL_BY_ID[skill].name} ${r.level} — `}${escapeHtml(needTxt)}</div>`;

        const xp = document.createElement('div');
        xp.className = 'mk-xp';
        xp.textContent = `${r.xp} xp`;

        row.append(ic, bodyDiv, xp);
        if (levelOk && haveAll) {
          row.addEventListener('click', () => this.net.craft(station, r.out, this.qty));
        } else if (!levelOk) {
          row.addEventListener('click', () =>
            log(s, `I need ${SKILL_BY_ID[skill].name} level ${r.level} for that.`, 'bad'));
        }
        wrap.appendChild(row);
      }
      body.appendChild(wrap);
    }, `${SKILL_BY_ID[skill].name} level ${lvl}`, { kind: 'make', arg: station });
  }

}

/* ---------------- helpers ----------------------------------- */

function slotEl(id, n, showQty) {
  const d = document.createElement('div');
  d.className = 'slot filled';
  d.appendChild(iconImg(id, 34));
  const def = ITEMS[id];
  if ((def?.stack || showQty) && n > 1) {
    const q = document.createElement('span');
    q.className = 'qty' + (n >= 100000 ? ' huge' : n >= 10000 ? ' big' : '');
    q.textContent = n === 0 ? '∞' : fmtStack(n);
    d.appendChild(q);
  }
  if (!d.title) d.title = def?.name || id;
  return d;
}

function emptySlot() {
  const d = document.createElement('div');
  d.className = 'slot empty';
  return d;
}

function sub(text) {
  const d = document.createElement('div');
  d.className = 'sub-head';
  d.textContent = text;
  return d;
}

function note(text) {
  const d = document.createElement('div');
  d.className = 'empty-note';
  d.textContent = text;
  return d;
}

function el(tag, cls = '', text = '') {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text) d.textContent = text;
  return d;
}

const KIND_GLYPH = { make: '🔨', gather: '🌿', equip: '🥼', spell: '✨', vigil: '🕯️' };

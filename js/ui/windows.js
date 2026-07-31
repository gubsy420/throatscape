/* ============================================================
   Overlay windows - dialogue, bank, shop, and production
   ============================================================ */

import { DIALOGUE, QUEST_BY_ID } from '../data/quests.js';
import { NPCS } from '../data/npcs.js';
import { ITEMS, itemName } from '../data/items.js';
import { RECIPES, STATION_TITLE, STATION_SKILL } from '../data/recipes.js';
import { SHOPS, buyPrice, sellPrice } from '../data/shops.js';
import { SKILL_BY_ID } from '../data/skills.js';
import { fmt, fmtStack, escapeHtml, clamp, chance } from '../util.js';
import { iconImg } from '../engine/icons.js';
import {
  addItem, removeItem, invCount, canHold, freeSlots, addXp, baseLevel,
  bankDeposit, bankDepositAll, bankWithdraw, log, toast, floater
} from '../game/state.js';
import { makeQuestApi } from '../game/questapi.js';

export class Windows {
  constructor(state, world, hud, panels) {
    this.state = state;
    this.world = world;
    this.hud = hud;
    this.panels = panels;
    this.stage = document.getElementById('stage');
    this.overlay = null;
    this.dlg = null;
    this.qty = 1;

    state.bus.on('openbank', () => this.openBank());
    state.bus.on('openshop', id => this.openShop(id));
    state.bus.on('openmake', st => this.openMake(st));
    state.bus.on('inv', () => this.refreshOpen());
    state.bus.on('bank', () => this.refreshOpen());

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.closeAll();
    });
  }

  get anyOpen() { return !!this.overlay || !!this.dlg; }

  closeAll() {
    this.closeOverlay();
    this.closeDialogue();
  }

  closeOverlay() {
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    this._open = null;
  }

  refreshOpen() {
    if (!this._open) return;
    const { kind, arg } = this._open;
    if (kind === 'bank') this.openBank(true);
    else if (kind === 'shop') this.openShop(arg, true);
    else if (kind === 'make') this.openMake(arg, true);
  }

  /* ---------------- shell ----------------------------------- */

  frame(title, bodyBuilder, note) {
    this.closeOverlay();
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
    close.addEventListener('click', () => this.closeOverlay());
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
    ov.addEventListener('mousedown', e => { if (e.target === ov) this.closeOverlay(); });
    this.stage.appendChild(ov);
    this.overlay = ov;
    return body;
  }

  /* ---------------- dialogue -------------------------------- */

  openDialogue(npcId) {
    const d = NPCS[npcId];
    if (!d || !d.talk) return false;
    const tree = DIALOGUE[d.talk];
    if (!tree) return false;

    this.closeDialogue();
    this.tree = tree;
    this.npcDef = d;
    this.g = makeQuestApi(this.state);

    const box = document.createElement('div');
    box.id = 'dialogue';
    box.innerHTML =
      `<div class="dlg-head">
         <div class="dlg-face">${d.art?.k === 'patient' ? '🛏️' : '🧑‍⚕️'}</div>
         <div class="dlg-name">${escapeHtml(d.name)}</div>
       </div>
       <div class="dlg-text"></div>
       <ul class="dlg-opts"></ul>
       <div class="dlg-cont" hidden>Click to continue &rsaquo;</div>`;
    this.stage.appendChild(box);
    this.dlg = box;

    const startId = typeof tree.start === 'function' ? tree.start(this.g) : tree.start;
    this.gotoNode(startId);
    return true;
  }

  gotoNode(id) {
    if (!id || id === 'end') return this.closeDialogue();
    const node = this.tree.nodes[id];
    if (!node) return this.closeDialogue();

    if (node.act) node.act(this.g);

    const text = typeof node.text === 'function' ? node.text(this.g) : node.text;
    if (!text) return this.gotoNode(node.to);      // pure action nodes fall through

    const t = this.dlg.querySelector('.dlg-text');
    const opts = this.dlg.querySelector('.dlg-opts');
    const cont = this.dlg.querySelector('.dlg-cont');
    t.textContent = text;
    opts.innerHTML = '';

    const choices = (node.opts || []).filter(o => !o.if || o.if(this.g));
    if (choices.length) {
      cont.hidden = true;
      for (const o of choices) {
        const li = document.createElement('li');
        li.textContent = typeof o.label === 'function' ? o.label(this.g) : o.label;
        li.addEventListener('click', () => {
          if (o.act) o.act(this.g);
          this.gotoNode(o.to);
        });
        opts.appendChild(li);
      }
    } else {
      cont.hidden = false;
      cont.onclick = () => this.gotoNode(node.to);
    }
  }

  closeDialogue() {
    if (this.dlg) { this.dlg.remove(); this.dlg = null; }
  }

  /* ---------------- bank ------------------------------------ */

  openBank(refresh) {
    const s = this.state;
    this._open = { kind: 'bank' };

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
        d.addEventListener('click', () => bankWithdraw(s, i, 1));
        d.addEventListener('contextmenu', e => {
          e.preventDefault();
          const r = this.stage.getBoundingClientRect();
          this.hud.openCtx(e.clientX - r.left, e.clientY - r.top, [
            { label: 'Withdraw 1', obj: itemName(b.id), run: () => bankWithdraw(s, i, 1) },
            { label: 'Withdraw 5', obj: '', run: () => bankWithdraw(s, i, 5) },
            { label: 'Withdraw 10', obj: '', run: () => bankWithdraw(s, i, 10) },
            { label: 'Withdraw all', obj: '', run: () => bankWithdraw(s, i, b.n) },
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
        d.addEventListener('click', () => bankDeposit(s, i, 1));
        d.addEventListener('contextmenu', e => {
          e.preventDefault();
          const r = this.stage.getBoundingClientRect();
          this.hud.openCtx(e.clientX - r.left, e.clientY - r.top, [
            { label: 'Deposit 1', obj: itemName(it.id), run: () => bankDeposit(s, i, 1) },
            { label: 'Deposit 5', obj: '', run: () => bankDeposit(s, i, 5) },
            { label: 'Deposit all', obj: '', run: () => bankDepositAll(s, it.id) }
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
      depAll.addEventListener('click', () => {
        const ids = [...new Set(s.inventory.filter(Boolean).map(x => x.id))];
        for (const id of ids) bankDepositAll(s, id);
      });
      right.appendChild(depAll);

      cols.append(left, right);
      body.appendChild(cols);
    }, `${s.bank.length} of 320 vault slots used`);
  }

  /* ---------------- shop ------------------------------------ */

  openShop(id) {
    const s = this.state;
    const shop = SHOPS[id];
    if (!shop) return;
    this._open = { kind: 'shop', arg: id };

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
        d.addEventListener('click', () => this.buy(shop, itemId, 1));
        d.addEventListener('contextmenu', e => {
          e.preventDefault();
          const r = this.stage.getBoundingClientRect();
          this.hud.openCtx(e.clientX - r.left, e.clientY - r.top, [
            { label: 'Buy 1', obj: def.name, run: () => this.buy(shop, itemId, 1) },
            { label: 'Buy 5', obj: '', run: () => this.buy(shop, itemId, 5) },
            { label: 'Buy 10', obj: '', run: () => this.buy(shop, itemId, 10) },
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
        d.addEventListener('click', () => this.sell(shop, i, 1));
        d.addEventListener('contextmenu', e => {
          e.preventDefault();
          const r = this.stage.getBoundingClientRect();
          this.hud.openCtx(e.clientX - r.left, e.clientY - r.top, [
            { label: 'Sell 1', obj: def.name, run: () => this.sell(shop, i, 1) },
            { label: 'Sell 5', obj: '', run: () => this.sell(shop, i, 5) },
            { label: 'Sell all', obj: '', run: () => this.sell(shop, i, it.n) },
            { label: 'Examine', obj: def.name, run: () => log(s, def.examine || '') }
          ]);
        });
        inv.appendChild(d);
      });
      right.appendChild(inv);

      cols.append(left, right);
      body.appendChild(cols);
    }, `${shop.greeting}   —   You have ${fmt(invCount(s, 'coins'))} gp`);
  }

  buy(shop, itemId, n) {
    const s = this.state;
    const def = ITEMS[itemId];
    const price = buyPrice(shop, def.value);
    let bought = 0;
    for (let i = 0; i < n; i++) {
      if (invCount(s, 'coins') < price) break;
      if (!canHold(s, itemId, 1)) break;
      removeItem(s, 'coins', price);
      addItem(s, itemId, 1);
      bought++;
    }
    if (!bought) {
      log(s, invCount(s, 'coins') < price ? "I can't afford that." : 'My inventory is full.', 'bad');
      return;
    }
    log(s, `You buy ${bought > 1 ? bought + ' x ' : ''}${def.name} for ${fmt(price * bought)} gp.`);
  }

  sell(shop, idx, n) {
    const s = this.state;
    const it = s.inventory[idx];
    if (!it) return;
    const def = ITEMS[it.id];
    if (def.questItem) { log(s, 'They will not take that. Nor should they.', 'bad'); return; }
    const price = sellPrice(shop, def.value);
    const amount = Math.min(n, it.n);
    removeItem(s, it.id, amount);
    addItem(s, 'coins', price * amount);
    log(s, `You sell ${amount > 1 ? amount + ' x ' : ''}${def.name} for ${fmt(price * amount)} gp.`);
  }

  /* ---------------- production ------------------------------ */

  openMake(station) {
    const s = this.state;
    const list = RECIPES[station];
    if (!list) return;
    this._open = { kind: 'make', arg: station };
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
          row.addEventListener('click', () => this.make(station, r));
        } else if (!levelOk) {
          row.addEventListener('click', () =>
            log(s, `I need ${SKILL_BY_ID[skill].name} level ${r.level} for that.`, 'bad'));
        }
        wrap.appendChild(row);
      }
      body.appendChild(wrap);
    }, `${SKILL_BY_ID[skill].name} level ${lvl}`);
  }

  make(station, r) {
    const s = this.state;
    const skill = STATION_SKILL[station];
    let target = this.qty === 'All' ? 999 : this.qty;
    let made = 0, burnt = 0;

    while (made + burnt < target) {
      const haveAll = Object.entries(r.need).every(([id, n]) => invCount(s, id) >= n);
      if (!haveAll) break;
      if (baseLevel(s, skill) < r.level) break;
      if (freeSlots(s) <= 0 && !ITEMS[r.out].stack) break;

      for (const [id, n] of Object.entries(r.need)) removeItem(s, id, n);

      /* cooking can go wrong right up until you stop burning things */
      if (r.burn !== undefined) {
        const lvl = baseLevel(s, skill);
        const stopAt = r.burnFrom + 20;
        const burnChance = lvl >= stopAt ? 0
          : clamp((r.burn / 100) * (1 - (lvl - r.level) / (stopAt - r.level)), 0, 0.6);
        if (chance(burnChance)) {
          addItem(s, 'burnt_offering', 1);
          burnt++;
          continue;
        }
      }

      addItem(s, r.out, r.count);
      addXp(s, skill, r.xp);
      made++;
    }

    if (!made && !burnt) { log(s, 'I have nothing to work with.', 'bad'); return; }
    if (made) {
      log(s, `You make ${made * r.count > 1 ? made * r.count + ' x ' : ''}${ITEMS[r.out].name}.`, 'good');
      floater(s, s.player.x, s.player.y, `+${Math.round(r.xp * made)} ${SKILL_BY_ID[skill].name}`, '#7fbf8f');
    }
    if (burnt) log(s, `You burn ${burnt} of them. The ward will not mind.`, 'bad');
    this.openMake(station);
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

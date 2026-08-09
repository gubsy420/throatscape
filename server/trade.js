/* ============================================================
   Player-to-player trading
   ------------------------------------------------------------
   The two-screen trade from RuneScape 2: offer, both accept,
   then a confirmation screen showing exactly what is about to
   change hands, and both accept again.

   Offered items are held in escrow - taken out of the pack the
   moment they are offered and given back on every path out of
   the trade. Nothing is ever in two places at once, which is
   what stops a disconnect at the wrong moment from either
   duplicating an item or eating it.
   ============================================================ */

import { ITEMS } from '../js/data/items.js';
import { cheb } from '../js/util.js';
import { keyFor } from './accounts.js';
import {
  addItem, removeFrom, invCount, freeSlots, canHoldAll, log
} from '../js/game/state.js';

/** How far apart two nurses may drift before the trade lapses. */
export const TRADE_RANGE = 4;
/** A request nobody answers expires rather than lingering all session. */
export const REQUEST_TICKS = 60;
const MAX_OFFER = 28;

export class Trade {
  constructor(a, b) {
    this.sides = [
      { s: a, offer: [], accepted: false },
      { s: b, offer: [], accepted: false }
    ];
    this.stage = 1;
    a.trade = this;
    b.trade = this;
  }

  side(s) { return this.sides[0].s === s ? this.sides[0] : this.sides[1]; }
  other(s) { return this.sides[0].s === s ? this.sides[1] : this.sides[0]; }
  get a() { return this.sides[0].s; }
  get b() { return this.sides[1].s; }

  /** Any change to either offer drops both acceptances and returns to screen one. */
  disturb() {
    this.stage = 1;
    this.sides[0].accepted = false;
    this.sides[1].accepted = false;
  }
}

/**
 * Everything the sim needs to run trades. Kept apart from Sim itself because
 * it is a self-contained little state machine with one dangerous operation
 * in it, and it is easier to be sure about in isolation.
 */
export class Trades {
  constructor(sim) {
    this.sim = sim;
    this.live = new Set();
  }

  /* ---------------- requesting ---------------------------- */

  /**
   * The classic handshake: asking someone who has already asked you opens the
   * screen. Asking anyone else just tells them you would like to.
   */
  request(s, targetKey) {
    // clicking someone sends their session key; typing /trade sends a name
    const raw = String(targetKey || '').trim();
    const t = this.sim.sessions.get(raw) || this.sim.sessions.get(keyFor(raw));
    if (!t) { log(s.state, `${raw || 'That nurse'} is not on shift.`, 'bad'); return; }
    if (t === s) { log(s.state, 'You cannot trade with yourself.', 'bad'); return; }
    if (s.state.player.dead || t.state.player.dead) return;
    if (s.trade || t.trade) {
      log(s.state, s.trade ? 'You are already trading.' : `${t.name} is busy.`, 'bad');
      return;
    }
    if (cheb(s.p.x, s.p.y, t.p.x, t.p.y) > TRADE_RANGE) {
      log(s.state, `${t.name} is too far away.`, 'bad');
      return;
    }

    const theirs = t.tradeReq;
    if (theirs && theirs.key === s.key && theirs.until > this.sim.tick) {
      t.tradeReq = null;
      s.tradeReq = null;
      this.open(s, t);
      return;
    }

    s.tradeReq = { key: t.key, until: this.sim.tick + REQUEST_TICKS };
    log(s.state, `Sending a trade offer to ${t.name}…`);
    log(t.state, `${s.name} wishes to trade with you.`, 'system');
    t.send({ t: 'tradereq', name: s.name, key: s.key });
  }

  open(a, b) {
    const trade = new Trade(a, b);
    this.live.add(trade);
    for (const side of trade.sides) {
      side.s.send({ t: 'cue', name: 'open' });
      log(side.s.state, `Trading with ${trade.other(side.s).s.name}.`);
    }
    this.push(trade);
  }

  /* ---------------- offering ------------------------------ */

  offer(s, invIdx, n) {
    const trade = s.trade;
    if (!trade) return;
    const st = s.state;
    const slot = st.inventory[invIdx];
    if (!slot) return;
    const def = ITEMS[slot.id];
    if (!def) return;

    if (def.questItem || def.untradeable) {
      log(st, 'That is not mine to give away.', 'bad');
      return;
    }

    const side = trade.side(s);
    // "offer 5" means five of them wherever they are sitting, stackable or not
    const want = Math.max(1, Math.min(n || 1, invCount(st, slot.id)));

    // the offer shows one row per kind, the way the originals did, so five
    // separate bars arrive as "Ironblood bar x 5" rather than five slots
    const existing = side.offer.find(e => e.id === slot.id);
    if (!existing && side.offer.length >= MAX_OFFER) {
      log(st, 'You cannot offer any more than that.', 'bad');
      return;
    }

    const moved = removeFrom(st, invIdx, want);
    if (moved <= 0) return;

    if (existing) existing.n += moved;
    else side.offer.push({ id: slot.id, n: moved });

    trade.disturb();
    this.push(trade);
  }

  withdraw(s, offerIdx, n) {
    const trade = s.trade;
    if (!trade) return;
    const side = trade.side(s);
    const entry = side.offer[offerIdx];
    if (!entry) return;

    const want = Math.max(1, Math.min(n || 1, entry.n));
    const def = ITEMS[entry.id];
    // the items came out of this pack, but something else may have filled it
    const room = def.stack
      ? (freeSlots(s.state) > 0 || invCount(s.state, entry.id) > 0)
      : freeSlots(s.state) >= 1;
    if (!room) { log(s.state, 'My hands are full.', 'bad'); return; }

    const back = def.stack ? want : Math.min(want, freeSlots(s.state));
    addItem(s.state, entry.id, back);
    entry.n -= back;
    if (entry.n <= 0) side.offer.splice(offerIdx, 1);

    trade.disturb();
    this.push(trade);
  }

  /* ---------------- accepting ----------------------------- */

  accept(s, stage) {
    const trade = s.trade;
    if (!trade) return;
    // an accept aimed at the screen you were looking at a moment ago is stale
    if (stage && stage !== trade.stage) return;

    const me = trade.side(s);
    const them = trade.other(s);
    me.accepted = true;

    if (!them.accepted) {
      log(them.s.state, `${s.name} has accepted.`, 'system');
      this.push(trade);
      return;
    }

    if (trade.stage === 1) {
      trade.stage = 2;
      me.accepted = them.accepted = false;
      this.push(trade);
      return;
    }

    this.settle(trade);
  }

  /**
   * The one dangerous moment. Both packs are checked for room before anything
   * moves, so the trade either happens completely or not at all.
   */
  settle(trade) {
    const [x, y] = trade.sides;
    if (!canHoldAll(x.s.state, y.offer) || !canHoldAll(y.s.state, x.offer)) {
      const short = !canHoldAll(x.s.state, y.offer) ? x : y;
      for (const side of trade.sides) {
        log(side.s.state, side === short
          ? 'You do not have enough room for that.'
          : `${short.s.name} does not have enough room for that.`, 'bad');
      }
      trade.disturb();
      this.push(trade);
      return;
    }

    for (const e of y.offer) addItem(x.s.state, e.id, e.n);
    for (const e of x.offer) addItem(y.s.state, e.id, e.n);
    x.offer = [];
    y.offer = [];

    for (const side of trade.sides) {
      log(side.s.state, 'Accepted trade.', 'good');
      side.s.send({ t: 'cue', name: 'coin' });
    }
    this.close(trade, null);
  }

  /* ---------------- ending -------------------------------- */

  decline(s) {
    if (s.trade) this.close(s.trade, `${s.name} declined the trade.`);
  }

  /** Called for every way out: decline, walking off, dying, logging out. */
  close(trade, reason) {
    if (!this.live.has(trade)) return;
    this.live.delete(trade);
    for (const side of trade.sides) {
      this.refund(side);
      side.s.trade = null;
      side.s.send({ t: 'trade', open: false, reason: reason || null });
      if (reason) log(side.s.state, reason, 'system');
    }
  }

  /**
   * Escrowed items come home. Anything that will not fit goes to the ground at
   * the owner's feet rather than being dropped on the floor of the void.
   */
  refund(side) {
    const st = side.s.state;
    for (const e of side.offer) {
      const added = addItem(st, e.id, e.n);
      if (added < e.n) {
        st.ground.push({ id: e.id, n: e.n - added, x: st.player.x, y: st.player.y,
                         ttl: 900, mine: true });
      }
    }
    side.offer = [];
  }

  /** Everything a player has in escrow, for saving alongside the pack. */
  escrowOf(s) {
    return s.trade ? s.trade.side(s).offer.map(e => ({ ...e })) : [];
  }

  /* ---------------- upkeep -------------------------------- */

  tick() {
    for (const trade of [...this.live]) {
      const [x, y] = trade.sides;
      if (x.s.state.player.dead || y.s.state.player.dead) {
        this.close(trade, 'The trade was interrupted.');
        continue;
      }
      if (cheb(x.s.p.x, x.s.p.y, y.s.p.x, y.s.p.y) > TRADE_RANGE) {
        this.close(trade, 'You moved too far apart to trade.');
      }
    }
  }

  /* ---------------- outbound ------------------------------ */

  push(trade) {
    for (const side of trade.sides) {
      const them = trade.other(side.s);
      side.s.send({
        t: 'trade',
        open: true,
        stage: trade.stage,
        with: them.s.name,
        mine: side.offer.map(e => [e.id, e.n]),
        theirs: them.offer.map(e => [e.id, e.n]),
        iAccept: side.accepted ? 1 : 0,
        theyAccept: them.accepted ? 1 : 0,
        theirFree: freeSlots(them.s.state)
      });
    }
  }
}

/*
 * removeStack and removeInstances used to live here. They were the only code in
 * the game that got "n of them, wherever they are sitting, starting with the one
 * you clicked" right, while the bank and the shops each got it wrong in their own
 * way. They are now one removeFrom in js/game/state.js, shared by all three.
 */

/* ============================================================
   What the shops actually have on the shelf
   ------------------------------------------------------------
   `SHOPS` in js/data/shops.js says what a shop sells and how
   many of each it keeps. That number was decorative: the client
   drew it, and buying never touched it, so a shop could sell you
   four hundred ironblood bars out of a stock of fourteen.

   This is the ledger that makes it mean something. It holds the
   live count for every shop, takes one off when somebody buys,
   puts one back when somebody sells, and drifts each line back
   towards the number the shop is supposed to keep.

   It is world state, not player state. One nurse buying the last
   antivenin means the next nurse cannot have it, which is the
   point of a shared world, and it is why this belongs to the Sim
   rather than to a session or a save. A server restart puts every
   shelf back to how it was written, exactly as a world reboot
   does elsewhere.
   ============================================================ */

import { SHOPS } from '../data/shops.js';

/*
 * How long a shelf takes to move one step back towards where it should be.
 * 100 seconds at a 600ms tick, which is slow enough that clearing a shop out
 * is felt and fast enough that it is not a punishment.
 */
export const RESTOCK_TICKS = 167;

/**
 * Everything moves one step per restock, rather than each line keeping its own
 * timer from the moment it was last touched. The difference is invisible at
 * this cadence and it makes the whole ledger one number to reason about.
 */
export class ShopStock {
  constructor() {
    this.live = new Map();      // shopId -> Map(itemId -> count)
    this.lastDrift = 0;
  }

  /**
   * How many the shop is written to keep, or null if it does not stock the
   * item at all. Read from SHOPS every time rather than copied at startup,
   * because content packs push onto those arrays as they load and a pack's
   * new line has to count as much as a hand-written one.
   */
  baseOf(shopId, itemId) {
    const entry = SHOPS[shopId]?.stock.find(([id]) => id === itemId);
    return entry ? entry[1] : null;
  }

  shelf(shopId) {
    if (!this.live.has(shopId)) this.live.set(shopId, new Map());
    return this.live.get(shopId);
  }

  /** What is on the shelf now. Starts at whatever the shop was written with. */
  count(shopId, itemId) {
    const base = this.baseOf(shopId, itemId);
    if (base === null) return 0;
    const shelf = this.shelf(shopId);
    if (!shelf.has(itemId)) shelf.set(itemId, base);
    return shelf.get(itemId);
  }

  /** Takes one off the shelf. False if there was not one to take. */
  take(shopId, itemId) {
    const have = this.count(shopId, itemId);
    if (have <= 0) return false;
    this.shelf(shopId).set(itemId, have - 1);
    return true;
  }

  /**
   * Puts sold goods back on the shelf.
   *
   * Only for things the shop already lists. A shop that accumulated whatever
   * anyone happened to sell it would slowly turn into everyone's overflow
   * bank, and `buy` refuses anything unlisted anyway, so the stock would be
   * unbuyable clutter. Selling an unlisted item still works - the shop just
   * does not put it out again.
   */
  give(shopId, itemId, n = 1) {
    if (this.baseOf(shopId, itemId) === null) return;
    this.shelf(shopId).set(itemId, this.count(shopId, itemId) + n);
  }

  /**
   * One step back towards the written figure, in whichever direction that is.
   *
   * Both directions matter. A cleared-out shelf fills up again, and a shelf
   * piled high by somebody selling their whole pack empties back down - which
   * is what makes `['bones', 0]` in the general store work as written: nobody
   * stocks bones, so they are only ever there because a player sold some, and
   * they go away again afterwards.
   */
  drift(tick) {
    if (tick - this.lastDrift < RESTOCK_TICKS) return false;
    this.lastDrift = tick;

    for (const [shopId, shelf] of this.live) {
      for (const [itemId, have] of shelf) {
        const base = this.baseOf(shopId, itemId);
        if (base === null || have === base) continue;
        shelf.set(itemId, have + (have < base ? 1 : -1));
      }
    }
    return true;
  }

  /** The shop's list with live counts, in the order the shop was written in. */
  listFor(shopId) {
    return (SHOPS[shopId]?.stock || []).map(([id]) => [id, this.count(shopId, id)]);
  }
}

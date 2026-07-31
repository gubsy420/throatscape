/* ============================================================
   Economy - crafting, smelting, cooking, buying and selling
   ------------------------------------------------------------
   Pure state transitions with no interface of their own. These
   used to live inside the shop and production windows; they now
   run on the server, which is the only place allowed to decide
   whether you can afford something.
   ============================================================ */

import { ITEMS, toolName } from '../data/items.js';
import { RECIPES, STATION_SKILL, STATION_TOOL } from '../data/recipes.js';
import { buyPrice, sellPrice } from '../data/shops.js';
import { SKILL_BY_ID } from '../data/skills.js';
import { clamp, chance } from '../util.js';
import {
  addItem, removeItem, invCount, canHold, freeSlots,
  addXp, baseLevel, log, floater, hasTool
} from './state.js';

/** Looks up a recipe by station and output id, so clients can only name one. */
export function findRecipe(station, outId) {
  const list = RECIPES[station];
  if (!list) return null;
  return list.find(r => r.out === outId) || null;
}

/**
 * Makes up to `qty` of a recipe. Returns a summary rather than talking to any
 * interface, so the caller can report it however it likes.
 */
export function craft(state, station, recipe, qty) {
  const skill = STATION_SKILL[station];
  if (!skill || !recipe) return { made: 0, burnt: 0, reason: 'unknown recipe' };

  /*
   * The bench does not do the work by itself. The furnace and the range do -
   * you put the thing in and wait - but the anvil wants a hammer, the cauldron
   * a pestle, and the sewing table a needle, exactly as the shopkeepers say
   * and as the tools' own descriptions have always implied.
   */
  const tool = STATION_TOOL[station];
  if (tool && !hasTool(state, tool)) {
    const reason = `I need ${toolName(tool)} for that.`;
    log(state, reason, 'bad');
    return { made: 0, burnt: 0, reason };
  }

  const target = qty === 'All' || qty === -1 ? 999 : clamp(Number(qty) || 1, 1, 999);
  let made = 0, burnt = 0, reason = null;

  while (made + burnt < target) {
    if (baseLevel(state, skill) < recipe.level) {
      reason = `I need ${SKILL_BY_ID[skill].name} level ${recipe.level} for that.`;
      break;
    }
    const haveAll = Object.entries(recipe.need).every(([id, n]) => invCount(state, id) >= n);
    if (!haveAll) { reason = made || burnt ? null : 'I have nothing to work with.'; break; }
    if (freeSlots(state) <= 0 && !ITEMS[recipe.out].stack) {
      reason = made || burnt ? null : 'My inventory is full.';
      break;
    }

    for (const [id, n] of Object.entries(recipe.need)) removeItem(state, id, n);

    /* cooking can go wrong right up until you stop burning things */
    if (recipe.burn !== undefined) {
      const lvl = baseLevel(state, skill);
      const stopAt = recipe.burnFrom + 20;
      const burnChance = lvl >= stopAt ? 0
        : clamp((recipe.burn / 100) * (1 - (lvl - recipe.level) / (stopAt - recipe.level)), 0, 0.6);
      if (chance(burnChance)) {
        addItem(state, 'burnt_offering', 1);
        burnt++;
        continue;
      }
    }

    addItem(state, recipe.out, recipe.count);
    addXp(state, skill, recipe.xp);
    made++;
  }

  if (made) {
    const total = made * recipe.count;
    log(state, `You make ${total > 1 ? total + ' x ' : ''}${ITEMS[recipe.out].name}.`, 'good');
    floater(state, state.player.x, state.player.y,
      `+${Math.round(recipe.xp * made)} ${SKILL_BY_ID[skill].name}`, '#7fbf8f');
  }
  if (burnt) log(state, `You burn ${burnt} of them. The ward will not mind.`, 'bad');
  if (reason) log(state, reason, 'bad');

  return { made, burnt, reason };
}

/** Buys up to n of an item, stopping when the coins or the space run out. */
export function buy(state, shop, itemId, n) {
  const def = ITEMS[itemId];
  if (!def || !shop) return { bought: 0 };
  if (!shop.stock.some(([id]) => id === itemId)) {
    log(state, 'They do not sell that.', 'bad');
    return { bought: 0 };
  }

  const price = buyPrice(shop, def.value);
  const want = clamp(Number(n) || 1, 1, 1000);
  let bought = 0;

  for (let i = 0; i < want; i++) {
    if (invCount(state, 'coins') < price) break;
    if (!canHold(state, itemId, 1)) break;
    removeItem(state, 'coins', price);
    addItem(state, itemId, 1);
    bought++;
  }

  if (!bought) {
    log(state, invCount(state, 'coins') < price ? "I can't afford that." : 'My inventory is full.', 'bad');
  } else {
    log(state, `You buy ${bought > 1 ? bought + ' x ' : ''}${def.name} for ${price * bought} gp.`);
  }
  return { bought, price };
}

/** Sells from an inventory slot. Quest items are worthless to everyone. */
export function sell(state, shop, invIdx, n) {
  const slot = state.inventory[invIdx];
  if (!slot || !shop) return { sold: 0 };
  const def = ITEMS[slot.id];
  if (def.questItem) {
    log(state, 'They will not take that. Nor should they.', 'bad');
    return { sold: 0 };
  }

  const price = sellPrice(shop, def.value);
  const amount = Math.min(clamp(Number(n) || 1, 1, 100000), slot.n);
  removeItem(state, slot.id, amount);
  addItem(state, 'coins', price * amount);
  log(state, `You sell ${amount > 1 ? amount + ' x ' : ''}${def.name} for ${price * amount} gp.`);
  return { sold: amount, price };
}

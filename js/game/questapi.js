/* ============================================================
   Quest facade - the small, safe surface quest scripts talk to
   ============================================================ */

import { QUEST_BY_ID, DONE } from '../data/quests.js';
import { ITEMS, itemName } from '../data/items.js';
import { SKILL_BY_ID } from '../data/skills.js';
import {
  addItem, removeItem, invCount, hasItem, canHold, addXp, baseLevel,
  questProgress, questStage, questDone, canStartQuest, log, toast, floater
} from './state.js';

export function makeQuestApi(state) {
  const g = {
    state,

    /* -- progress ------------------------------------------ */
    q: id => questProgress(state, id),
    stage: id => questStage(state, id),
    done: id => questDone(state, id),
    canStart: id => canStartQuest(state, id),

    setStage(id, n) {
      questProgress(state, id).stage = n;
      state.bus.emit('quest');
    },

    startQuest(id) {
      const q = questProgress(state, id);
      if (q.stage === 0) {
        q.stage = 1;
        q.n = 0;
        const def = QUEST_BY_ID[id];
        log(state, `Quest started: ${def.name}.`, 'quest');
        toast(state, `Quest started — ${def.name}`);
        state.bus.emit('quest');
      }
    },

    completeQuest(id) {
      const def = QUEST_BY_ID[id];
      const q = questProgress(state, id);
      if (!def || q.stage >= DONE) return;
      q.stage = DONE;

      const r = def.rewards || {};
      for (const sk in (r.xp || {})) addXp(state, sk, r.xp[sk]);
      for (const [item, n] of (r.items || [])) {
        if (!addItem(state, item, n)) {
          state.ground.push({ id: item, n, x: state.player.x, y: state.player.y, ttl: 900, mine: true });
        }
      }
      log(state, `Quest complete: ${def.name}!`, 'quest');
      toast(state, `Quest complete — ${def.name}`, 'good');
      state.bus.emit('questcomplete', { id, quest: def });
      state.bus.emit('quest');
    },

    /* -- items --------------------------------------------- */
    has: (id, n = 1) => hasItem(state, id, n),
    count: id => invCount(state, id),
    take: (id, n = 1) => removeItem(state, id, n),

    give(id, n = 1) {
      if (!canHold(state, id, n)) {
        state.ground.push({ id, n, x: state.player.x, y: state.player.y, ttl: 900, mine: true });
        log(state, `You have no room — the ${itemName(id).toLowerCase()} falls at your feet.`, 'bad');
        return false;
      }
      addItem(state, id, n);
      log(state, `You receive ${n > 1 ? n + ' x ' : ''}${itemName(id)}.`, 'game');
      return true;
    },

    /* -- skills -------------------------------------------- */
    lvl: sk => baseLevel(state, sk),
    xp(sk, amount) {
      addXp(state, sk, amount);
      const s = SKILL_BY_ID[sk];
      floater(state, state.player.x, state.player.y, `+${Math.round(amount)} ${s ? s.name : sk}`, '#7fbf8f');
    },

    /* -- output -------------------------------------------- */
    msg: (t, cls = 'game') => log(state, t, cls),
    quest: t => log(state, t, 'quest'),

    /* -- interfaces ---------------------------------------- */
    openShop: id => state.bus.emit('openshop', id),
    openBank: () => state.bus.emit('openbank')
  };
  return g;
}

/** Fires a hook across every quest; the first handler to claim it wins. */
export function questHook(g, hook, ...args) {
  for (const q of Object.values(QUEST_BY_ID)) {
    const fn = q[hook];
    if (typeof fn === 'function' && fn(g, ...args)) return true;
  }
  return false;
}

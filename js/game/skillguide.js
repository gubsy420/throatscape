/* ============================================================
   Skill guide
   ------------------------------------------------------------
   "What does this skill actually get me?" Everything the answer
   needs is already in the data files - recipes carry a skill and
   a level, scenery carries a skill and a level, and items carry
   a requirement to wear them. This gathers those three sources
   into one list per skill, sorted by level.

   Pure data in, pure data out: no DOM, so the window that draws
   it stays a dumb renderer.
   ============================================================ */

import { ITEMS } from '../data/items.js';
import { OBJ } from '../data/world.js';
import { RECIPES } from '../data/recipes.js';
import { SPELLS, VIGILS } from '../data/magic.js';

/**
 * Every unlock for one skill.
 *
 * @returns {Array<{level, kind, id, name, detail, xp}>} sorted by level
 */
export function skillGuide(skillId) {
  const out = [];

  /* things you make */
  for (const station of Object.keys(RECIPES)) {
    for (const r of RECIPES[station]) {
      if (r.skill !== skillId) continue;
      const made = ITEMS[r.out];
      if (!made) continue;
      out.push({
        level: r.level, kind: 'make', id: r.out,
        name: made.name + (r.count > 1 ? ` × ${r.count}` : ''),
        detail: Object.entries(r.need)
          .map(([id, n]) => `${n} × ${ITEMS[id]?.name || id}`).join(', '),
        xp: r.xp
      });
    }
  }

  /* things you gather */
  for (const type of Object.keys(OBJ)) {
    const d = OBJ[type];
    if (d.skill !== skillId) continue;
    out.push({
      level: d.level, kind: 'gather', id: d.yield || null,
      name: d.name,
      detail: d.herbRoll ? 'various herbs'
            : (d.yield && ITEMS[d.yield]?.name) || d.act,
      xp: d.xp
    });
  }

  /* things you wear or wield */
  for (const id of Object.keys(ITEMS)) {
    const it = ITEMS[id];
    const need = it.req?.[skillId];
    if (!need) continue;
    out.push({
      level: need, kind: 'equip', id,
      name: it.name,
      detail: it.slot ? SLOTS[it.slot] || it.slot : 'used',
      xp: 0
    });
  }

  /* things you cast */
  const spellSkill = skillId === 'anatomancy' ? SPELLS : skillId === 'vigil' ? VIGILS : null;
  for (const sp of spellSkill || []) {
    out.push({
      level: sp.level, kind: skillId === 'vigil' ? 'vigil' : 'spell', id: null,
      name: sp.name,
      detail: sp.blurb || sp.desc || '',
      xp: sp.xp || 0
    });
  }

  // level first, then alphabetically, so a level band reads as one block
  out.sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name));
  return out;
}

const SLOTS = {
  head: 'worn on the head', cape: 'worn as a cape', neck: 'worn at the neck',
  weapon: 'wielded', body: 'worn on the body', shield: 'held in the off hand',
  legs: 'worn on the legs', hands: 'worn on the hands', feet: 'worn on the feet',
  ring: 'worn on a finger', ammo: 'loaded'
};

export const KIND_LABEL = {
  make: 'Make', gather: 'Gather', equip: 'Equip', spell: 'Cast', vigil: 'Light'
};

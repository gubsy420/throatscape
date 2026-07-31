/* ============================================================
   Skills - definitions and the experience curve
   ============================================================ */

export const MAX_LEVEL = 99;

/**
 * The classic experience curve: xp(L) = floor( sum_{n=1}^{L-1} floor(n + 300*2^(n/7)) / 4 )
 * Level 99 lands on 13,034,431.
 */
export const XP_TABLE = (() => {
  const t = [0, 0];
  let acc = 0;
  for (let n = 1; n < MAX_LEVEL; n++) {
    acc += Math.floor(n + 300 * Math.pow(2, n / 7));
    t[n + 1] = Math.floor(acc / 4);
  }
  return t;
})();

export const MAX_XP = 200000000;

export function levelForXp(xp) {
  let lo = 1, hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (XP_TABLE[mid] <= xp) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export const xpForLevel = lvl => XP_TABLE[Math.min(lvl, MAX_LEVEL)] ?? 0;

/** Fraction of the way from the current level to the next, 0..1. */
export function levelProgress(xp) {
  const lvl = levelForXp(xp);
  if (lvl >= MAX_LEVEL) return 1;
  const a = XP_TABLE[lvl], b = XP_TABLE[lvl + 1];
  return (xp - a) / (b - a);
}

/**
 * Every skill in the game.
 *   combat  - counts toward the combat level formula
 *   icon    - glyph shown in the skills panel
 */
export const SKILLS = [
  { id: 'vitality',   name: 'Vitality',   icon: '❤️', combat: true,  start: 10,
    blurb: 'How much punishment your body absorbs before the Throat swallows you.' },
  { id: 'lancing',    name: 'Lancing',    icon: '🩺', combat: true,
    blurb: 'Accuracy with scalpels, trocars and every other sharp thing in the kit.' },
  { id: 'vigour',     name: 'Vigour',     icon: '💪', combat: true,
    blurb: 'Raw force behind a swing. A nurse hauls stretchers; it shows.' },
  { id: 'warding',    name: 'Warding',    icon: '🦠', combat: true,
    blurb: 'Aprons, gloves and good instincts turning a wound into a graze.' },
  { id: 'injection',  name: 'Injection',  icon: '📉', combat: true,
    blurb: 'Delivering a dose from across the ward. Blowpipes and dart syringes.' },
  { id: 'anatomancy', name: 'Anatomancy', icon: '✨', combat: true,
    blurb: 'Reading the body as a map and rewriting what you find there.' },
  { id: 'vigil',      name: 'Vigil',      icon: '🕯️', combat: true,
    blurb: 'The long night watch. Sit with the dying and borrow their steadiness.' },

  { id: 'triage',     name: 'Triage',     icon: '🚑',
    blurb: 'Judging who is savable, and saving them. The nurse’s true art.' },
  { id: 'apothecary', name: 'Apothecary', icon: '🧪',
    blurb: 'Brewing salves, draughts and antivenins over a hissing burner.' },
  { id: 'suturing',   name: 'Suturing',   icon: '🪡',
    blurb: 'Needle and gut. Closing wounds, and stitching cloth into armour.' },
  { id: 'forging',    name: 'Forging',    icon: '🔨',
    blurb: 'Smelting bloodstone and beating surgical steel into instruments.' },

  { id: 'foraging',   name: 'Foraging',   icon: '🌿',
    blurb: 'Finding medicine growing in the folds of the Throat.' },
  { id: 'tapping',    name: 'Tapping',    icon: '🪵',
    blurb: 'Drawing sap and timber from the pale throatwoods.' },
  { id: 'delving',    name: 'Delving',    icon: '⛏️',
    blurb: 'Chipping rocksalt and ore out of the cartilage cliffs.' },
  { id: 'leeching',   name: 'Leeching',   icon: '🪣',
    blurb: 'Coaxing leeches, eels and bog-fish out of the standing bile.' },

  { id: 'scurrying',  name: 'Scurrying',  icon: '🏃',
    blurb: 'Ward-corridor speed. Vaulting rails and squeezing through gaps.' },
  { id: 'salvage',    name: 'Salvage',    icon: '🧰',
    blurb: 'Relieving the careless of supplies they were only going to waste.' }
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));
export const SKILL_IDS = SKILLS.map(s => s.id);
export const COMBAT_SKILLS = SKILLS.filter(s => s.combat).map(s => s.id);

/** Fresh skill block for a new nurse. */
export function startingSkills() {
  const out = {};
  for (const s of SKILLS) out[s.id] = { xp: s.start ? xpForLevel(s.start) : 0 };
  return out;
}

/**
 * Combat level, using the familiar weighting.
 * Melee / ranged / magic each get their own contribution; the best one wins.
 */
export function combatLevel(lvl) {
  const base = 0.25 * (lvl.warding + lvl.vitality + Math.floor(lvl.vigil / 2));
  const melee = 0.325 * (lvl.lancing + lvl.vigour);
  const range = 0.325 * Math.floor(3 * lvl.injection / 2);
  const mage  = 0.325 * Math.floor(3 * lvl.anatomancy / 2);
  return Math.floor(base + Math.max(melee, range, mage));
}

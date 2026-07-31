/* ============================================================
   Anatomancy spells and the Vigil (the long-watch blessings)
   ============================================================ */

export const SPELLS = [
  { id: 'diagnose', name: 'Diagnose', level: 1, xp: 5, icon: '🔍',
    runes: { nerve_rune: 1 }, kind: 'inspect',
    desc: 'Reads a creature\'s condition. Tells you exactly how bad an idea this is.' },

  { id: 'flesh_bolt', name: 'Flesh bolt', level: 1, xp: 12, icon: '🔴',
    runes: { flesh_rune: 1, mend_rune: 1 }, kind: 'attack', max: 4,
    desc: 'A knot of borrowed tissue, thrown hard.' },

  { id: 'mend_self', name: 'Mend self', level: 5, xp: 16, icon: '💚',
    runes: { mend_rune: 3 }, kind: 'heal', amount: 6,
    desc: 'Closes your own wounds. Badly, but closed is closed.' },

  { id: 'nerve_strike', name: 'Nerve strike', level: 10, xp: 24, icon: '⚡',
    runes: { nerve_rune: 1, flesh_rune: 2 }, kind: 'attack', max: 9,
    desc: 'Convinces a nerve to fire until it cannot.' },

  { id: 'ward_home', name: 'Ward-home', level: 15, xp: 40, icon: '🏠',
    runes: { mend_rune: 2, nerve_rune: 1 }, kind: 'teleport', dest: { x: 30, y: 152 },
    place: 'Lumbrisdale', desc: 'Pulls you back to the Mercy House door.' },

  { id: 'bile_lance', name: 'Bile lance', level: 25, xp: 42, icon: '🟡',
    runes: { bile_rune: 1, nerve_rune: 2 }, kind: 'attack', max: 15,
    desc: 'A line of caustic bile, delivered with intent.' },

  { id: 'vellum_hop', name: 'Vellum hop', level: 30, xp: 62, icon: '🏛️',
    runes: { nerve_rune: 3, bile_rune: 1 }, kind: 'teleport', dest: { x: 150, y: 152 },
    place: 'Vellumhaven', desc: 'A short, undignified jump to the city square.' },

  { id: 'transfuse', name: 'Transfuse', level: 35, xp: 58, icon: '🩸',
    runes: { flesh_rune: 4, vital_rune: 1 }, kind: 'drain', max: 10,
    desc: 'Takes what it deals and gives it back to you.' },

  { id: 'vital_rend', name: 'Vital rend', level: 45, xp: 84, icon: '💥',
    runes: { vital_rune: 1, bile_rune: 2, nerve_rune: 2 }, kind: 'attack', max: 24,
    desc: 'Unpicks a body along the seams it was built on.' },

  { id: 'deep_dive', name: 'Deep dive', level: 50, xp: 110, icon: '🕳️',
    runes: { vital_rune: 2, nerve_rune: 4 }, kind: 'teleport', dest: { x: 92, y: 30 },
    place: 'the Larynx Deep', desc: 'Drops you into the Deep. You asked for this.' }
];

export const SPELL_BY_ID = Object.fromEntries(SPELLS.map(s => [s.id, s]));

/* ---------------- Vigil ------------------------------------- */

/**
 * Vigils drain vigil points while active. `boost` is a multiplier applied on
 * top of the relevant skill level, matching how the old prayers worked.
 * `drain` is points per minute at 1 vigil-bonus.
 */
export const VIGILS = [
  { id: 'steady_hands', name: 'Steady Hands', level: 1, icon: '🤚', drain: 12,
    boost: { lancing: 0.05 }, desc: 'The tremor stops. +5% Lancing.' },
  { id: 'braced', name: 'Braced', level: 4, icon: '🛡️', drain: 12,
    boost: { warding: 0.05 }, desc: 'Weight on the back foot. +5% Warding.' },
  { id: 'strong_arms', name: 'Strong Arms', level: 7, icon: '💪', drain: 12,
    boost: { vigour: 0.05 }, desc: 'Stretcher-carrier\'s strength. +5% Vigour.' },
  { id: 'keen_eye', name: 'Keen Eye', level: 9, icon: '👁️', drain: 12,
    boost: { injection: 0.05 }, desc: 'You find the vein first time. +5% Injection.' },
  { id: 'clear_mind', name: 'Clear Mind', level: 12, icon: '🧠', drain: 12,
    boost: { anatomancy: 0.05 }, desc: 'The diagram resolves. +5% Anatomancy.' },
  { id: 'surgeons_calm', name: "Surgeon's Calm", level: 20, icon: '🩺', drain: 24,
    boost: { lancing: 0.10, vigour: 0.10 }, desc: '+10% Lancing and Vigour.' },
  { id: 'mercy_sight', name: 'Mercy Sight', level: 25, icon: '🕯️', drain: 24,
    boost: { warding: 0.15 }, desc: 'You see the blow before it lands. +15% Warding.' },
  { id: 'steady_dose', name: 'Steady Dose', level: 30, icon: '💉', drain: 24,
    boost: { injection: 0.15 }, desc: '+15% Injection.' },
  { id: 'inner_ward', name: 'Inner Ward', level: 35, icon: '✨', drain: 24,
    boost: { anatomancy: 0.15 }, desc: '+15% Anatomancy.' },
  { id: 'last_rites', name: 'Last Rites', level: 43, icon: '⚰️', drain: 40,
    boost: { lancing: 0.15, vigour: 0.18, warding: 0.15 },
    desc: 'What you say over the ones you could not save. +15/18/15%.' },
  { id: 'unbroken_watch', name: 'Unbroken Watch', level: 55, icon: '🌙', drain: 48,
    boost: { lancing: 0.20, vigour: 0.23, warding: 0.25 },
    desc: 'You have not slept in four days and it has begun to help.' }
];

export const VIGIL_BY_ID = Object.fromEntries(VIGILS.map(v => [v.id, v]));

/** Vigils that cannot burn at the same time (same stat family). */
export function conflicts(a, b) {
  const A = VIGIL_BY_ID[a], B = VIGIL_BY_ID[b];
  if (!A || !B) return false;
  return Object.keys(A.boost).some(k => k in B.boost);
}

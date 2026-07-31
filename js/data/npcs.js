/* ============================================================
   NPCs - the living, the dying, and the shopkeepers
   ============================================================ */

const LIST = [];
const def = o => { LIST.push(o); return o; };

/* ---------------- Hostiles ---------------------------------- */

/**
 * @param cfg.lvl      displayed combat level
 * @param cfg.stats    { att, str, def, hp } effective levels
 * @param cfg.bon      { atk, str, def } equipment-equivalent bonuses
 * @param cfg.drops    weighted table; `null` id means "nothing"
 */
function mob(id, name, cfg) {
  return def(Object.assign({
    id, name, hostile: true,
    respawn: 25,          // ticks
    wander: 4,
    aggroRange: 0,        // 0 = never initiates
    speed: 4,             // attack cooldown in ticks
    attackRange: 1,
    size: 1
  }, cfg));
}

mob('ward_rat', 'Ward rat', {
  lvl: 2, stats: { att: 2, str: 2, def: 1, hp: 6 }, bon: { atk: 0, str: 0, def: 0 },
  examine: 'It has learned that hospitals mean food.',
  art: { k: 'rat', c: '#7a6455' }, wander: 5,
  drops: [ { id: 'bones', n: [1, 1], weight: 60 }, { id: 'coins', n: [1, 9], weight: 30 },
           { id: 'lint', n: [1, 2], weight: 10 } ]
});

mob('bile_slug', 'Bile slug', {
  lvl: 5, stats: { att: 5, str: 5, def: 4, hp: 12 }, bon: { atk: 2, str: 2, def: 4 },
  examine: 'Leaves a trail that eats through clogs.',
  art: { k: 'slug', c: '#a3a34a' }, speed: 5,
  drops: [ { id: 'coins', n: [3, 22], weight: 45 }, { id: 'vial', n: [1, 1], weight: 20 },
           { id: 'coughcap', n: [1, 1], weight: 15 }, { id: 'bones', n: [1, 1], weight: 20 } ]
});

mob('hackling', 'Hackling', {
  lvl: 8, stats: { att: 9, str: 8, def: 6, hp: 18 }, bon: { atk: 4, str: 4, def: 5 },
  examine: 'A knot of cough given just enough body to resent you.',
  art: { k: 'sprite', c: '#8fa8c9' }, aggroRange: 4, speed: 3,
  drops: [ { id: 'coins', n: [8, 45], weight: 40 }, { id: 'lint', n: [2, 5], weight: 20 },
           { id: 'sootleaf', n: [1, 1], weight: 15 }, { id: 'mend_rune', n: [3, 9], weight: 15 },
           { id: 'bones', n: [1, 1], weight: 10 } ]
});

mob('feral_patient', 'Feral patient', {
  lvl: 12, stats: { att: 14, str: 14, def: 10, hp: 26 }, bon: { atk: 8, str: 9, def: 8 },
  examine: 'Discharged themselves. Kept the restraints.',
  art: { k: 'humanoid', c: '#c9b48f' }, aggroRange: 5,
  drops: [ { id: 'bones', n: [1, 1], weight: 100 },
           { id: 'coins', n: [15, 80], weight: 40 }, { id: 'gauze_wrap', n: [1, 2], weight: 18 },
           { id: 'rusty_scalpel', n: [1, 1], weight: 12 }, { id: 'palate_root', n: [1, 1], weight: 12 },
           { id: 'linen_body', n: [1, 1], weight: 8 }, { id: null, weight: 40 } ]
});

mob('gullet_crawler', 'Gullet crawler', {
  lvl: 18, stats: { att: 20, str: 20, def: 18, hp: 38 }, bon: { atk: 14, str: 15, def: 16 },
  examine: 'Too many legs for a corridor this narrow.',
  art: { k: 'crawler', c: '#6b4a55' }, aggroRange: 6, speed: 3,
  drops: [ { id: 'thick_bones', n: [1, 1], weight: 100 },
           { id: 'coins', n: [40, 190], weight: 45 }, { id: 'ironblood_ore', n: [1, 2], weight: 16 },
           { id: 'fevermoss', n: [1, 1], weight: 12 }, { id: 'dart_syringe', n: [5, 15], weight: 14 },
           { id: 'steel_scalpel', n: [1, 1], weight: 6 }, { id: null, weight: 30 } ]
});

mob('bog_spinner', 'Bog spinner', {
  lvl: 25, stats: { att: 28, str: 26, def: 26, hp: 52 }, bon: { atk: 22, str: 20, def: 24 },
  examine: 'It has already decided how much silk you are worth.',
  art: { k: 'spinner', c: '#8f6a8f' }, aggroRange: 6, venomous: true,
  drops: [ { id: 'thick_bones', n: [1, 1], weight: 100 },
           { id: 'spinner_silk', n: [1, 1], weight: 25 }, { id: 'coins', n: [80, 340], weight: 40 },
           { id: 'silkgut', n: [1, 1], weight: 10 }, { id: 'bile_lily', n: [1, 2], weight: 12 },
           { id: 'venom_dart', n: [4, 12], weight: 12 }, { id: null, weight: 26 } ]
});

mob('tonsil_brute', 'Tonsil brute', {
  lvl: 34, stats: { att: 38, str: 42, def: 32, hp: 74 }, bon: { atk: 30, str: 36, def: 28 },
  examine: 'A pillar of inflamed muscle with opinions.',
  art: { k: 'brute', c: '#b8687a' }, aggroRange: 7, speed: 5,
  drops: [ { id: 'thick_bones', n: [1, 1], weight: 100 },
           { id: 'coins', n: [150, 620], weight: 45 }, { id: 'bloodstone_ore', n: [1, 2], weight: 14 },
           { id: 'ironblood_bar', n: [1, 3], weight: 14 }, { id: 'numbthistle', n: [1, 2], weight: 10 },
           { id: 'ironblood_body', n: [1, 1], weight: 6 }, { id: 'amulet_sterility', n: [1, 1], weight: 3 },
           { id: null, weight: 24 } ]
});

mob('plague_monk', 'Plague monk', {
  lvl: 42, stats: { att: 44, str: 40, def: 46, hp: 82 }, bon: { atk: 38, str: 34, def: 44 },
  examine: 'Prays for the sickness, not the sick.',
  art: { k: 'monk', c: '#5f6b60' }, aggroRange: 6, magic: true,
  drops: [ { id: 'bones', n: [1, 1], weight: 100 },
           { id: 'coins', n: [220, 900], weight: 40 }, { id: 'nerve_rune', n: [10, 30], weight: 18 },
           { id: 'bile_rune', n: [8, 22], weight: 14 }, { id: 'weave_body', n: [1, 1], weight: 6 },
           { id: 'choking_seal', n: [1, 1], weight: 5 }, { id: 'suture_vine', n: [1, 2], weight: 8 },
           { id: null, weight: 22 } ]
});

mob('larynx_howler', 'Larynx howler', {
  lvl: 55, stats: { att: 58, str: 60, def: 52, hp: 110 }, bon: { atk: 52, str: 56, def: 48 },
  examine: 'The sound arrives a full second before it does.',
  art: { k: 'howler', c: '#7d2a39' }, aggroRange: 8, speed: 4,
  drops: [ { id: 'gasper_skull', n: [1, 1], weight: 100 },
           { id: 'coins', n: [400, 1600], weight: 40 }, { id: 'bloodstone_ore', n: [2, 4], weight: 16 },
           { id: 'steel_bar', n: [1, 3], weight: 14 }, { id: 'bloodbell', n: [1, 1], weight: 6 },
           { id: 'steel_body', n: [1, 1], weight: 5 }, { id: 'bloodstone_dart', n: [10, 25], weight: 10 },
           { id: null, weight: 20 } ]
});

mob('choking_matron', 'The Choking Matron', {
  lvl: 90, stats: { att: 92, str: 96, def: 88, hp: 220 }, bon: { atk: 86, str: 92, def: 80 },
  examine: 'She never left the ward. She never let anyone else leave either.',
  art: { k: 'boss', c: '#c0303f' }, aggroRange: 9, speed: 4, respawn: 60, size: 2, boss: true,
  drops: [ { id: 'bloodstone_shard', n: [1, 1], weight: 100 },
           { id: 'coins', n: [3000, 9000], weight: 45 }, { id: 'bloodstone_bar', n: [2, 5], weight: 16 },
           { id: 'crimson_scalpel', n: [1, 1], weight: 4 }, { id: 'bloodbell_wand', n: [1, 1], weight: 4 },
           { id: 'bloodstone_body', n: [1, 1], weight: 8 }, { id: 'vigil_pendant', n: [1, 1], weight: 6 },
           { id: 'greater_salve', n: [3, 8], weight: 17 } ]
});

/* ---------------- Friendlies -------------------------------- */

const npc = (id, name, cfg) => def(Object.assign({ id, name, hostile: false, wander: 0 }, cfg));

npc('orderly_punn', 'Orderly Punn', {
  examine: 'Cheerful in a way that suggests he has stopped reading the charts.',
  art: { k: 'humanoid', c: '#8fbf7f', hat: '#e8dcc8' }, talk: 'punn'
});
npc('matron_vell', 'Matron Vell', {
  examine: 'She has buried more colleagues than she has trained.',
  art: { k: 'humanoid', c: '#7d2a39', hat: '#e8dcc8' }, talk: 'vell'
});
npc('apoth_dree', 'Apothecary Dree', {
  examine: 'Three pairs of spectacles, all in use.',
  art: { k: 'humanoid', c: '#6fd1a5', hat: '#c9b48f' }, talk: 'dree', shop: 'apothecary'
});
npc('quartermaster_sceld', 'Quartermaster Sceld', {
  examine: 'Guards the stores like they are his own children. They are not.',
  art: { k: 'humanoid', c: '#c9a34a' }, talk: 'sceld', shop: 'general'
});
npc('banker_hollis', 'Banker Hollis', {
  examine: 'Counts in a whisper. Always correct.',
  art: { k: 'humanoid', c: '#86b7e0', hat: '#3a2a4a' }, talk: 'hollis', bank: true
});
npc('smith_marrow', 'Smith Marrow', {
  examine: 'Forearms like a pair of good tourniquets.',
  art: { k: 'humanoid', c: '#9c6055' }, talk: 'marrow', shop: 'forge'
});
npc('sister_ambrose', 'Sister Ambrose', {
  examine: 'Keeps the long vigil in the chapel of the Uvula.',
  art: { k: 'humanoid', c: '#d9c0e0', hat: '#e8dcc8' }, talk: 'ambrose'
});
npc('fenwarden_gob', 'Fenwarden Gob', {
  examine: 'Waist-deep in the Fen by choice.',
  art: { k: 'humanoid', c: '#6b8f5f' }, talk: 'gob'
});
npc('tomas', 'Tomas the Unclosed', {
  examine: 'His wound has not healed in eleven years. He has made peace with it.',
  art: { k: 'humanoid', c: '#b8687a' }, talk: 'tomas'
});
npc('patient_row', 'Bedbound patient', {
  examine: 'Breathing. Barely. Could use a nurse.',
  art: { k: 'patient', c: '#c9b48f' }, talk: 'patient', patient: true
});

export const NPCS = Object.fromEntries(LIST.map(n => [n.id, n]));
export const npcDef = id => NPCS[id];

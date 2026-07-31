/* ============================================================
   Items - every object a nurse can carry, wear or swing
   ------------------------------------------------------------
   Bonus keys mirror the classic stat block:
     aStab aSlash aCrush aRange aMagic   attack bonuses
     dStab dSlash dCrush dRange dMagic   defence bonuses
     str   rStr   mDmg   vigil           damage + vigil bonuses
   `art` drives the procedural icon painter in js/engine/icons.js.
   ============================================================ */

const ITEM_LIST = [];

function def(o) {
  o.b = o.b || {};
  o.value = o.value ?? 1;
  ITEM_LIST.push(o);
  return o;
}

/* ---------------- Currency & basics ------------------------- */

def({ id: 'coins', name: 'Coins', stack: true, value: 1,
  examine: 'Lovely money. Smells faintly of iodine.', art: { k: 'coin' } });

def({ id: 'bones', name: 'Bones', value: 2,
  examine: 'Somebody stopped needing these.', art: { k: 'bone' }, buryXp: 4.5 });
def({ id: 'thick_bones', name: 'Thick bones', value: 12,
  examine: 'Dense, and heavier than they look.', art: { k: 'bone', c: '#e6e0cd' }, buryXp: 15 });
def({ id: 'gasper_skull', name: 'Gasper skull', value: 60,
  examine: 'It still seems to be inhaling.', art: { k: 'skull' }, buryXp: 52 });

/* ---------------- Tools ------------------------------------- */

def({ id: 'tap_knife', name: 'Tapping knife', value: 40, slot: 'weapon', tool: 'tapping',
  examine: 'A hooked blade for scoring throatwood bark.',
  b: { aSlash: 4, str: 2 }, speed: 4, art: { k: 'blade', c: '#b9c4cc', hilt: '#6b4a2f' } });
def({ id: 'bone_pick', name: 'Bone pick', value: 70, slot: 'weapon', tool: 'delving',
  examine: 'A pick knapped from something\'s femur.',
  b: { aCrush: 6, str: 5 }, speed: 5, art: { k: 'pick', c: '#ddd3bb' } });
def({ id: 'leech_net', name: 'Leech net', value: 30, tool: 'leeching',
  examine: 'Fine mesh. The holes are deliberately mean.', art: { k: 'net' } });
def({ id: 'fishing_gaff', name: 'Bile gaff', value: 90, tool: 'gaff',
  examine: 'For hooking things that do not wish to be hooked.', art: { k: 'gaff' } });
def({ id: 'needle', name: 'Suture needle', value: 15, tool: 'suturing',
  examine: 'Curved, as all honest needles are.', art: { k: 'needle' } });
def({ id: 'gut_thread', name: 'Gut thread', stack: true, value: 4,
  examine: 'Catgut. Or something that answered to "cat".', art: { k: 'thread' } });
def({ id: 'smith_hammer', name: 'Ward hammer', value: 50, tool: 'forging',
  examine: 'Heavy enough to shape steel or an argument.',
  slot: 'weapon', b: { aCrush: 8, str: 7 }, speed: 6, art: { k: 'hammer' } });
def({ id: 'pestle', name: 'Pestle and mortar', value: 45, tool: 'apothecary',
  examine: 'Stained by a hundred cures and two mistakes.', art: { k: 'mortar' } });
def({ id: 'vial', name: 'Empty vial', stack: true, value: 3,
  examine: 'Glass, cloudy, and technically sterile.', art: { k: 'vial' } });
def({ id: 'vial_of_water', name: 'Vial of water', stack: true, value: 5,
  examine: 'Boiled, cooled, and ready for a herb.', art: { k: 'vial', fill: '#5aa6c9' } });
def({ id: 'bucket', name: 'Bucket', value: 8,
  examine: 'For water, blood, or the contents of a patient.', art: { k: 'bucket' } });

/* ---------------- Raw materials ----------------------------- */

def({ id: 'lint', name: 'Lint', stack: true, value: 4,
  examine: 'Scraped from the Throat\'s own lining. Absorbent.', art: { k: 'fluff', c: '#ded3c0' } });
def({ id: 'cotton_bale', name: 'Cotton bale', value: 22,
  examine: 'Enough to dress a great many wounds.', art: { k: 'fluff', c: '#f0e8d8' } });
def({ id: 'silkgut', name: 'Silkgut', value: 140,
  examine: 'Spun by the spinners in the Larynx Deep. Unnervingly strong.',
  art: { k: 'fluff', c: '#d9c0e0' } });

def({ id: 'throatwood_log', name: 'Throatwood log', value: 12,
  examine: 'Pale timber, warm to the touch.', art: { k: 'log', c: '#c9a68e' } });
def({ id: 'sapwood_log', name: 'Sapwood log', value: 48,
  examine: 'It weeps a slow amber sap.', art: { k: 'log', c: '#b8853f' } });
def({ id: 'ivorybark_log', name: 'Ivorybark log', value: 190,
  examine: 'Hard as a tooth, and about as friendly.', art: { k: 'log', c: '#e4dcc6' } });
def({ id: 'amber_sap', name: 'Amber sap', stack: true, value: 26,
  examine: 'Sticky, sweet, and mildly anaesthetic.', art: { k: 'blob', c: '#d99a3a' } });

def({ id: 'rocksalt', name: 'Rocksalt', value: 10,
  examine: 'Crude salt. Wonderful for cleaning, agony in a wound.', art: { k: 'ore', c: '#e0dcd2' } });
def({ id: 'chalk_lump', name: 'Chalk lump', value: 16,
  examine: 'Crumbling white stone from the cartilage cliffs.', art: { k: 'ore', c: '#ded9cb' } });
def({ id: 'ironblood_ore', name: 'Ironblood ore', value: 42,
  examine: 'Ore so ferrous it tastes like a nosebleed.', art: { k: 'ore', c: '#8f4a3f' } });
def({ id: 'bloodstone_ore', name: 'Bloodstone ore', value: 165,
  examine: 'It has a pulse. Slow, but a pulse.', art: { k: 'ore', c: '#a12a35' } });

def({ id: 'ironblood_bar', name: 'Ironblood bar', value: 110,
  examine: 'Smelted, hammered, ready.', art: { k: 'bar', c: '#9c6055' } });
def({ id: 'steel_bar', name: 'Surgical steel bar', value: 280,
  examine: 'Bright enough to check your teeth in.', art: { k: 'bar', c: '#c6ced6' } });
def({ id: 'bloodstone_bar', name: 'Bloodstone bar', value: 620,
  examine: 'Still faintly warm. It objects to being cold.', art: { k: 'bar', c: '#b8323f' } });

/* ---------------- Herbs ------------------------------------- */

const herb = (id, name, lvl, value, colour, examine) =>
  def({ id, name, value, examine, herbLevel: lvl, art: { k: 'herb', c: colour } });

herb('coughcap',    'Coughcap',     1,  14, '#8fbf7f', 'A squat fungus that rattles when shaken.');
herb('sootleaf',    'Sootleaf',     8,  30, '#5f6b60', 'Black-edged leaf. Burns clean.');
herb('palate_root', 'Palate root',  16, 62, '#c9906b', 'Knobbled root, pulled from soft ground.');
herb('fevermoss',   'Fevermoss',    26, 118, '#7fbf9f', 'Cool to the touch even in the Gullet.');
herb('bile_lily',   'Bile lily',    34, 205, '#c9c14a', 'Grows only where the standing bile pools.');
herb('numbthistle', 'Numbthistle',  42, 330, '#9f7fd0', 'Handle it and your fingers stop reporting in.');
herb('suture_vine', 'Suture vine',  50, 520, '#4f9f7a', 'It knits itself back together when cut. Rude.');
herb('bloodbell',   'Bloodbell',    58, 880, '#c0303f', 'The rarest bloom in the Throat. It chimes.');

/* ---------------- Catch & food ------------------------------ */

const food = (id, name, value, heal, colour, examine, art = 'food') =>
  def({ id, name, value, heal, examine, art: { k: art, c: colour } });

def({ id: 'bog_leech', name: 'Bog leech', value: 9,
  examine: 'Raw and indignant.', art: { k: 'fish', c: '#5f4a55' } });
def({ id: 'gullet_trout', name: 'Raw gullet trout', value: 24,
  examine: 'Pale-fleshed, wide-eyed.', art: { k: 'fish', c: '#9fb0b8' } });
def({ id: 'bile_eel', name: 'Raw bile eel', value: 66,
  examine: 'Still coiling, technically.', art: { k: 'fish', c: '#a3a34a' } });
def({ id: 'gasper_fish', name: 'Raw gasper', value: 160,
  examine: 'It breathes air. It resents water. It is confused.', art: { k: 'fish', c: '#c98f9f' } });

food('leech_broth',   'Leech broth',   28,  4,  '#7a3f4a', 'Iron-rich, and you will not ask again.', 'bowl');
food('grilled_trout', 'Grilled trout', 55,  8,  '#d9b98f', 'Crisped over a burner. Honest food.');
food('smoked_eel',    'Smoked eel',    120, 13, '#b8a35a', 'Smoke covers a multitude of eels.');
food('roast_gasper',  'Roast gasper',  260, 19, '#d99a9f', 'It finally stopped gasping.');
food('honey_lozenge', 'Honey lozenge', 32,  3,  '#e0b357', 'Soothes a throat. Any throat.', 'pill');
food('burnt_offering','Burnt offering', 1,  0,  '#3a2a24', 'Charcoal with ambition.');

/* ---------------- Potions ----------------------------------- */

const potion = (id, name, value, colour, examine, effect) =>
  def({ id, name, value, examine, potion: effect, art: { k: 'vial', fill: colour } });

potion('salve_mending',  'Salve of mending',  85,  '#6fd1a5',
  'Green, thick, and it stings like an accusation.', { heal: 12 });
potion('greater_salve',  'Greater salve',     240, '#3fb98a',
  'The good stuff. Rationed, in theory.', { heal: 24 });
potion('numbing_draught','Numbing draught',   120, '#9f7fd0',
  'Everything goes quiet, including your nerve.', { boost: 'lancing', base: 3, pct: 0.10 });
potion('vigour_tonic',   'Vigour tonic',      130, '#d4586b',
  'Your arms decide they are someone else\'s problem.', { boost: 'vigour', base: 3, pct: 0.10 });
potion('ward_elixir',    'Ward elixir',       135, '#5aa6c9',
  'A film of something protective, inside and out.', { boost: 'warding', base: 3, pct: 0.10 });
potion('antivenin',      'Antivenin',         160, '#c9c14a',
  'Cures venom. Tastes like the venom\'s revenge.', { cure: true });
potion('clarity_philtre','Clarity philtre',   210, '#86b7e0',
  'The night watch gets a little easier.', { vigil: 22 });
potion('surgeons_focus', 'Surgeon\'s focus',  480, '#e0b357',
  'Hands still. World slow. Wonderful and illegal.',
  { boost: ['lancing', 'vigour'], base: 5, pct: 0.15 });

/* ---------------- Dressings & bandages ---------------------- */

def({ id: 'gauze_wrap', name: 'Gauze wrap', value: 30, heal: 5, stack: false,
  examine: 'A simple dressing. Does simple, well.', art: { k: 'bandage', c: '#e8e0cd' } });
def({ id: 'pressure_dressing', name: 'Pressure dressing', value: 95, heal: 11,
  examine: 'Stops bleeding by asking it very firmly.', art: { k: 'bandage', c: '#d9c8b0' } });
def({ id: 'tourniquet', name: 'Tourniquet', value: 210, heal: 18,
  examine: 'A last resort with a buckle.', art: { k: 'bandage', c: '#b8687a' } });

/* ---------------- Runes & spell foci ------------------------ */

const rune = (id, name, value, colour, examine) =>
  def({ id, name, value, examine, stack: true, art: { k: 'rune', c: colour } });

rune('mend_rune',   'Mend rune',     6,  '#6fd1a5', 'A rune shaped like a closing seam.');
rune('flesh_rune',  'Flesh rune',    5,  '#d4586b', 'Warm. Slightly damp. Best not thought about.');
rune('nerve_rune',  'Nerve rune',    18, '#86b7e0', 'It hums against the fingertips.');
rune('bile_rune',   'Bile rune',     26, '#c9c14a', 'Etched on a chip of hardened bile.');
rune('vital_rune',  'Vital rune',    52, '#e0b357', 'The rarest etching. It beats.');

/* ---------------- Ammunition -------------------------------- */

def({ id: 'dart_syringe', name: 'Syringe dart', stack: true, value: 7, slot: 'ammo',
  examine: 'A dose, delivered enthusiastically.',
  b: { rStr: 5 }, ammo: true, art: { k: 'dart', c: '#b9c4cc' } });
def({ id: 'venom_dart', name: 'Venom dart', stack: true, value: 34, slot: 'ammo',
  examine: 'The dose is the problem, not the needle.', req: { injection: 25 },
  b: { rStr: 14 }, ammo: true, venom: true, art: { k: 'dart', c: '#7fbf8f' } });
def({ id: 'bloodstone_dart', name: 'Bloodstone dart', stack: true, value: 90, slot: 'ammo',
  examine: 'It wants to be somewhere warm. Anywhere warm.', req: { injection: 45 },
  b: { rStr: 26 }, ammo: true, art: { k: 'dart', c: '#c0303f' } });

/* ---------------- Melee weapons ----------------------------- */

const weapon = (id, name, value, req, speed, b, art, examine, style = 'melee') =>
  def({ id, name, value, examine, slot: 'weapon', req, speed, b, art, wstyle: style });

weapon('rusty_scalpel', 'Rusty scalpel', 12, {}, 3,
  { aStab: 6, aSlash: 3, str: 4 }, { k: 'blade', c: '#8f7f6a', hilt: '#4a3a2a' },
  'It has cut things it should not have. Recently.');
weapon('steel_scalpel', 'Steel scalpel', 90, { lancing: 5 }, 3,
  { aStab: 14, aSlash: 8, str: 10 }, { k: 'blade', c: '#c6ced6', hilt: '#5a4636' },
  'Sharp, balanced, and reassuringly boring.');
weapon('reflex_hammer', 'Reflex hammer', 45, {}, 5,
  { aCrush: 12, str: 12 }, { k: 'hammer', c: '#b8687a' },
  'Tests reflexes. Ends arguments.');
weapon('bone_saw', 'Bone saw', 320, { lancing: 10 }, 4,
  { aSlash: 26, aStab: 8, str: 24 }, { k: 'saw', c: '#ddd3bb' },
  'You have heard the sound. You cannot unhear it.');
weapon('trocar_spear', 'Trocar spear', 640, { lancing: 15 }, 4,
  { aStab: 38, aSlash: 14, str: 30, dStab: 6 }, { k: 'spear', c: '#c6ced6' },
  'A drain, on a very long handle.');
weapon('surgical_scalpel', 'Surgical scalpel', 1400, { lancing: 20 }, 3,
  { aStab: 44, aSlash: 22, str: 34 }, { k: 'blade', c: '#e2eaf0', hilt: '#2a3a4a' },
  'Edge so fine the wound closes out of politeness.');
weapon('amputation_saw', 'Amputation saw', 4200, { lancing: 30 }, 4,
  { aSlash: 62, aCrush: 30, str: 58 }, { k: 'saw', c: '#c6ced6' },
  'The old ward called it "the quick mercy".');
weapon('ivory_lance', 'Ivory lance', 11000, { lancing: 40 }, 5,
  { aStab: 84, aSlash: 30, str: 76, dStab: 12 }, { k: 'spear', c: '#e4dcc6' },
  'Carved from one continuous tooth.');
weapon('crimson_scalpel', 'Crimson scalpel', 34000, { lancing: 50 }, 3,
  { aStab: 96, aSlash: 62, str: 82 }, { k: 'blade', c: '#c0303f', hilt: '#3a1420', glow: true },
  'It does not need your hand. It is being polite.');

/* ---------------- Ranged & magic weapons -------------------- */

weapon('brass_syringe', 'Brass syringe', 60, { injection: 1 }, 4,
  { aRange: 10 }, { k: 'syringe', c: '#c9a34a' },
  'Point, plunge, apologise later.', 'ranged');
weapon('dart_bandolier', 'Dart bandolier', 480, { injection: 12 }, 3,
  { aRange: 28 }, { k: 'syringe', c: '#8f6a4a' },
  'Twelve doses across the chest. Reassuring.', 'ranged');
weapon('bile_blowpipe', 'Bile blowpipe', 3800, { injection: 25 }, 2,
  { aRange: 52, rStr: 8 }, { k: 'blowpipe', c: '#6b8f5f' },
  'Hollow reed from the Fen. Absurdly fast.', 'ranged');
weapon('gasper_bow', 'Gasperbone bow', 9600, { injection: 40 }, 4,
  { aRange: 78, rStr: 4 }, { k: 'bow', c: '#ded3bb' },
  'Strung with something that used to breathe.', 'ranged');

weapon('staff_of_sutures', 'Staff of sutures', 220, { anatomancy: 1 }, 5,
  { aMagic: 12, aCrush: 8, str: 6, dMagic: 4 }, { k: 'staff', c: '#8f6a4a', gem: '#6fd1a5' },
  'The knot at the top never comes undone.', 'magic');
weapon('rod_reknitting', 'Rod of reknitting', 5200, { anatomancy: 25 }, 5,
  { aMagic: 42, mDmg: 8, dMagic: 14 }, { k: 'staff', c: '#c6ced6', gem: '#86b7e0' },
  'Points at a wound and disagrees with it.', 'magic');
weapon('bloodbell_wand', 'Bloodbell wand', 18000, { anatomancy: 45 }, 4,
  { aMagic: 68, mDmg: 16, dMagic: 20 }, { k: 'staff', c: '#5a2030', gem: '#c0303f', glow: true },
  'It rings when someone nearby is about to die.', 'magic');

/* ---------------- Armour ------------------------------------ */

/**
 * Builds a full protective set at one tier.
 * `mult` scales the base defence profile; `kind` picks the icon family.
 */
function armourSet(prefix, label, tier, req, kind, colour, opts = {}) {
  const m = tier;
  const s = opts.style || 'melee';
  // magic/ranged sets trade stab-defence for their own attack bonuses
  const magic = s === 'magic', ranged = s === 'ranged';
  const mk = (id, name, slot, scale, extra, art, examine) => def({
    id: prefix + '_' + id, name: `${label} ${name}`, slot,
    value: Math.round(60 * m * m * scale), req: req ? { warding: req } : undefined,
    examine,
    b: Object.assign({
      dStab: Math.round(m * 4 * scale * (magic ? 0.4 : 1)),
      dSlash: Math.round(m * 4.4 * scale * (magic ? 0.4 : 1)),
      dCrush: Math.round(m * 4.0 * scale * (magic ? 0.5 : 1)),
      dRange: Math.round(m * 4.2 * scale * (magic ? 0.3 : 1)),
      dMagic: Math.round(m * (magic ? 5.5 : ranged ? 0.6 : -0.8) * scale)
    }, extra),
    art
  });

  mk('helm', opts.helmName || 'mask', 'head', 0.55, magic ? { aMagic: m } : ranged ? { aRange: m } : {},
    { k: kind === 'cloth' ? 'mask' : 'helm', c: colour },
    opts.helmEx || 'Keeps the Throat\'s air out of your lungs.');
  mk('body', opts.bodyName || 'apron', 'body', 1.0, magic ? { aMagic: m * 2 } : ranged ? { aRange: m * 2 } : {},
    { k: kind === 'cloth' ? 'robe' : 'plate', c: colour },
    opts.bodyEx || 'Stained in a pattern only a nurse can read.');
  mk('legs', opts.legName || 'leggings', 'legs', 0.8, magic ? { aMagic: m } : ranged ? { aRange: m } : {},
    { k: kind === 'cloth' ? 'skirt' : 'legs', c: colour },
    opts.legEx || 'Reinforced at the knee, where you spend your time.');
  mk('gloves', 'gloves', 'hands', 0.25, { str: Math.round(m * 0.6) },
    { k: 'gloves', c: colour }, 'Two layers. Always two layers.');
  mk('boots', 'clogs', 'feet', 0.28, {}, { k: 'boots', c: colour },
    'Wipeable. That matters more than you think.');
  if (!magic) mk('ward', 'ward', 'shield', 0.85, {},
    { k: 'shield', c: colour }, 'A slab of something between you and the world.');
}

armourSet('linen', 'Linen', 1, 0, 'cloth', '#ded3c0');
armourSet('canvas', 'Canvas', 2, 5, 'cloth', '#c9b48f');
armourSet('leather', 'Boiled leather', 3, 10, 'plate', '#8f6a4a', { style: 'ranged' });
armourSet('ironblood', 'Ironblood', 5, 20, 'plate', '#9c6055');
armourSet('steel', 'Surgical steel', 7, 30, 'plate', '#c6ced6');
armourSet('bloodstone', 'Bloodstone', 10, 40, 'plate', '#b8323f',
  { bodyEx: 'It warms to your body heat, then a little past it.' });
armourSet('weave', 'Antibody weave', 6, 25, 'cloth', '#d9c0e0',
  { style: 'magic', helmName: 'hood', bodyName: 'robe', legName: 'skirt',
    bodyEx: 'Woven from something your body already knew how to make.' });

/* ---------------- Accessories ------------------------------- */

def({ id: 'mercy_cape', name: 'Cape of mercy', slot: 'cape', value: 900,
  examine: 'Worn by those who came back for the second patient.',
  b: { dStab: 6, dSlash: 6, dCrush: 6, str: 3 }, art: { k: 'cape', c: '#7d2a39' } });
def({ id: 'matrons_cape', name: 'Matron\'s cape', slot: 'cape', value: 12000, req: { triage: 50 },
  examine: 'Only the Matron may wear this. You are, apparently, the Matron.',
  b: { dStab: 14, dSlash: 14, dCrush: 14, dMagic: 10, str: 8, vigil: 4 },
  art: { k: 'cape', c: '#e0b357', glow: true } });

def({ id: 'amulet_sterility', name: 'Amulet of sterility', slot: 'neck', value: 780,
  examine: 'Nothing grows on it. Nothing ever will.',
  b: { dStab: 8, dSlash: 8, dCrush: 8, dMagic: 6 }, art: { k: 'amulet', c: '#c6ced6' } });
def({ id: 'amulet_mercy', name: 'Amulet of mercy', slot: 'neck', value: 1900,
  examine: 'A pendant shaped like a closed hand.',
  b: { str: 10, aStab: 8, aSlash: 8, aCrush: 8 }, art: { k: 'amulet', c: '#d4586b' } });
def({ id: 'vigil_pendant', name: 'Pendant of the vigil', slot: 'neck', value: 4200, req: { vigil: 30 },
  examine: 'Cold in the hand, all night, every night.',
  b: { vigil: 8, dMagic: 12 }, art: { k: 'amulet', c: '#86b7e0', glow: true } });

def({ id: 'steady_ring', name: 'Ring of steady hands', slot: 'ring', value: 1500,
  examine: 'The tremor stops the moment it slides on.',
  b: { aStab: 6, aSlash: 6, aRange: 6, aMagic: 6 }, art: { k: 'ring', c: '#c9a34a' } });
def({ id: 'recall_ring', name: 'Ring of recall', slot: 'ring', value: 2400,
  examine: 'Rub it and the ward pulls you home. Three charges left.',
  b: {}, charges: 3, teleport: 'lumbrisdale', art: { k: 'ring', c: '#86b7e0' } });

/* ---------------- Quest & key items ------------------------- */

const quest = (id, name, examine, art) =>
  def({ id, name, examine, value: 0, questItem: true, art });

quest('mercy_key', 'Mercy House key', 'Opens the ward\'s back stair.', { k: 'key', c: '#c9a34a' });
quest('ward_ledger', 'Ward ledger', 'Names, doses, times. Someone has been lying.', { k: 'book', c: '#8f6a4a' });
quest('tonsil_charm', 'Tonsil charm', 'A knot of red thread and small bone.', { k: 'charm', c: '#c0303f' });
quest('choking_seal', 'Choking seal', 'A wax seal stamped with a closed windpipe.', { k: 'seal', c: '#5a2030' });
quest('xavins_lozenge', 'Xavin\'s lozenge', 'It is warm and it is looking at you.',
  { k: 'pill', c: '#e0b357', glow: true });
quest('fen_permit', 'Fen permit', 'Grants passage into the Bogged Fen.', { k: 'scroll', c: '#ded3c0' });
quest('anatomy_notes', 'Torn anatomy notes', 'Half a diagram of something with too many valves.',
  { k: 'scroll', c: '#c9b48f' });
quest('spinner_silk', 'Spinner silk', 'Still faintly sticky.', { k: 'fluff', c: '#d9c0e0' });
quest('bloodstone_shard', 'Bloodstone shard', 'A splinter of the heart of the Throat.',
  { k: 'gem', c: '#c0303f', glow: true });

/* ---------------- Registry ---------------------------------- */

export const ITEMS = Object.fromEntries(ITEM_LIST.map(i => [i.id, i]));
export const ALL_ITEM_IDS = ITEM_LIST.map(i => i.id);

export const item = id => ITEMS[id];
export const itemName = id => ITEMS[id]?.name ?? id;
export const isStackable = id => !!ITEMS[id]?.stack;

/** Equipment slots in the order the paper-doll draws them. */
export const EQUIP_SLOTS = [
  'head', 'cape', 'neck',
  'weapon', 'body', 'shield',
  'legs', 'hands', 'feet',
  'ring', 'ammo'
];

export const SLOT_LABEL = {
  head: 'Head', cape: 'Cape', neck: 'Neck', weapon: 'Weapon', body: 'Body',
  shield: 'Off-hand', legs: 'Legs', hands: 'Hands', feet: 'Feet',
  ring: 'Ring', ammo: 'Ammunition'
};

export const SLOT_GLYPH = {
  head: '🎭', cape: '🧣', neck: '📿', weapon: '🗡️', body: '🥼',
  shield: '🛡️', legs: '👖', hands: '🧤', feet: '🥾', ring: '💍', ammo: '💉'
};

export const BONUS_KEYS = [
  ['aStab', 'Stab'], ['aSlash', 'Slash'], ['aCrush', 'Crush'],
  ['aRange', 'Injection'], ['aMagic', 'Anatomancy']
];
export const DEF_KEYS = [
  ['dStab', 'Stab'], ['dSlash', 'Slash'], ['dCrush', 'Crush'],
  ['dRange', 'Injection'], ['dMagic', 'Anatomancy']
];
export const OTHER_KEYS = [
  ['str', 'Vigour bonus'], ['rStr', 'Injection strength'],
  ['mDmg', 'Anatomancy damage'], ['vigil', 'Vigil bonus']
];

/* ============================================================
   Production recipes - smelting, forging, brewing, sewing, cooking
   Each station key maps to a list of makeable outputs.
   ============================================================ */

/** need: { itemId: qty }  ->  out: itemId x count */
const R = (skill, level, xp, need, out, count = 1, extra = {}) =>
  Object.assign({ skill, level, xp, need, out, count }, extra);

export const RECIPES = {

  /* ---------------- Furnace ------------------------------- */
  smelting: [
    R('forging', 1,  12, { ironblood_ore: 1 }, 'ironblood_bar'),
    R('forging', 20, 34, { ironblood_ore: 1, chalk_lump: 2 }, 'steel_bar'),
    R('forging', 40, 78, { bloodstone_ore: 1, rocksalt: 1 }, 'bloodstone_bar')
  ],

  /* ---------------- Anvil --------------------------------- */
  forging: [
    R('forging', 3,  20, { ironblood_bar: 1 }, 'reflex_hammer'),
    R('forging', 5,  22, { ironblood_bar: 1 }, 'tap_knife'),
    R('forging', 6,  22, { ironblood_bar: 1 }, 'bone_pick'),
    R('forging', 8,  25, { ironblood_bar: 1 }, 'needle', 4),
    R('forging', 10, 30, { ironblood_bar: 1 }, 'dart_syringe', 10),
    R('forging', 12, 34, { ironblood_bar: 1 }, 'steel_scalpel'),
    R('forging', 15, 45, { ironblood_bar: 2 }, 'ironblood_helm'),
    R('forging', 18, 45, { ironblood_bar: 2 }, 'ironblood_ward'),
    R('forging', 22, 68, { ironblood_bar: 3 }, 'ironblood_legs'),
    R('forging', 25, 90, { ironblood_bar: 4 }, 'ironblood_body'),
    R('forging', 28, 42, { ironblood_bar: 1 }, 'ironblood_gloves'),
    R('forging', 29, 42, { ironblood_bar: 1 }, 'ironblood_boots'),

    R('forging', 30, 60, { steel_bar: 1 }, 'bone_saw'),
    R('forging', 33, 70, { steel_bar: 1 }, 'surgical_scalpel'),
    R('forging', 35, 75, { steel_bar: 2 }, 'trocar_spear'),
    R('forging', 38, 84, { steel_bar: 2 }, 'steel_helm'),
    R('forging', 40, 84, { steel_bar: 2 }, 'steel_ward'),
    R('forging', 44, 126, { steel_bar: 3 }, 'steel_legs'),
    R('forging', 48, 168, { steel_bar: 4 }, 'steel_body'),
    R('forging', 50, 80, { steel_bar: 1 }, 'steel_gloves'),
    R('forging', 51, 80, { steel_bar: 1 }, 'steel_boots'),
    R('forging', 55, 150, { steel_bar: 2 }, 'amputation_saw'),

    R('forging', 60, 190, { bloodstone_bar: 2 }, 'bloodstone_helm'),
    R('forging', 62, 190, { bloodstone_bar: 2 }, 'bloodstone_ward'),
    R('forging', 66, 285, { bloodstone_bar: 3 }, 'bloodstone_legs'),
    R('forging', 70, 380, { bloodstone_bar: 4 }, 'bloodstone_body'),
    R('forging', 72, 180, { bloodstone_bar: 1 }, 'bloodstone_gloves'),
    R('forging', 73, 180, { bloodstone_bar: 1 }, 'bloodstone_boots'),
    R('forging', 75, 300, { bloodstone_bar: 2, ivorybark_log: 1 }, 'ivory_lance'),
    R('forging', 80, 420, { bloodstone_bar: 3, bloodstone_shard: 1 }, 'crimson_scalpel')
  ],

  /* ---------------- Cauldron ------------------------------ */
  apothecary: [
    R('apothecary', 1,  25,  { vial_of_water: 1, coughcap: 1 }, 'salve_mending'),
    R('apothecary', 5,  30,  { vial_of_water: 1, coughcap: 1, honey_lozenge: 1 }, 'honey_lozenge', 3),
    R('apothecary', 12, 48,  { vial_of_water: 1, sootleaf: 1, rocksalt: 1 }, 'ward_elixir'),
    R('apothecary', 20, 66,  { vial_of_water: 1, palate_root: 1, amber_sap: 1 }, 'vigour_tonic'),
    R('apothecary', 30, 92,  { vial_of_water: 1, fevermoss: 1, lint: 2 }, 'greater_salve'),
    R('apothecary', 38, 118, { vial_of_water: 1, bile_lily: 1, bog_leech: 1 }, 'antivenin'),
    R('apothecary', 46, 150, { vial_of_water: 1, numbthistle: 1, amber_sap: 1 }, 'numbing_draught'),
    R('apothecary', 54, 190, { vial_of_water: 1, suture_vine: 1, chalk_lump: 1 }, 'clarity_philtre'),
    R('apothecary', 68, 260, { vial_of_water: 1, bloodbell: 1, bloodstone_ore: 1 }, 'surgeons_focus')
  ],

  /* ---------------- Sewing table -------------------------- */
  suturing: [
    R('suturing', 1,  16,  { lint: 2 }, 'gauze_wrap'),
    R('suturing', 4,  20,  { lint: 3, gut_thread: 1 }, 'linen_helm'),
    R('suturing', 6,  26,  { lint: 4, gut_thread: 1 }, 'linen_legs'),
    R('suturing', 8,  34,  { lint: 5, gut_thread: 2 }, 'linen_body'),
    R('suturing', 10, 18,  { lint: 2, gut_thread: 1 }, 'linen_gloves'),
    R('suturing', 11, 18,  { lint: 2, gut_thread: 1 }, 'linen_boots'),
    R('suturing', 14, 30,  { cotton_bale: 1 }, 'gut_thread', 6),
    R('suturing', 16, 44,  { cotton_bale: 1, gut_thread: 1 }, 'canvas_helm'),
    R('suturing', 18, 52,  { cotton_bale: 1, gut_thread: 2 }, 'canvas_legs'),
    R('suturing', 20, 62,  { cotton_bale: 2, gut_thread: 2 }, 'canvas_body'),
    R('suturing', 24, 70,  { lint: 4, cotton_bale: 1 }, 'pressure_dressing'),
    R('suturing', 30, 96,  { cotton_bale: 2, gut_thread: 2 }, 'mercy_cape'),
    R('suturing', 36, 120, { silkgut: 1, gut_thread: 2 }, 'weave_helm'),
    R('suturing', 40, 140, { silkgut: 1, gut_thread: 3 }, 'weave_legs'),
    R('suturing', 45, 175, { silkgut: 2, gut_thread: 3 }, 'weave_body'),
    R('suturing', 50, 160, { silkgut: 1, bloodbell: 1 }, 'tourniquet'),
    R('suturing', 55, 210, { silkgut: 2, spinner_silk: 1 }, 'weave_gloves'),
    R('suturing', 58, 210, { silkgut: 2, spinner_silk: 1 }, 'weave_boots')
  ],

  /* ---------------- Ward range ---------------------------- */
  cooking: [
    R('triage', 1,  30,  { bog_leech: 1 }, 'leech_broth', 1, { burn: 25, burnFrom: 12 }),
    R('triage', 10, 60,  { gullet_trout: 1 }, 'grilled_trout', 1, { burn: 32, burnFrom: 26 }),
    R('triage', 25, 110, { bile_eel: 1 }, 'smoked_eel', 1, { burn: 38, burnFrom: 44 }),
    R('triage', 45, 200, { gasper_fish: 1 }, 'roast_gasper', 1, { burn: 42, burnFrom: 66 })
  ]
};

export const STATION_TITLE = {
  smelting: 'Smelt at the furnace',
  forging: 'Work the anvil',
  apothecary: 'Brew at the cauldron',
  suturing: 'Sew at the table',
  cooking: 'Cook at the range'
};

export const STATION_SKILL = {
  smelting: 'forging', forging: 'forging',
  apothecary: 'apothecary', suturing: 'suturing', cooking: 'triage'
};

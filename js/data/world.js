/* ============================================================
   Xavin's Throat - terrain, settlements and interactive scenery
   ============================================================ */

import { fbm, hash2, makeRng, clamp } from '../util.js';

export const W = 192;
export const H = 192;

/* ---------------- Tiles ------------------------------------- */

export const T = {
  VOID: 0, TURF: 1, PATH: 2, BILE: 3, WALL: 4, FLOOR: 5,
  CHALK: 6, BOG: 7, STONE: 8, BRIDGE: 9, CARPET: 10,
  MOSS: 11, CAVE: 12, CAVEWALL: 13, TILE_FLOOR: 14, BLOOD: 15
};

export const TILE_INFO = {
  [T.VOID]:      { name: 'the drop',   walk: false, c: '#0a0508', c2: '#0a0508' },
  [T.TURF]:      { name: 'turf',       walk: true,  c: '#7a5a5e', c2: '#8a666a' },
  [T.PATH]:      { name: 'path',       walk: true,  c: '#9a8878', c2: '#a89685' },
  [T.BILE]:      { name: 'bile',       walk: false, c: '#5a6b3a', c2: '#6d7f45' },
  [T.WALL]:      { name: 'wall',       walk: false, c: '#6b5a52', c2: '#7a6860' },
  [T.FLOOR]:     { name: 'floor',      walk: true,  c: '#8a7666', c2: '#96816f' },
  [T.CHALK]:     { name: 'chalk',      walk: true,  c: '#b8ab99', c2: '#c4b7a4' },
  [T.BOG]:       { name: 'bog',        walk: true,  c: '#4f5340', c2: '#5a5f49', slow: true },
  [T.STONE]:     { name: 'stone',      walk: true,  c: '#77706c', c2: '#847d78' },
  [T.BRIDGE]:    { name: 'bridge',     walk: true,  c: '#8f6a4a', c2: '#9c7554' },
  [T.CARPET]:    { name: 'carpet',     walk: true,  c: '#7d3a45', c2: '#8a434e' },
  [T.MOSS]:      { name: 'moss',       walk: true,  c: '#5f7a55', c2: '#6b875f' },
  [T.CAVE]:      { name: 'cave floor', walk: true,  c: '#4a3d44', c2: '#55464e' },
  [T.CAVEWALL]:  { name: 'rock face',  walk: false, c: '#2e2429', c2: '#382c32' },
  [T.TILE_FLOOR]:{ name: 'ward tile',  walk: true,  c: '#a5a094', c2: '#b0ab9e' },
  [T.BLOOD]:     { name: 'stained turf',walk: true, c: '#6b3f44', c2: '#78484d' }
};

/* ---------------- Regions ----------------------------------- */

/**
 * The regions tile the playable area edge to edge - any gap between two
 * rectangles becomes impassable VOID and cuts the world in half, so the
 * bounds below are deliberately flush. Overlaps resolve to the first match.
 */
export const REGIONS = [
  { id: 'lumbrisdale', name: 'Lumbrisdale',   x: 6,   y: 124, w: 58,  h: 60, base: T.TURF,  tint: '#8a666a', safe: true,
    blurb: 'The last working ward in the Throat.' },
  { id: 'wilds',       name: 'The Palate Wilds', x: 64, y: 112, w: 56, h: 72, base: T.TURF, tint: '#7a5a5e',
    blurb: 'Open ground between the two lights.' },
  { id: 'vellumhaven', name: 'Vellumhaven',   x: 120, y: 122, w: 64,  h: 62, base: T.STONE, tint: '#8d867f', safe: true,
    blurb: 'City of ledgers, guilds and expensive mercy.' },
  { id: 'fen',         name: 'The Bogged Fen', x: 6,  y: 50,  w: 66,  h: 74, base: T.BOG,   tint: '#5a5f49',
    blurb: 'Standing bile and things that live in it.' },
  { id: 'gullet',      name: 'The Gullet Road', x: 72, y: 50, w: 46,  h: 62, base: T.BLOOD, tint: '#6b3f44',
    blurb: 'A long red corridor. Nothing good uses it.' },
  { id: 'uvula',       name: 'Uvula Heights',  x: 118, y: 50, w: 66,  h: 72, base: T.CHALK, tint: '#b8ab99',
    blurb: 'Pale cliffs above the whole aching throat.' },
  { id: 'larynx',      name: 'The Larynx Deep', x: 6,  y: 6,  w: 178, h: 44, base: T.CAVE,  tint: '#55464e',
    blurb: 'Where the Throat still makes sound.' }
];

export const regionById = id => REGIONS.find(r => r.id === id);

/* ---------------- Scenery object types ---------------------- */

/**
 * `act` is the default left-click verb. `skill`/`level`/`xp` drive gathering.
 * `block: false` lets the player stand on the tile.
 */
export const OBJ = {
  /* -- gathering ------------------------------------------- */
  throatwood: { name: 'Throatwood', act: 'Chop', skill: 'tapping', level: 1, xp: 25,
    yield: 'throatwood_log', tool: 'tapping', respawn: 50, art: 'tree', c: '#c9a68e', leaf: '#a3707a',
    examine: 'Pale bark, warm as a wrist.' },
  sapwood: { name: 'Sapwood tree', act: 'Chop', skill: 'tapping', level: 15, xp: 68,
    yield: 'sapwood_log', extra: { id: 'amber_sap', chance: 0.35 }, tool: 'tapping', respawn: 78,
    art: 'tree', c: '#b8853f', leaf: '#c9a34a', examine: 'It weeps amber where the bark splits.' },
  ivorybark: { name: 'Ivorybark', act: 'Chop', skill: 'tapping', level: 35, xp: 190,
    yield: 'ivorybark_log', tool: 'tapping', respawn: 120, art: 'tree', c: '#e4dcc6', leaf: '#cfc7ae',
    examine: 'Hard as enamel and twice as smug.' },

  salt_vein: { name: 'Rocksalt vein', act: 'Mine', skill: 'delving', level: 1, xp: 20,
    yield: 'rocksalt', tool: 'delving', respawn: 26, art: 'rock', c: '#e0dcd2',
    examine: 'White crust in the cartilage.' },
  chalk_vein: { name: 'Chalk seam', act: 'Mine', skill: 'delving', level: 10, xp: 42,
    yield: 'chalk_lump', tool: 'delving', respawn: 36, art: 'rock', c: '#ded9cb',
    examine: 'Crumbles if you look at it firmly.' },
  ironblood_vein: { name: 'Ironblood vein', act: 'Mine', skill: 'delving', level: 20, xp: 88,
    yield: 'ironblood_ore', tool: 'delving', respawn: 70, art: 'rock', c: '#8f4a3f',
    examine: 'It rusts the pick a little every time.' },
  bloodstone_vein: { name: 'Bloodstone vein', act: 'Mine', skill: 'delving', level: 40, xp: 240,
    yield: 'bloodstone_ore', tool: 'delving', respawn: 150, art: 'rock', c: '#a12a35', glow: true,
    examine: 'Warm. It flinches when struck.' },

  herb_patch: { name: 'Herb patch', act: 'Forage', skill: 'foraging', level: 1, xp: 0,
    herbRoll: true, respawn: 50, art: 'bush', c: '#7fbf8f', block: false,
    examine: 'Something medicinal is growing here.' },
  lint_growth: { name: 'Lint growth', act: 'Gather', skill: 'foraging', level: 1, xp: 14,
    yield: 'lint', respawn: 25, art: 'fluffbush', c: '#ded3c0', block: false,
    examine: 'The Throat sheds. Useful, if you are not squeamish.' },
  cotton_stand: { name: 'Cotton stand', act: 'Gather', skill: 'foraging', level: 18, xp: 55,
    yield: 'cotton_bale', respawn: 58, art: 'fluffbush', c: '#f0e8d8', block: false,
    examine: 'Farmed, once. Now it just persists.' },

  leech_pool: { name: 'Leech pool', act: 'Net', skill: 'leeching', level: 1, xp: 22,
    yield: 'bog_leech', tool: 'leeching', respawn: 0, art: 'pool', block: false,
    examine: 'The surface is moving on its own.' },
  trout_run: { name: 'Trout run', act: 'Net', skill: 'leeching', level: 12, xp: 58,
    yield: 'gullet_trout', tool: 'leeching', respawn: 0, art: 'pool', block: false,
    examine: 'Pale shapes hold against the current.' },
  eel_hole: { name: 'Eel hole', act: 'Gaff', skill: 'leeching', level: 28, xp: 130,
    yield: 'bile_eel', tool: 'gaff', respawn: 0, art: 'pool', block: false,
    examine: 'Do not put your hand in.' },
  gasper_shallows: { name: 'Gasper shallows', act: 'Gaff', skill: 'leeching', level: 45, xp: 280,
    yield: 'gasper_fish', tool: 'gaff', respawn: 0, art: 'pool', block: false,
    examine: 'Something in there is breathing air.' },

  /* -- stations -------------------------------------------- */
  cauldron:  { name: 'Apothecary cauldron', act: 'Brew', station: 'apothecary', art: 'cauldron',
    examine: 'Bubbling. Optimistically.' },
  anvil:     { name: 'Anvil', act: 'Forge', station: 'forging', art: 'anvil',
    examine: 'Scarred by a thousand honest hours.' },
  furnace:   { name: 'Furnace', act: 'Smelt', station: 'smelting', art: 'furnace',
    examine: 'Hot enough to argue with ore.' },
  sewing_table: { name: 'Sewing table', act: 'Sew', station: 'suturing', art: 'table',
    examine: 'Needles, gut, and a very good lamp.' },
  cook_range: { name: 'Ward range', act: 'Cook', station: 'cooking', art: 'range',
    examine: 'Where the ward\'s food is made, and occasionally burnt.' },
  bank_booth: { name: 'Bank booth', act: 'Bank', station: 'bank', art: 'booth',
    examine: 'Your possessions, kept safer than you are.' },
  altar:     { name: 'Vigil altar', act: 'Pray at', station: 'altar', art: 'altar',
    examine: 'Candles burnt down to their own wax.' },
  bed:       { name: 'Ward bed', act: 'Rest at', station: 'bed', art: 'bed', block: false,
    examine: 'Made up, waiting for its next occupant.' },

  /* -- world features -------------------------------------- */
  well:  { name: 'Well', act: 'Fill from', station: 'water', art: 'well', examine: 'Water. Probably.' },
  sign:  { name: 'Signpost', act: 'Read', station: 'sign', art: 'sign', examine: 'Painted, then repainted.' },
  gate:  { name: 'Gate', act: 'Open', station: 'gate', art: 'gate', block: false,
    examine: 'Shut, but not locked.' },
  // Doors swing open as you approach, so paths may route straight through them.
  door:  { name: 'Door', act: 'Open', station: 'door', art: 'door', block: false,
    examine: 'A door. It does door things.' },
  crate: { name: 'Crate', act: 'Search', station: 'crate', art: 'crate', examine: 'Ward supplies. Allegedly.' },
  rubble:{ name: 'Rubble', act: 'Search', station: 'crate', art: 'rubble', block: false,
    examine: 'Something fell down here, hard.' },
  brazier:{ name: 'Brazier', act: 'Examine', station: null, art: 'brazier', examine: 'Keeps the corridor honest.' },
  gravestone: { name: 'Gravestone', act: 'Read', station: 'grave', art: 'grave',
    examine: 'One of far too many.' }
};

/* ---------------- Build ------------------------------------- */

export function buildWorld() {
  const tiles = new Uint8Array(W * H);
  const regionGrid = new Uint8Array(W * H).fill(255);
  const objects = [];
  const objAt = new Map();
  const npcSpawns = [];
  const rng = makeRng(0x7A11C0DE);

  const idx = (x, y) => y * W + x;
  const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const set = (x, y, t) => { if (inB(x, y)) tiles[idx(x, y)] = t; };
  const get = (x, y) => inB(x, y) ? tiles[idx(x, y)] : T.VOID;

  /* --- base terrain from regions + noise ------------------ */
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = -1;
      for (let i = 0; i < REGIONS.length; i++) {
        const R = REGIONS[i];
        if (x >= R.x && y >= R.y && x < R.x + R.w && y < R.y + R.h) { r = i; break; }
      }
      if (r < 0) { tiles[idx(x, y)] = T.VOID; continue; }
      regionGrid[idx(x, y)] = r;

      const R = REGIONS[r];
      let t = R.base;
      const n = fbm(x * 0.055, y * 0.055, r * 71, 3);
      const n2 = fbm(x * 0.14, y * 0.14, 400 + r, 2);

      switch (R.id) {
        case 'fen':
          t = n < 0.42 ? T.BILE : n < 0.55 ? T.BOG : n2 > 0.62 ? T.MOSS : T.BOG;
          break;
        case 'wilds':
          t = n < 0.33 ? T.BILE : n2 > 0.68 ? T.MOSS : T.TURF;
          break;
        case 'lumbrisdale':
          t = n < 0.27 ? T.BILE : T.TURF;
          break;
        case 'gullet':
          t = n < 0.30 ? T.BILE : n2 > 0.66 ? T.TURF : T.BLOOD;
          break;
        case 'uvula':
          t = n < 0.30 ? T.CAVEWALL : n2 > 0.70 ? T.STONE : T.CHALK;
          break;
        case 'larynx':
          t = n < 0.40 ? T.CAVEWALL : n2 > 0.74 ? T.BLOOD : T.CAVE;
          break;
        case 'vellumhaven':
          // flagstones, worn patches, and moss in the joints
          t = n < 0.30 ? T.CHALK : n2 > 0.74 ? T.MOSS : T.STONE;
          break;
      }
      tiles[idx(x, y)] = t;
    }
  }

  /* --- helpers -------------------------------------------- */
  const rect = (x, y, w, h, t) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, t);
  };
  const border = (x, y, w, h, t) => {
    for (let i = x; i < x + w; i++) { set(i, y, t); set(i, y + h - 1, t); }
    for (let j = y; j < y + h; j++) { set(x, j, t); set(x + w - 1, j, t); }
  };

  /** Wide, slightly wandering road between two points. */
  const road = (x1, y1, x2, y2, width = 3, t = T.PATH) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2;
    for (let s = 0; s <= steps; s++) {
      const p = s / steps;
      const wob = Math.sin(p * Math.PI * 3) * 2.2;
      const cx = Math.round(x1 + (x2 - x1) * p + wob * (y2 !== y1 ? 1 : 0));
      const cy = Math.round(y1 + (y2 - y1) * p + wob * (x2 !== x1 ? 1 : 0));
      const half = Math.floor(width / 2);
      for (let j = -half; j <= half; j++) {
        for (let i = -half; i <= half; i++) {
          if (Math.abs(i) + Math.abs(j) > half + 1) continue;
          const tx = cx + i, ty = cy + j;
          if (!inB(tx, ty)) continue;
          const cur = get(tx, ty);
          if (cur === T.VOID || cur === T.WALL || cur === T.FLOOR) continue;
          set(tx, ty, cur === T.BILE ? T.BRIDGE : t);
        }
      }
    }
  };

  const addObj = (type, x, y, extra = {}) => {
    const d = OBJ[type];
    if (!d || !inB(x, y)) return null;
    const k = x + ',' + y;
    if (objAt.has(k)) return null;
    const o = Object.assign({
      type, x, y, uid: objects.length,
      block: d.block !== false,
      depleted: 0
    }, extra);
    objects.push(o);
    objAt.set(k, o);
    return o;
  };

  /**
   * Stamps a building: wall ring, interior floor, and a doorway.
   * `doors` are absolute tile coords that must sit on the wall ring.
   */
  const building = (x, y, w, h, doors, floor = T.FLOOR, name = '') => {
    rect(x, y, w, h, floor);
    border(x, y, w, h, T.WALL);
    for (const d of doors) {
      set(d.x, d.y, floor);
      addObj('door', d.x, d.y, { open: false, label: name });
    }
    return { x, y, w, h, name };
  };

  /* --- Lumbrisdale --------------------------------------- */
  rect(14, 130, 44, 48, T.TURF);
  road(30, 178, 30, 128, 3);
  road(16, 152, 58, 152, 3);

  building(18, 134, 18, 14, [{ x: 26, y: 147 }], T.TILE_FLOOR, 'Mercy House');
  rect(20, 136, 14, 10, T.TILE_FLOOR);
  for (let i = 0; i < 4; i++) addObj('bed', 21 + i * 3, 138);
  for (let i = 0; i < 4; i++) addObj('bed', 21 + i * 3, 143);
  addObj('cook_range', 34, 137);
  addObj('crate', 34, 145);

  building(40, 134, 10, 8, [{ x: 44, y: 141 }], T.FLOOR, 'Apothecary');
  addObj('cauldron', 44, 136);
  addObj('sewing_table', 47, 138);

  building(40, 144, 10, 7, [{ x: 44, y: 150 }], T.FLOOR, 'General store');
  addObj('crate', 47, 146);

  building(16, 156, 14, 9, [{ x: 22, y: 164 }], T.CARPET, 'Lumbrisdale bank');
  addObj('bank_booth', 19, 158); addObj('bank_booth', 21, 158);
  addObj('bank_booth', 23, 158); addObj('bank_booth', 25, 158);

  building(36, 158, 12, 10, [{ x: 41, y: 167 }], T.STONE, 'Forge');
  addObj('furnace', 39, 160); addObj('anvil', 43, 161); addObj('anvil', 45, 163);

  building(18, 168, 12, 10, [{ x: 23, y: 177 }], T.CARPET, 'Chapel of the Quiet Ward');
  addObj('altar', 23, 170);

  addObj('well', 31, 155);
  addObj('sign', 29, 160, { text: 'LUMBRISDALE — Mercy House, north. Fen road, west. Vellumhaven, east.' });
  addObj('sign', 30, 129, { text: 'North: the Gullet Road. Travellers are advised not to.' });

  for (let i = 0; i < 5; i++) addObj('gravestone', 50 + (i % 3) * 2, 170 + Math.floor(i / 3) * 2);

  npcSpawns.push(
    { npc: 'matron_vell', x: 22, y: 140 },
    { npc: 'orderly_punn', x: 28, y: 150 },
    { npc: 'patient_row', x: 21, y: 139 },
    { npc: 'patient_row', x: 24, y: 139 },
    { npc: 'patient_row', x: 27, y: 144 },
    { npc: 'apoth_dree', x: 45, y: 138 },
    { npc: 'quartermaster_sceld', x: 44, y: 147 },
    { npc: 'banker_hollis', x: 22, y: 160 },
    { npc: 'smith_marrow', x: 42, y: 164 },
    { npc: 'tomas', x: 33, y: 172 }
  );

  /* --- Vellumhaven ---------------------------------------- */
  rect(124, 128, 54, 50, T.STONE);
  road(120, 152, 178, 152, 4);
  road(150, 128, 150, 180, 4);

  building(128, 132, 16, 12, [{ x: 135, y: 143 }], T.CARPET, 'Vellumhaven bank');
  for (let i = 0; i < 5; i++) addObj('bank_booth', 130 + i * 2, 134);

  building(156, 132, 16, 12, [{ x: 163, y: 143 }], T.FLOOR, 'Guild of Physicians');
  addObj('cauldron', 159, 134); addObj('cauldron', 161, 134);
  addObj('sewing_table', 165, 136); addObj('cook_range', 168, 134);

  building(128, 158, 14, 12, [{ x: 134, y: 169 }], T.STONE, 'Vellum forge');
  addObj('furnace', 131, 160); addObj('furnace', 133, 160);
  addObj('anvil', 136, 162); addObj('anvil', 138, 164);

  building(158, 158, 16, 12, [{ x: 165, y: 169 }], T.FLOOR, 'Grand dispensary');
  addObj('crate', 161, 160); addObj('crate', 163, 160);

  addObj('sign', 149, 148, { text: 'VELLUMHAVEN — mind your ledger, mind your manners.' });
  addObj('well', 152, 156);
  for (let i = 0; i < 6; i++) addObj('brazier', 145 + i * 2, 150);

  npcSpawns.push(
    { npc: 'banker_hollis', x: 134, y: 136 },
    { npc: 'apoth_dree', x: 162, y: 162 },
    { npc: 'quartermaster_sceld', x: 166, y: 162 },
    { npc: 'smith_marrow', x: 135, y: 163 },
    { npc: 'sister_ambrose', x: 160, y: 137 }
  );

  /* --- Fen ------------------------------------------------ */
  road(60, 150, 40, 100, 3);
  road(40, 100, 20, 70, 3);
  building(30, 92, 10, 8, [{ x: 34, y: 99 }], T.FLOOR, 'Fenwarden\'s hut');
  addObj('cook_range', 33, 94);
  addObj('crate', 37, 94);
  npcSpawns.push({ npc: 'fenwarden_gob', x: 35, y: 101 });
  addObj('sign', 41, 99, { text: 'THE BOGGED FEN — permit required past the markers.' });

  /* --- Uvula Heights -------------------------------------- */
  road(150, 128, 150, 60, 3);
  building(142, 54, 14, 12, [{ x: 148, y: 65 }], T.CARPET, 'Chapel of the Uvula');
  addObj('altar', 148, 56); addObj('altar', 146, 58); addObj('altar', 150, 58);
  npcSpawns.push({ npc: 'sister_ambrose', x: 148, y: 60 });
  addObj('sign', 151, 70, { text: 'UVULA HEIGHTS — the air is thin, the view is worse.' });

  /* --- Gullet Road ---------------------------------------- */
  road(92, 112, 92, 50, 4);
  for (let i = 0; i < 8; i++) addObj('brazier', 89, 56 + i * 7);
  addObj('sign', 94, 108, { text: 'THE GULLET ROAD — turn back. — signed, everyone.' });

  /* --- Larynx Deep ---------------------------------------- */
  road(92, 50, 92, 20, 4, T.CAVE);
  road(60, 20, 140, 20, 4, T.CAVE);
  rect(84, 10, 18, 14, T.CAVE);
  border(84, 10, 18, 14, T.CAVEWALL);
  set(92, 23, T.CAVE); set(93, 23, T.CAVE);
  for (let i = 0; i < 6; i++) addObj('brazier', 86 + i * 3, 12);
  npcSpawns.push({ npc: 'choking_matron', x: 93, y: 16 });

  /* --- Resource scatter ----------------------------------- */
  const scatterable = (x, y, ...ok) => ok.includes(get(x, y)) && !objAt.has(x + ',' + y);

  const scatter = (type, regionId, count, allow, tries = 60) => {
    const R = regionById(regionId);
    for (let n = 0; n < count; n++) {
      for (let t = 0; t < tries; t++) {
        const x = R.x + 1 + Math.floor(rng() * (R.w - 2));
        const y = R.y + 1 + Math.floor(rng() * (R.h - 2));
        if (!scatterable(x, y, ...allow)) continue;
        if (regionGrid[idx(x, y)] !== REGIONS.indexOf(R)) continue;
        if (addObj(type, x, y)) break;
      }
    }
  };

  const nearBile = (x, y) => {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++)
      if (get(x + i, y + j) === T.BILE) return true;
    return false;
  };
  const scatterShore = (type, regionId, count) => {
    const R = regionById(regionId);
    for (let n = 0; n < count; n++) {
      for (let t = 0; t < 120; t++) {
        const x = R.x + 1 + Math.floor(rng() * (R.w - 2));
        const y = R.y + 1 + Math.floor(rng() * (R.h - 2));
        const cur = get(x, y);
        if (cur === T.BILE || cur === T.VOID || cur === T.WALL) continue;
        if (!nearBile(x, y) || objAt.has(x + ',' + y)) continue;
        if (addObj(type, x, y)) break;
      }
    }
  };

  scatter('throatwood', 'lumbrisdale', 26, [T.TURF, T.MOSS]);
  scatter('throatwood', 'wilds', 34, [T.TURF, T.MOSS]);
  scatter('sapwood', 'wilds', 16, [T.TURF, T.MOSS]);
  scatter('sapwood', 'fen', 14, [T.BOG, T.MOSS]);
  scatter('ivorybark', 'uvula', 14, [T.CHALK, T.STONE]);
  scatter('ivorybark', 'larynx', 10, [T.CAVE]);

  scatter('salt_vein', 'lumbrisdale', 10, [T.TURF]);
  scatter('salt_vein', 'uvula', 20, [T.CHALK, T.STONE]);
  scatter('chalk_vein', 'uvula', 18, [T.CHALK, T.STONE]);
  scatter('ironblood_vein', 'uvula', 14, [T.CHALK, T.STONE]);
  scatter('ironblood_vein', 'larynx', 16, [T.CAVE, T.BLOOD]);
  scatter('bloodstone_vein', 'larynx', 12, [T.CAVE, T.BLOOD]);
  scatter('bloodstone_vein', 'gullet', 6, [T.BLOOD]);

  scatter('lint_growth', 'lumbrisdale', 18, [T.TURF]);
  scatter('lint_growth', 'wilds', 20, [T.TURF, T.MOSS]);
  scatter('cotton_stand', 'wilds', 12, [T.TURF, T.MOSS]);
  scatter('cotton_stand', 'vellumhaven', 4, [T.STONE]);
  scatter('herb_patch', 'lumbrisdale', 10, [T.TURF]);
  scatter('herb_patch', 'wilds', 22, [T.TURF, T.MOSS]);
  scatter('herb_patch', 'fen', 24, [T.BOG, T.MOSS]);
  scatter('herb_patch', 'uvula', 16, [T.CHALK, T.STONE]);
  scatter('herb_patch', 'gullet', 12, [T.BLOOD, T.TURF]);
  scatter('herb_patch', 'larynx', 10, [T.CAVE, T.BLOOD]);

  scatterShore('leech_pool', 'lumbrisdale', 8);
  scatterShore('leech_pool', 'fen', 14);
  scatterShore('trout_run', 'lumbrisdale', 6);
  scatterShore('trout_run', 'wilds', 10);
  scatterShore('eel_hole', 'fen', 12);
  scatterShore('gasper_shallows', 'gullet', 6);
  scatterShore('gasper_shallows', 'larynx', 5);

  scatter('rubble', 'gullet', 14, [T.BLOOD, T.TURF]);
  scatter('rubble', 'larynx', 12, [T.CAVE]);
  scatter('crate', 'vellumhaven', 8, [T.STONE]);

  /* --- Monster spawns ------------------------------------- */
  const mobScatter = (id, regionId, count, allow) => {
    const R = regionById(regionId);
    const ri = REGIONS.indexOf(R);
    for (let n = 0; n < count; n++) {
      for (let t = 0; t < 80; t++) {
        const x = R.x + 2 + Math.floor(rng() * (R.w - 4));
        const y = R.y + 2 + Math.floor(rng() * (R.h - 4));
        if (!allow.includes(get(x, y)) || objAt.has(x + ',' + y)) continue;
        if (regionGrid[idx(x, y)] !== ri) continue;
        npcSpawns.push({ npc: id, x, y });
        break;
      }
    }
  };

  mobScatter('ward_rat', 'lumbrisdale', 12, [T.TURF]);
  mobScatter('ward_rat', 'wilds', 10, [T.TURF, T.MOSS]);
  mobScatter('bile_slug', 'lumbrisdale', 6, [T.TURF]);
  mobScatter('bile_slug', 'fen', 14, [T.BOG, T.MOSS]);
  mobScatter('hackling', 'wilds', 16, [T.TURF, T.MOSS]);
  mobScatter('feral_patient', 'wilds', 14, [T.TURF, T.MOSS]);
  mobScatter('feral_patient', 'fen', 8, [T.BOG]);
  mobScatter('gullet_crawler', 'gullet', 16, [T.BLOOD, T.TURF]);
  mobScatter('bog_spinner', 'fen', 14, [T.BOG, T.MOSS]);
  mobScatter('tonsil_brute', 'gullet', 12, [T.BLOOD, T.TURF]);
  mobScatter('tonsil_brute', 'uvula', 8, [T.CHALK, T.STONE]);
  mobScatter('plague_monk', 'uvula', 14, [T.CHALK, T.STONE]);
  mobScatter('plague_monk', 'larynx', 8, [T.CAVE]);
  mobScatter('larynx_howler', 'larynx', 14, [T.CAVE, T.BLOOD]);

  /* --- walkability cache ---------------------------------- */
  const blocked = new Uint8Array(W * H);
  for (const o of objects) if (o.block) blocked[idx(o.x, o.y)] = 1;

  return {
    w: W, h: H, tiles, regionGrid, objects, objAt, npcSpawns, blocked,
    tileAt: (x, y) => inB(x, y) ? tiles[idx(x, y)] : T.VOID,
    regionAt(x, y) {
      if (!inB(x, y)) return null;
      const r = regionGrid[idx(x, y)];
      return r === 255 ? null : REGIONS[r];
    },
    objectAt: (x, y) => objAt.get(x + ',' + y) || null,
    /** Static walkability: terrain + blocking scenery. Entities checked elsewhere. */
    isWalkable(x, y) {
      if (!inB(x, y)) return false;
      const info = TILE_INFO[tiles[idx(x, y)]];
      if (!info || !info.walk) return false;
      if (blocked[idx(x, y)]) {
        const o = objAt.get(x + ',' + y);
        if (o && o.type === 'door' && o.open) return true;
        return false;
      }
      return true;
    },
    setBlocked(x, y, v) { if (inB(x, y)) blocked[idx(x, y)] = v ? 1 : 0; }
  };
}

/** Where a brand-new nurse wakes up. */
export const SPAWN = { x: 30, y: 152 };
export const RESPAWN = { x: 26, y: 150 };

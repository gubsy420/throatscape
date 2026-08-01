/* ============================================================
   Item models
   ------------------------------------------------------------
   Every item in the game, as a solid: what a weapon looks like
   in your hand, and what a drop looks like lying on the floor.

   One model serves both, built grip-down with the business end
   pointing up, so a scalpel held by the handle and a scalpel
   dropped in the mud are the same few triangles seen from
   different angles.

   Shapes are keyed on the art descriptor the item data already
   carries - the same `{ k, c, hilt, gem }` the flat renderer
   drew its icons from - so an item added by a content pack gets
   a model without anyone touching this file.
   ============================================================ */

import { MeshBuilder, rgb, tone } from '../gl/mesh.js';

const STEEL = '#c6ced6';
const WOOD = '#8a6a4a';
const BONE = '#ddd3bb';
const CLOTH = '#d8d2c4';

/* ------------------------------------------------------------
   Pieces that several things are made of
   ------------------------------------------------------------ */

/*
 * Weapons are big. A nurse is about 1.3 tiles tall, and a blade that reads at
 * a glance as a blade - in her hand, mid-swing, from ten tiles up - has to be
 * a good third of that. Modelled small they vanish into the fist, which is
 * exactly what happened the first time round.
 */

/** A handle running down from the grip, which most tools have. */
const grip = (b, c = WOOD, len = 0.17, r = 0.028) =>
  b.drum(0, -len, 0, r, r * 1.1, len, c, 6);

/** A flat blade rising from `y0`: two tapering faces meeting at an edge. */
function blade(b, c, len, wide, y0 = 0, thick = 0.012) {
  const col = rgb(c);
  const y1 = y0 + len;
  b.box(-wide, y0, -thick, wide, y0 + len * 0.18, thick, tone(col, -0.10));
  b.tri([-wide, y0, thick], [wide, y0, thick], [0, y1, 0], tone(col, 0.06));
  b.tri([wide, y0, -thick], [-wide, y0, -thick], [0, y1, 0], tone(col, -0.05));
  b.tri([wide, y0, thick], [wide, y0, -thick], [0, y1, 0], tone(col, 0.01));
  b.tri([-wide, y0, -thick], [-wide, y0, thick], [0, y1, 0], tone(col, 0.01));
}

const ITEMS = {
  /* -- bladed and pointed --------------------------------- */

  blade: (b, a) => {
    const hilt = a.hilt || '#6b4a2f';
    grip(b, hilt);
    b.drum(0, -0.20, 0, 0.038, 0.030, 0.035, tone(rgb(hilt), -0.16), 6);   // pommel
    b.box(-0.075, -0.010, -0.026, 0.075, 0.022, 0.026, tone(rgb(hilt), -0.10));
    blade(b, a.c || STEEL, 0.42, 0.048, 0.022, 0.018);
  },

  saw: (b, a) => {
    grip(b, '#6b4a2f');
    const c = a.c || BONE;
    b.box(-0.038, 0, -0.011, 0.038, 0.38, 0.011, c);
    for (let i = 0; i < 9; i++) {                      // teeth
      b.box(0.038, 0.03 + i * 0.038, -0.010, 0.068, 0.052 + i * 0.038, 0.010, tone(rgb(c), -0.10));
    }
    b.box(-0.042, -0.02, -0.016, 0.042, 0.02, 0.016, '#5a4735');
  },

  spear: (b, a) => {
    // gripped a third of the way up the shaft, which is where you would hold it
    b.drum(0, -0.40, 0, 0.026, 0.024, 0.82, WOOD, 6);
    b.drum(0, -0.43, 0, 0.034, 0.034, 0.04, '#5a4735', 6);      // the butt
    b.drum(0, 0.38, 0, 0.036, 0.030, 0.06, '#5a4735', 6);       // the socket
    blade(b, a.c || STEEL, 0.26, 0.046, 0.43);
  },

  pick: (b, a) => {
    grip(b, WOOD, 0.24, 0.026);
    const c = a.c || BONE;
    b.box(-0.024, 0, -0.024, 0.024, 0.09, 0.024, tone(rgb(c), -0.08));
    b.cone(0, 0.07, 0.035, 0.048, 0.26, c, 5);
    b.cone(0, 0.07, -0.035, 0.048, 0.20, tone(rgb(c), -0.05), 5);
  },

  needle: (b, a) => {
    b.drum(0, -0.03, 0, 0.012, 0.005, 0.34, a.c || STEEL, 5);
    b.drum(0, -0.06, 0, 0.022, 0.022, 0.03, tone(rgb(a.c || STEEL), -0.15), 6);
  },

  gaff: (b, a) => {
    b.drum(0, -0.34, 0, 0.024, 0.021, 0.72, WOOD, 6);
    // the hook the whole thing is named for
    const c = a.c || STEEL;
    b.drum(0, 0.34, 0, 0.018, 0.018, 0.10, c, 5);
    b.box(-0.014, 0.42, -0.014, 0.11, 0.45, 0.014, c);
    b.cone(0.11, 0.45, 0, 0.024, 0.09, tone(rgb(c), 0.08), 5, Math.PI);
  },

  /* -- blunt ----------------------------------------------- */

  hammer: (b, a) => {
    grip(b, WOOD, 0.26, 0.026);
    const c = a.c || '#5a5a62';
    b.box(-0.090, 0.0, -0.056, 0.090, 0.135, 0.056, c);
    b.box(-0.120, 0.020, -0.046, -0.090, 0.115, 0.046, tone(rgb(c), 0.06));
    b.box(0.090, 0.020, -0.046, 0.126, 0.115, 0.046, tone(rgb(c), -0.06));
    b.drum(0, -0.29, 0, 0.032, 0.032, 0.035, '#5a4735', 6);
  },

  staff: (b, a) => {
    b.drum(0, -0.44, 0, 0.026, 0.023, 0.86, a.c || WOOD, 6);
    b.ball(0, 0.47, 0, 0.075, a.gem || '#6fd1a5', 3, 7);
    for (let i = 0; i < 3; i++) {
      const t = i * 2.1;
      b.drum(Math.cos(t) * 0.05, 0.34, Math.sin(t) * 0.05, 0.016, 0.013, 0.11,
             tone(rgb(a.c || WOOD), -0.10), 4);
    }
  },

  /* -- thrown and shot ------------------------------------- */

  bow: (b, a) => {
    const c = a.c || BONE;
    for (const s of [-1, 1]) {
      b.quad([0.045, s * 0.03, -0.016], [0.085, s * 0.21, -0.016],
             [0.085, s * 0.21, 0.016], [0.045, s * 0.03, 0.016], c);
      b.quad([0.085, s * 0.21, -0.016], [0.030, s * 0.40, -0.016],
             [0.030, s * 0.40, 0.016], [0.085, s * 0.21, 0.016], tone(rgb(c), -0.06));
    }
    b.box(0.040, -0.05, -0.022, 0.078, 0.05, 0.022, tone(rgb(c), -0.12));
    b.box(0.020, -0.40, -0.006, 0.032, 0.40, 0.006, '#5a4a3a');    // the string
  },

  blowpipe: (b, a) => {
    b.drum(0, -0.30, 0, 0.032, 0.026, 0.66, a.c || '#6b8f5f', 7);
    b.drum(0, -0.32, 0, 0.046, 0.046, 0.045, tone(rgb(a.c || '#6b8f5f'), -0.14), 7);
    b.drum(0, 0.34, 0, 0.030, 0.030, 0.02, tone(rgb(a.c || '#6b8f5f'), 0.08), 7);
  },

  syringe: (b, a) => {
    const c = a.c || '#c9a34a';
    b.drum(0, -0.14, 0, 0.046, 0.046, 0.30, tone(rgb(c), 0.05), 7);
    b.drum(0, 0.16, 0, 0.014, 0.005, 0.22, tone(rgb(c), 0.12), 5);
    b.box(-0.070, -0.165, -0.018, 0.070, -0.14, 0.018, tone(rgb(c), -0.10));
    b.drum(0, -0.22, 0, 0.030, 0.030, 0.06, tone(rgb(c), -0.05), 6);
  },

  dart: (b, a) => {
    b.cone(0, 0.04, 0, 0.024, 0.17, a.c || STEEL, 5);
    b.drum(0, -0.11, 0, 0.014, 0.020, 0.15, tone(rgb(a.c || STEEL), -0.12), 5);
    for (let i = 0; i < 3; i++) {
      const t = i * 2.1;
      b.box(Math.cos(t) * 0.016, -0.13, Math.sin(t) * 0.016,
            Math.cos(t) * 0.052, -0.07, Math.sin(t) * 0.052, '#c0303f');
    }
  },

  net: (b) => {
    b.drum(0, -0.24, 0, 0.021, 0.018, 0.38, WOOD, 5);
    b.drum(0, 0.14, 0, 0.15, 0.16, 0.03, '#8a7c62', 8);
    b.drum(0, 0.03, 0, 0.045, 0.15, 0.11, '#6b6250', 8);
  },

  /* -- worn ------------------------------------------------ */

  helm: (b, a) => {
    const c = a.c || STEEL;
    b.ball(0, 0.02, 0, 0.10, c, 2, 7);
    b.drum(0, -0.06, 0, 0.105, 0.10, 0.06, tone(rgb(c), -0.06), 7);
    b.box(-0.018, -0.07, -0.115, 0.018, 0.05, -0.085, tone(rgb(c), 0.06));   // nose guard
  },

  mask: (b, a) => {
    const c = a.c || CLOTH;
    b.box(-0.075, -0.07, -0.03, 0.075, 0.08, 0.03, c);
    b.cone(0, -0.02, -0.03, 0.05, 0.16, tone(rgb(c), 0.05), 5, Math.PI / 2);  // the beak
    for (const s of [-1, 1]) b.ball(s * 0.04, 0.03, -0.03, 0.022, '#2a2028', 2, 5);
  },

  plate: (b, a) => {
    const c = a.c || STEEL;
    b.box(-0.09, -0.11, -0.05, 0.09, 0.09, 0.05, c);
    b.box(-0.125, 0.03, -0.045, -0.09, 0.10, 0.045, tone(rgb(c), 0.05));
    b.box(0.09, 0.03, -0.045, 0.125, 0.10, 0.045, tone(rgb(c), 0.05));
    b.box(-0.055, 0.09, -0.045, 0.055, 0.115, 0.045, tone(rgb(c), -0.10));
  },

  robe: (b, a) => {
    const c = a.c || '#6a5f52';
    b.drum(0, -0.13, 0, 0.115, 0.075, 0.24, c, 7);
    b.box(-0.10, 0.06, -0.03, 0.10, 0.11, 0.03, tone(rgb(c), -0.08));
    b.box(-0.02, -0.10, -0.05, 0.02, 0.08, -0.03, tone(rgb(c), 0.08));
  },

  legs: (b, a) => {
    const c = a.c || STEEL;
    for (const s of [-1, 1]) b.box(s * 0.015, -0.13, -0.04, s * 0.075, 0.06, 0.04, c);
    b.box(-0.08, 0.06, -0.045, 0.08, 0.11, 0.045, tone(rgb(c), 0.05));
  },

  skirt: (b, a) => {
    const c = a.c || CLOTH;
    b.drum(0, -0.13, 0, 0.12, 0.07, 0.22, c, 7);
    b.box(-0.075, 0.08, -0.035, 0.075, 0.115, 0.035, tone(rgb(c), -0.08));
  },

  gloves: (b, a) => {
    const c = a.c || '#8a6a4a';
    for (const s of [-1, 1]) {
      b.box(s * 0.01, -0.05, -0.03, s * 0.065, 0.05, 0.03, c);
      b.box(s * 0.02, 0.05, -0.025, s * 0.055, 0.085, 0.025, tone(rgb(c), -0.08));
    }
  },

  boots: (b, a) => {
    const c = a.c || '#4a3b36';
    for (const s of [-1, 1]) {
      b.box(s * 0.012, -0.06, -0.03, s * 0.065, 0.04, 0.05, c);
      b.box(s * 0.008, -0.075, -0.045, s * 0.07, -0.055, 0.06, tone(rgb(c), -0.14));
    }
  },

  shield: (b, a) => {
    const c = a.c || STEEL;
    b.quad([-0.10, 0.11, 0], [-0.10, -0.02, 0], [0, -0.14, 0], [0.10, -0.02, 0], tone(rgb(c), 0.05));
    b.tri([-0.10, 0.11, 0], [0.10, -0.02, 0], [0.10, 0.11, 0], tone(rgb(c), 0.05));
    b.box(-0.10, -0.13, -0.022, 0.10, 0.11, 0, tone(rgb(c), -0.10));
    b.ball(0, 0, -0.02, 0.032, tone(rgb(c), 0.12), 2, 6);
  },

  cape: (b, a) => {
    const c = a.c || '#7d3a45';
    b.quad([-0.075, 0.11, 0], [-0.11, -0.13, 0.03], [0.11, -0.13, 0.03], [0.075, 0.11, 0], c);
    b.quad([0.075, 0.11, 0.012], [0.11, -0.13, 0.042], [-0.11, -0.13, 0.042], [-0.075, 0.11, 0.012],
           tone(rgb(c), -0.12));
    b.box(-0.08, 0.10, -0.01, 0.08, 0.135, 0.02, tone(rgb(c), 0.08));
  },

  amulet: (b, a) => {
    const c = a.c || '#c9a34a';
    b.drum(0, 0.06, 0, 0.075, 0.075, 0.008, tone(rgb(c), -0.14), 10);
    b.ball(0, -0.02, 0, 0.045, c, 3, 6);
  },

  ring: (b, a) => {
    const c = a.c || '#c9a34a';
    b.drum(0, -0.008, 0, 0.055, 0.055, 0.016, c, 10);
    b.drum(0, -0.02, 0, 0.036, 0.036, 0.04, '#000000', 10);
    b.ball(0, 0.03, 0, 0.026, tone(rgb(c), 0.14), 2, 6);
  },

  /* -- carried --------------------------------------------- */

  coin: (b, a) => {
    const c = a.c || '#e0b357';
    for (let i = 0; i < 4; i++) {
      const t = i * 1.7;
      b.drum(Math.cos(t) * 0.05, -0.06 + i * 0.016, Math.sin(t) * 0.05,
             0.055, 0.055, 0.016, tone(rgb(c), i * 0.03 - 0.04), 8);
    }
  },

  bone: (b, a) => {
    const c = a.c || BONE;
    b.drum(0, -0.09, 0, 0.022, 0.022, 0.18, c, 6);
    for (const y of [-0.10, 0.08]) {
      for (const s of [-1, 1]) b.ball(s * 0.026, y, 0, 0.033, tone(rgb(c), 0.05), 2, 6);
    }
  },

  skull: (b) => {
    b.ball(0, 0.02, 0, 0.085, BONE, 3, 7);
    b.box(-0.055, -0.09, -0.075, 0.055, 0.005, 0.02, tone(rgb(BONE), -0.06));
    for (const s of [-1, 1]) b.ball(s * 0.036, 0.03, -0.07, 0.026, '#1d1216', 2, 5);
  },

  log: (b, a) => {
    const c = a.c || '#c9a68e';
    b.drum(0, -0.02, 0, 0.06, 0.06, 0.26, c, 7);
    b.drum(0, 0.24, 0, 0.032, 0.032, 0.008, tone(rgb(c), 0.10), 7);
  },

  ore: (b, a) => {
    const c = a.c || '#8f8880';
    b.ball(0, 0.03, 0, 0.085, '#6b625c', 2, 6);
    for (let i = 0; i < 4; i++) {
      const t = i * 1.6;
      b.ball(Math.cos(t) * 0.05, 0.05 + Math.sin(t * 2) * 0.03, Math.sin(t) * 0.05,
             0.032, c, 2, 5);
    }
  },

  bar: (b, a) => {
    const c = a.c || '#8f8880';
    b.wedge(-0.10, 0, -0.05, 0.10, 0.075, 0.05, c);
  },

  gem: (b, a) => {
    const c = a.c || '#86b7e0';
    b.cone(0, 0.10, 0, 0.06, -0.10, c, 6);
    b.cone(0, 0.10, 0, 0.06, 0.055, tone(rgb(c), 0.14), 6);
  },

  herb: (b, a) => {
    const c = a.c || '#7fbf8f';
    b.drum(0, -0.10, 0, 0.010, 0.008, 0.22, tone(rgb(c), -0.18), 5);
    for (let i = 0; i < 5; i++) {
      const t = i * 1.3;
      b.ball(Math.cos(t) * 0.045, 0.04 + i * 0.018, Math.sin(t) * 0.045, 0.034, c, 2, 5);
    }
  },

  bush: (b, a) => {
    const c = a.c || '#7fbf8f';
    for (let i = 0; i < 3; i++) {
      const t = i * 2.1;
      b.ball(Math.cos(t) * 0.05, 0.02 + (i % 2) * 0.04, Math.sin(t) * 0.05, 0.06, c, 2, 6);
    }
  },

  fluff: (b, a) => {
    const c = a.c || '#ded3c0';
    for (let i = 0; i < 4; i++) {
      const t = i * 1.6;
      b.ball(Math.cos(t) * 0.045, 0.02 + Math.sin(t) * 0.035, Math.sin(t) * 0.045, 0.055, c, 3, 6);
    }
  },

  thread: (b) => {
    b.drum(0, -0.06, 0, 0.045, 0.045, 0.12, '#c9bda6', 8);
    b.drum(0, -0.08, 0, 0.06, 0.06, 0.02, '#8a7c62', 8);
    b.drum(0, 0.06, 0, 0.06, 0.06, 0.02, '#8a7c62', 8);
  },

  fish: (b, a) => {
    const c = a.c || '#9ab7c4';
    b.ball(0, 0.02, 0, 0.075, c, 2, 6);
    b.ball(0, 0.02, -0.075, 0.045, tone(rgb(c), 0.06), 2, 5);
    b.tri([0, 0.02, 0.07], [-0.05, 0.09, 0.15], [0.05, 0.09, 0.15], tone(rgb(c), -0.10));
    b.tri([0, 0.02, 0.07], [0.05, -0.04, 0.15], [-0.05, -0.04, 0.15], tone(rgb(c), -0.10));
  },

  food: (b, a) => {
    const c = a.c || '#c9a06a';
    b.ball(0, 0.02, 0, 0.08, c, 2, 7);
    b.slab(-0.05, -0.05, 0.05, 0.05, 0.075, tone(rgb(c), 0.12));
  },

  bowl: (b, a) => {
    b.drum(0, -0.05, 0, 0.05, 0.09, 0.09, '#a89684', 9);
    b.drum(0, 0.035, 0, 0.075, 0.075, 0.006, a.c || '#8a6a4a', 9);
  },

  vial: (b, a) => {
    b.drum(0, -0.09, 0, 0.038, 0.042, 0.14, '#b8c4c0', 7);
    b.drum(0, -0.085, 0, 0.032, 0.036, 0.10, a.fill || '#6fd1a5', 7);
    b.drum(0, 0.05, 0, 0.020, 0.020, 0.04, '#b8c4c0', 6);
    b.drum(0, 0.09, 0, 0.026, 0.026, 0.022, '#6b4a2f', 6);
  },

  pill: (b, a) => {
    const c = a.c || '#e8e0cd';
    b.drum(0, -0.03, 0, 0.042, 0.042, 0.06, c, 8);
    b.ball(0, 0.03, 0, 0.042, tone(rgb(c), 0.08), 2, 8);
    b.ball(0, -0.03, 0, 0.042, tone(rgb(c), -0.06), 2, 8);
  },

  bandage: (b, a) => {
    const c = a.c || CLOTH;
    b.drum(0, -0.05, 0, 0.07, 0.07, 0.10, c, 9);
    b.drum(0, -0.045, 0, 0.03, 0.03, 0.09, tone(rgb(c), -0.20), 9);
    b.box(-0.075, -0.05, -0.005, 0.02, 0.02, 0.005, tone(rgb(c), 0.06));
  },

  bucket: (b) => {
    b.drum(0, -0.07, 0, 0.055, 0.08, 0.15, '#7a736c', 8);
    b.drum(0, 0.075, 0, 0.085, 0.085, 0.008, '#8a837a', 8);
    b.box(-0.085, 0.08, -0.006, 0.085, 0.095, 0.006, '#5a5450');
  },

  mortar: (b) => {
    b.drum(0, -0.06, 0, 0.055, 0.085, 0.10, '#9a9288', 9);
    b.drum(0, 0.04, 0, 0.085, 0.085, 0.008, '#a8a094', 9);
    b.drum(0.03, 0.03, 0, 0.014, 0.018, 0.13, '#8a6a4a', 6);
  },

  cauldron: (b) => {
    b.drum(0, -0.06, 0, 0.05, 0.085, 0.13, '#3f3835', 8);
    b.drum(0, 0.07, 0, 0.095, 0.095, 0.008, '#4a423e', 8);
    b.drum(0, 0.06, 0, 0.075, 0.075, 0.004, '#6f8a4a', 8);
  },

  rune: (b, a) => {
    const c = a.c || '#86b7e0';
    b.drum(0, -0.012, 0, 0.075, 0.075, 0.024, '#6b625c', 7);
    b.drum(0, 0.012, 0, 0.042, 0.042, 0.006, c, 6);
  },

  key: (b, a) => {
    const c = a.c || '#c9a34a';
    b.drum(0, -0.09, 0, 0.012, 0.012, 0.18, c, 5);
    b.drum(0, 0.10, 0, 0.045, 0.045, 0.012, c, 8);
    b.drum(0, 0.10, 0, 0.022, 0.022, 0.014, '#000000', 8);
    b.box(0.012, -0.09, -0.008, 0.055, -0.055, 0.008, c);
    b.box(0.012, -0.04, -0.008, 0.045, -0.015, 0.008, c);
  },

  book: (b, a) => {
    const c = a.c || '#7d3a45';
    b.box(-0.075, -0.055, -0.05, 0.075, 0.055, 0.05, c);
    b.box(-0.065, -0.048, -0.052, 0.075, 0.048, -0.045, '#e8e0cd');
    b.box(-0.078, -0.058, -0.055, -0.062, 0.058, 0.055, tone(rgb(c), -0.12));
  },

  scroll: (b, a) => {
    const c = a.c || '#e8e0cd';
    b.drum(0, -0.09, 0, 0.045, 0.045, 0.18, c, 9);
    b.drum(0, 0.095, 0, 0.05, 0.05, 0.012, tone(rgb(c), -0.12), 9);
    b.drum(0, -0.10, 0, 0.05, 0.05, 0.012, tone(rgb(c), -0.12), 9);
    b.box(-0.052, -0.02, -0.052, 0.052, 0.005, 0.052, '#a12a35');
  },

  seal: (b, a) => {
    const c = a.c || '#a12a35';
    b.drum(0, -0.014, 0, 0.07, 0.07, 0.028, c, 9);
    b.drum(0, 0.014, 0, 0.04, 0.04, 0.008, tone(rgb(c), 0.14), 6);
    b.box(-0.012, 0.02, -0.012, 0.012, 0.09, 0.012, '#c9bda6');
  },

  charm: (b, a) => {
    const c = a.c || '#c9a34a';
    for (let i = 0; i < 3; i++) {
      const t = i * 2.1;
      b.ball(Math.cos(t) * 0.04, 0.02 + i * 0.02, Math.sin(t) * 0.04, 0.033, c, 2, 6);
    }
    b.drum(0, 0.05, 0, 0.008, 0.008, 0.06, '#8a7c62', 5);
  },

  blob: (b, a) => {
    const c = a.c || '#c9bda6';
    b.ball(0, 0.02, 0, 0.075, c, 3, 7);
  }
};

/**
 * Anything whose art nobody has modelled yet still has to be pickable, so it
 * gets a lump in its own colour rather than nothing. The renderer test fails
 * on any item in the shipped game that ends up here.
 */
const fallback = ITEMS.blob;

export class ItemModels {
  constructor(gl) { this.gl = gl; this.cache = new Map(); }

  /** `art` is the item's art descriptor. */
  get(art) {
    const a = art || { k: 'blob' };
    const key = [a.k, a.c, a.hilt, a.gem, a.fill].join('|');
    let m = this.cache.get(key);
    if (m) return m;
    const b = new MeshBuilder();
    (ITEMS[a.k] || fallback)(b, a);
    m = b.build(this.gl);
    this.cache.set(key, m);
    return m;
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

export const ITEM_KINDS = Object.keys(ITEMS);

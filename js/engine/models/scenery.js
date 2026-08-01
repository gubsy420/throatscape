/* ============================================================
   Scenery models
   ------------------------------------------------------------
   Trees, ore, benches, doors and gravestones. One model per
   kind, built once and shared by every copy of it on the map,
   which is what makes a forest affordable.

   Colours come from the object definition rather than from
   here, so a content pack that adds a new tree in a new colour
   gets a new tree without touching this file.
   ============================================================ */

import { MeshBuilder, rgb, tone } from '../gl/mesh.js';
import { hash2 } from '../../util.js';

const one = (gl, build, opts = {}) => {
  const b = new MeshBuilder();
  build(b);
  return {
    parts: [{ joint: opts.joint || null, pivot: opts.pivot || [0, 0, 0], mesh: b.build(gl) }],
    height: opts.height || 1,
    sway: opts.sway || 0,
    // how wide a patch of shade it throws; a tree needs far more than a crate
    shadow: opts.shadow || 0.34
  };
};

/**
 * Something with a moving part, like a door. The still half and the swinging
 * half are separate meshes so the hinge can be a matrix rather than a rebuild.
 */
const hinged = (gl, buildFixed, buildSwing, pivot, opts = {}) => {
  const f = new MeshBuilder(), s = new MeshBuilder();
  buildFixed(f); buildSwing(s);
  return {
    parts: [
      { joint: null, pivot: [0, 0, 0], mesh: f.build(gl) },
      { joint: 'hinge', pivot, mesh: s.build(gl) }
    ],
    height: opts.height || 1.6
  };
};

const SCENERY = {
  /* -- growing things ------------------------------------- */

  /*
   * A tree has to be a tree. Modelled at the height of the woman chopping it
   * there is nothing to chop: the canopy sits at eye level and the whole
   * thing reads as a shrub. Three and a half tiles puts the crown well over
   * her head, which is the only scale at which a forest looks like one.
   */
  tree: (gl, d) => one(gl, b => {
    const bark = d.c || '#c9a68e';
    const leaf = d.leaf || '#a3707a';
    b.drum(0, 0, 0, 0.26, 0.15, 2.30, bark, 7);                     // the trunk, tapering
    b.drum(0, 0, 0, 0.40, 0.27, 0.22, tone(rgb(bark), -0.10), 7);   // root flare
    // boughs, overlapping the top of the trunk so the crown grows out of it
    for (const [x, z, y, r] of [[-0.42, 0.12, 2.05, 0.62], [0.46, -0.20, 2.25, 0.58],
                                [0.04, 0.38, 2.58, 0.60]]) {
      b.ball(x, y, z, r, leaf, 3, 7);
    }
    b.ball(0, 2.98, 0, 0.56, tone(rgb(leaf), 0.05), 3, 7);
  }, { height: 3.55, sway: 0.015, shadow: 0.62 }),

  bush: (gl, d) => one(gl, b => {
    const c = d.c || '#7fbf8f';
    b.drum(0, 0, 0, 0.07, 0.05, 0.14, '#5f5540', 5);                // a stem to grow from
    for (const [x, z, y, r] of [[-0.21, -0.10, 0.26, 0.30], [0.22, 0.13, 0.24, 0.28],
                                [0, 0.03, 0.45, 0.26]]) {
      b.ball(x, y, z, r, c, 2, 6);
    }
  }, { height: 0.74, sway: 0.05, shadow: 0.42 }),

  fluffbush: (gl, d) => one(gl, b => {
    const c = d.c || '#ded3c0';
    b.drum(0, 0, 0, 0.08, 0.06, 0.26, '#8a7c62', 5);
    for (const [x, z, y, r] of [[-0.18, 0.06, 0.44, 0.24], [0.20, -0.08, 0.40, 0.22],
                                [0.02, 0.20, 0.50, 0.21], [0, -0.03, 0.64, 0.19]]) {
      b.ball(x, y, z, r, c, 3, 7);
    }
  }, { height: 0.86, sway: 0.06, shadow: 0.38 }),

  rock: (gl, d) => one(gl, b => {
    const c = d.c || '#8f8880';
    // a boulder is a ball with the roundness taken out of it
    b.ball(0, 0.34, 0, 0.50, c, 3, 7);
    b.ball(-0.28, 0.20, 0.24, 0.28, tone(rgb(c), -0.06), 2, 6);
    b.ball(0.30, 0.16, -0.20, 0.24, tone(rgb(c), 0.04), 2, 6);
    b.drum(0.05, 0.52, 0.03, 0.17, 0.09, 0.22, tone(rgb(c), 0.09), 6);   // the seam worth mining
  }, { height: 0.95, shadow: 0.50 }),

  pool: (gl, d) => one(gl, b => {
    // sunk into the ground: a rim of wet earth and a dark surface
    b.drum(0, -0.05, 0, 0.60, 0.54, 0.13, '#4a4436', 9);
    b.drum(0, 0.06, 0, 0.52, 0.52, 0.005, d.c || '#3f5a3a', 9);
  }, { height: 0.16, shadow: 0.30 }),

  /* -- benches and fixtures -------------------------------- */

  anvil: (gl) => one(gl, b => {
    b.box(-0.16, 0, -0.12, 0.16, 0.16, 0.12, '#4a423e');            // the block
    b.box(-0.09, 0.16, -0.08, 0.09, 0.30, 0.08, '#5a514c');
    b.box(-0.26, 0.30, -0.14, 0.26, 0.44, 0.14, '#6b625c');         // the face
    b.cone(-0.34, 0.32, 0, 0.10, 0.10, '#6b625c', 5, Math.PI / 2);  // the horn
  }, { height: 0.5 }),

  furnace: (gl) => one(gl, b => {
    b.box(-0.42, 0, -0.42, 0.42, 0.86, 0.42, '#5d504a');
    b.wedge(-0.42, 0.86, -0.42, 0.42, 1.10, 0.42, '#4c413c');
    b.box(-0.20, 0.14, -0.46, 0.20, 0.48, -0.40, '#1d1113');         // the mouth
    b.box(-0.17, 0.16, -0.47, 0.17, 0.40, -0.44, '#e0762f');         // and the fire in it
    b.drum(0, 1.10, 0, 0.14, 0.16, 0.26, '#4a403b', 6);              // chimney
  }, { height: 1.4 }),

  cauldron: (gl) => one(gl, b => {
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      b.drum(Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19, 0.025, 0.025, 0.20, '#3b3330', 4);
    }
    b.drum(0, 0.20, 0, 0.24, 0.30, 0.34, '#3f3835', 8);
    b.drum(0, 0.52, 0, 0.30, 0.30, 0.03, '#4a423e', 8);
    b.drum(0, 0.50, 0, 0.26, 0.26, 0.006, '#6f8a4a', 8);             // whatever is in it
  }, { height: 0.6 }),

  range: (gl) => one(gl, b => {
    b.box(-0.42, 0, -0.36, 0.42, 0.62, 0.36, '#6b5f56');
    b.box(-0.30, 0.10, -0.40, 0.30, 0.44, -0.34, '#231719');
    b.box(-0.26, 0.12, -0.41, 0.26, 0.36, -0.37, '#e0762f');
    b.box(-0.44, 0.62, -0.38, 0.44, 0.70, 0.38, '#4a423c');          // the hotplate
    b.drum(0.16, 0.70, 0.02, 0.13, 0.13, 0.10, '#3a332f', 7);        // a pot on it
  }, { height: 0.9 }),

  table: (gl) => one(gl, b => {
    for (const [x, z] of [[-0.30, -0.22], [0.30, -0.22], [-0.30, 0.22], [0.30, 0.22]]) {
      b.box(x - 0.035, 0, z - 0.035, x + 0.035, 0.46, z + 0.035, '#6b5340');
    }
    b.box(-0.40, 0.46, -0.30, 0.40, 0.54, 0.30, '#8a6a4e');
    b.box(-0.16, 0.54, -0.10, 0.16, 0.60, 0.10, '#c9bda6');          // cloth and work
    b.drum(0.24, 0.54, -0.14, 0.045, 0.045, 0.06, '#b7a98f', 6);
  }, { height: 0.66 }),

  booth: (gl) => one(gl, b => {
    b.box(-0.5, 0, -0.22, 0.5, 0.86, 0.22, '#6b5340');
    b.box(-0.5, 0.86, -0.30, 0.5, 0.98, 0.30, '#8a6a4e');            // the counter
    b.box(-0.5, 0.98, -0.06, -0.34, 1.70, 0.06, '#5a4735');          // the frame around the clerk
    b.box(0.34, 0.98, -0.06, 0.5, 1.70, 0.06, '#5a4735');
    b.box(-0.5, 1.70, -0.08, 0.5, 1.84, 0.08, '#5a4735');
  }, { height: 1.9 }),

  crate: (gl) => one(gl, b => {
    b.box(-0.30, 0, -0.30, 0.30, 0.54, 0.30, '#8a6a4a');
    // slats, so it is a crate rather than a cube
    for (const y of [0.10, 0.30, 0.48]) {
      b.box(-0.32, y - 0.03, -0.32, 0.32, y + 0.03, 0.32, '#6f5238');
    }
  }, { height: 0.58 }),

  well: (gl) => one(gl, b => {
    b.drum(0, 0, 0, 0.42, 0.40, 0.44, '#7a736c', 8);
    b.drum(0, 0.44, 0, 0.42, 0.42, 0.06, '#8a837a', 8);
    b.drum(0, 0.30, 0, 0.33, 0.33, 0.005, '#141a1c', 8);             // the water, far down
    for (const s of [-1, 1]) b.box(s * 0.34, 0.50, -0.05, s * 0.40, 1.20, 0.05, '#6b5340');
    b.wedge(-0.50, 1.20, -0.42, 0.50, 1.52, 0.42, '#7d4f3a');        // the little roof
    b.drum(0, 1.05, 0, 0.05, 0.05, 0.10, '#5a4735', 5);
  }, { height: 1.6 }),

  altar: (gl) => one(gl, b => {
    b.box(-0.48, 0, -0.26, 0.48, 0.10, 0.26, '#8b8479');
    b.box(-0.38, 0.10, -0.20, 0.38, 0.62, 0.20, '#9a9288');
    b.box(-0.52, 0.62, -0.30, 0.52, 0.74, 0.30, '#a8a094');
    b.box(-0.05, 0.74, -0.04, 0.05, 1.14, 0.04, '#c9bda6');          // the standing cross
    b.box(-0.20, 0.94, -0.035, 0.20, 1.03, 0.035, '#c9bda6');
    for (const s of [-1, 1]) b.drum(s * 0.36, 0.74, 0, 0.04, 0.035, 0.14, '#d8cfae', 6);
  }, { height: 1.2 }),

  bed: (gl) => one(gl, b => {
    for (const [x, z] of [[-0.34, -0.42], [0.34, -0.42], [-0.34, 0.42], [0.34, 0.42]]) {
      b.box(x - 0.04, 0, z - 0.04, x + 0.04, 0.26, z + 0.04, '#5a4735');
    }
    b.box(-0.38, 0.26, -0.48, 0.38, 0.38, 0.48, '#a89684');          // mattress
    b.box(-0.38, 0.38, -0.10, 0.38, 0.44, 0.48, '#d8d2c4');          // blanket
    b.box(-0.24, 0.38, -0.44, 0.24, 0.50, -0.22, '#e8e2d4');         // pillow
    b.box(-0.40, 0.26, -0.52, 0.40, 0.72, -0.46, '#6b5340');         // headboard
  }, { height: 0.75 }),

  brazier: (gl) => one(gl, b => {
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.4;
      b.drum(Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16, 0.03, 0.02, 0.52, '#3f3835', 4);
    }
    b.drum(0, 0.52, 0, 0.16, 0.26, 0.20, '#4a423e', 8);
    b.drum(0, 0.70, 0, 0.20, 0.16, 0.10, '#8a3a20', 8);
    b.cone(0, 0.76, 0, 0.15, 0.30, '#e0762f', 6);                    // the flame
    b.cone(0, 0.84, 0, 0.08, 0.20, '#f2c14e', 5);
  }, { height: 1.05 }),

  grave: (gl) => one(gl, b => {
    b.box(-0.30, 0, -0.20, 0.30, 0.07, 0.20, '#6b665e');
    b.box(-0.22, 0.07, -0.07, 0.22, 0.62, 0.07, '#8b8479');
    b.drum(0, 0.62, 0, 0.22, 0.22, 0.02, '#8b8479', 7);              // the rounded top
    b.box(-0.13, 0.30, -0.085, 0.13, 0.36, -0.06, '#6f6a62');        // an inscription, unreadable
    b.box(-0.13, 0.42, -0.085, 0.13, 0.48, -0.06, '#6f6a62');
  }, { height: 0.7 }),

  sign: (gl) => one(gl, b => {
    b.drum(0, 0, 0, 0.05, 0.045, 0.62, '#6b5340', 5);
    b.box(-0.34, 0.62, -0.035, 0.34, 0.96, 0.035, '#a8845a');
    b.box(-0.30, 0.70, -0.05, 0.30, 0.76, -0.03, '#5a4735');
    b.box(-0.30, 0.80, -0.05, 0.16, 0.86, -0.03, '#5a4735');
  }, { height: 1.0 }),

  rubble: (gl, d) => one(gl, b => {
    const c = d.c || '#6b625c';
    for (let i = 0; i < 6; i++) {
      const a = hash2(i, 3, 11) * Math.PI * 2, r = 0.10 + hash2(i, 7, 13) * 0.24;
      b.ball(Math.cos(a) * r, 0.04 + hash2(i, 9, 17) * 0.10, Math.sin(a) * r,
             0.07 + hash2(i, 5, 19) * 0.08, tone(rgb(c), (hash2(i, 1, 23) - 0.5) * 0.12), 2, 5);
    }
  }, { height: 0.24 }),

  /* -- the ones that move ---------------------------------- */

  door: (gl) => hinged(gl,
    b => {
      // the frame stays put
      for (const s of [-1, 1]) b.box(s * 0.44, 0, -0.09, s * 0.52, 1.70, 0.09, '#5a4735');
      b.box(-0.52, 1.70, -0.09, 0.52, 1.84, 0.09, '#5a4735');
    },
    b => {
      b.box(0, 0, -0.05, 0.88, 1.68, 0.05, '#7d5a3c');
      b.box(0.06, 0.10, -0.065, 0.82, 1.58, -0.045, '#8a6544');
      b.drum(0.74, 0.86, -0.09, 0.045, 0.045, 0.04, '#c9a34a', 6);   // the handle
    },
    [-0.44, 0, 0], { height: 1.9 }),

  gate: (gl) => hinged(gl,
    b => {
      for (const s of [-1, 1]) b.drum(s * 0.48, 0, 0, 0.07, 0.06, 1.30, '#5a4735', 6);
    },
    b => {
      b.box(0, 0.20, -0.04, 0.94, 0.32, 0.04, '#6f5238');
      b.box(0, 0.72, -0.04, 0.94, 0.84, 0.04, '#6f5238');
      for (let i = 0; i < 4; i++) {
        b.box(0.10 + i * 0.22, 0.10, -0.03, 0.16 + i * 0.22, 1.06, 0.03, '#7d5a3c');
      }
    },
    [-0.48, 0, 0], { height: 1.35 })
};

/* ============================================================
   What is left when you have taken it
   ------------------------------------------------------------
   A worked-out node used to be the same model drawn faint, and
   at the dither strengths that keep a scene readable that is
   almost nothing to look at - you would walk back to a tree you
   had just felled because it still looked like a tree.

   So a spent node is a different shape. A stump is not a faded
   tree, and the difference carries across a field.
   ============================================================ */

const SPENT = {
  tree: (gl, d) => one(gl, b => {
    const bark = d.c || '#c9a68e';
    b.drum(0, 0, 0, 0.40, 0.27, 0.22, tone(rgb(bark), -0.10), 7);   // the same root flare
    b.drum(0, 0.20, 0, 0.28, 0.26, 0.42, bark, 7);                  // what is left standing
    b.drum(0, 0.62, 0, 0.26, 0.26, 0.01, tone(rgb(bark), 0.14), 7); // the cut face, pale and flat
    // splinters round the rim, because nothing this size comes away cleanly
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + hash2(i, 3, 7) * 0.4;
      b.cone(Math.cos(a) * 0.21, 0.58, Math.sin(a) * 0.21,
             0.05, 0.09 + hash2(i, 5, 11) * 0.13, tone(rgb(bark), -0.06), 4);
    }
    // and the chips it dropped doing it
    for (let i = 0; i < 4; i++) {
      const a = i * 1.6 + 0.7, r = 0.42 + hash2(i, 9, 13) * 0.16;
      b.box(Math.cos(a) * r - 0.07, 0, Math.sin(a) * r - 0.05,
            Math.cos(a) * r + 0.07, 0.05, Math.sin(a) * r + 0.05, tone(rgb(bark), 0.06));
    }
  }, { height: 0.70, shadow: 0.44 }),

  rock: (gl, d) => one(gl, b => {
    const c = d.c || '#8f8880';
    // the seam is gone and the shell of the boulder has come down with it
    b.ball(0, 0.10, 0, 0.34, tone(rgb(c), -0.16), 2, 6);
    b.drum(0, 0.22, 0, 0.22, 0.26, 0.10, '#241f1c', 7);             // the hollow it left
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26, r = 0.34 + hash2(i, 7, 17) * 0.18;
      b.ball(Math.cos(a) * r, 0.05 + hash2(i, 3, 19) * 0.05, Math.sin(a) * r,
             0.09 + hash2(i, 11, 23) * 0.05, tone(rgb(c), -0.04), 2, 5);
    }
  }, { height: 0.40, shadow: 0.44 }),

  bush: (gl, d) => one(gl, b => {
    const c = tone(rgb(d.c || '#7fbf8f'), -0.26);
    b.drum(0, 0, 0, 0.07, 0.05, 0.14, '#5f5540', 5);
    // stripped back to stems, with a couple of leaves the picker missed
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26;
      b.drum(Math.cos(a) * 0.06, 0.10, Math.sin(a) * 0.06,
             0.016, 0.008, 0.16 + hash2(i, 5, 29) * 0.08, '#6b6148', 4);
    }
    b.ball(0.10, 0.22, -0.06, 0.07, c, 2, 5);
  }, { height: 0.34, shadow: 0.26 }),

  fluffbush: (gl, d) => one(gl, b => {
    const c = tone(rgb(d.c || '#ded3c0'), -0.12);
    b.drum(0, 0, 0, 0.08, 0.05, 0.26, '#8a7c62', 5);
    b.drum(0, 0.26, 0, 0.05, 0.02, 0.10, '#6b6148', 4);             // a bare, bent stalk
    b.ball(0.05, 0.32, 0.02, 0.07, c, 2, 5);                        // one tuft left on it
  }, { height: 0.42, shadow: 0.24 })
};

/** Models are shared: one throatwood mesh serves every throatwood on the map. */
export class SceneryModels {
  constructor(gl) { this.gl = gl; this.cache = new Map(); }

  /**
   * `def` is the OBJ definition; `type` is its key. `spent` asks for the
   * worked-out version, which most things do not have - those come back
   * unchanged, and the renderer fades them instead.
   */
  get(type, def, spent = false) {
    const key = spent ? type + ' spent' : type;
    let m = this.cache.get(key);
    if (m) return m;
    const make = (spent && SPENT[def.art]) || SCENERY[def.art] || SCENERY.rubble;
    m = make(this.gl, def);
    m.spent = spent && !!SPENT[def.art];
    this.cache.set(key, m);
    return m;
  }

  dispose() {
    for (const m of this.cache.values()) for (const p of m.parts) p.mesh.dispose();
    this.cache.clear();
  }
}

export const SCENERY_ARTS = Object.keys(SCENERY);

/** The arts that change shape once they have been worked out, for the tests. */
export const SPENT_ARTS = Object.keys(SPENT);

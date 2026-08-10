/* ============================================================
   Creature models
   ------------------------------------------------------------
   A model is a short list of parts, each with its own mesh and
   its own joint. The renderer works out the joint angles from
   what the creature is doing - walking, swinging, standing
   still and breathing - and draws the parts.

   Splitting a body into parts rather than baking poses is what
   lets one rig serve every two-legged thing in the game, from
   the player to the Choking Matron, and animate at frame rate
   instead of at the 600 ms tick the server runs on.

   Parts name a joint, not a mesh; `rig.js` decides how a joint
   moves. That way a new monster is a shape, not an animation.
   ============================================================ */

import { MeshBuilder, rgb, tone } from '../gl/mesh.js';

/* Everything is measured in tiles: a nurse stands about 1.3 of them tall. */
const HEAD = 0.30;

/** Bare skin, for the things that have any. */
const SKIN = '#d9b49a';

/* ============================================================
   The two-legged rig
   ============================================================ */

/**
 * Every humanoid in the Throat: the player, shopkeepers, patients, monks and
 * the bosses. `scale` makes something loom without needing its own model.
 */
function humanoid(gl, {
  body = '#e8e0cd', trim = null, head = SKIN, hair = null, hat = null, hood = false,
  scale = 1, stoop = 0, thin = 1
} = {}) {
  const parts = [];
  const part = (joint, pivot, build) => {
    const b = new MeshBuilder();
    build(b);
    parts.push({ joint, pivot, mesh: b.build(gl), scale });
  };

  const hipY = 0.52 * scale, shoulderY = 0.94 * scale;
  const halfW = 0.20 * scale * thin;

  /* torso, built around the origin at the hips so a stoop bends the whole man */
  part('torso', [0, hipY, 0], b => {
    b.box(-halfW, 0, -0.11 * scale, halfW, 0.44 * scale, 0.11 * scale, body);
    if (trim) {
      // an apron, a stole, a tabard: a strip of colour down the front
      b.box(-halfW * 0.5, 0.02 * scale, -0.125 * scale,
             halfW * 0.5, 0.40 * scale, -0.105 * scale, trim);
    }
    // shoulders, so the join to the arms is not a step
    b.box(-halfW - 0.03 * scale, 0.36 * scale, -0.09 * scale,
           halfW + 0.03 * scale, 0.45 * scale, 0.09 * scale, tone(rgb(body), -0.04));
    // a belt, which is what stops a torso reading as a crate
    b.box(-halfW - 0.012 * scale, 0.02 * scale, -0.12 * scale,
           halfW + 0.012 * scale, 0.09 * scale, 0.12 * scale, tone(rgb(body), -0.22));
  });

  /*
   * A head is a box, but a box on its own reads as a crate. What makes it a
   * head at ten tiles away is the hair: a darker mass sitting on top and
   * down the back, which gives the silhouette a front and a back and so
   * tells you which way somebody is facing.
   */
  part('head', [0, shoulderY, 0], b => {
    const h = HEAD * scale;
    const y0 = 0.03 * scale;
    b.box(-h / 2, y0, -h / 2, h / 2, y0 + h, h / 2, head);
    b.box(-h * 0.30, y0 + h * 0.30, -h / 2 - 0.012 * scale,
           h * 0.30, y0 + h * 0.52, -h / 2, '#3a2a26');           // the face

    if (hood) {
      const c = tone(rgb(hat || body), -0.05);
      b.box(-h / 2 - 0.03 * scale, y0 + 0.02 * scale, -h / 2 - 0.03 * scale,
             h / 2 + 0.03 * scale, y0 + h * 0.98, h / 2 + 0.01 * scale, c);
      // the face stays in shadow, which is most of what makes a hood a hood
      b.box(-h * 0.35, y0 + h * 0.30, -h / 2 - 0.045 * scale,
             h * 0.35, y0 + h * 0.70, -h / 2 - 0.032 * scale, '#241b22');
    } else {
      const hairC = hair || '#4a3630';
      b.box(-h / 2 - 0.012 * scale, y0 + h * 0.68, -h / 2 - 0.012 * scale,
             h / 2 + 0.012 * scale, y0 + h + 0.03 * scale, h / 2 + 0.012 * scale, hairC);
      b.box(-h / 2 - 0.012 * scale, y0 + h * 0.20, h / 2 * 0.55,
             h / 2 + 0.012 * scale, y0 + h * 0.72, h / 2 + 0.014 * scale, hairC);
      if (hat) {
        b.box(-h / 2 - 0.035 * scale, y0 + h + 0.02 * scale, -h / 2 - 0.035 * scale,
               h / 2 + 0.035 * scale, y0 + h + 0.055 * scale, h / 2 + 0.035 * scale, hat);
        b.box(-h * 0.36, y0 + h + 0.05 * scale, -h * 0.36,
               h * 0.36, y0 + h + 0.13 * scale, h * 0.36, hat);
      }
    }
  });

  const arm = (side, joint) => part(joint, [side * (halfW + 0.055 * scale), shoulderY, 0], b => {
    b.box(-0.055 * scale, -0.40 * scale, -0.055 * scale,
           0.055 * scale, 0.02 * scale, 0.055 * scale, body);
    b.box(-0.05 * scale, -0.47 * scale, -0.05 * scale,
           0.05 * scale, -0.38 * scale, 0.05 * scale, head);       // the hand
  });
  arm(-1, 'armL');
  arm(1, 'armR');

  const leg = (side, joint) => part(joint, [side * 0.085 * scale, hipY, 0], b => {
    b.box(-0.065 * scale, -0.50 * scale, -0.065 * scale,
           0.065 * scale, 0.02 * scale, 0.065 * scale, tone(rgb(body), -0.10));
    b.box(-0.07 * scale, -0.54 * scale, -0.09 * scale,
           0.07 * scale, -0.47 * scale, 0.06 * scale, '#4a3b36');   // the shoe
  });
  leg(-1, 'legL');
  leg(1, 'legR');

  return { parts, height: 1.30 * scale, stoop, kind: 'humanoid' };
}

/* ============================================================
   The things that are not people
   ============================================================ */

/** One mesh, no joints: it bobs and that is all. */
function lump(gl, build, height, kind = 'lump') {
  const b = new MeshBuilder();
  build(b);
  return { parts: [{ joint: 'body', pivot: [0, 0, 0], mesh: b.build(gl), scale: 1 }], height, kind };
}

const CREATURES = {
  /*
   * `scale` and `thin` come through from the art so a definition can differ in
   * build as well as in colour. Without them every person in the Throat is the
   * same body with a different coat, and a companion walking at your heel is the
   * one figure on screen that gets looked at closely.
   */
  humanoid: (gl, art) => humanoid(gl, {
    body: art.c || '#b8a68f', hat: art.hat || null,
    trim: art.trim || null, hair: art.hair || null,
    scale: art.scale || 1, thin: art.thin || 1
  }),

  patient: (gl, art) => humanoid(gl, {
    body: art.c || '#d8cfc0', head: SKIN, stoop: 0.16, thin: 0.88
  }),

  monk: (gl, art) => humanoid(gl, {
    body: art.c || '#6a5f52', hat: art.c || '#5c5246', hood: true, stoop: 0.10
  }),

  brute: (gl, art) => humanoid(gl, {
    body: art.c || '#8a6a5a', scale: 1.35, thin: 1.25, stoop: 0.22
  }),

  boss: (gl, art) => humanoid(gl, {
    body: art.c || '#7a4550', trim: '#3b2028', scale: 1.7, thin: 1.3, stoop: 0.18
  }),

  rat: (gl, art) => {
    const c = art.c || '#8a7a6a';
    return lump(gl, b => {
      b.ball(0, 0.17, 0.02, 0.19, c, 2, 6);                 // body
      b.ball(0, 0.16, -0.20, 0.11, tone(rgb(c), 0.04), 2, 6);  // head
      b.cone(0, 0.20, -0.26, 0.05, 0.10, tone(rgb(c), -0.06), 5,  0);   // snout
      for (const s of [-1, 1]) {
        b.cone(s * 0.07, 0.24, -0.17, 0.05, 0.09, tone(rgb(c), -0.10), 4);   // ears
        b.box(s * 0.11, 0, -0.08, s * 0.15, 0.09, -0.03, tone(rgb(c), -0.14));
        b.box(s * 0.11, 0, 0.08, s * 0.15, 0.09, 0.13, tone(rgb(c), -0.14));
      }
      b.drum(0, 0.14, 0.20, 0.035, 0.012, 0.30, tone(rgb(c), -0.08), 4);     // tail
    }, 0.42, 'beast');
  },

  slug: (gl, art) => {
    const c = art.c || '#7d8a4a';
    return lump(gl, b => {
      b.ball(0, 0.15, 0, 0.26, c, 3, 7);
      b.ball(0, 0.20, -0.16, 0.15, tone(rgb(c), 0.05), 2, 6);
      for (const s of [-1, 1]) b.drum(s * 0.06, 0.30, -0.18, 0.02, 0.03, 0.14, tone(rgb(c), 0.10), 4);
      b.slab(-0.28, -0.28, 0.28, 0.28, 0.012, tone(rgb(c), -0.28));   // the slime it leaves
    }, 0.46, 'blob');
  },

  crawler: (gl, art) => {
    const c = art.c || '#6a5a52';
    return lump(gl, b => {
      for (let i = 0; i < 4; i++) {
        b.ball(0, 0.16 - i * 0.012, -0.18 + i * 0.13, 0.15 - i * 0.014, tone(rgb(c), i * 0.02), 2, 6);
      }
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          b.drum(s * 0.10, 0.02, -0.12 + i * 0.13, 0.022, 0.022, 0.16, tone(rgb(c), -0.12), 4);
        }
      }
      b.cone(0, 0.20, -0.26, 0.07, 0.12, tone(rgb(c), -0.05), 5);
    }, 0.40, 'beast');
  },

  spinner: (gl, art) => {
    const c = art.c || '#4a3f4e';
    return lump(gl, b => {
      b.ball(0, 0.26, 0.06, 0.20, c, 3, 7);                 // abdomen
      b.ball(0, 0.24, -0.14, 0.12, tone(rgb(c), 0.05), 2, 6);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const a = -0.5 + i * 0.34;
          const kx = s * (0.14 + i * 0.02), kz = -0.10 + i * 0.10;
          b.drum(kx, 0.30, kz, 0.02, 0.02, 0.001, c, 4);    // shoulder nub
          // each leg: out and up, then down to the floor
          b.quad([kx, 0.30, kz], [kx + s * 0.16, 0.40, kz + a * 0.06],
                 [kx + s * 0.17, 0.39, kz + a * 0.06], [kx + s * 0.01, 0.29, kz],
                 tone(rgb(c), -0.10));
          b.quad([kx + s * 0.16, 0.40, kz + a * 0.06], [kx + s * 0.30, 0.0, kz + a * 0.12],
                 [kx + s * 0.31, 0.0, kz + a * 0.12], [kx + s * 0.17, 0.39, kz + a * 0.06],
                 tone(rgb(c), -0.16));
        }
      }
      for (const s of [-1, 1]) b.ball(s * 0.05, 0.28, -0.23, 0.028, '#d4586b', 2, 5);   // eyes
    }, 0.52, 'beast');
  },

  sprite: (gl, art) => {
    const c = art.c || '#9ec4a8';
    return lump(gl, b => {
      b.ball(0, 0.52, 0, 0.17, c, 3, 7);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        b.drum(Math.cos(a) * 0.13, 0.30, Math.sin(a) * 0.13, 0.015, 0.03, 0.22,
               tone(rgb(c), -0.10), 4);
      }
      b.ball(0, 0.24, 0, 0.09, tone(rgb(c), -0.16), 2, 6);
    }, 0.74, 'float');
  },

  howler: (gl, art) => {
    const c = art.c || '#6b3f4e';
    return lump(gl, b => {
      b.ball(0, 0.40, 0.04, 0.28, c, 3, 7);
      b.ball(0, 0.44, -0.20, 0.19, tone(rgb(c), 0.04), 2, 7);
      // the mouth it is named for
      b.cone(0, 0.40, -0.34, 0.14, 0.16, '#2b1218', 6, Math.PI / 6);
      for (const s of [-1, 1]) {
        b.cone(s * 0.13, 0.58, -0.18, 0.05, 0.16, tone(rgb(c), -0.12), 4);
        b.drum(s * 0.16, 0, 0.02, 0.05, 0.06, 0.26, tone(rgb(c), -0.14), 5);
      }
    }, 0.78, 'beast');
  }
};

/**
 * Anything a content pack invents that this file has never heard of still has
 * to appear, so it appears as a lumpen thing in its own colour rather than as
 * nothing at all. A missing monster you can see and kill beats an invisible
 * one that hits you from off screen.
 */
function unknown(gl, art) {
  const c = art.c || '#8a7a8a';
  return lump(gl, b => {
    b.ball(0, 0.30, 0, 0.24, c, 3, 6);
    b.ball(0, 0.56, 0, 0.13, tone(rgb(c), 0.06), 2, 6);
    for (const s of [-1, 1]) b.drum(s * 0.13, 0, 0, 0.05, 0.05, 0.22, tone(rgb(c), -0.12), 4);
  }, 0.70, 'beast');
}

/**
 * Models are built once and shared by every creature of a kind, so a hundred
 * bile slugs cost one model and a hundred matrices.
 */
export class CreatureModels {
  constructor(gl) { this.gl = gl; this.cache = new Map(); }

  /** `art` is the NPC's art block: { k, c, hat }. */
  get(art) {
    const key = [art.k, art.c, art.hat, art.trim, art.hair].join('|');
    let m = this.cache.get(key);
    if (m) return m;
    const make = CREATURES[art.k] || unknown;
    m = make(this.gl, art);
    this.cache.set(key, m);
    return m;
  }

  /** The player, whose colours change as they put clothes on. */
  player(body, hat) {
    return this.get({ k: 'humanoid', c: body || '#e8e0cd', hat: hat || null });
  }

  dispose() {
    for (const m of this.cache.values()) for (const p of m.parts) p.mesh.dispose();
    this.cache.clear();
  }
}

export const CREATURE_KINDS = Object.keys(CREATURES);

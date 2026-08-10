/* ============================================================
   The 3D renderer
   ------------------------------------------------------------
   Draws the Throat as a landscape rather than as a picture of
   one. The server is untouched by any of this: it still thinks
   in flat tiles, and every position, path and saved game means
   exactly what it did. Height, models and the camera all live
   on this side of the wire.

   The interface, though, stays flat. Name tags, hitsplats,
   chat and the minimap are drawn on a 2D canvas laid over the
   scene, positioned by projecting a world point to a pixel -
   which is how the games this one follows did it too, and why
   their text stayed crisp while the world behind it turned.
   ============================================================ */

import { TILE, lerp, clamp, hash2 } from '../util.js';
import { T, TILE_INFO, OBJ } from '../data/world.js';
import { NPCS } from '../data/npcs.js';
import { ITEMS, item } from '../data/items.js';
import { drawArt } from './icons.js';
import { parseChat, charColour, charOffset } from '../game/chatfx.js';

import { getContext, makeProgram } from './gl/gl.js';
import { m4, model as modelMatrix, limb, hinge } from './gl/mat4.js';
import { MeshBuilder, rgb, tone } from './gl/mesh.js';
import { Camera, PITCH_MIN, PITCH_MAX } from './gl/camera.js';
import { Terrain, CHUNK } from './models/terrain.js';
import { CreatureModels } from './models/creatures.js';
import { SceneryModels } from './models/scenery.js';
import { ItemModels } from './models/items.js';
import { Overlay } from './overlay.js';

const SWING_MS = 420;

/**
 * How a held item sits in the fist, per kind of attack, as a tilt away from
 * standing straight up out of the hand. Items are modelled grip-down with the
 * business end up, so nought would run the shaft back through the forearm -
 * which is what "held almost parallel to the arm" looks like, and why these
 * are all well past a right angle.
 *
 * `hand` is which arm holds it. A bow is the exception that needs it: you
 * hold a bow in your leading hand and draw the string with the other.
 */
/**
 * What each spell looks like in the air. The renderer has to pick these
 * because the server does not send projectiles at all - it deals the damage
 * and reports it - so the bolt is the client drawing what it already knows.
 */
export const SPELL_COLOURS = {
  flesh_bolt:   '#d4586b',
  nerve_strike: '#e8d84a',
  bile_lance:   '#a3c94a',
  vital_rend:   '#c0303f',
  transfuse:    '#8f4ad4'
};

/*
 * The outward lean matters as much as the forward one. A weapon held
 * straight out in front points down the barrel of a camera that is usually
 * behind its owner, and a foot of steel foreshortens into a smudge - so
 * melee weapons are carried out to the side as well as forward, where their
 * length is actually pointing across the view.
 */
const GRIPS = {
  slash:  { angle: -0.75, out: -0.75, hand: 'armR' },
  punch:  { angle: -0.75, out: -0.75, hand: 'armR' },
  stab:   { angle: -1.00, out: -0.50, hand: 'armR' },
  crush:  { angle: -0.60, out: -0.72, hand: 'armR' },
  throw:  { angle: -1.05, out: -0.35, hand: 'armR' },
  blow:   { angle: -2.15, out: -0.12, hand: 'armR' },   // angled up towards the mouth
  draw:   { angle: -1.48, out: 0.10,  hand: 'armL' },   // stands the bow upright out front
  cast:   { angle: -0.70, out: -0.60, hand: 'armR' },

  /*
   * And the tools. The outward lean matters here for the same reason it does
   * on a weapon, and more: a net and a gaff are long, and the arms that use
   * them go straight out in front, which is straight down the barrel of a
   * camera that is usually behind their owner. Leaned out to the side, their
   * length lies across the view where it can be seen.
   */
  chop:   { angle: -0.50, out: -0.55, hand: 'armR' },   // an axe, hafted out from the fist
  mine:   { angle: -0.42, out: -0.45, hand: 'armR' },
  net:    { angle: -1.25, out: -0.62, hand: 'armR' },   // mouth forward, held clear of the body
  gaff:   { angle: -1.05, out: -0.60, hand: 'armR' },
  forage: { angle: -0.90, out: -0.50, hand: 'armR' }
};
const DEFAULT_GRIP = GRIPS.slash;

/**
 * What a shot looks like in the air.
 *
 * Everything here is built white and coloured by the tint, which is also how
 * a spell bolt is made to glow: the tint is pushed past one, so the colour
 * clips bright at the core and falls away round the edges without needing a
 * light of its own. They are also several times the size of what was here
 * before, because a bolt that crosses eight tiles in a third of a second and
 * is the size of a fingernail may as well not have been drawn.
 *
 * Models point along +y, the way everything else in the game is built, and
 * the renderer tips them onto their line of travel.
 */
export const BOLT_SCALE = { spell: 1, shot: 0.85 };

export function buildBolts(gl) {
  const W = '#ffffff';
  const mk = build => { const b = new MeshBuilder(); build(b); return b.build(gl); };
  const dim = a => tone(rgb(W), a);

  return {
    /* an arrow, a dart, a blowpipe needle: something with a point and a tail */
    shot: mk(b => {
      b.cone(0, 0.14, 0, 0.055, 0.20, W, 6);
      b.drum(0, -0.24, 0, 0.022, 0.028, 0.38, dim(-0.34), 5);
      b.box(-0.09, -0.27, -0.012, 0.09, -0.11, 0.012, dim(-0.16));   // fletching, crossed
      b.box(-0.012, -0.27, -0.09, 0.012, -0.11, 0.09, dim(-0.22));
    }),

    /* a knot of tissue, lumpy, turning over itself */
    flesh_bolt: mk(b => {
      b.ball(0, 0, 0, 0.15, W, 3, 7);
      for (let i = 0; i < 4; i++) {
        const a = i * 1.6;
        b.ball(Math.cos(a) * 0.13, Math.sin(a * 1.7) * 0.09, Math.sin(a) * 0.13,
               0.085, dim(-0.28), 2, 6);
      }
    }),

    /* a spark: three axes crossing, which flickers hard as it spins */
    nerve_strike: mk(b => {
      b.box(-0.27, -0.018, -0.018, 0.27, 0.018, 0.018, W);
      b.box(-0.018, -0.25, -0.018, 0.018, 0.25, 0.018, dim(-0.14));
      b.box(-0.018, -0.018, -0.27, 0.018, 0.018, 0.27, dim(-0.08));
      b.ball(0, 0, 0, 0.08, W, 2, 6);
    }),

    /* a spike of bile, driven point-first */
    bile_lance: mk(b => {
      b.cone(0, 0.06, 0, 0.11, 0.34, W, 6);
      b.cone(0, 0.06, 0, 0.11, -0.28, dim(-0.30), 6);
      b.drum(0, 0.02, 0, 0.13, 0.13, 0.035, dim(0.02), 6);           // the collar it widens at
    }),

    /* something pulled into two halves, and the gap left between them */
    vital_rend: mk(b => {
      for (const [x0, x1] of [[-0.22, -0.07], [0.07, 0.22]]) {
        b.box(x0, -0.15, -0.042, x1, 0.15, 0.042, W);
        const cx = (x0 + x1) / 2;
        b.cone(cx, 0.15, 0, 0.058, 0.15, dim(-0.22), 5);
        b.cone(cx, -0.15, 0, 0.058, -0.15, dim(-0.28), 5);
      }
      b.ball(0, 0, 0, 0.075, W, 2, 6);
    }),

    /* a ring of motes closing on a core, because transfuse takes rather than gives */
    transfuse: mk(b => {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        b.ball(Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19, 0.055, W, 2, 5);
      }
      b.ball(0, 0, 0, 0.105, dim(-0.18), 3, 7);
    }),

    /* anything nobody has drawn: a plain glowing lump, still big enough to see */
    _: mk(b => {
      b.ball(0, 0, 0, 0.16, W, 3, 7);
      b.ball(0, 0, 0, 0.22, dim(-0.48), 2, 6);
    })
  };
}

/** How the world is lit. One key light from the north-west, and a fill. */
const LIGHT = (() => {
  const v = [-0.45, 0.82, -0.36];
  const l = Math.hypot(...v);
  return v.map(n => n / l);
})();

/**
 * The air, region by region. `fog` is both the colour of the far distance and
 * the colour of the sky above it, which is what makes a horizon: there is no
 * skybox, only the point at which everything has faded into the same colour.
 * The deep places have that point very close, and are lit by almost nothing.
 */
const AIR = {
  larynx: { fog: '#150a14', near: 5,  far: 26, light: 0.34, warm: 0.92 },
  gullet: { fog: '#2e1015', near: 9,  far: 38, light: 0.46, warm: 1.06 },
  fen:    { fog: '#2b3327', near: 16, far: 56, light: 0.60, warm: 0.96 },
  uvula:  { fog: '#5f5563', near: 22, far: 74, light: 0.76, warm: 1.00 },
  _:      { fog: '#4a3746', near: 20, far: 68, light: 0.70, warm: 1.02 }
};

export class Renderer3D {
  constructor(canvas, overlay, world) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.world = world;

    const gl = getContext(canvas);
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const { prog, u } = makeProgram(gl);
    this.prog = prog;
    this.u = u;

    this.cam = new Camera();
    this.terrain = new Terrain(world);
    this.creatures = new CreatureModels(gl);
    this.scenery = new SceneryModels(gl);
    this.items = new ItemModels(gl);

    this.mat = m4();
    this.limbMat = m4();
    this.handMat = m4();
    this.time = 0;
    this.lowDetail = false;
    this.hoverTile = null;
    this.compass = null;

    this.decals = this.buildDecals();
    this.boltArt = buildBolts(gl);
    this.bolts = [];                  // cosmetic projectiles, launched by us
    this.ui = new Overlay(this);

    this.resize();
  }

  /** Held camera keys. main.js fills this; the camera reads it. */
  get keys() { return this.cam.keys; }

  /* Kept so that the flat renderer's callers still work unchanged. */
  get ts() { return TILE; }
  get yaw() { return this.cam.yaw; }
  get pitch() { return this.cam.pitch; }
  faceNorth() { this.cam.faceNorth(); }
  zoomBy(d) { this.cam.zoomBy(d); }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.vw = Math.max(1, r.width);
    this.vh = Math.max(1, r.height);
    this.dpr = dpr;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.max(1, Math.floor(r.width * dpr));
      c.height = Math.max(1, Math.floor(r.height * dpr));
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /* ============================================================
     Little shared meshes
     ============================================================ */

  /** Flat rings and markers that lie on the ground under things. */
  buildDecals() {
    const ring = (r0, r1, colour) => {
      const b = new MeshBuilder();
      const sides = 18;
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
        b.quad(
          [Math.cos(a0) * r0, 0, Math.sin(a0) * r0],
          [Math.cos(a0) * r1, 0, Math.sin(a0) * r1],
          [Math.cos(a1) * r1, 0, Math.sin(a1) * r1],
          [Math.cos(a1) * r0, 0, Math.sin(a1) * r0],
          rgb(colour));
      }
      return b.build(this.gl);
    };
    const disc = () => {
      const b = new MeshBuilder();
      const sides = 12;
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
        b.tri([0, 0, 0],
              [Math.cos(a1), 0, Math.sin(a1)],
              [Math.cos(a0), 0, Math.sin(a0)], [0, 0, 0]);
      }
      return b.build(this.gl);
    };
    return {
      target: ring(0.34, 0.44, '#d4586b'),
      hover:  ring(0.40, 0.48, '#e0b357'),
      shadow: disc()
    };
  }

  /**
   * A dark patch under everything that stands up. It is not a real shadow and
   * does not try to be - it is there because without one, a model on a
   * hillside looks like it is hovering an inch off it.
   */
  drawShadows(state) {
    if (this.lowDetail) return;
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.uniform3f(this.u.uTint, 0, 0, 0);
    gl.uniform1f(this.u.uAlpha, 0.30);

    const blob = (x, z, r) => {
      if (!this.cam.visible(x, 0, z, r + 1)) return;
      modelMatrix(this.mat, x, this.terrain.heightAt(x, z) + 0.02, z, 0, r);
      gl.uniformMatrix4fv(this.u.uModel, false, this.mat);
      this.decals.shadow.draw();
    };

    for (const n of state.npcs) {
      if (n.dead) continue;
      const s = NPCS[n.id]?.size || 1;
      blob(n.rx + s / 2, n.ry + s / 2, 0.30 * s);
    }
    for (const o of state.others.values()) blob(o.rx + 0.5, o.ry + 0.5, 0.30);
    blob(state.player.rx + 0.5, state.player.ry + 0.5, 0.30);
    for (const o of this.world.objects) {
      const d = OBJ[o.type];
      if (!d || d.art === 'pool' || d.art === 'rubble') continue;
      if (!this.cam.visible(o.x + 0.5, 0, o.y + 0.5, 4)) continue;
      // a tree throws far more shade than a crate, and a stump less than either
      blob(o.x + 0.5, o.y + 0.5, this.scenery.get(o.type, d, o.depleted > 0).shadow);
    }

    gl.uniform1f(this.u.uAlpha, 1);
    gl.uniform3f(this.u.uTint, 1, 1, 1);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /* ============================================================
     The frame
     ============================================================ */

  draw(state, alpha) {
    const gl = this.gl;
    this.alpha = alpha;
    this.time += 1 / 60;
    this._state = state;                 // picking runs between frames

    const now = performance.now();
    this.dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 1 / 60;
    this._last = now;

    this.cam.step(this.dt);

    /* follow the player */
    const p = state.player;
    const wx = p.rx + 0.5, wz = p.ry + 0.5;
    const wy = this.terrain.heightAt(wx, wz) + 0.9;
    if (state.snapCam) {
      this.cam.target[0] = wx; this.cam.target[1] = wy; this.cam.target[2] = wz;
      state.snapCam = false;
    } else {
      this.cam.target[0] = lerp(this.cam.target[0], wx, 0.22);
      this.cam.target[1] = lerp(this.cam.target[1], wy, 0.12);
      this.cam.target[2] = lerp(this.cam.target[2], wz, 0.22);
    }
    this.cam.update(this.vw / this.vh);

    /* air */
    const reg = this.world.regionAt(Math.round(p.rx), Math.round(p.ry));
    const air = AIR[reg?.id] || AIR._;
    const fog = rgb(air.fog);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(fog[0], fog[1], fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uViewProj, false, this.cam.viewProj);
    gl.uniform3f(this.u.uLightDir, LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform1f(this.u.uAlpha, 1);

    const L = air.light, w = air.warm;
    gl.uniform3f(this.u.uSun, 0.60 * L * w, 0.57 * L, 0.50 * L);
    gl.uniform3f(this.u.uSky, 0.92 * L, 0.90 * L, 1.00 * L);
    gl.uniform3f(this.u.uGround, 0.62 * L * w, 0.58 * L, 0.62 * L);
    gl.uniform3f(this.u.uFogColor, fog[0], fog[1], fog[2]);
    gl.uniform2f(this.u.uFogRange, air.near, air.far);

    this.drawTerrain();
    this.drawShadows(state);
    this.drawDecals(state);
    this.drawScenery(state);
    this.drawGround(state);
    this.drawActors(state);
    this.drawProjectiles(state);

    this.ui.draw(state);
  }

  /** Is this screen point on the compass? Answered for the click handler. */
  compassAt(px, py) {
    const c = this.compass;
    return !!c && Math.hypot(px - c.x, py - c.y) <= c.r;
  }

  /** And is it on the dial itself? The compass rides its rim, so ask that first. */
  minimapAt(px, py) {
    const m = this.minimap;
    return !!m && Math.hypot(px - m.x, py - m.y) <= m.r;
  }

  /* ---------------- terrain --------------------------------- */

  drawTerrain() {
    const gl = this.gl;
    const far = 60;                      // no point meshing what fog hides
    const cx = this.cam.target[0], cz = this.cam.target[2];
    const c0 = Math.floor((cx - far) / CHUNK), c1 = Math.floor((cx + far) / CHUNK);
    const r0 = Math.floor((cz - far) / CHUNK), r1 = Math.floor((cz + far) / CHUNK);

    gl.uniform3f(this.u.uTint, 1, 1, 1);
    gl.uniform1f(this.u.uFade, 1);
    const half = CHUNK / 2;
    for (let j = r0; j <= r1; j++) {
      for (let i = c0; i <= c1; i++) {
        if (i < 0 || j < 0) continue;
        const mx = i * CHUNK + half, mz = j * CHUNK + half;
        // a chunk's bounding ball, generous enough to cover walls and the rim
        if (!this.cam.visible(mx, 0, mz, CHUNK)) continue;
        modelMatrix(this.mat, 0, 0, 0, 0, 1);
        gl.uniformMatrix4fv(this.u.uModel, false, this.mat);
        this.terrain.chunkMesh(gl, i, j).draw();
      }
    }
  }

  /* ---------------- scenery --------------------------------- */

  drawScenery(state) {
    const gl = this.gl;
    const worked = state.gatherNode;
    for (const o of this.world.objects) {
      const d = OBJ[o.type];
      if (!d) continue;
      const x = o.x + 0.5, z = o.y + 0.5;
      const y = this.terrain.tileHeight(o.x, o.y);
      const depleted = o.depleted > 0;
      const m = this.scenery.get(o.type, d, depleted);
      if (!this.cam.visible(x, y + m.height / 2, z, m.height + 1)) continue;

      // a stump says "already chopped" by being a stump; only the things with
      // no worked-out shape of their own still have to say it by fading
      gl.uniform1f(this.u.uFade, depleted && !m.spent ? 0.45 : 1);
      gl.uniform3f(this.u.uTint, 1, 1, 1);

      /*
       * A tree is not planted facing the camera, and a row of identical
       * crates all square to the grid looks placed rather than lived in.
       * Both get a fixed turn from their own coordinates.
       */
      let spin = (hash2(o.x, o.y, 31) - 0.5) * 0.9;
      if (d.art === 'door' || d.art === 'gate' || d.art === 'booth' ||
          d.art === 'altar' || d.art === 'bed' || d.art === 'sign') {
        spin = this.facingOf(o);
      }

      // the node you are working shudders on every blow
      let lean = 0;
      if (worked && worked.x === o.x && worked.y === o.y) {
        const hit = this.swing(state.player.swingAt);
        if (hit) lean = Math.sin(hit * 22) * (1 - hit) * 0.05;
      }
      const sway = this.lowDetail || !m.sway ? 0
        : Math.sin(this.time * 0.9 + o.x * 0.6 + o.y) * m.sway;

      for (const part of m.parts) {
        modelMatrix(this.mat, x, y, z, spin, 1);
        if (part.joint === 'hinge') {
          hinge(this.limbMat, this.mat, part.pivot[0], part.pivot[1], part.pivot[2],
                this.doorAngle(o) * this.swingSide(o, spin, state));
          gl.uniformMatrix4fv(this.u.uModel, false, this.limbMat);
        } else if (sway || lean) {
          limb(this.limbMat, this.mat, 0, 0, 0, sway + lean, 0);
          gl.uniformMatrix4fv(this.u.uModel, false, this.limbMat);
        } else {
          gl.uniformMatrix4fv(this.u.uModel, false, this.mat);
        }
        part.mesh.draw();
      }
    }
    gl.uniform1f(this.u.uFade, 1);
  }

  /**
   * How far and which way a door swings. It opens away from whoever is
   * pushing it, because that is what a door does and because swinging it
   * through the player's face reads as a mistake.
   *
   * The side is decided once, as it starts to move, and held until it is
   * shut again - otherwise walking through a doorway makes the door change
   * its mind halfway and sweep back through you.
   */
  swingSide(o, spin, state) {
    if (o.anim === undefined || o.anim < 0.02) {
      const p = state.player;
      const dx = p.rx + 0.5 - (o.x + 0.5), dz = p.ry + 0.5 - (o.y + 0.5);
      // the player's position in the door's own frame; its leaf lies along +x
      const localZ = -dx * Math.sin(spin) + dz * Math.cos(spin);
      o._swing = localZ > 0 ? -1 : 1;
    }
    return (o._swing || 1) * 1.5;               // a shade under a right angle
  }

  /**
   * Which way a built thing faces. A door in a wall has to open along the
   * wall, and a bank booth has to have its counter towards the room, so the
   * answer comes from the tiles around it rather than from the map data.
   *
   * Failing a wall, it takes the line from its own neighbours. A bank is a row
   * of booths and a ward is a row of beds; furniture in a row lines up with the
   * row, and any of it turned across the others reads as broken because it is.
   *
   * There is still a hash at the end, for a thing standing on its own with
   * nothing to take a cue from. It used to be reached by every bank booth in
   * the game - not one of them has a wall beside it - so each row came out
   * however the hash happened to fall. In the ward bank three booths agreed and
   * the fourth sat square across the counter; in the deep bank it was the other
   * way about, four against one.
   */
  facingOf(o) {
    const key = o.x * 100000 + o.y;
    if (!this._facing) this._facing = new Map();
    const hit = this._facing.get(key);
    if (hit !== undefined) return hit;

    const w = this.world;
    const solid = (dx, dy) => {
      const t = w.tileAt(o.x + dx, o.y + dy);
      return t === T.WALL || t === T.CAVEWALL;
    };
    /* Three tiles, because furniture in a row is spaced rather than shoulder to
       shoulder: the ward's booths stand at x = 19, 21, 23, 25 and its beds at
       x = 21, 24, 27, 30. Far enough to find the row, near enough that two
       unrelated things do not invent one. */
    const alike = (dx, dy) => {
      for (let d = 1; d <= 3; d++) {
        const other = w.objectAt(o.x + dx * d, o.y + dy * d);
        if (other && other.type === o.type) return true;
      }
      return false;
    };

    let a;
    if (solid(-1, 0) || solid(1, 0)) a = 0;             // wall runs east-west
    else if (solid(0, -1) || solid(0, 1)) a = Math.PI / 2;
    else if (alike(1, 0) || alike(-1, 0)) a = 0;        // a row running east-west
    else if (alike(0, 1) || alike(0, -1)) a = Math.PI / 2;
    else a = (hash2(o.x, o.y, 91) > 0.5 ? 0 : Math.PI / 2);
    this._facing.set(key, a);
    return a;
  }

  /* ---------------- things on the floor ---------------------- */

  /**
   * Items lying on the floor, each drawn as itself. A dropped scalpel is a
   * scalpel and a dropped skull is a skull, whether it fell out of a monster
   * or out of your own pack - you should be able to tell what is worth
   * walking back for without hovering over it.
   */
  drawGround(state) {
    const gl = this.gl;
    gl.uniform3f(this.u.uTint, 1, 1, 1);
    for (const g of state.ground) {
      const x = g.x + 0.5, z = g.y + 0.5;
      const y = this.terrain.tileHeight(g.x, g.y);
      if (!this.cam.visible(x, y + 0.2, z, 1.2)) continue;
      gl.uniform1f(this.u.uFade, g.ttl < 60 ? 0.35 + 0.35 * Math.sin(this.time * 8) : 1);
      /*
       * Tipped over and turning slowly. Models are built upright to be held,
       * so a sword standing to attention on the flagstones would be wrong -
       * and the turn is what catches the eye across a room.
       */
      modelMatrix(this.mat, x, y + 0.10 + Math.sin(this.time * 2.2 + g.x + g.y) * 0.025,
                  z, this.time * 0.7 + g.x, 1);
      limb(this.limbMat, this.mat, 0, 0, 0, Math.PI / 2, 0);
      gl.uniformMatrix4fv(this.u.uModel, false, this.limbMat);
      this.items.get(item(g.id)?.art).draw();
    }
    gl.uniform1f(this.u.uFade, 1);
  }

  /** Rings on the ground: what is selected, hovered, and where you told yourself to go. */
  drawDecals(state) {
    const gl = this.gl;
    gl.uniform3f(this.u.uTint, 1, 1, 1);
    gl.uniform1f(this.u.uFade, 1);

    const put = (mesh, tx, ty, scale = 1) => {
      const x = tx + 0.5, z = ty + 0.5;
      modelMatrix(this.mat, x, this.terrain.heightAt(x, z) + 0.03, z, 0, scale);
      gl.uniformMatrix4fv(this.u.uModel, false, this.mat);
      mesh.draw();
    };

    if (state.target && state.target.kind === 'npc' && !state.target.ref.dead) {
      const n = state.target.ref;
      put(this.decals.target, n.rx, n.ry, (NPCS[n.id]?.size || 1));
    }
    if (state.hoverObj) put(this.decals.hover, state.hoverObj.x, state.hoverObj.y);
    // the click marker is interface, not scenery: the overlay draws it
  }

  /* ---------------- people and monsters ---------------------- */

  drawActors(state) {
    const p = state.player;

    for (const n of state.npcs) {
      if (n.dead) continue;
      const d = NPCS[n.id];
      if (!d) continue;
      const size = d.size || 1;
      const m = this.creatures.get(d.art);
      const cx = n.rx + size / 2, cz = n.ry + size / 2;
      const y = this.terrain.heightAt(cx, cz);
      if (!this.cam.visible(cx, y + m.height / 2, cz, m.height * size + 1)) continue;

      const sw = this.swing(n.swingAt);
      this.drawRig(m, cx, y, cz, {
        // a monster mid-swing is swinging at you, so it should be looking at you
        yaw: sw || n.hurtFlash > 0
          ? this.lookAt(n, cx, cz, p.rx + 0.5, p.ry + 0.5)
          : this.headingOf(n),
        walk: this.walkPhase(n),
        swing: sw,
        attack: 'slash',
        scale: size > 1 ? 1.5 : 1,
        hurt: n.hurtFlash > 0
      });
    }

    /* other nurses, wearing and holding what the snapshot says they are */
    for (const o of state.others.values()) {
      const cx = o.rx + 0.5, cz = o.ry + 0.5;
      const y = this.terrain.heightAt(cx, cz);
      if (!this.cam.visible(cx, y + 0.7, cz, 2.4)) continue;
      const w = o.weapon ? item(o.weapon) : null;
      const m = this.creatures.player(
        o.body ? (item(o.body)?.art?.c || o.color) : (o.color || '#b8a68f'),
        o.head ? (item(o.head)?.art?.c || '#ffffff') : null);
      this.drawRig(m, cx, y, cz, {
        yaw: this.headingOf(o),
        walk: this.walkPhase(o),
        swing: this.swing(o.swingAt),
        attack: attackKind(w),
        weapon: w ? this.items.get(w.art) : null
      });
    }

    /* the player, dressed in whatever they are actually wearing */
    const eq = state.equipment;
    const body = eq.body ? (item(eq.body)?.art?.c || '#e8e0cd') : '#e8e0cd';
    const hat = eq.head ? (item(eq.head)?.art?.c || '#ffffff') : null;
    const weapon = eq.weapon ? item(eq.weapon) : null;
    const shield = eq.shield ? item(eq.shield) : null;
    const cx = p.rx + 0.5, cz = p.ry + 0.5;

    /*
     * Facing what you are hitting. The server tracks a target but only sends
     * back a left-or-right facing, which is no use once the camera can be
     * anywhere, so the direction is worked out here from where the target
     * actually is.
     */
    const t = state.target;
    const fighting = t && t.kind === 'npc' && t.ref && !t.ref.dead;
    const tsize = fighting ? (NPCS[t.ref.id]?.size || 1) / 2 : 0;

    /*
     * And facing what you are working. The snapshot names the tile of the
     * node; what kind of node it is - and so which motion and which tool -
     * comes from the same object data the world was built from. A woman
     * chopping a tree with her back to it looks like a bug because it is one.
     */
    const node = state.gatherNode;
    const nodeObj = node ? this.world.objectAt(node.x, node.y) : null;
    const nodeDef = nodeObj ? OBJ[nodeObj.type] : null;
    const tool = nodeDef ? this.toolFor(state, nodeDef.tool) : null;

    const kind = nodeDef ? gatherKind(nodeDef) : attackKind(weapon);
    const yaw = nodeDef
      ? this.lookAt(p, cx, cz, nodeObj.x + 0.5, nodeObj.y + 0.5)
      : fighting
        ? this.lookAt(p, cx, cz, t.ref.rx + tsize, t.ref.ry + tsize)
        : this.headingOf(p);

    // working a node puts the tool for the job in your hand, whatever you
    // happen to be carrying it for; foraging is done bare-handed and shows it
    const held = nodeDef ? tool : weapon;

    this.drawRig(this.creatures.player(body, hat), cx, this.terrain.heightAt(cx, cz), cz, {
      yaw,
      walk: this.walkPhase(p),
      swing: this.swing(p.swingAt),
      attack: kind,
      spell: nodeDef ? null : state.autocast,
      weapon: held ? this.items.get(held.art) : null,
      shield: nodeDef || !shield ? null : this.items.get(shield.art)
    });

    /* a shot that puts nothing in the air does not read as a shot */
    if (p.swingAt && p.swingAt !== this._lastSwing) {
      this._lastSwing = p.swingAt;
      if (fighting && (kind === 'throw' || kind === 'draw' || kind === 'blow' || kind === 'cast')) {
        this.launch(state, cx, cz, t.ref.rx + tsize, t.ref.ry + tsize, kind, weapon);
      }
    }
  }

  /**
   * Whatever in the pack answers to this job, so that it can be put in the
   * hand doing it. Same rule as the one that decides whether you may start
   * at all: carried or worn both count.
   */
  toolFor(state, tool) {
    if (!tool) return null;
    for (const s of state.inventory) {
      if (s && ITEMS[s.id]?.tool === tool) return ITEMS[s.id];
    }
    for (const k in state.equipment) {
      const d = ITEMS[state.equipment[k]];
      if (d?.tool === tool) return d;
    }
    return null;
  }

  /**
   * A cosmetic bolt from here to there. The server never mentions
   * projectiles - it deals the damage and says so - so this is the client
   * drawing what it already knows must have happened.
   *
   * It leaves a little after the swing starts, because a bolt that appears
   * on the first frame of a wind-up has left the hand before the hand moved.
   */
  launch(state, x, z, tx, tz, kind, weapon) {
    const spell = kind === 'cast' ? (state.autocast || '_') : null;
    const colour = spell
      ? (SPELL_COLOURS[state.autocast] || '#d4586b')
      : (item(state.equipment.ammo)?.art?.c || weapon?.art?.c || '#c6ced6');
    this.bolts.push({
      x, z, tx, tz, colour, spell,
      mesh: spell ? (this.boltArt[spell] || this.boltArt._) : this.boltArt.shot,
      at: performance.now() + (spell ? 150 : 90),
      ms: spell ? 320 : 240,
      scale: spell ? BOLT_SCALE.spell : BOLT_SCALE.shot,
      arc: kind === 'throw' ? 0.55 : spell ? 0.22 : 0.1,
      spin: !!spell,
      trail: spell ? 3 : 1
    });
    if (this.bolts.length > 24) this.bolts.shift();
  }

  /**
   * Poses a rig and draws it. Joints are named by the model; what each one
   * does when the body walks or fights is decided here, once, for everything
   * in the game.
   */
  drawRig(m, x, y, z, {
    yaw = 0, walk = 0, swing = 0, scale = 1, hurt = false,
    attack = 'slash', spell = null, weapon = null, shield = null
  }) {
    const gl = this.gl;
    gl.uniform3f(this.u.uTint, hurt ? 1.6 : 1, hurt ? 0.7 : 1, hurt ? 0.7 : 1);

    const grip = GRIPS[attack] || DEFAULT_GRIP;
    const stride = walk ? Math.sin(walk * Math.PI * 2) : 0;
    const bounce = walk ? Math.abs(Math.cos(walk * Math.PI * 2)) * 0.035 : 0;
    const idle = m.kind !== 'humanoid';
    const breathe = idle ? 0 : Math.sin(this.time * 1.7 + x * 3) * 0.012;
    const pose = swing ? (ATTACKS[attack] || ATTACKS.slash)(swing, spell) : null;

    for (const part of m.parts) {
      modelMatrix(this.mat, x, y + bounce, z, yaw, scale);
      let sw = 0, lf = 0, px = part.pivot[0], py = part.pivot[1], pz = part.pivot[2];

      switch (part.joint) {
        case 'legL': sw = stride * 0.62 + (pose?.lunge || 0); break;
        case 'legR': sw = -stride * 0.62 + (pose?.lunge || 0); break;
        case 'armL':
          sw = pose ? pose.armL[0] : -stride * 0.5;
          lf = pose ? -pose.armL[1] : 0;
          break;
        case 'armR':
          sw = pose ? pose.armR[0] : stride * 0.5;
          lf = pose ? pose.armR[1] : 0;
          break;
        case 'torso': sw = (m.stoop || 0) + breathe + (pose?.lean || 0); break;
        case 'head': sw = -(m.stoop || 0) * 0.6; break;
        case 'body':
          // the ones with no legs bob along instead
          py += walk ? Math.abs(Math.sin(walk * Math.PI * 2)) * 0.05 : 0;
          if (m.kind === 'float') {
            sw = Math.sin(this.time * 1.4) * 0.06;
            py += Math.sin(this.time * 1.9) * 0.05;
          }
          break;
      }

      const posed = sw || lf || px || py || pz;
      if (posed) {
        limb(this.limbMat, this.mat, px, py, pz, sw, lf);
        gl.uniformMatrix4fv(this.u.uModel, false, this.limbMat);
      } else {
        gl.uniformMatrix4fv(this.u.uModel, false, this.mat);
      }
      part.mesh.draw();

      /*
       * What is in your hands, hung off the arm that is already posed - so a
       * scalpel follows the swing it is making rather than being drawn at
       * some guessed position beside the body.
       *
       * Items are modelled grip-down with the business end up, so a weapon
       * left unturned points back up through its own forearm and a weapon
       * turned end over end points down through the floor. GRIP tips it out
       * of the fist, forward and clear of the leg, which is where a hand
       * carrying something actually holds it.
       */
      if (part.joint === grip.hand && weapon && posed) {
        limb(this.handMat, this.limbMat, 0.02 * scale, -0.46 * scale, -0.05 * scale,
             grip.angle, grip.out * (grip.hand === 'armL' ? -1 : 1));
        gl.uniformMatrix4fv(this.u.uModel, false, this.handMat);
        weapon.draw();
      } else if (part.joint === 'armL' && shield && grip.hand !== 'armL' && posed) {
        // a shield hangs flat on the forearm, facing the way the body faces
        limb(this.handMat, this.limbMat, -0.04 * scale, -0.30 * scale, -0.06 * scale, 0, -0.25);
        gl.uniformMatrix4fv(this.u.uModel, false, this.handMat);
        shield.draw();
      }
    }
    gl.uniform3f(this.u.uTint, 1, 1, 1);
  }

  /**
   * Which way something is walking, remembered so it does not snap back to
   * north when it stops.
   *
   * The step it is taking has to be a real one. Interpolation leaves a
   * vanishing remainder behind after every walk - a millionth of a tile due
   * east of where you stopped - and taking the direction of that reads as a
   * heading of exactly ninety degrees, which turned everyone to face east the
   * moment they arrived anywhere.
   */
  headingOf(e) {
    const dx = e.x - (e.ix ?? e.x), dy = e.y - (e.iy ?? e.y);
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) e._heading = Math.atan2(dx, -dy);
    return e._heading ?? 0;
  }

  /**
   * Turn to look at something, easing rather than snapping - a body that
   * changes which way it faces between one frame and the next reads as a
   * glitch even when the direction is right.
   */
  lookAt(e, x, z, tx, tz) {
    const want = Math.atan2(tx - x, -(tz - z));
    let cur = e._heading ?? want;
    let d = want - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    cur += d * Math.min(1, this.dt * 12);
    e._heading = cur;
    return cur;
  }

  /**
   * How far through a stride something is, or 0 for standing still.
   *
   * `stepping` is set by the snapshot that moved it, so this is a question
   * about tiles rather than about pixels. Asking whether the interpolated
   * position had caught up with the real one instead - which is what this
   * used to do - is a float comparison that never comes out true, and the
   * legs never stopped.
   */
  walkPhase(e) {
    if (!e.stepping) return 0;
    const half = (e.steps || 0) % 2 ? 0.5 : 0;
    return half + Math.min(0.999, this.alpha) * 0.5 + 0.0001;
  }

  swing(at) {
    if (!at) return 0;
    const t = (performance.now() - at) / SWING_MS;
    return t > 0 && t < 1 ? t : 0;
  }

  doorAngle(o) {
    const want = o.open ? 1 : 0;
    if (o.anim === undefined) o.anim = want;
    else o.anim += (want - o.anim) * Math.min(1, this.dt * 5);
    return o.anim;
  }

  /**
   * Bolts in flight: whatever the client launched, plus anything the game
   * state happens to be carrying. They fly a shallow arc from thrower to
   * target, and each one is drawn several times along the last few frames of
   * its own path - a trail, which is what makes something crossing eight
   * tiles in a third of a second readable at all rather than a flicker.
   */
  drawProjectiles(state) {
    const gl = this.gl;
    const now = performance.now();

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const p = (now - b.at) / b.ms;
      if (p >= 1) { this.bolts.splice(i, 1); continue; }
      if (p < 0) continue;                        // still in the hand

      const heading = Math.atan2(b.tx - b.x, -(b.tz - b.z));
      const c = rgb(b.colour);
      /*
       * Pushed past one on purpose. There is no emissive term in the shader,
       * so a spell crossing a dark corridor would be lit as dimly as the
       * floor; overdriving the tint clips the core to a bright, saturated
       * colour and leaves the shaded faces to fall away round it.
       */
      const glow = b.spell ? 2.8 : 1.3;
      const pulse = b.spell ? 1 + Math.sin(this.time * 26) * 0.09 : 1;

      for (let k = b.trail; k >= 0; k--) {
        const q = p - k * 0.06;
        if (q < 0) continue;
        const x = b.x + (b.tx - b.x) * q;
        const z = b.z + (b.tz - b.z) * q;
        // up and over: a flat line between two points reads as a laser
        const y = this.terrain.heightAt(x, z) + 0.82 + Math.sin(q * Math.PI) * b.arc;
        if (!this.cam.visible(x, y, z, 1)) continue;

        const f = glow * (1 - k * 0.26);
        const s = b.scale * pulse * (1 - k * 0.24);
        gl.uniform3f(this.u.uTint, c[0] * f, c[1] * f, c[2] * f);
        modelMatrix(this.mat, x, y, z, b.spin ? this.time * 9 - k * 0.3 : heading, s);
        limb(this.limbMat, this.mat, 0, 0, 0,
             b.spin ? this.time * 6 - k * 0.2 : Math.PI / 2, 0);
        gl.uniformMatrix4fv(this.u.uModel, false, this.limbMat);
        b.mesh.draw();
      }
    }

    for (const pr of state.projectiles) {
      const x = pr.x + 0.5, z = pr.y + 0.5;
      const y = this.terrain.heightAt(x, z) + 0.82;
      const c = rgb(pr.color || '#e0b357');
      gl.uniform3f(this.u.uTint, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3);
      modelMatrix(this.mat, x, y, z, pr.angle || 0, 0.85);
      limb(this.limbMat, this.mat, 0, 0, 0, Math.PI / 2, 0);
      gl.uniformMatrix4fv(this.u.uModel, false, this.limbMat);
      this.boltArt.shot.draw();
    }
    gl.uniform3f(this.u.uTint, 1, 1, 1);
  }

  /* ============================================================
     Picking
     ============================================================ */

  /**
   * What is under a screen pixel. Entities are tested as upright cylinders,
   * which is generous in exactly the way a player wants - a click near a
   * monster's feet or head both count - and the ground is found by walking
   * the ray down onto the heightfield.
   */
  pick(px, py) {
    const { o, d } = this.cam.ray(px, py, this.vw, this.vh);
    const hit = this.terrain.rayHit(o, d);
    const tile = hit
      ? { x: Math.floor(hit[0]), y: Math.floor(hit[2]) }
      : { x: -1, y: -1 };
    const limit = hit ? Math.hypot(hit[0] - o[0], hit[1] - o[1], hit[2] - o[2]) + 1.2 : 90;

    let best = null;
    const test = (cx, cz, radius, height, make) => {
      const t = rayCylinder(o, d, cx, cz, radius, this.terrain.heightAt(cx, cz), height);
      if (t !== null && t < limit && (!best || t < best.t)) best = { t, ...make() };
    };

    const state = this._state;
    if (state) {
      for (const p of state.others.values()) {
        test(p.rx + 0.5, p.ry + 0.5, 0.42, 1.4, () => ({ kind: 'player', ref: p }));
      }
      for (const n of state.npcs) {
        if (n.dead) continue;
        const d2 = NPCS[n.id];
        if (!d2) continue;
        const s = d2.size || 1;
        test(n.rx + s / 2, n.ry + s / 2, 0.42 * s, 1.5 * s, () => ({ kind: 'npc', ref: n }));
      }
    }
    for (const ob of this.world.objects) {
      const def = OBJ[ob.type];
      if (!def) continue;
      // whatever shape it is in now: a felled tree is a stump to click on too
      const m = this.scenery.get(ob.type, def, ob.depleted > 0);
      test(ob.x + 0.5, ob.y + 0.5, 0.44, m.height, () => ({ kind: 'obj', ref: ob }));
    }

    return { x: tile.x, y: tile.y, ent: best, ground: hit };
  }

  /** Kept for anything that only wants the tile, including the old callers. */
  screenToTile(px, py) {
    const { o, d } = this.cam.ray(px, py, this.vw, this.vh);
    const hit = this.terrain.rayHit(o, d);
    return hit ? { x: Math.floor(hit[0]), y: Math.floor(hit[2]) } : { x: -1, y: -1 };
  }

  /** World tile to screen pixel, for anything the overlay has to label. */
  tileToScreen(tx, ty) {
    const x = tx + 0.5, z = ty + 0.5;
    const s = this.cam.toScreen(x, this.terrain.heightAt(x, z), z, this.vw, this.vh);
    return { x: s.x - TILE / 2, y: s.y - TILE / 2 };
  }
}

/* ============================================================
   Attacks
   ------------------------------------------------------------
   Swinging a scalpel, thrusting a lance, bringing a hammer down
   and firing a blowpipe are four different motions, and using
   one motion for all of them makes every weapon in the game
   feel like the same weapon.

   Each returns the pose at a point through the swing: the two
   arms as [forward, outward] in radians, how far the body leans
   into it, and how far the legs brace. Arms hang down at rest,
   so a positive forward angle raises the arm in front of you.
   ============================================================ */

/**
 * Which motion a weapon uses. Nothing else in the renderer decides this.
 *
 * Injection covers three quite different things and they should not look
 * alike: a dart is thrown, a bow is drawn, a blowpipe is blown through.
 * Anatomancy is one motion with a variation per spell, chosen further down.
 */
export function attackKind(weapon) {
  if (!weapon) return 'punch';
  if (weapon.wstyle === 'magic') return 'cast';
  if (weapon.wstyle === 'ranged') {
    switch (weapon.art?.k) {
      case 'bow': return 'draw';
      case 'blowpipe': return 'blow';
      default: return 'throw';           // darts, syringes, anything hurled
    }
  }
  switch (weapon.art?.k) {
    case 'spear': case 'pick': case 'needle': return 'stab';
    case 'hammer': return 'crush';
    default: return 'slash';
  }
}

/**
 * Which motion a resource node asks for. Chopping a tree, breaking rock,
 * picking a herb and netting a pool are four different jobs done with four
 * different things in your hands, and using one arm-swing for all of them
 * makes every skill in the game feel like the same skill.
 *
 * Keyed on the tool the node wants, because that is what actually decides
 * the shape of the motion - and it means a content pack that adds a node
 * needing a pick gets the mining swing without touching this file.
 */
export function gatherKind(def) {
  switch (def?.tool) {
    case 'tapping':  return 'chop';
    case 'delving':  return 'mine';
    case 'gaff':     return 'gaff';
    case 'leeching': return 'net';
    default:         return 'forage';    // herbs, lint, cotton: done by hand
  }
}

/** Every gathering motion, for the tests to check the world against. */
export const GATHER_KINDS = ['chop', 'mine', 'gaff', 'net', 'forage'];

const ATTACKS = {
  /* A diagonal cut: out wide, then across and down through the target. */
  slash: t => ({
    armR: t < 0.28
      ? [-0.55 * (t / 0.28), 0.95 * (t / 0.28)]
      : [-0.55 + (t - 0.28) / 0.72 * 2.15, 0.95 - (t - 0.28) / 0.72 * 1.25],
    armL: [-0.25 * Math.sin(t * Math.PI), 0.2],
    lean: 0.10 * Math.sin(t * Math.PI),
    lunge: 0
  }),

  /* The same, with nothing in your hand. Shorter, and it hooks inwards. */
  punch: t => ({
    armR: t < 0.3
      ? [-0.4 * (t / 0.3), 0.5 * (t / 0.3)]
      : [-0.4 + (t - 0.3) / 0.7 * 1.75, 0.5 - (t - 0.3) / 0.7 * 0.5],
    armL: [-0.3 * Math.sin(t * Math.PI), 0.15],
    lean: 0.14 * Math.sin(t * Math.PI),
    lunge: 0
  }),

  /* Draw back, then drive it straight forward off the front foot. */
  stab: t => ({
    armR: t < 0.35
      ? [0.55 - 0.95 * (t / 0.35), 0.15]
      : [-0.40 + (t - 0.35) / 0.65 * 2.05, 0.15],
    armL: [0.45, 0.30],
    lean: t < 0.35 ? -0.10 * (t / 0.35) : -0.10 + (t - 0.35) / 0.65 * 0.32,
    lunge: t > 0.35 ? 0.22 * Math.sin((t - 0.35) / 0.65 * Math.PI) : 0
  }),

  /* Overhead, held a beat at the top, then everything comes down at once. */
  crush: t => ({
    armR: t < 0.42
      ? [-2.5 * (t / 0.42), 0.35 * (t / 0.42)]
      : [-2.5 + (t - 0.42) / 0.58 * 3.4, 0.35 - (t - 0.42) / 0.58 * 0.25],
    armL: [-0.9 * Math.min(1, t / 0.42), 0.3],
    lean: t < 0.42 ? -0.18 * (t / 0.42) : -0.18 + (t - 0.42) / 0.58 * 0.5,
    lunge: 0
  }),

  /* ---- Injection: three ways of putting something in somebody ---- */

  /* Back over the shoulder, then everything whips through together. */
  throw: t => {
    const wind = Math.min(1, t / 0.38);
    const rel = t < 0.38 ? 0 : (t - 0.38) / 0.62;
    return {
      armR: t < 0.38
        ? [-2.15 * wind, 0.55 * wind]
        : [-2.15 + rel * 3.75, 0.55 - rel * 0.45],
      armL: [0.75 * wind - rel * 0.55, 0.30],
      lean: t < 0.38 ? -0.22 * wind : -0.22 + rel * 0.52,
      lunge: rel * 0.18
    };
  },

  /* The bow arm holds still; the string hand does all the work. */
  draw: t => {
    const pull = t < 0.55 ? t / 0.55 : 1;
    const loose = t < 0.6 ? 0 : (t - 0.6) / 0.4;
    return {
      // the left arm is the bow arm: out, level, and rock steady
      armL: [1.42, 0.06],
      armR: [1.30 - pull * 0.55 + loose * 0.45, 0.18 + pull * 0.55 - loose * 0.5],
      lean: -0.05 * pull,
      lunge: 0
    };
  },

  /* Up to the mouth, a pause, then a sharp puff and the kick back. */
  blow: t => {
    const raise = Math.min(1, t / 0.3);
    const puff = t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.3) : 0;
    return {
      armR: [1.55 * raise + puff * 0.18, -0.30 * raise],
      armL: [1.15 * raise + puff * 0.12, 0.34 * raise],
      lean: -0.16 * raise - puff * 0.14,
      lunge: 0
    };
  },

  /* ---- Anatomancy ---- */

  /**
   * One motion per spell, so you can see which one you are throwing. The
   * spell id comes from the autocast the server has already told us about,
   * and anything unrecognised falls back to raising the staff.
   */
  cast: (t, spell) => (SPELL_CASTS[spell] || SPELL_CASTS._)(t),

  /* ---- getting things out of the ground ---- */

  /*
   * An axe. Both hands go back over the trailing shoulder and everything
   * comes through together and downwards, which is the difference between
   * felling a tree and waving at it.
   */
  chop: t => {
    const wind = Math.min(1, t / 0.42);
    const fall = t > 0.42 ? (t - 0.42) / 0.58 : 0;
    return {
      armR: [-2.00 * wind + fall * 3.00, 0.72 * wind - fall * 0.92],
      armL: [-1.62 * wind + fall * 2.55, -0.34 * wind + fall * 0.40],
      lean: -0.22 * wind + fall * 0.52,
      lunge: 0
    };
  },

  /*
   * A pick. Straight up over the head and straight back down, and it kicks
   * off the stone at the end rather than stopping dead in it.
   */
  mine: t => {
    const lift = Math.min(1, t / 0.46);
    const strike = t > 0.46 ? (t - 0.46) / 0.54 : 0;
    const kick = strike > 0.78 ? (strike - 0.78) * 0.7 : 0;
    return {
      armR: [-2.45 * lift + strike * 3.15 - kick, 0.24 * lift - strike * 0.20],
      armL: [-2.15 * lift + strike * 2.90 - kick, -0.24 * lift + strike * 0.20],
      lean: -0.26 * lift + strike * 0.58,
      lunge: 0
    };
  },

  /*
   * Bare hands. You bend to a herb rather than swinging at it, so this is
   * almost all torso: down, take hold of something, and straighten up.
   */
  forage: t => {
    const down = t < 0.52 ? t / 0.52 : 1 - (t - 0.52) / 0.48;
    const pluck = t > 0.34 && t < 0.72 ? Math.sin((t - 0.34) / 0.38 * Math.PI) : 0;
    return {
      armR: [0.95 * down + pluck * 0.28, -0.26 * down],
      armL: [0.48 * down, 0.24 * down],
      lean: 0.52 * down,
      lunge: 0
    };
  },

  /* A net: a low sweep that starts out to one side and finishes at the other. */
  net: t => {
    const s = Math.sin(t * Math.PI);
    return {
      armR: [0.80 + 0.50 * s, -0.80 + 1.30 * t],
      armL: [0.30 * s, 0.32],
      lean: 0.16 * s,
      lunge: 0
    };
  },

  /* A gaff: raised two-handed over the water, then driven down into it. */
  gaff: t => {
    const up = Math.min(1, t / 0.44);
    const drive = t > 0.44 ? (t - 0.44) / 0.56 : 0;
    return {
      armR: [1.52 * up - drive * 0.95, -0.34 * up + drive * 0.16],
      armL: [1.18 * up - drive * 0.80, 0.32 * up - drive * 0.14],
      lean: -0.10 * up + drive * 0.42,
      lunge: drive * 0.14
    };
  }
};

const SPELL_CASTS = {
  /* Flesh bolt: a knot of tissue, hurled underarm. Quick and low. */
  flesh_bolt: t => ({
    armR: t < 0.3
      ? [-0.75 * (t / 0.3), -0.15]
      : [-0.75 + (t - 0.3) / 0.7 * 2.35, -0.15 - (t - 0.3) / 0.7 * 0.25],
    armL: [0.25, 0.2],
    lean: 0.14 * Math.sin(t * Math.PI),
    lunge: 0
  }),

  /* Nerve strike: the arm snaps straight out and stays there, shaking. */
  nerve_strike: t => {
    const out = Math.min(1, t / 0.18);
    const buzz = t > 0.18 ? Math.sin(t * 90) * 0.07 * (1 - t) : 0;
    return {
      armR: [1.55 * out + buzz, -0.10 + buzz * 0.5],
      armL: [-0.30 * out, 0.35],
      lean: -0.10 * out,
      lunge: 0
    };
  },

  /* Bile lance: both arms drive forward together, like aiming a hose. */
  bile_lance: t => {
    const up = Math.min(1, t / 0.35);
    const push = t > 0.35 ? (t - 0.35) / 0.65 : 0;
    return {
      armR: [1.05 * up + push * 0.5, -0.45 * up + push * 0.35],
      armL: [0.95 * up + push * 0.5, 0.40 * up - push * 0.3],
      lean: -0.22 * up + push * 0.34,
      lunge: push * 0.20
    };
  },

  /* Vital rend: hands together, then wrenched apart. */
  vital_rend: t => {
    const grip = Math.min(1, t / 0.4);
    const tear = t > 0.4 ? (t - 0.4) / 0.6 : 0;
    return {
      armR: [1.25 * grip, -0.55 * grip + tear * 1.5],
      armL: [1.25 * grip, -0.55 * grip + tear * 1.5],
      lean: -0.18 * grip - tear * 0.12,
      lunge: 0
    };
  },

  /* Transfuse: reach out, take hold, and drag it back into your chest. */
  transfuse: t => {
    const reach = Math.min(1, t / 0.35);
    const pull = t > 0.45 ? (t - 0.45) / 0.55 : 0;
    return {
      armR: [1.50 * reach - pull * 1.15, -0.20 * reach + pull * 0.55],
      armL: [1.30 * reach - pull * 1.05, 0.25 * reach - pull * 0.45],
      lean: -0.20 * reach + pull * 0.42,
      lunge: -pull * 0.12
    };
  },

  /* Anything else: raise it, and let the arm shake while it happens. */
  _: t => ({
    armR: [1.05 + 0.55 * Math.sin(t * Math.PI) + Math.sin(t * 40) * 0.05 * (1 - t), -0.45],
    armL: [0.35 * Math.sin(t * Math.PI), 0.25],
    lean: -0.12 * Math.sin(t * Math.PI),
    lunge: 0
  })
};

/** Every spell that has a motion of its own, for the tests to check against. */
export const SPELL_MOTIONS = Object.keys(SPELL_CASTS).filter(k => k !== '_');

/**
 * Where a ray enters an upright cylinder, or null. Used for every click on
 * anything that stands up: it is cheap, it needs no per-model work, and it
 * is forgiving in the way a mouse needs.
 */
function rayCylinder(o, d, cx, cz, r, baseY, height) {
  const ox = o[0] - cx, oz = o[2] - cz;
  const a = d[0] * d[0] + d[2] * d[2];
  if (a < 1e-8) return null;
  const b = 2 * (ox * d[0] + oz * d[2]);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0.05) continue;
    const y = o[1] + d[1] * t;
    if (y >= baseY - 0.2 && y <= baseY + height + 0.25) return t;
  }
  return null;
}

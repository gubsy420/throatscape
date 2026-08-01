/* ============================================================
   The head in the dialogue box
   ------------------------------------------------------------
   RuneScape puts the model of whoever is talking into the chat
   interface and animates it while they speak, and it is most of
   what makes talking to somebody feel like talking to somebody
   rather than reading a caption.

   This is the same idea with the models the game already has:
   a second, very small WebGL view holding one creature, framed
   on its head. It has its own context because meshes belong to
   the context that built them - the ward's renderer cannot lend
   its own - but it is one context, made once and reused for
   every conversation.
   ============================================================ */

import { getContext, makeProgram } from './gl/gl.js';
import { m4, perspective, lookAt, multiply, model as modelMatrix, limb } from './gl/mat4.js';
import { rgb } from './gl/mesh.js';
import { CreatureModels } from './models/creatures.js';

const FOV = 0.55;                    // tight, so the head fills it without distortion
const LIGHT = (() => {
  // from the front and a little above, which is how you light a face
  const v = [-0.35, 0.62, -0.70];
  const l = Math.hypot(...v);
  return v.map(n => n / l);
})();

/** Air left around the subject, so nothing is cropped by the frame. */
export const MARGIN = 1.5;

/**
 * Where to point the camera at a creature, measured off the model rather than
 * guessed at.
 *
 * Anything with a head is framed on the head; anything without - a rat
 * carries its face out in front at ankle height - is framed on the whole
 * animal, because a close-up of a rat's nose is not a portrait of a rat.
 *
 * The box is tall and narrow, so it is nearly always the width that decides
 * how far back to stand. Working from the height alone put the camera inside
 * the subject's face and filled the panel with one cheek.
 */
export function frameOn(model, aspect = 0.55, fov = FOV) {
  const head = model.parts.find(p => p.joint === 'head');
  const parts = head ? [head] : model.parts;

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p.mesh.min[i] + p.pivot[i]);
      hi[i] = Math.max(hi[i], p.mesh.max[i] + p.pivot[i]);
    }
  }
  if (!Number.isFinite(lo[1])) return { aim: model.height * 0.8, dist: model.height * 2 };

  const spanY = (hi[1] - lo[1]) * MARGIN;
  const spanX = (hi[0] - lo[0]) * MARGIN;
  const t = Math.tan(fov / 2);
  const dist = Math.max(spanY / 2 / t, spanX / 2 / (t * Math.max(0.2, aspect)))
             + (hi[2] - lo[2]) / 2;

  return {
    // a shade below centre, so a chin and some shoulder come into shot
    aim: (lo[1] + hi[1]) / 2 - spanY * 0.06,
    dist,
    subject: { lo, hi }
  };
}

export class Portrait {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dlg-portrait';
    this.gl = getContext(this.canvas);
    this.ok = !!this.gl;
    if (!this.ok) return;

    const { prog, u } = makeProgram(this.gl);
    this.prog = prog;
    this.u = u;
    this.creatures = new CreatureModels(this.gl);

    this.view = m4();
    this.proj = m4();
    this.viewProj = m4();
    this.mat = m4();
    this.limbMat = m4();

    this.model = null;
    this.time = 0;
    this.spokeAt = -1e9;
    this.raf = 0;
  }

  /** Which creature is talking. `art` is the NPC's art descriptor. */
  set(art) {
    if (!this.ok) return;
    this.model = this.creatures.get(art || { k: 'humanoid' });
    this.speak();
  }

  /** A new line has arrived, so put some emphasis back into the head. */
  speak() { this.spokeAt = this.time; }

  start() {
    if (!this.ok || this.raf) return;
    const loop = () => { this.raf = requestAnimationFrame(loop); this.draw(); };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resize() {
    if (!this.ok) return;
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor((r.width || 84) * dpr));
    const h = Math.max(1, Math.floor((r.height || 84) * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.aspect = w / h;
  }

  framing() { return frameOn(this.model, this.aspect); }

  draw() {
    if (!this.ok || !this.model) return;
    const gl = this.gl;
    this.time += 1 / 60;
    this.resize();

    const { aim, dist } = this.framing();

    /*
     * The camera stands due north of them looking south, because models are
     * built facing north - so this is the one angle from which somebody is
     * looking at you rather than away.
     */
    lookAt(this.view, [0, aim + 0.02, -dist], [0, aim, 0], [0, 1, 0]);
    perspective(this.proj, FOV, this.aspect, 0.05, 40);
    multiply(this.viewProj, this.proj, this.view);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.055, 0.028, 0.043, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uViewProj, false, this.viewProj);
    gl.uniform3f(this.u.uLightDir, LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform1f(this.u.uAlpha, 1);
    gl.uniform1f(this.u.uFade, 1);
    gl.uniform3f(this.u.uTint, 1, 1, 1);
    gl.uniform3f(this.u.uSun, 0.72, 0.68, 0.62);
    gl.uniform3f(this.u.uSky, 0.92, 0.88, 0.98);
    gl.uniform3f(this.u.uGround, 0.44, 0.38, 0.44);
    // no fog: the box is dark enough already, and a head that fades is a ghost
    gl.uniform3f(this.u.uFogColor, 0.055, 0.028, 0.043);
    gl.uniform2f(this.u.uFogRange, 40, 60);

    const t = this.time;
    /*
     * Talking, as far as a box with a face painted on it can. A quick nod on
     * every new line that settles into a slow idle sway - the emphasis is
     * what makes it look like it just said something.
     */
    const since = t - this.spokeAt;
    const emphasis = Math.max(0, 1 - since / 1.1);
    const chatter = Math.sin(t * 15) * 0.06 * emphasis;
    const nod = Math.sin(t * 1.6) * 0.035 + chatter;
    const sway = Math.sin(t * 1.1 + 0.7) * 0.05 + Math.sin(t * 13) * 0.03 * emphasis;
    const bob = Math.sin(t * 1.6) * 0.006;

    for (const part of this.model.parts) {
      // turned a few degrees off square, the way a portrait is posed
      modelMatrix(this.mat, 0, bob, 0, 0.22 + sway * 0.35, 1);
      let sw = 0, lf = 0;
      const [px, py, pz] = part.pivot;

      switch (part.joint) {
        case 'head':  sw = nod; lf = sway; break;
        case 'torso': sw = (this.model.stoop || 0) + Math.sin(t * 1.3) * 0.012; break;
        case 'body':  sw = Math.sin(t * 1.5) * 0.05 + chatter; break;
        case 'armL':  sw = Math.sin(t * 1.2) * 0.05; break;
        case 'armR':  sw = -Math.sin(t * 1.2) * 0.05; break;
      }

      if (sw || lf || px || py || pz) {
        limb(this.limbMat, this.mat, px, py, pz, sw, lf);
        gl.uniformMatrix4fv(this.u.uModel, false, this.limbMat);
      } else {
        gl.uniformMatrix4fv(this.u.uModel, false, this.mat);
      }
      part.mesh.draw();
    }
  }

  dispose() {
    this.stop();
    if (this.ok) this.creatures.dispose();
  }
}

/** The colour behind the head, exported so the stylesheet and the clear agree. */
export const PORTRAIT_BG = rgb('#0e070b');

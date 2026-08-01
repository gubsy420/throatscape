/* ============================================================
   The camera
   ------------------------------------------------------------
   It orbits the player: a yaw around them, a pitch above the
   ground, and a distance out. The arrow keys move those three
   numbers and nothing else, which is exactly what RuneScape's
   camera does and what a flat renderer could never really
   imitate - there, tilting could only squash the floor, and the
   world stayed a picture lying on a table.

   Angles are in radians and yaw 0 looks north, so the compass
   and the minimap read the same as they always have.
   ============================================================ */

import { m4, perspective, lookAt, multiply, invert, project } from './mat4.js';

export const PITCH_MIN = 0.20;             // ~11 deg: almost along the ground
export const PITCH_MAX = 1.45;             // ~83 deg: almost straight down
export const YAW_RATE = 2.2;               // radians a second while held
export const PITCH_RATE = 1.3;
export const ZOOM_MIN = 5;
export const ZOOM_MAX = 22;
export const DRAG_YAW = 0.0062;            // radians per pixel dragged
export const DRAG_PITCH = 0.0050;
const FOV = 0.86;                          // ~49 degrees vertical
const NEAR = 0.3, FAR = 140;

export class Camera {
  constructor() {
    this.target = [0, 0, 0];               // what it looks at, in world units
    this.yaw = 0;
    this.pitch = 0.62;                     // about 35 degrees, where RuneScape sits
    this.dist = 10.5;
    this.keys = new Set();

    this.view = m4();
    this.proj = m4();
    this.viewProj = m4();
    this.invViewProj = m4();
    this.eye = [0, 0, 0];
    this.aspect = 1;
  }

  /** Arrow keys orbit and tilt; the tilt also decides how close it sits. */
  step(dt) {
    const k = this.keys;
    dt = Math.min(0.05, dt);
    if (k.has('ArrowLeft'))  this.yaw += YAW_RATE * dt;
    if (k.has('ArrowRight')) this.yaw -= YAW_RATE * dt;
    if (k.has('ArrowUp'))    this.pitch = Math.min(PITCH_MAX, this.pitch + PITCH_RATE * dt);
    if (k.has('ArrowDown'))  this.pitch = Math.max(PITCH_MIN, this.pitch - PITCH_RATE * dt);

    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /**
   * Dragging with the middle button, which is the other way RuneScape lets
   * you move the camera. It does exactly what the arrow keys do, in the
   * direction you drag: pull left and it turns the way holding Left turns it.
   *
   * Taking pixels rather than a rate keeps it independent of frame rate, and
   * means a slow drag turns slowly, which a key cannot do.
   */
  dragBy(dx, dy) {
    this.yaw -= dx * DRAG_YAW;
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch - dy * DRAG_PITCH));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  zoomBy(amount) {
    this.dist = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.dist + amount));
  }

  faceNorth() { this.yaw = 0; }

  /** Rebuilds the matrices. Call once a frame, after moving the target. */
  update(aspect) {
    this.aspect = aspect;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);

    /*
     * Yaw 0 puts the camera due south of the target looking north, which is
     * what makes an unturned camera agree with the map: north is up, east is
     * right. The map's y axis runs south, so it is the world's +z.
     */
    this.eye[0] = this.target[0] - Math.sin(this.yaw) * cp * this.dist;
    this.eye[1] = this.target[1] + sp * this.dist;
    this.eye[2] = this.target[2] + Math.cos(this.yaw) * cp * this.dist;

    lookAt(this.view, this.eye, this.target, [0, 1, 0]);
    perspective(this.proj, FOV, aspect, NEAR, FAR);
    multiply(this.viewProj, this.proj, this.view);
    invert(this.invViewProj, this.viewProj);
    return this;
  }

  /** World point to screen pixel, plus whether it is in front of the camera. */
  toScreen(x, y, z, vw, vh, out = { x: 0, y: 0, depth: 0, visible: false }) {
    const m = this.viewProj;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    out.visible = w > 0.001;
    const iw = out.visible ? 1 / w : 1;
    out.x = (cx * iw * 0.5 + 0.5) * vw;
    out.y = (0.5 - cy * iw * 0.5) * vh;
    out.depth = w;
    return out;
  }

  /**
   * The ray under a screen pixel, as an origin and a unit direction. This is
   * how every click in the game finds out what it hit.
   */
  ray(px, py, vw, vh) {
    const ndcX = (px / vw) * 2 - 1;
    const ndcY = 1 - (py / vh) * 2;
    const near = project(this.invViewProj, ndcX, ndcY, -1);
    const far = project(this.invViewProj, ndcX, ndcY, 1);
    let dx = far[0] - near[0], dy = far[1] - near[1], dz = far[2] - near[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    return { o: near, d: [dx / l, dy / l, dz / l] };
  }

  /**
   * Whether a ball of this radius is worth drawing. A sphere test against the
   * four side planes is coarse, but it is one dot product per plane and it
   * throws away most of a 200-tile map.
   */
  visible(x, y, z, radius) {
    const m = this.viewProj;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w < -radius) return false;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    // generous: radius is a bounding sphere in world units, w is clip scale
    const slack = radius * 2.2 + 1;
    return Math.abs(cx) <= w + slack && Math.abs(cy) <= w + slack;
  }
}

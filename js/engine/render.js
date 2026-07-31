/* ============================================================
   World renderer - terrain chunks, scenery, entities, effects
   ============================================================ */

import { TILE, hash2, clamp, lerp, mix, shade } from '../util.js';
import { TILE_INFO, T, OBJ } from '../data/world.js';
import { NPCS } from '../data/npcs.js';
import { drawArt } from './icons.js';
import { item } from '../data/items.js';
import { parseChat, charColour, charOffset } from '../game/chatfx.js';

const CHUNK = 16;

/** How long one swing takes to play. A server tick is 600 ms; this fits inside. */
const SWING_MS = 420;

/*
 * Camera. The world is drawn flat, but the camera can be orbited around the
 * player and tilted down towards the horizon, the way RuneScape's is.
 *
 * Pitch is the angle above the ground: 90 is looking straight down. Lowering
 * it squashes the ground plane vertically - which is all an orthographic tilt
 * is - while sprites stay upright and full height, so they rise off the floor
 * as the view flattens. Tilting also pulls the camera in, because a camera
 * swinging down towards eye level is also swinging closer.
 */
const PITCH_MAX = 90;     // straight down, the view the game has always had
const PITCH_MIN = 34;     // as low as the flat-drawn art can take
const YAW_RATE = 2.2;     // radians per second while an arrow is held: a turn in ~3 s
const PITCH_RATE = 42;    // degrees per second: top to bottom in ~1.3 s

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cam = { x: 0, y: 0 };        // the world point the camera looks at, in tiles
    this.zoom = 1;
    this.yaw = 0;                     // radians; 0 puts north at the top
    this.pitch = PITCH_MAX;
    this.cos = 1; this.sin = 0;
    this.keys = new Set();            // camera keys held down, filled by main.js
    this.chunks = new Map();
    this.time = 0;
    this.hoverTile = null;
    this.lowDetail = false;
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.dpr = dpr;
    this.vw = r.width;
    this.vh = r.height;
  }

  /* ---------------- camera ---------------------------------- */

  /** How hard the ground plane is foreshortened. 1 is straight down. */
  get squash() { return Math.sin(this.pitch * Math.PI / 180); }

  /** Tilting down also brings the camera in, so the world grows a little. */
  get dolly() { return 1 + (1 - this.squash) * 0.55; }

  get ts() { return TILE * this.zoom * this.dolly; }

  /** True once the camera has left the flat overhead view it starts in. */
  get oblique() { return this.yaw !== 0 || this.pitch !== PITCH_MAX; }

  /**
   * Where the camera's focus sits on screen. A low camera is behind you as
   * well as above you, so what you are looking at slides down the screen and
   * more of the ground ahead comes into view.
   */
  get pivotY() { return this.vh * (0.5 + (1 - this.squash) * 0.28); }

  /** Arrow keys orbit and tilt, exactly as they do in RuneScape. */
  stepCamera() {
    const k = this.keys, dt = Math.min(0.05, this.dt || 0);
    if (k.has('ArrowLeft'))  this.yaw += YAW_RATE * dt;
    if (k.has('ArrowRight')) this.yaw -= YAW_RATE * dt;
    if (k.has('ArrowUp'))    this.pitch = Math.min(PITCH_MAX, this.pitch + PITCH_RATE * dt);
    if (k.has('ArrowDown'))  this.pitch = Math.max(PITCH_MIN, this.pitch - PITCH_RATE * dt);

    // keep yaw inside one turn, so the compass never winds up
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    this.cos = Math.cos(this.yaw);
    this.sin = Math.sin(this.yaw);
  }

  /** Back to looking north. The pitch is left alone - only the compass resets. */
  faceNorth() { this.yaw = 0; this.cos = 1; this.sin = 0; }

  /* ---------------- projection ------------------------------ */

  /** World point (in tiles) -> screen pixel. */
  project(wx, wy) {
    const ts = this.ts;
    const dx = wx - this.cam.x, dy = wy - this.cam.y;
    return {
      x: this.vw / 2 + (dx * this.cos - dy * this.sin) * ts,
      y: this.pivotY + (dx * this.sin + dy * this.cos) * ts * this.squash
    };
  }

  /** Screen pixel -> world point (in tiles). The inverse of project. */
  unproject(px, py) {
    const ts = this.ts;
    const sx = (px - this.vw / 2) / ts;
    const sy = (py - this.pivotY) / ts / this.squash;
    return {
      x: this.cam.x + sx * this.cos + sy * this.sin,
      y: this.cam.y - sx * this.sin + sy * this.cos
    };
  }

  /**
   * Draw order. Sorting by world y is only correct facing north: turn the
   * camera and it starts drawing the near side of the street first.
   */
  depth(wx, wy) { return wx * this.sin + wy * this.cos; }

  /** Which way something at a,b has to face to be looking at c,d, on screen. */
  screenDir(ax, ay, bx, by) {
    return (bx - ax) * this.cos - (by - ay) * this.sin >= 0 ? 1 : -1;
  }

  /** Screen pixel -> world tile. */
  screenToTile(px, py) {
    const w = this.unproject(px, py);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  /**
   * World tile -> screen pixel, positioned so that adding half a tile lands on
   * the middle of it. Everything that stands on the ground is a billboard: it
   * is placed by the projection but drawn upright and unsquashed, so a rotated
   * camera swings the crowd around without laying anyone on their side.
   */
  tileToScreen(tx, ty) {
    const s = this.project(tx + 0.5, ty + 0.5), h = this.ts / 2;
    return { x: s.x - h, y: s.y - h };
  }

  centerOn(px, py, snap = false) {
    if (snap) { this.cam.x = px; this.cam.y = py; }
    else {
      this.cam.x = lerp(this.cam.x, px, 0.18);
      this.cam.y = lerp(this.cam.y, py, 0.18);
    }
  }

  /* ---------------- terrain chunk cache --------------------- */

  chunkCanvas(cx, cy) {
    const key = cx + ',' + cy;
    let c = this.chunks.get(key);
    if (c) return c;

    const px = CHUNK * TILE;
    c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    const w = this.world;

    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const tx = cx * CHUNK + i, ty = cy * CHUNK + j;
        const t = w.tileAt(tx, ty);
        const info = TILE_INFO[t] || TILE_INFO[T.VOID];
        const n = hash2(tx, ty, 17);
        const region = w.regionAt(tx, ty);

        let base = n > 0.5 ? info.c2 : info.c;
        if (region && region.tint && (t === T.TURF || t === T.BOG || t === T.CHALK)) {
          base = mix(base.startsWith('#') ? base : info.c, region.tint, 0.35);
        }
        g.fillStyle = base;
        g.fillRect(i * TILE, j * TILE, TILE, TILE);

        // per-tile brightness jitter, so large same-tile areas do not read flat
        const jit = hash2(tx, ty, 53) - 0.5;
        g.fillStyle = jit > 0
          ? `rgba(255,255,255,${(jit * 0.11).toFixed(3)})`
          : `rgba(0,0,0,${(-jit * 0.16).toFixed(3)})`;
        g.fillRect(i * TILE, j * TILE, TILE, TILE);

        // speckle / texture pass
        const spots = t === T.BILE ? 3 : t === T.VOID ? 0 : 4;
        for (let k = 0; k < spots; k++) {
          const h1 = hash2(tx * 7 + k, ty * 13 - k, 91 + k);
          const h2 = hash2(tx * 3 - k, ty * 5 + k, 133 + k);
          const h3 = hash2(tx + k, ty - k, 211 + k);
          const sz = 1 + Math.floor(h3 * 3);
          g.fillStyle = h3 > 0.55
            ? 'rgba(255,255,255,0.045)'
            : 'rgba(0,0,0,0.075)';
          g.fillRect(i * TILE + h1 * (TILE - sz), j * TILE + h2 * (TILE - sz), sz, sz);
        }

        // seams so tile edges read as a grid without a hard outline
        if (t !== T.VOID) {
          g.fillStyle = 'rgba(0,0,0,0.055)';
          g.fillRect(i * TILE, j * TILE + TILE - 1, TILE, 1);
          g.fillRect(i * TILE + TILE - 1, j * TILE, 1, TILE);
        }

        if (t === T.WALL || t === T.CAVEWALL) {
          g.fillStyle = 'rgba(255,255,255,0.10)';
          g.fillRect(i * TILE, j * TILE, TILE, 3);
          g.fillStyle = 'rgba(0,0,0,0.28)';
          g.fillRect(i * TILE, j * TILE + TILE - 4, TILE, 4);
        }
        if (t === T.CARPET) {
          g.strokeStyle = 'rgba(224,179,87,0.22)';
          g.lineWidth = 1;
          g.strokeRect(i * TILE + 3.5, j * TILE + 3.5, TILE - 7, TILE - 7);
        }
      }
    }

    this.chunks.set(key, c);
    if (this.chunks.size > 260) {
      // drop the oldest few so long sessions do not grow forever
      const it = this.chunks.keys();
      for (let i = 0; i < 40; i++) this.chunks.delete(it.next().value);
    }
    return c;
  }

  /* ---------------- main draw ------------------------------- */

  draw(state, alpha) {
    const ctx = this.ctx;
    const ts = this.ts;
    this.time += 1 / 60;

    this.alpha = alpha;                 // progress through the current tick

    // real elapsed time, for anything that should look the same on any display
    const now = performance.now();
    this.dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 1 / 60;
    this._last = now;

    this.stepCamera();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#07050a';
    ctx.fillRect(0, 0, this.vw, this.vh);

    const p = state.player;
    const px = p.rx, py = p.ry;
    this.centerOn(px + 0.5, py + 0.5, state.snapCam);
    state.snapCam = false;

    /*
     * What is on screen is a rotated, squashed rectangle in world space, so
     * the visible tiles are whatever its corners bound. Two tiles of slack
     * either side covers scenery whose art overhangs its own tile.
     */
    const corners = [[0, 0], [this.vw, 0], [0, this.vh], [this.vw, this.vh]]
      .map(([sx, sy]) => this.unproject(sx, sy));
    const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
    const x0 = Math.floor(Math.min(...xs)) - 2;
    const x1 = Math.ceil(Math.max(...xs)) + 2;
    const y0 = Math.floor(Math.min(...ys)) - 2;
    const y1 = Math.ceil(Math.max(...ys)) + 2;

    /* terrain */
    const c0 = Math.floor(x0 / CHUNK), c1 = Math.floor(x1 / CHUNK);
    const r0 = Math.floor(y0 / CHUNK), r1 = Math.floor(y1 / CHUNK);
    const span = CHUNK * TILE;
    ctx.save();
    if (this.oblique) {
      ctx.translate(this.vw / 2, this.pivotY);
      ctx.scale(1, this.squash);
      ctx.rotate(this.yaw);
      ctx.scale(ts / TILE, ts / TILE);
      ctx.translate(-this.cam.x * TILE, -this.cam.y * TILE);
      // a rotated blit cannot be pixel-exact, so let it filter rather than crawl
      ctx.imageSmoothingEnabled = true;
    } else {
      // the overhead view still lands on whole pixels, exactly as it used to
      ctx.translate(Math.round(this.vw / 2 - this.cam.x * ts),
                    Math.round(this.pivotY - this.cam.y * ts));
      ctx.scale(ts / TILE, ts / TILE);
    }
    // a hair of overlap: sampling a rotated edge otherwise leaves seams between chunks
    const bleed = this.oblique ? 1 : 0;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (cx < 0 || cy < 0) continue;
        ctx.drawImage(this.chunkCanvas(cx, cy),
          cx * span, cy * span, span + bleed, span + bleed);
      }
    }
    ctx.restore();
    ctx.imageSmoothingEnabled = false;

    /* animated bile shimmer */
    this.drawBileShimmer(x0, y0, x1, y1);

    /* ground items */
    for (const g of state.ground) {
      if (g.x < x0 || g.x > x1 || g.y < y0 || g.y > y1) continue;
      const s = this.tileToScreen(g.x, g.y);
      const bob = Math.sin(this.time * 2.2 + g.x + g.y) * 1.5;
      ctx.save();
      ctx.translate(s.x + ts * 0.5, s.y + ts * 0.5 + bob);
      ctx.globalAlpha = g.ttl < 60 ? 0.35 + 0.35 * Math.sin(this.time * 8) : 1;
      ctx.scale(ts / 32, ts / 32);
      ctx.translate(-11, -11);
      drawArt(ctx, item(g.id)?.art || { k: 'blob' }, 22);
      ctx.restore();
    }

    /* build the depth-sorted draw list */
    const list = [];
    for (const o of this.world.objects) {
      if (o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1) continue;
      list.push({ y: this.depth(o.x, o.y), kind: 'obj', o });
    }
    for (const n of state.npcs) {
      if (n.dead) continue;
      if (n.rx < x0 - 1 || n.rx > x1 || n.ry < y0 - 1 || n.ry > y1) continue;
      list.push({ y: this.depth(n.rx, n.ry), kind: 'npc', n });
    }
    for (const o of state.others.values()) {
      if (o.rx < x0 - 1 || o.rx > x1 || o.ry < y0 - 1 || o.ry > y1) continue;
      list.push({ y: this.depth(o.rx, o.ry), kind: 'other', o });
    }
    list.push({ y: this.depth(px, py), kind: 'player', p });
    list.sort((a, b) => a.y - b.y);

    /* selection ring under the current target */
    if (state.target && state.target.kind === 'npc' && !state.target.ref.dead) {
      this.ring(state.target.ref.rx, state.target.ref.ry, '#d4586b');
    }
    if (state.hoverObj) this.tileOutline(state.hoverObj.x, state.hoverObj.y, 'rgba(224,179,87,.55)');
    if (state.moveMarker && state.moveMarker.ttl > 0) this.moveMarker(state.moveMarker);

    for (const e of list) {
      if (e.kind === 'obj') this.drawObject(e.o, state);
      else if (e.kind === 'npc') this.drawNpc(e.n, state);
      else if (e.kind === 'other') this.drawOther(e.o);
      else this.drawPlayer(state);
    }

    /* projectiles */
    for (const pr of state.projectiles) {
      const a = this.tileToScreen(pr.x, pr.y);
      ctx.save();
      ctx.translate(a.x + ts / 2, a.y + ts / 2);
      ctx.rotate(pr.angle);
      ctx.fillStyle = pr.color;
      ctx.shadowColor = pr.color; ctx.shadowBlur = 8;
      ctx.fillRect(-6, -1.5, 12, 3);
      ctx.restore();
    }

    /* hitsplats and floating text sit above everything */
    for (const h of state.hitsplats) this.drawHitsplat(h);
    for (const f of state.floaters) this.drawFloater(f);

    /* darkness in the deep places */
    const reg = this.world.regionAt(Math.round(px), Math.round(py));
    if (reg && (reg.id === 'larynx' || reg.id === 'gullet')) {
      const lamp = this.project(px + 0.5, py + 0.5);
      const g = ctx.createRadialGradient(lamp.x, lamp.y, ts * 3,
                                         lamp.x, lamp.y, ts * 11);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, reg.id === 'larynx' ? 'rgba(4,2,6,0.72)' : 'rgba(30,4,10,0.5)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.vw, this.vh);
    }

    this.drawMinimap(state);
  }

  /* ---------------- minimap -------------------------------- */

  /** One pixel per tile, built once and then blitted cropped + scaled. */
  minimapBase() {
    if (this._mm) return this._mm;
    const w = this.world;
    const c = document.createElement('canvas');
    c.width = w.w; c.height = w.h;
    const g = c.getContext('2d');
    const img = g.createImageData(w.w, w.h);
    for (let y = 0; y < w.h; y++) {
      for (let x = 0; x < w.w; x++) {
        const info = TILE_INFO[w.tileAt(x, y)] || TILE_INFO[T.VOID];
        const hex = (hash2(x, y, 5) > 0.5 ? info.c2 : info.c).slice(1);
        const n = parseInt(hex, 16);
        const o = (y * w.w + x) * 4;
        img.data[o] = (n >> 16) & 255;
        img.data[o + 1] = (n >> 8) & 255;
        img.data[o + 2] = n & 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // scenery reads as darker flecks so towns and forests are recognisable
    for (const o of w.objects) {
      const d = OBJ[o.type];
      g.fillStyle = d.skill ? 'rgba(20,40,20,.55)' : 'rgba(230,200,120,.75)';
      g.fillRect(o.x, o.y, 1, 1);
    }
    this._mm = c;
    return c;
  }

  drawMinimap(state) {
    const ctx = this.ctx;
    const size = this.vw < 700 ? 104 : 138;
    const pad = 10;
    const cx = this.vw - size / 2 - pad;
    const cy = this.vh - size / 2 - pad;
    const scale = 2;                             // screen px per world tile
    const span = size / scale;
    const p = state.player;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, 7);
    ctx.fillStyle = '#0c0508';
    ctx.fill();
    ctx.clip();

    /*
     * The map turns with the camera, so the way you are looking is always up.
     * The crop is half again as wide as the dial, because a square rotated
     * inside a circle has to cover the corners it sweeps through.
     */
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.yaw);
    const crop = span * 1.5, out = size * 1.5;
    ctx.drawImage(
      this.minimapBase(),
      p.rx - crop / 2, p.ry - crop / 2, crop, crop,
      -out / 2, -out / 2, out, out
    );
    ctx.restore();

    const dot = (wx, wy, col, r = 2) => {
      const dx = (wx - p.rx) * scale, dy = (wy - p.ry) * scale;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx + dx * this.cos - dy * this.sin,
              cy + dx * this.sin + dy * this.cos, r, 0, 7);
      ctx.fill();
    };

    for (const g of state.ground) dot(g.x, g.y, '#e8dcc8', 1.4);
    for (const n of state.npcs) {
      if (n.dead) continue;
      if (Math.abs(n.x - p.x) > span / 2 || Math.abs(n.y - p.y) > span / 2) continue;
      dot(n.rx, n.ry, NPCS[n.id].hostile ? '#e0503f' : '#e0b357');
    }
    for (const o of state.others.values()) dot(o.rx, o.ry, '#86b7e0', 2.4);

    // player, with a facing pip
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, 7); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#6b3d4c';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, 7); ctx.stroke();

    ctx.fillStyle = 'rgba(12,5,8,.75)';
    ctx.font = '600 10px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    const label = `${p.x}, ${p.y}`;
    const tw = ctx.measureText(label).width + 10;
    ctx.fillRect(cx - tw / 2, cy + size / 2 - 14, tw, 13);
    ctx.fillStyle = '#b7a98f';
    ctx.fillText(label, cx, cy + size / 2 - 4);
    ctx.restore();

    // last, so that facing south does not bury the needle under the readout
    this.drawCompass(cx, cy, size / 2);
  }

  /*
   * Everything below lies on the floor rather than standing on it, so it is
   * drawn through the projection instead of being billboarded: a ripple runs
   * along the tile it is in, and a ring flattens as the camera comes down.
   */

  /**
   * The needle rides the minimap rim and always points north, so a turned
   * camera is something you can see rather than something you have to
   * remember. Clicking it puts you back facing north.
   */
  drawCompass(cx, cy, r) {
    const ctx = this.ctx;
    // north is straight up until the camera turns, then it swings with it
    const nx = cx - this.sin * r, ny = cy - this.cos * r;
    this.compass = { x: nx, y: ny, r: 13 };

    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(this.yaw);

    ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7);
    ctx.fillStyle = 'rgba(12,5,8,.9)'; ctx.fill();
    ctx.strokeStyle = '#6b3d4c'; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(3.4, 1); ctx.lineTo(-3.4, 1);
    ctx.closePath();
    ctx.fillStyle = '#d4586b'; ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, 7); ctx.lineTo(3.4, 1); ctx.lineTo(-3.4, 1);
    ctx.closePath();
    ctx.fillStyle = '#8c7f6a'; ctx.fill();
    ctx.restore();
  }

  /** Is this screen point on the compass? Answered for the click handler. */
  compassAt(px, py) {
    const c = this.compass;
    return !!c && Math.hypot(px - c.x, py - c.y) <= c.r;
  }

  drawBileShimmer(x0, y0, x1, y1) {
    if (this.lowDetail) return;
    const ctx = this.ctx, w = this.world;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 2 * this.dolly;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (w.tileAt(x, y) !== T.BILE) continue;
        const ph = this.time * 1.4 + (x * 0.7 + y * 1.1);
        const a = (Math.sin(ph) + 1) / 2;
        const l = this.project(x, y + 0.3 + a * 0.4);
        const r = this.project(x + 1, y + 0.3 + a * 0.4);
        ctx.strokeStyle = a > 0.5 ? '#a3c98f' : '#4a5a2f';
        ctx.beginPath();
        ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  ring(tx, ty, col) {
    const ctx = this.ctx, ts = this.ts;
    const s = this.tileToScreen(tx, ty);
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(s.x + ts / 2, s.y + ts * 0.82, ts * 0.36, ts * 0.16 * this.squash, 0, 0, 7);
    ctx.stroke();
    ctx.restore();
  }

  tileOutline(tx, ty, col) {
    const ctx = this.ctx;
    const c = [[0.04, 0.04], [0.96, 0.04], [0.96, 0.96], [0.04, 0.96]]
      .map(([a, b]) => this.project(tx + a, ty + b));
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  moveMarker(m) {
    const ctx = this.ctx, ts = this.ts;
    const s = this.project(m.x + 0.5, m.y + 0.5);
    const t = 1 - m.ttl / 24;
    const r = ts * 0.15 + t * ts * 0.3;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = '#e8dcc8'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r, r * this.squash, 0, 0, 7);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- scenery --------------------------------- */

  /**
   * The phase of a walk cycle for something moving between two tiles, or 0 if
   * it is standing still. A cycle covers two tiles - left foot, right foot -
   * so the parity of the destination tile decides which leg is leading.
   */
  walkPhase(e) {
    if (e.ix === undefined || (e.ix === e.x && e.iy === e.y)) return 0;
    // which foot leads comes from a step counter, not tile parity: running
    // covers two tiles a tick, and parity would then never alternate
    const half = (e.steps || 0) % 2 ? 0.5 : 0;
    // nudged off zero so a phase of exactly 0 still reads as "walking"
    return half + Math.min(0.999, this.alpha) * 0.5 + 0.0001;
  }

  /**
   * Doors are told when they are open, not how far. Easing towards the target
   * here is what turns that into a swing rather than a jump cut.
   */
  doorAngle(o) {
    const want = o.open ? 1 : 0;
    if (o.anim === undefined) o.anim = want;
    // eased against the clock, not the frame: a 144 Hz monitor should not
    // open doors twice as fast as a 60 Hz one
    else o.anim += (want - o.anim) * Math.min(1, this.dt * 5);
    return o.anim;
  }

  /**
   * Swings arrive as a timestamp and are played out here, so the motion runs
   * at frame rate rather than stepping once per 600 ms server tick.
   * Returns 0 when nothing is happening, otherwise 0..1 through the swing.
   */
  swing(at) {
    if (!at) return 0;
    const t = (performance.now() - at) / SWING_MS;
    return t > 0 && t < 1 ? t : 0;
  }

  /** Rest, wind up, then follow through. Negative is drawn back. */
  swingAngle(t) {
    if (!t) return 0.25;
    return t < 0.3
      ? 0.25 - (t / 0.3) * 1.15
      : -0.9 + ((t - 0.3) / 0.7) * 1.15;
  }

  /** The arc a weapon leaves behind it, so an unarmed swing still reads. */
  slashArc(ctx, t, flip) {
    if (t < 0.3) return;
    const p = (t - 0.3) / 0.7;
    ctx.save();
    ctx.scale(flip, 1);
    ctx.globalAlpha = (1 - p) * 0.55;
    ctx.strokeStyle = '#f0e4d0';
    ctx.lineWidth = 2 - p;
    ctx.beginPath();
    ctx.arc(6, -2, 12, -1.1 + p * 1.6, 0.2 + p * 1.6);
    ctx.stroke();
    ctx.restore();
  }

  drawObject(o, state) {
    const d = OBJ[o.type];
    if (!d) return;
    const ctx = this.ctx, ts = this.ts;
    const s = this.tileToScreen(o.x, o.y);
    let cx = s.x + ts / 2, cy = s.y + ts / 2;
    const depleted = o.depleted > 0;

    // the node you are working shudders on every blow, and throws chips
    const worked = state && state.gatherNode &&
                   state.gatherNode.x === o.x && state.gatherNode.y === o.y;
    const hit = worked ? this.swing(state.player.swingAt) : 0;
    if (hit) cx += Math.sin(hit * 22) * (1 - hit) * 2.5;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(ts / TILE, ts / TILE);
    if (depleted) ctx.globalAlpha = 0.4;

    if (hit > 0.3 && !this.lowDetail) {
      const p = (hit - 0.3) / 0.7;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = d.c || '#c9a68e';
      for (let i = 0; i < 4; i++) {
        const a = -2.4 + i * 0.55;
        ctx.fillRect(Math.cos(a) * p * 16, Math.sin(a) * p * 14 + p * p * 10, 2, 2);
      }
      ctx.restore();
    }

    const sway = this.lowDetail ? 0 : Math.sin(this.time * 0.9 + o.x * 0.6 + o.y) * 0.03;

    switch (d.art) {
      case 'tree': {
        ctx.fillStyle = 'rgba(0,0,0,.28)';
        ctx.beginPath(); ctx.ellipse(0, 12, 12, 5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = d.c;
        ctx.fillRect(-3, -6, 6, 20);
        ctx.strokeStyle = shade(d.c, -50); ctx.lineWidth = 1; ctx.strokeRect(-3, -6, 6, 20);
        if (!depleted) {
          ctx.save(); ctx.rotate(sway);
          const leaf = d.leaf || '#a3707a';
          for (const [dx, dy, r] of [[-8, -14, 11], [8, -13, 10], [0, -22, 12]]) {
            ctx.beginPath(); ctx.arc(dx, dy, r, 0, 7);
            ctx.fillStyle = leaf; ctx.fill();
            ctx.strokeStyle = shade(leaf, -45); ctx.lineWidth = 1; ctx.stroke();
          }
          ctx.restore();
        } else {
          ctx.strokeStyle = shade(d.c, -30); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-2, -6); ctx.lineTo(-8, -14);
          ctx.moveTo(2, -6); ctx.lineTo(8, -13); ctx.stroke();
        }
        break;
      }
      case 'rock': {
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.beginPath(); ctx.ellipse(0, 9, 11, 4, 0, 0, 7); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-11, 8); ctx.lineTo(-7, -8); ctx.lineTo(4, -11);
        ctx.lineTo(12, 1); ctx.lineTo(9, 9); ctx.closePath();
        ctx.fillStyle = depleted ? '#514a48' : '#6b625e';
        ctx.fill();
        ctx.strokeStyle = '#3a3330'; ctx.lineWidth = 1; ctx.stroke();
        if (!depleted) {
          ctx.fillStyle = d.c;
          if (d.glow) { ctx.shadowColor = d.c; ctx.shadowBlur = 10; }
          for (const [dx, dy] of [[-4, -2], [3, -5], [6, 3], [-2, 5]]) {
            ctx.beginPath(); ctx.arc(dx, dy, 2.2, 0, 7); ctx.fill();
          }
        }
        break;
      }
      case 'bush': case 'fluffbush': {
        if (depleted) {
          ctx.fillStyle = '#4a3c3c';
          ctx.beginPath(); ctx.ellipse(0, 6, 8, 3.5, 0, 0, 7); ctx.fill();
        } else {
          ctx.save(); ctx.rotate(sway * 2);
          for (const [dx, dy, r] of [[-6, 4, 7], [6, 4, 6.5], [0, -2, 8]]) {
            ctx.beginPath(); ctx.arc(dx, dy, r, 0, 7);
            ctx.fillStyle = d.c; ctx.fill();
            ctx.strokeStyle = shade(d.c, -45); ctx.lineWidth = 1; ctx.stroke();
          }
          if (d.art === 'bush') {
            ctx.fillStyle = '#d4586b';
            for (const [dx, dy] of [[-4, 0], [4, 2], [1, -5]]) {
              ctx.beginPath(); ctx.arc(dx, dy, 1.8, 0, 7); ctx.fill();
            }
          }
          ctx.restore();
        }
        break;
      }
      case 'pool': {
        ctx.strokeStyle = 'rgba(230,240,230,.45)'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const r = 5 + i * 4 + (Math.sin(this.time * 1.6 + i) + 1) * 2;
          ctx.globalAlpha = (depleted ? 0.2 : 0.5) * (1 - i * 0.25);
          ctx.beginPath(); ctx.ellipse(0, 4, r, r * 0.42, 0, 0, 7); ctx.stroke();
        }
        ctx.globalAlpha = depleted ? 0.4 : 1;
        ctx.fillStyle = '#3a4a2a';
        ctx.beginPath(); ctx.ellipse(2, 2, 3, 1.6, 0.4, 0, 7); ctx.fill();
        break;
      }
      case 'cauldron': {
        ctx.fillStyle = '#2e262c';
        ctx.beginPath(); ctx.arc(0, 2, 11, 0, Math.PI); ctx.lineTo(-11, -4);
        ctx.lineTo(11, -4); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#5a4a52'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#6fd1a5';
        ctx.beginPath(); ctx.ellipse(0, -4, 9, 3.4, 0, 0, 7); ctx.fill();
        if (!this.lowDetail) {
          ctx.globalAlpha = 0.35;
          for (let i = 0; i < 3; i++) {
            const t = (this.time * 0.6 + i * 0.33) % 1;
            ctx.beginPath();
            ctx.arc(Math.sin(t * 6 + i) * 4, -6 - t * 14, 2.5 * (1 - t), 0, 7);
            ctx.fillStyle = '#9fe8c9'; ctx.fill();
          }
        }
        break;
      }
      case 'anvil': {
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.beginPath(); ctx.ellipse(0, 11, 12, 4, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#4a4448';
        ctx.fillRect(-4, 0, 8, 10);
        ctx.beginPath();
        ctx.moveTo(-12, -6); ctx.lineTo(10, -6); ctx.lineTo(14, -1);
        ctx.lineTo(8, 1); ctx.lineTo(-9, 1); ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#6b636a'; ctx.lineWidth = 1; ctx.stroke();
        break;
      }
      case 'furnace': {
        ctx.fillStyle = '#4a3a32';
        ctx.beginPath();
        ctx.moveTo(-13, 12); ctx.lineTo(-10, -12); ctx.lineTo(10, -12);
        ctx.lineTo(13, 12); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#63504a'; ctx.lineWidth = 1.2; ctx.stroke();
        const glow = 0.6 + Math.sin(this.time * 3) * 0.25;
        ctx.fillStyle = `rgba(255,${140 + glow * 60},60,${glow})`;
        ctx.shadowColor = '#ff8a2a'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.ellipse(0, 3, 6, 5, 0, 0, 7); ctx.fill();
        break;
      }
      case 'range': {
        ctx.fillStyle = '#5a4a42';
        ctx.fillRect(-12, -8, 24, 20);
        ctx.strokeStyle = '#7a675c'; ctx.lineWidth = 1.2; ctx.strokeRect(-12, -8, 24, 20);
        const g = 0.5 + Math.sin(this.time * 4) * 0.3;
        ctx.fillStyle = `rgba(255,${120 + g * 80},50,${g})`;
        ctx.fillRect(-8, 0, 16, 8);
        break;
      }
      case 'table': {
        ctx.fillStyle = '#8f6a4a';
        ctx.fillRect(-13, -6, 26, 8);
        ctx.fillStyle = '#6b4a2f';
        ctx.fillRect(-11, 2, 3, 10); ctx.fillRect(8, 2, 3, 10);
        ctx.fillStyle = '#e8dcc8';
        ctx.fillRect(-6, -10, 10, 4);
        break;
      }
      case 'booth': {
        ctx.fillStyle = '#4a3038';
        ctx.fillRect(-14, -10, 28, 22);
        ctx.fillStyle = '#6b4a52';
        ctx.fillRect(-14, -10, 28, 6);
        ctx.fillStyle = '#e0b357';
        ctx.fillRect(-10, -2, 20, 3);
        ctx.strokeStyle = '#2a1c22'; ctx.lineWidth = 1; ctx.strokeRect(-14, -10, 28, 22);
        break;
      }
      case 'altar': {
        ctx.fillStyle = '#7a7068';
        ctx.fillRect(-12, -6, 24, 14);
        ctx.fillStyle = '#8f857c';
        ctx.fillRect(-14, -9, 28, 4);
        for (const dx of [-8, 0, 8]) {
          ctx.fillStyle = '#e8dcc8';
          ctx.fillRect(dx - 1.5, -16, 3, 8);
          const f = 0.6 + Math.sin(this.time * 6 + dx) * 0.3;
          ctx.fillStyle = `rgba(255,200,90,${f})`;
          ctx.shadowColor = '#ffcc5a'; ctx.shadowBlur = 9;
          ctx.beginPath(); ctx.ellipse(dx, -19, 2, 3.6, 0, 0, 7); ctx.fill();
          ctx.shadowBlur = 0;
        }
        break;
      }
      case 'bed': {
        ctx.fillStyle = '#6b5a52';
        ctx.fillRect(-11, -13, 22, 26);
        ctx.fillStyle = '#c9bfae';
        ctx.fillRect(-10, -8, 20, 20);
        ctx.fillStyle = '#e8e0cd';
        ctx.fillRect(-8, -12, 16, 6);
        break;
      }
      case 'well': {
        ctx.fillStyle = '#6b625e';
        ctx.beginPath(); ctx.ellipse(0, 4, 13, 8, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#1a2a2a';
        ctx.beginPath(); ctx.ellipse(0, 3, 9, 5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#8f6a4a';
        ctx.fillRect(-11, -18, 3, 18); ctx.fillRect(8, -18, 3, 18);
        ctx.fillRect(-13, -22, 26, 5);
        break;
      }
      case 'sign': {
        ctx.fillStyle = '#6b4a2f';
        ctx.fillRect(-2, -4, 4, 16);
        ctx.fillStyle = '#c9b48f';
        ctx.fillRect(-12, -14, 24, 12);
        ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = 1.4; ctx.strokeRect(-12, -14, 24, 12);
        ctx.fillStyle = '#5a4636';
        for (let i = 0; i < 3; i++) ctx.fillRect(-8, -11 + i * 3.4, 16 - i * 3, 1.4);
        break;
      }
      case 'door': {
        // hinged on the left, swinging away from the corridor
        const a = this.doorAngle(o) * 1.5;
        ctx.fillStyle = '#4a3428';
        ctx.fillRect(-14, -15, 3, 30);           // the frame stays put
        ctx.save();
        ctx.translate(-12, 0);
        ctx.transform(Math.cos(a), 0, 0, 1, 0, 0);   // foreshorten as it swings
        ctx.fillStyle = '#7a5a42';
        ctx.fillRect(0, -14, 24, 28);
        ctx.strokeStyle = '#4a3428'; ctx.lineWidth = 1.5; ctx.strokeRect(0, -14, 24, 28);
        ctx.fillStyle = '#e0b357';
        ctx.beginPath(); ctx.arc(19, 2, 2, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
      case 'crate': {
        ctx.fillStyle = '#8f6a4a';
        ctx.fillRect(-11, -9, 22, 20);
        ctx.strokeStyle = '#5a4030'; ctx.lineWidth = 1.4;
        ctx.strokeRect(-11, -9, 22, 20);
        ctx.beginPath(); ctx.moveTo(-11, -9); ctx.lineTo(11, 11);
        ctx.moveTo(11, -9); ctx.lineTo(-11, 11); ctx.stroke();
        break;
      }
      case 'rubble': {
        ctx.fillStyle = '#5a4a4a';
        for (const [dx, dy, r] of [[-6, 4, 5], [4, 2, 6], [0, 7, 4], [7, 7, 3]]) {
          ctx.beginPath(); ctx.arc(dx, dy, r, 0, 7); ctx.fill();
        }
        ctx.strokeStyle = '#3a2e2e'; ctx.lineWidth = 1; ctx.stroke();
        break;
      }
      case 'brazier': {
        ctx.fillStyle = '#4a4048';
        ctx.fillRect(-2, 0, 4, 12);
        ctx.beginPath(); ctx.moveTo(-8, -2); ctx.lineTo(8, -2);
        ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill();
        const f = 0.55 + Math.sin(this.time * 7 + o.x) * 0.3;
        ctx.fillStyle = `rgba(255,${150 + f * 60},70,${f})`;
        ctx.shadowColor = '#ff9a3a'; ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(-5, -3); ctx.quadraticCurveTo(0, -16 - f * 5, 5, -3);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'grave': {
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.beginPath(); ctx.ellipse(0, 11, 9, 3.5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#8f857c';
        ctx.beginPath();
        ctx.moveTo(-7, 11); ctx.lineTo(-7, -6);
        ctx.arc(0, -6, 7, Math.PI, 0);
        ctx.lineTo(7, 11); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#66605a'; ctx.lineWidth = 1; ctx.stroke();
        break;
      }
      case 'gate': {
        const a = this.doorAngle(o) * 1.5;
        ctx.save();
        ctx.translate(-12, 0);
        ctx.transform(Math.cos(a), 0, 0, 1, 0, 0);
        ctx.strokeStyle = '#6b625e'; ctx.lineWidth = 2.4;
        for (let i = 0; i <= 2; i++) {
          ctx.beginPath(); ctx.moveTo(3 + i * 9, -14); ctx.lineTo(3 + i * 9, 14); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(24, -8); ctx.stroke();
        ctx.restore();
        break;
      }
      default:
        ctx.fillStyle = d.c || '#8f6a4a';
        ctx.fillRect(-8, -8, 16, 16);
    }
    ctx.restore();
  }

  /* ---------------- entities -------------------------------- */

  humanoid(ctx, sc, opts) {
    const { body = '#c9b48f', hat, face = '#e0c0a8', bob = 0, flip = 1, scale = 1,
            lunge = 0, step = 0 } = opts;
    ctx.save();
    ctx.scale(sc / TILE, sc / TILE);
    // a swing throws the weight forward and back again, pivoting on the feet
    if (lunge) {
      const push = Math.sin(lunge * Math.PI);
      ctx.translate(flip * push * 3.5, 0);
      ctx.rotate(flip * push * 0.16);
    }
    ctx.scale(scale * flip, scale);

    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(0, 13, 8, 3.5, 0, 0, 7); ctx.fill();

    /*
     * The walk: limbs swing in opposition about the hip and shoulder, and the
     * body rises on each stride. `step` is one full cycle over two tiles, so
     * the feet keep time with the tile the server actually moved us to.
     */
    const swing = step ? Math.sin(step * Math.PI * 2) : 0;
    const rise = step ? -Math.abs(Math.cos(step * Math.PI * 2)) * 0.8 : 0;

    ctx.translate(0, bob + rise);

    // legs, hinged at the hip
    ctx.fillStyle = shade(body, -45);
    for (const [lx, dir] of [[-5, 1], [1, -1]]) {
      ctx.save();
      ctx.translate(lx + 2, 4);
      if (swing) ctx.rotate(swing * dir * 0.5);
      ctx.fillRect(-2, 0, 4, 9);
      ctx.restore();
    }
    // torso
    ctx.beginPath();
    ctx.moveTo(-7, -5); ctx.lineTo(7, -5); ctx.lineTo(6, 6); ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fillStyle = body; ctx.fill();
    ctx.strokeStyle = shade(body, -50); ctx.lineWidth = 1; ctx.stroke();
    // arms, hinged at the shoulder and counter-swinging the legs
    ctx.fillStyle = shade(body, -18);
    for (const [ax, dir] of [[-9, -1], [6, 1]]) {
      ctx.save();
      ctx.translate(ax + 1.5, -3);
      if (swing) ctx.rotate(swing * dir * 0.45);
      ctx.fillRect(-1.5, 0, 3, 9);
      ctx.restore();
    }
    // head
    ctx.beginPath(); ctx.arc(0, -10, 5.4, 0, 7);
    ctx.fillStyle = face; ctx.fill();
    ctx.strokeStyle = shade(face, -55); ctx.lineWidth = 1; ctx.stroke();
    if (hat) {
      ctx.fillStyle = hat;
      ctx.beginPath();
      ctx.moveTo(-6, -12); ctx.lineTo(6, -12); ctx.lineTo(4, -17); ctx.lineTo(-4, -17);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  drawPlayer(state) {
    const ctx = this.ctx, ts = this.ts, p = state.player;
    const s = this.tileToScreen(p.rx, p.ry);
    ctx.save();
    ctx.translate(s.x + ts / 2, s.y + ts / 2);

    const eq = state.equipment;
    const t = this.swing(p.swingAt);
    // facing is a world direction, so turning the camera past a quarter turn
    // has to turn the sprite with it or everyone fights over their shoulder
    const flip = (p.facing < 0 ? -1 : 1) * (this.cos >= 0 ? 1 : -1);
    const step = t ? 0 : this.walkPhase(p);     // do not walk and swing at once
    const bob = 0;

    this.humanoid(ctx, ts, {
      body: eq.body ? (item(eq.body)?.art?.c || '#e8e0cd') : '#e8e0cd',
      hat: eq.head ? (item(eq.head)?.art?.c || null) : '#ffffff',
      bob, flip, lunge: t, step
    });

    ctx.save();
    ctx.scale(ts / TILE, ts / TILE);
    // the arc reads even bare-handed, which is how most nurses start
    if (t) this.slashArc(ctx, t, flip);

    if (eq.weapon) {
      ctx.translate(flip * 11, -2 + bob);
      ctx.rotate(flip * this.swingAngle(t));
      ctx.scale(0.7, 0.7);
      ctx.translate(-8, -8);
      drawArt(ctx, item(eq.weapon)?.art || { k: 'blade' }, 16);
    }
    ctx.restore();
    ctx.restore();

    this.nameTag(s.x + ts / 2, s.y - 4, state.name, '#7fbf8f');
    if (p.hp < p.maxHp) this.healthBar(s.x + ts / 2, s.y - 14, p.hp / p.maxHp);
    if (p.chat && p.chat.ttl > 0) this.chatBubble(s.x + ts / 2, s.y - 26, p.chat.text);
  }

  drawOther(o) {
    const ctx = this.ctx, ts = this.ts;
    const s = this.tileToScreen(o.rx, o.ry);
    ctx.save();
    ctx.translate(s.x + ts / 2, s.y + ts / 2);
    const t = this.swing(o.swingAt);
    this.humanoid(ctx, ts, { body: o.color || '#b8a68f', hat: '#ffffff',
      lunge: t, step: t ? 0 : this.walkPhase(o) });
    if (t) {
      ctx.save(); ctx.scale(ts / TILE, ts / TILE);
      this.slashArc(ctx, t, 1);
      ctx.restore();
    }
    ctx.restore();
    this.nameTag(s.x + ts / 2, s.y - 4, o.name, '#86b7e0');
    if (o.chat && o.chat.ttl > 0) this.chatBubble(s.x + ts / 2, s.y - 20, o.chat.text);
  }

  drawNpc(n, state) {
    const ctx = this.ctx, ts = this.ts;
    const d = NPCS[n.id];
    const s = this.tileToScreen(n.rx, n.ry);
    const scale = d.size > 1 ? 1.55 : 1;
    ctx.save();
    ctx.translate(s.x + ts / 2, s.y + ts / 2);
    if (n.hurtFlash > 0) { ctx.globalAlpha = 0.6; }

    /*
     * The lunge is applied out here rather than inside each art case, so
     * every monster in the game animates without twelve separate edits.
     */
    const t = this.swing(n.swingAt);
    const dir = this.screenDir(n.rx, n.ry, state.player.rx, state.player.ry);
    if (t) {
      const push = Math.sin(t * Math.PI);
      ctx.translate(dir * push * 4 * (ts / TILE), push * 1.5 * (ts / TILE));
      ctx.rotate(dir * push * 0.14);
    }

    const c = d.art.c || '#9a8878';
    const bob = n.path && n.path.length ? Math.sin(this.time * 10 + n.spawnX) * 1.1 : 0;

    switch (d.art.k) {
      case 'humanoid': case 'patient':
        this.humanoid(ctx, ts, { body: c, hat: d.art.hat, scale,
                                 bob: d.art.k === 'patient' ? bob : 0,
                                 step: t ? 0 : this.walkPhase(n) });
        if (d.art.k === 'patient') {
          ctx.save(); ctx.scale(ts / TILE, ts / TILE);
          ctx.fillStyle = '#e8e0cd'; ctx.fillRect(-9, -2, 18, 4);
          ctx.restore();
        }
        break;
      case 'rat': {
        ctx.save(); ctx.scale(ts / TILE, ts / TILE); ctx.translate(0, bob);
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.beginPath(); ctx.ellipse(0, 9, 9, 3, 0, 0, 7); ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(0, 3, 9, 5.5, 0, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(-8, 0, 4, 0, 7); ctx.fill();
        ctx.strokeStyle = shade(c, -45); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(9, 3); ctx.quadraticCurveTo(16, 1, 14, 8); ctx.stroke();
        ctx.fillStyle = '#d4586b';
        ctx.beginPath(); ctx.arc(-10, -1, 1.2, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
      case 'slug': {
        ctx.save(); ctx.scale(ts / TILE, ts / TILE);
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.beginPath(); ctx.ellipse(0, 9, 11, 3.5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(0, 3 + Math.sin(this.time * 3) * 0.8, 11, 6, 0, 0, 7);
        ctx.fill();
        ctx.strokeStyle = shade(c, -40); ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = shade(c, -30); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-7, -2); ctx.lineTo(-9, -8);
        ctx.moveTo(-3, -3); ctx.lineTo(-4, -9); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'sprite': {
        ctx.save(); ctx.scale(ts / TILE, ts / TILE);
        const pulse = 1 + Math.sin(this.time * 4) * 0.12;
        ctx.globalAlpha = 0.85;
        ctx.shadowColor = c; ctx.shadowBlur = 12;
        ctx.fillStyle = c;
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + this.time;
          const r = (7 + Math.sin(a * 3 + this.time * 2) * 3) * pulse;
          const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.9 - 2;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
        break;
      }
      case 'crawler': {
        ctx.save(); ctx.scale(ts / TILE, ts / TILE); ctx.scale(scale, scale);
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.beginPath(); ctx.ellipse(0, 10, 12, 4, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = shade(c, -30); ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const ph = Math.sin(this.time * 6 + i) * 3;
          ctx.beginPath();
          ctx.moveTo(-2, 1); ctx.lineTo(-12, 4 + ph); ctx.moveTo(2, 1); ctx.lineTo(12, 4 - ph);
          ctx.stroke();
        }
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(0, 0, 10, 7, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = shade(c, -50); ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#e0503f';
        ctx.beginPath(); ctx.arc(-3, -3, 1.6, 0, 7); ctx.arc(3, -3, 1.6, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
      case 'spinner': {
        ctx.save(); ctx.scale(ts / TILE, ts / TILE); ctx.scale(scale, scale);
        ctx.strokeStyle = shade(c, -25); ctx.lineWidth = 1.8;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const bend = Math.sin(this.time * 4 + i) * 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(Math.cos(a) * 9, Math.sin(a) * 9 + bend,
                               Math.cos(a) * 15, Math.sin(a) * 12 + 4);
          ctx.stroke();
        }
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(0, 0, 8, 7, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#e8dcc8';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath(); ctx.arc(-4 + i * 2.6, -3, 1, 0, 7); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'brute': case 'howler': case 'boss': {
        ctx.save(); ctx.scale(ts / TILE, ts / TILE); ctx.scale(scale, scale);
        ctx.translate(0, bob);
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.beginPath(); ctx.ellipse(0, 15, 12, 4.5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = shade(c, -35);
        ctx.fillRect(-7, 4, 5, 11); ctx.fillRect(2, 4, 5, 11);
        ctx.beginPath();
        ctx.moveTo(-11, -7); ctx.lineTo(11, -7); ctx.lineTo(9, 7); ctx.lineTo(-9, 7);
        ctx.closePath();
        ctx.fillStyle = c; ctx.fill();
        ctx.strokeStyle = shade(c, -55); ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = shade(c, -15);
        ctx.fillRect(-15, -6, 4, 13); ctx.fillRect(11, -6, 4, 13);
        ctx.beginPath(); ctx.arc(0, -13, 6.5, 0, 7);
        ctx.fillStyle = shade(c, 18); ctx.fill();
        ctx.fillStyle = '#ffdd55';
        if (d.art.k === 'boss') { ctx.shadowColor = '#ff5555'; ctx.shadowBlur = 12; }
        ctx.beginPath(); ctx.arc(-2.5, -14, 1.5, 0, 7); ctx.arc(2.5, -14, 1.5, 0, 7); ctx.fill();
        if (d.art.k === 'howler') {
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#1a0a10';
          ctx.beginPath(); ctx.ellipse(0, -10, 3, 4.5, 0, 0, 7); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'monk': {
        ctx.save(); ctx.scale(ts / TILE, ts / TILE); ctx.translate(0, bob);
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.beginPath(); ctx.ellipse(0, 13, 9, 4, 0, 0, 7); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-8, -8); ctx.lineTo(8, -8); ctx.lineTo(10, 13); ctx.lineTo(-10, 13);
        ctx.closePath();
        ctx.fillStyle = c; ctx.fill();
        ctx.strokeStyle = shade(c, -45); ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -11, 6, Math.PI, 0);
        ctx.lineTo(6, -5); ctx.lineTo(-6, -5); ctx.closePath();
        ctx.fillStyle = shade(c, -25); ctx.fill();
        ctx.fillStyle = '#0a0508';
        ctx.beginPath(); ctx.ellipse(0, -9, 4, 3.4, 0, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
      default:
        this.humanoid(ctx, ts, { body: c, bob, scale });
    }
    if (t) {
      ctx.save(); ctx.scale(ts / TILE, ts / TILE);
      this.slashArc(ctx, t, dir);
      ctx.restore();
    }
    ctx.restore();

    const showBar = n.hp < n.maxHp || state.target?.ref === n;
    if (showBar) this.healthBar(s.x + ts / 2, s.y - 8, n.hp / n.maxHp);
    if (!d.hostile) this.nameTag(s.x + ts / 2, s.y - 2, d.name, '#e0b357');
  }

  /* ---------------- overlays -------------------------------- */

  nameTag(x, y, text, col) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '600 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = col;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  healthBar(x, y, frac) {
    const ctx = this.ctx, w = 28, h = 4;
    ctx.save();
    ctx.fillStyle = '#3a0d14';
    ctx.fillRect(x - w / 2, y, w, h);
    ctx.fillStyle = frac > 0.5 ? '#6fd1a5' : frac > 0.2 ? '#e0b357' : '#e0503f';
    ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), h);
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2 + .5, y + .5, w - 1, h - 1);
    ctx.restore();
  }

  chatBubble(x, y, raw) {
    const ctx = this.ctx;
    const { colour, motion, text } = parseChat(raw);
    if (!text) return;

    ctx.save();
    ctx.font = '11px "Trebuchet MS", sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(20,10,16,.85)';
    ctx.strokeStyle = '#6b3d4c'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 15, w, 17, 4);
    ctx.fill(); ctx.stroke();

    if (!colour && !motion) {
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(text, x, y - 3);
      ctx.restore();
      return;
    }

    /*
     * Per character, so a wave can travel along the word and a rainbow can
     * run through it. Laid out left to right rather than centred, because
     * each glyph is placed individually.
     */
    ctx.textAlign = 'left';
    const t = this.time;
    let px = x - (w - 12) / 2;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const off = charOffset(motion, i, t);
      ctx.fillStyle = charColour(colour, i, t) || '#fff';
      ctx.fillText(ch, px + off.dx, y - 3 + off.dy);
      px += ctx.measureText(ch).width;
    }
    ctx.restore();
  }

  drawHitsplat(h) {
    const ctx = this.ctx, ts = this.ts;
    const s = this.tileToScreen(h.x, h.y);
    const t = 1 - h.ttl / 30;
    const cx = s.x + ts / 2 + (h.off || 0);
    const cy = s.y + ts * 0.4 - t * 12;
    ctx.save();
    ctx.globalAlpha = clamp(h.ttl / 12, 0, 1);
    const col = h.dmg === 0 ? '#4a6b8f' : h.crit ? '#e0b357' : h.self ? '#e0503f' : '#a0202a';
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(h.dmg), cx, cy + 0.5);
    ctx.restore();
  }

  drawFloater(f) {
    const ctx = this.ctx, ts = this.ts;
    const s = this.tileToScreen(f.x, f.y);
    const t = 1 - f.ttl / 60;
    ctx.save();
    ctx.globalAlpha = clamp(f.ttl / 25, 0, 1);
    ctx.font = '700 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
    const y = s.y - t * 30;
    ctx.strokeText(f.text, s.x + ts / 2, y);
    ctx.fillStyle = f.color || '#e0b357';
    ctx.fillText(f.text, s.x + ts / 2, y);
    ctx.restore();
  }
}

/* ============================================================
   The world map
   ------------------------------------------------------------
   The whole Throat at once, which the dial in the corner cannot
   show you: it holds about forty tiles and the map is a hundred
   and ninety square, so anywhere you have not been is somewhere
   you have to be told about.

   It is a reading tool, not a travel one. You cannot click it
   to walk somewhere - the ward is too big to path across in one
   go, and RuneScape's map does not either. What it is for is
   knowing which way the bank is.
   ============================================================ */

import { REGIONS } from '../data/world.js';
import { NPCS } from '../data/npcs.js';
import { clamp } from '../util.js';
import { terrainImage, landmarks } from '../engine/mapimage.js';

const MIN_ZOOM = 2, MAX_ZOOM = 14;

export class WorldMap {
  constructor(state, world) {
    this.state = state;
    this.world = world;
    this.el = null;
    this.zoom = 4;                      // pixels per tile
    this.cx = 0; this.cy = 0;           // the tile in the middle of the view
    this.raf = 0;
  }

  get open() { return !!this.el; }

  toggle() { this.open ? this.close() : this.show(); }

  show() {
    if (this.el) return;
    const p = this.state.player;
    this.cx = p.x; this.cy = p.y;

    const wrap = document.createElement('div');
    wrap.id = 'worldmap';
    wrap.innerHTML =
      '<div class="wm-panel">' +
        '<div class="wm-head">' +
          '<div class="wm-title">The Throat</div>' +
          '<div class="wm-where"></div>' +
          '<button class="wm-close" title="Close (M)">×</button>' +
        '</div>' +
        '<canvas class="wm-canvas"></canvas>' +
        '<div class="wm-foot">' +
          '<span class="wm-hint">Drag to move · wheel to zoom · <b>M</b> or Escape to close</span>' +
          '<button class="wm-centre">Find me</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    this.el = wrap;

    this.canvas = wrap.querySelector('.wm-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.where = wrap.querySelector('.wm-where');

    wrap.querySelector('.wm-close').addEventListener('click', () => this.close());
    wrap.querySelector('.wm-centre').addEventListener('click', () => {
      this.cx = this.state.player.x; this.cy = this.state.player.y;
    });
    // clicking the darkness outside the panel closes it, like every other window
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) this.close(); });

    this.wireDrag();

    // only Escape. M is toggled by the one handler in main.js, so that
    // pressing it while the map is open does not close and reopen it
    this.onKey = e => {
      if (e.key === 'Escape') { this.close(); e.preventDefault(); }
    };
    window.addEventListener('keydown', this.onKey);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);

    this.resize();
    this.loop();
  }

  close() {
    if (!this.el) return;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    this.el.remove();
    this.el = null;
  }

  wireDrag() {
    const c = this.canvas;
    let id = 0, lx = 0, ly = 0;

    c.addEventListener('pointerdown', e => {
      id = e.pointerId; lx = e.clientX; ly = e.clientY;
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', e => {
      if (id !== e.pointerId) return;
      // dragging moves the paper under the window, so the map follows the hand
      this.cx -= (e.clientX - lx) / this.zoom;
      this.cy -= (e.clientY - ly) / this.zoom;
      lx = e.clientX; ly = e.clientY;
      this.clampCentre();
    });
    const end = e => {
      if (id !== e.pointerId) return;
      id = 0;
      c.classList.remove('dragging');
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('wheel', e => {
      e.preventDefault();
      /*
       * Zoom about the cursor rather than the middle, so the thing you are
       * pointing at stays under the pointer. Anything else means hunting for
       * where the place you were looking at went.
       */
      const r = c.getBoundingClientRect();
      const px = e.clientX - r.left - this.vw / 2;
      const py = e.clientY - r.top - this.vh / 2;
      const before = this.zoom;
      const next = clamp(this.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18), MIN_ZOOM, MAX_ZOOM);
      if (next === before) return;
      this.cx += px / before - px / next;
      this.cy += py / before - py / next;
      this.zoom = next;
      this.clampCentre();
    }, { passive: false });
  }

  clampCentre() {
    const halfW = this.vw / 2 / this.zoom, halfH = this.vh / 2 / this.zoom;
    const w = this.world.w, h = this.world.h;
    // never scroll past the edge, unless the whole map already fits
    this.cx = w > halfW * 2 ? clamp(this.cx, halfW, w - halfW) : w / 2;
    this.cy = h > halfH * 2 ? clamp(this.cy, halfH, h - halfH) : h / 2;
  }

  resize() {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.vw = Math.max(1, r.width);
    this.vh = Math.max(1, r.height);
    this.canvas.width = Math.floor(this.vw * dpr);
    this.canvas.height = Math.floor(this.vh * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.clampCentre();
  }

  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    this.draw();
  }

  /** Tile to pixel, in the canvas's own coordinates. */
  toPx(tx, ty) {
    return { x: (tx - this.cx) * this.zoom + this.vw / 2,
             y: (ty - this.cy) * this.zoom + this.vh / 2 };
  }

  draw() {
    const ctx = this.ctx;
    const p = this.state.player;
    ctx.clearRect(0, 0, this.vw, this.vh);
    ctx.fillStyle = '#0c0508';
    ctx.fillRect(0, 0, this.vw, this.vh);

    /* the ground */
    const o = this.toPx(0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrainImage(this.world),
                  o.x, o.y, this.world.w * this.zoom, this.world.h * this.zoom);

    this.drawRegions();
    this.drawLandmarks();
    this.drawLiving();

    /* you, pulsing, so you can find yourself on a map this size */
    const me = this.toPx(p.rx + 0.5, p.ry + 0.5);
    const beat = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    ctx.beginPath();
    ctx.arc(me.x, me.y, 5 + beat * 4, 0, 7);
    ctx.fillStyle = `rgba(255,255,255,${0.10 + beat * 0.16})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(me.x, me.y, 4, 0, 7);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1d1216'; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();

    const region = this.world.regionAt(p.x, p.y);
    this.where.textContent = `${region ? region.name : 'Nowhere in particular'} — ${p.x}, ${p.y}`;
  }

  drawRegions() {
    const ctx = this.ctx;
    ctx.save();
    for (const r of REGIONS) {
      const a = this.toPx(r.x, r.y), b = this.toPx(r.x + r.w, r.y + r.h);
      if (b.x < 0 || b.y < 0 || a.x > this.vw || a.y > this.vh) continue;
      ctx.strokeStyle = 'rgba(230,200,150,.20)';
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x + .5, a.y + .5, b.x - a.x, b.y - a.y);

      // the name sits in the middle of whatever part of it you can see, so a
      // region you are half-way into is still labelled
      const mx = clamp((a.x + b.x) / 2, 60, this.vw - 60);
      const my = clamp((a.y + b.y) / 2, 20, this.vh - 20);
      ctx.font = '600 13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(12,5,8,.85)';
      ctx.strokeText(r.name, mx, my);
      ctx.fillStyle = r.safe ? '#d8cdb4' : '#c9a3a3';
      ctx.fillText(r.name, mx, my);
    }
    ctx.restore();
  }

  drawLandmarks() {
    const ctx = this.ctx;
    const show = this.zoom >= 3.4;             // below that they are a rash of dots
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 10px "Trebuchet MS", sans-serif';
    for (const m of landmarks(this.world)) {
      const s = this.toPx(m.x + 0.5, m.y + 0.5);
      if (s.x < -40 || s.y < -40 || s.x > this.vw + 40 || s.y > this.vh + 40) continue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3.5, 0, 7);
      ctx.fillStyle = m.colour;
      ctx.strokeStyle = 'rgba(12,5,8,.9)'; ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();
      if (show) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(12,5,8,.85)';
        ctx.strokeText(m.label, s.x, s.y - 7);
        ctx.fillStyle = '#e8dcc8';
        ctx.fillText(m.label, s.x, s.y - 7);
      }
    }
    ctx.restore();
  }

  /** Whoever is near enough for the snapshot to have mentioned them. */
  drawLiving() {
    const ctx = this.ctx;
    const dot = (tx, ty, col, r) => {
      const s = this.toPx(tx + 0.5, ty + 0.5);
      if (s.x < -10 || s.y < -10 || s.x > this.vw + 10 || s.y > this.vh + 10) return;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, 7);
      ctx.fillStyle = col;
      ctx.fill();
    };
    for (const n of this.state.npcs) {
      if (n.dead) continue;
      dot(n.rx, n.ry, NPCS[n.id]?.hostile ? '#e0503f' : '#e0b357', 2.4);
    }
    for (const o of this.state.others.values()) dot(o.rx, o.ry, '#86b7e0', 3);
  }
}

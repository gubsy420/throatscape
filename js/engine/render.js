/* ============================================================
   World renderer - terrain chunks, scenery, entities, effects
   ============================================================ */

import { TILE, hash2, clamp, lerp, mix, shade } from '../util.js';
import { TILE_INFO, T, OBJ } from '../data/world.js';
import { NPCS } from '../data/npcs.js';
import { drawArt } from './icons.js';
import { item } from '../data/items.js';

const CHUNK = 16;

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cam = { x: 0, y: 0 };
    this.zoom = 1;
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

  get ts() { return TILE * this.zoom; }

  /** Screen pixel -> world tile. */
  screenToTile(px, py) {
    const ts = this.ts;
    return {
      x: Math.floor((px + this.cam.x) / ts),
      y: Math.floor((py + this.cam.y) / ts)
    };
  }

  /** World tile -> screen pixel (top-left of the tile). */
  tileToScreen(tx, ty) {
    const ts = this.ts;
    return { x: tx * ts - this.cam.x, y: ty * ts - this.cam.y };
  }

  centerOn(px, py, snap = false) {
    const tx = px * this.ts - this.vw / 2;
    const ty = py * this.ts - this.vh / 2;
    if (snap) { this.cam.x = tx; this.cam.y = ty; }
    else {
      this.cam.x = lerp(this.cam.x, tx, 0.18);
      this.cam.y = lerp(this.cam.y, ty, 0.18);
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

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#07050a';
    ctx.fillRect(0, 0, this.vw, this.vh);

    const p = state.player;
    const px = p.rx, py = p.ry;
    this.centerOn(px + 0.5, py + 0.5, state.snapCam);
    state.snapCam = false;

    const x0 = Math.floor(this.cam.x / ts) - 1;
    const y0 = Math.floor(this.cam.y / ts) - 1;
    const x1 = x0 + Math.ceil(this.vw / ts) + 3;
    const y1 = y0 + Math.ceil(this.vh / ts) + 3;

    /* terrain */
    const c0 = Math.floor(x0 / CHUNK), c1 = Math.floor(x1 / CHUNK);
    const r0 = Math.floor(y0 / CHUNK), r1 = Math.floor(y1 / CHUNK);
    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (cx < 0 || cy < 0) continue;
        const img = this.chunkCanvas(cx, cy);
        ctx.drawImage(img,
          Math.round(cx * CHUNK * TILE - this.cam.x / this.zoom),
          Math.round(cy * CHUNK * TILE - this.cam.y / this.zoom));
      }
    }
    ctx.restore();

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
      list.push({ y: o.y, kind: 'obj', o });
    }
    for (const n of state.npcs) {
      if (n.dead) continue;
      if (n.rx < x0 - 1 || n.rx > x1 || n.ry < y0 - 1 || n.ry > y1) continue;
      list.push({ y: n.ry, kind: 'npc', n });
    }
    for (const o of state.others.values()) {
      if (o.rx < x0 - 1 || o.rx > x1 || o.ry < y0 - 1 || o.ry > y1) continue;
      list.push({ y: o.ry, kind: 'other', o });
    }
    list.push({ y: py, kind: 'player', p });
    list.sort((a, b) => a.y - b.y);

    /* selection ring under the current target */
    if (state.target && state.target.kind === 'npc' && !state.target.ref.dead) {
      this.ring(state.target.ref.rx, state.target.ref.ry, '#d4586b');
    }
    if (state.hoverObj) this.tileOutline(state.hoverObj.x, state.hoverObj.y, 'rgba(224,179,87,.55)');
    if (state.moveMarker && state.moveMarker.ttl > 0) this.moveMarker(state.moveMarker);

    for (const e of list) {
      if (e.kind === 'obj') this.drawObject(e.o);
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
      const g = ctx.createRadialGradient(this.vw / 2, this.vh / 2, ts * 3,
                                         this.vw / 2, this.vh / 2, ts * 11);
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

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.minimapBase(),
      p.rx - span / 2, p.ry - span / 2, span, span,
      cx - size / 2, cy - size / 2, size, size
    );

    const dot = (wx, wy, col, r = 2) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx + (wx - p.rx) * scale, cy + (wy - p.ry) * scale, r, 0, 7);
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
  }

  drawBileShimmer(x0, y0, x1, y1) {
    if (this.lowDetail) return;
    const ctx = this.ctx, ts = this.ts, w = this.world;
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (w.tileAt(x, y) !== T.BILE) continue;
        const s = this.tileToScreen(x, y);
        const ph = this.time * 1.4 + (x * 0.7 + y * 1.1);
        const a = (Math.sin(ph) + 1) / 2;
        ctx.fillStyle = a > 0.5 ? '#a3c98f' : '#4a5a2f';
        ctx.fillRect(s.x, s.y + ts * (0.3 + a * 0.4), ts, 2);
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
    ctx.ellipse(s.x + ts / 2, s.y + ts * 0.82, ts * 0.36, ts * 0.16, 0, 0, 7);
    ctx.stroke();
    ctx.restore();
  }

  tileOutline(tx, ty, col) {
    const ctx = this.ctx, ts = this.ts;
    const s = this.tileToScreen(tx, ty);
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.strokeRect(s.x + 1, s.y + 1, ts - 2, ts - 2);
    ctx.restore();
  }

  moveMarker(m) {
    const ctx = this.ctx, ts = this.ts;
    const s = this.tileToScreen(m.x, m.y);
    const t = 1 - m.ttl / 24;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = '#e8dcc8'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x + ts / 2, s.y + ts / 2, ts * 0.15 + t * ts * 0.3, 0, 7);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- scenery --------------------------------- */

  drawObject(o) {
    const d = OBJ[o.type];
    if (!d) return;
    const ctx = this.ctx, ts = this.ts;
    const s = this.tileToScreen(o.x, o.y);
    const cx = s.x + ts / 2, cy = s.y + ts / 2;
    const depleted = o.depleted > 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(ts / TILE, ts / TILE);
    if (depleted) ctx.globalAlpha = 0.4;

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
        ctx.fillStyle = o.open ? 'rgba(90,60,50,.35)' : '#7a5a42';
        if (o.open) {
          ctx.fillRect(-14, -14, 6, 28);
        } else {
          ctx.fillRect(-13, -14, 26, 28);
          ctx.strokeStyle = '#4a3428'; ctx.lineWidth = 1.5; ctx.strokeRect(-13, -14, 26, 28);
          ctx.fillStyle = '#e0b357';
          ctx.beginPath(); ctx.arc(8, 2, 2, 0, 7); ctx.fill();
        }
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
        ctx.strokeStyle = '#6b625e'; ctx.lineWidth = 2.4;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.moveTo(i * 7, -14); ctx.lineTo(i * 7, 14); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(-12, -8); ctx.lineTo(12, -8); ctx.stroke();
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
    const { body = '#c9b48f', hat, face = '#e0c0a8', bob = 0, flip = 1, scale = 1 } = opts;
    ctx.save();
    ctx.scale(sc / TILE, sc / TILE);
    ctx.scale(scale * flip, scale);

    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(0, 13, 8, 3.5, 0, 0, 7); ctx.fill();

    ctx.translate(0, bob);
    // legs
    ctx.fillStyle = shade(body, -45);
    ctx.fillRect(-5, 4, 4, 9); ctx.fillRect(1, 4, 4, 9);
    // torso
    ctx.beginPath();
    ctx.moveTo(-7, -5); ctx.lineTo(7, -5); ctx.lineTo(6, 6); ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fillStyle = body; ctx.fill();
    ctx.strokeStyle = shade(body, -50); ctx.lineWidth = 1; ctx.stroke();
    // arms
    ctx.fillStyle = shade(body, -18);
    ctx.fillRect(-9, -4, 3, 9); ctx.fillRect(6, -4, 3, 9);
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

    const moving = p.path.length > 0;
    const bob = moving ? Math.sin(this.time * 12) * 1.2 : 0;
    const eq = state.equipment;

    this.humanoid(ctx, ts, {
      body: eq.body ? (item(eq.body)?.art?.c || '#e8e0cd') : '#e8e0cd',
      hat: eq.head ? (item(eq.head)?.art?.c || null) : '#ffffff',
      bob, flip: p.facing < 0 ? -1 : 1
    });

    // held weapon
    if (eq.weapon) {
      ctx.save();
      ctx.scale(ts / TILE, ts / TILE);
      ctx.translate(p.facing < 0 ? -11 : 11, -2 + bob);
      const sw = p.attackAnim > 0 ? -0.9 + p.attackAnim * 0.12 : 0.25;
      ctx.rotate((p.facing < 0 ? -1 : 1) * sw);
      ctx.scale(0.7, 0.7);
      ctx.translate(-8, -8);
      drawArt(ctx, item(eq.weapon)?.art || { k: 'blade' }, 16);
      ctx.restore();
    }
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
    this.humanoid(ctx, ts, { body: o.color || '#b8a68f', hat: '#ffffff',
      bob: o.moving ? Math.sin(this.time * 12 + o.rx) * 1.2 : 0 });
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

    const c = d.art.c || '#9a8878';
    const bob = n.path && n.path.length ? Math.sin(this.time * 10 + n.spawnX) * 1.1 : 0;

    switch (d.art.k) {
      case 'humanoid': case 'patient':
        this.humanoid(ctx, ts, { body: c, hat: d.art.hat, bob, scale });
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

  chatBubble(x, y, text) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '11px "Trebuchet MS", sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(20,10,16,.85)';
    ctx.strokeStyle = '#6b3d4c'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 15, w, 17, 4);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y - 3);
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

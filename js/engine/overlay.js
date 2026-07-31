/* ============================================================
   The flat layer over the world
   ------------------------------------------------------------
   Names, health bars, chat, hitsplats and the minimap. All of
   it is drawn on a 2D canvas sitting on top of the scene, and
   positioned by asking the camera where a world point lands on
   screen.

   Keeping the interface flat is not a compromise. Text pinned
   to a billboard in the scene would swim as the camera turned
   and blur as it came close; text drawn here is pixel-sharp at
   every angle, and it is how the games this one is modelled on
   did it.
   ============================================================ */

import { clamp, hash2 } from '../util.js';
import { TILE_INFO, T, OBJ } from '../data/world.js';
import { NPCS } from '../data/npcs.js';
import { parseChat, charColour, charOffset } from '../game/chatfx.js';

export class Overlay {
  constructor(r) {
    this.r = r;                         // the renderer that owns us
    this.ctx = r.ctx;
    this._mm = null;
  }

  get world() { return this.r.world; }
  get vw() { return this.r.vw; }
  get vh() { return this.r.vh; }

  /** Where a creature's head is, in screen pixels. */
  head(x, z, height) {
    const y = this.r.terrain.heightAt(x, z) + height;
    return this.r.cam.toScreen(x, y, z, this.vw, this.vh);
  }

  draw(state) {
    const ctx = this.ctx;
    ctx.setTransform(this.r.dpr, 0, 0, this.r.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    ctx.textBaseline = 'alphabetic';

    const p = state.player;

    /*
     * Everything gets a depth, and the far things are drawn first, so a
     * label from across the square cannot land on top of the nurse standing
     * in front of you.
     */
    const labels = [];
    const push = (s, fn) => { if (s.visible) labels.push({ d: s.depth, s, fn }); };

    for (const n of state.npcs) {
      if (n.dead) continue;
      const d = NPCS[n.id];
      if (!d) continue;
      const size = d.size || 1;
      const m = this.r.creatures.get(d.art);
      const s = this.head(n.rx + size / 2, n.ry + size / 2, m.height * (size > 1 ? 1.5 : 1) + 0.18);
      push(s, () => {
        const showBar = n.hp !== undefined && n.maxHp && n.hp < n.maxHp;
        if (showBar) this.healthBar(s.x, s.y - 8, n.hp / n.maxHp);
        if (!d.hostile) this.nameTag(s.x, s.y, d.name, '#e0b357');
        if (n.chat && n.chat.ttl > 0) this.chatBubble(s.x, s.y - (showBar ? 20 : 12), n.chat.text);
      });
    }

    for (const o of state.others.values()) {
      const s = this.head(o.rx + 0.5, o.ry + 0.5, 1.48);
      push(s, () => {
        this.nameTag(s.x, s.y, o.name, '#86b7e0');
        if (o.chat && o.chat.ttl > 0) this.chatBubble(s.x, s.y - 14, o.chat.text);
      });
    }

    {
      const s = this.head(p.rx + 0.5, p.ry + 0.5, 1.48);
      push(s, () => {
        if (p.hp < p.maxHp) this.healthBar(s.x, s.y - 10, p.hp / p.maxHp);
        this.nameTag(s.x, s.y, state.name, '#7fbf8f');
        if (p.chat && p.chat.ttl > 0) this.chatBubble(s.x, s.y - (p.hp < p.maxHp ? 22 : 14), p.chat.text);
      });
    }

    labels.sort((a, b) => b.d - a.d);
    for (const l of labels) l.fn();

    for (const h of state.hitsplats) this.hitsplat(h);
    for (const f of state.floaters) this.floater(f);

    this.minimap(state);
  }

  /* ---------------- tags ------------------------------------ */

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

    ctx.textAlign = 'left';
    const t = this.r.time;
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

  hitsplat(h) {
    const s = this.head(h.x + 0.5, h.y + 0.5, 0.8);
    if (!s.visible) return;
    const ctx = this.ctx;
    const t = 1 - h.ttl / 30;
    const cx = s.x + (h.off || 0), cy = s.y - t * 12;
    ctx.save();
    ctx.globalAlpha = clamp(h.ttl / 12, 0, 1);
    ctx.fillStyle = h.dmg === 0 ? '#4a6b8f' : h.crit ? '#e0b357' : h.self ? '#e0503f' : '#a0202a';
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(h.dmg), cx, cy + 0.5);
    ctx.restore();
  }

  floater(f) {
    const s = this.head(f.x + 0.5, f.y + 0.5, 1.5);
    if (!s.visible) return;
    const ctx = this.ctx;
    const t = 1 - f.ttl / 60;
    ctx.save();
    ctx.globalAlpha = clamp(f.ttl / 25, 0, 1);
    ctx.font = '700 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
    const y = s.y - t * 30;
    ctx.strokeText(f.text, s.x, y);
    ctx.fillStyle = f.color || '#e0b357';
    ctx.fillText(f.text, s.x, y);
    ctx.restore();
  }

  /* ---------------- minimap --------------------------------- */

  /** One pixel per tile, built once. */
  base() {
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
    for (const o of w.objects) {
      const d = OBJ[o.type];
      g.fillStyle = d.skill ? 'rgba(20,40,20,.55)' : 'rgba(230,200,120,.75)';
      g.fillRect(o.x, o.y, 1, 1);
    }
    this._mm = c;
    return c;
  }

  minimap(state) {
    const ctx = this.ctx;
    const size = this.vw < 700 ? 104 : 138;
    const pad = 10;
    const cx = this.vw - size / 2 - pad;
    const cy = this.vh - size / 2 - pad;
    const scale = 2;
    const p = state.player;
    const yaw = this.r.cam.yaw;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, 7);
    ctx.fillStyle = '#0c0508';
    ctx.fill();
    ctx.clip();

    /*
     * The dial turns with the camera, so the way you are looking is up. The
     * crop is half again as wide as the dial, because a square rotated inside
     * a circle has to cover the corners it sweeps through.
     */
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(yaw);
    const crop = (size / scale) * 1.5, out = size * 1.5;
    ctx.drawImage(this.base(),
      p.rx - crop / 2, p.ry - crop / 2, crop, crop,
      -out / 2, -out / 2, out, out);
    ctx.restore();

    const dot = (wx, wy, col, r = 2) => {
      const dx = (wx - p.rx) * scale, dy = (wy - p.ry) * scale;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos, r, 0, 7);
      ctx.fill();
    };

    const span = size / scale;
    for (const g of state.ground) dot(g.x, g.y, '#e8dcc8', 1.4);
    for (const n of state.npcs) {
      if (n.dead) continue;
      if (Math.abs(n.x - p.x) > span || Math.abs(n.y - p.y) > span) continue;
      dot(n.rx, n.ry, NPCS[n.id]?.hostile ? '#e0503f' : '#e0b357');
    }
    for (const o of state.others.values()) dot(o.rx, o.ry, '#86b7e0', 2.4);

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

    this.compass(cx, cy, size / 2, yaw, cos, sin);
  }

  /**
   * The needle rides the rim and points north, so a turned camera is
   * something you can see rather than something you have to remember.
   * Clicking it faces you north again.
   */
  compass(cx, cy, r, yaw, cos, sin) {
    const ctx = this.ctx;
    const nx = cx - sin * r, ny = cy - cos * r;
    this.r.compass = { x: nx, y: ny, r: 13 };

    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(yaw);
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7);
    ctx.fillStyle = 'rgba(12,5,8,.9)'; ctx.fill();
    ctx.strokeStyle = '#6b3d4c'; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(3.4, 1); ctx.lineTo(-3.4, 1);
    ctx.closePath(); ctx.fillStyle = '#d4586b'; ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, 7); ctx.lineTo(3.4, 1); ctx.lineTo(-3.4, 1);
    ctx.closePath(); ctx.fillStyle = '#8c7f6a'; ctx.fill();
    ctx.restore();
  }
}

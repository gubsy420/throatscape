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
import { drawMark, markPhase } from './clickmark.js';
import { minimapImage } from './mapimage.js';

/*
 * What floats over a head, and how tall each piece of it is. The stack is
 * built from these rather than from guessed offsets, which is what stopped
 * a name sitting on top of its own health bar.
 */
export const BAR_H = 4;      // the health bar's box
export const GAP = 7;        // clearance between pieces
export const TEXT_H = 11;    // a name, with its descenders

/**
 * Lays out the things above one creature, from the head upwards. Returns the
 * y of each piece, or null for the ones it does not have: the bar's top edge,
 * the name's baseline, and the chat bubble's anchor.
 */
export function labelStack(headY, { bar = false, name = false, chat = false } = {}) {
  const out = { bar: null, name: null, chat: null };
  let y = headY;
  if (bar) { out.bar = y - BAR_H; y -= BAR_H + GAP; }
  if (name) { out.name = y; y -= TEXT_H; }
  if (chat) out.chat = y - GAP;
  return out;
}

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

    this.clickMark(state);

    /*
     * Everything that floats over somebody's head is collected first, laid
     * out, and then drawn in two passes.
     *
     * The layout stacks upward from the head with the real heights of the
     * things being stacked, so a name can never sit on its own health bar.
     * The two passes are because a name can still land on somebody *else's*
     * bar in a crowd - so every name in the scene is drawn before any bar
     * is, and a bar is the one thing that cannot end up hidden.
     */
    const tags = [];

    const add = (s, { name, colour, frac = null, chat = null }) => {
      if (!s.visible) return;
      const at = labelStack(s.y, { bar: frac !== null, name: !!name, chat: !!chat });
      tags.push({
        d: s.depth,
        bar: at.bar === null ? null : { x: s.x, y: at.bar, frac },
        tag: at.name === null ? null : { x: s.x, y: at.name, text: name, colour },
        chat: at.chat === null ? null : { x: s.x, y: at.chat, text: chat }
      });
    };

    for (const n of state.npcs) {
      if (n.dead) continue;
      const d = NPCS[n.id];
      if (!d) continue;
      const size = d.size || 1;
      const m = this.r.creatures.get(d.art);
      const s = this.head(n.rx + size / 2, n.ry + size / 2, m.height * (size > 1 ? 1.5 : 1) + 0.18);
      add(s, {
        name: d.hostile ? null : d.name,
        colour: '#e0b357',
        frac: n.hp !== undefined && n.maxHp && n.hp < n.maxHp ? n.hp / n.maxHp : null,
        chat: n.chat && n.chat.ttl > 0 ? n.chat.text : null
      });
    }

    for (const o of state.others.values()) {
      add(this.head(o.rx + 0.5, o.ry + 0.5, 1.48), {
        name: o.name, colour: '#86b7e0',
        frac: o.hp !== undefined && o.maxHp && o.hp < o.maxHp ? o.hp / o.maxHp : null,
        chat: o.chat && o.chat.ttl > 0 ? o.chat.text : null
      });
    }

    add(this.head(p.rx + 0.5, p.ry + 0.5, 1.48), {
      name: state.name, colour: '#7fbf8f',
      frac: p.hp < p.maxHp ? p.hp / p.maxHp : null,
      chat: p.chat && p.chat.ttl > 0 ? p.chat.text : null
    });

    // far things first, so a near label lands on top of a far one
    tags.sort((a, b) => b.d - a.d);
    for (const t of tags) {
      if (t.chat) this.chatBubble(t.chat.x, t.chat.y, t.chat.text);
      if (t.tag) this.nameTag(t.tag.x, t.tag.y, t.tag.text, t.tag.colour);
    }
    for (const t of tags) {
      if (t.bar) this.healthBar(t.bar.x, t.bar.y, t.bar.frac);
    }

    for (const h of state.hitsplats) this.hitsplat(h);
    for (const f of state.floaters) this.floater(f);

    this.minimap(state);
  }

  /**
   * The mark on the tile you just clicked. Drawn before the name tags so a
   * label sits on top of it rather than under it, and drawn at the height of
   * the ground so it lands on the tile rather than in the air above it.
   */
  clickMark(state) {
    const m = state.moveMarker;
    const p = markPhase(m);
    if (p === null) return;
    const x = m.x + 0.5, z = m.y + 0.5;
    const s = this.r.cam.toScreen(x, this.r.terrain.heightAt(x, z), z, this.vw, this.vh);
    if (!s.visible) return;
    drawMark(this.ctx, s.x, s.y, m.kind, p);
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

  /** One pixel per tile, built once and shared with the world map. */
  base() { return minimapImage(this.world); }

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

    // where it is, so a click on it can open the world map
    this.r.minimap = { x: cx, y: cy, r: size / 2 };

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

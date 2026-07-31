/* ============================================================
   Procedural item icons - every sprite is drawn, none are loaded
   ============================================================ */

import { item } from '../data/items.js';
import { shade } from '../util.js';

const cache = new Map();
const urlCache = new Map();

/**
 * An <img> of the item icon, ready to drop into the DOM.
 *
 * Use this rather than cloning the canvas from `iconFor` - cloneNode copies a
 * canvas element but not its bitmap, which yields a blank square.
 */
export function iconImg(itemId, size = 32) {
  let url = urlCache.get(itemId);
  if (!url) {
    url = iconFor(itemId, 40).toDataURL('image/png');
    urlCache.set(itemId, url);
  }
  const img = document.createElement('img');
  img.src = url;
  img.width = img.height = size;
  img.draggable = false;
  img.alt = '';
  return img;
}

/**
 * Returns a cached <canvas> holding the icon for an item id.
 * Icons are drawn once at 2x the request size for crispness.
 */
export function iconFor(itemId, size = 32) {
  const key = itemId + '@' + size;
  if (cache.has(key)) return cache.get(key);

  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = c.height = size * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineJoin = ctx.lineCap = 'round';

  const it = item(itemId);
  drawArt(ctx, it?.art || { k: 'blob', c: '#8f6a4a' }, size);

  cache.set(key, c);
  return c;
}

/** Paints an item's art into an arbitrary context at (0,0)-(s,s). */
export function drawArt(ctx, art, s) {
  const c = art.c || '#b8a68f';
  const fn = SHAPES[art.k] || SHAPES.blob;

  if (art.glow) {
    ctx.save();
    ctx.shadowColor = c;
    ctx.shadowBlur = s * 0.32;
  }
  ctx.save();
  fn(ctx, s, c, art);
  ctx.restore();
  if (art.glow) ctx.restore();
}

/* ---------------- primitives -------------------------------- */

const rr = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const poly = (ctx, pts) => {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
};

/**
 * Fill + darker outline, the look used across every icon.
 * `fill` may be a CanvasGradient, in which case the outline falls back to a
 * neutral dark since there is no single colour to shade.
 */
const solid = (ctx, fill, line = -55, w = 1) => {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle =
    typeof line === 'string' ? line
    : typeof fill === 'string' ? shade(toHex(fill), line)
    : 'rgba(0,0,0,0.45)';
  ctx.lineWidth = w;
  ctx.stroke();
};

const toHex = col =>
  typeof col === 'string' && col.startsWith('#') && (col.length === 7 || col.length === 4)
    ? col : '#888888';

const grad = (ctx, x0, y0, x1, y1, a, b) => {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, a); g.addColorStop(1, b);
  return g;
};

/* ---------------- shape library ----------------------------- */

const SHAPES = {

  blob(ctx, s, c) {
    ctx.beginPath();
    ctx.ellipse(s * .5, s * .55, s * .3, s * .26, 0, 0, 7);
    solid(ctx, grad(ctx, 0, s * .3, 0, s * .8, shade(c, 30), c));
  },

  coin(ctx, s, c = '#e0b357') {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(s * (.38 + i * .11), s * (.66 - i * .12), s * .18, s * .17, 0, 0, 7);
      solid(ctx, grad(ctx, 0, s * .3, 0, s * .8, '#f0d187', '#b8862f'), '#7a5715');
    }
  },

  bone(ctx, s, c = '#e8dcc8') {
    ctx.save();
    ctx.translate(s * .5, s * .5); ctx.rotate(-0.6);
    rr(ctx, -s * .06, -s * .3, s * .12, s * .6, s * .05);
    solid(ctx, c);
    for (const y of [-s * .3, s * .3]) {
      ctx.beginPath();
      ctx.arc(-s * .1, y, s * .09, 0, 7); ctx.arc(s * .1, y, s * .09, 0, 7);
      solid(ctx, c);
    }
    ctx.restore();
  },

  skull(ctx, s, c = '#e8dcc8') {
    ctx.beginPath();
    ctx.ellipse(s * .5, s * .44, s * .26, s * .27, 0, 0, 7);
    solid(ctx, c);
    rr(ctx, s * .36, s * .62, s * .28, s * .16, s * .04);
    solid(ctx, shade(c, -18));
    ctx.fillStyle = '#221118';
    ctx.beginPath();
    ctx.ellipse(s * .41, s * .43, s * .07, s * .09, 0, 0, 7);
    ctx.ellipse(s * .59, s * .43, s * .07, s * .09, 0, 0, 7);
    ctx.fill();
  },

  blade(ctx, s, c, art) {
    ctx.save(); ctx.translate(s * .5, s * .5); ctx.rotate(-0.72);
    poly(ctx, [[-s * .05, s * .02], [-s * .05, -s * .34], [0, -s * .42],
               [s * .05, -s * .34], [s * .05, s * .02]]);
    solid(ctx, grad(ctx, -s * .05, 0, s * .05, 0, '#ffffff', c));
    rr(ctx, -s * .055, s * .02, s * .11, s * .3, s * .03);
    solid(ctx, art.hilt || '#5a4636');
    ctx.restore();
  },

  saw(ctx, s, c) {
    ctx.save(); ctx.translate(s * .5, s * .5); ctx.rotate(-0.5);
    poly(ctx, [[-s * .3, -s * .1], [s * .22, -s * .16], [s * .22, -s * .02], [-s * .3, s * .02]]);
    solid(ctx, c);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const x = -s * .28 + i * s * .055;
      ctx.moveTo(x, s * .01); ctx.lineTo(x + s * .027, s * .07); ctx.lineTo(x + s * .055, s * .01);
    }
    ctx.strokeStyle = shade(toHex(c), -50); ctx.lineWidth = 1.2; ctx.stroke();
    rr(ctx, s * .2, -s * .2, s * .12, s * .28, s * .04);
    solid(ctx, '#6b4a2f');
    ctx.restore();
  },

  spear(ctx, s, c) {
    ctx.save(); ctx.translate(s * .5, s * .5); ctx.rotate(-0.72);
    ctx.beginPath(); ctx.moveTo(0, s * .42); ctx.lineTo(0, -s * .18);
    ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = s * .08; ctx.stroke();
    poly(ctx, [[0, -s * .44], [s * .09, -s * .16], [0, -s * .08], [-s * .09, -s * .16]]);
    solid(ctx, grad(ctx, -s * .09, 0, s * .09, 0, '#ffffff', c));
    ctx.restore();
  },

  hammer(ctx, s, c = '#8a8a8a') {
    ctx.save(); ctx.translate(s * .5, s * .5); ctx.rotate(0.5);
    ctx.beginPath(); ctx.moveTo(0, -s * .1); ctx.lineTo(0, s * .4);
    ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = s * .09; ctx.stroke();
    rr(ctx, -s * .21, -s * .32, s * .42, s * .22, s * .04);
    solid(ctx, grad(ctx, 0, -s * .32, 0, -s * .1, shade(c, 40), c));
    ctx.restore();
  },

  pick(ctx, s, c = '#ddd3bb') {
    ctx.save(); ctx.translate(s * .5, s * .52);
    ctx.beginPath(); ctx.moveTo(0, -s * .18); ctx.lineTo(0, s * .4);
    ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = s * .09; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * .32, -s * .1);
    ctx.quadraticCurveTo(0, -s * .42, s * .32, -s * .1);
    ctx.quadraticCurveTo(0, -s * .28, -s * .32, -s * .1);
    solid(ctx, c);
    ctx.restore();
  },

  syringe(ctx, s, c = '#c9a34a') {
    ctx.save(); ctx.translate(s * .5, s * .5); ctx.rotate(-0.7);
    rr(ctx, -s * .08, -s * .18, s * .16, s * .38, s * .03);
    solid(ctx, grad(ctx, -s * .08, 0, s * .08, 0, '#f2f6f8', c));
    rr(ctx, -s * .13, -s * .26, s * .26, s * .09, s * .03);
    solid(ctx, c);
    ctx.beginPath(); ctx.moveTo(0, s * .2); ctx.lineTo(0, s * .44);
    ctx.strokeStyle = '#dde5ea'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
  },

  blowpipe(ctx, s, c = '#6b8f5f') {
    ctx.save(); ctx.translate(s * .5, s * .5); ctx.rotate(-0.7);
    rr(ctx, -s * .05, -s * .4, s * .1, s * .8, s * .04);
    solid(ctx, grad(ctx, -s * .05, 0, s * .05, 0, shade(c, 40), c));
    ctx.beginPath(); ctx.ellipse(0, -s * .4, s * .07, s * .04, 0, 0, 7);
    solid(ctx, '#221118');
    ctx.restore();
  },

  bow(ctx, s, c = '#ded3bb') {
    ctx.beginPath();
    ctx.arc(s * .62, s * .5, s * .34, Math.PI * .62, Math.PI * 1.38);
    ctx.strokeStyle = c; ctx.lineWidth = s * .09; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * .44, s * .18); ctx.lineTo(s * .44, s * .82);
    ctx.strokeStyle = '#d8cfc0'; ctx.lineWidth = 1.2; ctx.stroke();
  },

  staff(ctx, s, c = '#8f6a4a', art) {
    ctx.save(); ctx.translate(s * .5, s * .5); ctx.rotate(0.28);
    ctx.beginPath(); ctx.moveTo(0, -s * .28); ctx.lineTo(0, s * .44);
    ctx.strokeStyle = c; ctx.lineWidth = s * .08; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -s * .34, s * .12, 0, 7);
    solid(ctx, art.gem || '#6fd1a5');
    ctx.restore();
  },

  dart(ctx, s, c = '#b9c4cc') {
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate(s * (.3 + i * .2), s * .5); ctx.rotate(-0.35);
      poly(ctx, [[0, -s * .28], [s * .05, -s * .12], [0, s * .2], [-s * .05, -s * .12]]);
      solid(ctx, c);
      ctx.restore();
    }
  },

  needle(ctx, s, c = '#dde5ea') {
    ctx.beginPath();
    ctx.arc(s * .5, s * .55, s * .26, Math.PI * .1, Math.PI * 1.2);
    ctx.strokeStyle = c; ctx.lineWidth = s * .07; ctx.stroke();
    ctx.beginPath(); ctx.arc(s * .74, s * .48, s * .05, 0, 7);
    ctx.strokeStyle = '#8f9aa3'; ctx.lineWidth = 1.2; ctx.stroke();
  },

  thread(ctx, s, c = '#d8cfc0') {
    rr(ctx, s * .34, s * .22, s * .32, s * .56, s * .05);
    solid(ctx, '#8f6a4a');
    ctx.strokeStyle = c; ctx.lineWidth = s * .05;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(s * .34, s * (.3 + i * .1)); ctx.lineTo(s * .66, s * (.34 + i * .1));
      ctx.stroke();
    }
  },

  net(ctx, s, c = '#c9b48f') {
    ctx.beginPath(); ctx.arc(s * .5, s * .46, s * .3, Math.PI, 0);
    ctx.lineTo(s * .74, s * .62); ctx.arc(s * .5, s * .62, s * .24, 0, Math.PI);
    ctx.closePath();
    solid(ctx, 'rgba(200,190,160,.35)', '#8f7f6a', 1.4);
    ctx.strokeStyle = '#8f7f6a'; ctx.lineWidth = .8;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(s * (.26 + i * .12), s * .3); ctx.lineTo(s * (.3 + i * .1), s * .68);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(s * .5, s * .74); ctx.lineTo(s * .5, s * .9);
    ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = s * .07; ctx.stroke();
  },

  gaff(ctx, s, c = '#9aa3aa') {
    ctx.beginPath(); ctx.moveTo(s * .36, s * .9); ctx.lineTo(s * .56, s * .3);
    ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = s * .08; ctx.stroke();
    ctx.beginPath();
    ctx.arc(s * .48, s * .28, s * .16, Math.PI * .1, Math.PI * 1.5);
    ctx.strokeStyle = c; ctx.lineWidth = s * .07; ctx.stroke();
  },

  mortar(ctx, s, c = '#b8ab99') {
    ctx.beginPath();
    ctx.moveTo(s * .28, s * .5); ctx.lineTo(s * .72, s * .5);
    ctx.lineTo(s * .62, s * .82); ctx.lineTo(s * .38, s * .82);
    ctx.closePath();
    solid(ctx, c);
    ctx.beginPath(); ctx.moveTo(s * .58, s * .48); ctx.lineTo(s * .72, s * .2);
    ctx.strokeStyle = '#9a8878'; ctx.lineWidth = s * .09; ctx.stroke();
  },

  vial(ctx, s, c, art) {
    rr(ctx, s * .38, s * .16, s * .24, s * .12, s * .03);
    solid(ctx, '#7a6a58');
    ctx.beginPath();
    ctx.moveTo(s * .42, s * .28); ctx.lineTo(s * .42, s * .58);
    ctx.quadraticCurveTo(s * .5, s * .86, s * .58, s * .58);
    ctx.lineTo(s * .58, s * .28);
    ctx.closePath();
    if (art.fill) {
      ctx.save(); ctx.clip();
      ctx.fillStyle = art.fill;
      ctx.fillRect(s * .4, s * .42, s * .2, s * .45);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(235,245,250,.75)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill();
  },

  bucket(ctx, s, c = '#8f7f6a') {
    poly(ctx, [[s * .3, s * .38], [s * .7, s * .38], [s * .62, s * .82], [s * .38, s * .82]]);
    solid(ctx, c);
    ctx.beginPath(); ctx.arc(s * .5, s * .38, s * .2, Math.PI, 0);
    ctx.strokeStyle = '#6b5a4a'; ctx.lineWidth = 1.6; ctx.stroke();
  },

  fluff(ctx, s, c) {
    for (const [x, y, r] of [[.38, .58, .17], [.6, .55, .16], [.5, .42, .18]]) {
      ctx.beginPath(); ctx.arc(s * x, s * y, s * r, 0, 7);
      solid(ctx, c, -30);
    }
  },

  log(ctx, s, c) {
    ctx.save(); ctx.translate(s * .5, s * .5); ctx.rotate(-0.35);
    rr(ctx, -s * .34, -s * .14, s * .68, s * .28, s * .06);
    solid(ctx, grad(ctx, 0, -s * .14, 0, s * .14, shade(c, 25), shade(c, -25)));
    ctx.beginPath(); ctx.ellipse(s * .32, 0, s * .05, s * .13, 0, 0, 7);
    solid(ctx, shade(c, -40));
    ctx.restore();
  },

  ore(ctx, s, c) {
    poly(ctx, [[s * .5, s * .2], [s * .78, s * .42], [s * .68, s * .78],
               [s * .34, s * .8], [s * .22, s * .44]]);
    solid(ctx, grad(ctx, s * .3, s * .2, s * .7, s * .8, shade(c, 35), shade(c, -30)));
    ctx.beginPath();
    ctx.moveTo(s * .45, s * .32); ctx.lineTo(s * .6, s * .5); ctx.lineTo(s * .42, s * .64);
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.4; ctx.stroke();
  },

  gem(ctx, s, c) {
    poly(ctx, [[s * .5, s * .18], [s * .76, s * .44], [s * .5, s * .84], [s * .24, s * .44]]);
    solid(ctx, grad(ctx, s * .3, s * .2, s * .7, s * .8, shade(c, 60), shade(c, -20)));
    poly(ctx, [[s * .5, s * .18], [s * .5, s * .84], [s * .24, s * .44]]);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
  },

  bar(ctx, s, c) {
    poly(ctx, [[s * .22, s * .46], [s * .78, s * .46], [s * .7, s * .68], [s * .3, s * .68]]);
    solid(ctx, grad(ctx, 0, s * .46, 0, s * .68, shade(c, 40), shade(c, -20)));
    poly(ctx, [[s * .22, s * .46], [s * .3, s * .36], [s * .7, s * .36], [s * .78, s * .46]]);
    solid(ctx, shade(c, 55));
  },

  herb(ctx, s, c) {
    ctx.beginPath(); ctx.moveTo(s * .5, s * .84); ctx.quadraticCurveTo(s * .46, s * .5, s * .5, s * .2);
    ctx.strokeStyle = shade(toHex(c), -45); ctx.lineWidth = s * .05; ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const y = s * (.34 + i * .16), dir = i % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(s * .5 + dir * s * .14, y, s * .15, s * .07, dir * -0.5, 0, 7);
      solid(ctx, c, -40);
    }
  },

  bush(ctx, s, c) {
    for (const [x, y, r] of [[.35, .62, .18], [.63, .6, .17], [.5, .45, .2]]) {
      ctx.beginPath(); ctx.arc(s * x, s * y, s * r, 0, 7);
      solid(ctx, c, -45);
    }
  },

  fish(ctx, s, c) {
    ctx.beginPath();
    ctx.ellipse(s * .48, s * .52, s * .28, s * .16, -0.12, 0, 7);
    solid(ctx, grad(ctx, 0, s * .36, 0, s * .68, shade(c, 40), c));
    poly(ctx, [[s * .74, s * .5], [s * .9, s * .34], [s * .9, s * .68]]);
    solid(ctx, shade(c, -20));
    ctx.fillStyle = '#1a0e14';
    ctx.beginPath(); ctx.arc(s * .28, s * .48, s * .035, 0, 7); ctx.fill();
  },

  food(ctx, s, c) {
    ctx.beginPath(); ctx.ellipse(s * .5, s * .55, s * .28, s * .2, 0, 0, 7);
    solid(ctx, grad(ctx, 0, s * .35, 0, s * .75, shade(c, 35), shade(c, -20)));
    ctx.strokeStyle = 'rgba(80,40,20,.5)'; ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(s * (.34 + i * .11), s * .45); ctx.lineTo(s * (.4 + i * .11), s * .66);
      ctx.stroke();
    }
  },

  bowl(ctx, s, c) {
    ctx.beginPath(); ctx.ellipse(s * .5, s * .5, s * .28, s * .1, 0, 0, 7);
    solid(ctx, c);
    ctx.beginPath();
    ctx.moveTo(s * .22, s * .5); ctx.quadraticCurveTo(s * .5, s * .88, s * .78, s * .5);
    ctx.closePath();
    solid(ctx, '#b8ab99');
  },

  pill(ctx, s, c) {
    ctx.save(); ctx.translate(s * .5, s * .5); ctx.rotate(-0.5);
    rr(ctx, -s * .24, -s * .13, s * .48, s * .26, s * .13);
    solid(ctx, grad(ctx, 0, -s * .13, 0, s * .13, shade(c, 45), c));
    ctx.restore();
  },

  bandage(ctx, s, c = '#e8e0cd') {
    ctx.save(); ctx.translate(s * .5, s * .5); ctx.rotate(0.4);
    ctx.beginPath(); ctx.arc(0, 0, s * .27, 0, 7);
    solid(ctx, c);
    ctx.beginPath(); ctx.arc(0, 0, s * .1, 0, 7);
    solid(ctx, shade(toHex(c), -35));
    ctx.beginPath(); ctx.moveTo(s * .26, s * .06); ctx.lineTo(s * .46, s * .2);
    ctx.strokeStyle = c; ctx.lineWidth = s * .13; ctx.stroke();
    ctx.restore();
  },

  rune(ctx, s, c) {
    poly(ctx, [[s * .5, s * .16], [s * .8, s * .5], [s * .5, s * .84], [s * .2, s * .5]]);
    solid(ctx, '#3a2a34', '#1a1018', 1.2);
    ctx.strokeStyle = c; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(s * .42, s * .34); ctx.lineTo(s * .58, s * .5); ctx.lineTo(s * .42, s * .66);
    ctx.moveTo(s * .6, s * .36); ctx.lineTo(s * .6, s * .62);
    ctx.stroke();
  },

  /* -- worn gear ------------------------------------------- */

  helm(ctx, s, c) {
    ctx.beginPath();
    ctx.arc(s * .5, s * .5, s * .27, Math.PI, 0);
    ctx.lineTo(s * .77, s * .72); ctx.lineTo(s * .23, s * .72); ctx.closePath();
    solid(ctx, grad(ctx, 0, s * .23, 0, s * .72, shade(c, 35), shade(c, -25)));
    ctx.fillStyle = '#1a0e14';
    ctx.fillRect(s * .44, s * .44, s * .12, s * .28);
  },

  mask(ctx, s, c) {
    ctx.beginPath();
    ctx.moveTo(s * .24, s * .38);
    ctx.quadraticCurveTo(s * .5, s * .3, s * .76, s * .38);
    ctx.quadraticCurveTo(s * .68, s * .72, s * .5, s * .74);
    ctx.quadraticCurveTo(s * .32, s * .72, s * .24, s * .38);
    ctx.closePath();
    solid(ctx, grad(ctx, 0, s * .3, 0, s * .74, shade(c, 25), shade(c, -18)));
    ctx.strokeStyle = shade(toHex(c), -45); ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(s * .24, s * .42); ctx.lineTo(s * .1, s * .34);
    ctx.moveTo(s * .76, s * .42); ctx.lineTo(s * .9, s * .34);
    ctx.stroke();
  },

  plate(ctx, s, c) {
    ctx.beginPath();
    ctx.moveTo(s * .3, s * .26); ctx.lineTo(s * .7, s * .26);
    ctx.lineTo(s * .8, s * .42); ctx.lineTo(s * .72, s * .46);
    ctx.lineTo(s * .72, s * .78); ctx.lineTo(s * .28, s * .78);
    ctx.lineTo(s * .28, s * .46); ctx.lineTo(s * .2, s * .42);
    ctx.closePath();
    solid(ctx, grad(ctx, 0, s * .26, 0, s * .78, shade(c, 35), shade(c, -25)));
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s * .5, s * .3); ctx.lineTo(s * .5, s * .76); ctx.stroke();
  },

  robe(ctx, s, c) {
    ctx.beginPath();
    ctx.moveTo(s * .34, s * .24); ctx.lineTo(s * .66, s * .24);
    ctx.quadraticCurveTo(s * .84, s * .5, s * .78, s * .8);
    ctx.lineTo(s * .22, s * .8);
    ctx.quadraticCurveTo(s * .16, s * .5, s * .34, s * .24);
    ctx.closePath();
    solid(ctx, grad(ctx, 0, s * .24, 0, s * .8, shade(c, 30), shade(c, -22)));
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s * .5, s * .26); ctx.lineTo(s * .5, s * .78); ctx.stroke();
  },

  legs(ctx, s, c) {
    ctx.beginPath();
    ctx.moveTo(s * .28, s * .24); ctx.lineTo(s * .72, s * .24);
    ctx.lineTo(s * .68, s * .82); ctx.lineTo(s * .54, s * .82);
    ctx.lineTo(s * .5, s * .5); ctx.lineTo(s * .46, s * .82);
    ctx.lineTo(s * .32, s * .82); ctx.closePath();
    solid(ctx, grad(ctx, 0, s * .24, 0, s * .82, shade(c, 30), shade(c, -25)));
  },

  skirt(ctx, s, c) {
    ctx.beginPath();
    ctx.moveTo(s * .34, s * .24); ctx.lineTo(s * .66, s * .24);
    ctx.lineTo(s * .8, s * .8); ctx.lineTo(s * .2, s * .8); ctx.closePath();
    solid(ctx, grad(ctx, 0, s * .24, 0, s * .8, shade(c, 30), shade(c, -22)));
  },

  gloves(ctx, s, c) {
    for (const dx of [-.14, .14]) {
      ctx.save(); ctx.translate(s * (.5 + dx), s * .55);
      rr(ctx, -s * .1, -s * .18, s * .2, s * .34, s * .05);
      solid(ctx, grad(ctx, 0, -s * .18, 0, s * .16, shade(c, 28), shade(c, -22)));
      ctx.restore();
    }
  },

  boots(ctx, s, c) {
    for (const dx of [-.15, .15]) {
      ctx.save(); ctx.translate(s * (.5 + dx), s * .5);
      ctx.beginPath();
      ctx.moveTo(-s * .08, -s * .2); ctx.lineTo(s * .08, -s * .2);
      ctx.lineTo(s * .08, s * .12); ctx.lineTo(s * .18, s * .12);
      ctx.lineTo(s * .18, s * .26); ctx.lineTo(-s * .08, s * .26); ctx.closePath();
      solid(ctx, grad(ctx, 0, -s * .2, 0, s * .26, shade(c, 25), shade(c, -25)));
      ctx.restore();
    }
  },

  shield(ctx, s, c) {
    ctx.beginPath();
    ctx.moveTo(s * .5, s * .16);
    ctx.lineTo(s * .78, s * .3); ctx.quadraticCurveTo(s * .78, s * .68, s * .5, s * .86);
    ctx.quadraticCurveTo(s * .22, s * .68, s * .22, s * .3);
    ctx.closePath();
    solid(ctx, grad(ctx, 0, s * .16, 0, s * .86, shade(c, 35), shade(c, -28)));
    ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(s * .5, s * .22); ctx.lineTo(s * .5, s * .78); ctx.stroke();
  },

  cape(ctx, s, c) {
    ctx.beginPath();
    ctx.moveTo(s * .38, s * .2); ctx.lineTo(s * .62, s * .2);
    ctx.quadraticCurveTo(s * .86, s * .56, s * .74, s * .84);
    ctx.lineTo(s * .26, s * .84);
    ctx.quadraticCurveTo(s * .14, s * .56, s * .38, s * .2);
    ctx.closePath();
    solid(ctx, grad(ctx, 0, s * .2, 0, s * .84, shade(c, 32), shade(c, -28)));
  },

  amulet(ctx, s, c) {
    ctx.beginPath();
    ctx.arc(s * .5, s * .34, s * .22, Math.PI * .15, Math.PI * .85, true);
    ctx.strokeStyle = '#c9a34a'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.beginPath(); ctx.arc(s * .5, s * .64, s * .16, 0, 7);
    solid(ctx, grad(ctx, 0, s * .48, 0, s * .8, shade(c, 55), shade(c, -20)));
  },

  ring(ctx, s, c) {
    ctx.beginPath(); ctx.arc(s * .5, s * .58, s * .2, 0, 7);
    ctx.strokeStyle = '#c9a34a'; ctx.lineWidth = s * .09; ctx.stroke();
    ctx.beginPath(); ctx.arc(s * .5, s * .34, s * .09, 0, 7);
    solid(ctx, c);
  },

  /* -- misc ------------------------------------------------ */

  key(ctx, s, c = '#c9a34a') {
    ctx.beginPath(); ctx.arc(s * .34, s * .38, s * .14, 0, 7);
    ctx.strokeStyle = c; ctx.lineWidth = s * .08; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * .44, s * .48); ctx.lineTo(s * .74, s * .78);
    ctx.moveTo(s * .64, s * .68); ctx.lineTo(s * .74, s * .58);
    ctx.moveTo(s * .7, s * .74); ctx.lineTo(s * .8, s * .64);
    ctx.lineWidth = s * .07; ctx.stroke();
  },

  book(ctx, s, c = '#8f6a4a') {
    rr(ctx, s * .22, s * .26, s * .56, s * .48, s * .04);
    solid(ctx, c);
    ctx.fillStyle = '#e8dcc8';
    ctx.fillRect(s * .26, s * .3, s * .48, s * .4);
    ctx.strokeStyle = '#b8a68f'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(s * .3, s * (.38 + i * .08)); ctx.lineTo(s * .7, s * (.38 + i * .08));
      ctx.stroke();
    }
    ctx.fillStyle = shade(toHex(c), -40);
    ctx.fillRect(s * .48, s * .26, s * .04, s * .48);
  },

  scroll(ctx, s, c = '#ded3c0') {
    rr(ctx, s * .24, s * .28, s * .52, s * .44, s * .03);
    solid(ctx, c);
    ctx.strokeStyle = '#9a8878'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(s * .3, s * (.4 + i * .1)); ctx.lineTo(s * .68, s * (.4 + i * .1));
      ctx.stroke();
    }
    ctx.fillStyle = shade(toHex(c), -30);
    ctx.fillRect(s * .2, s * .26, s * .08, s * .48);
    ctx.fillRect(s * .72, s * .26, s * .08, s * .48);
  },

  seal(ctx, s, c = '#5a2030') {
    ctx.beginPath(); ctx.arc(s * .5, s * .52, s * .24, 0, 7);
    solid(ctx, grad(ctx, 0, s * .28, 0, s * .76, shade(c, 45), c));
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(s * .4, s * .44); ctx.lineTo(s * .6, s * .44);
    ctx.moveTo(s * .38, s * .58); ctx.lineTo(s * .62, s * .58);
    ctx.stroke();
  },

  charm(ctx, s, c = '#c0303f') {
    ctx.strokeStyle = c; ctx.lineWidth = s * .06;
    ctx.beginPath();
    ctx.moveTo(s * .3, s * .26); ctx.quadraticCurveTo(s * .7, s * .42, s * .34, s * .6);
    ctx.quadraticCurveTo(s * .68, s * .74, s * .42, s * .84);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(s * .62, s * .34, s * .07, 0, 7);
    solid(ctx, '#e8dcc8');
  },

  cauldron(ctx, s, c = '#3a3038') {
    ctx.beginPath(); ctx.arc(s * .5, s * .56, s * .28, 0, Math.PI);
    ctx.lineTo(s * .22, s * .42); ctx.lineTo(s * .78, s * .42); ctx.closePath();
    solid(ctx, c);
  }
};

export const SHAPE_KINDS = Object.keys(SHAPES);

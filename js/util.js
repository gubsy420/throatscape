/* ============================================================
   Throatscape - shared helpers
   ============================================================ */

export const TILE = 32;          // pixels per tile at zoom 1
export const TICK_MS = 600;      // game tick, matching the old engines

export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
/** Chebyshev distance - the metric the movement grid actually uses. */
export const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

export const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const chance = p => Math.random() < p;

/** Deterministic 32-bit hash -> float in [0,1). Used for stable world texture. */
export function hash2(x, y, seed = 0) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Small seedable PRNG (mulberry32) for repeatable world generation. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise built on hash2 - cheap, good enough for terrain blotches. */
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x, y, seed = 0, octaves = 3) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 977) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

/** Weighted pick: table is [{ weight, ...payload }]. */
export function weightedPick(table) {
  let total = 0;
  for (const e of table) total += e.weight;
  let r = Math.random() * total;
  for (const e of table) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return table[table.length - 1];
}

export const fmt = n => {
  n = Math.floor(n);
  if (n >= 10000000) return Math.floor(n / 1000000) + 'M';
  if (n >= 100000) return Math.floor(n / 1000) + 'K';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/** Short form used inside tiny inventory stack labels. */
export const fmtStack = n => {
  if (n >= 10000000) return Math.floor(n / 1000000) + 'M';
  if (n >= 100000) return Math.floor(n / 1000) + 'K';
  if (n >= 10000) return Math.floor(n / 1000) + 'K';
  return String(n);
};

export const title = s => s.charAt(0).toUpperCase() + s.slice(1);

/** "a scalpel" / "an anvil" */
export const article = s => /^[aeiou]/i.test(s) ? 'an ' + s : 'a ' + s;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Pathfinding ------------------------------- */

/**
 * A* over the walkability grid. Eight-directional, but a diagonal step is only
 * legal when both orthogonal neighbours are clear (no corner-cutting), which is
 * how the original games handle it.
 *
 * @param {(x:number,y:number)=>boolean} walkable
 * @returns {Array<{x:number,y:number}>} steps excluding the start tile
 */
export function findPath(sx, sy, tx, ty, walkable, maxNodes = 4000) {
  if (sx === tx && sy === ty) return [];

  const key = (x, y) => x * 100000 + y;
  const open = new BinHeap();
  const gScore = new Map();
  const came = new Map();
  const closed = new Set();

  const h = (x, y) => cheb(x, y, tx, ty);
  const startKey = key(sx, sy);
  gScore.set(startKey, 0);
  open.push({ x: sx, y: sy, f: h(sx, sy) });

  let best = { x: sx, y: sy, k: startKey, h: h(sx, sy) };
  let expanded = 0;

  while (open.size && expanded < maxNodes) {
    const cur = open.pop();
    const ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);
    expanded++;

    const ch = h(cur.x, cur.y);
    if (ch < best.h) best = { x: cur.x, y: cur.y, k: ck, h: ch };
    if (cur.x === tx && cur.y === ty) { best = { x: tx, y: ty, k: ck, h: 0 }; break; }

    const g = gScore.get(ck);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!walkable(nx, ny)) continue;
        if (dx && dy && (!walkable(cur.x + dx, cur.y) || !walkable(cur.x, cur.y + dy))) continue;

        const nk = key(nx, ny);
        if (closed.has(nk)) continue;
        const ng = g + (dx && dy ? 1.001 : 1);
        if (gScore.has(nk) && gScore.get(nk) <= ng) continue;
        gScore.set(nk, ng);
        came.set(nk, ck);
        open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
      }
    }
  }

  // Walk back from the closest reached tile, so a blocked target still moves us.
  const out = [];
  let k = best.k;
  while (k !== startKey && came.has(k)) {
    out.push({ x: Math.floor(k / 100000), y: k % 100000 });
    k = came.get(k);
  }
  return out.reverse();
}

/** Binary min-heap keyed on `.f`. */
class BinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

/* ---------------- Tiny event bus ---------------------------- */

export function makeBus() {
  const map = new Map();
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt).delete(fn);
    },
    emit(evt, payload) {
      const s = map.get(evt);
      if (s) for (const fn of [...s]) fn(payload);
    }
  };
}

/* ---------------- Colour helpers ---------------------------- */

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

export function mix(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return `rgb(${r},${g},${bl})`;
}

/* ============================================================
   The ground
   ------------------------------------------------------------
   The map is still a flat grid of tiles as far as the server is
   concerned - walkability, pathfinding and every saved position
   are untouched. What happens here is purely a matter of how it
   is drawn: the corners of each tile are lifted and dropped by
   a smooth noise field, so the Throat has hills and hollows
   instead of being a board.

   The height comes from the same deterministic hash the tile
   speckle already used, so it needs nothing from the server and
   two machines cannot disagree about it.

   Heights live on tile *corners*, never on tiles. That is the
   whole reason the landscape has no cracks in it: neighbouring
   tiles do not compute their own edges, they share them.
   ============================================================ */

import { fbm, noise2, hash2, mix } from '../../util.js';
import { T, TILE_INFO } from '../../data/world.js';
import { MeshBuilder, rgb, tone } from '../gl/mesh.js';

export const CHUNK = 16;

/** How tall a wall stands above the ground it is planted in. */
const WALL_H = 1.7;
const CAVEWALL_H = 2.6;
/** How far the world's rim drops before it stops being drawn. */
const SKIRT = 4;

/** Tiles that are the inside of something, and want a level floor. */
const INDOORS = new Set([T.FLOOR, T.CARPET, T.TILE_FLOOR, T.BRIDGE]);

export class Terrain {
  constructor(world) {
    this.world = world;
    this.chunks = new Map();
    this.heights = new Map();          // corner caches: neither is cheap, and
    this.colours = new Map();          // every corner is asked for four times
  }

  /*
   * The lie of the land at a tile corner. Two octaves of noise, then two
   * corrections that matter more than the noise does: bile sits in hollows
   * rather than on hillsides, and anything with a floor is levelled off so
   * that buildings are not built on a slope.
   */
  cornerHeight(cx, cy) {
    const key = cx * 100000 + cy;
    const hit = this.heights.get(key);
    if (hit !== undefined) return hit;

    let h = (fbm(cx / 15, cy / 15, 7717, 3) - 0.5) * 0.85;
    h += (noise2(cx / 5.5, cy / 5.5, 4231) - 0.5) * 0.16;

    // the four tiles that meet at this corner decide what happens to it
    let bile = 0, flat = 0, solid = 0;
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        const t = this.world.tileAt(cx + dx, cy + dy);
        if (t === T.BILE) bile++;
        else if (INDOORS.has(t)) flat++;
        if (t !== T.VOID) solid++;
      }
    }
    if (bile) h -= (bile / 4) * 0.34;                   // standing bile pools
    if (flat) h *= 1 - (flat / 4) * 0.88;               // floors want to be level
    if (!solid) h -= 0.6;                               // the rim falls away

    this.heights.set(key, h);
    return h;
  }

  /** The ground under any point, corners blended across the tile. */
  heightAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    const fx = x - tx, fy = y - ty;
    const a = this.cornerHeight(tx, ty);
    const b = this.cornerHeight(tx + 1, ty);
    const c = this.cornerHeight(tx, ty + 1);
    const d = this.cornerHeight(tx + 1, ty + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  /** The middle of a tile, which is where anything standing on it goes. */
  tileHeight(tx, ty) { return this.heightAt(tx + 0.5, ty + 0.5); }

  /** The colour of a tile, matching what the map and minimap have always used. */
  tileColour(tx, ty) {
    const w = this.world;
    const t = w.tileAt(tx, ty);
    const info = TILE_INFO[t] || TILE_INFO[T.VOID];
    const n = hash2(tx, ty, 17);
    let base = n > 0.5 ? info.c2 : info.c;
    const region = w.regionAt(tx, ty);
    if (region && region.tint && (t === T.TURF || t === T.BOG || t === T.CHALK)) {
      base = mix(base, region.tint, 0.35);
    }
    /*
     * Two scales of variation, because corner blending averages away most of
     * the fine one: a per-tile jitter for texture up close, and a broad
     * mottling that survives the blend and keeps a large field from reading
     * as a single sheet of paint.
     */
    const blotch = (noise2(tx / 9, ty / 9, 6131) - 0.5) * 0.115;
    return tone(rgb(base), (hash2(tx, ty, 53) - 0.5) * 0.075 + blotch);
  }

  /**
   * The colour at one corner of one tile: the average of the tiles meeting
   * there that are the same kind of ground.
   *
   * Shading per corner rather than per tile is what stops an open field
   * reading as a chequerboard. Averaging only across matching tiles is what
   * stops the opposite problem - blend everything and a stone road dissolves
   * into the turf either side of it, and the town loses its streets. Turf
   * grades into turf; where turf meets stone, the edge stays.
   */
  cornerColour(t, tx, ty, cx, cy) {
    const key = (cx * 100000 + cy) * 20 + t;
    const hit = this.colours.get(key);
    if (hit) return hit;

    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        if (this.world.tileAt(cx + dx, cy + dy) !== t) continue;
        const c = this.tileColour(cx + dx, cy + dy);
        r += c[0]; g += c[1]; b += c[2]; n++;
      }
    }
    const out = n ? [r / n, g / n, b / n] : this.tileColour(tx, ty);
    this.colours.set(key, out);
    return out;
  }

  /* ---------------- meshing --------------------------------- */

  chunkMesh(gl, cx, cy) {
    const key = cx + ',' + cy;
    let m = this.chunks.get(key);
    if (m) return m;
    m = this.buildChunk(cx, cy).build(gl);
    this.chunks.set(key, m);
    return m;
  }

  buildChunk(cx, cy) {
    const b = new MeshBuilder();
    const w = this.world;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;

    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const tx = x0 + i, ty = y0 + j;
        const t = w.tileAt(tx, ty);
        if (t === T.VOID) continue;

        const h00 = this.cornerHeight(tx, ty);
        const h10 = this.cornerHeight(tx + 1, ty);
        const h01 = this.cornerHeight(tx, ty + 1);
        const h11 = this.cornerHeight(tx + 1, ty + 1);
        const c00 = this.cornerColour(t, tx, ty, tx, ty);
        const c10 = this.cornerColour(t, tx, ty, tx + 1, ty);
        const c01 = this.cornerColour(t, tx, ty, tx, ty + 1);
        const c11 = this.cornerColour(t, tx, ty, tx + 1, ty + 1);

        const p00 = [tx, h00, ty], p10 = [tx + 1, h10, ty];
        const p01 = [tx, h01, ty + 1], p11 = [tx + 1, h11, ty + 1];

        /*
         * Split along whichever diagonal keeps the two triangles closest to
         * flat. Choosing wrongly puts a visible crease across a slope and
         * makes a smooth hillside look like corrugated iron.
         */
        if (Math.abs(h00 - h11) <= Math.abs(h10 - h01)) {
          b.triC(p00, p01, p11, c00, c01, c11);
          b.triC(p00, p11, p10, c00, c11, c10);
        } else {
          b.triC(p00, p01, p10, c00, c01, c10);
          b.triC(p01, p11, p10, c01, c11, c10);
        }

        if (t === T.WALL || t === T.CAVEWALL) this.wall(b, tx, ty, t);
        this.rim(b, tx, ty, h00, h10, h01, h11);
      }
    }
    return b;
  }

  /**
   * A wall is a block standing on the ground. Only the faces that meet open
   * air are built - the inside of a long wall is never seen, and skipping it
   * takes a town from tens of thousands of triangles to a few thousand.
   */
  wall(b, tx, ty, t) {
    const w = this.world;
    const tall = t === T.CAVEWALL ? CAVEWALL_H : WALL_H;
    const info = TILE_INFO[t];
    const base = rgb(hash2(tx, ty, 17) > 0.5 ? info.c2 : info.c);
    const col = tone(base, (hash2(tx, ty, 71) - 0.5) * 0.09);

    const h00 = this.cornerHeight(tx, ty), h10 = this.cornerHeight(tx + 1, ty);
    const h01 = this.cornerHeight(tx, ty + 1), h11 = this.cornerHeight(tx + 1, ty + 1);
    const top = Math.max(h00, h10, h01, h11) + tall;

    b.quad([tx, top, ty], [tx, top, ty + 1], [tx + 1, top, ty + 1], [tx + 1, top, ty],
           tone(col, 0.08));

    const same = (dx, dy) => {
      const n = w.tileAt(tx + dx, ty + dy);
      return n === T.WALL || n === T.CAVEWALL;
    };
    // north
    if (!same(0, -1)) b.quad([tx + 1, h10, ty], [tx, h00, ty], [tx, top, ty], [tx + 1, top, ty], tone(col, -0.10));
    // south
    if (!same(0, 1)) b.quad([tx, h01, ty + 1], [tx + 1, h11, ty + 1], [tx + 1, top, ty + 1], [tx, top, ty + 1], tone(col, -0.02));
    // west
    if (!same(-1, 0)) b.quad([tx, h00, ty], [tx, h01, ty + 1], [tx, top, ty + 1], [tx, top, ty], tone(col, -0.07));
    // east
    if (!same(1, 0)) b.quad([tx + 1, h11, ty + 1], [tx + 1, h10, ty], [tx + 1, top, ty], [tx + 1, top, ty + 1], tone(col, -0.05));
  }

  /**
   * Where the map stops, the ground has to stop being a sheet of paper: a
   * skirt hangs off the edge so the player sees a cliff rather than through
   * the world into the sky.
   */
  rim(b, tx, ty, h00, h10, h01, h11) {
    const w = this.world;
    const dark = tone(rgb('#2a1d22'), 0);
    const drop = (a, b2, x0, z0, x1, z1) => {
      b.quad([x0, a, z0], [x0, a - SKIRT, z0], [x1, b2 - SKIRT, z1], [x1, b2, z1], dark);
    };
    if (w.tileAt(tx, ty - 1) === T.VOID) drop(h10, h00, tx + 1, ty, tx, ty);
    if (w.tileAt(tx, ty + 1) === T.VOID) drop(h01, h11, tx, ty + 1, tx + 1, ty + 1);
    if (w.tileAt(tx - 1, ty) === T.VOID) drop(h00, h01, tx, ty, tx, ty + 1);
    if (w.tileAt(tx + 1, ty) === T.VOID) drop(h11, h10, tx + 1, ty + 1, tx + 1, ty);
  }

  /* ---------------- picking --------------------------------- */

  /**
   * Where a ray meets the ground. Marches forward until it passes below the
   * surface, then bisects. The heightfield is gentle enough that a stride of
   * a third of a tile cannot step over a hill, and bisection cleans up the
   * rest to well under a pixel.
   */
  rayHit(o, d, maxDist = 120) {
    if (d[1] >= 0 && o[1] > 6) return null;              // aimed at the sky
    const step = 0.34;
    let prev = 0, prevGap = o[1] - this.heightAt(o[0], o[2]);

    for (let s = step; s < maxDist; s += step) {
      const x = o[0] + d[0] * s, y = o[1] + d[1] * s, z = o[2] + d[2] * s;
      const gap = y - this.heightAt(x, z);
      if (gap <= 0 && prevGap > 0) {
        let lo = prev, hi = s;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2;
          const mx = o[0] + d[0] * mid, my = o[1] + d[1] * mid, mz = o[2] + d[2] * mid;
          if (my - this.heightAt(mx, mz) > 0) lo = mid; else hi = mid;
        }
        return [o[0] + d[0] * hi, o[1] + d[1] * hi, o[2] + d[2] * hi];
      }
      prev = s; prevGap = gap;
    }
    return null;
  }

  /** Rebuild everything: the map changed shape under us. */
  invalidate() {
    for (const m of this.chunks.values()) m.dispose();
    this.chunks.clear();
    this.heights.clear();
    this.colours.clear();
  }
}

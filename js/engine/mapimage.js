/* ============================================================
   The map, as one image
   ------------------------------------------------------------
   One pixel per tile, painted once and shared by the dial in
   the corner and the world map. The Throat is under two hundred
   tiles square, so the whole thing is about a hundred and forty
   kilobytes of canvas and costs nothing to keep.

   Nothing here is transmitted. The map is generated from the
   same definitions at both ends, so this is the client drawing
   something it already knows rather than something it was told.
   ============================================================ */

import { T, TILE_INFO, OBJ } from '../data/world.js';
import { hash2 } from '../util.js';

/** Landmarks worth finding from across the Throat, and what to call them. */
export const LANDMARKS = {
  bank:       { colour: '#e0b357', label: 'Bank' },
  altar:      { colour: '#c9bda6', label: 'Altar' },
  smelting:   { colour: '#e0762f', label: 'Furnace' },
  forging:    { colour: '#a8a0a0', label: 'Anvil' },
  cooking:    { colour: '#e0762f', label: 'Range' },
  apothecary: { colour: '#6f8a4a', label: 'Cauldron' },
  suturing:   { colour: '#c9bda6', label: 'Sewing table' },
  water:      { colour: '#86b7e0', label: 'Well' }
};

const cache = new WeakMap();

/**
 * The terrain, as a canvas the size of the world in tiles. Scenery is not on
 * it - the two maps want it at different sizes - so callers draw their own.
 */
export function terrainImage(world) {
  const hit = cache.get(world);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = world.w; c.height = world.h;
  const g = c.getContext('2d');
  const img = g.createImageData(world.w, world.h);
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const info = TILE_INFO[world.tileAt(x, y)] || TILE_INFO[T.VOID];
      // the same two-tone speckle the ground itself has, so the dial and the
      // world underneath it read as the same place
      const hex = (hash2(x, y, 5) > 0.5 ? info.c2 : info.c).slice(1);
      const n = parseInt(hex, 16);
      const o = (y * world.w + x) * 4;
      img.data[o] = (n >> 16) & 255;
      img.data[o + 1] = (n >> 8) & 255;
      img.data[o + 2] = n & 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  cache.set(world, c);
  return c;
}

/** The terrain with scenery dotted on it, which is what the minimap wants. */
export function minimapImage(world) {
  if (world._mmDotted) return world._mmDotted;
  const src = terrainImage(world);
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  for (const o of world.objects) {
    const d = OBJ[o.type];
    if (!d) continue;
    g.fillStyle = d.skill ? 'rgba(20,40,20,.55)' : 'rgba(230,200,120,.75)';
    g.fillRect(o.x, o.y, 1, 1);
  }
  world._mmDotted = c;
  return c;
}

/**
 * Everything on the map worth putting a pin in: the benches and booths that
 * decide where you have to walk back to. Worked out from the world rather
 * than from a hand-written list, so a content pack that adds a bank gets a
 * pin without anyone editing this file.
 */
export function landmarks(world) {
  if (world._landmarks) return world._landmarks;
  const out = [];
  for (const o of world.objects) {
    const d = OBJ[o.type];
    const kind = d && LANDMARKS[d.station];
    if (!kind) continue;
    // one pin per cluster: a row of four bank booths is one bank
    if (out.some(p => p.station === d.station &&
                      Math.abs(p.x - o.x) < 6 && Math.abs(p.y - o.y) < 6)) continue;
    out.push({ x: o.x, y: o.y, station: d.station, ...kind });
  }
  world._landmarks = out;
  return out;
}

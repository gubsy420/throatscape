/* ============================================================
   Meshes, and the handful of shapes everything is built from
   ------------------------------------------------------------
   Every model in the game is a pile of boxes, drums and cones
   with a colour baked into each face. That is a deliberate
   limit rather than a shortcut: it is what gives the world one
   look, and it is close to what the low-polygon models of the
   games this one follows were actually made of.

   Faces are flat-shaded, so vertices are never shared between
   triangles - each one carries the normal of its own face. At
   these polygon counts the duplication costs nothing and it is
   what keeps the facets crisp instead of smeared.
   ============================================================ */

/**
 * A colour to a triple in 0..1. Takes `#rrggbb`, an `rgb(r,g,b)` string - which
 * is what the game's own mix() and shade() hand back - or a triple already.
 */
export function rgb(c) {
  if (Array.isArray(c)) return c;
  if (c[0] === '#') {
    const n = parseInt(c.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return [1, 0, 1];                   // loud, so a typo is visible
  const p = m[1].split(',').map(Number);
  return [p[0] / 255, p[1] / 255, p[2] / 255];
}

/** Lightens or darkens, so one colour can dress a whole model. */
export function tone(c, amt) {
  const [r, g, b] = rgb(c);
  const f = v => Math.max(0, Math.min(1, v + amt));
  return [f(r), f(g), f(b)];
}

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.count = 0;
    // where the model sits, used for culling and for hanging name tags
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }

  /** One triangle, wound counter-clockwise when seen from the front. */
  tri(a, b, c, colour) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;

    const [r, g, bl] = colour;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      this.col.push(r, g, bl);
      for (let i = 0; i < 3; i++) {
        if (p[i] < this.min[i]) this.min[i] = p[i];
        if (p[i] > this.max[i]) this.max[i] = p[i];
      }
    }
    this.count += 3;
    return this;
  }

  /**
   * A triangle whose corners are three different colours. The ground is
   * built out of these: colouring per tile makes a chequerboard of every
   * open field, while colouring per corner lets one patch of turf shade
   * into the next the way a landscape does.
   */
  triC(a, b, c, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;

    const cols = [ca, cb, cc];
    const pts = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const p = pts[i], col = cols[i];
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      this.col.push(col[0], col[1], col[2]);
      for (let k = 0; k < 3; k++) {
        if (p[k] < this.min[k]) this.min[k] = p[k];
        if (p[k] > this.max[k]) this.max[k] = p[k];
      }
    }
    this.count += 3;
    return this;
  }

  /** A four-cornered face, wound the same way. */
  quad(a, b, c, d, colour) {
    this.tri(a, b, c, colour);
    this.tri(a, c, d, colour);
    return this;
  }

  /**
   * A box from one corner to the other. Each face is shaded separately -
   * top brightest, north and south a little darker, and the underside
   * darkest - which is what stops a flat-lit cube reading as a silhouette.
   */
  box(x0, y0, z0, x1, y1, z1, colour) {
    const c = rgb(colour);
    const f = amt => tone(c, amt);
    const p = (x, y, z) => [x, y, z];

    this.quad(p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), f(0.06));   // top
    this.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), f(-0.16));  // bottom
    this.quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), f(-0.02));  // south
    this.quad(p(x1, y0, z0), p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), f(-0.08));  // north
    this.quad(p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), f(-0.05));  // east
    this.quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), f(-0.05));  // west
    return this;
  }

  /**
   * A drum: trunks, limbs, pillars, barrels. Six sides is the sweet spot -
   * it reads as round in motion and still shows its facets standing still.
   */
  drum(cx, y0, cz, r0, r1, h, colour, sides = 6, spin = 0) {
    const c = rgb(colour);
    const y1 = y0 + h;
    for (let i = 0; i < sides; i++) {
      const a0 = spin + (i / sides) * Math.PI * 2;
      const a1 = spin + ((i + 1) / sides) * Math.PI * 2;
      const x0a = cx + Math.cos(a0) * r0, z0a = cz + Math.sin(a0) * r0;
      const x1a = cx + Math.cos(a1) * r0, z1a = cz + Math.sin(a1) * r0;
      const x0b = cx + Math.cos(a0) * r1, z0b = cz + Math.sin(a0) * r1;
      const x1b = cx + Math.cos(a1) * r1, z1b = cz + Math.sin(a1) * r1;

      // alternate faces a shade apart, so a six-sided trunk still has form
      const side = tone(c, (i % 2 ? -0.05 : 0.01));
      if (r1 > 0.0001) {
        this.quad([x0a, y0, z0a], [x1a, y0, z1a], [x1b, y1, z1b], [x0b, y1, z0b], side);
      } else {
        this.tri([x0a, y0, z0a], [x1a, y0, z1a], [cx, y1, cz], side);
      }
      if (r0 > 0.0001) this.tri([cx, y0, cz], [x1a, y0, z1a], [x0a, y0, z0a], tone(c, -0.16));
      if (r1 > 0.0001) this.tri([cx, y1, cz], [x0b, y1, z0b], [x1b, y1, z1b], tone(c, 0.07));
    }
    return this;
  }

  /** A cone, which is a drum that comes to a point. */
  cone(cx, y0, cz, r, h, colour, sides = 6, spin = 0) {
    return this.drum(cx, y0, cz, r, 0, h, colour, sides, spin);
  }

  /**
   * A crude ball, built as stacked rings. Two rings is a diamond, three is a
   * gem, four starts to look round; nothing here needs more.
   */
  ball(cx, cy, cz, r, colour, rings = 3, sides = 6) {
    const c = rgb(colour);
    let prev = null;
    for (let j = 0; j <= rings + 1; j++) {
      const t = j / (rings + 1);
      const phi = t * Math.PI;
      const ry = Math.cos(phi) * r, rr = Math.sin(phi) * r;
      const ring = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        ring.push([cx + Math.cos(a) * rr, cy + ry, cz + Math.sin(a) * rr]);
      }
      if (prev) {
        for (let i = 0; i < sides; i++) {
          const n = (i + 1) % sides;
          const shade = tone(c, 0.06 - t * 0.16 + (i % 2 ? -0.03 : 0));
          this.quad(prev[i], prev[n], ring[n], ring[i], shade);
        }
      }
      prev = ring;
    }
    return this;
  }

  /** A ramp or roof pitch: a box with one edge pulled down. */
  wedge(x0, y0, z0, x1, y1, z1, colour) {
    const c = rgb(colour);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z0], [x0, y1, z0], tone(c, 0.05));
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], tone(c, -0.16));
    this.tri([x1, y0, z0], [x1, y1, z0], [x1, y0, z1], tone(c, -0.05));
    this.tri([x0, y0, z0], [x0, y0, z1], [x0, y1, z0], tone(c, -0.05));
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], tone(c, -0.09));
    return this;
  }

  /** A flat panel lying on the ground: rugs, stains, lily pads. */
  slab(x0, z0, x1, z1, y, colour) {
    return this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], rgb(colour));
  }

  /** Everything added from here on is shifted by this much. */
  translated(dx, dy, dz) {
    for (let i = 0; i < this.pos.length; i += 3) {
      this.pos[i] += dx; this.pos[i + 1] += dy; this.pos[i + 2] += dz;
    }
    for (let i = 0; i < 3; i++) {
      const d = [dx, dy, dz][i];
      this.min[i] += d; this.max[i] += d;
    }
    return this;
  }

  build(gl) { return new Mesh(gl, this); }
}

/**
 * Vertex data living on the card. Built once and drawn many times: the
 * terrain builds one of these per chunk, and every creature of a kind shares
 * a single one, moved into place by the model matrix.
 */
export class Mesh {
  constructor(gl, b) {
    this.gl = gl;
    this.count = b.count;
    this.min = b.min.slice();
    this.max = b.max.slice();
    // how far a corner can be from the origin: all a sphere cull needs
    this.radius = Math.max(
      Math.hypot(b.min[0], b.min[1], b.min[2]),
      Math.hypot(b.max[0], b.max[1], b.max[2])
    ) || 1;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buffers = [];
    const attrib = (loc, data) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      this.buffers.push(buf);
    };
    attrib(0, b.pos);
    attrib(1, b.nrm);
    attrib(2, b.col);
    gl.bindVertexArray(null);
  }

  draw() {
    if (!this.count) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }

  dispose() {
    const gl = this.gl;
    for (const b of this.buffers) gl.deleteBuffer(b);
    gl.deleteVertexArray(this.vao);
    this.count = 0;
  }
}

/* ============================================================
   4x4 matrices and 3-vectors
   ------------------------------------------------------------
   Column-major, which is what WebGL expects, so a matrix goes
   straight to uniformMatrix4fv without transposing. Everything
   writes into a destination array rather than allocating, so
   the render loop can run without making garbage.
   ============================================================ */

export const m4 = () => new Float32Array(16);

export function identity(o) {
  o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
  o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
  return o;
}

/** o = a * b, in the sense that o transforms by b and then by a. */
export function multiply(o, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
}

export function perspective(o, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), d = 1 / (near - far);
  o.fill(0);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) * d;
  o[11] = -1;
  o[14] = 2 * far * near * d;
  return o;
}

export function lookAt(o, eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  o[15] = 1;
  return o;
}

/**
 * A model matrix built the only way anything in this game needs one: moved
 * somewhere, spun about the vertical, and possibly scaled. Cheaper and much
 * harder to get wrong than composing three matrices.
 */
export function model(o, x, y, z, yaw, sx = 1, sy = sx, sz = sx) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  /*
   * Yaw is a heading, matching what atan2(east, -south) gives and what the
   * camera means by the same word: 0 faces north. Models are built facing
   * north too - a rat's snout is at -z - so local -z has to come out at
   * (sin yaw, 0, -cos yaw), which is what fixes these two signs. Get them
   * the other way round and everything in the world faces backwards, walks
   * backwards, and swings its sword over its shoulder.
   */
  o[0] = c * sx;   o[1] = 0;   o[2] = s * sx;  o[3] = 0;
  o[4] = 0;        o[5] = sy;  o[6] = 0;       o[7] = 0;
  o[8] = -s * sz;  o[9] = 0;   o[10] = c * sz; o[11] = 0;
  o[12] = x;       o[13] = y;  o[14] = z;      o[15] = 1;
  return o;
}

/**
 * A limb: the parent's matrix, then out to the joint, then a swing about the
 * side-to-side axis and a lift about the front-to-back one. Written out
 * rather than composed from three matrices because every limb of every
 * creature on screen goes through it on every frame.
 */
export function limb(o, base, px, py, pz, swing, lift) {
  const cs = Math.cos(swing), ss = Math.sin(swing);
  const cl = Math.cos(lift), sl = Math.sin(lift);

  // rotation about X (swing) then about Z (lift), as one 3x3
  const r00 = cl,       r01 = -sl,      r02 = 0;
  const r10 = cs * sl,  r11 = cs * cl,  r12 = -ss;
  const r20 = ss * sl,  r21 = ss * cl,  r22 = cs;

  for (let c = 0; c < 3; c++) {
    const a0 = base[c], a1 = base[4 + c], a2 = base[8 + c];
    o[c]     = a0 * r00 + a1 * r10 + a2 * r20;
    o[4 + c] = a0 * r01 + a1 * r11 + a2 * r21;
    o[8 + c] = a0 * r02 + a1 * r12 + a2 * r22;
    o[12 + c] = a0 * px + a1 * py + a2 * pz + base[12 + c];
  }
  o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1;
  return o;
}

/** Returns false rather than throwing when the matrix is singular. */
export function invert(o, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return false;
  det = 1 / det;

  o[0]  = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1]  = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2]  = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3]  = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4]  = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5]  = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6]  = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7]  = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8]  = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9]  = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}

/** Transforms a point and divides through by w. Returns [x, y, z]. */
export function project(m, x, y, z, out = [0, 0, 0]) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  out[0] = (m[0] * x + m[4] * y + m[8]  * z + m[12]) / w;
  out[1] = (m[1] * x + m[5] * y + m[9]  * z + m[13]) / w;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  return out;
}

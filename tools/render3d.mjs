/* ============================================================
   Renderer checks
   ------------------------------------------------------------
   The 3D view is the one part of the game a player can see but
   no other test can. A wrong matrix does not throw, a model
   that builds nothing does not throw, and a content pack that
   invents a creature nobody has modelled does not throw - it
   just leaves a hole in the world that only shows up when
   somebody walks into it.

   None of this needs a graphics card. The maths is arithmetic,
   and a mesh is a list of numbers until the moment it is handed
   to the card, so the card is stubbed out and everything up to
   that point is checked here.

   Usage:  node tools/render3d.mjs
   ============================================================ */

import { loadGame, say } from './lib.mjs';

let fails = 0;
const ok = (c, m) => { say((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const head = m => say('\n== ' + m);
const near = (a, b, e = 1e-5) => Math.abs(a - b) < e;

/* Enough DOM for the modules that touch it at import time. */
const stub2d = new Proxy({}, { get: () => () => {} });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => stub2d })
};
globalThis.window = { devicePixelRatio: 1 };

const game = await loadGame();

const mat = await import('../js/engine/gl/mat4.js');
const { MeshBuilder, rgb, tone } = await import('../js/engine/gl/mesh.js');
const { Camera } = await import('../js/engine/gl/camera.js');
const { Terrain } = await import('../js/engine/models/terrain.js');
const { CreatureModels, CREATURE_KINDS } = await import('../js/engine/models/creatures.js');
const { SceneryModels, SCENERY_ARTS } = await import('../js/engine/models/scenery.js');

/**
 * A graphics card that only counts. Meshes are built against it exactly as
 * they are in the browser, so a builder that throws or produces nothing is
 * caught here rather than by a player staring at empty ground.
 */
function fakeGl() {
  return {
    TRIANGLES: 4, ARRAY_BUFFER: 34962, FLOAT: 5126, STATIC_DRAW: 35044,
    createVertexArray: () => ({}), bindVertexArray: () => {},
    createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
    enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
    deleteBuffer: () => {}, deleteVertexArray: () => {}, drawArrays: () => {}
  };
}
const gl = fakeGl();

/* ============================================================
   Matrices
   ============================================================ */

head('the matrix maths');
{
  const m = mat.m4(), inv = mat.m4(), back = mat.m4();
  mat.perspective(m, 0.86, 1.6, 0.3, 140);
  ok(mat.invert(inv, m), 'a projection matrix can be inverted');
  mat.multiply(back, m, inv);
  let worst = 0;
  for (let i = 0; i < 16; i++) worst = Math.max(worst, Math.abs(back[i] - (i % 5 === 0 ? 1 : 0)));
  ok(worst < 1e-5, `and times its inverse is the identity (off by ${worst.toExponential(1)})`);

  const view = mat.m4();
  mat.lookAt(view, [0, 5, 10], [0, 0, 0], [0, 1, 0]);
  const p = mat.project(view, 0, 0, 0);
  ok(near(p[0], 0) && near(p[1], 0), 'what the camera looks at lands in the middle of the view');
  ok(p[2] < 0, 'and in front of it, which is where -z means');

  /*
   * Yaw has to mean the same thing to a model as it does to the camera and
   * to headingOf, or the whole world faces backwards - which is exactly what
   * it did until this check was written.
   */
  const mm = mat.m4();
  mat.model(mm, 3, 1, 4, Math.PI / 2, 1);
  const q = mat.project(mm, 1, 0, 0);
  ok(near(q[0], 3) && near(q[2], 5), `a quarter turn sends +x to +z (got ${q.map(v => v.toFixed(2))})`);

  for (const [name, yaw, fx, fz] of [
    ['north', 0, 0, -1], ['east', Math.PI / 2, 1, 0],
    ['south', Math.PI, 0, 1], ['west', -Math.PI / 2, -1, 0]
  ]) {
    mat.model(mm, 0, 0, 0, yaw, 1);
    const f = mat.project(mm, 0, 0, -1);          // models are built facing north
    ok(near(f[0], fx, 1e-6) && near(f[2], fz, 1e-6),
       `yaw ${yaw.toFixed(2)} points a model ${name} (${f[0].toFixed(2)}, ${f[2].toFixed(2)})`);
  }

  // and a limb at rest must be exactly its parent, moved to the joint
  const base = mat.m4(), out = mat.m4();
  mat.model(base, 2, 0, 7, 0.4, 1);
  mat.limb(out, base, 0.1, 0.9, 0, 0, 0);
  const rest = mat.project(out, 0, 0, 0);
  const want = mat.project(base, 0.1, 0.9, 0);
  ok(near(rest[0], want[0]) && near(rest[1], want[1]) && near(rest[2], want[2]),
     'an unbent limb is its parent moved to the joint');

  mat.limb(out, base, 0, 1, 0, Math.PI / 2, 0);
  const bent = mat.project(out, 0, 1, 0);
  const hinge = mat.project(base, 0, 1, 0);
  ok(near(bent[1], hinge[1], 1e-4),
     'and a limb swung a quarter turn is horizontal, not still upright');
}

/* ============================================================
   The camera
   ============================================================ */

head('the camera');
{
  const cam = new Camera();
  cam.target = [40, 1, 60];
  cam.update(1.6);

  ok(cam.eye[1] > cam.target[1], 'it sits above what it is looking at');
  ok(near(cam.eye[0], 40) && cam.eye[2] > 60,
     'and, facing north, due south of it - so north is up and east is right');

  /*
   * Every click in the game goes screen -> ray -> world, and every label goes
   * world -> screen. If those two disagree the game is unplayable, so they
   * are checked against each other at a spread of angles.
   */
  const vw = 1024, vh = 640;
  for (const yaw of [0, 0.9, -2.2, Math.PI]) {
    for (const pitch of [0.25, 0.62, 1.1, 1.45]) {
      cam.yaw = yaw; cam.pitch = pitch; cam.update(vw / vh);
      let worst = 0;
      for (const [px, py] of [[vw / 2, vh / 2], [80, 90], [vw - 60, vh - 70], [300, 500]]) {
        const { o, d } = cam.ray(px, py, vw, vh);
        const t = 14;
        const s = cam.toScreen(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t, vw, vh);
        worst = Math.max(worst, Math.abs(s.x - px), Math.abs(s.y - py));
      }
      ok(worst < 0.01,
         `yaw ${yaw.toFixed(2)} pitch ${pitch}: a ray cast from a pixel projects back to it (off by ${worst.toExponential(1)})`);
    }
  }

  cam.yaw = 0; cam.pitch = 0.62; cam.update(vw / vh);
  ok(cam.visible(40, 1, 60, 1), 'what it is aimed at counts as visible');
  ok(!cam.visible(40, 1, 60 - 200, 1), 'something two hundred tiles behind it does not');
}

head('the camera keys stay inside their limits');
{
  const cam = new Camera();
  cam.keys.add('ArrowDown');
  for (let i = 0; i < 600; i++) cam.step(1 / 60);
  ok(cam.pitch > 0.15 && cam.pitch < 0.3, `held down, the tilt bottoms out at ${cam.pitch.toFixed(2)} rad`);
  cam.keys.clear(); cam.keys.add('ArrowUp');
  for (let i = 0; i < 600; i++) cam.step(1 / 60);
  ok(cam.pitch > 1.4 && cam.pitch < 1.5, `held up, it tops out at ${cam.pitch.toFixed(2)} rad, short of straight down`);
  cam.keys.clear();

  cam.keys.add('ArrowLeft');
  let big = 0;
  for (let i = 0; i < 3600; i++) { cam.step(1 / 60); big = Math.max(big, Math.abs(cam.yaw)); }
  ok(big <= Math.PI + 1e-9, `spinning for a minute never winds past +-pi (peak ${big.toFixed(3)})`);
  cam.keys.clear();

  const before = cam.dist;
  for (let i = 0; i < 200; i++) cam.zoomBy(-1);
  ok(cam.dist >= 5 && cam.dist < before, `the wheel zooms in but stops at ${cam.dist}`);
  for (let i = 0; i < 200; i++) cam.zoomBy(1);
  ok(cam.dist <= 22, `and out, stopping at ${cam.dist}`);

  cam.yaw = 2; cam.faceNorth();
  ok(cam.yaw === 0, 'the compass puts it back on north');
}

/* ============================================================
   The ground
   ============================================================ */

head('the ground');
{
  const world = game.world.buildWorld();
  const terrain = new Terrain(world);

  /*
   * Heights live on corners so that neighbouring tiles share them. If they
   * did not, every tile edge in the world would be a crack you could see
   * the sky through, so this is the invariant the landscape rests on.
   */
  let worst = 0;
  for (let x = 20; x < 60; x++) {
    for (let y = 140; y < 175; y++) {
      const east = terrain.heightAt(x + 1 - 1e-7, y + 0.5);
      const westOfNext = terrain.heightAt(x + 1 + 1e-7, y + 0.5);
      worst = Math.max(worst, Math.abs(east - westOfNext));
    }
  }
  ok(worst < 1e-4, `the ground is continuous across tile edges (worst seam ${worst.toExponential(1)})`);

  let lo = Infinity, hi = -Infinity;
  for (let x = 8; x < 180; x += 3) {
    for (let y = 8; y < 180; y += 3) {
      const h = terrain.tileHeight(x, y);
      if (world.tileAt(x, y) === game.world.T.VOID) continue;
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
  }
  ok(hi - lo > 0.3, `the land actually rises and falls (${lo.toFixed(2)} to ${hi.toFixed(2)})`);
  ok(hi - lo < 3, 'but gently: nothing walkable turns into a cliff');

  // a floor you can put a building on
  const floors = [];
  for (let x = 8; x < 180; x++) {
    for (let y = 8; y < 180; y++) {
      if (world.tileAt(x, y) === game.world.T.FLOOR) floors.push([x, y]);
    }
  }
  ok(floors.length > 0, `${floors.length} floor tiles to check`);
  let step = 0;
  for (const [x, y] of floors) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (world.tileAt(x + dx, y + dy) !== game.world.T.FLOOR) continue;
      step = Math.max(step, Math.abs(terrain.tileHeight(x, y) - terrain.tileHeight(x + dx, y + dy)));
    }
  }
  ok(step < 0.06, `indoor floors are level, so nothing is built on a slope (worst step ${step.toFixed(3)})`);

  const cam = new Camera();
  cam.target = [30.5, terrain.heightAt(30.5, 152.5) + 0.9, 152.5];
  cam.pitch = 0.62;
  cam.update(1.6);
  let hits = 0, tried = 0;
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      const tx = 30 + dx, ty = 152 + dy;
      const s = cam.toScreen(tx + 0.5, terrain.tileHeight(tx, ty), ty + 0.5, 1024, 640);
      if (!s.visible) continue;
      const { o, d } = cam.ray(s.x, s.y, 1024, 640);
      const hit = terrain.rayHit(o, d);
      tried++;
      if (hit && Math.floor(hit[0]) === tx && Math.floor(hit[2]) === ty) hits++;
    }
  }
  ok(tried > 40 && hits === tried,
     `${hits}/${tried} tiles around the spawn can be clicked back onto themselves`);

  const mesh = terrain.chunkMesh(gl, 1, 9);
  ok(mesh.count > 0 && mesh.count % 3 === 0,
     `a chunk of Lumbrisdale meshes into ${mesh.count / 3} triangles`);
}

/* ============================================================
   Models
   ------------------------------------------------------------
   Every art kind the game data actually uses has to have a
   model. A content pack can invent a new one, and there is a
   deliberate fallback for that, but nothing that ships with the
   game should be relying on it.
   ============================================================ */

head('every creature in the game has a model');
{
  const models = new CreatureModels(gl);
  const kinds = new Set(Object.values(game.NPCS).map(n => n.art.k));
  for (const k of [...kinds].sort()) {
    ok(CREATURE_KINDS.includes(k), `${k} is modelled, not falling back to a blob`);
  }
  for (const [id, n] of Object.entries(game.NPCS)) {
    const m = models.get(n.art);
    const tris = m.parts.reduce((s, p) => s + p.mesh.count, 0) / 3;
    ok(tris > 0 && m.height > 0.2, `${id} builds ${tris} triangles, ${m.height.toFixed(2)} tiles tall`);
  }
  // one model per kind, however many of them are walking around
  const before = models.cache.size;
  for (let i = 0; i < 50; i++) models.get(Object.values(game.NPCS)[0].art);
  ok(models.cache.size === before, 'and asking again reuses it rather than rebuilding');
}

head('every piece of scenery has a model');
{
  const models = new SceneryModels(gl);
  const arts = new Set(Object.values(game.world.OBJ).map(o => o.art));
  for (const a of [...arts].sort()) {
    ok(SCENERY_ARTS.includes(a), `${a} is modelled`);
  }
  for (const [type, def] of Object.entries(game.world.OBJ)) {
    const m = models.get(type, def);
    const tris = m.parts.reduce((s, p) => s + p.mesh.count, 0) / 3;
    ok(tris > 0, `${type} builds ${tris} triangles`);
  }
  const door = models.get('door', game.world.OBJ.door);
  ok(door.parts.some(p => p.joint === 'hinge'), 'and a door has a half that swings');
}

head('the mesh builder');
{
  const b = new MeshBuilder();
  b.box(-1, 0, -1, 1, 2, 1, '#ff8800');
  ok(b.count === 36, `a box is ${b.count / 3} triangles`);
  ok(b.min[1] === 0 && b.max[1] === 2, 'and knows how tall it is');

  // the top face has to face up, or the light lands on the wrong side of it
  let up = 0;
  for (let i = 0; i < b.nrm.length; i += 3) if (b.nrm[i + 1] > 0.99) up++;
  ok(up === 6, `its top is ${up} vertices of upward-facing normal`);

  ok(near(rgb('#ff8800')[0], 1) && near(rgb('#ff8800')[2], 0), 'hex colours parse');
  const parsed = rgb('rgb(255,136,0)');
  ok(near(parsed[0], 1) && near(parsed[1], 136 / 255), 'and so do the rgb() strings mix() returns');
  ok(tone('#808080', 0.5)[0] > 0.99, 'tone clamps rather than wrapping round');
}

/* ============================================================ */

say('\n' + (fails ? `${fails} PROBLEM(S) WITH THE RENDERER` : 'the renderer holds up'));
process.exit(fails ? 1 : 0);

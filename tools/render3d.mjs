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

   Usage:  node tools/render3d.mjs                          # the game as published
           node tools/render3d.mjs content/packs/x.json     # with a pack on top
   ============================================================ */

import { readJson, loadGame, say } from './lib.mjs';

let fails = 0;
const ok = (c, m) => { say((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const head = m => say('\n== ' + m);
const near = (a, b, e = 1e-5) => Math.abs(a - b) < e;

/*
 * The game is loaded first, and only then is the DOM faked.
 *
 * content.js decides how to read its packs by looking for `window`: in a
 * browser it fetches them, in node it reads them off the disk. Stubbing the
 * DOM before loading sent it down the browser path, where the fetch failed
 * and was swallowed - a game with no packs is a legitimate state - so this
 * file spent its whole life checking the base game and reporting success on
 * content it had never seen.
 */
const game = await loadGame();

/*
 * A pack is checked before it is published, so it is not in the load order
 * yet. Apply it here if it is not already in - a gate that quietly tests the
 * game without the thing it was handed is worse than no gate, because it
 * reports success.
 */
const arg = process.argv.slice(2).find(a => !a.startsWith('--'));
let applied = 0;
if (arg) {
  const candidate = await readJson(arg);
  if (!game.content.loadedPacks().some(p => p.id === candidate.id)) {
    game.content.applyPack(candidate);
    applied = 1;
    say(`applied ${candidate.id} on top of the published packs`);
  } else {
    say(`${candidate.id} is already published`);
  }
}

/* Enough DOM for the engine modules that touch it at import time. */
const stub2d = new Proxy({}, { get: () => () => {} });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => stub2d })
};
globalThis.window = { devicePixelRatio: 1 };

const mat = await import('../js/engine/gl/mat4.js');
const { MeshBuilder, rgb, tone } = await import('../js/engine/gl/mesh.js');
const { Camera } = await import('../js/engine/gl/camera.js');
const { Terrain } = await import('../js/engine/models/terrain.js');
const { CreatureModels, CREATURE_KINDS } = await import('../js/engine/models/creatures.js');
const { SceneryModels, SCENERY_ARTS, SPENT_ARTS } = await import('../js/engine/models/scenery.js');
const { ItemModels, ITEM_KINDS } = await import('../js/engine/models/items.js');

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
   What is actually being checked
   ------------------------------------------------------------
   Everything below asks whether the game's data can be drawn,
   so it matters enormously that the data includes what the
   content packs added. It did not for the whole of this file's
   first life, and nothing said so.
   ============================================================ */

head('the packs are in the game being checked');
{
  const loaded = game.content.loadedPacks();
  const listed = (await readJson('content/index.json')).packs || [];
  const want = listed.length + applied;      // the candidate is not in the index yet
  ok(loaded.length === want,
     `${loaded.length} of ${want} packs loaded` +
     (loaded.length ? `: ${loaded.map(p => p.id).join(', ')}` : ''));

  /*
   * And they really are in the registries, not merely read. A pack that
   * loads but applies nothing would leave every check below testing the
   * base game while looking like it had done more.
   */
  if (loaded.length) {
    const added = new Set(loaded.flatMap(p => (p.items || []).map(i => i.id)));
    const present = [...added].filter(id => game.ITEMS[id]);
    ok(!added.size || present.length === added.size,
       `and the ${added.size} item(s) they add are in the game`);
    const fromPack = Object.values(game.ITEMS).filter(i => i.fromPack).length;
    ok(fromPack > 0 || !added.size, `${fromPack} items in the world came from a pack`);
  }
}

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
  const joint = mat.project(base, 0, 1, 0);
  ok(near(bent[1], joint[1], 1e-4),
     'and a limb swung a quarter turn is horizontal, not still upright');

  /*
   * A door turns about the vertical. limb() turns about the other two axes,
   * which is what a shoulder does - and using it on a door made every door
   * in the game tip over sideways into its own wall instead of opening.
   */
  const dm = mat.m4(), dl = mat.m4();
  mat.model(dm, 0, 0, 0, 0, 1);
  mat.hinge(dl, dm, 0, 0, 0, Math.PI / 2);
  const leaf = mat.project(dl, 1, 0, 0);
  ok(near(leaf[1], 0, 1e-6),
     'a hinge keeps the door upright: no part of it leaves the ground plane');
  ok(near(leaf[0], 0, 1e-6) && near(leaf[2], 1, 1e-6),
     `and swings it a quarter turn about the pin (${leaf.map(v => v.toFixed(2))})`);

  mat.hinge(dl, dm, 0, 0, 0, 0);
  const shut = mat.project(dl, 1, 0, 0);
  ok(near(shut[0], 1) && near(shut[2], 0), 'a shut door is exactly where it was built');

  // and it has to agree with model(), or a door opens the wrong way round
  const rot = mat.m4();
  mat.model(rot, 0, 0, 0, 0.7, 1);
  mat.hinge(dl, dm, 0, 0, 0, 0.7);
  const a = mat.project(rot, 1, 0, 0), b2 = mat.project(dl, 1, 0, 0);
  ok(near(a[0], b2[0], 1e-6) && near(a[2], b2[2], 1e-6),
     'a hinge turns the same way a heading does');
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

/* ============================================================
   Arriving somewhere
   ------------------------------------------------------------
   The walk cycle used to ask whether the interpolated position
   had caught up with the real one. It is a float comparison and
   it never came out true: a snapshot arriving a few ms early
   leaves the interpolation a hair short and every tick after
   only halves the gap. So the legs walked on the spot forever,
   and headingOf read the leftover hair as a direction.
   ============================================================ */

head('a character that has stopped walking stops walking');
{
  const { Renderer3D } = await import('../js/engine/render3d.js');
  const walkPhase = e => Renderer3D.prototype.walkPhase.call({ alpha: 0.5 }, e);
  const headingOf = e => Renderer3D.prototype.headingOf.call({}, e);
  const lerp = (a, b, t) => a + (b - a) * t;

  /*
   * A player walking one tile east and then standing still, run exactly the
   * way net.js and the render loop run it: the snapshot copies the render
   * position into ix, and the frame interpolates towards the tile.
   */
  /*
   * Deliberately without the snap the render loop also does. The renderer has
   * to be right on its own: if it only stops walking because something else
   * tidied the numbers up first, then any caller that does not tidy them gets
   * the bug back, and this check would not notice.
   */
  const step = (e, toX, toY, stepping, lastAlpha) => {
    e.stepping = stepping;                       // net.js, from the tile change
    e.ix = e.rx; e.iy = e.ry;
    e.x = toX; e.y = toY;
    if (stepping) e.steps = (e.steps || 0) + 1;
    e.rx = lerp(e.ix, e.x, lastAlpha);
    e.ry = lerp(e.iy, e.y, lastAlpha);
  };

  const e = { x: 29, y: 40, ix: 29, iy: 40, rx: 29, ry: 40 };
  step(e, 30, 40, true, 0.93);                   // one stride east, snapshot a touch early
  ok(walkPhase(e) > 0, 'mid-stride the legs are moving');
  ok(Math.abs(headingOf(e) - Math.PI / 2) < 1e-6, 'and it is facing east, where it is going');

  // now it stands still, and is asked about for ten seconds of ticks
  let stillWalking = 0;
  let worstResidue = 0;
  for (let tick = 0; tick < 16; tick++) {
    step(e, 30, 40, false, 0.93);
    if (walkPhase(e) !== 0) stillWalking++;
    worstResidue = Math.max(worstResidue, Math.abs(e.rx - e.x));
  }
  ok(!stillWalking, stillWalking
    ? `the legs kept going for ${stillWalking} of 16 ticks after it arrived`
    : 'the legs stop on the tick it arrives, and stay stopped');
  ok(worstResidue > 0,
     `and they stop while the interpolation is still ${worstResidue.toExponential(1)} of a ` +
     'tile short, which is the state it never gets out of');

  /*
   * The render loop puts a stopped body exactly on its tile as well, so the
   * residue above never actually reaches the screen. That is the policy, and
   * this is it stated where a test can see it.
   */
  const place = (o, alpha) => o.stepping
    ? { rx: lerp(o.ix, o.x, alpha), ry: lerp(o.iy, o.y, alpha) }
    : { rx: o.x, ry: o.y };
  const parked = place({ x: 30, y: 40, ix: 29.999999, iy: 40, stepping: false }, 0.93);
  ok(parked.rx === 30 && parked.ry === 40, 'a stopped body sits on its tile, not a hair short of it');
  const mid = place({ x: 30, y: 40, ix: 29, iy: 40, stepping: true }, 0.5);
  ok(mid.rx === 29.5, 'and one mid-stride is still interpolated');

  /*
   * The heading is the other half of the same bug: a remainder of a
   * millionth of a tile due east reads as a heading of exactly ninety
   * degrees, so everyone turned to face east the moment they stopped.
   */
  const north = { x: 40, y: 39, ix: 40, iy: 40, rx: 40, ry: 40, stepping: true };
  ok(Math.abs(headingOf(north)) < 1e-6, 'a step north faces north');
  const settled = { x: 40, y: 39, ix: 40, iy: 39 + 1e-9, rx: 40, ry: 39, stepping: false,
                    _heading: 0 };
  ok(headingOf(settled) === 0, 'and a millionth of a tile left over is not a new direction');

  ok(walkPhase({ x: 1, y: 1, ix: 1, iy: 1 }) === 0,
     'something that has never had a snapshot is standing still, not walking');
}

head('the camera can be dragged as well as keyed');
{
  const { Camera, PITCH_MIN, PITCH_MAX, DRAG_YAW } = await import('../js/engine/gl/camera.js');

  /*
   * Dragging does what the arrow key of the same direction does, which is
   * the only mapping that does not need explaining to somebody who has
   * already learned the keys.
   */
  const keyed = new Camera(), dragged = new Camera();
  keyed.keys.add('ArrowLeft');
  for (let i = 0; i < 30; i++) keyed.step(1 / 60);
  dragged.dragBy(-120, 0);
  ok(Math.sign(keyed.yaw) === Math.sign(dragged.yaw) && dragged.yaw !== 0,
     `dragging left turns the same way holding Left does (${dragged.yaw.toFixed(2)} rad)`);

  const up = new Camera(), keyUp = new Camera();
  keyUp.keys.add('ArrowUp');
  for (let i = 0; i < 30; i++) keyUp.step(1 / 60);
  up.dragBy(0, -120);
  ok(up.pitch > 0.62 && keyUp.pitch > 0.62, 'and dragging up tilts the same way Up does');

  const c = new Camera();
  for (let i = 0; i < 200; i++) c.dragBy(0, -80);
  ok(c.pitch <= PITCH_MAX + 1e-9, `dragged to the top it stops at ${c.pitch.toFixed(2)} rad`);
  for (let i = 0; i < 400; i++) c.dragBy(0, 80);
  ok(c.pitch >= PITCH_MIN - 1e-9, `and at the bottom, ${c.pitch.toFixed(2)} rad`);

  const spin = new Camera();
  let big = 0;
  for (let i = 0; i < 2000; i++) { spin.dragBy(40, 0); big = Math.max(big, Math.abs(spin.yaw)); }
  ok(big <= Math.PI + 1e-9, `spinning by hand never winds past +-pi (peak ${big.toFixed(3)})`);

  ok(DRAG_YAW > 0.001 && DRAG_YAW < 0.05,
     `a pixel is ${DRAG_YAW} rad, so a 300 px drag is ${(DRAG_YAW * 300).toFixed(2)} rad`);
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

/* ============================================================
   Resource nodes
   ------------------------------------------------------------
   A tree the same height as the woman chopping it is not a
   tree, and a chopped tree drawn at 45% opacity is still a
   tree - the dither is subtle enough that you walk back to it.
   Both of those are things a screenshot shows and no test did.
   ============================================================ */

head('a resource node is bigger than the person working it');
{
  const scenery = new SceneryModels(gl);
  const creatures = new CreatureModels(gl);
  const nurse = creatures.player('#e8e0cd', null).height;
  ok(nurse > 1 && nurse < 2, `a nurse stands ${nurse.toFixed(2)} tiles tall`);

  const nodes = Object.entries(game.world.OBJ).filter(([, d]) => d.skill);
  ok(nodes.length > 8, `${nodes.length} things in the world can be harvested`);

  for (const [type, d] of nodes.filter(([, d]) => d.art === 'tree')) {
    const h = scenery.get(type, d).height;
    ok(h > nurse * 2, `${type} stands ${h.toFixed(2)} tiles, over twice her height`);
  }

  /*
   * The rest do not have to tower, but a node you cannot pick out of the
   * grass from ten tiles up is a node you never harvest.
   */
  for (const [type, d] of nodes.filter(([, d]) => d.art !== 'tree' && d.art !== 'pool')) {
    const h = scenery.get(type, d).height;
    ok(h > 0.6, `${type} is ${h.toFixed(2)} tiles, tall enough to find`);
  }
}

head('a worked-out node changes shape rather than fading');
{
  const scenery = new SceneryModels(gl);

  /*
   * Anything that respawns can be caught empty, and while it is empty it has
   * to say so with its silhouette. Pools never deplete - they are fished
   * indefinitely - so they are the one kind that may go without.
   */
  const perishable = Object.entries(game.world.OBJ).filter(([, d]) => d.skill && d.respawn > 0);
  ok(perishable.length > 5, `${perishable.length} node types run out and come back`);

  for (const [type, d] of perishable) {
    const full = scenery.get(type, d, false);
    const spent = scenery.get(type, d, true);
    ok(spent.spent === true, spent.spent
      ? `${type} has a worked-out shape of its own`
      : `${type} respawns but its art "${d.art}" has no worked-out shape — ` +
        `a node that runs out must use one of: ${SPENT_ARTS.join(', ')}`);
    ok(spent !== full, 'which is a different model, not the same one dimmed');
    ok(spent.height < full.height,
       `and a lower one: ${full.height.toFixed(2)} tiles becomes ${spent.height.toFixed(2)}`);
    ok(spent.parts.reduce((s, p) => s + p.mesh.count, 0) > 0, 'and it builds geometry');
  }

  // asking twice must not build twice, in either state
  const size = scenery.cache.size;
  for (let i = 0; i < 20; i++) {
    scenery.get('throatwood', game.world.OBJ.throatwood, i % 2 === 0);
  }
  ok(scenery.cache.size === size, 'and both shapes are built once and shared');

  ok(SPENT_ARTS.every(a => SCENERY_ARTS.includes(a)),
     `the ${SPENT_ARTS.length} worked-out shapes all belong to something real`);
}

head('every harvest has a motion and something to do it with');
{
  const { gatherKind, GATHER_KINDS } = await import('../js/engine/render3d.js');

  const nodes = Object.entries(game.world.OBJ).filter(([, d]) => d.skill);
  const used = new Map();
  for (const [type, d] of nodes) {
    const k = gatherKind(d);
    ok(GATHER_KINDS.includes(k), `${type}: ${k}`);
    if (!used.has(k)) used.set(k, []);
    used.get(k).push(type);
  }
  ok(used.size >= 4, `${used.size} distinct motions across the gathering skills`);

  ok(gatherKind(game.world.OBJ.throatwood) === 'chop', 'a tree is chopped');
  ok(gatherKind(game.world.OBJ.ironblood_vein) === 'mine', 'a vein is mined');
  ok(gatherKind(game.world.OBJ.herb_patch) === 'forage', 'a herb is picked by hand');
  ok(gatherKind(game.world.OBJ.leech_pool) === 'net', 'a leech pool is netted');
  ok(gatherKind(game.world.OBJ.eel_hole) === 'gaff', 'an eel hole is gaffed');
  ok(gatherKind(undefined) === 'forage', 'and something with no tool at all is done bare-handed');

  /*
   * The motion puts the tool in the hand, so every node that names one has
   * to have something in the game that answers to it - otherwise the player
   * mines with an empty fist and there is nothing on screen to say why.
   */
  const byTool = new Map();
  for (const it of Object.values(game.ITEMS)) {
    if (it.tool && !byTool.has(it.tool)) byTool.set(it.tool, it);
  }
  for (const [type, d] of nodes) {
    if (!d.tool) continue;
    ok(byTool.has(d.tool), `${type} wants ${d.tool}, and something in the game is one`);
  }

  /*
   * And it has to be big enough to notice. The weapons were all rebuilt once
   * already for exactly this - held at their real size next to a person they
   * vanish into the fist - and a pick swung at a rock has the same job to do.
   */
  const models = new ItemModels(gl);
  const wanted = [...new Set(nodes.map(([, d]) => d.tool).filter(Boolean))];
  for (const t of wanted) {
    const it = byTool.get(t);
    if (!it) continue;
    const across = models.get(it.art).radius * 2;
    ok(across > 0.8, `${it.id} is ${across.toFixed(2)} tiles end to end, which reads in the hand`);
  }
}

head('the gathering motions are actually different from each other')
{
  const r3d = await import('../js/engine/render3d.js');
  const src = await (await import('node:fs/promises'))
    .readFile((await import('./lib.mjs')).rel('js/engine/render3d.js'), 'utf8');

  /*
   * The poses live in a private table, so this checks the thing that can be
   * seen from outside: that each motion is written, and that no two share a
   * body. A copy-pasted chop and mine would read identically on screen.
   */
  for (const k of r3d.GATHER_KINDS) {
    ok(new RegExp(`\\n  ${k}: t =>`).test(src), `${k} has a motion of its own`);
  }
  const grips = /const GRIPS = \{([\s\S]*?)\n\};/.exec(src);
  ok(!!grips, 'and the grips are declared in one place');
  for (const k of r3d.GATHER_KINDS) {
    if (k === 'forage') continue;                  // nothing is held to forage
    ok(new RegExp(`\\n  ${k}:\\s*\\{`).test(grips[1]), `${k} says how the tool is held`);
  }
}

head('every item has a model of its own');
{
  const models = new ItemModels(gl);
  const kinds = new Set(Object.values(game.ITEMS).map(i => i.art?.k || 'blob'));
  for (const k of [...kinds].sort()) {
    ok(ITEM_KINDS.includes(k), `${k} is modelled, not falling back to a lump`);
  }

  /*
   * Every drop and every dropped item is drawn as itself, so "it builds
   * something" is the bar for all 200-odd of them rather than for a chosen
   * few. Reported as one line, because 200 ok's is not a test report.
   */
  let empty = [], tiny = [];
  for (const [id, it] of Object.entries(game.ITEMS)) {
    const m = models.get(it.art);
    if (!m.count) empty.push(id);
    else if (m.radius < 0.02 || m.radius > 0.9) tiny.push(`${id} (${m.radius.toFixed(2)})`);
  }
  ok(!empty.length, `all ${Object.keys(game.ITEMS).length} items build geometry${empty.length ? ': ' + empty.slice(0, 5).join(', ') : ''}`);
  ok(!tiny.length, `and all of them are a sensible size${tiny.length ? ': ' + tiny.slice(0, 5).join(', ') : ''}`);
}

head('weapons swing the way their weapon swings');
{
  const { attackKind, SPELL_MOTIONS } = await import('../js/engine/render3d.js');
  ok(attackKind(null) === 'punch', 'bare hands throw a punch');

  const seen = new Map();
  for (const it of Object.values(game.ITEMS)) {
    if (it.slot !== 'weapon') continue;
    const kind = attackKind(it);
    if (!seen.has(kind)) seen.set(kind, []);
    seen.get(kind).push(it.id);
  }
  for (const [kind, ids] of [...seen].sort()) {
    ok(ids.length > 0, `${kind}: ${ids.join(', ')}`);
  }
  ok(seen.size >= 6, `${seen.size} distinct motions across the armoury`);

  ok(attackKind(game.ITEMS.smith_hammer) === 'crush', 'a hammer comes down overhead');
  ok(attackKind(game.ITEMS.trocar_spear) === 'stab', 'a spear is thrust');
  ok(attackKind(game.ITEMS.steel_scalpel) === 'slash', 'a scalpel is swung');
  ok(attackKind(game.ITEMS.staff_of_sutures) === 'cast', 'a staff is raised');

  /*
   * Injection is three quite different things and they must not share one
   * motion: a dart is thrown, a bow is drawn, a blowpipe is blown through.
   */
  ok(attackKind(game.ITEMS.gasper_bow) === 'draw', 'a bow is drawn, not levelled');
  ok(attackKind(game.ITEMS.bile_blowpipe) === 'blow', 'a blowpipe is blown through');
  ok(attackKind(game.ITEMS.dart_bandolier) === 'throw', 'darts are thrown');
  ok(attackKind(game.ITEMS.brass_syringe) === 'throw', 'and so is a syringe');
  const ranged = new Set(Object.values(game.ITEMS)
    .filter(i => i.wstyle === 'ranged').map(i => attackKind(i)));
  ok(ranged.size === 3, `the ranged weapons use ${ranged.size} motions between them: ${[...ranged].join(', ')}`);

  /* and every attack spell should look like itself */
  const magic = await import('../js/data/magic.js');
  const attackSpells = magic.SPELLS.filter(s => s.kind === 'attack' || s.kind === 'drain');
  for (const s of attackSpells) {
    ok(SPELL_MOTIONS.includes(s.id), `${s.name} has a cast of its own`);
  }
  ok(SPELL_MOTIONS.length >= attackSpells.length,
     `${SPELL_MOTIONS.length} spell motions for ${attackSpells.length} castable attacks`);
}

head('a spell you can see and hear apart from the next one');
{
  const { SPELL_MOTIONS, SPELL_COLOURS, buildBolts, BOLT_SCALE } =
    await import('../js/engine/render3d.js');
  const { spellCue } = await import('../js/engine/audio.js');
  const magic = await import('../js/data/magic.js');
  const attackSpells = magic.SPELLS.filter(s => s.kind === 'attack' || s.kind === 'drain');

  const art = buildBolts(gl);

  /*
   * Three things have to differ per spell or the five of them blur into one:
   * the motion, the thing that crosses the air, and the noise it makes. The
   * bolt used to be a single white cone at half scale for all of them.
   */
  for (const s of attackSpells) {
    ok(!!art[s.id], `${s.name} has a bolt shaped like itself`);
    ok(!!SPELL_COLOURS[s.id], 'in a colour of its own');
    ok(spellCue(s.id) === 'cast_' + s.id, 'and a sound of its own');
  }

  const shapes = new Set(attackSpells.map(s => art[s.id]));
  ok(shapes.size === attackSpells.length, `${shapes.size} distinct bolt meshes, none shared`);
  const colours = new Set(attackSpells.map(s => SPELL_COLOURS[s.id]));
  ok(colours.size === attackSpells.length, `${colours.size} distinct colours, none shared`);
  const cues = new Set(attackSpells.map(s => spellCue(s.id)));
  ok(cues.size === attackSpells.length, `${cues.size} distinct sounds, none shared`);
  ok(spellCue(undefined) === 'cast' && spellCue('pack_invention') === 'cast',
     'and a spell nobody has voiced yet still makes a noise');

  /*
   * Size is the whole complaint: "barely perceptible because they are
   * extremely tiny". Every bolt is measured rather than eyeballed, against
   * the scale the renderer draws it at.
   */
  const small = [];
  let least = Infinity;
  for (const [k, m] of Object.entries(art)) {
    const across = 2 * m.radius * (k === 'shot' ? BOLT_SCALE.shot : BOLT_SCALE.spell);
    least = Math.min(least, across);
    if (across < 0.4) small.push(`${k} (${across.toFixed(2)} tiles)`);
  }
  ok(!small.length, small.length
    ? `too small to see in flight: ${small.join(', ')}`
    : `the smallest bolt is ${least.toFixed(2)} tiles across, which reads in flight`);
  ok(art._ && art._.count > 0, 'and an unmodelled spell still puts something in the air');

  ok(SPELL_MOTIONS.length >= attackSpells.length,
     `${SPELL_MOTIONS.length} motions for ${attackSpells.length} castable attacks`);
}

/* ============================================================
   The interface layer
   ------------------------------------------------------------
   The 3D view added a canvas over the scene and gave it an id
   that windows.js was already using for its shop and bank
   overlay. Both got `pointer-events: none`, so every click on a
   shop went through it and walked the player instead. Nothing
   threw, nothing looked wrong in a screenshot, and no test in
   the repository could have noticed.
   ============================================================ */

head('no two things claim the same id');
{
  const { readFile, readdir } = await import('node:fs/promises');
  const { rel } = await import('./lib.mjs');
  const path = await import('node:path');

  const html = await readFile(rel('index.html'), 'utf8');
  const markup = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  ok(markup.size > 10, `${markup.size} ids in the markup`);

  const walk = async dir => {
    const out = [];
    for (const e of await readdir(rel(dir), { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...await walk(p));
      else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
  };

  const clashes = [];
  for (const file of await walk('js')) {
    const src = await readFile(rel(file), 'utf8');
    // things the code creates and names itself: el.id = 'x'
    for (const m of src.matchAll(/\.id\s*=\s*'([^']+)'/g)) {
      if (markup.has(m[1])) clashes.push(`${file} builds an element with id "${m[1]}", which index.html already uses`);
    }
  }
  ok(!clashes.length, clashes.length
    ? clashes.join('; ')
    : 'nothing the code creates collides with an id in the markup');

  const layer = /id="hud-layer"/.test(html);
  ok(layer, 'the interface canvas has an id of its own');
  const css = await readFile(rel('css/style.css'), 'utf8');
  ok(/#hud-layer\s*\{[^}]*pointer-events:\s*none/.test(css),
     'and it is the thing that ignores clicks, not the windows');

  /*
   * The level-up banner is drawn over the world, so where it sits is not a
   * matter of taste: centred and full-height, it covered the character and
   * the fight they were in for three and a half seconds.
   */
  const lu = /#levelup\s*\{([^}]*)\}/.exec(css);
  ok(!!lu, 'the level-up banner has a rule');
  if (lu) {
    ok(!/inset:\s*0/.test(lu[1]), 'it does not cover the whole viewport');
    ok(/top:\s*0/.test(lu[1]), 'it is pinned to the top');
    ok(/align-items:\s*flex-start/.test(lu[1]), 'and hugs it rather than centring');
  }
  const inner = /\.lu-inner\s*\{([^}]*)\}/.exec(css);
  ok(inner && /padding:\s*\d+px \d+px/.test(inner[1]), 'and is a small banner, not a card');
}

/* ============================================================
   What floats over a head
   ------------------------------------------------------------
   A name drawn on top of its own health bar is worse than no
   name at all: in a fight the bar is the only number that
   matters, and it is the one thing that must never be hidden.
   ============================================================ */

head('names and health bars stack, rather than overlap');
{
  const { labelStack, BAR_H, GAP, TEXT_H } = await import('../js/engine/overlay.js');

  const box = (kind, y) => kind === 'bar'
    ? [y, y + BAR_H]                       // fillRect grows downward from y
    : [y - TEXT_H + 3, y + 3];             // text hangs off its baseline

  const overlap = (a, b) => a[0] < b[1] && b[0] < a[1];

  const both = labelStack(200, { bar: true, name: true });
  ok(both.bar !== null && both.name !== null, 'a hurt, named creature gets both');
  ok(!overlap(box('bar', both.bar), box('text', both.name)),
     `the name clears the bar by ${(both.bar - (both.name + 3)).toFixed(0)} px`);
  ok(both.name < both.bar, 'with the name above it, not below');
  ok(both.bar + BAR_H <= 200, 'and the bar sitting on the head, not floating over it');

  const chat = labelStack(200, { bar: true, name: true, chat: true });
  ok(chat.chat < chat.name, 'anything said goes above the name');
  ok(!overlap(box('text', chat.name), [chat.chat - 15, chat.chat + 2]),
     'and clears it too');

  // the pieces slide down to fill the gaps when they are not all there
  const nameOnly = labelStack(200, { name: true });
  ok(nameOnly.bar === null && nameOnly.name === 200,
     'an unhurt creature puts its name where the bar would have been');
  const barOnly = labelStack(200, { bar: true });
  ok(barOnly.name === null && barOnly.bar === 200 - BAR_H,
     'and a nameless one just gets the bar');
  ok(labelStack(200, {}).bar === null, 'something with nothing to say shows nothing');

  ok(GAP >= 3, `the clearance is ${GAP} px, which is enough to read as separate`);
}

/* ============================================================
   The click marker
   ------------------------------------------------------------
   The only thing that tells you the game heard your click, so
   it has to appear for every click that does something and it
   has to be the right colour: red means you are about to start
   a fight, and that has to be true.
   ============================================================ */

head('every click leaves a mark');
{
  const { markPhase, drawMark, MARK_MS } = await import('../js/engine/clickmark.js');
  const { createState, markClick } = await import('../js/game/state.js');

  const s = createState('Test');
  ok(s.moveMarker === null, 'nothing is marked before anything is clicked');

  markClick(s, 12, 34, 'attack');
  ok(s.moveMarker.x === 12 && s.moveMarker.y === 34, 'a mark lands on the tile it was given');
  ok(s.moveMarker.kind === 'attack', 'and remembers what kind of click it was');

  ok(markPhase(s.moveMarker, s.moveMarker.at) === 0, 'it starts at the beginning');
  ok(markPhase(s.moveMarker, s.moveMarker.at + MARK_MS / 2) > 0.4, 'runs through the middle');
  ok(markPhase(s.moveMarker, s.moveMarker.at + MARK_MS + 1) === null,
     `and is over after ${MARK_MS} ms, however fast the screen refreshes`);
  ok(markPhase(null) === null, 'and an absent mark is simply not drawn');

  /*
   * Drawn against a recording context, so the colours are checked rather
   * than assumed. Yellow for going somewhere or using something, red for
   * attacking - a player who cannot tell those apart at a glance has lost
   * the only thing the marker is for.
   */
  const strokes = kind => {
    const seen = [];
    const rec = new Proxy({}, {
      get: (t, k) => k === 'save' || k === 'restore' || k === 'translate' ||
                     k === 'beginPath' || k === 'moveTo' || k === 'lineTo' ||
                     k === 'stroke' || k === 'fillRect'
        ? () => {} : undefined,
      set: (t, k, v) => { if (k === 'strokeStyle' || k === 'fillStyle') seen.push(String(v)); return true; }
    });
    drawMark(rec, 100, 100, kind, 0.3);
    return seen;
  };

  const walk = strokes('walk'), attack = strokes('attack');
  const warm = c => /^#[0-9a-f]{6}$/i.test(c) && parseInt(c.slice(1, 3), 16) > 200;
  ok(walk.some(c => /^#f0d24a$/i.test(c)), `walking is marked in yellow (${walk.filter(warm).join(' ')})`);
  ok(attack.some(c => /^#e0503f$/i.test(c)), `attacking is marked in red (${attack.filter(warm).join(' ')})`);
  ok(!attack.some(c => /^#f0d24a$/i.test(c)), 'and an attack is never yellow');
  ok(walk.some(c => /rgba\(20/.test(c)), 'each arm is outlined, so it reads on pale ground too');

  const act = strokes('act');
  ok(act.join() === walk.join(), 'using something is marked the same as walking, as in RuneScape');
  ok(strokes('nonsense').join() === walk.join(), 'an unknown kind falls back to yellow rather than vanishing');
}

head('every click that does something marks the tile');
{
  const { readFile } = await import('node:fs/promises');
  const { rel } = await import('./lib.mjs');
  const src = await readFile(rel('js/main.js'), 'utf8');

  /*
   * doDefault is every left-click in the game. Each branch sends an intent,
   * and each one that does has to mark first - a click that does something
   * without saying so is the bug this whole feature exists to prevent.
   */
  const body = src.slice(src.indexOf('function doDefault'), src.indexOf('function contextEntries'));
  const branches = body.split(/\n\s*case |\n\s*default:/).slice(1);
  ok(branches.length >= 5, `${branches.length} kinds of click to check`);
  const bare = branches.filter(b => /net\.\w+\(/.test(b) && !/markClick\(/.test(b));
  ok(!bare.length, bare.length
    ? `${bare.length} branch(es) act without marking: ${bare.map(b => b.slice(0, 24).trim()).join(' | ')}`
    : 'every branch marks the tile before it sends the intent');
  ok(/markClick\(state, hit\.ref\.x, hit\.ref\.y, 'attack'\)/.test(body),
     'and attacking is the one marked in red');
}

/* ============================================================
   The world map
   ------------------------------------------------------------
   The dial in the corner holds about forty tiles of a world
   that is a hundred and ninety square, so everything outside
   it has to be findable some other way.
   ============================================================ */

head('the world map can show you the whole Throat');
{
  const { landmarks, LANDMARKS, terrainImage } = await import('../js/engine/mapimage.js');
  const world = game.world.buildWorld();

  /*
   * A stub canvas that records its size, so the image the map is drawn from
   * can be checked without a browser. The pixels themselves are the same
   * routine the minimap has always used.
   */
  let made = null;
  globalThis.document.createElement = () => ({
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => { made = true; },
      drawImage: () => {}, fillRect: () => {}, set fillStyle(v) {}
    })
  });

  const img = terrainImage(world);
  ok(img.width === world.w && img.height === world.h,
     `the map is ${img.width} by ${img.height}, one pixel a tile`);
  ok(made, 'and its pixels are painted, not left blank');
  ok(terrainImage(world) === img, 'it is built once and shared with the minimap');

  const pins = landmarks(world);
  ok(pins.length > 3, `${pins.length} landmarks worth walking back to`);
  const kinds = new Set(pins.map(p => p.station));
  ok(kinds.has('bank'), 'the bank is on it — the one thing everybody looks for');
  for (const k of kinds) ok(!!LANDMARKS[k], `"${k}" has a colour and a name`);
  ok(pins.every(p => p.x >= 0 && p.x < world.w && p.y >= 0 && p.y < world.h),
     'and every pin is inside the map');

  /*
   * A row of four bank booths is one bank. Without that the map is a drift of
   * identical labels on top of each other wherever anything is doubled up.
   */
  const banks = pins.filter(p => p.station === 'bank');
  const booths = world.objects.filter(o => game.world.OBJ[o.type]?.station === 'bank').length;
  ok(banks.length < booths || booths <= 1,
     `${booths} bank booths are shown as ${banks.length} pin(s)`);
  ok(landmarks(world) === pins, 'and the pins are worked out once');

  /* the view never scrolls off the edge of the world */
  const clampCentre = (cx, cy, zoom, vw, vh) => {
    const halfW = vw / 2 / zoom, halfH = vh / 2 / zoom;
    const w = world.w, h = world.h;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    return {
      x: w > halfW * 2 ? clamp(cx, halfW, w - halfW) : w / 2,
      y: h > halfH * 2 ? clamp(cy, halfH, h - halfH) : h / 2
    };
  };
  const far = clampCentre(9999, -9999, 4, 900, 600);
  ok(far.x < world.w && far.x > 0 && far.y < world.h && far.y > 0,
     `dragged off the edge it settles at ${far.x.toFixed(0)}, ${far.y.toFixed(0)}`);
  const zoomedOut = clampCentre(10, 10, 1, 900, 600);
  ok(zoomedOut.x === world.w / 2 && zoomedOut.y === world.h / 2,
     'and when the whole map fits, it simply centres');
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

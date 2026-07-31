/* ============================================================
   Camera checks
   ------------------------------------------------------------
   The camera can be orbited and tilted, which means the screen
   is no longer a straight scaling of the map. Everything that
   used to be one multiplication now goes through a rotation and
   a foreshortening, and getting any of it subtly wrong does not
   crash anything - it just means the tile you click is not the
   tile you get, or the wall in front of you draws behind you.

   None of that needs a browser to catch, so it does not use
   one: the renderer is built against a stubbed canvas and only
   its maths is exercised.

   Usage:  node tools/camera.mjs
   ============================================================ */

import { say } from './lib.mjs';

/* Enough DOM for the constructor. Nothing here draws. */
const stubCtx = new Proxy({}, { get: () => () => {} });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx })
};
globalThis.window = { devicePixelRatio: 1 };

const { Renderer } = await import('../js/engine/render.js');
const { TILE } = await import('../js/util.js');

const VW = 800, VH = 600;
const canvas = {
  width: 0, height: 0,
  getContext: () => stubCtx,
  getBoundingClientRect: () => ({ width: VW, height: VH })
};

const r = new Renderer(canvas, { objects: [], tileAt: () => 0, regionAt: () => null });
r.cam.x = 40.5; r.cam.y = 60.5;

let fails = 0;
const ok = (c, m) => { say((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const head = m => say('\n== ' + m);
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

/** Point the camera somewhere, the way stepCamera would leave it. */
const aim = (yaw, pitch) => {
  r.yaw = yaw; r.pitch = pitch;
  r.cos = Math.cos(yaw); r.sin = Math.sin(yaw);
};

/* ============================================================
   The view the game starts in has not moved
   ------------------------------------------------------------
   Every save, every screenshot and every player's muscle memory
   is of the flat overhead view. Adding a camera must not shift
   it by a pixel.
   ============================================================ */

head('the overhead view is exactly where it was');
ok(r.yaw === 0 && r.pitch === 90, 'the camera starts facing north, looking straight down');
ok(r.squash === 1 && r.dolly === 1, 'with no foreshortening and no dolly');
ok(r.ts === TILE, `a tile is still ${TILE} px`);
ok(!r.oblique, 'so the pixel-snapped terrain path is the one in use');
ok(near(r.pivotY, VH / 2), 'and the focus sits dead centre');

{
  // what tileToScreen returned before there was a camera: tx*ts - camPx,
  // where camPx was cam*ts - vw/2
  const old = (tx, ty) => ({
    x: tx * TILE - (r.cam.x * TILE - VW / 2),
    y: ty * TILE - (r.cam.y * TILE - VH / 2)
  });
  for (const [tx, ty] of [[40, 60], [0, 0], [77, 12], [191, 191]]) {
    const a = r.tileToScreen(tx, ty), b = old(tx, ty);
    ok(near(a.x, b.x) && near(a.y, b.y), `tile ${tx},${ty} lands where it always did`);
  }
}

/* ============================================================
   Clicking
   ------------------------------------------------------------
   probe() turns a cursor into a tile through unproject. If that
   is not the exact inverse of the projection that drew the
   tile, the game becomes unplayable at any angle but north.
   ============================================================ */

head('the projection inverts, at every angle');
for (const yaw of [0, 0.7, -1.9, Math.PI, 2.4]) {
  for (const pitch of [90, 70, 50, 34]) {
    aim(yaw, pitch);
    let worst = 0;
    for (const [wx, wy] of [[40.5, 60.5], [12, 3], [188.25, 191.75], [-4, 0]]) {
      const s = r.project(wx, wy);
      const b = r.unproject(s.x, s.y);
      worst = Math.max(worst, Math.abs(b.x - wx), Math.abs(b.y - wy));
    }
    ok(worst < 1e-9, `yaw ${yaw.toFixed(2)} pitch ${pitch}: round trip off by ${worst.toExponential(1)}`);
  }
}

head('a click lands on the tile that was clicked');
for (const [yaw, pitch] of [[0, 90], [1.2, 45], [-2.6, 34], [Math.PI, 60]]) {
  aim(yaw, pitch);
  let hit = 0, tried = 0;
  for (let tx = 30; tx < 50; tx++) {
    for (let ty = 50; ty < 70; ty++) {
      const c = r.project(tx + 0.5, ty + 0.5);        // the middle of a tile
      const t = r.screenToTile(c.x, c.y);
      tried++;
      if (t.x === tx && t.y === ty) hit++;
    }
  }
  ok(hit === tried,
     `yaw ${yaw.toFixed(2)} pitch ${pitch}: ${hit}/${tried} tile centres probe back to themselves`);
}

aim(0.9, 60);
{
  const t = r.screenToTile(VW / 2, r.pivotY);
  ok(t.x === 40 && t.y === 60, `the focus point is tile ${t.x},${t.y} — the one the camera is on`);
}

/* ============================================================
   Draw order
   ------------------------------------------------------------
   Sorting by world y is only right facing north. Turn around
   and the far side of the street has to draw first instead.
   ============================================================ */

head('what is in front depends on which way you are looking');
{
  const north = [40, 55], south = [40, 65], east = [45, 60], west = [35, 60];
  const nearer = (a, b) => r.depth(...a) > r.depth(...b);

  aim(0, 90);
  ok(nearer(south, north), 'facing north, the southern one is nearer and draws last');
  aim(Math.PI, 90);
  ok(nearer(north, south), 'turned right around, the northern one draws last instead');
  aim(Math.PI / 2, 90);
  ok(nearer(east, west), 'a quarter turn puts the eastern one in front');
  aim(-Math.PI / 2, 90);
  ok(nearer(west, east), 'and the other quarter puts the western one in front');
}

head('sprites turn to face the camera, not the map');
{
  aim(0, 90);
  ok(r.screenDir(40, 60, 45, 60) === 1, 'facing north, a target to the east is on the right');
  aim(Math.PI, 90);
  ok(r.screenDir(40, 60, 45, 60) === -1, 'turned around, the same target is on the left');
  aim(Math.PI / 2, 90);
  ok(r.screenDir(40, 60, 40, 65) === -1, 'a quarter turn puts a southern target on the left');
}

/* ============================================================
   The controls
   ============================================================ */

head('the arrow keys stay inside their limits');
{
  aim(0, 90);
  r.dt = 1 / 60;

  r.keys.add('ArrowDown');
  for (let i = 0; i < 600; i++) r.stepCamera();
  const floor = r.pitch;
  ok(floor > 25 && floor < 45, `held down, the tilt bottoms out at ${floor.toFixed(0)}°`);
  ok(r.squash > 0.4 && r.squash < 0.7, `flattening the ground to ${r.squash.toFixed(2)}`);
  ok(r.dolly > 1.1 && r.dolly < 1.4, `and pulling the camera in ${r.dolly.toFixed(2)}x`);
  ok(r.pivotY > VH / 2, `with the focus dropped to ${r.pivotY.toFixed(0)} px, so you see further ahead`);
  ok(r.oblique, 'which counts as oblique, so the terrain filters rather than crawls');

  r.keys.delete('ArrowDown'); r.keys.add('ArrowUp');
  for (let i = 0; i < 600; i++) r.stepCamera();
  ok(near(r.pitch, 90), 'held up, it tops out looking straight down again');
  ok(!r.oblique && r.ts === TILE, 'and is bit-for-bit the view it started in');
  r.keys.delete('ArrowUp');

  // a player who leans on the key for a minute must not wind the angle up
  r.keys.add('ArrowLeft');
  let big = 0;
  for (let i = 0; i < 3600; i++) { r.stepCamera(); big = Math.max(big, Math.abs(r.yaw)); }
  ok(big <= Math.PI + 1e-9, `spinning for a minute never winds past ±π (peak ${big.toFixed(3)})`);
  r.keys.clear();

  r.keys.add('ArrowLeft'); r.stepCamera(); const l = r.yaw;
  r.keys.clear(); r.keys.add('ArrowRight'); r.stepCamera();
  ok(r.yaw < l, 'left and right turn opposite ways');
  r.keys.clear();

  r.yaw = 2; r.pitch = 40;
  r.faceNorth();
  ok(r.yaw === 0 && r.cos === 1 && r.sin === 0, 'the compass puts you back on north');
  ok(r.pitch === 40, 'and leaves the tilt alone, as RuneScape does');
}

/* ============================================================
   Culling
   ------------------------------------------------------------
   draw() decides what to bother with from the world-space box
   the screen corners bound. Too small and the far corner of a
   turned view is empty; this proves it never is.
   ============================================================ */

head('the visible-tile bounds cover the whole screen');
for (const [yaw, pitch] of [[0, 90], [0.9, 34], [-2.2, 50], [Math.PI / 4, 34], [Math.PI, 34]]) {
  aim(yaw, pitch);
  const corners = [[0, 0], [VW, 0], [0, VH], [VW, VH]].map(([a, b]) => r.unproject(a, b));
  const x0 = Math.floor(Math.min(...corners.map(c => c.x))) - 2;
  const x1 = Math.ceil(Math.max(...corners.map(c => c.x))) + 2;
  const y0 = Math.floor(Math.min(...corners.map(c => c.y))) - 2;
  const y1 = Math.ceil(Math.max(...corners.map(c => c.y))) + 2;
  let missed = 0;
  for (let px = 0; px <= VW; px += 5) {
    for (let py = 0; py <= VH; py += 5) {
      const t = r.screenToTile(px, py);
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) missed++;
    }
  }
  ok(missed === 0,
     `yaw ${yaw.toFixed(2)} pitch ${pitch}: the whole screen falls inside ${x1 - x0}x${y1 - y0} tiles`);
}

/* ============================================================ */

say('\n' + (fails ? `${fails} PROBLEM(S) WITH THE CAMERA` : 'the camera holds up at every angle'));
process.exit(fails ? 1 : 0);

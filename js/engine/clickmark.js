/* ============================================================
   The click marker
   ------------------------------------------------------------
   The little cross that appears where you just clicked, so you
   know the game heard you. Yellow when you are going somewhere
   or using something, red when you are going to hit something.

   It is drawn flat, over the scene, at the projected position
   of the tile - not laid on the ground. That is deliberate and
   it is what the games this one follows do: the marker is a
   message from the interface, not a thing in the world, so it
   stays the same size and stays visible behind a wall.
   ============================================================ */

/** How long the whole animation lasts. */
export const MARK_MS = 460;

const COLOURS = {
  walk:   { arm: '#f0d24a', core: '#fff3c0' },
  act:    { arm: '#f0d24a', core: '#fff3c0' },
  attack: { arm: '#e0503f', core: '#ffc9c0' }
};

/** Progress through the animation, or null once it is over. */
export function markPhase(mark, now = performance.now()) {
  if (!mark) return null;
  const p = (now - mark.at) / MARK_MS;
  return p >= 0 && p < 1 ? p : null;
}

/**
 * Four arms springing out from a centre, thinning and fading as they go.
 * Drawn in screen space, so it reads identically however the camera is
 * turned and stays crisp when the camera is close.
 */
export function drawMark(ctx, x, y, kind, p) {
  const c = COLOURS[kind] || COLOURS.walk;

  // out fast, then drift; the snap at the start is what makes it feel responsive
  const grow = p < 0.3 ? p / 0.3 : 1;
  const reach = 4 + (1 - (1 - grow) * (1 - grow)) * 7;
  const thick = 3.2 - p * 1.4;
  const alpha = p < 0.65 ? 1 : 1 - (p - 0.65) / 0.35;

  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.translate(x, y);
  ctx.lineCap = 'butt';

  for (const pass of [0, 1]) {
    // a dark pass first, a little wider, so the mark reads on pale ground too
    ctx.strokeStyle = pass ? c.arm : 'rgba(20,8,12,0.75)';
    ctx.lineWidth = pass ? thick : thick + 2;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(dx * 2.2, dy * 2.2);
      ctx.lineTo(dx * reach, dy * reach);
    }
    ctx.stroke();
  }

  ctx.fillStyle = c.core;
  ctx.fillRect(-1.5, -1.5, 3, 3);
  ctx.restore();
}

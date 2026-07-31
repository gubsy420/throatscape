/* ============================================================
   Chat effects
   ------------------------------------------------------------
   The old games let you prefix a public message with a colour
   and a motion - "red:wave:hello there" - and everyone in
   earshot sees it that way, in the log and in the bubble over
   your head. This parses those prefixes.

   No DOM and no canvas in here: the server imports it to
   validate what it is about to relay, the chat log uses it to
   build spans, and the renderer uses it to place glyphs.
   ============================================================ */

/**
 * Colours are functions of (character index, seconds) so a word can cycle,
 * flash or run through a rainbow rather than just sitting there.
 */
export const COLOURS = {
  red:     () => '#e05a5a',
  green:   () => '#6fd1a5',
  cyan:    () => '#6fc6d1',
  purple:  () => '#c08fd9',
  white:   () => '#f2ece0',
  yellow:  () => '#e0b357',
  flash1:  (i, t) => (t % 0.6 < 0.3 ? '#e05a5a' : '#f2ece0'),
  flash2:  (i, t) => (t % 0.6 < 0.3 ? '#6fc6d1' : '#3a6fa8'),
  flash3:  (i, t) => (t % 0.6 < 0.3 ? '#6fd1a5' : '#2f7f5a'),
  glow:    (i, t) => hsl(200, 60, 55 + Math.sin(t * 3) * 18),
  rainbow: (i, t) => hsl(((t * 90) + i * 26) % 360, 78, 66)
};

/**
 * Motions return a {dx, dy} in pixels for one character. The chat log turns
 * the same numbers into a transform, so a message moves identically in both
 * places.
 */
export const MOTIONS = {
  wave:   (i, t) => ({ dx: 0, dy: Math.sin(t * 5 - i * 0.5) * 3 }),
  wave2:  (i, t) => ({ dx: Math.sin(t * 4 - i * 0.4) * 3, dy: Math.cos(t * 5 - i * 0.5) * 3 }),
  shake:  (i, t) => ({ dx: Math.sin(t * 34 + i * 7) * 1.4, dy: Math.cos(t * 41 + i * 5) * 1.4 }),
  slide:  (i, t) => ({ dx: 0, dy: ((t * 22 + i * 3) % 14) - 7 })
};

const hsl = (h, s, l) => `hsl(${h.toFixed(0)} ${s}% ${l.toFixed(0)}%)`;

/** Every prefix a player may type, for the help text and for validation. */
export const EFFECT_NAMES = [...Object.keys(COLOURS), ...Object.keys(MOTIONS)];

const MAX_PREFIXES = 3;

/**
 * Pulls leading `name:` prefixes off a message. Unknown ones are left alone
 * and become part of the text, so typing "note: fetch the gauze" still says
 * what you meant.
 *
 * @returns {{colour: string|null, motion: string|null, text: string}}
 */
export function parseChat(raw) {
  let text = String(raw ?? '');
  let colour = null, motion = null;

  for (let i = 0; i < MAX_PREFIXES; i++) {
    const m = /^([a-z][a-z0-9]{0,7}):/i.exec(text);
    if (!m) break;
    const key = m[1].toLowerCase();
    if (COLOURS[key] && !colour) colour = key;
    else if (MOTIONS[key] && !motion) motion = key;
    else break;                       // unknown, or a second colour: stop here
    text = text.slice(m[0].length);
  }

  return { colour, motion, text: text.trimStart() };
}

/** The colour for one character, or null to use the caller's default. */
export function charColour(colour, i, seconds) {
  const fn = COLOURS[colour];
  return fn ? fn(i, seconds) : null;
}

/** The offset for one character, in pixels at 11px text. */
export function charOffset(motion, i, seconds) {
  const fn = MOTIONS[motion];
  return fn ? fn(i, seconds) : ZERO;
}

const ZERO = { dx: 0, dy: 0 };

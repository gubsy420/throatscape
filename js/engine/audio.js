/* ============================================================
   Audio - synthesised at runtime, like everything else here
   ------------------------------------------------------------
   There are no sound files. Every effect is built from
   oscillators and a noise buffer, and the music is generated a
   bar at a time from a scale and a chord loop, so the whole
   soundtrack costs about twelve kilobytes of source and nothing
   to download.

   The Throat is a hospital that has gone wrong, so the palette
   is wet thuds, cloth, bone, and a slow pulse underneath
   everything that is either a heart or a machine pretending to
   be one.
   ============================================================ */

const MIDI_A4 = 69;
const hz = m => 440 * Math.pow(2, (m - MIDI_A4) / 12);

/* modes, as semitone offsets from the root */
const AEOLIAN  = [0, 2, 3, 5, 7, 8, 10];   // natural minor - sad but composed
const DORIAN   = [0, 2, 3, 5, 7, 9, 10];   // minor with a lifted sixth - restless
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];   // that flat second is pure dread
const PHRY_DOM = [0, 1, 4, 5, 7, 8, 10];   // phrygian dominant - something is wrong
const LOCRIAN  = [0, 1, 3, 5, 6, 8, 10];   // no stable fifth, never settles

/**
 * One theme per region. `beat` is seconds, `density` is the chance of a
 * melody note on a given beat, `pulse` is how many beats between heartbeats.
 * Roots are MIDI numbers; everything sits low because the ceiling is meat.
 */
const THEMES = {
  lumbrisdale: {                       // the last working ward: tired, kind
    root: 50, scale: AEOLIAN, chords: [0, 5, 3, 4],
    beat: 0.80, density: 0.40, pulse: 8, padGain: 0.055, leadGain: 0.075,
    lead: 'triangle', pad: 'sawtooth', cutoff: 760, beeps: 0.03
  },
  wilds: {                             // open ground, watchful
    root: 48, scale: DORIAN, chords: [0, 3, 6, 4],
    beat: 0.72, density: 0.34, pulse: 6, padGain: 0.05, leadGain: 0.07,
    lead: 'triangle', pad: 'sawtooth', cutoff: 680, beeps: 0.01
  },
  vellumhaven: {                       // stone, ledgers, expensive mercy
    root: 52, scale: AEOLIAN, chords: [0, 4, 5, 1],
    beat: 0.86, density: 0.44, pulse: 8, padGain: 0.05, leadGain: 0.08,
    lead: 'sine', pad: 'square', cutoff: 900, beeps: 0.02
  },
  fen: {                               // standing bile, very little air
    root: 43, scale: PHRYGIAN, chords: [0, 1, 0, 6],
    beat: 1.05, density: 0.22, pulse: 10, padGain: 0.06, leadGain: 0.055,
    lead: 'sine', pad: 'sawtooth', cutoff: 460, beeps: 0
  },
  gullet: {                            // a long red corridor
    root: 45, scale: LOCRIAN, chords: [0, 4, 0, 1],
    beat: 0.66, density: 0.28, pulse: 5, padGain: 0.055, leadGain: 0.06,
    lead: 'square', pad: 'sawtooth', cutoff: 540, beeps: 0.05
  },
  uvula: {                             // chalk cliffs, thin cold air
    root: 55, scale: DORIAN, chords: [0, 5, 3, 5],
    beat: 0.94, density: 0.36, pulse: 9, padGain: 0.045, leadGain: 0.075,
    lead: 'sine', pad: 'triangle', cutoff: 1200, beeps: 0.02
  },
  larynx: {                            // where the Throat still makes sound
    root: 40, scale: PHRY_DOM, chords: [0, 1, 5, 1],
    beat: 1.15, density: 0.20, pulse: 12, padGain: 0.07, leadGain: 0.06,
    lead: 'sine', pad: 'sawtooth', cutoff: 380, beeps: 0.06
  },
  /* not a place - the shape the music takes while something is biting you */
  danger: {
    root: 45, scale: PHRYGIAN, chords: [0, 1, 0, 4],
    beat: 0.50, density: 0.42, pulse: 2, padGain: 0.06, leadGain: 0.07,
    lead: 'square', pad: 'sawtooth', cutoff: 620, beeps: 0
  }
};

/** Scale degrees are unbounded: -3 and 11 both mean something sensible. */
function noteAt(root, scale, degree) {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  return root + oct * 12 + scale[((degree % n) + n) % n];
}

export class Audio {
  constructor(state, world) {
    this.state = state;
    this.world = world;
    this.ctx = null;
    this.ready = false;

    this.themeId = null;
    this.theme = null;
    this.beat = 0;
    this.nextBeatAt = 0;
    this.timer = null;
    this.drone = null;
    this.melodyDegree = 0;

    this.lastRegion = null;
    this.wasInCombat = false;
    this.lastStepAt = 0;
  }

  /* ---------------- lifecycle ------------------------------- */

  /**
   * Browsers will not make a sound until the user has touched the page, so
   * this is called from the first real gesture rather than at boot.
   */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    const ctx = this.ctx = new AC();

    // a limiter on the master bus: generated music has no mastering engineer
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();

    this.musicBus.connect(comp);
    this.sfxBus.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);

    // two seconds of white noise, reused by every percussive sound
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.ready = true;
    this.applySettings();

    document.addEventListener('visibilitychange', () => {
      // nobody wants a hospital drone coming from a tab they forgot about
      if (document.hidden) this.ctx.suspend();
      else if (this.state.settings.music || this.state.settings.sfx) this.ctx.resume();
    });
  }

  applySettings() {
    if (!this.ready) return;
    const s = this.state.settings;
    this.musicBus.gain.value = s.music ? (s.musicVol ?? 0.5) : 0;
    this.sfxBus.gain.value = s.sfx ? (s.sfxVol ?? 0.7) : 0;
    if (s.music && !this.timer) this.startMusic(this.themeId || 'lumbrisdale');
    if (!s.music && this.timer) this.stopMusic();
  }

  /* ---------------- primitives ------------------------------ */

  /**
   * One enveloped oscillator, optionally through a filter. `to` slides the
   * pitch, `sweep` slides the filter; between them that is most of a synth.
   */
  tone(o) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = o.when ?? ctx.currentTime;
    const dur = o.dur ?? 0.2;
    const attack = o.attack ?? 0.006;
    const gain = o.gain ?? 0.2;

    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.freq), t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + dur);
    if (o.detune) osc.detune.value = o.detune;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let tail = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.cutoff ?? 1200, t);
      if (o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweep), t + dur);
      f.Q.value = o.q ?? 1;
      tail.connect(f);
      tail = f;
    }
    tail.connect(g);
    g.connect(o.bus || this.sfxBus);

    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** A burst of the shared noise buffer, shaped by a filter. */
  noise(o = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = o.when ?? ctx.currentTime;
    const dur = o.dur ?? 0.15;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    // start somewhere random so repeated hits are not identical
    const off = Math.random() * (this.noiseBuf.duration - dur - 0.05);

    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 1400, t);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweep), t + dur);
    f.Q.value = o.q ?? 1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.15, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(f);
    f.connect(g);
    g.connect(o.bus || this.sfxBus);
    src.start(t, off);
    src.stop(t + dur + 0.05);
  }

  /* ---------------- effects --------------------------------- */

  /**
   * Named one-shots. Anything the player does or has done to them ends up
   * here; the names are the vocabulary the rest of the game speaks.
   */
  play(name, arg) {
    if (!this.ready || !this.state.settings.sfx) return;
    const jitter = 1 + (Math.random() - 0.5) * 0.06;   // no two swings identical

    switch (name) {
      /* -- combat -- */
      case 'hit':                        // your blow lands: wet, close, low
        this.tone({ freq: 190 * jitter, to: 70, type: 'sine', dur: 0.13, gain: 0.22 });
        this.noise({ freq: 900, sweep: 260, q: 1.4, dur: 0.11, gain: 0.13 });
        break;
      case 'hurt':                       // taken, not given: darker, with a gasp
        this.tone({ freq: 150 * jitter, to: 55, type: 'triangle', dur: 0.18, gain: 0.24 });
        this.noise({ freq: 520, sweep: 180, q: 0.9, dur: 0.2, gain: 0.15 });
        break;
      case 'miss':
        this.noise({ filter: 'highpass', freq: 700, sweep: 2600, q: 0.7, dur: 0.14, gain: 0.07 });
        break;
      case 'kill':                       // something stops
        this.tone({ freq: 220, to: 48, type: 'sawtooth', dur: 0.5, gain: 0.14,
                    filter: 'lowpass', cutoff: 1400, sweep: 200 });
        this.noise({ freq: 380, sweep: 90, dur: 0.45, gain: 0.1 });
        break;
      case 'death':                      // it stops being something else
        this.tone({ freq: 300, to: 40, type: 'sine', dur: 1.5, gain: 0.26 });
        this.tone({ freq: 301.5, to: 39, type: 'triangle', dur: 1.6, gain: 0.16 });
        this.noise({ filter: 'lowpass', freq: 900, sweep: 90, dur: 1.4, gain: 0.12 });
        break;

      /* -- getting on with the job -- */
      case 'gather':                     // a snip, then something coming loose
        this.noise({ freq: 2400, sweep: 700, q: 3, dur: 0.09, gain: 0.11 });
        this.tone({ freq: 420 * jitter, to: 300, type: 'triangle', dur: 0.1, gain: 0.09 });
        break;
      case 'craft':
        this.tone({ freq: 130, to: 90, type: 'square', dur: 0.14, gain: 0.12,
                    filter: 'lowpass', cutoff: 700 });
        this.noise({ freq: 1600, sweep: 500, q: 2, dur: 0.13, gain: 0.1 });
        break;
      case 'item':                       // something lands in the pack
        this.tone({ freq: 660, to: 880, type: 'triangle', dur: 0.09, gain: 0.1 });
        break;
      case 'coin':
        this.tone({ freq: 1750, type: 'square', dur: 0.06, gain: 0.05 });
        this.tone({ freq: 2400, type: 'square', dur: 0.07, gain: 0.04, when: this.ctx.currentTime + 0.045 });
        break;
      case 'bank':
        this.tone({ freq: 300, to: 220, type: 'sine', dur: 0.11, gain: 0.11 });
        this.noise({ freq: 1900, sweep: 900, q: 2.5, dur: 0.1, gain: 0.06 });
        break;
      case 'drink':                      // three swallows, going up
        for (let i = 0; i < 3; i++) {
          this.tone({ freq: 240 + i * 60, to: 150 + i * 40, type: 'sine', dur: 0.1,
                      gain: 0.1, when: this.ctx.currentTime + i * 0.11 });
        }
        break;
      case 'eat':
        this.noise({ filter: 'lowpass', freq: 800, sweep: 300, dur: 0.12, gain: 0.11 });
        this.noise({ filter: 'lowpass', freq: 700, sweep: 260, dur: 0.12, gain: 0.09,
                     when: this.ctx.currentTime + 0.15 });
        break;
      case 'step':
        this.noise({ filter: 'lowpass', freq: 420, sweep: 180, dur: 0.055, gain: 0.035 });
        break;

      /* -- interface -- */
      case 'open':
        this.tone({ freq: 300, to: 460, type: 'sine', dur: 0.13, gain: 0.09 });
        break;
      case 'close':
        this.tone({ freq: 440, to: 260, type: 'sine', dur: 0.11, gain: 0.07 });
        break;
      case 'talk':                       // a page turning, not a voice
        this.tone({ freq: 520 * jitter, type: 'triangle', dur: 0.05, gain: 0.06 });
        break;
      case 'chat':
        this.tone({ freq: 760, type: 'sine', dur: 0.05, gain: 0.045 });
        break;
      case 'toast':
        this.tone({ freq: 620, type: 'triangle', dur: 0.1, gain: 0.07 });
        this.tone({ freq: 930, type: 'triangle', dur: 0.14, gain: 0.06,
                    when: this.ctx.currentTime + 0.09 });
        break;
      case 'error':
        this.tone({ freq: 160, to: 120, type: 'square', dur: 0.16, gain: 0.09,
                    filter: 'lowpass', cutoff: 600 });
        break;

      /* -- the good moments -- */
      case 'levelup':                    // a small bell figure, rising
        [0, 4, 7, 12].forEach((s, i) =>
          this.chime(hz(69 + s), this.ctx.currentTime + i * 0.11, 0.9, 0.1));
        break;
      case 'quest':                      // longer, warmer, worth stopping for
        [0, 5, 7, 12, 16].forEach((s, i) =>
          this.chime(hz(62 + s), this.ctx.currentTime + i * 0.16, 1.6, 0.11));
        break;
      case 'vigil':                      // the altar: a held, churchy fifth
        this.tone({ freq: hz(50), type: 'triangle', dur: 1.6, gain: 0.09, attack: 0.25 });
        this.tone({ freq: hz(57), type: 'triangle', dur: 1.8, gain: 0.07, attack: 0.35 });
        break;
    }
  }

  /** A struck-metal tone: a fundamental plus an inharmonic partial above it. */
  chime(f, when, dur, gain) {
    this.tone({ freq: f, type: 'sine', dur, gain, attack: 0.004, when });
    this.tone({ freq: f * 2.76, type: 'sine', dur: dur * 0.55, gain: gain * 0.3,
                attack: 0.003, when });
  }

  /* ---------------- music ----------------------------------- */

  startMusic(id) {
    if (!this.ready || !this.state.settings.music) return;
    const theme = THEMES[id];
    if (!theme) return;

    this.stopMusic();
    this.themeId = id;
    this.theme = theme;
    this.beat = 0;
    this.melodyDegree = 0;
    this.nextBeatAt = this.ctx.currentTime + 0.1;

    this.startDrone(theme);
    // schedule ahead of the clock: setInterval is far too jittery to play on
    this.timer = setInterval(() => this.schedule(), 120);
    this.schedule();
  }

  stopMusic() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.drone) {
      const { gain, oscs, ctx } = this.drone;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value || 0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      for (const o of oscs) o.stop(t + 1.4);
      this.drone = null;
    }
  }

  /** A continuous detuned pair under everything, filtered down to a hum. */
  startDrone(theme) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 2.5);

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = theme.cutoff * 0.5;
    f.Q.value = 0.7;

    const oscs = [];
    for (const cents of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(theme.root - 12);
      o.detune.value = cents;
      o.connect(f);
      o.start(t);
      oscs.push(o);
    }
    f.connect(g);
    g.connect(this.musicBus);
    this.drone = { gain: g, oscs, ctx };
  }

  schedule() {
    if (!this.theme || !this.ready) return;
    const horizon = this.ctx.currentTime + 0.6;
    let guard = 0;
    while (this.nextBeatAt < horizon && guard++ < 32) {
      this.scheduleBeat(this.beat, this.nextBeatAt);
      this.nextBeatAt += this.theme.beat;
      this.beat++;
    }
  }

  /**
   * Four beats to the bar, four bars to the loop. The chord for the bar
   * decides which notes are safe, and the melody walks between them.
   */
  scheduleBeat(i, when) {
    const th = this.theme;
    const bus = this.musicBus;
    const inBar = i % 4;
    const chordRoot = th.chords[Math.floor(i / 4) % th.chords.length];

    if (inBar === 0) {
      // pad: the triad, held for the bar, with a slow swell
      for (const d of [0, 2, 4]) {
        this.tone({
          freq: hz(noteAt(th.root, th.scale, chordRoot + d)),
          type: th.pad, dur: th.beat * 4.2, gain: th.padGain, attack: th.beat * 0.9,
          filter: 'lowpass', cutoff: th.cutoff, q: 0.8, bus, when
        });
      }
      // bass: the same root, two octaves down, plucked
      this.tone({
        freq: hz(noteAt(th.root, th.scale, chordRoot) - 24),
        type: 'sine', dur: th.beat * 1.6, gain: 0.12, attack: 0.02, bus, when
      });
    }

    // the pulse. Lub-dub, and twice as often when something is biting you
    if (i % th.pulse === 0) {
      this.tone({ freq: 74, to: 42, type: 'sine', dur: 0.16, gain: 0.16, bus, when });
      this.tone({ freq: 66, to: 38, type: 'sine', dur: 0.2, gain: 0.11, bus,
                  when: when + 0.19 });
    }

    // melody: mostly chord tones, walking by step, occasionally resting
    if (Math.random() < th.density) {
      const onChord = Math.random() < 0.65;
      let deg;
      if (onChord) {
        deg = chordRoot + [0, 2, 4, 7][Math.floor(Math.random() * 4)];
      } else {
        const step = [-2, -1, 1, 2][Math.floor(Math.random() * 4)];
        deg = this.melodyDegree + step;
      }
      if (deg > 12) deg -= 7;
      if (deg < -2) deg += 7;
      this.melodyDegree = deg;
      this.chimeAt(hz(noteAt(th.root, th.scale, deg) + 12), when, th.beat * 1.8,
                   th.leadGain, th.lead, bus);
    }

    // the monitor: one high beep, rare enough to be unsettling
    if (th.beeps && Math.random() < th.beeps) {
      this.tone({ freq: 1760, type: 'sine', dur: 0.09, gain: 0.045, bus, when });
    }
  }

  chimeAt(f, when, dur, gain, type, bus) {
    this.tone({ freq: f, type, dur, gain, attack: 0.01, bus, when,
                filter: 'lowpass', cutoff: 3200 });
    this.tone({ freq: f * 2.01, type: 'sine', dur: dur * 0.4, gain: gain * 0.25,
                attack: 0.008, bus, when });
  }

  /* ---------------- per-frame ------------------------------- */

  /**
   * Follows the player around: the music changes with the region, and drops
   * into the danger theme while something is actually attacking.
   */
  update() {
    if (!this.ready || !this.state.settings.music) return;
    const p = this.state.player;
    const fighting = p.inCombat > 0;
    const region = this.world.regionAt(p.x, p.y);
    const want = fighting ? 'danger' : (region && THEMES[region.id] ? region.id : 'lumbrisdale');

    if (want !== this.themeId) {
      // combat flickers on and off, so only chase it after it has settled
      if (fighting !== this.wasInCombat || region?.id !== this.lastRegion) {
        this.wasInCombat = fighting;
        this.lastRegion = region?.id;
        this.startMusic(want);
      }
    }
  }

  /** Footsteps, throttled: one per tile, and never a machine-gun. */
  footstep() {
    const now = performance.now();
    if (now - this.lastStepAt < 220) return;
    this.lastStepAt = now;
    this.play('step');
  }
}

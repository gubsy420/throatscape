/* ============================================================
   Accounts - registration, login, sessions
   ------------------------------------------------------------
   Passwords are stored as scrypt hashes with a per-account salt.
   Nothing here ever logs or returns a password or a hash.
   ============================================================ */

import crypto from 'node:crypto';
import { readJson, writeJson, accountsFile } from './store.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

export const NAME_RE = /^[A-Za-z][A-Za-z0-9 _-]{1,11}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

/** Filesystem- and lookup-safe key for a display name. */
export const keyFor = name => String(name).trim().toLowerCase().replace(/ /g, '_');

const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, SCRYPT.keylen,
    { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
    (err, key) => err ? reject(err) : resolve(key));
});

export class Accounts {
  constructor() {
    this.users = new Map();        // key -> record
    this.sessions = new Map();     // token -> { key, expires }
    this.attempts = new Map();     // key|ip -> { count, until }
    this.dirty = false;
  }

  async load() {
    const data = await readJson(accountsFile(), { users: {} });
    for (const [k, rec] of Object.entries(data.users || {})) this.users.set(k, rec);
    /*
     * Sessions are saved too. Restarting to pick up a new image is routine for
     * a self-hosted server, and dropping every logged-in player back to a
     * password prompt each time it happens is friction with nothing to show
     * for it - the tokens expire on their own, and sweep() drops the stale ones.
     */
    const now = Date.now();
    for (const [t, s] of Object.entries(data.sessions || {})) {
      if (s && s.expires > now && this.users.has(s.key)) this.sessions.set(t, s);
    }
    console.log(`  ${this.users.size} account${this.users.size === 1 ? '' : 's'} loaded` +
                (this.sessions.size ? `, ${this.sessions.size} session(s) still valid.` : '.'));
  }

  async save() {
    if (!this.dirty) return;
    this.dirty = false;
    await writeJson(accountsFile(), {
      users: Object.fromEntries(this.users),
      sessions: Object.fromEntries(this.sessions)
    });
  }

  get count() { return this.users.size; }

  /* ---------------- throttling ---------------------------- */

  /**
   * Failed logins back off per name and per address, so an open server cannot
   * be brute-forced at socket speed.
   */
  throttled(id) {
    const a = this.attempts.get(id);
    if (!a) return 0;
    if (Date.now() > a.until) { this.attempts.delete(id); return 0; }
    return a.count >= 5 ? Math.ceil((a.until - Date.now()) / 1000) : 0;
  }

  noteFailure(id) {
    const a = this.attempts.get(id) || { count: 0, until: 0 };
    a.count++;
    // 5 strikes, then a minute, doubling to a cap of roughly 15 minutes
    const backoff = Math.min(60_000 * Math.pow(2, Math.max(0, a.count - 5)), 900_000);
    a.until = Date.now() + (a.count >= 5 ? backoff : 60_000);
    this.attempts.set(id, a);
  }

  clearFailures(id) { this.attempts.delete(id); }

  /* ---------------- registration -------------------------- */

  validate(name, password) {
    if (!NAME_RE.test(String(name || '').trim())) {
      return 'Names are 2-12 characters, start with a letter, and may contain letters, digits, spaces, _ and -.';
    }
    const p = String(password || '');
    if (p.length < MIN_PASSWORD) return `Passwords must be at least ${MIN_PASSWORD} characters.`;
    if (p.length > MAX_PASSWORD) return 'That password is unreasonably long.';
    return null;
  }

  async register(name, password) {
    const display = String(name).trim();
    const problem = this.validate(display, password);
    if (problem) return { error: problem };

    const key = keyFor(display);
    if (this.users.has(key)) return { error: 'That name is already taken.' };

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt)).toString('hex');

    this.users.set(key, {
      key, name: display, salt, hash,
      created: Date.now(), lastLogin: Date.now()
    });
    this.dirty = true;
    await this.save();
    return { key, name: display };
  }

  /* ---------------- login --------------------------------- */

  async login(name, password, ip = 'unknown') {
    const key = keyFor(name || '');
    const wait = this.throttled(key) || this.throttled(ip);
    if (wait) return { error: `Too many attempts. Try again in ${wait}s.` };

    const rec = this.users.get(key);

    // Hash even when the account does not exist, so timing does not reveal
    // which names are registered.
    const salt = rec ? rec.salt : 'absent';
    const candidate = await scrypt(String(password || ''), salt);

    let good = false;
    if (rec) {
      const stored = Buffer.from(rec.hash, 'hex');
      good = stored.length === candidate.length &&
             crypto.timingSafeEqual(stored, candidate);
    }

    if (!good) {
      this.noteFailure(key);
      this.noteFailure(ip);
      return { error: 'Wrong name or password.' };
    }

    this.clearFailures(key);
    this.clearFailures(ip);
    rec.lastLogin = Date.now();
    this.dirty = true;

    return { key, name: rec.name, token: this.issue(key) };
  }

  /* ---------------- sessions ------------------------------ */

  issue(key) {
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { key, expires: Date.now() + SESSION_MS });
    this.dirty = true;
    return token;
  }

  resume(token) {
    const s = this.sessions.get(String(token || ''));
    if (!s) return null;
    if (Date.now() > s.expires) { this.sessions.delete(token); return null; }
    const rec = this.users.get(s.key);
    return rec ? { key: rec.key, name: rec.name } : null;
  }

  revoke(token) { if (this.sessions.delete(token)) this.dirty = true; }

  /** Drops expired sessions so the map does not grow without bound. */
  sweep() {
    const now = Date.now();
    for (const [t, s] of this.sessions) if (now > s.expires) { this.sessions.delete(t); this.dirty = true; }
    for (const [id, a] of this.attempts) if (now > a.until) this.attempts.delete(id);
  }
}

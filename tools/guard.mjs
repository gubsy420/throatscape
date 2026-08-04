/* ============================================================
   Working-tree guard
   ------------------------------------------------------------
   The daily pipeline is allowed to add content and nothing else.
   This is what enforces that, run after Claude has written the
   day's pack and before any of it is published.

   Two different things can be true of a file outside
   content/packs, and they have always deserved different
   answers:

     - A tracked file that has been changed, deleted or moved is
       the thing this gate exists for. A pack that edits the
       validator, the smoke test or the game itself is not a
       pack, and no amount of it passing its own checks makes it
       one. That stops the run dead.

     - An untracked leftover is mess. Claude writes a little
       throwaway script to count something, has no way to delete
       it again, and the run ends. On 2026-08-04 a finished and
       entirely valid boss delivery was thrown away over
       `?? tmp_scan.mjs`. Those get swept up, and the day carries
       on.

   Sweeping is not only tidiness. The commit step adds content/
   wholesale, so an untracked file written under content/ but
   outside content/packs would ride along into the repository
   without ever having been through the validator. Removing it is
   the only reason that cannot happen.

   Usage:  node tools/guard.mjs
           node tools/guard.mjs --self-test
   ============================================================ */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, say, warn } from './lib.mjs';

/** Where content is allowed to appear. Everything else is off limits. */
export const OWNED = 'content/packs';

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  }
  return r.stdout;
};

/**
 * What has changed outside the one directory the pipeline owns.
 *
 * Read with -z because a path with a space in it is otherwise ambiguous, and
 * a gate that misreads its input is worse than no gate. A rename or copy
 * emits the new path and then the old one, so the extra entry is consumed
 * rather than mistaken for a second file.
 */
export function inspect(cwd = ROOT) {
  const raw = git(cwd, 'status', '--porcelain', '-z', '--', '.', `:!${OWNED}`);
  const entries = raw.split('\0').filter(e => e.length);

  const tampered = [];
  const scratch = [];

  for (let i = 0; i < entries.length; i++) {
    const status = entries[i].slice(0, 2);
    const file = entries[i].slice(3);
    if (/^[RC]/.test(status)) {
      tampered.push({ status, file: `${entries[++i]} -> ${file}` });
    } else if (status === '??') {
      scratch.push(file);
    } else {
      tampered.push({ status, file });
    }
  }

  return { tampered, scratch };
}

/**
 * The one pack this delivery wrote.
 *
 * Exactly one, because the commit step adds content/ wholesale while only the
 * file named here is put through the validator. Two packs would mean one of
 * them reaching the game unchecked, so that is a failure rather than a
 * coin toss over which one gets looked at - which is what taking the first
 * line of `git status` used to be.
 */
export function packFile(cwd = ROOT) {
  const raw = git(cwd, 'status', '--porcelain', '-z', '--', OWNED);
  const files = raw.split('\0').filter(e => e.length).map(e => e.slice(3));

  if (!files.length) throw new Error('no pack was written');
  if (files.length > 1) {
    throw new Error(
      `the delivery wrote ${files.length} packs, and only one would be validated:\n` +
      files.map(f => `  ${f}`).join('\n'));
  }
  return files[0];
}

/**
 * Returns true if the tree is acceptable, having removed any scratch.
 * `sweep: false` reports without touching anything, which is what the
 * self-test wants when it is checking the reading rather than the fixing.
 */
export function guard(cwd = ROOT, { sweep = true } = {}) {
  const { tampered, scratch } = inspect(cwd);

  if (tampered.length) {
    warn('The delivery changed files it does not own:');
    for (const t of tampered) warn(`  ${t.status} ${t.file}`);
    warn('');
    warn(`The pipeline may only write under ${OWNED}/. Nothing has been published.`);
    return false;
  }

  if (!scratch.length) {
    say(`nothing outside ${OWNED}/ was touched`);
    return true;
  }

  say(`sweeping up ${scratch.length} leftover(s) outside ${OWNED}/:`);
  for (const f of scratch) {
    say(`  ${f}`);
    if (sweep) rmSync(path.join(cwd, f), { recursive: true, force: true });
  }
  return true;
}

/* ============================================================
   Self-test
   ------------------------------------------------------------
   A gate written in shell inside a workflow file cannot be run
   until the night it matters, which is how the old one shipped
   reading an untracked scratch file as tampering. This one is
   exercised against real throwaway repositories.
   ============================================================ */

function selfTest() {
  let fails = 0;
  const ok = (c, m) => { say((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
  const head = m => say('\n== ' + m);

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'throatscape-guard-'));

  /** A miniature of this repository: a tracked tool, and a pack directory. */
  const repo = (build) => {
    const dir = mkdtempSync(path.join(scratchDir, 'repo-'));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'guard@test');
    git(dir, 'config', 'user.name', 'guard');
    mkdirSync(path.join(dir, 'tools'), { recursive: true });
    mkdirSync(path.join(dir, OWNED), { recursive: true });
    writeFileSync(path.join(dir, 'tools/validate.mjs'), 'export const real = true;\n');
    writeFileSync(path.join(dir, `${OWNED}/.keep`), '');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'start');
    build(dir);
    return dir;
  };

  head('a delivery that only wrote a pack is let through');
  {
    const dir = repo(d => writeFileSync(path.join(d, `${OWNED}/2026-01-01-thing.json`), '{}'));
    ok(guard(dir) === true, 'a new pack is not a change outside content/packs');
    ok(existsSync(path.join(dir, `${OWNED}/2026-01-01-thing.json`)), 'and the pack is still there');
  }

  head('a leftover scratch script is swept up, not fatal');
  {
    const dir = repo(d => {
      writeFileSync(path.join(d, `${OWNED}/2026-01-01-thing.json`), '{}');
      writeFileSync(path.join(d, 'tmp_scan.mjs'), '// counting something\n');
      writeFileSync(path.join(d, 'tmp_check_env.mjs'), '// and something else\n');
    });
    // the exact pair that cost 2026-08-04 its boss
    ok(guard(dir) === true, 'the day survives its own leftovers');
    ok(!existsSync(path.join(dir, 'tmp_scan.mjs')), 'tmp_scan.mjs is gone');
    ok(!existsSync(path.join(dir, 'tmp_check_env.mjs')), 'tmp_check_env.mjs is gone');
    ok(existsSync(path.join(dir, `${OWNED}/2026-01-01-thing.json`)), 'and the pack it wrote is not');
  }

  head('a name with a space in it is still read as one file');
  {
    const dir = repo(d => writeFileSync(path.join(d, 'notes for me.txt'), 'x\n'));
    ok(guard(dir) === true, 'a space is not two problems');
    ok(!existsSync(path.join(dir, 'notes for me.txt')), 'and it is swept like any other');
  }

  head('untracked content outside the pack directory is swept, because it would be committed');
  {
    // `git add content/` takes everything under content/, so this is the one
    // kind of leftover that could reach the game without being validated.
    const dir = repo(d => writeFileSync(path.join(d, 'content/sneaky.json'), '{"items":[]}'));
    ok(guard(dir) === true, 'not fatal');
    ok(!existsSync(path.join(dir, 'content/sneaky.json')), 'but it does not survive to be added');
  }

  head('editing the game or its gate stops the run');
  {
    const edited = repo(d =>
      writeFileSync(path.join(d, 'tools/validate.mjs'), 'export const real = false;\n'));
    ok(guard(edited) === false, 'a weakened validator is refused');
    ok(existsSync(path.join(edited, 'tools/validate.mjs')), 'and nothing is swept on the way out');

    const deleted = repo(d => rmSync(path.join(d, 'tools/validate.mjs')));
    ok(guard(deleted) === false, 'a deleted validator is refused');

    const moved = repo(d => {
      git(d, 'mv', 'tools/validate.mjs', 'tools/validate.old.mjs');
    });
    ok(guard(moved) === false, 'a renamed validator is refused');
  }

  head('tampering is refused even when there is scratch to sweep as well');
  {
    const dir = repo(d => {
      writeFileSync(path.join(d, 'tools/validate.mjs'), 'export const real = false;\n');
      writeFileSync(path.join(d, 'tmp_scan.mjs'), '// noise\n');
    });
    ok(guard(dir) === false, 'the mess does not excuse the edit');
    ok(existsSync(path.join(dir, 'tmp_scan.mjs')), 'and the run stops before tidying');
  }

  head('the pack that was written is identified, and only if there is one of it');
  {
    const one = repo(d => writeFileSync(path.join(d, `${OWNED}/2026-01-01-thing.json`), '{}'));
    ok(packFile(one) === `${OWNED}/2026-01-01-thing.json`, 'one pack is found by name');

    const spaced = repo(d => writeFileSync(path.join(d, `${OWNED}/2026-01-01 thing.json`), '{}'));
    ok(packFile(spaced) === `${OWNED}/2026-01-01 thing.json`, 'even with a space in the name');

    const none = repo(() => {});
    let why = '';
    try { packFile(none); } catch (e) { why = e.message; }
    ok(/no pack was written/.test(why), 'an empty delivery is refused');

    const two = repo(d => {
      writeFileSync(path.join(d, `${OWNED}/2026-01-01-first.json`), '{}');
      writeFileSync(path.join(d, `${OWNED}/2026-01-01-second.json`), '{}');
    });
    why = '';
    try { packFile(two); } catch (e) { why = e.message; }
    ok(/wrote 2 packs/.test(why), 'two packs are refused rather than one being picked');
  }

  rmSync(scratchDir, { recursive: true, force: true });

  say('');
  say(fails ? `${fails} guard check(s) failed` : 'the guard holds up');
  return fails;
}

/* ---- entry point ----------------------------------------- */

const arg = process.argv[2];
if (arg === '--self-test') {
  process.exit(selfTest());
} else if (arg === '--pack') {
  // stdout is the answer, so the workflow can read it straight into an output
  try {
    process.stdout.write(packFile() + '\n');
  } catch (e) {
    warn(e.message);
    process.exit(1);
  }
} else {
  process.exit(guard() ? 0 : 1);
}

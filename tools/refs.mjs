/* ============================================================
   Names used but never imported
   ------------------------------------------------------------
   A module that calls a helper it forgot to import is not a
   syntax error and not an import error. It loads fine, renders
   fine, and throws a ReferenceError the moment that one line
   runs - so a stray helper in a branch nobody exercises can sit
   there indefinitely.

   That is how the crafting benches broke on 2026-08-09: tidying
   an unused-looking import out of js/ui/windows.js took
   `itemName` with it, which one line of openMake still called.
   Every other window was fine. Nothing failed until somebody
   clicked an anvil.

   This reads every module's exports, then checks that anything
   calling one of those names has actually imported it. It is
   deliberately narrow - only names the project itself exports,
   only call positions - because a real scope analyser is a
   bigger thing than the bug it would be catching.

   Usage:  node tools/refs.mjs
   ============================================================ */

import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, rel, say } from './lib.mjs';

let fails = 0;
const ok = (c, m) => { say((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const head = m => say('\n== ' + m);

const DIRS = ['js/**/*.js', 'server/**/*.js'];

/** Every file we are prepared to reason about. */
async function sources() {
  const out = [];
  for (const pattern of DIRS) {
    for await (const f of glob(pattern, { cwd: ROOT })) {
      out.push(f.split(path.sep).join('/'));
    }
  }
  return out.sort();
}

/** `export function foo`, `export const foo =`, `export class Foo`. */
function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

/** Everything this module pulled in, by any import spelling. */
function importsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    // import * as X
    const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (star) names.add(star[1]);
    // the braced list, with `a as b` taking the local name
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const bit = part.trim();
        if (!bit) continue;
        const as = bit.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
        names.add(as ? as[1] : bit.split(/\s+/)[0]);
      }
    }
    // a default import, which is the bare name before any brace
    const dflt = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (dflt) names.add(dflt[1]);
  }
  return names;
}

/** Anything declared in this file, at any depth - good enough to not false-alarm. */
function locals(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:^|\s)class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // destructured bindings: const { a, b: c } = ...
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const bit = part.trim();
      if (!bit) continue;
      const renamed = bit.split(':');
      names.add((renamed[1] ?? renamed[0]).trim().split(/[\s=]/)[0]);
    }
  }
  // and parameters, which is the loosest part of this: any `name =>` or (a, b) =>
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const bit = part.trim().replace(/\s*=.*$/, '');
      if (/^[A-Za-z_$][\w$]*$/.test(bit)) names.add(bit);
    }
  }
  for (const m of src.matchAll(/(?:^|[\s(,])([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  // function parameters
  for (const m of src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) {
    for (const part of m[1].split(',')) {
      const bit = part.trim().replace(/\s*=.*$/, '');
      if (/^[A-Za-z_$][\w$]*$/.test(bit)) names.add(bit);
    }
  }
  /*
   * Method shorthand in classes and object literals, including the prefixes -
   * without `async` here, `async save() {` reads as a call to save() on the
   * declaration line itself, and accounts.js gets reported for calling the
   * method it is in the middle of defining.
   */
  for (const m of src.matchAll(
      /^\s{2,}(?:static\s+)?(?:async\s+|get\s+|set\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm)) {
    names.add(m[1]);
    for (const part of m[2].split(',')) {
      const bit = part.trim().replace(/\s*=.*$/, '');
      if (/^[A-Za-z_$][\w$]*$/.test(bit)) names.add(bit);
    }
  }
  return names;
}

/**
 * Strips comments and string bodies, so their contents cannot look like code -
 * but keeps what is inside `${...}`, because that is code.
 *
 * Blanking template literals whole is what let this bug through in the first
 * place. The line that broke the benches was
 *   `${n} x ${itemName(id)} (${invCount(s, id)})`
 * and a checker that deletes templates cannot see a single call in it.
 */
function code(src) {
  let s = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:/])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""');

  let out = '';
  for (let i = 0; i < s.length;) {
    if (s[i] !== '`') { out += s[i++]; continue; }
    i++;                                   // past the opening backtick
    let depth = 0;                         // brace depth inside ${ }
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') { i += 2; continue; }
      if (depth === 0) {
        if (c === '`') { i++; break; }      // end of the template
        if (c === '$' && s[i + 1] === '{') { depth = 1; i += 2; out += ' '; continue; }
        i++;                               // literal text: drop it
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { i++; out += ' '; continue; }
      }
      out += s[i++];                       // inside ${ }: keep it
    }
  }
  return out;
}

const files = await sources();

/* ---- what the project exports, and from where ------------- */

const exported = new Map();              // name -> [file, ...]
const raw = new Map();
for (const f of files) {
  const src = await readFile(rel(f), 'utf8');
  raw.set(f, src);
  for (const name of exportsOf(src)) {
    if (!exported.has(name)) exported.set(name, []);
    exported.get(name).push(f);
  }
}

head('the project knows what it exports');
ok(exported.size > 50, `${exported.size} exported names across ${files.length} modules`);

/* ---- and every caller of one has imported it -------------- */

head('nothing calls a helper it did not import');
const problems = [];
for (const f of files) {
  const src = code(raw.get(f));
  const imported = importsOf(raw.get(f));
  const own = locals(raw.get(f));
  const mine = exportsOf(raw.get(f));

  for (const [name, from] of exported) {
    if (imported.has(name) || own.has(name) || mine.has(name)) continue;
    // called as a bare function, not as a property of something
    const call = new RegExp(`(^|[^\\w$.'"\`])${name}\\s*\\(`, 'm');
    if (!call.test(src)) continue;
    problems.push({ f, name, from: from[0] });
  }
}

for (const p of problems) {
  ok(false, `${p.f} calls ${p.name}() — exported by ${p.from}, never imported here`);
}
ok(!problems.length, problems.length
  ? `${problems.length} name(s) would throw ReferenceError when that line runs`
  : `every call to one of the ${exported.size} exported names resolves`);

/* ---- and imports that are not used are worth knowing ------ */

head('no module imports something it never mentions');
const dead = [];
for (const f of files) {
  const src = code(raw.get(f));
  const body = src.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm, '');
  for (const name of importsOf(raw.get(f))) {
    const used = new RegExp(`(^|[^\\w$.])${name}(?![\\w$])`, 'm');
    if (!used.test(body)) dead.push({ f, name });
  }
}
for (const d of dead) ok(false, `${d.f} imports ${d.name} and never uses it`);
ok(!dead.length, dead.length
  ? `${dead.length} unused import(s) — tidy them, but check every branch first`
  : 'every import is used');

say('');
say(fails ? `${fails} reference check(s) failed` : 'every name resolves');
process.exit(fails ? 1 : 0);

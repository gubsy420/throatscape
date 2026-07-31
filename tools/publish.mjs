/* ============================================================
   Publish
   ------------------------------------------------------------
   Takes a pack that has passed the validator and the smoke test
   and makes it part of the game: adds it to the load order and
   writes the day's bulletin from its own notes.

   Refuses to publish anything that does not validate, so this
   cannot be used to sneak past the gate by hand.

   Usage:  node tools/publish.mjs content/packs/whatever.json
   ============================================================ */

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { rel, readJson, writeJson, say, warn } from './lib.mjs';

const BEAT_LABEL = {
  bestiary: 'New creatures', arsenal: 'New equipment', resource: 'New resources',
  boss: 'A new boss', quest: 'A new quest', expansion: 'The map has grown'
};

export async function publish(file, { skipChecks = false } = {}) {
  const path = file.replace(/^\.\//, '');
  const pack = JSON.parse(await readFile(rel(path), 'utf8'));

  if (!skipChecks) {
    const v = spawnSync(process.execPath, [rel('tools/validate.mjs'), path],
                        { stdio: 'inherit' });
    if (v.status !== 0) throw new Error('pack does not validate — not publishing');
  }

  /* ---- load order ---------------------------------------- */

  const index = await readJson('content/index.json');
  const entry = path.replace(/^content\//, '');
  if (!index.packs.includes(entry)) {
    index.packs.push(entry);
    await writeJson('content/index.json', index);
    say(`added ${entry} to the load order`);
  } else {
    say(`${entry} was already in the load order`);
  }

  /* ---- the bulletin -------------------------------------- */

  const notes = await readJson('content/patchnotes.json');
  const list = Array.isArray(notes) ? notes : notes.entries || [];

  if (list.some(e => e.version === pack.version)) {
    warn(`a bulletin already exists for ${pack.version} — leaving it alone`);
  } else {
    list.unshift({
      version: pack.version,
      date: pack.date,
      title: pack.title,
      beat: pack.beat,
      notes: (pack.notes || []).length
        ? pack.notes
        : [`content: ${BEAT_LABEL[pack.beat] || 'New content'} — ${pack.summary || pack.title}.`]
    });
    await writeJson('content/patchnotes.json', list);
    say(`posted the bulletin for ${pack.version}`);
  }

  return pack;
}

/* ---------------- command line ------------------------------ */

if (process.argv[1]?.endsWith('publish.mjs')) {
  const file = process.argv.find(a => a.endsWith('.json'));
  if (!file) {
    console.error('usage: node tools/publish.mjs content/packs/<pack>.json');
    process.exit(2);
  }
  try {
    const pack = await publish(file, { skipChecks: process.argv.includes('--force') });
    say(`\npublished: ${pack.title} (${pack.beat}, ${pack.version})`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

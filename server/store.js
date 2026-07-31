/* ============================================================
   Store - small atomic JSON persistence
   ------------------------------------------------------------
   Writes go to a temp file and are renamed into place, so a
   crash mid-write leaves the previous file intact rather than a
   half-written one. No database, no dependencies.
   ============================================================ */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const PLAYER_DIR = path.join(DATA_DIR, 'players');

export function initStore() {
  fs.mkdirSync(PLAYER_DIR, { recursive: true });
  // fail loudly at boot rather than on the first save
  const probe = path.join(DATA_DIR, '.writable');
  try {
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
  } catch (e) {
    throw new Error(
      `Data directory ${DATA_DIR} is not writable (${e.code}). ` +
      `Mount a writable volume there, or set DATA_DIR.`
    );
  }
  return DATA_DIR;
}

/** Reads JSON, returning `fallback` if the file is missing or corrupt. */
export async function readJson(file, fallback = null) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(`[store] could not read ${path.basename(file)}: ${e.message}`);
    }
    return fallback;
  }
}

/** Write-then-rename, so readers never see a partial file. */
export async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  const body = JSON.stringify(data);
  await fsp.writeFile(tmp, body, 'utf8');
  await fsp.rename(tmp, file);
}

/* ---------------- paths ------------------------------------- */

export const accountsFile = () => path.join(DATA_DIR, 'accounts.json');

/**
 * Player saves are one file each, keyed by the lowercased name. The key is
 * validated by the account layer before it ever reaches here, but re-check:
 * this value ends up in a filesystem path.
 */
export function playerFile(key) {
  if (!/^[a-z0-9_-]{2,12}$/.test(key)) throw new Error('bad player key: ' + key);
  return path.join(PLAYER_DIR, `${key}.json`);
}

export const readPlayer = key => readJson(playerFile(key), null);
export const writePlayer = (key, data) => writeJson(playerFile(key), data);

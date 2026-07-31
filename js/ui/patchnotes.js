/* ============================================================
   Patch notes
   ------------------------------------------------------------
   What changed since you last played, shown once, on the login
   screen, before you are in the world and busy. The server puts
   the newest few entries in its greeting; the whole history is
   a fetch away for anyone who wants to read further back.
   ============================================================ */

import { escapeHtml } from '../util.js';

const SEEN_KEY = 'throatscape.patch.seen';

export function latestSeen() {
  try { return localStorage.getItem(SEEN_KEY) || null; } catch { return null; }
}

export function markPatchSeen(version) {
  try { localStorage.setItem(SEEN_KEY, String(version)); } catch { /* private mode */ }
}

/** True if this version is news to whoever is sitting here. */
export function isUnread(patch) {
  return !!(patch && patch.latest && patch.latest !== latestSeen());
}

const KIND_LABEL = {
  content: 'New content', fix: 'Fixes', feature: 'Feature',
  balance: 'Balance', auto: 'Daily content'
};

/**
 * Shows the panel and resolves when it is dismissed. Reading it is what marks
 * it read - closing the tab on the login screen should not silently eat the
 * only chance to see what changed.
 */
export function showPatchNotes(patch, { all = false } = {}) {
  return new Promise(resolve => {
    const entries = (all ? patch.entries : patch.entries || []).slice(0, all ? 40 : 3);
    if (!entries.length) { resolve(); return; }

    const wrap = document.createElement('div');
    wrap.id = 'patch';

    const panel = document.createElement('div');
    panel.className = 'patch-panel';

    const head = document.createElement('div');
    head.className = 'patch-head';
    head.innerHTML =
      `<div class="patch-kicker">Ward bulletin</div>` +
      `<div class="patch-title">${escapeHtml(entries[0].title || 'The ward has changed')}</div>` +
      `<div class="patch-date">${escapeHtml(entries[0].date || '')} · version ${escapeHtml(String(entries[0].version || ''))}</div>`;

    const body = document.createElement('div');
    body.className = 'patch-body';
    for (const e of entries) {
      body.appendChild(entryEl(e, e === entries[0]));
    }

    const foot = document.createElement('div');
    foot.className = 'patch-foot';
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.textContent = all ? 'Close' : 'Back to work';
    foot.appendChild(btn);
    const note = document.createElement('p');
    note.className = 'patch-note';
    note.textContent = all
      ? 'Every bulletin the ward has posted.'
      : 'Type /patch in the chat box to read this again.';
    foot.appendChild(note);

    panel.append(head, body, foot);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);

    const done = () => {
      if (patch.latest) markPatchSeen(patch.latest);
      wrap.remove();
      window.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') done(); };
    btn.addEventListener('click', done);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) done(); });
    window.addEventListener('keydown', onKey);
    btn.focus();
  });
}

function entryEl(e, first) {
  const div = document.createElement('div');
  div.className = 'patch-entry';
  if (!first) {
    div.innerHTML =
      `<h3>${escapeHtml(e.title || '')}</h3>` +
      `<div class="patch-meta">${escapeHtml(e.date || '')} · version ${escapeHtml(String(e.version || ''))}</div>`;
  }

  const ul = document.createElement('ul');
  ul.className = 'patch-list';
  for (const line of e.notes || []) {
    const li = document.createElement('li');
    // "kind: text" puts a little label on the line, the way a changelog does
    const m = /^(\w+):\s*(.+)$/.exec(String(line));
    if (m && KIND_LABEL[m[1]]) {
      li.innerHTML = `<span class="patch-tag">${escapeHtml(KIND_LABEL[m[1]])}</span>` +
                     escapeHtml(m[2]);
    } else {
      li.textContent = String(line);
    }
    ul.appendChild(li);
  }
  div.appendChild(ul);
  return div;
}

/** The whole history, for /patch. */
export async function fetchAllNotes() {
  const r = await fetch('/content/patchnotes.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('No bulletins found.');
  const all = await r.json();
  const entries = Array.isArray(all) ? all : all.entries || [];
  return { latest: entries[0]?.version, entries };
}

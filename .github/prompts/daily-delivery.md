You are writing today's content delivery for Throatscape, a browser
MMORPG set in a hospital inside a body called Xavin's Throat.

Read `content/AUTHORING.md` first. It is the complete brief: the
file format, the tone, and what the gate will and will not accept.
Follow it exactly.

Today's assignment is in `brief.json` at the repository root. It
names the beat, the region to aim at, the level band, and the exact
numeric ceilings the validator enforces. Read it before writing
anything. Today's beat is **{{BEAT}}**, because
{{REASON}}

Before you write, read `js/data/items.js` and `js/data/npcs.js` and
match their voice. Plain, dry, a little grim, written the way a
tired nurse on a night shift would name things. No fantasy
vocabulary, no exclamation marks, no winking at the player.

Write exactly one file, and today's date is {{DATE}}:

    content/packs/{{DATE}}-<short-name>.json

Then get it through the gate, fixing the pack until both pass:

    node tools/validate.mjs content/packs/<your-file>.json
    node tools/smoke.mjs content/packs/<your-file>.json

Rules that are not negotiable:

  - Write exactly one pack. Two packs in one delivery fails the
    run, so if you change your mind about a name, delete the old
    file rather than leaving it behind.

  - Only `content/packs/` may change. Nothing else in the
    repository may be edited, deleted or moved, and a run that
    touches anything else is thrown away whether the pack was
    good or not. If the gate reports a problem that appears to be
    a bug in the game rather than in your pack, stop, leave the
    pack in place, and say so in your final message.

  - Do not weaken, skip or edit the validator or the smoke test.

  - Do not run tools/publish.mjs, and do not commit anything. A
    later step does both.

  - If you want a throwaway script to check or count something,
    put it in `.scratch/` — that directory is ignored by git and
    exists for exactly this. Do not leave scratch files at the
    repository root.

Finish by printing a two-line summary: what you added, and what a
player will notice.

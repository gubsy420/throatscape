# Writing a content pack

This is the brief for whoever — or whatever — is writing today's delivery.

A **pack** is one JSON file in `content/packs/`. It is data, never code. It can
add things to the game; it can never change or remove anything that is already
there. That restriction is the whole reason a pack can be written and shipped
without a person reading every line: the worst a bad pack can do is add
something nobody likes, and the worst a malicious one can do is fail to load.

Quests are a list of steps, not a script. `js/data/content.js` compiles them
into the same hooks a hand-written quest uses. **No behaviour in this game is
ever written by the pipeline** — only numbers, names and prose.

## The loop

Every day, one delivery. What kind depends on the state of the world, not on
the calendar:

```
node tools/beat.mjs --out brief.json
```

That reads the map, takes a census of the newest region, and picks the one
addition that would do it the most good. New ground gets creatures, then
something to gather, then something at the end of it, then a reason to go.
Once the newest region has all four, and not before, the map is allowed to
grow again — and the cycle starts over in the new place.

The brief tells you the beat, the target region, the level band, and the exact
ceilings the validator will enforce. Read it before writing anything.

| Beat | What it brings | How often |
|---|---|---|
| `bestiary` | A handful of new creatures | freely |
| `arsenal` | A weapon or armour piece, and the recipe for it | freely |
| `resource` | Something to gather, and something to make from it | every few days |
| `boss` | One large thing in a lair, with a drop worth the trip | rarely |
| `quest` | A reason to visit what has been added lately | rarely |
| `expansion` | A whole new region attached to the edge of the map | rarest |

A delivery only brings what its beat is for. A `bestiary` day that also adds a
region is rejected. The budgets are in `content/schedule.json`.

## Writing it

1. `node tools/beat.mjs --out brief.json` — what is wanted today.
2. Write `content/packs/<YYYY-MM-DD>-<short-name>.json`.
3. `node tools/validate.mjs content/packs/<file>.json` — until it passes.
4. `node tools/smoke.mjs content/packs/<file>.json` — until it passes.
5. `node tools/publish.mjs content/packs/<file>.json` — load order and bulletin.

Steps 3 and 4 are not advisory. Nothing ships that has not passed both.

## Tone

Xavin's Throat is a body, and the game is set in the hospital inside it.
Everything is named the way a tired nurse on a night shift would name it:
plainly, a little grimly, without ceremony. Examine text is one sentence and
usually dry. Nothing winks at the player. Look at `js/data/items.js` and
`js/data/npcs.js` before writing a word — matching the voice matters more than
being clever.

Avoid: fantasy vocabulary (no "ancient runes of power"), exclamation marks,
anything that sounds like loot-box copy, and any name that would not fit on a
hospital label.

## The file

```jsonc
{
  "id": "rasp_camps",              // lower_snake_case, unique forever
  "version": "2026.08.02",         // the date, dotted
  "date": "2026-08-02",            // the same date, dashed
  "beat": "bestiary",              // must match what beat.mjs asked for
  "title": "The Rasp Camps",       // shown on the bulletin
  "summary": "One line for the gallery.",
  "author": "claude",

  "notes": [                       // the bulletin, in the player's language
    "content: Rasp hounds have moved into the Gullet Road."
  ],

  "items":     [ /* see below */ ],
  "objects":   [ /* gatherable scenery */ ],
  "npcs":      [ /* creatures and people */ ],
  "recipes":   [ /* things to make */ ],
  "shopStock": [ { "shop": "general", "item": "rasp_fibre", "n": 40 } ],
  "skills":    [ /* very rarely */ ],
  "quests":    [ /* see below */ ],

  "regions":   [ /* expansion beat only */ ],
  "sites":     [ /* a built place inside a region */ ],
  "spawns":    [ { "npc": "rasp_hound", "region": "gullet", "count": 10,
                   "allow": ["BLOOD", "TURF"] } ],
  "scatter":   [ { "type": "rasp_growth", "region": "gullet", "count": 14,
                   "allow": ["BLOOD", "TURF"] } ]
}
```

### Items

```jsonc
{
  "id": "rasp_fibre",
  "name": "Rasp fibre",
  "value": 18,                     // in coins
  "stack": true,                   // stackables share one inventory slot
  "examine": "One sentence. Dry.",
  "art": { "k": "fluff", "c": "#c9a68e" },

  // equipment only:
  "slot": "weapon",                // head cape neck ammo weapon body shield legs hands feet ring
  "req":  { "lancing": 20 },       // levels needed to wear it
  "speed": 4,                      // weapon attack cooldown in ticks, 2 is fastest
  "b": { "aStab": 44, "str": 34 }, // bonuses; see below

  // consumables:
  "heal": 12                       // hitpoints restored when eaten
}
```

Bonus keys: `aStab aSlash aCrush aRange aMagic` (attack), `dStab dSlash dCrush
dRange dMagic` (defence), `str rStr mDmg vigil` (damage and vigil).

Art shapes are listed in the brief. Anything not on that list is rejected,
because nothing can draw it.

### Creatures

```jsonc
{
  "id": "rasp_hound",
  "name": "Rasp hound",
  "hostile": true,
  "lvl": 38,                                        // displayed combat level
  "stats": { "att": 40, "str": 40, "def": 34, "hp": 78 },
  "bon":   { "atk": 34, "str": 34, "def": 30 },     // gear-equivalent bonuses
  "examine": "One sentence.",
  "art": { "k": "crawler", "c": "#8f6a5f" },
  "wander": 4,          // tiles from its spawn it will drift
  "aggroRange": 5,      // 0 means it never starts a fight
  "speed": 4,           // attack cooldown in ticks, minimum 3
  "respawn": 30,        // ticks
  "venomous": false,
  "boss": false,        // boss beat only; also set "size": 2
  "drops": [
    { "id": "bones", "n": [1, 1], "weight": 100 },  // weight 100 = always
    { "id": "coins", "n": [40, 190], "weight": 45 },
    { "id": "rasp_fibre", "n": [1, 3], "weight": 20 },
    { "id": null, "weight": 30 }                    // nothing
  ]
}
```

A friendly NPC is the same shape with `"hostile": false` and no combat block.
Give it `"talk": "<dialogue tree>"` to make it a quest giver, or
`"shop": "general"` to make it a shopkeeper.

### Gatherable scenery

```jsonc
{
  "id": "rasp_growth",
  "name": "Rasp growth",
  "act": "Gather",             // the left-click verb
  "skill": "foraging",
  "level": 24,
  "xp": 62,
  "yield": "rasp_fibre",
  "tool": null,                // or a tool tag an existing item provides
  "respawn": 60,               // ticks
  "art": "bush",
  "c": "#c9a68e",
  "block": false,              // false lets a player stand on the tile
  "examine": "One sentence."
}
```

A node with a `respawn` above zero can be caught empty, and while it is
empty it has to *look* empty — a stump rather than a faded tree. Only these
arts have a worked-out shape to become, so a gatherable that respawns must
use one of them:

`tree`, `rock`, `bush`, `fluffbush`, `pool`

Any other art is fine for a node with `"respawn": 0`, which never runs out.
`tools/render3d.mjs` enforces this, and it runs on your pack before it is
published.

### Quests

Steps, not code. Four kinds:

- `kill` — kill `count` of `npc`
- `fetch` — bring `count` of `item` back to the giver
- `search` — search scenery of type `obj` until it gives up `item`
- `treat` — use `item` on `npc`, `count` times

```jsonc
{
  "id": "holding_the_post",
  "name": "Holding the Post",
  "difficulty": "Intermediate",     // Novice Intermediate Experienced Master
  "length": "Short",
  "qp": 2,
  "start": "Speak to Warden Brack, out past the Gullet road.",
  "desc": "Two sentences of why.",
  "reqs": { "skills": { "foraging": 20 }, "quests": ["ward_duties"] },

  "dialogue": {
    "tree": "holding_the_post",     // an NPC must have talk: this
    "intro": ["First line.", "Second line, ending on the ask."],
    "accept": "Tell me what you need.",
    "refuse": "Not just now.",
    "briefing": "What to do first.",
    "nudge": "Said when you come back too early.",
    "finish": ["The pay-off.", "And a closing line."],
    "after": "Said forever afterwards.",
    "locked": "Said if the requirements are not met."
  },

  "steps": [
    { "kind": "kill", "npc": "rasp_hound", "count": 6,
      "text": "Thin out the rasp hounds.",     // journal line
      "tick": "One less.",                      // said on each one
      "done": "That is enough of them." },
    { "kind": "fetch", "item": "rasp_fibre", "count": 8,
      "text": "Bring eight rasp fibre back.",
      "done": "That is the lot." }
  ],

  "reportText": "Both jobs done. I should report back.",
  "doneText": "One line for the finished journal entry.",
  "rewards": {
    "qp": 2,
    "xp": { "foraging": 1200, "vitality": 600 },
    "items": [["coins", 900], ["rasp_lancet", 1]]
  }
}
```

### Sites

A built place inside an existing region: a clearing, a hut, a keeper.

```jsonc
{
  "id": "rasp_camp",
  "name": "Rasp Camp",
  "region": "gullet",
  "x": 84, "y": 70, "w": 11, "h": 9,
  "ground": "TURF",                          // clears the rectangle to this tile
  "building": { "x": 86, "y": 71, "w": 7, "h": 5, "floor": "FLOOR",
                "doors": [{ "x": 89, "y": 75 }] },
  "objects": [{ "type": "crate", "x": 87, "y": 72 },
              { "type": "brazier", "x": 85, "y": 77 }],
  "spawns":  [{ "npc": "warden_brack", "x": 89, "y": 77 }],
  "sign":    { "x": 93, "y": 77, "text": "RASP CAMP — supplies, such as they are." }
}
```

Find a clear spot first. Building on top of a bank booth is the one thing a
pack must never do, and the validator will catch it, but it is quicker to
check yourself: build the world in node, walk the rectangle, and confirm every
tile is walkable and `objectAt` is null.

### Regions — the expansion beat

New ground attaches to the **east or south edge only**. Every coordinate in
every saved game is measured from the same origin, so opening ground to the
north or west would move every player in the world by the width of the new
region. `beat.mjs` gives you the legal anchors and a suggested linking road.

```jsonc
{
  "id": "the_carina",
  "name": "The Carina",
  "x": 184, "y": 124, "w": 48, "h": 60,
  "base": "STONE",
  "tint": "#7a6a70",                 // the minimap colour
  "blurb": "One line, shown when you walk in.",
  "terrain": {
    "rules": [
      { "tile": "CAVEWALL", "coarse": { "below": 0.32 } },
      { "tile": "MOSS", "fine": { "above": 0.72 } }
    ]
  },
  "links": [ { "x1": 178, "y1": 152, "x2": 210, "y2": 152, "w": 4 } ]
}
```

`terrain.rules` are tried in order and the first match wins; `base` fills in
everywhere else. `coarse` is the big shapes, `fine` is the speckle; both run
0–1 and useful thresholds sit between 0.25 and 0.75. Tiles: `TURF PATH BILE
FLOOR CHALK BOG STONE BRIDGE CARPET MOSS CAVE CAVEWALL TILE_FLOOR BLOOD`
(`VOID` and `WALL` are not usable as terrain).

`links` are roads carved from the old map into the new one. Without one, the
region is an island and the validator will reject it — it checks that a nurse
standing at the respawn point can actually walk there.

An expansion should arrive furnished enough to be worth visiting: a site, a
couple of creatures, something to gather. It does not need everything — the
following days will fill it in. That is the point of the loop.

## What the validator checks

Run it. It explains itself. In summary:

- **Additive only** — no id may collide with anything that exists.
- **References** — everything mentioned must exist: drops, ingredients, quest
  targets, spawn regions, art shapes.
- **Scope** — the pack only contains what its beat allows.
- **Balance** — nothing may exceed the best thing already in the game at the
  same level by more than 15%. The brief gives you the exact numbers.
- **The world still builds** — and every creature, node, site, quest giver and
  region can be walked to from the ward.

`tools/quests.mjs` then plays the hand-written campaign end to end and checks
it still finishes. This matters more than it sounds: only the first quest to
claim an event gets it, so a `kill` step aimed at a creature an existing quest
is already waiting on will quietly break that quest. Pick a creature your own
pack added where you can.

Then `tools/smoke.mjs` boots the real simulation and plays it: it finds each
new creature and kills it, gathers each new node, makes each new recipe, wears
each new item, and takes each new quest from the first line of dialogue to the
reward. If any of that cannot be done, the pack does not ship.

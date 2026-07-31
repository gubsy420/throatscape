# Throatscape

A browser MMORPG in the tradition of RuneScape 2 / Old School RuneScape, except you
are not a knight — you are a **nurse**, and the world is the inside of a throat.

> The Throat is choking. The physicians fled. You have a scalpel, five gauze wraps,
> and forty beds that are not going to dress themselves.

Tile-based world, click to move, click to interact, 28-slot inventory, 17 skills on
the classic experience curve, attack-roll-versus-defence-roll combat, quests with
real prerequisites, and other players wandering the same map.

No build step. No dependencies. No image assets — every sprite and icon in the game
is drawn procedurally on a canvas.

---

## Running it

```bash
npm start          # or: node server/server.js
```

Then open **http://localhost:8080**.

The server needs Node 18+ and installs nothing — it serves the static client and runs
the multiplayer relay on the same port. Set `PORT` to move it.

Open a second browser window (or another machine on your network) to see other nurses
walking around and to chat with them.

> Opening `index.html` directly from disk will not work: the client uses ES modules,
> which browsers refuse to load over `file://`. Use the server.

---

## Playing

| Input | Does |
| --- | --- |
| Left-click | Walk, attack, talk, chop, mine, pick up — whatever is under the cursor |
| Right-click | Full option menu for that thing |
| `1`–`7` | Switch sidebar tab |
| `Enter` | Jump to the chat box |
| `Esc` | Cancel the current action, close windows |
| Click the run orb | Toggle running (costs energy) |
| Drag inventory items | Rearrange your pack |

Right-click an inventory item and choose **Use**, then click a target, to use one thing
on another — that is how you dress a patient's wound.

Chat commands: `/help`, `/save`, `/where`, `/players`.

### Getting started

1. Talk to **Orderly Punn** in the Mercy House, just north of where you wake up.
2. He starts *Ward Duties*: use a gauze wrap on three bedbound patients.
3. Report to **Matron Vell**. She has worse news and better rewards.

Progress saves to `localStorage` every 30 seconds and on exit. Settings → *Export save*
writes a JSON copy; *Delete this nurse* wipes it.

---

## The seventeen skills

**Combat** — Vitality, Lancing (attack), Vigour (strength), Warding (defence),
Injection (ranged, via syringe darts and blowpipes), Anatomancy (magic), Vigil
(prayer — blessings that burn points while lit).

**Production** — Triage (healing and cooking), Apothecary (potions), Suturing
(bandages and cloth armour), Forging (smelting and smithing).

**Gathering** — Foraging (herbs, lint, cotton), Tapping (throatwood, sapwood,
ivorybark), Delving (rocksalt, chalk, ironblood, bloodstone), Leeching (leeches,
trout, eels, gaspers).

**Support** — Scurrying, Salvage.

Experience follows the original curve exactly: level 99 is 13,034,431 XP.

---

## The world of Xavin's Throat

A 192 × 192 tile map in seven regions, all walkable end to end:

- **Lumbrisdale** — the starting town. Mercy House, bank, forge, apothecary, chapel.
- **The Palate Wilds** — open ground with hacklings and feral patients.
- **Vellumhaven** — stone city of guilds and expensive mercy.
- **The Bogged Fen** — standing bile, spinners, and a warden who wants a permit.
- **The Gullet Road** — a long red corridor. Nothing good uses it.
- **Uvula Heights** — chalk cliffs, plague monks, the Chapel of the Uvula.
- **The Larynx Deep** — the dark at the top, and the boss who never left her shift.

Five quests, twelve quest points, ending with *The Choking Matron*.

---

## How the numbers work

Combat uses the familiar rolls, so the stats behave the way you expect them to:

```
effective level  = level + style bonus + 8
attack roll      = effective attack  × (equipment attack bonus + 64)
defence roll     = effective defence × (equipment defence bonus + 64)

hit chance       = attack > defence
                   ? 1 - (defence + 2) / (2 × (attack + 1))
                   : attack / (2 × (defence + 1))

max hit          = floor(0.5 + effective strength × (strength bonus + 64) / 640)
```

Damage is rolled uniformly from 0 to max hit, so a hit that lands can still be a zero.
Experience is 4 × damage into the style's skill and 1.33 × damage into Vitality.

The world runs on a 600 ms tick, like the games it is imitating: movement, combat
cooldowns, resource rolls and vigil drain all resolve on that clock, while rendering
interpolates between ticks at full frame rate.

---

## Layout

```
index.html              markup for the boot, login and game shells
css/style.css           the whole interface
server/server.js        static file server + WebSocket relay, zero dependencies
js/
  main.js               boot, input handling, the game loop
  util.js               A*, seeded noise, maths, event bus
  net.js                multiplayer client (degrades to solo if it cannot connect)
  data/
    world.js            tiles, regions, terrain generation, town layouts, scenery
    items.js            every item, with stats and procedural art descriptors
    skills.js           skill definitions and the XP curve
    npcs.js             monsters, stats, drop tables, shopkeepers
    quests.js           the five quests and every dialogue tree
    recipes.js          smelting, forging, brewing, sewing, cooking
    magic.js            Anatomancy spells and the Vigil
    shops.js            stock lists and pricing
  game/
    state.js            the mutable world: inventory, skills, bank, save/load
    combat.js           NPC lifecycle, AI, hit resolution, death
    actions.js          movement, gathering, scenery interaction, item use
    questapi.js         the narrow surface quest scripts are written against
  engine/
    render.js           terrain chunks, entities, effects, minimap
    icons.js            procedural item icon painter
  ui/
    hud.js              chat, orbs, tooltips, context menu
    panels.js           the seven sidebar tabs
    windows.js          dialogue, bank, shop, production interfaces
```

---

## Multiplayer

The server implements RFC 6455 directly on the upgrade socket — handshake, frame
parsing, masking, ping/pong — so there is nothing to `npm install`. It relays position
(every 300 ms) and chat, with name sanitising and a message rate limit. Everything else
— your skills, inventory, quests, kills — is authoritative on your own client and
stored in your own browser.

That means this is a shared world to walk around and talk in, not a competitive one.
Anyone can edit their own save. Do not run it as a ranked server without moving the
game state to the server first.

## Notes and limitations

- Progress lives in `localStorage`, so it is per-browser and clearing site data
  deletes your nurse. Export a save first if you care about it.
- Monsters are simulated only on your own client, so two players fighting the same
  spawn each see their own copy of it.
- The map is generated deterministically from a fixed seed, so every client builds an
  identical world at boot.

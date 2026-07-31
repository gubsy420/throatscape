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

## Hosting it with Docker

```bash
docker compose up -d --build     # build and start
docker compose logs -f           # watch who joins
docker compose down              # stop and remove
```

The game is then on port 8080. To publish it somewhere else:

```bash
HOST_PORT=9000 docker compose up -d
```

Or without compose:

```bash
docker build -t throatscape .
docker run -d --name throatscape -p 8080:8080 --restart unless-stopped throatscape
```

The image is about 58 MB on `node:22-alpine` and has no build step, because the
project has no dependencies to install.

**What the container does:**

- runs as the unprivileged `node` user, never root
- mounts its root filesystem **read-only** — the server writes nothing to disk,
  and player progress lives in each browser's `localStorage`
- sets `no-new-privileges`, so nothing inside can escalate
- ships only `index.html`, `css/`, `js/`, `server/` and `package.json`; the
  Dockerfile, README and git history are deliberately left out, because the
  static server hands out everything beneath its root
- has a `HEALTHCHECK`, so `docker ps` tells you whether the ward is actually open
- handles `SIGTERM`, so `docker stop` takes about a second rather than sitting
  through the full ten-second timeout
- caps its own logs at 3 × 10 MB

There is no volume and no database. The container holds nothing you would miss if
it were destroyed — restarting it disconnects players, who reconnect on their own.

### Putting it on the internet

The server speaks plain HTTP and `ws://`. To expose it publicly, put it behind a
reverse proxy that terminates TLS and forwards WebSocket upgrades. With Caddy that
is the whole config:

```caddyfile
throatscape.example.com {
    reverse_proxy localhost:8080
}
```

Caddy handles the `Upgrade` and `Connection` headers itself and gets a certificate
automatically. On nginx you must forward the upgrade headers explicitly, or the
multiplayer socket will fail while the rest of the page loads fine:

```nginx
location / {
    proxy_pass http://localhost:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;
    proxy_read_timeout 3600s;   # the game socket is long-lived and mostly idle
}
```

The client picks `wss://` automatically when the page is served over HTTPS, so
nothing needs configuring on that side.

> **Before exposing it publicly**, read the multiplayer note further down. Game
> state is client-authoritative — anyone can edit their own save. That is fine for
> a world you walk around and chat in, and wrong for anything competitive.

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
Dockerfile              58 MB alpine image, non-root, read-only rootfs
docker-compose.yml      one service, no volumes, healthcheck, log rotation
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

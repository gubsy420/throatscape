# Throatscape

A browser MMORPG in the tradition of RuneScape 2 / Old School RuneScape, except you
are not a knight — you are a **nurse**, and the world is the inside of a throat.

> The Throat is choking. The physicians fled. You have a scalpel, five gauze wraps,
> and forty beds that are not going to dress themselves.

Tile-based world, click to move, click to interact, 28-slot inventory, 17 skills on
the classic experience curve, attack-roll-versus-defence-roll combat, quests with
real prerequisites, and other players wandering the same map.

Accounts, monsters, loot, skills and quests all live **on the server**. The browser
draws what it is told and sends what you clicked; it does not decide anything.

No build step. No dependencies. No image assets — every sprite and icon in the game
is drawn procedurally on a canvas.

---

## Running it

```bash
npm start          # or: node server/server.js
```

Then open **http://localhost:8080**, pick *New nurse*, and choose a name and a
password of at least eight characters.

The server needs Node 18+ and installs nothing — it serves the static client, runs
the world, and holds the accounts, all on one port. Set `PORT` to move it and
`DATA_DIR` to move the save files (default `./data`).

Open a second browser window (or another machine on your network) to see other nurses
walking around and to chat with them. One account can only be logged in once; a second
login kicks the first.

> Opening `index.html` directly from disk will not work: the client uses ES modules,
> which browsers refuse to load over `file://`, and there is no world to play in
> without the server anyway.

### What is on disk

```
data/accounts.json      names, scrypt password hashes, live session tokens
data/players/<name>.json one file per nurse: skills, inventory, bank, quests, position
```

Back up `data/` and you have backed up the server. It is written atomically (temp file
then rename), flushed every 30 seconds and on a clean shutdown, and is in `.gitignore`
and `.dockerignore` — do not commit it.

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
docker run -d --name throatscape -p 8080:8080 \
  -v throatscape-data:/data --restart unless-stopped throatscape
```

The image is about 58 MB on `node:22-alpine` and has no build step, because the
project has no dependencies to install.

**What the container does:**

- runs as the unprivileged `node` user, never root
- mounts its root filesystem **read-only**, with `/data` as the one writable
  mount — that is where accounts and player saves go
- sets `no-new-privileges`, so nothing inside can escalate
- ships only `index.html`, `css/`, `js/`, `server/` and `package.json`; the
  Dockerfile, README, `data/` and git history are deliberately left out, because
  the static server hands out everything beneath its root
- has a `HEALTHCHECK`, so `docker ps` tells you whether the ward is actually open
- handles `SIGTERM`, so `docker stop` takes about a second rather than sitting
  through the full ten-second timeout
- caps its own logs at 3 × 10 MB

**The volume is the game.** Destroy `throatscape-data` and every account and every
nurse goes with it. Session tokens are saved alongside the accounts, so restarting
the container to pick up a new image does not throw logged-in players back to the
password prompt — they reconnect on their own within a few seconds.

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

> **Put TLS in front of it before letting anyone else in.** Passwords are sent over
> the game socket, so on a plain `ws://` connection they cross the network in the
> clear. The server says so at startup and the login screen warns anyone who is not
> on `localhost`. This is a hobby game — tell your players to use a password they
> use nowhere else.

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

Chat commands: `/help`, `/where`, `/players`, `/logout`.

### Getting started

1. Talk to **Orderly Punn** in the Mercy House, just north of where you wake up.
2. He starts *Ward Duties*: use a gauze wrap on three bedbound patients.
3. Report to **Matron Vell**. She has worse news and better rewards.

There is no save button. The server holds your nurse and writes her to disk on its own
schedule, so closing the tab, losing your connection or being kicked by a power cut all
land you back exactly where you were. Settings → *Log out* ends the session and forgets
the token in this browser.

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
Dockerfile              58 MB alpine image, non-root, read-only rootfs, /data volume
docker-compose.yml      one service, one named volume, healthcheck, log rotation
server/
  server.js             static files, RFC 6455 socket, the auth gate, the tick loop
  sim.js                the authoritative world: players, NPCs, ground, snapshots
  accounts.js           registration, scrypt hashing, sessions, login throttling
  store.js              atomic JSON reads and writes under DATA_DIR
js/
  main.js               boot, the login screen, input handling, the render loop
  util.js               A*, seeded noise, maths, event bus
  net.js                the protocol: intents out, snapshots folded into the replica
  data/
    world.js            tiles, regions, terrain generation, town layouts, scenery
    items.js            every item, with stats and procedural art descriptors
    skills.js           skill definitions and the XP curve
    npcs.js             monsters, stats, drop tables, shopkeepers
    quests.js           the five quests and every dialogue tree
    recipes.js          smelting, forging, brewing, sewing, cooking
    magic.js            Anatomancy spells and the Vigil
    shops.js            stock lists and pricing
  game/                 DOM-free, so the server imports these modules directly
    state.js            the mutable world: inventory, skills, bank, serialisation
    combat.js           NPC lifecycle, AI, hit resolution, death
    actions.js          movement, gathering, scenery interaction, item use
    economy.js          crafting, buying and selling as pure transitions
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

## How the server and client split the work

The server implements RFC 6455 directly on the upgrade socket — handshake, frame
parsing, masking, ping/pong — so there is nothing to `npm install`.

Everything that matters happens there. The client sends **intents** — *walk here*,
*attack that*, *brew twenty of these* — and the server decides whether they are
allowed: whether you are close enough to the cauldron, whether you own the ingredients,
whether the monster is real. Every 600 ms tick it sends each player a snapshot of what
they can see, and the browser folds it into a local replica and draws it, interpolating
between ticks so movement stays smooth at full frame rate.

The replica is a lie the client is welcome to tell itself. Editing it in the console
changes what you see for about half a second; the server re-asserts the truth and never
believed the client in the first place. There is no client-side simulation left to
exploit.

The map is the one thing that is never transmitted. It is generated deterministically
from a fixed seed, so the server and every client build a byte-identical world at boot
and only living things need to travel over the wire.

**Accounts.** Passwords are hashed with scrypt (N=16384) and a per-account salt, and
compared in constant time. A login attempt is hashed even when the name does not exist,
so timing does not tell you who has an account. Failures back off per name *and* per
address: five strikes, then a minute, doubling to a fifteen-minute cap. Nothing in the
codebase ever logs a password or a hash.

## Notes and limitations

- There is no offline or single-player mode. No server, no game.
- Saves from the old client-authoritative build do not carry over; `localStorage`
  now holds nothing but a session token.
- One account, one session. Logging in again elsewhere kicks the first connection
  with a message rather than letting two copies of you diverge.
- Names are 2–12 characters and are compared case-insensitively, so `Vell` and
  `vell` are the same nurse.
- Every player shares one set of monsters and one set of dropped items, which is the
  point, but it also means the whole world runs in a single Node process. It is sized
  for friends, not for a few hundred strangers.

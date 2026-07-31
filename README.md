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

No build step. No dependencies. No assets of any kind — every sprite and icon is
drawn procedurally on a canvas, and every sound and every bar of music is
synthesised in the browser from oscillators and a noise buffer.

---

## Running it

```bash
npm start          # or: node server/server.js
```

Then open **http://localhost:8080**, pick *New nurse*, and choose a name and a
password of at least eight characters.

The server needs Node 18+ and installs nothing — it serves the static client, runs
the world, and holds the accounts, all on one port. Set `PORT` to move it,
`DATA_DIR` to move the save files (default `./data`), and `PUBLIC_URL` to pin
the address used in link previews (it is worked out from the request
otherwise).

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

A prebuilt image is published to GitHub Packages on every push to `main`, so there
is nothing to check out or build:

```bash
docker run -d --name throatscape \
  -p 8080:8080 -v throatscape-data:/data --restart unless-stopped \
  ghcr.io/gubsy420/throatscape:latest
```

Tags: `latest` follows `main`, `sha-<short>` pins an exact commit, and `v1.2.3` /
`v1.2` appear if a release is tagged. The image is `linux/amd64`.

### On Unraid

*Docker → Add Container*, then:

| Field | Value |
| --- | --- |
| Repository | `ghcr.io/gubsy420/throatscape:latest` |
| Network type | Bridge |
| Port | container `8080` → whatever host port you like |
| Path | container `/data` → e.g. `/mnt/user/appdata/throatscape` |

The `/data` path is the only one that matters. Everything else in the container is
read-only and disposable.

### Building it yourself

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

### Link previews

Sharing the URL anywhere that unfurls links — Discord, Slack, iMessage,
Twitter, Signal — shows a card with the wordmark, a description and a shot of
the ward. The tags are in `index.html` and the image is `assets/preview.jpg`.

Crawlers will not resolve a relative image URL, so the tags have to carry an
absolute one, and a container has no way of knowing its own public address.
The server therefore fills `%ORIGIN%` in from the request: `X-Forwarded-Host`
and `X-Forwarded-Proto` if a proxy set them, `CF-Visitor` if Cloudflare did,
otherwise the `Host` header. Behind a Cloudflare tunnel that works with no
configuration at all.

Pin it if you would rather not depend on headers:

```
PUBLIC_URL=https://throatscape.example.com
```

The `Host` header comes from the client, so anything that is not a plain
hostname is refused and the tags fall back to relative URLs rather than
reflecting whatever was sent.

To change the picture, take a screenshot of the game 1200x630 or larger at
roughly 1.91:1 and replace `assets/preview.jpg`. Sharing platforms cache
aggressively; Discord and Slack key on the URL, so append `?v=2` to the
`og:image` tag or use their debugger to refresh.

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
| `←` `→` | Turn the camera around you |
| `↑` `↓` | Raise the camera overhead, or bring it down to eye level |
| Mouse wheel | Zoom in and out |
| Click the compass | Face north again |
| `1`–`7` | Switch sidebar tab |
| `Enter` | Jump to the chat box |
| `Esc` | Cancel the current action, close windows |
| Click the run orb | Toggle running (costs energy) |
| Drag inventory items | Rearrange your pack |
| Hover an item | Its stats, its requirement, and what it is |
| Click a skill | Everything it unlocks, level by level |
| Click another nurse | Offer them a trade |

Right-click an inventory item and choose **Use**, then click a target, to use one thing
on another — that is how you dress a patient's wound.

Chat commands: `/help`, `/where`, `/players`, `/effects`, `/patch`, `/logout`.

### Talking to people

`/tell <name> <message>` whispers someone — no friendship needed, they just have
to be on shift — and `/r` replies to whoever last whispered you. Names containing
a space need quotes: `/tell "Nurse Vell" hello`.

The Friends tab keeps a list that survives logout and tells you when someone comes
on or goes off shift. `/add <name>`, `/remove <name>`, `/friends`, or use the tab.
Clicking a friend who is on shift primes the chat box to whisper them.

Public messages take the old colour and motion prefixes, and both show up in the
chat log *and* in the bubble over your head:

```
rainbow:wave:the ward is bleeding
red:shake:CODE BLUE
```

Colours are `red`, `green`, `cyan`, `purple`, `white`, `yellow`, `flash1`–`flash3`,
`glow` and `rainbow`; motions are `wave`, `wave2`, `shake` and `slide`. One of each,
in either order. Anything else stays part of the message, so `note: fetch the gauze`
says exactly that. `/effects` prints the list in game.

### Trading

Click another nurse, or type `/trade <name>`. Nothing opens until they ask you
back — the same handshake the old games used, and the reason nobody can shove a
window in front of you mid-fight.

The trade has two screens. On the first you both put things up and both press
Accept; on the second you are shown exactly what is about to change hands and
have to accept again. Any change at all — one coin added or taken back — drops
both acceptances and returns you both to the first screen.

Offered items leave your pack the moment you offer them and are held until the
trade settles. Every way out gives them back: declining, walking more than four
tiles apart, dying, logging out, or the server restarting under you. Quest items
cannot be offered at all.

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

## Sound

There are no audio files. Effects are built from oscillators and one shared noise
buffer, and the score is generated a bar at a time from a mode, a four-chord loop
and a tempo — so the whole soundtrack costs nothing to download.

Each region has its own theme, from Lumbrisdale's tired minor to the phrygian
dominant of the Larynx Deep, over a detuned drone and a slow lub-dub that is
either a heart or a machine imitating one. Being attacked switches to something
faster and darker until you are left alone again.

Settings → *Music* and *Sound effects*, with volume sliders for each. Browsers do
not allow sound before you have touched the page, so the first click starts it.

---

## The world of Xavin's Throat

A map that starts at 192 × 192 tiles in seven regions, all walkable end to end,
and grows eastward and southward as new ground is opened up:

- **Lumbrisdale** — the starting town. Mercy House, bank, forge, apothecary, chapel.
- **The Palate Wilds** — open ground with hacklings and feral patients.
- **Vellumhaven** — stone city of guilds and expensive mercy.
- **The Bogged Fen** — standing bile, spinners, and a warden who wants a permit.
- **The Gullet Road** — a long red corridor. Nothing good uses it.
- **Uvula Heights** — chalk cliffs, plague monks, the Chapel of the Uvula.
- **The Larynx Deep** — the dark at the top, and the boss who never left her shift.
- **The Cartilage Rings** — pale rings standing in rows, east of the Deep. The
  first ground opened by the content pipeline.

Six quests, fourteen quest points. The hand-written arc ends with *The Choking
Matron*; everything after that arrives a day at a time.

---

## Content, a day at a time

The game grows on its own. Once a day a GitHub Action asks what the world is
short of, has Claude write it, puts it through a gate, and publishes it only if
it passes. Players see a bulletin on the login screen the next time they log in.

### What arrives, and when

Nothing is on a calendar. `tools/beat.mjs` takes a census of the newest region —
what lives there, what can be gathered there, whether anything waits at the end
of it, whether anybody has a reason to go — and asks for whichever of those is
missing. Only when the newest ground has all four is the map allowed to grow
again, and then the cycle starts over in the new place.

| Beat | Brings | Roughly |
| --- | --- | --- |
| `bestiary` | A handful of new creatures | often |
| `arsenal` | A weapon or a piece of armour, and its recipe | often |
| `resource` | Something to gather, and something to make from it | every few days |
| `boss` | One large thing in a lair, with a drop worth the trip | rarely |
| `quest` | A reason to visit what has been added lately | rarely |
| `expansion` | A whole new region, joined to the edge of the map | rarest |

The cadence and the size of each delivery live in `content/schedule.json`. Edit
that file and nothing else to change how fast the game grows.

### What a delivery is

One JSON file in `content/packs/`. **Data, never code.** A pack can add items,
scenery, creatures, recipes, shop stock, skills, quests and regions; it cannot
change or remove anything that already exists. Quests arrive as a list of steps —
`kill`, `fetch`, `search`, `treat` — which `js/data/content.js` compiles into the
same hooks a hand-written quest uses. No behaviour in this game is ever written
by the pipeline, only numbers, names and prose.

That is what makes the whole thing safe to run unattended: the worst a bad pack
can do is add something nobody likes, and the worst a malicious one can do is
fail to load.

`content/AUTHORING.md` is the complete brief, and the two packs in
`content/packs/` are worked examples — one quest, one map expansion.

### The gate

Nothing ships that has not passed both, twice: once inside the authoring session
and again from outside it, so a pack that was never actually checked cannot reach
the game.

```
node tools/validate.mjs content/packs/whatever.json
node tools/smoke.mjs    content/packs/whatever.json
```

**`validate.mjs`** checks that the pack is additive only; that everything it
mentions exists (drops, ingredients, quest targets, spawn regions, art shapes);
that it only contains what its beat allows; that nothing exceeds the best thing
already in the game at the same level by more than 15%; and that the world still
builds afterwards, with every creature, node, site, quest giver and region
reachable on foot from the ward.

**`quests.mjs`** plays the hand-written campaign end to end against the real
simulation, through the real dialogue trees, and checks that everything each
quest asks for is in the world and reachable. It runs before and after every
delivery, because a pack can add a step that claims a kill the moment before
the quest that was waiting for it.

**`smoke.mjs`** boots the real simulation and plays it. It finds each new
creature and kills it, gathers each new node, makes each new recipe, wears each
new item, and takes each new quest from the first line of dialogue through to the
reward. Then it boots the actual server and connects a real WebSocket client to
it. If any of that cannot be done, the pack does not ship.

### Growing the map

New regions attach to the **east or south edge only**. Every coordinate in every
saved game is measured from the same origin, so opening ground to the north or
west would move every player in the world by the width of the new region.

Terrain is a recipe rather than a special case — a base tile and a short list of
noise rules — so a pack can open new ground without anyone editing `world.js`.
The seven original regions were converted to the same format, and the map they
generate is byte-for-byte what it was before.

### Running it yourself

```
node tools/beat.mjs                       # what does the world need today?
node tools/beat.mjs --beat expansion      # ask for something specific
node tools/validate.mjs --all             # re-check every pack that has shipped
node tools/smoke.mjs                      # play the whole game headlessly
node tools/publish.mjs content/packs/x.json
```

The workflow is `.github/workflows/daily-content.yml`. It needs one secret,
`CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), or `ANTHROPIC_API_KEY`
instead. Without it the scheduled job fails and opens an issue; the live game is
untouched. `workflow_dispatch` takes a `beat` to force and a `dry_run` flag that
writes and tests a pack without publishing it.

If a delivery fails the gate, nothing is published, the pack and the brief are
attached to the run as an artifact, and an issue is opened saying so.

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
assets/preview.jpg      the 1200x630 card shown when the URL is shared
css/style.css           the whole interface
Dockerfile              58 MB alpine image, non-root, read-only rootfs, /data volume
docker-compose.yml      one service, one named volume, healthcheck, log rotation
server/
  server.js             static files, RFC 6455 socket, the auth gate, the tick loop
  sim.js                the authoritative world: players, NPCs, ground, snapshots
  trade.js              the two-screen trade, and the escrow that makes it safe
  accounts.js           registration, scrypt hashing, sessions, login throttling
  store.js              atomic JSON reads and writes under DATA_DIR
js/
  main.js               boot, the login screen, input handling, the render loop
  util.js               A*, seeded noise, maths, event bus
  engine/
    render3d.js         the 3D view: terrain, models, picking, the frame
    render.js           the flat overhead view, kept as the fallback
    overlay.js          names, chat, hitsplats and the minimap, drawn over the scene
    gl/                 matrices, shaders, meshes, the orbiting camera
    models/             the ground, and every creature and prop, built from solids
  net.js                the protocol: intents out, snapshots folded into the replica
  data/
    world.js            tiles, regions, terrain generation, town layouts, scenery
    content.js          content packs: applying them, and compiling their quests
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
    chatfx.js           the colour and motion prefixes, parsed once for both ends
    skillguide.js       what each skill unlocks, gathered from the data files
    questapi.js         the narrow surface quest scripts are written against
  engine/
    render.js           terrain chunks, entities, effects, minimap
    icons.js            procedural item icon painter
    audio.js            synthesised effects and a generative score per region
  ui/
    hud.js              chat, orbs, tooltips, context menu
    panels.js           the eight sidebar tabs
    windows.js          dialogue, bank, shop, trade, production interfaces
    patchnotes.js       the ward bulletin, shown once per update
content/
  index.json            the load order; every pack the game applies at boot
  schedule.json         how often each kind of delivery may happen, and how big
  patchnotes.json       every bulletin, newest first
  AUTHORING.md          the complete brief for whoever writes a pack
  packs/*.json          the deliveries themselves
tools/
  beat.mjs              decides what the world needs next, and writes the brief
  validate.mjs          the gate: shape, references, scope, balance, reachability
  smoke.mjs             plays the new content headlessly, then over a real socket
  quests.mjs            plays the hand-written campaign from end to end
  publish.mjs           load order and bulletin, for packs that passed
  lib.mjs               shared plumbing and the balance curves
```

---

## How the world is drawn

The Throat is drawn in 3D: low-polygon, flat-shaded, untextured, with a camera you
orbit around yourself. That is a description of the renderer and of the games this
one is imitating, in that order.

There is no engine behind it and nothing was installed. `js/engine/gl/` is about six
hundred lines of matrices, shaders and vertex buffers, and one shader pair serves the
whole world: a colour per vertex, a key light, a two-colour fill from sky and ground,
and distance fog. Every model is built at boot out of boxes, six-sided drums and cones
by code that reads the same object and creature definitions the flat renderer read —
so a content pack that adds a tree in a new colour gets a tree in a new colour, with
nobody modelling anything.

**The server never hears about any of it.** It still thinks in flat tiles. Walkability,
pathfinding, ranges and every saved position mean exactly what they meant, and a player
on the flat renderer and a player on the 3D one are standing in the same place. Height
is a deterministic noise field computed on the client from the same hash the tile
speckle always used, which is why it needs nothing from the wire and why two machines
cannot disagree about it.

Heights live on tile **corners**, never on tiles, so neighbouring tiles share their
edges and the landscape has no cracks in it. Ground colour is blended per corner too,
but only between tiles of the same kind: blend everything and a stone road dissolves
into the turf either side of it, blend nothing and every field is a chequerboard.

The interface stays flat, on a 2D canvas over the scene — names, health bars, chat,
hitsplats, the minimap. Text pinned into the world would swim as the camera turned and
blur as it came close; drawn here it is sharp at every angle, which is how the older
games did it too.

**If it cannot run, it does not.** No WebGL2, or a context that fails to start, and the
original flat overhead renderer takes over with a line in the chat log saying so. It is
also just a setting — *Settings → Flat overhead view* — for anyone who prefers it.

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

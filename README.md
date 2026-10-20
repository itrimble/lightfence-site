# lightfence-site

Public marketing site for **Lightfence**, a neon arcade game for Apple TV (now on the App Store), with iPhone and iPad coming soon.

- Preferred host: `https://lightfence.remnantsecurity.com/`
- GitHub Pages + CNAME `lightfence` → Pages host
- PostHog on the page (`posthog.js`), as on the other Remnant app sites
- A static page: `index.html`, `lightfence.css`, `lightfence.js`; every path is relative

## The playable board

`play.js` (rules, input, the ask), `play-draw.js` (drawing), `play-hud.js`
(HUD and sound), `play-gl.js` (WebGL2 bloom and effects; Canvas 2D shadows
when there is no WebGL2) and `play.css` put a three-stage demo of the game in
How it plays. After the third win it offers the App Store, reading the link
from the page. The method, research and checklist are in
`~/projects/site-templates/docs/PLAYABLE-DEMO.md`; test it with
`site-templates/scripts/test-playable.mjs` (WebGL2, `--nogl`, `--phone`).

It plays and looks like the iPhone game's first three stages (qix-swift
`GameScene.swift`, `GameHUD.swift`, `QixGame.swift`, `Sectors/`):

- **Stages** are Aqua Reef 1-3 with the game's own wall layouts and names
  (`Resources/WaveRecipes/campaign-layouts.json`: Reef Twin Gates, Reef
  Broken Causeway, Reef Staggered Columns), on a 40 x 46 cell board. Speeds
  come from `LevelCatalog`: the player runs at 9 u/s and draws at 0.75 of
  that; the Snarl moves at 3 u/s, erratic 0.5, turning toward an open line
  at aggression 0.15; Tracers run at 5 u/s.
  Softened for a first-time player: targets 60, 63, 66 % (the game asks 66 %
  throughout) and 1, 2, 3 Tracers (the game fields 2, 2, then 4 faster ones on
  stage 3's Perimeter Patrol). Stage 2's orbs are left out.
- **The board** is the game's tilted floor (the same homography, far edge at
  0.78), with its glowing border and floor grid, over the sector painting under
  the Snarl's veil. Claimed ground shows the painting lit and flashes as it
  is won; the world brightens with every claim, and fully at a stage clear.
  Walls are the game's blocks with the reef wall texture.
- **The living world** follows `WorldScriptCatalog.aquaReef`: marine snow
  (faint over the board), two drifting haze bands, light shafts, jellyfish,
  a fish school from stage 2, and the painting's depth layers breathing and
  leaning toward the marker. Reduce Motion shows a still frame until Play.
- **The HUD** copies the game's: SCORE and BEST, the CLAIM ring with its
  target tick, LIVES, the sector title and the stage line, in the game's colours
  (Menlo and Avenir become JetBrains Mono and Space Grotesk).
- **Sound** is the game's designed effects. It is fetched only after Play
  (a click), never autoplays, and has a mute toggle (also M) remembered in
  localStorage.
- **Assets load lazily** when the board comes within 800 px of the
  viewport: 134 KB of art (`img/play/`), plus 136 KB of sound after Play.

Where the demo's assets come from (qix-swift, converted with Pillow and
`cwebp`):

| Site file | qix-swift source |
|---|---|
| `img/play/reef-far.webp` (540 x 960) | `Resources/Art/WorldLayers/aqua_reef/aqua_reef_0..2.webp`, composited |
| `img/play/reef-near.webp` (720 x 1280, alpha) | `aqua_reef_3..5.webp`, composited |
| `img/play/snarl-blue/green/red.webp` | `Resources/Art/Enemies/drone_blue/green/red.png` (`AssetStore.enemyAsset`, variant = stage) |
| `img/play/tracer.webp` | `Resources/Art/Enemies/drone_gold.png` (the Sparx sprite) |
| `img/play/marker.webp` | `Resources/Art/Pickups/pickup_energy.png` (`AssetStore.gameplayPlayerAsset`) |
| `img/play/reef-wall.webp` | `Resources/Backgrounds/terrain_aqua_reef_v1.png` (`AssetStore.wallAsset`) |
| `media/sfx/{claim,combo,die,win,confirm,select}.m4a` | `Resources/Effects/` (made in code by `Tools/Sound/sfx.py`) |

## Where the media comes from

The game repo (`qix-swift`) is the source:

- `img/hero-*`, `img/og-image.jpg`, `img/icon-512.*`, `img/apple-touch-icon.png`, `img/favicon-64.png`,
  `img/tv-icon.*`: `python3 Tools/TVIcon/site.py Tools/TVIcon/source . <this dir>` (same art and
  lettering as the app icons).
- `media/sector-N.*` and `img/sector-N-poster.*`: the in-app Sector Showcase loops
  (`Resources/Showcase/showcase-sN.mp4`, from `Tools/Showcase/record.sh` and `encode.sh`), at 720p30
  H.264 and VP9.
- `media/reel.*`: 1.8 s from 4 s into each of the ten loops, in sector order.

The tvOS App Store link is live at https://apps.apple.com/us/app/lightfence/id6822773360 - the iPhone/iPad link is still a placeholder until that listing is live (`TODO(ios-store-link)` in `index.html`).

Publisher host: Remnant Security Group LLC portfolio.

# lightfence-site

Public marketing site for **Lightfence**, a neon arcade game for iPhone, iPad and Apple TV (coming soon).

- Preferred host: `https://lightfence.remnantsecurity.com/`
- GitHub Pages + CNAME `lightfence` → Pages host
- PostHog on the page (`posthog.js`), as on the other Remnant app sites
- A static page: `index.html`, `lightfence.css`, `lightfence.js`; every path is relative

## Where the media comes from

The game repo (`qix-swift`) is the source:

- `img/hero-*`, `img/og-image.jpg`, `img/icon-512.*`, `img/apple-touch-icon.png`, `img/favicon-64.png`,
  `img/tv-icon.*`: `python3 Tools/TVIcon/site.py Tools/TVIcon/source . <this dir>` (same art and
  lettering as the app icons).
- `media/sector-N.*` and `img/sector-N-poster.*`: the in-app Sector Showcase loops
  (`Resources/Showcase/showcase-sN.mp4`, from `Tools/Showcase/record.sh` and `encode.sh`), at 720p30
  H.264 and VP9.
- `media/reel.*`: 1.8 s from 4 s into each of the ten loops, in sector order.

The App Store link is a placeholder until the listing is live (`TODO(store-link)` in `index.html`).

Publisher host: Remnant Security Group LLC portfolio.

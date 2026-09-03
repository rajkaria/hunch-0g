# 0G Arena — landing page

Static landing site for **0G Arena**, served at [`0g.playhunch.xyz`](https://0g.playhunch.xyz).

No framework, no build step: hand-written HTML/CSS/JS with self-hosted fonts
(Space Grotesk, Inter, JetBrains Mono — latin subsets via Fontsource, MIT/OFL licensed).

```
index.html    the page
styles.css    all styling (dark theme, responsive, reduced-motion aware)
script.js     nav state, scroll reveals, terminal playback, ticker, copy button
assets/       Hunch + 0G Arena marks and lockups (see assets/README.md)
og.png        1200×630 social share card — built from assets/og-card.svg
favicon.svg   0G Arena tile, small master
vercel.json   static-deploy config: clean URLs, cache + security headers
fonts/        woff2 subsets
```

## Branding

The page runs Hunch identity v1.0 (see `assets/README.md`, masters from
[playhunch.xyz/brand](https://www.playhunch.xyz/brand)). One mark — the gate —
in two accents: **lime is Hunch, violet is the 0G venue**, exactly as Cup and
Bazaar recolour the same tile. Anything lime on the page means Hunch: the mark
beside the Arena wordmark in the nav, the lockup heading the operator band, the
footer signature, and the two CTAs that hand you over to `playhunch.xyz`.

Flat fills only, hard corners, no glow on the artwork — the identity retired
those in v1.0. `og.png`, `favicon-32.png` and `apple-touch-icon.png` are
rasterised from `assets/og-card.svg`, `favicon.svg` and `assets/arena-tile.svg`.

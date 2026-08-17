# 0G Arena — landing page

Static landing site for **0G Arena**, served at [`0g.playhunch.xyz`](https://0g.playhunch.xyz).

No framework, no build step: hand-written HTML/CSS/JS with self-hosted fonts
(Space Grotesk, Inter, JetBrains Mono — latin subsets via Fontsource, MIT/OFL licensed).

```
index.html    the page
styles.css    all styling (dark theme, responsive, reduced-motion aware)
script.js     nav state, scroll reveals, terminal playback, ticker, copy button
og.png        1200×630 social share card
favicon.svg   arena mark
vercel.json   static-deploy config: clean URLs, cache + security headers
fonts/        woff2 subsets
```

## Local preview

Any static server works:

```bash
npx serve web        # or: python3 -m http.server -d web 4173
```

## Deploy

The site deploys to Vercel as its own project, straight from this repo:

1. [vercel.com/new](https://vercel.com/new) → **Import** `rajkaria/hunch-0g`.
2. Set **Root Directory** to `web`, **Framework Preset** to "Other", leave the
   build command empty (the `vercel.json` here handles clean URLs and headers).
3. Deploy. Every push to the production branch redeploys automatically.

To point `0g.playhunch.xyz` at it:

1. In the Vercel project → **Settings → Domains**, add `0g.playhunch.xyz`.
2. In the DNS zone for `playhunch.xyz`, add the `CNAME` record Vercel shows
   (typically `0g` → `cname.vercel-dns.com`); if the zone already runs on
   Vercel DNS, the record is added for you.

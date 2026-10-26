# acfc-aachen.github.io
Official website of Aachen Chinese Finance Club

## Development

Node.js 22.12+ is required. Run `npm ci`, then `npm run dev`. Run `npm run build` for the static site in `dist/`.

## Deployment

In repository Settings → Pages, set Source to **GitHub Actions**. Pushes to `main` build and deploy automatically. No external hosting account or secrets are needed. The site is https://acfc-aachen.github.io/ and the English version is https://acfc-aachen.github.io/en/.

## Content

Both homepage languages are maintained in `src/components/Home.astro`; shared styles are in `src/styles/global.css`. The bilingual Market Watch dashboard is maintained in `src/components/MarketWatch.astro` and is published at `/market-watch/` and `/en/market-watch/`. It contains no illustrative market values: CNN's Fear & Greed reading and Eurostat's euro-area real GDP growth and HICP inflation observations are refreshed during the scheduled daily GitHub Pages build by `scripts/update-market-data.mjs`. If a source refresh fails, its last successful reading remains visible and is marked stale. CNN's data endpoint is not a formally documented public API; Eurostat data comes from its public Statistics API without credentials. There are no fabricated events, registration links, contact addresses or club photographs. Add confirmed information to both language dictionaries before opening registration or joining.

Legal pages: `/impressum/`, `/datenschutz/`, `/bildnachweise/` (German, with brief Chinese introductions where applicable). Owner-supplied public contact: Yu Li, Pontwall 3, 52062 Aachen, Deutschland; aachen_acfc@126.com. ACFC is not registered as e.V. Pending owner input: confirmed event programme, dates and venues. No analytics, third-party fonts or data collection forms are included. The approved earlier interactive demo was not available in the retrieved conversation, so this implementation follows the owner's written design brief.

## Photograph

`public/aachen.jpg` and its optimized `public/aachen.webp` derivative: Daniel von Appen, “Aachen, Germany”, 2017-05-01. Source: https://commons.wikimedia.org/wiki/File:Aachen,_Germany_(Unsplash).jpg (original Unsplash photo W_eHhfC8GUY). Wikimedia Commons records this pre-5 June 2017 photograph as **CC0 1.0**. The website displays a color crop with light brightness and saturation adjustments. Architecture is city photography, not club photography.


Privacy follow-up: the statements describe the present static site and do not certify legal compliance. Confirm the hosting contractual roles, applicable transfer safeguards, and retention arrangements. The 126 Mail account involves NetEase and potential processing in China; confirm an appropriate transfer basis and provider arrangements or migrate to a suitable EEA mailbox. No unverified SCC, DPA or other safeguards are claimed for this mailbox.


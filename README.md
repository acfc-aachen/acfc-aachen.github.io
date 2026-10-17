# acfc-aachen.github.io
Official website of Aachen Chinese Finance Club

## Development

Node.js 22.12+ is required. Run `npm ci`, then `npm run dev`. Run `npm run build` for the static site in `dist/`.

## Deployment

In repository Settings → Pages, set Source to **GitHub Actions**. Pushes to `main` build and deploy automatically. No external hosting account or secrets are needed. The site is https://acfc-aachen.github.io/ and the English version is https://acfc-aachen.github.io/en/.

## Content

Both languages are maintained in `src/components/Home.astro`; shared styles are in `src/styles/global.css`. There are no fabricated events, registration links, contact addresses or club photographs. Add confirmed information to both language dictionaries before opening registration or joining.

Pending owner input: official contact/joining channel; confirmed event programme, dates and venues; legal operator information and any required privacy notice. No analytics, third-party fonts or data collection forms are included. The approved earlier interactive demo was not available in the retrieved conversation, so this implementation follows the owner's written design brief.

## Photograph

`public/aachen.jpg` and its optimized `public/aachen.webp` derivative: Daniel von Appen, “Aachen, Germany”, 2017-05-01. Source: https://commons.wikimedia.org/wiki/File:Aachen,_Germany_(Unsplash).jpg (original Unsplash photo W_eHhfC8GUY). Wikimedia Commons records this pre-5 June 2017 photograph as **CC0 1.0**. The website displays a grayscale crop. Architecture is city photography, not club photography.

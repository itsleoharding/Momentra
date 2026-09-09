# Momentra — Maintenance Page

Temporary holding page. `index.html` serves a full-bleed maintenance image,
picked by viewport orientation via a `<picture>` element:

| Viewport | Image served | Size |
| --- | --- | --- |
| Portrait (phones upright, tablets in portrait) | `mobile.png` | 1080x1920 |
| Landscape (desktop, laptops, landscape tablets) | `desktop.png` | 1920x1080 |

Only the matching image is downloaded — the browser never fetches both.

## Serving it

Any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages) can serve
`index.html` and the two PNGs directly, with no build step.

`server.js` is a zero-dependency Node server for platforms that expect a
process, such as the existing Railway deployment. It responds `503` with a
`Retry-After` header on the page so search engines treat the outage as
temporary, and keeps `/health` returning `200` so the platform health check
stays green.

    npm start

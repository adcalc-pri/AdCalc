# AdCalc

Ad Budget & Unit Economics Simulator — a zero-server, offline-first profit
calculator for DTC / dropshipping store owners. Input product + ad numbers,
see profit, ROAS, CAC, breakeven, and 6 scaling scenarios in real time. Your
numbers never leave the browser.

## Run it

ES modules need to be served over HTTP (not `file://`):

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed URL.

## Try Pro

Free tier = product inputs + live results. Click **Unlock Pro** →
**Activate 7-day demo** to unlock the scenario table, sensitivity sliders,
IndexedDB save/recall, and CSV/JSON export with a locally-signed demo token.

## Going to production

1. Rotate `SECRET` in `js/gate.js`.
2. Mint the `plan: "pro"` HS256 JWT in your Lemon Squeezy purchase webhook.
3. Set the real checkout URL (`buyLink`) in `js/app.js`.
4. Deploy the folder to any static host (GitHub Pages, Netlify, S3).

See `CLAUDE.md` for architecture, the math engine, and editing rules.

## Stack

Static HTML/CSS/vanilla ES modules · IndexedDB · client-side JWT gate ·
no dependencies, no build step, no backend.

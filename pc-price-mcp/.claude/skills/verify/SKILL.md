# Verify skill — PC Price Checker (pc-price-mcp)

## Surface
Browser app served by Express on port 3000. All changes end at this GUI.

## Launch

```bash
# Backend (serves public/ and /api/*)
cd /home/user/gregbtm/pc-price-mcp
npm run dev:web &   # listens on :3000

# Frontend dev (only needed when iterating on frontend/ source)
cd /home/user/gregbtm/pc-price-mcp/frontend
npm run dev        # Vite HMR on :5173, /api proxied to :3000

# Frontend build (bake changes into public/ for Express to serve)
cd /home/user/gregbtm/pc-price-mcp/frontend
npm run build      # outputs to ../public/
```

## Drive with Playwright

```js
// /tmp/verify.mjs — ESM, run with: node /tmp/verify.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();

// Desktop
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/verify-desktop.png' });

// Mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/verify-mobile.png' });

await browser.close();
```

## Key flows to drive

- **Tab navigation** — click each sidebar nav item, confirm `x-show` content renders
- **Hamburger / drawer** — click `label[for="app-drawer"]` on mobile, confirm sidebar overlays
- **Dock** — confirm 4 buttons + "More" label visible on 390px viewport
- **Stat cards** — confirm 2×2 grid on mobile, 4-col on lg
- **Add component modal** — click "+ Add Component", fill name + query, submit
- **API round-trip** — POST then reload, confirm component appears in watchlist
- **No CDN** — listen to `page.on('request')`, assert zero requests to `cdn.` or `jsdelivr`

## Gotchas

- `window.Alpine` must be defined after load (check with `page.evaluate`); `window.Chart` and `window.app` are **not** globals — Chart.js is a named import used only inside `app.js`, and Alpine state lives behind `Alpine.$data(document.querySelector('[x-data]'))`
- `statsCards: 31` from `.grid.grid-cols-2` is expected — other grids exist on the page; use a more specific selector for stat cards specifically
- Backend needs `data/` directory with SQLite DB; first run creates it automatically
- Port 3000 must be free before starting backend

# UK PC Price MCP — Deployment Guide

---

## Part 1 — API Keys

All APIs are optional. The tool works without any of them but gets more useful as you add more sources.

---

### PricesAPI.io `PRICES_API_KEY` ← **Start here**
- **What it does:** Searches 40+ UK retailers including Scan, Ebuyer, Amazon UK, CCL, etc.
- **Cost:** Free — 50,000 calls/month
- **Sign up:** https://pricesapi.io (no credit card)
- **Get key:** Dashboard → API Keys → Create Key
- **Time to get:** Instant

---

### eBay Browse API `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` ← **Recommended next**
- **What it does:** Live eBay UK listings — new, used, and refurbished parts
- **Cost:** Free — 5,000 calls/day
- **Sign up:** https://developer.ebay.com → "Get Started" → Create account
- **Get keys:**
  1. developer.ebay.com → My Account → Application Keysets
  2. Click "Create App"
  3. Switch to **Production** tab (not Sandbox)
  4. **AppID** = `EBAY_CLIENT_ID`
  5. **CertID** = `EBAY_CLIENT_SECRET`
- **Time to get:** Instant (no review required)

---

### Keepa `KEEPA_API_KEY`
- **What it does:** Amazon UK price history — all-time lows, 30/90/180-day averages
- **Cost:** Free — 100 tokens/minute (most queries use 1–2 tokens)
- **Sign up:** https://keepa.com/#!api → Register
- **Get key:** keepa.com/#!api → scroll to "Your API Key"
- **Time to get:** Instant

---

### AWIN `AWIN_PUBLISHER_ID` + `AWIN_API_KEY`
- **What it does:** UK retailer product search — Scan, Overclockers, Ebuyer, CCL, Currys, Novatech, 300+ others
- **Cost:** Free with publisher account
- **Sign up:** https://www.awin.com/gb/publishers
- **Get keys:** awin.com → Profile → API Credentials
- **Time to get:** ~1 week (manual approval)
- **Note:** After approval, join programmes for the retailers you want (Scan, Overclockers, etc.)

---

### Amazon PAAPI `AMAZON_ACCESS_KEY` + `AMAZON_SECRET_KEY` + `AMAZON_ASSOCIATE_TAG`
- **What it does:** Official Amazon UK API — live prices, Prime status, product images
- **Cost:** Free with Amazon Associates
- **Sign up:** https://affiliate-program.amazon.co.uk/
- **Get keys:** associates.amazon.co.uk → Tools → Product Advertising API → Manage Credentials
- **Time to get:** Instant, but account needs a sale within 90 days to stay active
- **Note:** Amazon deactivates accounts with no referral sales in 90 days

---

### How to provide keys — summary table

| Where you run it | How to set keys |
|---|---|
| Local Node.js | Copy `.env.example` → `.env`, fill in values |
| Local MCP | `env` block in `claude_desktop_config.json` |
| NAS bare Node.js | `.env` file next to the app, or `systemd` unit `Environment=` lines |
| Docker Compose | Copy `.env.example` → `.env` in the `pc-price-mcp/` folder |
| Portainer Stack | "Environment variables" panel before deploying the stack |
| Render.com | Dashboard → Environment → Add env vars |
| Railway | Dashboard → Variables tab |
| Fly.io | `fly secrets set KEY=value ...` |
| npm global install | `.env` file in your working directory, or shell exports |

---

## Part 2 — Installation Options

---

### Option 1 — Local MCP (Claude Desktop / Claude Code)

Use this to give Claude direct tool access to price data in chat.

**Setup:**

1. Clone the repo and build:
   ```bash
   git clone https://github.com/gregbtm/gregbtm.git
   cd gregbtm/pc-price-mcp
   npm install
   npm run build
   ```

2. Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):
   ```json
   {
     "mcpServers": {
       "pc-prices": {
         "command": "node",
         "args": ["/absolute/path/to/pc-price-mcp/dist/index.js"],
         "env": {
           "PRICES_API_KEY": "your_key_here",
           "EBAY_CLIENT_ID": "your_app_id",
           "EBAY_CLIENT_SECRET": "your_cert_id",
           "KEEPA_API_KEY": "optional",
           "DB_PATH": "/Users/you/pc-prices.db"
         }
       }
     }
   }
   ```

3. Restart Claude Desktop. You should see the PC price tools in the tools panel.

**MCP-only mode (no web dashboard):**  
Set `WEB_PORT=0` in env to disable the Express server — useful when you only want the MCP stdio transport.

---

### Option 2 — Local Node.js (web dashboard on your machine)

1. Clone and build:
   ```bash
   git clone https://github.com/gregbtm/gregbtm.git
   cd gregbtm/pc-price-mcp
   cp .env.example .env
   # Edit .env and fill in your keys
   npm install
   npm run build
   ```

2. Run:
   ```bash
   npm run web        # web dashboard on http://localhost:3000
   # or
   npm start          # MCP stdio mode (pipe to an LLM client)
   ```

3. Open http://localhost:3000

**Development mode** (no build step, hot-reload via tsx):
```bash
npm run dev:web    # web dashboard with live TypeScript execution
npm run dev        # MCP stdio mode
```

---

### Option 3 — NAS, bare Node.js (no Docker)

Works on Synology, QNAP, or any Linux NAS with Node.js 18+.

**Check Node.js version first:**
```bash
node --version    # needs v18 or higher
```

**Install:**
```bash
git clone https://github.com/gregbtm/gregbtm.git
cd gregbtm/pc-price-mcp
cp .env.example .env
# Fill in .env with your API keys and set:
# DB_PATH=/volume1/docker/pc-price-mcp/pc-prices.db   (Synology example)
npm install
npm run build
```

**Run persistently with pm2:**
```bash
npm install -g pm2
pm2 start dist/web-standalone.js --name pc-price-mcp
pm2 save                   # survive reboots
pm2 startup                # auto-start on boot (follow the printed command)
```

**Synology Task Scheduler alternative:**
- Control Panel → Task Scheduler → Create → Triggered Task → User-defined script
- Run at boot, user = your admin user
- Script: `cd /volume1/git/gregbtm/pc-price-mcp && node dist/web-standalone.js`

---

### Option 4 — NAS, Docker via Portainer

**Prerequisites:** Docker + Portainer installed on your NAS.

**Steps:**

1. In Portainer: **Stacks → Add stack → Git repository**
   - Repository URL: `https://github.com/gregbtm/gregbtm`
   - Branch: `claude/uk-pc-component-mcp-h39nb7` (or `main` after merge)
   - Compose path: `pc-price-mcp/stack.yml`

2. In the **Environment variables** panel, add:
   ```
   PRICES_API_KEY   = your_key
   EBAY_CLIENT_ID   = your_app_id
   EBAY_CLIENT_SECRET = your_cert_id
   KEEPA_API_KEY    = optional
   HOST_PORT        = 38574
   TZ               = Europe/London
   ```

3. Click **Deploy the stack**

4. Open `http://your-nas-ip:3000`

The included Watchtower service automatically pulls new images from GHCR whenever a push triggers a new build — so updates are hands-free.

**Bind-mount the SQLite database to a specific path** (optional):
In `stack.yml`, uncomment:
```yaml
driver_opts:
  type: none
  o: bind
  device: /volume1/docker/pc-price-mcp/data
```

---

### Option 5 — Standalone Docker Compose (no Portainer)

For any machine with Docker installed. Simpler than Portainer.

```bash
git clone https://github.com/gregbtm/gregbtm.git
cd gregbtm/pc-price-mcp
cp .env.example .env
# Fill in .env with your API keys
docker compose up -d
```

Open http://localhost:3000

**To build the image locally** instead of pulling from GHCR, edit `docker-compose.yml`:
```yaml
# Comment out:
# image: ghcr.io/gregbtm/pc-price-mcp:latest
# Uncomment:
build:
  context: .
  dockerfile: Dockerfile
```
Then run `docker compose up -d --build`.

**Common commands:**
```bash
docker compose logs -f          # tail logs
docker compose pull && docker compose up -d    # update to latest image
docker compose down             # stop
docker compose down -v          # stop and delete data volume (destructive!)
```

---

### Option 6 — Cloud: Render.com

Render's free tier includes 750 hours/month. The included `render.yaml` handles everything.

**First deploy:**
1. Create account at https://render.com
2. New → Blueprint → Connect your GitHub repo (`gregbtm/gregbtm`)
3. Render detects `render.yaml` automatically
4. In the dashboard, set **Environment** variables (keys marked `sync: false`):
   ```
   PRICES_API_KEY
   EBAY_CLIENT_ID
   EBAY_CLIENT_SECRET
   KEEPA_API_KEY          (optional)
   AWIN_PUBLISHER_ID      (optional)
   AWIN_API_KEY           (optional)
   AMAZON_ACCESS_KEY      (optional)
   AMAZON_SECRET_KEY      (optional)
   AMAZON_ASSOCIATE_TAG   (optional)
   ```
5. Click **Deploy**

**Subsequent deploys:** Push to the branch — Render auto-deploys.

**Persistent disk:** The `render.yaml` includes a 1 GB disk at `/var/data` ($0/month on hobby tier, $0.25/GB/month on paid). SQLite is stored at `/var/data/pc-prices.db`. Without this disk, price history is lost on every redeploy.

---

### Option 7 — Cloud: Railway

Railway offers $5/month in free credit.

**First deploy:**
1. Create account at https://railway.app
2. New Project → Deploy from GitHub → select `gregbtm/gregbtm`
3. In service settings → **Settings → Source**:
   - Root Directory: `pc-price-mcp`
4. Railway detects `railway.toml` and uses the Dockerfile
5. **Variables** tab → add all API keys
6. **Volumes** tab → Add Volume → mount at `/data`, then set `DB_PATH=/data/pc-prices.db` in Variables
7. Click Deploy

Railway injects `PORT` automatically — the app picks it up via `process.env.PORT`.

---

### Option 8 — Cloud: Fly.io

Fly.io has a generous free tier (3 shared VMs, 3 GB persistent storage).

**First deploy:**
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# From pc-price-mcp/ directory:
fly auth login
fly launch --no-deploy                # reads fly.toml, skips first deploy
fly secrets set \
  PRICES_API_KEY=xxx \
  EBAY_CLIENT_ID=xxx \
  EBAY_CLIENT_SECRET=xxx \
  KEEPA_API_KEY=xxx \
  AWIN_PUBLISHER_ID=xxx \
  AWIN_API_KEY=xxx \
  AMAZON_ACCESS_KEY=xxx \
  AMAZON_SECRET_KEY=xxx \
  AMAZON_ASSOCIATE_TAG=yourtag-21
fly volumes create pc_price_data --size 1 --region lhr
fly deploy
```

**Subsequent deploys:**
```bash
cd pc-price-mcp
fly deploy
```

The `fly.toml` configures:
- Region: `lhr` (London) — lowest latency to UK retailers
- Persistent 1 GB volume mounted at `/data`
- Auto-stop when idle (saves free tier quota)
- Health check on `/api/health`

---

### Option 9 — npm global install

Install once, use anywhere as a CLI command.

**Prerequisites:** Node.js 18+

```bash
npm install -g uk-pc-price-mcp
```

**Run MCP mode** (stdio, for wiring into Claude or any MCP client):
```bash
uk-pc-price-mcp
```

**Run web dashboard:**
```bash
uk-pc-price-mcp-web
# Opens dashboard on http://localhost:3000
```

**Pass API keys** via environment variables:
```bash
PRICES_API_KEY=xxx EBAY_CLIENT_ID=xxx uk-pc-price-mcp-web
```

Or create a `.env` file in the directory you run the command from:
```
PRICES_API_KEY=xxx
EBAY_CLIENT_ID=xxx
EBAY_CLIENT_SECRET=xxx
DB_PATH=./pc-prices.db
```

**Note:** The package is not yet published to npm. Once published, the above will work.  
To publish: `git tag v1.0.0 && git push --tags` — GitHub Actions handles the rest.

---

## Part 3 — Quick-start: what to get first

If you're starting from scratch, do these in order:

| Step | Time | Unlocks |
|------|------|---------|
| 1. Sign up for PricesAPI.io | 2 min | Search across 40+ UK retailers |
| 2. Sign up for eBay developer | 5 min | Live eBay UK listings (new + used) |
| 3. Sign up for Keepa | 2 min | Amazon UK price history |
| 4. Sign up for Amazon Associates | 10 min | Official Amazon live prices |
| 5. Apply for AWIN publisher | 10 min + 1 week wait | 300+ UK retailers via affiliate feeds |

Steps 1–3 are instant. You can have a fully working setup in under 10 minutes with those three.

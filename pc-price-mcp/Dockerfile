# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Set ENABLE_PLAYWRIGHT=true to include Chromium + playwright-core in the image.
# Default: false — keeps the image small (~250 MB vs ~450 MB).
ARG ENABLE_PLAYWRIGHT=false

# better-sqlite3 native bindings require build tools (musl/Alpine only)
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
# Install deps; ignore-scripts skips playwright browser downloads, then
# explicitly rebuild better-sqlite3 so its native .node binding is compiled
# using the build tools installed above.
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

ARG ENABLE_PLAYWRIGHT=false

WORKDIR /app

# Reuse the pre-compiled node_modules from builder (no build tools needed here)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY public/ ./public/
COPY package.json ./

# Optional: install system Chromium for Playwright-based scraping of JS-heavy
# retailers (Currys, AO, John Lewis, Very). Adds ~200 MB to the image.
# Enable with: docker build --build-arg ENABLE_PLAYWRIGHT=true
RUN if [ "$ENABLE_PLAYWRIGHT" = "true" ]; then \
      apk add --no-cache chromium && \
      ln -sf /usr/bin/chromium-browser /usr/bin/chromium; \
    fi

ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium-browser

# /data is the persistent volume mount point for SQLite
RUN mkdir -p /data
ENV DB_PATH=/data/pc-prices.db
ENV NODE_ENV=production

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/web-standalone.js"]

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# better-sqlite3 native bindings require build tools (musl/Alpine only)
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Reuse the pre-compiled node_modules from builder (no build tools needed here)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY public/ ./public/
COPY package.json ./

# /data is the persistent volume mount point for SQLite
RUN mkdir -p /data
ENV DB_PATH=/data/pc-prices.db
ENV NODE_ENV=production

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/web-standalone.js"]

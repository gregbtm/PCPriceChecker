# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# better-sqlite3 needs Python + make for native bindings on alpine
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY public/ ./public/

# /data is the mount point for the persistent SQLite volume
RUN mkdir -p /data
ENV DB_PATH=/data/pc-prices.db
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "dist/web-standalone.js"]

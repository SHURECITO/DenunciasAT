## ── Stage 1: dependencias ──────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

## ── Stage 2: compilación ───────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json nest-cli.json tsconfig.json ./
COPY apps/dashboard-api ./apps/dashboard-api
COPY libs ./libs
RUN npm run build

## ── Stage 3: producción ────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

RUN apk add --no-cache curl

# Solo dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/apps/dashboard-api/src/main"]

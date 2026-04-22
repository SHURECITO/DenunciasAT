# ── Stage 1: deps ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: build ────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx nest build notification-service

# ── Stage 3: production ───────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache curl

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN chown -R node:node /app

USER node

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3005/health || exit 1

CMD ["node", "dist/apps/notification-service/src/main"]

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
RUN npx nest build chatbot-service

# ── Stage 3: production ───────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
# Se copia el dist completo para preservar las rutas relativas hacia libs/ai compilado
COPY --from=build /app/dist ./dist
COPY infrastructure/config/dependencias.json ./infrastructure/config/dependencias.json
RUN chown -R node:node /app

USER node

CMD ["node", "dist/apps/chatbot-service/src/main"]

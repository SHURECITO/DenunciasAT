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
RUN npx nest build document-service

# ── Stage 3: production ───────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
# Copiar dist completo para preservar rutas de libs/ai compilado
COPY --from=build /app/dist ./dist
# Directorio de documentos generados (montado como volumen en producción)
RUN mkdir -p /app/infrastructure/documentos
CMD ["node", "dist/apps/document-service/src/main"]

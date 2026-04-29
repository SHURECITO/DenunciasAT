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

RUN apk add --no-cache curl

COPY --from=deps /app/node_modules ./node_modules
# Copiar dist completo para preservar rutas de libs/ai compilado
COPY --from=build /app/dist ./dist
# Plantilla base del documento y mapa de dependencias
COPY infrastructure/templates/Plantilla.docx ./infrastructure/templates/Plantilla.docx
COPY infrastructure/config/dependencias.json ./infrastructure/config/dependencias.json
COPY infrastructure/config/dependencias.vector.db.json ./infrastructure/config/dependencias.vector.db.json
COPY infrastructure/config/normativa.juridica.json ./infrastructure/config/normativa.juridica.json
# Directorio de documentos generados (montado como volumen en producción)
RUN mkdir -p /app/infrastructure/documentos
RUN chown -R node:node /app

USER node

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3004/health || exit 1

CMD ["node", "dist/apps/document-service/src/main"]

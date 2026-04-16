# CLAUDE.md

## Instrucciones para Claude Code
- Leer archivos antes de modificar. No reescribir si se puede editar.
- Código en inglés, comentarios y commits en español.
- No añadir features fuera del alcance pedido.
- Actualizar este archivo al final de cada sesión (sección Historial).
- Mantener este archivo bajo 200 líneas. Comprimir historial si se supera.

---

## Qué es este proyecto

Sistema de gestión de denuncias ciudadanas para el concejal Andrés Tobón (Medellín). Ciudadanos denuncian por WhatsApp (chatbot IA con máquina de estados), el equipo gestiona desde un dashboard web y se genera un .docx oficial que el abogado radica en el Concejo.

**Volumen real:** ~6–80 denuncias/día. No es un sistema de alto tráfico.

## Stack

| Capa | Tecnología |
|------|-----------|
| Monorepo | NestJS 11 workspace |
| Backend | NestJS 11, TypeORM, PostgreSQL 16 |
| Frontend | Next.js 14, Tailwind CSS |
| WhatsApp | Evolution API v2.2.3 |
| IA | Google Gemini gemini-2.0-flash-lite |
| Estado conversacional | Redis (TTL 24h) |
| Archivos | MinIO |
| Infra | Docker Compose → Kubernetes (futuro) |

## Servicios activos (puertos internos Docker)

| Servicio | Puerto interno | Estado |
|----------|---------------|--------|
| dashboard-api | 3000 | ✅ |
| frontend | 3001 | ✅ |
| chatbot-service | 3002 | ✅ |
| whatsapp-service | 3003 | ✅ |
| evolution-api | 8080 | ✅ |
| redis | 6379 | ✅ |
| postgres | 5432 | ✅ |
| document-service | 3004 | 🔜 |
| notification-service | 3005 | 🔜 |
| rag-service | 3006 | 🔜 |

**Puertos expuestos al host (no estándar):** API `8741`, Frontend `8742`.

## Estado del proyecto

- [x] Fase 1 — Scaffold monorepo
- [x] Fase 2 — dashboard-api (auth, denuncias, Swagger)
- [x] Fase 3 — Frontend Next.js
- [x] Fase 4 — Docker Compose
- [x] Fase 5 — DockerHub + README
- [x] Fase 6 — Dashboard completo (detalle, chat, form manual, especiales)
- [x] Fase 7B — Gestión de usuarios
- [x] Fase 7C — Estadísticas y exportación
- [x] Fase 8 — Hardening de seguridad (auditoría)
- [x] Fase 9 — Entrega 3: whatsapp-service + chatbot-service + Evolution API
- [ ] Entrega 4 — document-service + notification-service + rag-service
- [ ] Entrega final — Kubernetes

## Entidades TypeORM

### Denuncia
```
id, radicado (UNIQUE, SEQUENCE DAT-000001), nombreCiudadano, cedula, telefono,
ubicacion, descripcion, estado (enum), dependenciaAsignada (indexed),
esEspecial, origenManual, documentoRevisado, documentoUrl, documentoGeneradoOk,
documentoGeneradoEn, fechaCreacion, fechaActualizacion
```
- `estado` y `dependenciaAsignada` tienen `@Index()`
- `documentoUrl/Ok/En` preparados para document-service (Entrega 4)
- `documentoPendiente`: true cuando chatbot crea denuncia (doc aún no generado por document-service)
- `incompleta`: true cuando ciudadano abandona flujo con nombre+teléfono ya dados

### Mensaje
```
id, denunciaId (FK CASCADE DELETE), contenido (text), tipo (enum), direccion (enum), timestamp
```

### Usuario
```
id, nombre, email (UNIQUE), passwordHash (select:false), activo, fechaCreacion
```

## Reglas de negocio críticas

1. Radicado generado con SEQUENCE PostgreSQL — nunca lógica manual
2. Estados solo avanzan: RECIBIDA→EN_GESTION→RADICADA→CON_RESPUESTA
3. No se puede pasar a RADICADA sin `documentoRevisado: true`
4. `esEspecial=true`: no genera .docx ni pasa por estados normales
5. El chat completo se persiste en tabla `mensajes`
6. `POST /denuncias` acepta JWT (dashboard) O internal-key (chatbot) — `EitherAuthGuard`

## Seguridad implementada (Fase 8 — no tocar sin justificación)

- **Helmet** + **CORS** restringido a `FRONTEND_URL` en `main.ts`
- **Rate limiting** global (`@nestjs/throttler`): 5 req/s, 200/min. Login: 10/min, 20 en 5 min.
- **JWT_SECRET**: startup falla si < 32 chars o es el valor de ejemplo
- **`/auth/seed`**: bloqueado si `SEED_ENABLED !== 'true'`
- **`DB_SYNC`**: variable propia, independiente de `NODE_ENV`. Nunca `true` en prod con datos reales.
- **Passwords en .env.example**: todos marcados con `!!!CAMBIAR!!!`, sin valores por defecto inseguros
- **Interceptor de logging**: todas las requests logueadas con método, URL, status, ms, IP
- **Health check real**: `GET /health` verifica `SELECT 1` contra Postgres, retorna `uptime`

## Variables de entorno clave

| Variable | Propósito | Valor dev |
|----------|-----------|-----------|
| `DB_SYNC` | Sincroniza schema TypeORM | `true` (dev), `false` (prod) |
| `SEED_ENABLED` | Habilita POST /auth/seed | `true` (solo primer deploy) |
| `JWT_SECRET` | Firma JWT (min 32 chars) | Generar con crypto.randomBytes(48) |
| `FRONTEND_URL` | Origen permitido CORS | `http://localhost:8742` |
| `API_PORT` | Puerto host expuesto API | `8741` |
| `FRONTEND_PORT` | Puerto host expuesto frontend | `8742` |
| `DASHBOARD_API_INTERNAL_KEY` | Auth interna chatbot→API | String random |
| `GEMINI_API_KEY` | API Key Google Gemini (clasificación) | Obtener en AI Studio |

## Patrones y decisiones técnicas establecidas

- **Login cookie**: httpOnly `token` seteada por Route Handler Next.js `/api/auth/login`, nunca expuesta a JS
- **Client components**: usar `import type` para tipos de `lib/api.ts` — evita bundling de `next/headers`
- **Filtrado denuncias**: via `?estado=X` en URL (server-side, sin React Query)
- **`passwordHash`**: `select: false` en entidad — siempre re-fetchear tras save en usuarios
- **EitherAuthGuard**: JWT OR `x-internal-key` header para endpoints que usan tanto dashboard como chatbot
- **Chatbot**: máquina de estados en Redis (INICIO→ESPERANDO_NOMBRE→ESPERANDO_CEDULA→ESPERANDO_UBICACION→ESPERANDO_DESCRIPCION→ESPERANDO_EVIDENCIA→ESPERANDO_CONFIRMACION→FINALIZADO)
- **GeminiService** (`libs/ai/src/gemini.service.ts`): servicio compartido con `clasificarDenuncia()` y `generarJustificacionLegal()`. Modelos pre-inicializados con systemInstruction de normativa colombiana. `generarJustificacionLegal()` será usado por document-service en Entrega 4.
- **chatbot-service Dockerfile**: copia `dist/` completo (no solo `dist/apps/chatbot-service`) para preservar rutas relativas a `libs/ai` compilado.
- **QR WhatsApp**: Evolution API envía QR via webhook `qrcode.updated` → whatsapp-service guarda en Redis `evolution:qr` (TTL 90s) → dashboard-api lo lee llamando a `GET /qr` del whatsapp-service (no polling directo a Evolution API)
- **Vistas materializadas**: `stats_por_estado`, `stats_por_dependencia` — refresh en cada call de estadísticas
- **docker-compose**: `restart: unless-stopped` + límites de memoria en todos los servicios

## Infraestructura operacional

- `infrastructure/scripts/backup.sh` — pg_dump diario, retención 30 días, alerta Telegram
- `infrastructure/scripts/healthcheck.sh` — ping /health cada 5 min, alerta Telegram si cae
- `/etc/docker/daemon.json` → log rotation 10MB × 3 archivos (ver `infrastructure/docker/daemon.json`)

## Links

- Repo: https://github.com/SHURECITO/DenunciasAT
- DockerHub API: `shurecito/denunciasat-api`
- DockerHub Frontend: `shurecito/denunciasat-frontend`

---

## Historial de sesiones (resumen comprimido)

**Sesiones 1–9 (2026-04-14/15):** Scaffold NestJS monorepo, dashboard-api (auth JWT, CRUD denuncias con SEQUENCE, usuarios), frontend Next.js, Docker multi-stage, DockerHub, dashboard completo (detalle/chat/especiales/estadísticas), hardening seguridad (Helmet/CORS/throttler), whatsapp-service + chatbot-service + Evolution API, migración OpenAI→Gemini (gemini-2.0-flash-lite, normativa colombiana, systemInstruction compartida).

**Sesiones 10–12 (2026-04-15/16) — Fixes Evolution API:** (10) QR: EVOLUTION_API_KEY debe ser UUID, CONFIG_SESSION_PHONE_VERSION=2.3000.1035194821, webhook por instancia (not global). (11) @lid JID: parche Baileys en patch-lid.js, tests 21/21 OK. (12) 400 Bad Request: para @s.whatsapp.net strip suffix, para @lid pasar JID completo. EvolutionService con logging y retry 2s.

**CRITICAL — Evolution API key:** UUID válido obligatorio. Cambiar: `docker volume rm denunciasat_evolution_data` + restart. Parche @lid: automático al startup, verificar `[patch-lid] Parcheados N archivos` en logs.

**Evolution API v2 sendText:** `POST /message/sendText/{instance}` · body `{number, text}` · header `apikey:<UUID>`. number = solo dígitos para @s.whatsapp.net, JID completo para @lid.

**Sesión 13 (2026-04-16) — Fixes chatbot + Gemini + Evidencia + Parciales:**
- **Flujo:** Estados FINALIZADO/corrupto → reset a INICIO. Validación nombre (letras+espacios, min 3). Validación cédula (6–10 dígitos). Antitontos en cada paso. Saludos detectados en INICIO.
- **Gemini:** Clasificación por palabras clave como fallback cuando Gemini falla (incluye 429). Todo el `generateContent` envuelto en try/catch. Logging `Enviando a Gemini` + `Respuesta raw Gemini`.
- **Evidencia:** Nuevo paso `ESPERANDO_EVIDENCIA` entre DESCRIPCION y CONFIRMACION. Acepta imageMessage/documentMessage (guarda URLs en `estado.datos.imagenes[]`/`pdfs[]`). Resumen incluye `📎 X imagen(es) y X anexo(s)`.
- **Parciales:** `guardarParcial()` llamado tras recibir nombre; crea `POST /denuncias/incompleta` (endpoint nuevo, EitherAuthGuard). Estado Redis guarda `parcialId` para no duplicar.
- **documentoPendiente:** true en todas las denuncias creadas por el chatbot; badge amarillo ⏳ en frontend.
- **incompleta:** true en denuncias parciales; badge gris en listado y detalle. `findAll()` ordena incompletas al final.

---

> Al terminar cada sesión: marcar fases, comprimir historial si supera 200 líneas.

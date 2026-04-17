# CLAUDE.md

## Instrucciones para Claude Code
- Leer archivos antes de modificar. No reescribir si se puede editar.
- Código en inglés, comentarios y commits en español.
- No añadir features fuera del alcance pedido.
- Actualizar este archivo al final de cada sesión (sección Historial).
- Mantener este archivo bajo 200 líneas. Comprimir historial si se supera.

---

## Qué es este proyecto

Sistema de gestión de denuncias ciudadanas para el concejal Andrés Tobón (Medellín). Ciudadanos denuncian por WhatsApp (chatbot IA conversacional), el equipo gestiona desde un dashboard web y se genera un .docx oficial que el abogado radica en el Concejo.

**Volumen real:** ~6–80 denuncias/día. No es un sistema de alto tráfico.

## Stack

| Capa | Tecnología |
|------|-----------|
| Monorepo | NestJS 11 workspace |
| Backend | NestJS 11, TypeORM, PostgreSQL 16 |
| Frontend | Next.js 14, Tailwind CSS |
| WhatsApp | Evolution API v2.2.3 |
| IA | Google Gemini **gemini-2.0-flash** (temperature 0.3) |
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

- [x] Fase 1–9 — Scaffold, dashboard-api, frontend, Docker, seguridad, whatsapp/chatbot/Evolution API
- [x] Sesión 14 — Chatbot IA conversacional (Gemini guía el flujo, sin máquina de estados rígida)
- [ ] Entrega 4 — document-service + notification-service + rag-service
- [ ] Entrega final — Kubernetes

## Entidades TypeORM

### Denuncia
```
id, radicado (UNIQUE, SEQUENCE DAT-000001), nombreCiudadano, cedula (nullable), telefono,
ubicacion, barrio (nullable), comuna (nullable), descripcion,
descripcionResumen (nullable, text — generado por Gemini),
estado (enum), dependenciaAsignada (indexed), esEspecial, esAnonimo,
origenManual, documentoRevisado, documentoUrl, documentoGeneradoOk,
documentoGeneradoEn, documentoPendiente, incompleta, fechaCreacion, fechaActualizacion
```
- `cedula`: string vacía para parciales, 'ANONIMO' para denuncias anónimas
- `esAnonimo`: true cuando ciudadano escribe 'anonimo' como nombre
- `barrio`/`comuna`: capturados por chatbot IA, opcionales para manual
- `descripcionResumen`: resumen generado por Gemini al radicar

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
5. `POST /denuncias` acepta JWT (dashboard) O internal-key (chatbot) — `EitherAuthGuard`
6. `POST /denuncias/parcial`: upsert por telefono+incompleta — no duplica si ya existe

## Arquitectura del chatbot IA (Sesión 14)

**Estado Redis (`chatbot:conv:{numero}`, TTL 24h):**
```typescript
{
  historial: [{ rol: 'user'|'assistant', contenido, timestamp }],
  datosConfirmados: {
    nombre?, esAnonimo?, cedula?, telefono, barrio?, comuna?,
    direccion?, direccionConfirmada?, descripcion?, descripcionResumen?,
    dependencia?, esEspecial?, imagenes?, pdfs?,
    etapa: 'recopilando'|'confirmando'|'finalizado'|'especial_cerrado'
  },
  intentosFallidos, ultimoMensaje?, contadorRepeticiones?, parcialId?
}
```

**Flujo:** `ChatbotService.procesarMensaje()` → pasa historial + datosConfirmados + mensaje a `GeminiService.procesarMensajeChatbot()` → Gemini extrae datos, valida, responde en JSON `{ respuesta, datosExtraidos, etapaSiguiente, listaParaRadicar }` → chatbot mergea datos, actualiza etapa, guarda en Redis.

**Casos especiales:**
- `reiniciar` (texto exacto) → limpia Redis y saluda de nuevo
- `audioMessage` → responde pidiendo que escriba (no tenemos bytes para transcribir)
- `imageMessage`/`documentMessage` → agrega URL a `imagenes[]`/`pdfs[]`
- `listaParaRadicar: true` → genera resumen con Gemini, llama `POST /denuncias`, retorna radicado
- `etapaSiguiente: 'especial_cerrado'` → crea denuncia con `esEspecial: true`, no llama document-service
- 3 mensajes idénticos repetidos sin avance → incrementa `intentosFallidos` → si ≥3 sugiere reiniciar

**GeminiService métodos:**
- `procesarMensajeChatbot()` — flujo conversacional con systemInstruction SYSTEM_PROMPT_CHATBOT
- `clasificarDenuncia()` — clasificación + fallback por palabras clave
- `generarResumen()` — resumen 2 oraciones para dashboard
- `generarHechos()` — sección HECHOS para document-service (Entrega 4)
- `generarJustificacionLegal()` — usado por document-service (Entrega 4)

## Seguridad implementada (Fase 8 — no tocar sin justificación)

- **Helmet** + **CORS** restringido a `FRONTEND_URL` en `main.ts`
- **Rate limiting** global: 5 req/s, 200/min. Login: 10/min, 20 en 5 min.
- **JWT_SECRET**: startup falla si < 32 chars
- **`/auth/seed`**: bloqueado si `SEED_ENABLED !== 'true'`
- **`DB_SYNC`**: variable propia, nunca `true` en prod con datos reales

## Variables de entorno clave

| Variable | Propósito | Valor dev |
|----------|-----------|-----------|
| `DB_SYNC` | Sincroniza schema TypeORM | `true` (dev), `false` (prod) |
| `JWT_SECRET` | Firma JWT (min 32 chars) | crypto.randomBytes(48) |
| `FRONTEND_URL` | Origen CORS | `http://localhost:8742` |
| `DASHBOARD_API_INTERNAL_KEY` | Auth interna chatbot→API | String random |
| `GEMINI_API_KEY` | API Key Google Gemini | Obtener en AI Studio |

## Patrones técnicos establecidos

- **Login cookie**: httpOnly `token` via Route Handler Next.js, nunca en JS
- **EitherAuthGuard**: JWT OR `x-internal-key` para endpoints duales
- **`passwordHash`**: `select: false` — re-fetchear tras save en usuarios
- **QR WhatsApp**: `qrcode.updated` → Redis `evolution:qr` (TTL 90s) → `GET /qr`
- **Vistas materializadas**: `stats_por_estado`, `stats_por_dependencia` — refresh en cada call
- **chatbot-service Dockerfile**: copia `dist/` completo para preservar rutas de `libs/ai`
- **Evolution API key**: UUID válido obligatorio. Reset: `docker volume rm denunciasat_evolution_data`
- **Parche @lid**: automático al startup en whatsapp-service

## Infraestructura operacional

- `infrastructure/scripts/backup.sh` — pg_dump diario, retención 30 días, alerta Telegram
- `infrastructure/scripts/healthcheck.sh` — ping /health cada 5 min, alerta Telegram si cae

## Links

- Repo: https://github.com/SHURECITO/DenunciasAT

---

## Historial de sesiones (comprimido)

**Sesiones 1–9 (2026-04-14/15):** Scaffold NestJS monorepo, dashboard-api (auth JWT, CRUD, SEQUENCE), frontend Next.js, Docker multi-stage, DockerHub, dashboard completo, hardening seguridad, whatsapp-service + chatbot-service + Evolution API, Gemini (normativa colombiana, systemInstruction).

**Sesiones 10–12 (2026-04-15/16) — Fixes Evolution API:** UUID obligatorio, CONFIG_SESSION_PHONE_VERSION, webhook por instancia, parche @lid Baileys, 400 Bad Request (@s.whatsapp.net strip suffix, @lid JID completo).

**Sesión 13 (2026-04-16) — Fixes chatbot FSM:** Estados FINALIZADO/corrupto→reset, validaciones nombre/cédula, paso ESPERANDO_EVIDENCIA, guardarParcial(), documentoPendiente, badge incompleta en frontend.

**Sesión 14 (2026-04-16) — Chatbot IA conversacional:** Reemplazada FSM rígida por Gemini conversacional. Modelo → `gemini-2.5-flash-lite` (fallback `gemini-3.1-flash-lite-preview` en 429). Nuevo estado Redis con `historial[]` + `datosConfirmados`. `POST /denuncias/parcial` (upsert). Campos nuevos en Denuncia: `barrio`, `comuna`, `descripcionResumen`, `esAnonimo`. `generarResumen()` y `generarHechos()` en GeminiService.

**Sesión 15 (2026-04-17) — Fixes críticos chatbot:**
- **BUG 1 esAnonimo:** `esAnonimo === true` solo cuando Gemini lo setea explícitamente (usuario escribió literalmente "anonimo"). Capitalización del nombre con `capitalizarNombre()` en chatbot y `capitalizar()` en denuncias.service.
- **BUG 2 429 historial:** `@SkipThrottle({ burst: true, sustained: true })` en `POST /mensajes/:id`. `Promise.allSettled` para guardar historial en paralelo sin bloquear.
- **BUG 3 teléfono largo:** `remoteJid.split('@')[0].replace(/\D/g, '')` en webhook.controller.ts — limpia JIDs tipo `@lid`.
- **BUG 4 merge datos:** Deep merge con deduplicación de arrays. Prompt Gemini mejorado con `DATOS PENDIENTES` explícitos y acción requerida cuando todos están completos.
- **Fix etapa finalizado:** Solo `radicarDenuncia()` setea `etapa='finalizado'`. Si Gemini devuelve `etapaSiguiente:'finalizado'` sin `listaParaRadicar`, se setea `'confirmando'` para evitar reset prematuro.
- **Fix saludo con nombre:** Solo interceptar como saludo puro si el mensaje es ÚNICAMENTE la palabra de saludo (regex con `$`). "Hola soy Juan" pasa a Gemini.
- **Fix radicado sin resumen:** `listaParaRadicar:true` solo actúa si `etapa === 'confirmando'`. Si no, deja pasar el resumen de Gemini y setea `'confirmando'`.
- **Confirmación server-side:** Detección independiente del LLM; si usuario confirma con datos completos y hay resumen previo, fuerza radicado.

---

> Al terminar cada sesión: marcar fases, comprimir historial si supera 200 líneas.

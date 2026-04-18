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
| document-service | 3004 | ✅ |
| notification-service | 3005 | 🔜 |
| rag-service | 3006 | 🔜 |

**Puertos expuestos al host (no estándar):** API `8741`, Frontend `8742`.

## Estado del proyecto

- [x] Fase 1–9 — Scaffold, dashboard-api, frontend, Docker, seguridad, whatsapp/chatbot/Evolution API
- [x] Sesión 14 — Chatbot IA conversacional (Gemini guía el flujo, sin máquina de estados rígida)
- [x] Entrega 4 (parcial) — document-service + MinIO completo
- [ ] Entrega 4 (resto) — notification-service + rag-service
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
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Credenciales root servidor MinIO | igual que ACCESS/SECRET en dev |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Credenciales cliente MinIO | String aleatorio |
| `MINIO_BUCKET_EVIDENCIAS` | Bucket imágenes chatbot | `denunciasat-evidencias` |
| `MINIO_BUCKET_DOCUMENTOS` | Bucket .docx generados | `denunciasat-documentos` |

## Patrones técnicos establecidos

- **Login cookie**: httpOnly `token` via Route Handler Next.js, nunca en JS
- **EitherAuthGuard**: JWT OR `x-internal-key` para endpoints duales
- **`passwordHash`**: `select: false` — re-fetchear tras save en usuarios
- **QR WhatsApp**: `qrcode.updated` → Redis `evolution:qr` (TTL 90s) → `GET /qr`
- **Vistas materializadas**: `stats_por_estado`, `stats_por_dependencia` — refresh en cada call
- **chatbot-service / document-service / whatsapp-service Dockerfile**: copian `dist/` completo para preservar rutas de `libs/ai` y `libs/storage`
- **document-service arquitectura**: adm-zip + Plantilla.docx (en `infrastructure/templates/`) → inyecta body XML preservando header/footer del membrete
- **dependencias.json**: `infrastructure/config/dependencias.json` — 20+ entidades → `{titulo, nombre, cargo, entidad}`
- **Firma Mercurio**: el .docx NO lleva el nombre del concejal hardcodeado; usa placeholders `FIRMA_NOMBRE`/`FIRMA_CARGO` (Arial 11, izquierda) + tabla de 4320×1440 DXA con borde inferior para el espacio de firma + `Radicó: ` (Arial 9 cursiva #666666). Mercurio reemplaza los placeholders al firmar.
- **MinIO**: `http://minio:9000` (interno), consola `http://localhost:9001`. Buckets: `denunciasat-evidencias`/`denunciasat-documentos`. `minio-init` los crea al arrancar. Sin `documentos_data` volume.
- **imagenesEvidencia URLs**: whatsapp-service sube a MinIO inmediatamente (URL Evolution API expira). Formato: `http://minio:9000/bucket/{numero}/{ts}-{uuid}.jpg`. document-builder detecta `minio` en hostname → usa MinioService.
- **document-service flujo MinIO**: genera .docx temporal → uploadBuffer → elimina local → PATCH documentoUrl = `${radicado}.docx`
- **dashboard-api .docx**: descarga buffer de MinIO directamente (no proxy). DocumentLifecycleService cron `0 3 * * *` limpia .docx 5 días post-CON_RESPUESTA.
- **libs/storage**: `@app/storage` → `MinioService` (6 métodos, backoff 1s/2s/4s)
- **generarHechos()**: 3 párrafos, sin nombre del ciudadano, cita normativa específica
- **generarAsunto()**: método nuevo, verbo infinitivo en mayúsculas, máx 12 palabras
- **document-builder — namespaces**: el opening tag `<w:document …>` se copia EXACTO de la plantilla (regex `/<w:document[^>]*>/`). Si solo se pone `xmlns:w`, Word muestra reparación y elimina membrete.
- **document-builder — sectPr**: se extrae de la plantilla (rId10=header, rId11=footer). No hardcodear IDs.
- **document-builder — imágenes**: `getImageDimensions()` (JPEG SOF + PNG IHDR, default 3000×2000 si no detecta) + `calcularDimensionesImagen()` (MAX 5029200×3657600 EMU, MIN 1828800 EMU, 9525 EMU/px). Extensión detectada por magic bytes, no URL.
- **document-service validación**: antes de subir a MinIO valida ZIP + `xmlns:r` + `FIRMA_NOMBRE`/`FIRMA_CARGO` + `headerReference`/`footerReference` + nombre del ciudadano ausente en HECHOS. Si falla: `documentoGeneradoOk:false` sin subir.
- **solicitudAdicional / imagenesEvidencia**: campos nullable en entidad Denuncia; chatbot los captura y pasa al radicar
- **Evolution API key**: UUID válido obligatorio. Reset: `docker volume rm denunciasat_evolution_data`
- **Parche @lid**: automático al startup en whatsapp-service

## Infraestructura operacional

- `infrastructure/scripts/backup.sh` — pg_dump diario, retención 30 días, alerta Telegram
- `infrastructure/scripts/healthcheck.sh` — ping /health cada 5 min, alerta Telegram si cae

## Links

- Repo: https://github.com/SHURECITO/DenunciasAT

---

## Historial de sesiones (comprimido)

**Sesiones 1–20 (2026-04-14/18) — comprimido:** Scaffold monorepo NestJS, dashboard-api (JWT, CRUD, SEQUENCE), frontend Next.js, Docker multi-stage, Evolution API (UUID, parche @lid), chatbot IA conversacional (Gemini, Redis, historial, deep merge, confirmación server-side), document-service con adm-zip + Plantilla.docx + dependencias.json (20+ entidades, múltiples destinatarios), SYSTEM_PROMPT_LEGAL, generarHechos/generarAsunto, imágenes OOXML inline con portrait handling, solicitudAdicional + imagenesEvidencia. MinIO completo (`@app/storage`, `minio-init`, whatsapp-service sube media inmediato, document-service sube .docx tras generación, dashboard-api descarga buffer directo, `DocumentLifecycleService` cron 3am limpia .docx 5d post-CON_RESPUESTA). UI detalle: polling 8s, retry button, columna Doc.

**Sesión 22 (2026-04-18) — Fixes críticos document-service:**
- **Namespaces completos**: regex `^<w:document…` fallaba (doc empieza con `<?xml…`); corregido a `/<w:document[^>]*>/`. Ahora el opening tag preserva los 35 namespaces (xmlns:w, r, wp, a, etc.) de la plantilla → Word ya no muestra reparación ni elimina membrete.
- **Firma Mercurio**: eliminado `ANDRÉS FELIPE TOBÓN VILLADA` hardcodeado; reemplazado por tabla de firma (4320×1440 DXA, borde inferior) + placeholders `FIRMA_NOMBRE`/`FIRMA_CARGO` (Arial 11) + `Radicó: ` (Arial 9 cursiva #666666). Todo alineado izquierda.
- **Imágenes robustas**: `getImageDimensions(buf)` (devuelve {width,height} en px) + `calcularDimensionesImagen(w,h)` (EMU con MAX 5029200×3657600, MIN 1828800 px×9525). Extensión por magic bytes (no URL). Default 3000×2000 si falla detección.
- **Validación pre-upload**: antes de subir a MinIO se verifica ZIP, `xmlns:r`, placeholders FIRMA_*, `headerReference`/`footerReference`, ausencia del nombre del ciudadano en HECHOS. Si falla: notifica error sin subir.
- **sectPr rIds reales**: la nota del ticket decía rId9/rId10, pero la plantilla tiene rId10 (header) / rId11 (footer). El código ya extrae el sectPr directo de la plantilla, así que los IDs siempre están sincronizados.
- **E2E verificado**: DAT-000022 regenerado con evidencia MinIO embebida (264 KB, xmlns:r OK, 35 namespaces, tabla firma, Arial, #666666, sin nombre ciudadano en HECHOS).

**Sesión 21 (2026-04-18) — Auditoría E2E destructiva:**
- Verificada infra (10 servicios, 2 buckets MinIO, Redis, PostgreSQL, healthchecks 4 puertos OK)
- Auditado código: chatbot (deep merge, server-side confirm, telefono limpio, parciales), document-builder (Plantilla.docx + adm-zip, dependencias.json, sin nombre ciudadano, multi-destinatario, MinIO), webhook (remoteJid limpio, fallback MinIO, 200-always)
- Pruebas E2E: flujo normal completo radicó DAT-000022 con .docx 214KB en MinIO; documento valida ASUNTO infinitivo, 3 párrafos HECHOS sin nombre ciudadano, 4 puntos SOLICITUD, ANDRÉS FELIPE TOBÓN VILLADA, evidencia fotográfica embebida
- Estados: rechaza RADICADA sin documentoRevisado, rechaza retroceder; usuarios: bloquea auto-toggle; estadísticas Excel/PDF generados; mensajes endpoint OK; especiales filtrado correcto
- Estrés: reinicio sin pérdida de Redis state; mensajes vacíos/emoji/2000 chars manejados; concurrencia con estados independientes; MinIO down → chatbot sigue, webhook fallback a URL original
- **Bug corregido**: Gemini ocasionalmente devuelve `nombreCompleto` en lugar de `nombre` causando "listaParaRadicar=true pero faltan: nombre". Fix en `chatbot.service.ts` línea 146-156: normaliza `nombreCompleto`→`nombre` antes del merge
- Hallazgo no-bug: Gemini API saturado (429+503) en horas pico; el fallback gemini-3.1-flash-lite-preview también cae intermitente. No es un bug del código.

---

> Al terminar cada sesión: marcar fases, comprimir historial si supera 200 líneas.

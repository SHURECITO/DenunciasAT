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
documentoGeneradoEn, documentoPendiente, incompleta,
respuestasPorDependencia (jsonb, default '[]'),
fechaCreacion, fechaActualizacion
```
- `cedula`: string vacía para parciales, 'ANONIMO' para denuncias anónimas
- `esAnonimo`: true cuando ciudadano escribe 'anonimo' como nombre
- `barrio`/`comuna`: capturados por chatbot IA, opcionales para manual
- `descripcionResumen`: resumen generado por Gemini al radicar
- `respuestasPorDependencia`: array `{dependencia, respondio, fechaRespuesta, observacion}` para multi-destinatario — UI marca respondidas una a una

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
- **imagenesEvidencia**: whatsapp-service sube a MinIO inmediato (URL Evolution expira). Formato `http://minio:9000/bucket/{numero}/{ts}-{uuid}.jpg`. document-builder detecta `minio` en hostname → MinioService.
- **document-service flujo MinIO**: genera .docx temporal → uploadBuffer → elimina local → PATCH documentoUrl = `${radicado}.docx`
- **dashboard-api .docx**: descarga buffer de MinIO directamente (no proxy). DocumentLifecycleService cron `0 3 * * *` limpia .docx 5 días post-CON_RESPUESTA.
- **libs/storage**: `@app/storage` → `MinioService` (6 métodos, backoff 1s/2s/4s)
- **Gemini legal**: `generarHechos()` (3 párr., sin nombre ciudadano, cita normativa) + `generarAsunto()` (verbo infinitivo mayúsculas, máx 12 palabras)
- **document-builder — namespaces/sectPr**: opening tag `<w:document>` y `sectPr` se copian EXACTO de la plantilla (regex `/<w:document[^>]*>/`, rId10=header/rId11=footer). Hardcodear solo `xmlns:w` rompe el membrete.
- **document-builder — imágenes**: `getImageDimensions()` (JPEG SOF + PNG IHDR, default 3000×2000 si falla) + `calcularDimensionesImagen()` (MAX 5029200×3657600 EMU, MIN 1828800 EMU, 9525 EMU/px). Extensión por magic bytes.
- **document-service validación**: antes de subir a MinIO valida ZIP + `xmlns:r` + `FIRMA_NOMBRE`/`FIRMA_CARGO` + `headerReference`/`footerReference` + ausencia del nombre del ciudadano en HECHOS. Si falla: `documentoGeneradoOk:false` sin subir.
- **solicitudAdicional / imagenesEvidencia**: campos nullable en entidad Denuncia; chatbot los captura y pasa al radicar
- **Evolution**: API key UUID obligatorio (reset: `docker volume rm denunciasat_evolution_data`); parche @lid automático al startup en whatsapp-service
- **Mutex WhatsApp (S24)**: Redis `lock:{numero}` (TTL 15s) + `queue:{numero}` (LPUSH/RPOP) — drena secuencial con delay 1500ms. Media a MinIO ANTES del lock (URL Evolution expira). `limpiarNumero()` ignora `@g.us`/`@broadcast` y trunca JID @lid >13 dígitos.
- **Upsert parcial (S24)**: chatbot consulta `GET /denuncias/parcial/telefono/:telefono` antes de radicar; si existe parcial `incompleta:true`, hace PATCH con `incompleta:false` + datos finales. Evita duplicados.
- **IA multi-dep selectiva (S24)**: `clasificarDenunciaEstructurada()` (temp 0.15) devuelve `[{dependencia, solicitud}]`. Solo añade secundaria si competencia es genuinamente distinta. Document-builder genera sub-bloques SOLICITUD por dependencia. `filtrarSolicitudAdicional()` remueve inapropiado antes del oficio.
- **Content-Types imágenes (S24)**: `extensionesUsadas: Set` añade `<Default Extension>` a `[Content_Types].xml` si falta. docPr id = `100 + imgCount`. Sin pie de foto.
- **Stats dependencias separadas (S24)**: `string_to_array + unnest` en SQL splitea CSV. UI trunca nombres a 30 chars con "…".

## Infraestructura operacional

- `infrastructure/scripts/backup.sh` — pg_dump diario, retención 30 días, alerta Telegram
- `infrastructure/scripts/healthcheck.sh` — ping /health cada 5 min, alerta Telegram si cae

## Links

- Repo: https://github.com/SHURECITO/DenunciasAT

---

## Historial de sesiones (comprimido)

**Sesiones 1–23 (2026-04-14/18) — comprimido:** Scaffold monorepo NestJS, dashboard-api (JWT, CRUD, SEQUENCE), frontend Next.js, Docker multi-stage, Evolution API (UUID, parche @lid), chatbot IA conversacional (Gemini, Redis, historial, deep merge, confirmación server-side, normalización `nombreCompleto`→`nombre`), document-service con adm-zip + Plantilla.docx + dependencias.json (20+ entidades), MinIO completo (`@app/storage`, whatsapp-service sube media inmediato, document-service sube .docx, dashboard-api descarga buffer directo, `DocumentLifecycleService` cron 3am limpia 5d post-CON_RESPUESTA). Fixes document-service sesión 22: namespaces preservados (regex `/<w:document[^>]*>/`), firma Mercurio con placeholders + tabla 4320×1440 DXA, `getImageDimensions`/`calcularDimensionesImagen` robustos, validación pre-upload (ZIP + xmlns:r + FIRMA_* + header/footerReference + sin nombre ciudadano). Sesión 23: reset completo (TRUNCATE + sequences + FLUSHDB + buckets), diagnóstico UTF-8 (no-bug, los `◆` venían del shell cp1252 de Windows), E2E limpio verificado.

**Sesión 24 (2026-04-18) — 7 bugs + 4 mejoras IA/UX:** (detalles en "Patrones técnicos") mutex Redis WhatsApp, upsert parcial (no duplica), `@lid`>13dig, Content-Types imgs + docPr 100+, sin pie de foto, chat sort ASC, stats unnest CSV. IA: `clasificarDenunciaEstructurada` (multi-dep selectivo temp 0.15), sub-bloques SOLICITUD por dep, `filtrarSolicitudAdicional`. UX: `respuestasPorDependencia` JSONB + tabla "marcar respondida".

---

> Al terminar cada sesión: marcar fases, comprimir historial si supera 200 líneas.

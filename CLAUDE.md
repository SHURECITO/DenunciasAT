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
| minio | 9000 | ✅ |
| evolution-api | 8080 | ✅ |
| redis | 6379 | ✅ |
| postgres | 5432 | ✅ |
| document-service | 3004 | ✅ |
| notification-service | 3005 | ✅ |
| rag-service | 3006 | ✅ |

**Puertos expuestos al host (no estándar):** API `8741`, Frontend `8742`.
**Total servicios activos:** 11.

## Estado del proyecto

- [x] Fase 1–9 — Scaffold, dashboard-api, frontend, Docker, seguridad, whatsapp/chatbot/Evolution API
- [x] Sesión 14 — Chatbot IA conversacional (Gemini guía el flujo, sin máquina de estados rígida)
- [x] Entrega 4 (parcial) — document-service + MinIO completo
- [x] Entrega 4 (resto) — notification-service + rag-service
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
historialCambios (jsonb, default '[]'),
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
| `GCP_PROJECT_ID` | Proyecto GCP para ADC/IAM | ID del proyecto |
| `GCS_BUCKET_EVIDENCIAS` | Bucket imágenes chatbot en GCS | `denunciasat-evidencias` |
| `GCS_BUCKET_DOCUMENTOS` | Bucket .docx generados en GCS | `denunciasat-documentos` |

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
- **GCS privado**: `@google-cloud/storage` con ADC + IAM Service Account Credentials API. Buckets sin `allUsers`; descargas vía Signed URLs v4 de 15 min.
- **imagenesEvidencia**: whatsapp-service sube a GCS inmediato (URL Evolution expira). Formato interno `gs://bucket/{numero}/{ts}-{uuid}.jpg`. document-builder detecta `gs://` → `GcsStorageService.downloadBuffer()`.
- **document-service flujo GCS**: genera .docx temporal → uploadBuffer → elimina local → PATCH documentoUrl = `${radicado}.docx`
- **dashboard-api .docx**: genera Signed URL v4 con `GcsStorageService.getSignedUrl()` y descarga por URL temporal. DocumentLifecycleService cron `0 3 * * *` limpia .docx 5 días post-CON_RESPUESTA.
- **libs/storage**: `@app/storage` → `GcsStorageService` (ADC/IAM, Signed URLs v4, backoff 1s/2s/4s)
- **Gemini legal**: `generarHechos()` (3 párr., sin nombre ciudadano, cita normativa) + `generarAsunto()` (verbo infinitivo mayúsculas, máx 12 palabras)
- **document-builder — namespaces/sectPr**: opening tag `<w:document>` y `sectPr` se copian EXACTO de la plantilla (regex `/<w:document[^>]*>/`, rId10=header/rId11=footer). Hardcodear solo `xmlns:w` rompe el membrete.
- **document-builder — imágenes**: `getImageDimensions()` (JPEG SOF + PNG IHDR, default 3000×2000 si falla) + `calcularDimensionesImagen()` (MAX 5029200×3657600 EMU, MIN 1828800 EMU, 9525 EMU/px). Extensión por magic bytes.
- **document-service validación**: antes de subir a MinIO valida ZIP + `xmlns:r` + `FIRMA_NOMBRE`/`FIRMA_CARGO` + `headerReference`/`footerReference` + ausencia del nombre del ciudadano en HECHOS. Si falla: `documentoGeneradoOk:false` sin subir.
- **solicitudAdicional / imagenesEvidencia**: campos nullable en entidad Denuncia; chatbot los captura y pasa al radicar
- **Evolution**: API key UUID obligatorio (reset: `docker volume rm denunciasat_evolution_data`); parche @lid automático al startup en whatsapp-service
- **Mutex WhatsApp (S28)**: Redis `lock:{numero}` (TTL **8s**) + `queue:{numero}` (LPUSH/RPOP) — lock liberado ANTES de drenar cola, delay 2000ms. Media a MinIO ANTES del lock. `resolverNumeroLid()`: si JID @lid >13 dígitos, llama `POST /chat/whatsappNumbers/{instance}` de Evolution API; fallback: prefijo 57 + últimos 10 dígitos.
- **Upsert parcial (S28)**: `radicarDenuncia()` usa `estado.parcialId` Redis PRIMERO (antes de buscar por teléfono) — evita duplicados aunque el número @lid varíe entre mensajes.
- **IA multi-dep selectiva (S24)**: `clasificarDenunciaEstructurada()` (temp 0.15) devuelve `[{dependencia, solicitud}]`. Solo añade secundaria si competencia es genuinamente distinta. Document-builder genera sub-bloques SOLICITUD por dependencia. `filtrarSolicitudAdicional()` remueve inapropiado antes del oficio.
- **Content-Types imágenes (S24)**: `extensionesUsadas: Set` añade `<Default Extension>` a `[Content_Types].xml` si falta. docPr id = `100 + imgCount`. Sin pie de foto.
- **Stats dependencias separadas (S24)**: `string_to_array + unnest` en SQL splitea CSV. UI trunca nombres a 30 chars con "…".
- **WebSockets dashboard (S29)**: Socket.IO en `dashboard-api` sobre el mismo puerto HTTP (host `8741` → contenedor `3000`), namespace `/eventos`, eventos `nueva_denuncia`, `cambio_estado`, `documento_listo`, `nuevo_mensaje`.
- **RAG semántico (S30)**: `rag-service` (puerto `3006`) con tabla `dependencias_vectores` (pgvector 768D) y endpoints `POST /buscar`, `POST /clasificar`, `POST /reindexar` (internal key), más `GET /dependencias`/`GET /health`. Si Gemini no está disponible, activa fallback local (embeddings/clasificación) sin tumbar el servicio.

## Historial de sesiones (comprimido)

**Sesiones 1–30 (2026-04-14/19):** scaffold monorepo, dashboard-api + frontend, Docker/Evolution, chatbot IA conversacional, document-service + MinIO, hardening OOXML/firma/validaciones, mutex/@lid/upsert parcial, edición manual, seguridad (auth interna/SSRF/DTOs), notification-service, WebSockets dashboard y `rag-service` con pgvector/fallback.

**Sesiones 31–34 (2026-04-20/21):** articulación institucional en casos mixtos, prompt jurídico avanzado, enriquecimiento semántico de dependencias y motor central `InferenciasService`.

**Sesión 35 (2026-04-20):** corrección semántica controlada de `dependencias.vector.db.json` sin tocar IDs/vectorSparse: DAGRD (Ley 1523 principal + 1551 complemento), Telemedellín (Ley 182/1341), Medio Ambiente (+Ley 1801 por `ruido`), Gerencia Étnica (+Ley 70 + Ley 21), Gerencia Diversidades Sexuales (+Ley 1482) y limpieza global de stopwords (`de`, `la`, `el`, `y`, `del`) en `keywords`.
**Sesión 36 (2026-04-20):** capa de admisibilidad en `InferenciasService` (`evaluarAdmisibilidad`) con salida estructurada + logging `{inputUsuario,tipoCaso,confianza,motivoAdmisibilidad,decisionFinal}`; integración en chatbot para bloquear/solicitar más info antes de avanzar o radicar y en document-service para generar .docx solo cuando `esAdmisible=true`.
**Sesión 37 (2026-04-21):** preparación para despliegue real en GCP: eliminada credencial hardcodeada en `rag.service.ts` (fallback DB_PASSWORD), healthchecks en todos los Dockerfiles, `docker-compose.prod.yml` con imágenes de Artifact Registry, `.github/workflows/deploy.yml` (build→push→SSH deploy→verify), `JsonLogger` JSON en `libs/common` activado en producción en todos los `main.ts`, scripts `deploy.sh` y `setup-secrets.sh`, `.dockerignore` mejorado, `.env.example` con vars GCP.

**Sesión 38 (2026-04-21):** migración completa de MinIO → Google Cloud Storage: `libs/storage` reemplazado por `GcsStorageService` (`@google-cloud/storage`), URLs internas cambiadas de `http://minio:9000/bucket/obj` a `gs://bucket/obj`, servicios `minio` y `minio-init` eliminados de ambos docker-compose, variables `MINIO_*` → `GCS_*`, `scripts/test-gcs.ts` añadido.

**Sesión 39 (2026-04-22):** GCS privado con ADC + IAM Service Account Credentials API: Signed URLs v4 de 15 min, sin `key.json`/`GOOGLE_APPLICATION_CREDENTIALS`, sin fallback a URLs públicas y `scripts/test-gcs.ts` validando upload/signed URL/fetch/delete.

**Sesión 40 (2026-04-23):** auditoría y estabilización del sistema completo: (1) añadidos `solicitudAdicional` e `imagenesEvidencia` a interfaz `Denuncia` en `frontend/lib/api.ts` y eliminado cast `as unknown as` en `ModalEditarDenuncia.tsx`; (2) CI/CD deploy corregido con `-f docker-compose.prod.yml`; (3) frontend Dockerfile recibe `ARG NEXT_PUBLIC_WS_URL`/`ARG NEXT_PUBLIC_API_URL` en build time (variables de cliente se inlinean en bundle); (4) build-args añadidos al paso CI del frontend; (5) endpoint `GET /health` creado en Next.js (`app/health/route.ts`); (6) callback `onSaved` en `DenunciaDetalle` actualiza `documentoPendiente:true` cuando `regenerando=true`.
**Sesión 41 (2026-04-23):** corrección de bugs críticos identificados en auditoría QA de producción: (1) `.env` confirmado nunca en git (`.gitignore` correcto); (2) llamada a `procesarMensajeChatbot()` en `chatbot.service.ts` envuelta en `try/catch` con `Promise.race` de 15 s — si Gemini hace timeout o lanza, responde `MSG_ERROR_TECNICO` en lugar de crashear el webhook; (3) `mergeDatosConfirmadosSeguro()` normaliza nombre='anonimo'/'anónimo' a `esAnonimo=true` + limpia `nombre`, eliminando inconsistencia; (4) `radicarDenuncia()` y `cerrarCasoEspecial()` añaden guard idéntico sobre `d.nombre` antes de construir el payload; (5) `document.service.ts` declara `rutaArchivo` fuera del `try`, el bloque `finally` garantiza la eliminación del archivo temporal en todos los caminos (éxito, validación fallida, error GCS, cualquier excepción).
**Sesión 42 (2026-04-23):** hardening producción: (1) `evolution.service.ts` — `sendText()` reemplaza retry único por bucle 3 intentos con backoff 2s/4s + timeout 10s por intento; ya no propaga excepción al caller; (2) `webhook.controller.ts` — todas las operaciones Redis (get/set/lpush/del/rpop) envueltas en try/catch individual; si Redis no está disponible el mensaje se procesa sin mutex en lugar de crashear; QR Redis write también protegido; (3) `conversacion.service.ts` — Redis creado con `commandTimeout:3000`, `connectTimeout:5000`, `retryStrategy` (max 5 reintentos), `reconnectOnError` y handler `on('error')` que loguea sin crashear; (4) `webhook.module.ts` — misma configuración al Redis client inyectado; (5) `docker-compose.yml` — añadidos healthchecks (`wget -qO-`) a whatsapp-service, chatbot-service, document-service, notification-service, rag-service y frontend; chatbot-service depends_on rag-service `service_healthy`; whatsapp-service depends_on chatbot-service `service_healthy`; rag-service port cambiado a `127.0.0.1:3006:3006`; (6) `docker-compose.prod.yml` — mismos cambios depends_on/healthchecks + frontend healthcheck añadido; (7) `.github/workflows/deploy.yml` — nuevo job `test` (tsc --noEmit + jest whatsapp-service) que bloquea build-and-push si falla; verify job con retry loop de 5 intentos y sleep 20s inicial.

**Sesión 43 (2026-04-24):** hardening CI/CD: (1) `--testPathPattern` → `--testPathPatterns` (Jest 30); (2) `frontend-build` usa `secrets.NEXT_PUBLIC_API_URL/WS_URL` en lugar de localhost; (3) `deploy-vm` añade paso pre-vuelo que valida `GCP_VM_INSTANCE`, `GCP_VM_ZONE`, `GCP_SSH_PRIVATE_KEY` antes de autenticar; (4) `console.error/warn` → `Logger.error/warn` en `webhook.module.ts` y `estadisticas.service.ts`; (5) `warnMissingEnv()` añadido en `main.ts` de chatbot/whatsapp/document/notification/rag services; IAM requerido: `roles/compute.viewer` + `roles/iap.tunnelResourceAccessor` en SA de deploy.
**Sesión 44 (2026-04-24):** fix `KeyError: ContainerConfig` — `docker-compose` (v1 Python) → `docker compose` (v2 plugin) en heredoc SSH de `deploy.yml`; añadido paso diagnóstico `docker version` + `docker compose version` antes del pull; `deploy.sh` ya usaba v2, sin cambios; `frontend/app/api/auth/login/route.ts` — `secure: NODE_ENV==='production'` → `secure: COOKIE_SECURE==='true'` para evitar que el browser descarte la cookie sobre HTTP; instalación idempotente del plugin vía descarga directa del binario desde GitHub releases (v2.24.6 → `~/.docker/cli-plugins/docker-compose`) — reemplaza el bloque `apt-get` que fallaba por repositorio Ubuntu sin repo oficial de Docker; `docker network rm denunciasat_network 2>/dev/null || true` antes del `up` para limpiar red stale con etiquetas v1 incompatibles con v2; bloque `cat > .env << 'ENVEOF'` al inicio del heredoc SSH regenera `.env` en la VM desde GitHub Secrets en cada deploy (19 secretos + constantes hardcodeadas), elimina gestión manual del `.env` en la VM; `docker network rm` movido antes del `pull` (era entre pull y up — el conflicto ocurre en `up`, moverlo antes lo previene); reemplazado `docker network rm denunciasat_network` por `compose down --remove-orphans` + `docker network ls --filter label=com.docker.compose.network -q | xargs -r docker network rm` — elimina contenedores en uso antes de borrar la red y usa el label de compose en lugar del nombre hardcodeado.
**Sesión 45 (2026-04-24):** Fase 1 sistema de feedback: entidad `FeedbackDenuncia` (tabla `feedback_denuncias`, FK CASCADE denuncia+usuario, uuid PK); `POST /feedback` guarda evaluación + setea `documentoRevisado:true` en transacción; `GET /feedback/stats` retorna precisión agregada; `GET /feedback/denuncia/:id` retorna historial; modal `ModalFeedback` (4 preguntas: dep correcta, estrellas HECHOS, asunto, texto libre) reemplaza toggle directo; tab "Historial de feedback" en detalle denuncia; tarjeta "Precisión de la IA" en /estadisticas; rutas Next.js proxy `/api/feedback/*`; fix ESLint `react/no-unescaped-entities` en `DenunciaDetalle.tsx:526` — `"` → `&quot;` alrededor de `{fb.comentarioHechos}`.

---

> Al terminar cada sesión: marcar fases, comprimir historial si supera 200 líneas.

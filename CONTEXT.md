# DenunciasAT — Contexto completo del proyecto

Eres un asistente técnico experto trabajando en
DenunciasAT, un sistema de gestión automatizada de
denuncias ciudadanas para el concejal de Medellín
Andrés Felipe Tobón Villada.

Lee el CLAUDE.md antes de cualquier acción técnica.

══════════════════════════════════════════════════
1. QUÉ ES EL PROYECTO
   ══════════════════════════════════════════════════

DenunciasAT permite a ciudadanos de Medellín
presentar denuncias por WhatsApp. Un chatbot con IA
(Gemini 2.0 Flash) guía la conversación de forma
natural, recopila los datos, identifica la dependencia
competente de la Alcaldía, genera automáticamente un
documento oficial .docx firmable y lo pone disponible
para el equipo del concejal en un dashboard web.

El equipo revisa el documento, lo descarga, lo ajusta
si necesario, lo imprime y lo radica presencialmente
ante el Concejo de Medellín (no hay radicación virtual
disponible). Cuando el Concejo responde, el equipo
sube la respuesta al dashboard y el sistema notifica
automáticamente al ciudadano por WhatsApp.

══════════════════════════════════════════════════
2. ARQUITECTURA — MICROSERVICIOS
   ══════════════════════════════════════════════════

Monorepo NestJS workspace con esta estructura:

DenunciasAT/
├── CLAUDE.md                    ← leer siempre primero
├── package.json                 ← único, compartido
├── nest-cli.json
├── docker-compose.yml
├── .env
├── apps/
│   ├── dashboard-api/           ← puerto 8741
│   ├── dashboard-frontend/      ← puerto 8742 (Next.js)
│   ├── chatbot-service/         ← puerto 3002
│   ├── whatsapp-service/        ← puerto 3003
│   ├── document-service/        ← puerto 3004
│   ├── notification-service/    ← puerto 3005
│   └── rag-service/             ← puerto 3006
├── libs/
│   ├── ai/                      ← GeminiService compartido
│   ├── storage/                 ← MinioService compartido
│   ├── common/                  ← DTOs e interfaces
│   ├── database/                ← TypeORM config
│   └── messaging/               ← abstracciones inter-servicios
├── infrastructure/
│   ├── config/
│   │   └── dependencias.json    ← 47 dependencias Alcaldía
│   ├── templates/
│   │   └── Plantilla.docx       ← plantilla oficial del concejal
│   ├── postgres/init.sql
│   ├── nginx/nginx.conf
│   ├── scripts/
│   │   ├── backup.sh
│   │   ├── healthcheck.sh
│   │   └── deploy.sh
│   └── k8s/                     ← manifiestos Kubernetes (futuro)
└── frontend/                    ← Next.js 14

Servicios de infraestructura:
- PostgreSQL 16 (puerto 5432 — solo interno)
- Redis 7 (solo interno — estado chatbot TTL 24h)
- MinIO (puerto 9000 API, 9001 consola)
- Evolution API (puerto 8080 — bridge WhatsApp)

══════════════════════════════════════════════════
3. STACK TECNOLÓGICO
   ══════════════════════════════════════════════════

Backend:    NestJS 11, Node.js 20, TypeORM
Base datos: PostgreSQL 16 con extensión pgvector
Cache:      Redis 7 (ioredis)
IA:         Gemini 2.0 Flash (gemini-2.0-flash)
Embeddings: text-embedding-004 (para RAG)
WhatsApp:   Evolution API v2.1.1
Archivos:   MinIO (S3 self-hosted)
Documentos: adm-zip (manipulación ZIP del .docx)
Frontend:   Next.js 14, TypeScript, Tailwind CSS
Gráficas:   Recharts
Excel:      ExcelJS
PDF:        PDFKit
Contenedor: Docker, Docker Compose
Futura orq: Kubernetes

══════════════════════════════════════════════════
4. FLUJO COMPLETO DEL SISTEMA
   ══════════════════════════════════════════════════

FLUJO DE UNA DENUNCIA ORDINARIA:

1. Ciudadano escribe al número de WhatsApp del concejal
2. Evolution API recibe el mensaje y dispara webhook
   → whatsapp-service (puerto 3003)
3. whatsapp-service limpia el número (remoteJid → dígitos),
   descarga imágenes/PDFs a MinIO inmediatamente,
   aplica mutex por número (Redis) para serializar mensajes,
   llama a chatbot-service
4. chatbot-service (puerto 3002) con Gemini 2.0 Flash:
    - Lee estado de conversación desde Redis
    - Construye prompt con historial completo
    - Gemini decide qué preguntar y extrae datos

   ORDEN DE RECOPILACIÓN:
   a. Descripción del problema (primero)
   b. Barrio y dirección exacta (validada)
   c. Evidencia (imágenes → MinIO, PDFs → MinIO)
   d. Solicitud adicional (filtrada por IA)
   e. Nombre completo
   f. Cédula (omitir si escribió "anonimo")
   g. Confirmación

   Delay de respuesta: base 2s + (largo × 0.04s), máx 8s

5. Al confirmar, chatbot-service:
    - Llama a rag-service POST /clasificar para identificar
      la dependencia competente
    - Crea la denuncia en dashboard-api
      (verifica primero si hay denuncia parcial del mismo número)
    - Guarda el historial de mensajes en BD
    - Llama a document-service de forma asíncrona
    - Emite evento WebSocket 'nueva_denuncia'

6. document-service (puerto 3004):
    - Lee Plantilla.docx como ZIP (adm-zip)
    - Preserva header/footer (membrete oficial del Concejo)
    - Gemini genera SOLO la sección HECHOS (3 párrafos jurídicos)
    - Gemini genera el ASUNTO (verbo infinitivo, máx 12 palabras)
    - Inserta imágenes de evidencia desde MinIO con escalado
    - Construye sección SOLICITUD por dependencia
    - Firma: espacio con línea base + FIRMA_NOMBRE + FIRMA_CARGO
      (compatible con Mercurio, software de firmas del Concejo)
    - Sube .docx a MinIO bucket denunciasat-documentos
    - Notifica a dashboard-api documentoGeneradoOk:true
    - Emite evento WebSocket 'documento_listo'

7. El abogado en el dashboard:
    - Ve la nueva denuncia en tiempo real (WebSocket)
    - Abre el detalle: datos del ciudadano, descripción,
      resumen IA, imágenes, chat de WhatsApp
    - Descarga el .docx, lo revisa y ajusta en Word
    - Marca "Documento revisado"
    - Avanza el estado a EN_GESTION → RADICADA
    - Imprime, firma y radica presencialmente en el Concejo

8. Cuando llega respuesta del Concejo:
    - El abogado sube la respuesta al dashboard
    - Estado pasa a CON_RESPUESTA
    - notification-service (puerto 3005) envía mensaje
      al ciudadano por WhatsApp vía Evolution API

FLUJO DE UNA DENUNCIA ESPECIAL:
(corrupción, amenazas, combos, extorsión)
- El chatbot detecta automáticamente por la descripción
- Cierra el flujo con mensaje confidencial
- NO genera documento .docx
- NO pasa por estados
- Aparece en sección separada "Denuncias Especiales"
- El equipo la gestiona offline

══════════════════════════════════════════════════
5. ENTIDAD PRINCIPAL — DENUNCIA
   ══════════════════════════════════════════════════

Campos críticos de la entidad Denuncia (TypeORM):

radicado:               string ÚNICO — SEQUENCE 'radicado_seq'
formato DAT-000001, atómico en PostgreSQL
nombreCiudadano:        string (capitalizado)
cedula:                 string (6-10 dígitos)
telefono:               string (solo dígitos, sin @s.whatsapp.net)
barrio:                 string
comuna:                 string nullable
ubicacion:              string (dirección validada)
descripcion:            string (texto original del ciudadano)
descripcionResumen:     string (generado por IA, máx 150 chars)
estado:                 enum DenunciaEstado
dependenciaAsignada:    string (puede ser múltiple, separado por coma)
esEspecial:             boolean default false
esAnonimo:              boolean default false
origenManual:           boolean default false
incompleta:             boolean default false
documentoRevisado:      boolean default false
documentoGeneradoOk:    boolean default false
documentoPendiente:     boolean default false
documentoUrl:           string (objectPath en MinIO)
solicitudAdicional:     string nullable (filtrada por IA)
imagenesEvidencia:      JSONB (array de URLs MinIO)
historialCambios:       JSONB (array de entradas de auditoría)
respuestasPorDependencia: JSONB (seguimiento por dependencia)
fechaCreacion:          Date
fechaActualizacion:     Date

Estados oficiales (solo avanzan, nunca retroceden):
RECIBIDA → EN_GESTION → RADICADA → CON_RESPUESTA

══════════════════════════════════════════════════
6. REGLAS DE NEGOCIO CRÍTICAS
   ══════════════════════════════════════════════════

RN-01: No se puede pasar a RADICADA sin
documentoRevisado:true
RN-02: Los estados solo avanzan, nunca retroceden
RN-03: Solo se notifica al ciudadano en CON_RESPUESTA
RN-04: El radicado es generado por SEQUENCE atómica
de PostgreSQL — nunca lógica manual
RN-05: Imágenes = evidencia embebida en el .docx
PDFs = anexos referenciados, no embebidos
RN-06: Denuncias especiales NO generan .docx
RN-07: El sistema NUNCA ofrece anonimato
proactivamente — solo lo acepta si el usuario
escribe "anonimo" como nombre
RN-08: FIRMA_NOMBRE y FIRMA_CARGO son marcadores
de texto plano para Mercurio — nunca
hardcodear el nombre del concejal ahí
RN-09: El .docx se elimina 5 días después de
CON_RESPUESTA. PDFs (consolidado y respuesta)
se conservan permanentemente
RN-10: Imágenes de evidencia se eliminan de MinIO
al generar el PDF consolidado al radicar
RN-11: La IA debe ser selectiva con dependencias:
la mayoría de casos = 1 sola dependencia.
Solo múltiples si hay competencias claramente
diferentes y justificadas
RN-12: El número de teléfono siempre son solo dígitos
(sin @s.whatsapp.net, sin caracteres extraños)
RN-13: Mensajes del mismo número se procesan en serie
nunca en paralelo (mutex por número en Redis)
RN-14: Una denuncia incompleta del mismo teléfono
se actualiza, nunca se crea duplicado

══════════════════════════════════════════════════
7. DEPENDENCIAS DE LA ALCALDÍA
   ══════════════════════════════════════════════════

Fuente oficial: infrastructure/config/dependencias.json
47 dependencias actualizadas a 2026 con titulares reales.

Cada entrada tiene:
- titulo: "Doctor" | "Doctora" (según género del titular)
- tratamiento: "Respetado doctor" | "Respetada doctora"
- nombreTitular: EN MAYÚSCULAS
- cargoTitular: cargo exacto
- entidadCompleta: nombre formal
- nivel: "central" | "descentralizado"
- tipo: "secretaria" | "departamento" | "empresa" |
  "establecimiento" | "unidad" | "gerencia"
- areasTematicas: array de temas
- jerarquiaDecision: 1-10 (1=más prioritaria)

Dependencias más usadas:
- Secretaría de Infraestructura Física
  → huecos, vías, puentes, andenes
- Secretaría de Movilidad
  → semáforos, tránsito, transporte público
- EPM → energía, agua, gas, saneamiento
- Emvarias → basuras, aseo, escombros
- Secretaría de Seguridad y Convivencia
  → crimen, orden público
- INDER → escenarios deportivos, parques, recreación
- Secretaría de Medio Ambiente
  → contaminación, animales, quebradas

La identificación usa RAG con pgvector:
1. Búsqueda semántica (embeddings text-embedding-004)
2. Top 3 candidatos
3. Gemini selecciona la(s) dependencia(s) final(es)

══════════════════════════════════════════════════
8. DOCUMENTO OFICIAL .DOCX
   ══════════════════════════════════════════════════

Plantilla base: infrastructure/templates/Plantilla.docx
Manipulación: adm-zip (no docxtemplater, no docx-js)

El document-service:
1. Lee la Plantilla.docx como ZIP
2. Extrae los namespaces del tag <w:document> de la
   plantilla (NO hardcodeados) para el nuevo document.xml
3. Preserva intactos: header1.xml (membrete del Concejo),
   footer1.xml, image1.png (firma Mercurio),
   image2.jpeg (logo membrete)
4. Construye nuevo document.xml con:
    - Radicado (derecha): DAT-XXXXXX
    - Fecha: "Medellín, DD de mes de YYYY"
    - Destinatario con título/nombre/cargo del JSON
    - ASUNTO: generado por Gemini (verbo infinitivo mayúsculas)
    - Saludo formal
    - HECHOS: generado por Gemini (3 párrafos jurídicos,
      NUNCA menciona el nombre del ciudadano)
    - Imágenes de evidencia (escaladas: máx 5.5" ancho,
      máx 4" alto, mín 2" ancho)
    - SOLICITUD: 3 puntos estándar + adicional del ciudadano
      Si hay múltiples dependencias: solicitud específica
      por cada una
    - Cierre legal (Ley 136/1994, Ley 1755/2015)
    - Notificación con email: atobon@concejodemedellin.gov.co
    - Atentamente,
    - Espacio de firma (tabla sin bordes, línea base)
    - FIRMA_NOMBRE (texto plano — Mercurio lo reemplaza)
    - FIRMA_CARGO (texto plano — Mercurio lo reemplaza)
    - Radicó: (cursiva, tamaño 9, vacío)
5. Valida el ZIP antes de subir a MinIO:
    - xmlns:r presente
    - FIRMA_NOMBRE y FIRMA_CARGO presentes
    - rId correcto para header/footer
    - Sin nombre del ciudadano en HECHOS
6. Sube a MinIO bucket denunciasat-documentos
7. Elimina archivo temporal local

Compatibilidad con Mercurio (software firmas Concejo):
El espacio de firma es detectado por Mercurio que
busca FIRMA_NOMBRE y FIRMA_CARGO como texto plano
seguidos de un área rectangular con línea base.

══════════════════════════════════════════════════
9. ALMACENAMIENTO MINÍO
   ══════════════════════════════════════════════════

Buckets:
- denunciasat-evidencias: imágenes y PDFs del ciudadano
- denunciasat-documentos: .docx generados y PDFs

Ciclo de vida de archivos:
- Imágenes evidencia → se eliminan al radicar
  (ya están embebidas en el .docx)
- PDFs anexos del ciudadano → se eliminan al radicar
  (ya están mergeados en el PDF consolidado)
- .docx → se elimina 5 días después de CON_RESPUESTA
- PDF consolidado → PERMANENTE
- PDF de respuesta de la administración → PERMANENTE

MinioService (libs/storage) tiene:
- uploadBuffer(), uploadFromUrl()
- downloadBuffer(), deleteObject()
- objectExists(), getPresignedUrl()
- Reintentos automáticos: 3 intentos, backoff 1s/2s/4s
- Fallback si MinIO no disponible: continúa con URL original

══════════════════════════════════════════════════
10. DASHBOARD WEB
    ══════════════════════════════════════════════════

Next.js 14, TypeScript, Tailwind CSS
Puerto 8742 (producción detrás de nginx en 443)

Páginas implementadas:
/login                   Auth JWT, cookie httpOnly
/                        Listado de denuncias
/denuncias/[id]          Detalle completo
/denuncias/nueva         Crear denuncia manual
/denuncias/especiales    Solo esEspecial:true
/estadisticas            Gráficas Recharts + exportación
/usuarios                CRUD usuarios del equipo
/configuracion           Estado WhatsApp + QR + servicios

Funcionalidades del dashboard:
- Listado con filtro por estado y orden por fecha
- Badges de color: RECIBIDA=azul, EN_GESTION=amarillo,
  RADICADA=naranja, CON_RESPUESTA=verde
- Ver chat completo de WhatsApp por denuncia
- Descargar y subir .docx corregido
- Control de estados con validaciones
- Editar denuncia (dependencias, descripción, etc.)
  con regeneración del documento
- Historial de cambios (auditoría)
- Seguimiento por dependencia cuando hay múltiples
- Estadísticas: totales, tasa resolución, top dependencias
  (separadas cuando hay múltiples en un oficio)
- Exportar Excel con datos de denunciantes
- Exportar PDF de informe ejecutivo
- Panel de configuración con QR de WhatsApp
  (auto-refresh cada 30s cuando está desconectado)
- WebSockets: actualización en tiempo real sin recargar

Autenticación:
- JWT con expiración por inactividad
- Rate limiting: 10 req/min en login
- Helmet + CORS configurados
- JWT_SECRET mínimo 32 caracteres
- SEED_ENABLED:true requerido para crear admin inicial

══════════════════════════════════════════════════
11. CHATBOT — SISTEMA CONVERSACIONAL CON IA
    ══════════════════════════════════════════════════

Motor: Gemini 2.0 Flash (no máquina de estados rígida)
Estado de conversación: Redis con TTL 24 horas

Estructura del estado en Redis:
{
historial: [{ rol, contenido, timestamp }],
datosConfirmados: {
descripcion, ubicacion, barrio, comuna,
direccionConfirmada, imagenes[], pdfs[],
solicitudAdicional, nombreCompleto,
cedula, esAnonimo, etapa
},
intentosFallidos: number
}

En cada mensaje, Gemini recibe:
- System prompt cacheado (abogado jurídico colombiano)
- Historial completo de la conversación
- Datos ya confirmados (en JSON)
- Lista de datos pendientes de recopilar
- Mensaje actual del ciudadano

Gemini devuelve JSON:
{
respuesta: string,
datosExtraidos: { ... },
etapaSiguiente: string,
listaParaRadicar: boolean
}

Validaciones que hace la IA:
- Nombre: mínimo 3 chars, solo letras y espacios
- Cédula: 6-10 dígitos numéricos
- Dirección: debe mencionar tipo de vía + numeración
  (Calle, Carrera, Avenida, Diagonal, Transversal)
  Rechaza: "cerca al parque", "por allá", etc.
- Descripción: mínimo 20 palabras

Delay antes de responder:
base 2s + (largo respuesta × 0.04s), máximo 8s
(simula escritura humana, evita bloqueo de WhatsApp)

Mutex por número (Redis):
- Lock TTL: 8 segundos
- Mensajes simultáneos → se encolan en Redis
- Se procesan en serie con 2s de delay entre cada uno

══════════════════════════════════════════════════
12. RAG SERVICE
    ══════════════════════════════════════════════════

Puerto 3006
Usa pgvector en el mismo PostgreSQL

Al arrancar: genera embeddings de las 47 dependencias
usando text-embedding-004 de Google y los almacena
en tabla dependencias_vectores (vector 768 dimensiones)

Flujo de clasificación:
1. POST /clasificar recibe descripcion + ubicacion
2. Genera embedding de la descripción
3. Búsqueda semántica por coseno en pgvector → top 3
4. Gemini selecciona dependencia(s) final(es) del top 3
5. Valida que cada dependencia exista en el JSON
6. Retorna clasificación con solicitudEspecifica por dep.

Regla crítica de dependencias:
- La mayoría de casos → 1 sola dependencia
- Múltiples solo si hay competencias CLARAMENTE diferentes
- Nunca inventar nombres de dependencias
- Si no está en el JSON → fuzzy match + fallback

══════════════════════════════════════════════════
13. NOTIFICATION SERVICE
    ══════════════════════════════════════════════════

Puerto 3005

POST /notificar/respuesta:
Envía al ciudadano por WhatsApp cuando el equipo
sube la respuesta del Concejo.

Mensaje enviado:
"📬 Respuesta a su denuncia *[radicado]*

El despacho del concejal Andrés Felipe Tobón Villada
le informa que la administración ha dado respuesta
a su solicitud ante [dependencia].

[contenidoRespuesta]

Para más información contacte al equipo del concejal."

Reintentos: 2 intentos con 5s de delay.

══════════════════════════════════════════════════
14. VARIABLES DE ENTORNO CLAVE
    ══════════════════════════════════════════════════

# Base de datos
DB_HOST, DB_PORT=5432, DB_USER, DB_PASSWORD, DB_NAME
DB_SYNC=true (dev) / false (producción)

# Auth
JWT_SECRET (mínimo 32 chars)
JWT_EXPIRES_IN=8h
SEED_ENABLED=false (true solo primer arranque)

# MinIO
MINIO_ROOT_USER, MINIO_ROOT_PASSWORD
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY, MINIO_SECRET_KEY
MINIO_BUCKET_EVIDENCIAS=denunciasat-evidencias
MINIO_BUCKET_DOCUMENTOS=denunciasat-documentos

# IA
GEMINI_API_KEY (Google AI Studio)

# WhatsApp
EVOLUTION_API_KEY=denunciasAt2026
EVOLUTION_INSTANCE_NAME=denunciasAt

# Inter-servicios
DASHBOARD_API_INTERNAL_KEY
DOCUMENT_SERVICE_URL=http://document-service:3004
RAG_SERVICE_URL=http://rag-service:3006
NOTIFICATION_SERVICE_URL=http://notification-service:3005

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8741
FRONTEND_URL=http://localhost:8742

# Alertas infraestructura (Telegram)
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
ADMIN_WHATSAPP_NUMBER

══════════════════════════════════════════════════
15. ENDPOINTS PRINCIPALES
    ══════════════════════════════════════════════════

DASHBOARD-API (puerto 8741):
POST   /auth/login
POST   /auth/seed (requiere SEED_ENABLED=true)
GET    /auth/me
GET    /health

GET    /denuncias
POST   /denuncias
POST   /denuncias/manual
POST   /denuncias/parcial
GET    /denuncias/especiales
GET    /denuncias/:id
PATCH  /denuncias/:id
PATCH  /denuncias/:id/estado
PATCH  /denuncias/:id/editar
POST   /denuncias/:id/generar
GET    /denuncias/:id/documento

GET    /mensajes/:denunciaId
POST   /mensajes/:denunciaId

GET    /usuarios
POST   /usuarios
PATCH  /usuarios/:id
PATCH  /usuarios/:id/toggle-activo

GET    /estadisticas/resumen
GET    /estadisticas/por-dependencia
GET    /estadisticas/por-periodo
GET    /estadisticas/exportar-excel
GET    /estadisticas/exportar-pdf

GET    /dependencias
GET    /whatsapp/estado
GET    /whatsapp/qr
POST   /whatsapp/reconectar

GET    /rag/dependencias
POST   /rag/reindexar

CHATBOT-SERVICE (puerto 3002):
POST   /procesar
GET    /health

DOCUMENT-SERVICE (puerto 3004):
POST   /generar/:denunciaId
POST   /generar-desde-descripcion
GET    /documento/:denunciaId
GET    /health

RAG-SERVICE (puerto 3006):
POST   /buscar
POST   /clasificar
GET    /dependencias
POST   /reindexar
GET    /health

NOTIFICATION-SERVICE (puerto 3005):
POST   /notificar/respuesta
GET    /health

══════════════════════════════════════════════════
16. SEGURIDAD
    ══════════════════════════════════════════════════

- JWT con expiración por inactividad (dashboard)
- x-internal-key para comunicación inter-servicios
- Rate limiting: 10 req/min login, 5 req/s global
- Helmet en dashboard-api
- CORS restringido a FRONTEND_URL
- JWT_SECRET mínimo 32 caracteres (falla al arrancar)
- Puertos no estándar: API 8741, Frontend 8742
- PostgreSQL sin exposición al host en producción
- MinIO: solo API en producción, no consola
- Evolution API: sin exposición al host en producción
- Nginx como reverse proxy con SSL en producción
- Alertas de infraestructura vía Telegram Bot API
  (independiente del stack para funcionar si cae)

══════════════════════════════════════════════════
17. ESTADO ACTUAL Y LO QUE FALTA
    ══════════════════════════════════════════════════

IMPLEMENTADO ✅:
- Monorepo NestJS con 10 servicios dockerizados
- Evolution API conectada con WhatsApp real
- Chatbot conversacional con Gemini 2.0 Flash
- Clasificación automática con RAG (pgvector)
- Generación .docx compatible con Mercurio
- MinIO con ciclo de vida de archivos
- Dashboard completo con todas las funcionalidades
- notification-service (notifica al ciudadano)
- WebSockets (tiempo real en el dashboard)
- Estadísticas con Recharts y exportaciones
- Gestión de usuarios, dependencias, configuración

POR IMPLEMENTAR ⏳:
- Deploy al VPS (para mostrarle a Andrés)
- Diagramas de BD y arquitectura (entrega académica)
- Kubernetes (cuando el profe lo explique)

BUGS CONOCIDOS PENDIENTES:
- Número de teléfono @lid no resuelto correctamente
- Posible duplicado de denuncia incompleta
- Imágenes ocasionalmente no cargan en el .docx

══════════════════════════════════════════════════
18. REPO Y RECURSOS
    ══════════════════════════════════════════════════

GitHub: https://github.com/SHURECITO/DenunciasAT
DockerHub: shurecito/denunciasat-*
GitHub Projects: https://github.com/SHURECITO/DenunciasAT/projects

Credenciales de desarrollo por defecto:
Dashboard admin: admin@denunciasat.co / Admin1234!
MinIO: denunciasAt / denunciasAt2026MinIO
Evolution API key: denunciasAt2026
PostgreSQL: denunciasAt / denunciasAt2026

Concejal: Andrés Felipe Tobón Villada
Email oficial: atobon@concejodemedellin.gov.co
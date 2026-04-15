# CLAUDE.md

## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Skip files over 100KB unless explicitly required.
- Recommend starting a new session when switching to an unrelated task.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.
- Use the clean code guidelines.
- Pay close attention to good cybersecurity practices and application protection.

# DenunciasAT — Contexto del proyecto para Claude Code

> Este archivo es la memoria persistente del proyecto. Actualízalo al final de cada sesión de trabajo con los cambios relevantes. Mantenerlo conciso es crítico para no desperdiciar tokens.

---

## Qué es este proyecto

Sistema de gestión de denuncias ciudadanas para el concejal de Medellín Andrés Tobón. Los ciudadanos denuncian por WhatsApp (chatbot IA), el equipo gestiona desde un dashboard web, se genera un documento oficial .docx que el abogado imprime y radica presencialmente en el Concejo.

## Stack

| Capa | Tecnología |
|------|-----------|
| Monorepo | NestJS workspace (nest-cli.json) |
| Backend | NestJS 10, Node.js 20, TypeORM, PostgreSQL 16 |
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Almacenamiento archivos | MinIO (self-hosted S3) |
| WhatsApp | Evolution API |
| IA | LLM económico (GPT-4o-mini / Claude Haiku) |
| RAG | pgvector (dentro del mismo PostgreSQL) |
| Infraestructura | Docker, Docker Compose → Kubernetes (entregas futuras) |

## Estructura del monorepo

```
DenunciasAT/
├── CLAUDE.md                  # ← este archivo, actualizar siempre
├── package.json               # único, compartido
├── nest-cli.json              # registra las apps activas
├── tsconfig.json
├── docker-compose.yml
├── .env                       # no commitear, usar .env.example
├── .env.example
├── README.md
├── apps/
│   ├── dashboard-api/         # ✅ ENTREGA 2 — activo
│   ├── chatbot-service/       # 🔜 ENTREGA 3
│   ├── whatsapp-service/      # 🔜 ENTREGA 3
│   ├── document-service/      # 🔜 ENTREGA 4
│   ├── notification-service/  # 🔜 ENTREGA 4
│   └── rag-service/           # 🔜 ENTREGA 4
├── libs/
│   ├── common/                # DTOs e interfaces compartidas
│   ├── database/              # módulo TypeORM compartido
│   └── messaging/             # abstracciones entre servicios
├── frontend/                  # Next.js 14 — dashboard
└── infrastructure/
    ├── postgres/init.sql
    └── k8s/                   # manifiestos Kubernetes (entrega final)
```

## Estado actual del proyecto

> Actualizar esta sección al terminar cada sesión.

- [ ] Fase 0 — Repo y GitHub Projects configurados
- [x] Fase 1 — Scaffold monorepo NestJS
- [x] Fase 2 — dashboard-api con auth, denuncias, Swagger
- [x] Fase 3 — Frontend Next.js con login y listado
- [x] Fase 4 — Dockerización y docker-compose
- [x] Fase 5 — DockerHub + README
- [x] Fase 6 — Dashboard completo: detalle, chat, form manual, especiales
- [x] Fase 7B — Gestión completa de usuarios

## Entidades principales (TypeORM)

### Denuncia
```typescript
id: number (PK, SERIAL)
radicado: string (ÚNICO, generado con SEQUENCE atómica — nunca manual)
nombreCiudadano: string
cedula: string
telefono: string
ubicacion: string
descripcion: string
estado: enum DenunciaEstado
dependenciaAsignada: string
esEspecial: boolean (default: false)
origenManual: boolean (default: false)
documentoRevisado: boolean (default: false)
fechaCreacion: Date
fechaActualizacion: Date
```

### Mensaje
```typescript
id: number (PK, SERIAL)
denunciaId: number (FK → denuncias, CASCADE DELETE)
contenido: text
tipo: enum TipoMensaje (TEXTO, AUDIO_TRANSCRITO, IMAGEN, PDF)
direccion: enum DireccionMensaje (ENTRANTE, SALIENTE)
timestamp: Date (auto)
```

### DenunciaEstado (enum)
```typescript
RECIBIDA = 'RECIBIDA'
EN_GESTION = 'EN_GESTION'
RADICADA = 'RADICADA'
CON_RESPUESTA = 'CON_RESPUESTA'
```

### Usuario
```typescript
id: number (PK)
nombre: string
email: string (ÚNICO)
passwordHash: string
activo: boolean (default: true)
fechaCreacion: Date
```

## Variables de entorno (.env.example)

```env
# Base de datos
DB_HOST=postgres
DB_PORT=5432
DB_USER=denunciasAt
DB_PASSWORD=denunciasAt2026
DB_NAME=denunciasAt

# Auth
JWT_SECRET=dev_secret_change_in_production
JWT_EXPIRES_IN=8h

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Reglas de negocio críticas (resumen)

1. El radicado es ÚNICO por denuncia — usar SEQUENCE de PostgreSQL, nunca lógica manual
2. Los estados solo avanzan, nunca retroceden
3. No se puede pasar a RADICADA sin documento revisado cargado
4. Solo se notifica al ciudadano en estado CON_RESPUESTA
5. Las denuncias especiales (esEspecial=true) no generan .docx ni pasan por estados
6. El chat de cada denuncia se guarda completo en base de datos

## Microservicios (referencia futura)

Para entrega 3 y 4. No implementar aún, solo mantener carpetas vacías.

| Servicio | Puerto | Responsabilidad |
|----------|--------|-----------------|
| dashboard-api | 3000 | REST API del dashboard |
| dashboard-frontend | 3001 | Next.js |
| chatbot-service | 3002 | Lógica conversacional + LLM |
| whatsapp-service | 3003 | Evolution API bridge |
| document-service | 3004 | Generación .docx y PDF merge |
| notification-service | 3005 | Notificaciones salientes WA |
| rag-service | 3006 | Búsqueda semántica pgvector |
| postgres | 5432 | Base de datos |
| minio | 9000 | Almacenamiento de archivos |

## Convenciones de código

- Idioma del código: inglés (variables, funciones, clases)
- Idioma de comentarios y commits: español
- Commits: `feat:`, `fix:`, `chore:`, `docs:` — en español descriptivo
- Ejemplo: `feat: crear módulo de denuncias con CRUD básico`
- DTOs siempre con class-validator
- Nunca exponer passwordHash en respuestas de la API
- Guards JWT aplicados globalmente en dashboard-api, excepto /auth/login y /health

## Links del proyecto

- Repo: https://github.com/SHURECITO/DenunciasAT
- GitHub Projects (backlog): https://github.com/SHURECITO/DenunciasAT/projects
- DockerHub API: shurecito/denunciasat-api
- DockerHub Frontend: shurecito/denunciasat-frontend

---

## Historial de sesiones

### Sesión 1 — 2026-04-14
- Fase 1 y Fase 2 completadas en la misma sesión.
- Scaffold monorepo NestJS 11, `nest-cli.json` monorepo, libs `common/database/messaging`, placeholders servicios futuros.
- dashboard-api implementado: auth JWT (passport-jwt), entidades `Usuario` y `Denuncia` con TypeORM, SEQUENCE PostgreSQL para radicado (`DAT-000001`).
- Endpoints: `POST /auth/login`, `POST /auth/seed`, `GET /health`, CRUD denuncias con validación de estados hacia adelante.
- Swagger en `/api` con BearerAuth; ValidationPipe global con whitelist.
- Decisión: `passwordHash` con `select: false` en la entidad — nunca se expone en queries normales.
- Decisión: `NODE_ENV !== 'production'` activa `synchronize` en TypeORM para dev; en prod usar migraciones.
- Fix: eliminar `node_modules` anidado en `dashboard-api` para evitar conflictos de tipos en monorepo.
- `infrastructure/postgres/init.sql` con `CREATE SEQUENCE IF NOT EXISTS radicado_seq`.

### Sesión 2 — 2026-04-14
- Fase 3 completada: frontend Next.js 14 con App Router, Tailwind CSS.
- Login con cookie httpOnly `token` (set por Route Handler `/api/auth/login` que proxea a NestJS; `sameSite: strict`, `secure` en prod).
- Middleware protege todas las rutas salvo `/login` y `/api/auth/login`.
- `lib/api.ts` server-side usa `cookies()` de `next/headers`; `getDenuncias`, `createDenuncia`, `patchEstadoDenuncia`.
- Dashboard (Server Component): sidebar fijo 240px, filtros por estado como `<Link>` con `searchParams`, tabla con `DenunciaEstadoBadge`, estado vacío.
- Decisión: filtrado via URL (`/?estado=RECIBIDA`) para mantener todo server-side sin SWR/React Query.
- Decisión: cookie httpOnly impide leer el JWT desde JS; el email del usuario se muestra como placeholder hasta implementar decodificación server-side en Fase 4+.

### Sesión 3 — 2026-04-15
- Fase 4 completada: Dockerización multi-stage (deps/build/production) para API y frontend.
- Fix crítico: `tsconfig.app.json` necesita `rootDir: "../../"` — sin esto TypeScript anida salida en `dist/apps/.../apps/.../src/main.js`.
- `next.config.mjs`: `output: 'standalone'` para imagen mínima Next.js.
- `NODE_ENV=development` en docker-compose para habilitar `synchronize` de TypeORM (en prod usar migraciones).
- Fase 5 completada: README.md completo, imágenes subidas a DockerHub (`shurecito/denunciasat-api`, `shurecito/denunciasat-frontend`).

### Sesión 5 — 2026-04-15
- Fase 7B completada: gestión completa de usuarios.
- Backend: UsuariosModule (GET/POST/PATCH /usuarios, PATCH /toggle-activo); GET /auth/me devuelve usuario autenticado.
- Seguridad: POST /usuarios re-fetcha tras save para que select:false en passwordHash aplique correctamente; 409 en email duplicado; self-deactivation bloqueada con 400.
- Frontend: /usuarios con tabla, badges, modales crear/editar, toast de confirmación; botón toggle deshabilitado para usuario con sesión activa; Sidebar "Usuarios" activado.
- Patrón: /api/auth/me Route Handler expone usuario actual a client components sin tocar el JWT directamente.

### Sesión 4 — 2026-04-15
- Fase 6 completada: dashboard con todas las funcionalidades.
- Backend: campos `origenManual` y `documentoRevisado` en Denuncia; entidad `Mensaje` con tabla `mensajes`; módulo MensajesModule.
- Nuevos endpoints: POST /denuncias/manual, GET /denuncias/especiales, GET+POST /mensajes/:denunciaId, PATCH /denuncias/:id.
- Validación: transición a RADICADA bloqueada si `documentoRevisado` es false.
- Frontend: Sidebar.tsx compartido; página detalle `/denuncias/[id]` con DenunciaDetalle (client) + ChatPanel deslizante; `/denuncias/nueva` con form y modal radicado; `/denuncias/especiales`.
- Route Handlers proxy en `/api/denuncias/*` para exponer acciones mutantes a client components sin exponer JWT.

---

## Próximas entregas

| Entrega | Servicios | Estado |
|---------|-----------|--------|
| Entrega 3 | `chatbot-service` + `whatsapp-service` + Evolution API | 🔜 |
| Entrega 4 | `document-service` + `notification-service` + `rag-service` (pgvector) | 🔜 |
| Entrega final | Migración completa a Kubernetes | 🔜 |

---

> INSTRUCCIÓN PARA CLAUDE CODE: Al final de cada sesión de trabajo, actualiza la sección "Estado actual del proyecto" marcando las fases completadas, agrega una entrada en "Historial de sesiones" con un resumen de 3-5 líneas de lo que se hizo, y actualiza cualquier decisión técnica nueva que se haya tomado. Mantén el archivo bajo 200 líneas.
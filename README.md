# DenunciasAT

Sistema de gestión de denuncias ciudadanas para el despacho del concejal de Medellín **Andrés Tobón**. Los ciudadanos reportan problemas a través de un chatbot de WhatsApp con inteligencia artificial; el equipo del concejal gestiona, prioriza y da seguimiento desde un dashboard web seguro.

El flujo completo incluye: recepción automática de la denuncia via WhatsApp → asignación a dependencia → generación de documento oficial `.docx` → radicación presencial en el Concejo de Medellín con número de radicado único (`DAT-XXXXXX`).

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Monorepo | NestJS workspace (`nest-cli.json`) |
| Backend | NestJS 11, Node.js 20, TypeORM |
| Base de datos | PostgreSQL 16 |
| Documentación API | Swagger / OpenAPI 3 |
| Frontend | Next.js 14 (App Router) |
| Lenguaje | TypeScript |
| Estilos | Tailwind CSS |
| Contenedores | Docker, Docker Compose |
| Infraestructura futura | Kubernetes |

---

## Estructura del monorepo

```
DenunciasAT/
├── apps/
│   ├── dashboard-api/         # ✅ API REST — NestJS 11, puerto 3000
│   ├── chatbot-service/       # 🔜 Entrega 3 — Lógica conversacional + LLM
│   ├── whatsapp-service/      # 🔜 Entrega 3 — Evolution API bridge
│   ├── document-service/      # 🔜 Entrega 4 — Generación .docx
│   ├── notification-service/  # 🔜 Entrega 4 — Notificaciones WhatsApp
│   └── rag-service/           # 🔜 Entrega 4 — Búsqueda semántica pgvector
├── libs/
│   ├── common/                # DTOs e interfaces compartidas
│   ├── database/              # Módulo TypeORM global
│   └── messaging/             # Abstracciones entre microservicios
├── frontend/                  # ✅ Dashboard — Next.js 14, puerto 3001
├── infrastructure/
│   ├── postgres/init.sql      # SEQUENCE radicado_seq
│   └── k8s/                   # Manifiestos Kubernetes (entrega final)
├── docker-compose.yml
├── .env.example
└── nest-cli.json
```

---

## Requisitos previos

- **Docker Desktop** instalado y corriendo — no se necesita nada más

---

## Cómo ejecutar con Docker Compose

```bash
# 1. Clonar el repositorio
git clone https://github.com/SHURECITO/DenunciasAT.git
cd DenunciasAT

# 2. Copiar las variables de entorno
cp .env.example .env

# 3. Levantar los 3 servicios (primera vez compila las imágenes)
docker compose up --build

# 4. Crear el usuario administrador inicial (solo la primera vez)
curl -X POST http://localhost:3000/auth/seed

# 5. Abrir el dashboard
# http://localhost:3001
```

> **Credenciales por defecto:**
> - Email: `admin@denunciasat.co`
> - Contraseña: `Admin1234!`

---

## URLs disponibles

| Servicio | URL | Descripción |
|---------|-----|-------------|
| **Frontend** | http://localhost:3001 | Dashboard de gestión |
| **API REST** | http://localhost:3000 | Backend NestJS |
| **Swagger UI** | http://localhost:3000/api | Documentación interactiva |

---

## Variables de entorno

Copia `.env.example` a `.env` y ajusta los valores según tu entorno.

| Variable | Valor por defecto | Descripción |
|----------|------------------|-------------|
| `DB_HOST` | `postgres` | Host de PostgreSQL (nombre del servicio en Docker) |
| `DB_PORT` | `5432` | Puerto de PostgreSQL |
| `DB_USER` | `denunciasAt` | Usuario de la base de datos |
| `DB_PASSWORD` | `denunciasAt2026` | Contraseña de la base de datos |
| `DB_NAME` | `denunciasAt` | Nombre de la base de datos |
| `JWT_SECRET` | `dev_secret_change_in_production` | Secreto para firmar JWT — **cambiar en producción** |
| `JWT_EXPIRES_IN` | `8h` | Duración del token JWT |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000` | URL base del backend (dev local) |

---

## Imágenes en DockerHub

[![Docker Hub](https://img.shields.io/badge/Docker%20Hub-shurecito%2Fdenunciasat--api-blue?logo=docker)](https://hub.docker.com/r/shurecito/denunciasat-api)
[![Docker Hub](https://img.shields.io/badge/Docker%20Hub-shurecito%2Fdenunciasat--frontend-blue?logo=docker)](https://hub.docker.com/r/shurecito/denunciasat-frontend)

```bash
# Usar las imágenes publicadas sin compilar
docker pull shurecito/denunciasat-api
docker pull shurecito/denunciasat-frontend
```

---

## Historias de usuario y backlog

[GitHub Projects — DenunciasAT](https://github.com/SHURECITO/DenunciasAT/projects)

---

## Entregas futuras

| Entrega | Servicios | Descripción |
|---------|-----------|-------------|
| **Entrega 3** | `chatbot-service`, `whatsapp-service` | Chatbot IA en WhatsApp via Evolution API |
| **Entrega 4** | `document-service`, `notification-service`, `rag-service` | Generación .docx, notificaciones y búsqueda semántica |
| **Entrega final** | Todos los servicios | Migración a Kubernetes |

---

## Licencia

UNLICENSED — Uso exclusivo para el despacho del concejal Andrés Tobón.

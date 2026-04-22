#!/bin/bash
# ============================================================
# DenunciasAT — Script de deploy manual en VM GCP
#
# Uso:
#   ./infrastructure/scripts/deploy.sh [TAG]
#
# Variables requeridas en .env:
#   GCP_PROJECT_ID, GCP_REGION, IMAGE_TAG (o pasar como arg)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Cargar .env si existe
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -o allexport
  source "${PROJECT_ROOT}/.env"
  set +o allexport
fi

# TAG: argumento CLI > var de entorno > SHA git corto
IMAGE_TAG="${1:-${IMAGE_TAG:-$(git -C "${PROJECT_ROOT}" rev-parse --short HEAD 2>/dev/null || echo 'latest')}}"
GCP_PROJECT_ID="${GCP_PROJECT_ID:?ERROR: GCP_PROJECT_ID no está definido}"
GCP_REGION="${GCP_REGION:-us-central1}"

echo "=========================================="
echo "  DenunciasAT — Deploy"
echo "  Proyecto : ${GCP_PROJECT_ID}"
echo "  Región   : ${GCP_REGION}"
echo "  Tag      : ${IMAGE_TAG}"
echo "=========================================="

cd "${PROJECT_ROOT}"

# Autenticar Docker con Artifact Registry
gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet

# Exportar variables para docker compose
export IMAGE_TAG GCP_PROJECT_ID GCP_REGION

# Pull de imágenes actualizadas
echo "Descargando imágenes..."
docker compose -f docker-compose.prod.yml pull

# Levantar servicios sin tiempo de inactividad (recrear solo los que cambiaron)
echo "Levantando servicios..."
docker compose -f docker-compose.prod.yml up -d --remove-orphans

# Esperar a que dashboard-api responda
echo "Esperando arranque de API..."
MAX=12
for i in $(seq 1 $MAX); do
  HTTP=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:8741/health 2>/dev/null || echo "000")
  if [ "$HTTP" = "200" ]; then
    echo "API responde OK (intento ${i})"
    break
  fi
  if [ "$i" -eq "$MAX" ]; then
    echo "ERROR: API no responde tras ${MAX} intentos"
    docker compose -f docker-compose.prod.yml logs dashboard-api --tail=50
    exit 1
  fi
  echo "Intento ${i}/${MAX} — HTTP ${HTTP}, esperando 5s..."
  sleep 5
done

# Estado final
echo ""
echo "Estado de servicios:"
docker compose -f docker-compose.prod.yml ps

# Limpiar imágenes antiguas (más de 3 días)
docker image prune -f --filter "until=72h" > /dev/null

echo ""
echo "Deploy completado correctamente — tag: ${IMAGE_TAG}"

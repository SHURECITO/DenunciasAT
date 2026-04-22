#!/bin/bash
# ============================================================
# DenunciasAT — Crear secretos en GCP Secret Manager
#
# Ejecutar UNA VEZ antes del primer deploy para registrar
# todos los secretos en Secret Manager.
#
# Prerequisitos:
#   - gcloud CLI autenticado con permisos secretmanager.admin
#   - .env con los valores reales completos
#   - GCP_PROJECT_ID definido
#
# Uso:
#   GCP_PROJECT_ID=mi-proyecto ./infrastructure/scripts/setup-secrets.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

GCP_PROJECT_ID="${GCP_PROJECT_ID:?ERROR: define GCP_PROJECT_ID}"

# Cargar .env
if [ ! -f "${PROJECT_ROOT}/.env" ]; then
  echo "ERROR: No se encontró .env en ${PROJECT_ROOT}"
  exit 1
fi
set -o allexport
source "${PROJECT_ROOT}/.env"
set +o allexport

create_secret() {
  local NAME="$1"
  local VALUE="$2"

  if [ -z "$VALUE" ]; then
    echo "ADVERTENCIA: ${NAME} está vacío — omitido"
    return
  fi

  if gcloud secrets describe "${NAME}" --project="${GCP_PROJECT_ID}" &>/dev/null; then
    echo "Actualizando secreto: ${NAME}"
    echo -n "${VALUE}" | gcloud secrets versions add "${NAME}" \
      --project="${GCP_PROJECT_ID}" --data-file=-
  else
    echo "Creando secreto: ${NAME}"
    echo -n "${VALUE}" | gcloud secrets create "${NAME}" \
      --project="${GCP_PROJECT_ID}" --data-file=- \
      --replication-policy="automatic"
  fi
}

echo "Registrando secretos en GCP Secret Manager (proyecto: ${GCP_PROJECT_ID})..."

create_secret "denunciasat-db-password"              "${DB_PASSWORD}"
create_secret "denunciasat-jwt-secret"               "${JWT_SECRET}"
create_secret "denunciasat-minio-root-password"      "${MINIO_ROOT_PASSWORD}"
create_secret "denunciasat-minio-secret-key"         "${MINIO_SECRET_KEY}"
create_secret "denunciasat-evolution-api-key"        "${EVOLUTION_API_KEY}"
create_secret "denunciasat-dashboard-internal-key"   "${DASHBOARD_API_INTERNAL_KEY}"
create_secret "denunciasat-chatbot-internal-key"     "${CHATBOT_API_INTERNAL_KEY}"
create_secret "denunciasat-document-internal-key"    "${DOCUMENT_API_INTERNAL_KEY}"
create_secret "denunciasat-dashboard-to-document"    "${DASHBOARD_TO_DOCUMENT_KEY}"
create_secret "denunciasat-whatsapp-to-chatbot"      "${WHATSAPP_TO_CHATBOT_KEY}"
create_secret "denunciasat-whatsapp-qr-key"          "${WHATSAPP_QR_INTERNAL_KEY}"
create_secret "denunciasat-gemini-api-key"           "${GEMINI_API_KEY}"
create_secret "denunciasat-seed-admin-password"      "${SEED_ADMIN_PASSWORD:-}"
create_secret "denunciasat-webhook-hmac-secret"      "${WHATSAPP_WEBHOOK_HMAC_SECRET:-}"

echo ""
echo "Secretos registrados correctamente."
echo ""
echo "Para leerlos en la VM, el service account necesita rol: roles/secretmanager.secretAccessor"
echo "Ejemplo de lectura en startup script:"
echo "  DB_PASSWORD=\$(gcloud secrets versions access latest --secret=denunciasat-db-password)"

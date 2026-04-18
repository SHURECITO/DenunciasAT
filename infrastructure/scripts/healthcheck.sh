#!/bin/bash
# ============================================================
# DenunciasAT — Healthcheck con alerta por Telegram
#
# Cron cada 5 minutos:
# */5 * * * * /opt/denunciasat/infrastructure/scripts/healthcheck.sh >> /var/log/denunciasat-health.log 2>&1
#
# Variables de entorno:
#   API_URL          — URL del healthcheck (default: http://localhost:8741)
#   TELEGRAM_TOKEN   — Token del bot de Telegram (opcional)
#   TELEGRAM_CHAT_ID — Chat ID de destino (opcional)
# ============================================================
set -euo pipefail

API_URL="${API_URL:-http://localhost:8741}"
TELEGRAM_TOKEN="${TELEGRAM_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# Verificar el endpoint de salud
HTTP_CODE=$(curl -s -o /tmp/health_response.json -w "%{http_code}" --max-time 10 "$API_URL/health" || echo "000")
DB_STATUS=$(grep -o '"db":"[^"]*"' /tmp/health_response.json 2>/dev/null | cut -d'"' -f4 || echo "unreachable")

if [ "$HTTP_CODE" != "200" ] || [ "$DB_STATUS" != "ok" ]; then
  MSG="🚨 DenunciasAT ALERTA — HTTP ${HTTP_CODE} / DB ${DB_STATUS} — $(hostname) — $(date '+%Y-%m-%d %H:%M:%S')"
  echo "$MSG"

  # Enviar alerta por Telegram si está configurado
  if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      --data-urlencode "text=${MSG}" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "parse_mode=HTML" \
      > /dev/null
  fi
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] OK — HTTP ${HTTP_CODE} / DB ${DB_STATUS}"

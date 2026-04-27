#!/bin/bash
# Script de prueba del entorno local de producción
# Uso: ./infrastructure/scripts/test-local-prod.sh
set -e

COMPOSE_FILE="docker-compose.local-prod.yml"

echo "=== Limpiando entorno anterior ==="
docker compose -f "$COMPOSE_FILE" down --remove-orphans -v 2>/dev/null || true

echo "=== Construyendo e iniciando servicios ==="
docker compose -f "$COMPOSE_FILE" up --build -d

echo "=== Esperando 20s para que los servicios arranquen ==="
sleep 20

echo "=== Estado de los contenedores ==="
docker compose -f "$COMPOSE_FILE" ps

echo "=== Logs dashboard-api (últimas 100 líneas) ==="
docker compose -f "$COMPOSE_FILE" logs --tail=100 dashboard-api

echo ""
echo "Para ver logs en tiempo real:"
echo "docker compose -f $COMPOSE_FILE logs -f dashboard-api"

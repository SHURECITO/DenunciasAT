#!/bin/bash
# ============================================================
# DenunciasAT — Backup automático de PostgreSQL
#
# Uso manual: ./backup.sh
# Cron diario (3AM): 0 3 * * * /opt/denunciasat/infrastructure/scripts/backup.sh >> /var/log/denunciasat-backup.log 2>&1
#
# Variables de entorno esperadas (o valores por defecto):
#   BACKUP_DIR    — directorio donde guardar los backups (default: /backups/denunciasat)
#   POSTGRES_CONTAINER — nombre del contenedor Postgres (default: denunciasat-postgres-1)
#   DB_USER       — usuario de la base de datos
#   DB_NAME       — nombre de la base de datos
#   RETENTION_DAYS — días que se conservan los backups (default: 30)
# ============================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups/denunciasat}"
CONTAINER="${POSTGRES_CONTAINER:-denunciasat-postgres-1}"
DB_USER="${DB_USER:-denunciasAt}"
DB_NAME="${DB_NAME:-denunciasAt}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/dump_${TIMESTAMP}.sql.gz"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando backup de $DB_NAME..."

mkdir -p "$BACKUP_DIR"

# Crear dump comprimido
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$FILE"

SIZE=$(du -sh "$FILE" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup creado: $FILE ($SIZE)"

# Eliminar backups más viejos que RETENTION_DAYS días
DELETED=$(find "$BACKUP_DIR" -name "dump_*.sql.gz" -mtime +${RETENTION_DAYS} -print -delete | wc -l)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backups eliminados por antigüedad: $DELETED"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup completado."

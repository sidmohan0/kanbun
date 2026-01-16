#!/bin/bash
# Backup kanbun database to Google Drive
# Run daily via cron: 0 2 * * * /Users/sid/projects/kanbun/scripts/backup_to_gdrive.sh

set -e

# Configuration
DB_PATH="/Users/sid/projects/kanbun/data/kanbun.db"
BACKUP_DIR="/Users/sid/projects/kanbun/data/backups"
GDRIVE_REMOTE="gdrive:kanbun-backups"
KEEP_LOCAL_DAYS=7
KEEP_CLOUD_DAYS=30

# Create local backup directory if needed
mkdir -p "$BACKUP_DIR"

# Create timestamped backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="kanbun_${TIMESTAMP}.db"

echo "[$(date)] Starting backup..."

# Copy database to backup (with write lock)
cp "$DB_PATH" "$BACKUP_DIR/$BACKUP_FILE"
echo "[$(date)] Local backup created: $BACKUP_FILE"

# Upload to Google Drive
if /opt/homebrew/bin/rclone copy "$BACKUP_DIR/$BACKUP_FILE" "$GDRIVE_REMOTE/" --log-level INFO; then
    echo "[$(date)] Uploaded to Google Drive: $GDRIVE_REMOTE/$BACKUP_FILE"
else
    echo "[$(date)] ERROR: Failed to upload to Google Drive"
    exit 1
fi

# Clean up old local backups (keep last 7 days)
find "$BACKUP_DIR" -name "kanbun_*.db" -mtime +$KEEP_LOCAL_DAYS -delete 2>/dev/null || true
echo "[$(date)] Cleaned local backups older than $KEEP_LOCAL_DAYS days"

# Clean up old cloud backups (keep last 30 days)
/opt/homebrew/bin/rclone delete "$GDRIVE_REMOTE/" --min-age ${KEEP_CLOUD_DAYS}d 2>/dev/null || true
echo "[$(date)] Cleaned cloud backups older than $KEEP_CLOUD_DAYS days"

echo "[$(date)] Backup complete!"

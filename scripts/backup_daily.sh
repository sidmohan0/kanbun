#!/bin/bash
# Wrapper script that ensures backup runs once per day
# Works with launchd to handle sleep/wake cycles

LOCK_FILE="/Users/sid/projects/kanbun/data/backups/.last_backup_date"
TODAY=$(date +%Y%m%d)

# Check if we already backed up today
if [ -f "$LOCK_FILE" ]; then
    LAST_BACKUP=$(cat "$LOCK_FILE")
    if [ "$LAST_BACKUP" = "$TODAY" ]; then
        echo "[$(date)] Backup already completed today, skipping."
        exit 0
    fi
fi

# Run the backup
/Users/sid/projects/kanbun/scripts/backup_to_gdrive.sh

# Record successful backup
if [ $? -eq 0 ]; then
    echo "$TODAY" > "$LOCK_FILE"
fi

#!/bin/zsh
# Ежедневный бэкап Бортжурнала: база Postgres (pg_dump, сжатый формат) и папка data/ (обложки, состояние Obsidian, старая версия).
# Копии — в ~/Library/Application Support/Bortjournal/backups и в iCloud Drive/Bortjournal backups, хранится 14 последних.
# Восстановить базу: pg_restore --clean --if-exists -d bortjournal <файл .dump>
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/bin:/bin
ROOT=${0:A:h:h}
DB=${BACKUP_DB:-bortjournal}
LOCAL="$HOME/Library/Application Support/Bortjournal/backups"
CLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Bortjournal backups"
KEEP=14
stamp=$(date +%Y-%m-%d_%H%M)
mkdir -p "$LOCAL"
pg_dump -Fc -d "$DB" -f "$LOCAL/db-$stamp.dump.part" && mv "$LOCAL/db-$stamp.dump.part" "$LOCAL/db-$stamp.dump"
tar -czf "$LOCAL/data-$stamp.tgz.part" -C "$ROOT" data && mv "$LOCAL/data-$stamp.tgz.part" "$LOCAL/data-$stamp.tgz"
# проверка: дамп читается и в нём есть таблица пользователей
pg_restore -l "$LOCAL/db-$stamp.dump" | grep -q "TABLE public users" || { echo "бэкап $stamp не читается" >&2; exit 1; }
prune() { ls -1t "$1"/$2-*(N) 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do rm -f "$f"; done; }
prune "$LOCAL" db; prune "$LOCAL" data
if [[ -d "${CLOUD:h}" ]]; then
  mkdir -p "$CLOUD"
  cp "$LOCAL/db-$stamp.dump" "$LOCAL/data-$stamp.tgz" "$CLOUD/"
  prune "$CLOUD" db; prune "$CLOUD" data
fi
echo "$(date '+%F %T') бэкап $stamp: база $(du -h "$LOCAL/db-$stamp.dump" | cut -f1), data $(du -h "$LOCAL/data-$stamp.tgz" | cut -f1)"

#!/bin/zsh
# Копия бэкапов Lumi с сервера на этот Mac (и в iCloud): дампы базы и архивы data, которые сервер делает раз в сутки.
# Запускается LaunchAgent'ом com.lumi.server-backups каждый день; хранит 30 дней.
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/bin:/bin
LOCAL="$HOME/Library/Application Support/Lumi/server-backups"
CLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Lumi server backups"
mkdir -p "$LOCAL"
rsync -a --partial -e "ssh -i $HOME/.ssh/lumi_hetzner -o IdentitiesOnly=yes -o BatchMode=yes" \
  "root@${LUMI_SERVER:-195.201.164.240}:/opt/lumi/deploy/backups/" "$LOCAL/"
find "$LOCAL" -type f -mtime +30 -delete
if [ -d "$(dirname "$CLOUD")" ]; then mkdir -p "$CLOUD"; rsync -a --delete "$LOCAL/" "$CLOUD/"; fi
echo "$(date '+%F %T') копия с сервера: $(ls "$LOCAL" | wc -l | tr -d ' ') файлов"

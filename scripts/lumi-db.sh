#!/bin/zsh
# Админка базы Lumi (pgweb) с сервера: SSH-туннель на localhost:4011 и браузер. Ctrl+C — закрыть.
# Из интернета pgweb недоступен: на сервере он слушает только 127.0.0.1.
set -euo pipefail
SSH=(ssh -i "$HOME/.ssh/lumi_hetzner" -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes root@${LUMI_SERVER:-195.201.164.240})
"${SSH[@]}" 'cd /opt/lumi/deploy && docker compose -f docker-compose.shared.yml --profile dbadmin up -d --no-deps dbadmin >/dev/null 2>&1; echo "pgweb запущен"'
( sleep 2; open http://localhost:4011 ) &
echo "Админка базы: http://localhost:4011 — Ctrl+C, чтобы закрыть"
"${SSH[@]}" -N -L 4011:127.0.0.1:4011

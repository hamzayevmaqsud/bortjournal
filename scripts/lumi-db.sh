#!/bin/zsh
# Админка базы Lumi (pgweb) с сервера: SSH-туннель на localhost:4011 и браузер. Ctrl+C — закрыть.
# Из интернета pgweb недоступен: на сервере он слушает только 127.0.0.1.
set -euo pipefail
# адрес сервера не хранится в репозитории: LUMI_SERVER или файл ~/.lumi-server (например root@1.2.3.4)
SERVER=${LUMI_SERVER:-$(cat "$HOME/.lumi-server" 2>/dev/null)}
[ -n "$SERVER" ] || { echo "Укажи сервер: echo root@<ip> > ~/.lumi-server"; exit 1; }
SSH=(ssh -i "$HOME/.ssh/lumi_hetzner" -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes "$SERVER")
"${SSH[@]}" 'cd /opt/lumi/deploy && docker compose -f docker-compose.shared.yml --profile dbadmin up -d --no-deps dbadmin >/dev/null 2>&1; echo "pgweb запущен"'
( sleep 2; open http://localhost:4011 ) &
echo "Админка базы: http://localhost:4011 — Ctrl+C, чтобы закрыть"
"${SSH[@]}" -N -L 4011:127.0.0.1:4011

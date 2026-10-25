#!/bin/zsh
# Обновить Lumi на сервере: git pull, пересборка и перезапуск только контейнеров Lumi (app, worker).
# Образ помечается коротким sha коммита, прошлый остаётся как lumi-app:prev — откат в docs/deploy.md.
# Не поднялся (healthcheck) или /health снаружи не 200 — выходим с ошибкой.
# Сервер общий — рядом работает TaxiPay: до и после сравниваем его контейнеры; если что-то изменилось — громко говорим.
# Запуск с Mac: scripts/server-deploy.sh
set -euo pipefail
# адрес сервера не хранится в репозитории: LUMI_SERVER или файл ~/.lumi-server (например root@1.2.3.4)
SERVER=${LUMI_SERVER:-$(cat "$HOME/.lumi-server" 2>/dev/null)}
[ -n "$SERVER" ] || { echo "Укажи сервер: echo root@<ip> > ~/.lumi-server"; exit 1; }
SSH=(ssh -i "$HOME/.ssh/lumi_hetzner" -o IdentitiesOnly=yes -o BatchMode=yes "$SERVER")
"${SSH[@]}" 'set -e
snap() { docker ps -a --format "{{.Names}} {{.Status}}" | grep -v "^lumi-" | sed -E "s/Up [^()]*/Up/" | sort; }
snap > /tmp/lumi-neighbours-before.txt
cd /opt/lumi && git pull -q --ff-only && git log --oneline -1
SHA=$(git rev-parse --short HEAD)
# текущий образ — в запас для отката
if docker image inspect lumi-app >/dev/null 2>&1; then docker tag lumi-app lumi-app:prev; fi
cd deploy && docker compose -f docker-compose.shared.yml build app 2>&1 | tail -2
docker tag lumi-app "lumi-app:$SHA"
docker compose -f docker-compose.shared.yml up -d --no-deps app worker 2>&1 | tail -3
s=starting
for i in $(seq 1 60); do s=$(docker inspect -f "{{.State.Health.Status}}" lumi-app-1); [ "$s" = healthy ] && break; sleep 2; done
echo "lumi-app ($SHA): $s"
snap > /tmp/lumi-neighbours-after.txt
if diff -q /tmp/lumi-neighbours-before.txt /tmp/lumi-neighbours-after.txt >/dev/null; then echo "соседи (TaxiPay): без изменений"; else echo "!!! соседи изменились:"; diff /tmp/lumi-neighbours-before.txt /tmp/lumi-neighbours-after.txt; fi
if [ "$s" != healthy ]; then echo "!!! lumi-app не поднялся. Откат: docker tag lumi-app:prev lumi-app && docker compose -f docker-compose.shared.yml up -d --no-deps app worker"; exit 1; fi'
code=$(curl -s -m 20 -o /dev/null -w "%{http_code}" https://lumi-journal.com/health || true)
echo "https://lumi-journal.com/health → $code"
[ "$code" = 200 ] || { echo "!!! /health снаружи не 200 — проверь туннель и логи (docs/deploy.md, «Откат»)"; exit 1; }

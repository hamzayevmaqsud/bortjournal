#!/bin/bash
# Обновить Lumi на Mac и перенести данные с другого компьютера (папка Lumi-transfer).
#   cd ~/путь/к/bortjournal && bash ~/Downloads/Lumi-transfer/mac-import.sh
# Что делает: git pull → npm install → миграции → бэкап базы Mac в ~/lumi-mac-backup-….json.gz →
# замена записей данными из lumi-transfer.json.gz → обложки, конспекты, ключи push → сборка фронта → перезапуск.
set -euo pipefail

PACK="$(cd "$(dirname "$0")" && pwd)"            # папка переноса: рядом со скриптом
REPO="${1:-$PWD}"
cd "$REPO"
[ -f package.json ] && grep -q '"name": "bortjournal' package.json || { echo "Запусти из папки репозитория bortjournal (или передай путь первым аргументом)."; exit 1; }
[ -f "$PACK/lumi-transfer.json.gz" ] || { echo "Нет $PACK/lumi-transfer.json.gz"; exit 1; }
[ -f .env ] || { echo "Нет .env в $REPO — без него не найти базу."; exit 1; }

echo "1/7 Код с GitHub"
git pull --ff-only

echo "2/7 Зависимости"
npm install

echo "3/7 Миграции базы"
npm run db:migrate

STAMP="$(date +%Y-%m-%d-%H%M)"
echo "4/7 Бэкап базы Mac → ~/lumi-mac-backup-$STAMP.json.gz"
(cd apps/api && npx tsx scripts/db-transfer.ts dump "$HOME/lumi-mac-backup-$STAMP.json.gz")

echo "5/7 Записи с Windows"
(cd apps/api && npx tsx scripts/db-transfer.ts restore "$PACK/lumi-transfer.json.gz" --replace)

echo "6/7 Обложки, конспекты, ключи push"
mkdir -p data
[ -f data/vapid.json ] && cp data/vapid.json "data/vapid.json.mac-$STAMP"
[ -d data/study-files ] && mv data/study-files "data/study-files.mac-$STAMP"
[ -d data/covers-next ] && mv data/covers-next "data/covers-next.mac-$STAMP"
cp -R "$PACK/data/." data/

echo "7/7 Сборка и перезапуск"
(cd apps/web && npx vite build)
UID_="$(id -u)"
launchctl kickstart -k "gui/$UID_/com.bortjournal.next" 2>/dev/null && echo "  сервер перезапущен" || echo "  сервер com.bortjournal.next не найден — запусти вручную: npm start"
# воркер (фото еды, календарь, уборка демо): создать LaunchAgent, если его ещё нет
PL="$HOME/Library/LaunchAgents/com.bortjournal.worker.plist"
if [ ! -f "$PL" ]; then
  NPM="$(command -v npm)"
  cat > "$PL" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.bortjournal.worker</string>
  <key>ProgramArguments</key><array><string>$NPM</string><string>run</string><string>worker</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NPM"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/bortjournal-worker.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/bortjournal-worker.log</string>
</dict></plist>
EOF
  launchctl bootstrap "gui/$UID_" "$PL" && echo "  воркер добавлен в автозапуск"
else
  launchctl kickstart -k "gui/$UID_/com.bortjournal.worker" && echo "  воркер перезапущен"
fi

echo
echo "Готово. Открой http://localhost:4000 — вход тем же логином и паролем, что на Windows."
echo "Бэкап прежней базы Mac: ~/lumi-mac-backup-$STAMP.json.gz"

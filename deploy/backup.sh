#!/bin/sh
# Бэкап раз в сутки: база (pg_dump -Fc) и папка data (ключи VAPID и интеграций, обложки, файлы конспектов).
# Хранятся KEEP_DAYS дней в deploy/backups. Копию за пределы сервера делай отдельно (см. docs/deploy.md).
set -eu
mkdir -p /backups
while true; do
  stamp=$(date +%Y%m%d-%H%M)
  if pg_dump -Fc -f "/backups/lumi-$stamp.dump.part"; then
    mv "/backups/lumi-$stamp.dump.part" "/backups/lumi-$stamp.dump"
    tar -czf "/backups/data-$stamp.tgz" -C /data . 2>/dev/null || echo "data: не получилось упаковать"
    echo "$(date) бэкап готов: lumi-$stamp.dump"
  else
    rm -f "/backups/lumi-$stamp.dump.part"
    echo "$(date) ОШИБКА бэкапа базы"
  fi
  find /backups -name 'lumi-*.dump' -mtime +"${KEEP_DAYS:-14}" -delete
  find /backups -name 'data-*.tgz' -mtime +"${KEEP_DAYS:-14}" -delete
  sleep 86400
done

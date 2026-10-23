#!/bin/zsh
# Проверка, что lumi-journal.com жив: раз в 5 минут (LaunchAgent com.lumi.site-watch).
# Две неудачи подряд — уведомление на Mac; когда сайт снова отвечает — тоже уведомление.
set -uo pipefail
STATE="$HOME/Library/Application Support/Lumi/site-watch.state"
mkdir -p "${STATE:h}"
fails=$(cat "$STATE" 2>/dev/null || echo 0)
code=$(curl -s -m 20 -o /dev/null -w "%{http_code}" https://lumi-journal.com/health)
note() { osascript -e "display notification \"$1\" with title \"Lumi\" sound name \"Basso\""; }
if [ "$code" = 200 ]; then
  [ "$fails" -ge 2 ] && note "Сайт снова работает"
  echo 0 > "$STATE"
else
  fails=$((fails + 1)); echo $fails > "$STATE"
  [ "$fails" -eq 2 ] && note "lumi-journal.com не отвечает (код $code)"
  echo "$(date '+%F %T') ошибка: $code"
fi

# Выкладка Lumi в интернет

Всё запускается одной командой Docker Compose на любом Linux-сервере: Postgres, API с вебом, воркер, Caddy с https и ежедневный бэкап. Файлы — в папке `deploy/`.

## Что понадобится

- **Сервер.** Linux с Docker, 2 ГБ памяти и 20 ГБ диска хватит. Например, Hetzner CX22 или любой VPS с Ubuntu 24.04.
- **Домен.** A-запись DNS домена (или поддомена, например `lumi.example.com`) указывает на IP сервера.
- **Ключи** — по желанию, без них разделы просто выключены:
  - Gemini — фото еды и вопросы по конспектам;
  - Google OAuth — вход через Google и Google Календарь.

## Первый запуск

```sh
# на сервере
curl -fsSL https://get.docker.com | sh
git clone https://github.com/hamzayevmaqsud/bortjournal.git lumi && cd lumi/deploy
cp .env.example .env && nano .env        # DOMAIN, PUBLIC_URL, ALLOWED_HOSTS, POSTGRES_PASSWORD — обязательно
docker compose up -d --build
docker compose logs -f app               # «Server listening» — готово
```

Caddy сам получит сертификат, как только DNS начнёт указывать на сервер. Сайт откроется по `https://<домен>`, телефонная версия — по `https://<домен>/m`.

## Google: вход и календарь

1. Google Cloud Console → APIs & Services → **Credentials** → Create credentials → **OAuth client ID** → Web application.
2. Authorized redirect URIs:
   - `https://<домен>/api/auth/google/callback`
   - `https://<домен>/api/integrations/google-calendar/callback`
3. **Library** → включить **Google Calendar API**.
4. **OAuth consent screen**: пока приложение в режиме Testing, добавь свою почту в Test users. Для всех пользователей календарю нужна проверка Google: права календаря «чувствительные».
5. Впиши `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` в `deploy/.env`, затем `docker compose up -d`.

## Перенос данных с домашнего компьютера

У встроенного Postgres на Windows нет `pg_dump`, поэтому база переносится своим скриптом. Обе базы должны быть на одной версии схемы: сначала обнови код на обеих сторонах.

```sh
# 1. дома (Windows, Git Bash), из apps/api — выгрузка всех таблиц в файл
DATABASE_URL="postgres://postgres:<пароль>@127.0.0.1:5432/bortjournal" npx tsx scripts/db-transfer.ts dump lumi-transfer.json.gz

# 2. скопировать на сервер файл и папку data (ключи уведомлений и интеграций, обложки, файлы конспектов)
scp lumi-transfer.json.gz server:lumi/deploy/backups/
scp -r ../../data server:lumi/deploy/backups/data

# 3. на сервере: остановить приложение, положить data в том, загрузить базу (только в пустую базу)
cd lumi/deploy
docker compose stop app worker
docker compose run --rm -v "$PWD/backups:/backups" app sh -c "cp -r /backups/data/. /app/data/ && npx tsx src/db/migrate.ts && npx tsx scripts/db-transfer.ts restore /backups/lumi-transfer.json.gz"
docker compose up -d
```

Старые сессии переносятся вместе с базой, поэтому входить заново не придётся. Подписки на уведомления продолжат работать, если перенесена `data/vapid.json`. Уведомления придут с нового адреса только после того, как телефон откроет сайт по домену и заново включит напоминания.

## Бэкапы

- Сервис `backup` раз в сутки кладёт в `deploy/backups/` дамп базы `lumi-*.dump` и архив `data-*.tgz`. Хранит `BACKUP_KEEP_DAYS` дней.
- Копию за пределами сервера делай сам, например раз в сутки через `rclone` в облако или `scp` домой. Бэкап на том же диске не спасёт при потере сервера.
- **Ключ интеграций** (`INTEGRATIONS_KEY` или `data/integrations.key`) нужен, чтобы расшифровать токены Google. Без него после восстановления календарь придётся подключить заново.

Проверка восстановления — раз в месяц, на временной базе:

```sh
docker compose exec db createdb -U postgres lumi_check
docker compose exec -T db pg_restore -U postgres -d lumi_check < backups/lumi-<дата>.dump
docker compose exec db psql -U postgres -d lumi_check -c "select count(*) from users; select max(day) from events;"
docker compose exec db dropdb -U postgres lumi_check
```

## Обновление

```sh
cd lumi && git pull && cd deploy && docker compose up -d --build
```

Миграции применяются сами при старте приложения.

На общем сервере (туннель Cloudflare) обновление — `scripts/server-deploy.sh` с Mac. Скрипт помечает новый образ коротким sha коммита (`lumi-app:<sha>`), прежний оставляет как `lumi-app:prev` и завершается с ошибкой, если контейнер не стал healthy или `https://<домен>/health` отвечает не 200.

### Откат

Новая версия не поднялась или сломалась — вернуть прежний образ (на сервере, в `/opt/lumi/deploy`):

```sh
docker tag lumi-app:prev lumi-app
docker compose -f docker-compose.shared.yml up -d --no-deps app worker
docker inspect -f '{{.State.Health.Status}}' lumi-app-1   # ждём healthy
```

Любая прошлая выкладка: `docker images lumi-app` — выбрать `lumi-app:<sha>` и так же `docker tag lumi-app:<sha> lumi-app`. Миграции только добавляют (таблицы, столбцы, индексы), поэтому старый код работает с новой базой; если миграция что-то удаляла — сначала восстановить базу из бэкапа.

Логи контейнеров ограничены: до 3 файлов по 10 МБ на сервис (`logging` в compose).

## Что важно знать

- База создаётся с локалью `C.UTF-8`, иначе поиск по кириллице без учёта регистра не работает.
- `TRUST_PROXY` — чьим заголовкам `X-Forwarded-For` верить. В compose стоит `loopback,uniquelocal`: Caddy, туннель и docker-proxy приходят из частной подсети Docker, и адрес посетителя берётся с правого края цепочки (за туннелем — из `CF-Connecting-IP`). Можно и числом — сколько прокси стоит перед приложением (`1`). Не ставь `true`: тогда адрес берётся с левого края, его пишет сам посетитель, и лимиты на вход, регистрацию и демо обходятся подменой заголовка.
- Плагин Obsidian и iPhone-команды после переезда берут новый адрес: впиши `https://<домен>` в их настройки.
- Постеры на странице входа (`apps/web/public/lumi/posters`) перед публичным запуском нужно заменить своими или получить права на них.

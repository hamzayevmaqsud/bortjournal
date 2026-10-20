# Архитектура Бортжурнала (новая версия)

Текущий журнал (`server.js`, `app.js` в корне) работает как раньше, пока новая версия
не догонит его по модулям. Новая версия живёт рядом:

```
apps/api        бэкенд: Fastify + Drizzle + Postgres (TypeScript)
apps/web        фронт: React + Vite (следующий шаг)
packages/core   общая логика без зависимостей: модули, тарифы, формулы — для API и фронта
docs/           этот файл
```

## Модульный монолит

Один бэкенд, модули — папки `apps/api/src/modules/<модуль>`:

| Модуль | Таблицы |
|---|---|
| food   | food_meals, food_drinks, food_user_foods, food_meal_sets |
| gym    | gym_workouts → gym_workout_exercises → gym_workout_sets, gym_user_exercises, gym_plans, gym_live |
| study  | study_sessions, study_srs, study_quizzes, study_time |
| budget | budget_settings, budget_entries |
| books  | books, book_quotes, book_reading_log |
| plans  | plan_goals, plan_task_series, plan_tasks |
| body   | body_days |

Правила (проверяет `test/boundaries.test.ts`):

- Модуль импортирует только ядро (`src/core`, `src/db`) и **публичный `index.ts`** других модулей.
- `index.ts` модуля экспортирует объект `AppModule` (`src/core/module.ts`): маршруты, перенос из старого журнала и его сверку.
- Все модули зарегистрированы в `src/modules/index.ts`.
- Каждая запись пользователя ссылается на `users` с каскадным удалением — удаление аккаунта удаляет всё.

## Ядро (`src/core`)

- **users, sessions, profiles, activity_weeks** — аккаунт и анкета. Пароль — `scrypt$N$r$p$соль$хеш`, совместим со старым журналом.
- **entitlements** `(user, module, source: free/trial/web/apple/google, expires_at)`. `requireModule()` — preHandler маршрутов модуля, без доступа отвечает 402. Время сравнивает база (`now()`).
- **events** — лента «что и когда»: каждый модуль пишет туда короткую запись (`recordEvents`), одна запись модуля — одно событие вида (`ref_id + kind`). Из неё строятся лента дня, итог недели и выводы между модулями.
- **integrations + raw_samples** — данные с устройств отдельно от ручных записей, с источником и согласием; токены только зашифрованными.
- **push_subscriptions, reminder_log** — напоминания; `reminder_log (user, key, day)` защищает от дублей и при нескольких воркерах.
- **achievements, day_journal** — общее для всех модулей.

## Перенос из старого журнала

```
cd apps/api && npx tsx scripts/import-legacy.ts [--data ../../data] [--user имя] [--db postgres://…]
```

- Идемпотентен: `legacy_id` + `unique(user_id, legacy_id)`, повторный запуск обновляет, а не дублирует.
- По каждому пользователю — одна транзакция; после переноса модули сверяют количества и суммы (ккал, мл, объём, деньги до копейки, страницы, шаги) с источником. Расхождение — откат пользователя целиком.
- Дубли, битые даты и значения вне границ не переносятся молча — попадают в отчёт.

## Принятые решения

- **Postgres без Redis на старте.** Очереди и повторяющиеся задачи — в Postgres (pg-boss), когда понадобятся воркеры. Redis — когда появится нагрузка, которая его оправдывает.
- **Планировщик напоминаний — отдельный воркер**, не в процессе API: при нескольких репликах он слал бы дубли.
- **Деньги — `numeric(14,2)`**, питание — `double precision`, «нет данных» — `null`, а не 0.
- **Время записи — «ЧЧ:ММ» в поясе пользователя**, день — `date`: записи привязаны к его дню, а не к UTC.
- **Файлы (обложки, фото) — во внешнем хранилище** (S3-совместимом), в базе только ключ: реплики без состояния.

## Критерий готовности веба

1. Модули разделены, границы проверяются тестом. ✓
2. Postgres, версионируемые миграции, перенос старых данных со сверкой. ✓
3. API модулей + авторизация + entitlements на маршрутах. ◐ вход, «Сегодня», еда (вода, удаление), задачи
4. Фронт на React: все текущие разделы, телефон в первую очередь. ◐ «Сегодня», «Еда», лист «Записать»
5. Воркер: напоминания, распознавание фото, генерация вопросов.
6. Приватность: экспорт, полное удаление аккаунта, согласие на интеграции.
7. Бэкапы с регулярной проверкой восстановления, CI (lint, typecheck, тесты, миграции отдельной джобой).
8. Оплата (Paddle / Lemon Squeezy) — когда решится вопрос с юрлицом; до этого entitlements `free`.

После пунктов 1–7 — первые пользователи, параллельно мобильное приложение (Capacitor поверх `apps/web`).

## Локальный запуск

```
brew services start postgresql@17
createdb bortjournal && createdb bortjournal_test
npm install
npm run db:migrate
npm test            # тесты пересоздают только базу bortjournal_test
npm run api:dev     # http://127.0.0.1:4000/health
```

## Как сейчас запущено на Mac (пробная версия)

- `com.bortjournal.next` (LaunchAgent) — API + собранный фронт на `127.0.0.1:4000`, база `bortjournal`.
  Лог: `~/Library/Logs/bortjournal-next.log`. Перезапуск: `launchctl kickstart -k gui/$(id -u)/com.bortjournal.next`.
- Tailscale: `https://<mac>.ts.net:8443` → `:4000` (новая), `https://<mac>.ts.net` → `:3333` (старая).
- **Данные новой версии — копия на момент переноса.** Записи в новой версии не попадают в старую.
  Освежить копию из старой: `cd apps/api && npx tsx scripts/import-legacy.ts` (обновляет, не дублирует).
- После правок фронта: `cd apps/web && npx vite build` — API раздаёт `apps/web/dist` сразу.
- Базы: `bortjournal` — пробная с вашими данными, `bortjournal_test` — автотесты (пересоздаётся),
  `bortjournal_e2e` — ручные проверки в браузере на тестовом наборе.

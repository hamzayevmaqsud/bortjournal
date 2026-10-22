# Lumi

Приложение называется Lumi (репозиторий и внутренние пакеты — `bortjournal`), талисман — огонёк: `apps/web/public/lumi/`.

Устройство проекта и как запускать: `docs/architecture.md` (новая версия в `apps/` и `packages/`) и `README.md` (старая версия в корне).

## Agent skills

### Issue tracker

Задачи и спеки — markdown-файлы в `.scratch/<feature>/` внутри репо. See `docs/agents/issue-tracker.md`.

### Triage labels

Стандартные пять ролей (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), записываются строкой `Status:` в файле задачи. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: один `GLOSSARY.md` и `docs/adr/` в корне. See `docs/agents/domain.md`.

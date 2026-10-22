# Lumi: API + веб одним образом. Тот же образ запускает воркер (docker compose → service worker).
# Сборка: docker build -t lumi .   Данные (ключи VAPID и интеграций, обложки, файлы конспектов) — в томе /app/data.
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# зависимости отдельно от кода — пересобираются, только когда меняются package.json
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY apps/obsidian/package.json apps/obsidian/
COPY packages/core/package.json packages/core/
RUN npm ci --include=dev --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/web apps/web
COPY apps/obsidian apps/obsidian
RUN npm run build -w @bortjournal/obsidian && npm run build -w @bortjournal/web

WORKDIR /app/apps/api
EXPOSE 4000
ENV API_HOST=0.0.0.0 API_PORT=4000
# миграции при каждом старте: они идемпотентны и идут в транзакции
CMD ["sh", "-c", "npx tsx src/db/migrate.ts && exec npx tsx src/server.ts"]

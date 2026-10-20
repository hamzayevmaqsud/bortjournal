import { defineConfig } from 'vitest/config';

// тесты с базой пересоздают схему — запускаем файлы по очереди, а не параллельно
export default defineConfig({ test: { fileParallelism: false, testTimeout: 30000 } });

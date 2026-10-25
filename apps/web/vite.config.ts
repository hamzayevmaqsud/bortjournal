import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// в разработке API отвечает на :4000; собранный фронт раздаёт сам API
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4000', '/health': 'http://127.0.0.1:4000' } },
  // карты исходников наружу не отдаём: по ним читается весь код фронта
  build: { target: 'es2022', sourcemap: false }
});

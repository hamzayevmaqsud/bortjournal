import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './components/Toasts';
import './styles/tokens.css';
import './styles/app.css';
import { applyTheme, savedTheme } from './lib/theme';
import { mobileOnly } from './lib/wide';

applyTheme(savedTheme());
// телефонный адрес ставится на экран «Домой» со своим началом — /m
if (mobileOnly()) document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/manifest-m.webmanifest');

createRoot(document.getElementById('root')!).render(<StrictMode><ToastProvider><App /></ToastProvider></StrictMode>);

// установка как приложение и запуск без сети; в разработке не мешаем Vite
if ('serviceWorker' in navigator && import.meta.env.PROD) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

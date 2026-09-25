import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// Threads-агент LAK — Manifest V3.
// Ключ OpenRouter и прочие секреты живут только в chrome.storage.local (см. src/shared/settings.ts).
export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  manifest: {
    name: 'Threads-агент LAK',
    description:
      'Собирает базу постов в Threads, предлагает комментарии и посты в голосе владельца, ведёт очередь одобрения.',
    default_locale: undefined,
    permissions: ['storage', 'alarms', 'sidePanel', 'tabs', 'downloads', 'notifications'],
    host_permissions: ['*://www.threads.com/*', '*://threads.com/*', 'https://openrouter.ai/*'],
    action: { default_title: 'Threads-агент LAK' },
  },
  vite: () => ({
    plugins: [preact()],
  }),
});

import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// Threads-агент LAK — Manifest V3.
// Ключ OpenRouter и прочие секреты живут только в chrome.storage.local (см. src/shared/settings.ts).
export default defineConfig({
  srcDir: 'src',
  outDir: 'build',
  manifest: {
    name: 'Threads-агент LAK',
    description:
      'Собирает базу постов в Threads, предлагает комментарии и посты в голосе владельца, ведёт очередь одобрения.',
    options_ui: { open_in_tab: true },
    icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' },
    permissions: ['storage', 'alarms', 'sidePanel', 'tabs', 'downloads', 'downloads.ui', 'notifications'],
    host_permissions: ['*://www.threads.com/*', '*://threads.com/*', 'https://openrouter.ai/*'],
    action: { default_title: 'Threads-агент LAK' },
  },
  vite: () => ({
    plugins: [preact()],
  }),
});

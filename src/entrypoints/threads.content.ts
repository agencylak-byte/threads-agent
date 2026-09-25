import { startContent } from '@/content/main';

export default defineContentScript({
  matches: ['*://www.threads.com/*', '*://threads.com/*'],
  runAt: 'document_idle',
  main() {
    startContent();
  },
});

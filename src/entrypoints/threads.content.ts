export default defineContentScript({
  matches: ['*://www.threads.com/*', '*://threads.com/*'],
  runAt: 'document_idle',
  main() {
    console.info('[threads-agent] content script loaded');
  },
});

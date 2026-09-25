import { setLogSink } from '@/shared/log';
import { addEvent } from '@/db/repo-events';
import { initPorts } from '@/background/ports';
import { initInbound } from '@/background/inbound';
import { dispatchUiRequest, registerBaseHandlers } from '@/background/handlers';
import { registerLlmHandlers } from '@/background/llm-handlers';
import { initEngine } from '@/background/engine';
import type { UiRequest } from '@/shared/messages';

export default defineBackground(() => {
  setLogSink(async (e) => {
    await addEvent(e);
  });
  initPorts();
  initInbound();
  registerBaseHandlers();
  registerLlmHandlers();
  initEngine();

  browser.runtime.onMessage.addListener((msg: UiRequest, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return false;
    dispatchUiRequest(msg).then(sendResponse);
    return true; // асинхронный ответ
  });

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.windowId !== undefined) await browser.sidePanel.open({ windowId: tab.windowId });
  });
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  console.info('[threads-agent] service worker ready');
});

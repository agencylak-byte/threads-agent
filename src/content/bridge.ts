import { PORT_NAME } from '@/shared/constants';
import type { ContentToSw, SwToContent } from '@/shared/messages';

// Порт content ↔ service worker. Порт держит SW живым, пока идёт длинная операция (сбор, действие).
// При обрыве (SW перезапустился) — переподключаемся с backoff.

type Handler = (msg: SwToContent) => void;

export class Bridge {
  private port: chrome.runtime.Port | null = null;
  private handler: Handler | null = null;
  private retry = 500;
  private closed = false;

  onMessage(h: Handler): void {
    this.handler = h;
  }

  connect(): void {
    if (this.closed) return;
    try {
      this.port = browser.runtime.connect({ name: PORT_NAME });
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.retry = 500;
    this.port.onMessage.addListener((m: SwToContent) => this.handler?.(m));
    this.port.onDisconnect.addListener(() => {
      this.port = null;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, 10_000);
  }

  send(msg: ContentToSw): void {
    try {
      this.port?.postMessage(msg);
    } catch {
      // порт умер между проверкой и отправкой — переподключимся по onDisconnect
    }
  }

  close(): void {
    this.closed = true;
    this.port?.disconnect();
    this.port = null;
  }
}

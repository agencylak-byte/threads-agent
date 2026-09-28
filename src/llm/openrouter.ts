import { OPENROUTER_BASE } from '@/shared/constants';
import { log } from '@/shared/log';

// Клиент OpenRouter: chat completions с retry/backoff/таймаутом, подсчёт стоимости по прайсу модели.
// Ключ передаётся явно (читается из chrome.storage.local вызывающей стороной).

export interface ChatResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

interface ModelInfo {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
}

const priceCache = new Map<string, { prompt: number; completion: number }>();

export async function listModels(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ModelInfo[]> {
  const res = await fetchImpl(`${OPENROUTER_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`OpenRouter /models: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: ModelInfo[] };
  return body.data ?? [];
}

/** Проверяет, что модель есть в каталоге; кэширует её прайс. */
export async function verifyModel(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): Promise<ModelInfo> {
  const models = await listModels(apiKey, fetchImpl);
  const found = models.find((m) => m.id === model) ?? models.find((m) => m.id.startsWith(model));
  if (!found) {
    const hint = models
      .filter((m) => /gemini.*flash/i.test(m.id))
      .map((m) => m.id)
      .slice(0, 6)
      .join(', ');
    throw new Error(`Модель «${model}» не найдена в OpenRouter. Похожие: ${hint || 'нет'}`);
  }
  cachePrice(found);
  return found;
}

function cachePrice(m: ModelInfo): void {
  const p = Number(m.pricing?.prompt ?? 0);
  const c = Number(m.pricing?.completion ?? 0);
  if (Number.isFinite(p) && Number.isFinite(c)) priceCache.set(m.id, { prompt: p, completion: c });
}

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = priceCache.get(model);
  if (!p) return 0;
  return tokensIn * p.prompt + tokensOut * p.completion;
}

export function setPriceForTests(model: string, prompt: number, completion: number): void {
  priceCache.set(model, { prompt, completion });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chat(o: ChatOptions): Promise<ChatResult> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const retries = o.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 40_000);
    try {
      const res = await fetchImpl(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${o.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/lak-agency/threads-agent',
          'X-Title': 'Threads-agent LAK',
        },
        body: JSON.stringify({
          model: o.model,
          messages: [
            { role: 'system', content: o.system },
            { role: 'user', content: o.user },
          ],
          max_tokens: o.maxTokens ?? 2048,
          temperature: o.temperature ?? 0.7,
          // Gemini 3.x — «думающие» модели: их скрытые reasoning-токены тратят max_tokens и обрезают ответ.
          // Низкое усилие размышления + запас по лимиту — ответ приходит целиком (проверено 28.09.2026).
          reasoning: { effort: o.reasoningEffort ?? 'low' },
          ...(o.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) throw new RetryableError(`HTTP ${res.status}`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const body = (await res.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        error?: { message?: string };
      };
      if (body.error) throw new Error(`OpenRouter: ${body.error.message ?? 'error'}`);
      const text = body.choices?.[0]?.message?.content ?? '';
      if (body.choices?.[0]?.finish_reason === 'length') {
        log('error', `OpenRouter: ответ обрезан по max_tokens (${o.maxTokens ?? 2048}) — увеличьте лимит задачи`);
      }
      const tokensIn = body.usage?.prompt_tokens ?? 0;
      const tokensOut = body.usage?.completion_tokens ?? 0;
      const model = body.model ?? o.model;
      const costUsd = typeof body.usage?.cost === 'number' ? body.usage.cost : estimateCost(model, tokensIn, tokensOut);
      return { text, model, tokensIn, tokensOut, costUsd };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const retryable = e instanceof RetryableError || (e instanceof Error && e.name === 'AbortError');
      if (!retryable || attempt === retries) break;
      const delay = 2000 * 2 ** attempt + Math.random() * 1000;
      log('info', `OpenRouter retry ${attempt + 1}/${retries} after ${Math.round(delay)}ms: ${String(e)}`);
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

class RetryableError extends Error {}

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { renderPrompt } from '@/llm/prompt-render';
import { extractJson, parseJsonWith } from '@/llm/json-parse';
import { chat, estimateCost, setPriceForTests, verifyModel } from '@/llm/openrouter';
import { clampText } from '@/llm/tasks/comment-draft';
import classifyMd from '@/prompts/classify-lpr.md?raw';
import commentMd from '@/prompts/comment-draft.md?raw';
import replyMd from '@/prompts/reply-draft.md?raw';
import postMd from '@/prompts/post-draft.md?raw';
import voiceMd from '@/prompts/voice-extract.md?raw';

describe('renderPrompt', () => {
  it('делит на SYSTEM/USER, подставляет переменные, читает версию', () => {
    const r = renderPrompt('<!-- promptVersion: 3 -->\n# SYSTEM\nТы {{role}}.\n# USER\nПривет, {{name}}!', { role: 'бот', name: 'Лера' });
    expect(r.version).toBe(3);
    expect(r.system).toBe('Ты бот.');
    expect(r.user).toBe('Привет, Лера!');
  });

  it('падает на незаполненной переменной', () => {
    expect(() => renderPrompt('# SYSTEM\nx\n# USER\n{{missing}}', {})).toThrow(/missing/);
  });

  it('все промты проекта имеют обе секции и полностью заполняются', () => {
    const all: Array<[string, string, Record<string, string | number>]> = [
      ['classify', classifyMd, { businessFacts: 'f', posts: 'p' }],
      ['comment', commentMd, { voice: 'v', playbook: 'p', authorHandle: 'a', authorName: '', authorBio: 'b', authorFollowers: 10, niche: 'n', postText: 't', maxChars: 280, address: 'вы', usedOpeners: '—', hint: '' }],
      ['reply', replyMd, { voice: 'v', playbook: 'p', replyKind: 'k', thread: 't', authorHandle: 'a', lastMessage: 'm', maxChars: 320, address: 'вы', usedOpeners: '—', hint: '' }],
      ['post', postMd, { voice: 'v', businessFacts: 'f', playbook: 'p', topic: 't', recentPosts: '—', maxChars: 500, variantsCount: 1, formatName: 'n', formatInstruction: 'i', bannedOpeners: 'b', hint: '' }],
      ['voice', voiceMd, { samplesCount: 5, identity: 'i', samples: 's' }],
    ];
    for (const [name, md, vars] of all) {
      const r = renderPrompt(md, vars);
      expect(r.system.length, name).toBeGreaterThan(20);
      expect(r.user, name).not.toMatch(/\{\{/);
    }
  });
});

describe('json-parse', () => {
  it('достаёт JSON из markdown-fence и из текста с мусором', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Вот ответ: {"a":{"b":[1,2]}} спасибо')).toBe('{"a":{"b":[1,2]}}');
    expect(extractJson('[{"x":"скобка } в строке"}]')).toBe('[{"x":"скобка } в строке"}]');
  });

  it('чинит сырые переводы строк внутри строк JSON', () => {
    const S = z.object({ text: z.string() });
    expect(parseJsonWith(S, '{"text":"первая строка\nвторая строка"}')).toEqual({ text: 'первая строка\nвторая строка' });
  });

  it('валидирует схемой и даёт понятную ошибку', () => {
    const S = z.object({ text: z.string() });
    expect(parseJsonWith(S, '{"text":"ok"}')).toEqual({ text: 'ok' });
    expect(() => parseJsonWith(S, '{"text":5}')).toThrow(/не по схеме/);
    expect(() => parseJsonWith(S, 'нет json')).toThrow(/не найдено/);
  });
});

describe('openrouter', () => {
  it('chat: парсит ответ, считает стоимость по прайсу, ретраит 429', async () => {
    setPriceForTests('m', 0.000001, 0.000002);
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('rate', { status: 429 });
      return new Response(
        JSON.stringify({ model: 'm', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const r = await chat({ apiKey: 'k', model: 'm', system: 's', user: 'u', fetchImpl, retries: 2 });
    expect(calls).toBe(2);
    expect(r.text).toBe('{"ok":true}');
    expect(r.costUsd).toBeCloseTo(100 * 0.000001 + 50 * 0.000002);
    expect(estimateCost('unknown', 10, 10)).toBe(0);
  }, 15_000);

  it('chat: не ретраит 401', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch;
    await expect(chat({ apiKey: 'k', model: 'm', system: 's', user: 'u', fetchImpl })).rejects.toThrow(/401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('verifyModel: находит модель и подсказывает похожие', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'google/gemini-3.8-flash', pricing: { prompt: '0.0000001', completion: '0.0000004' } }, { id: 'google/gemini-2.5-flash' }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const m = await verifyModel('k', 'google/gemini-3.8-flash', fetchImpl);
    expect(m.id).toBe('google/gemini-3.8-flash');
    expect(estimateCost('google/gemini-3.8-flash', 1000, 1000)).toBeCloseTo(0.0005);
    await expect(verifyModel('k', 'google/gemini-9', fetchImpl)).rejects.toThrow(/Похожие: google\/gemini-3.8-flash/);
  });
});

describe('clampText', () => {
  it('режет по последнему предложению, если оно не слишком рано', () => {
    expect(clampText('Первое предложение. Второе очень длинное предложение без конца', 40)).toBe('Первое предложение.');
    expect(clampText('Коротко.', 40)).toBe('Коротко.');
  });
});

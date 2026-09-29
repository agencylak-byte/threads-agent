import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCount } from '@/content/parsers/numbers';
import { parseAllPosts } from '@/content/parsers/post-card';
import { detectSelfHandle, parseProfile } from '@/content/parsers/profile';
import { parseThreadPage } from '@/content/parsers/thread-page';
import { parseFollowers } from '@/content/parsers/followers-dialog';
import { runSelfTest } from '@/content/selectors-selftest';
import { pageKind, URLS } from '@/content/selectors';

function load(name: string): Document {
  const html = readFileSync(resolve(process.cwd(), 'tests/fixtures/threads', `${name}.html`), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('parseCount', () => {
  it.each([
    ['1,2 тыс.', 1200],
    ['1.2K', 1200],
    ['12 345', 12345],
    ['12,345', 12345],
    ['3 млн', 3_000_000],
    ['2M', 2_000_000],
    ['48', 48],
    ['Нравится 12', 12],
    ['3,4 тыс. подписчиков', 3400],
    ['', 0],
    ['—', 0],
  ])('%s → %d', (raw, expected) => {
    expect(parseCount(raw)).toBe(expected);
  });
});

describe('post-card / feed', () => {
  it('парсит карточки, дедуплицирует виртуализированные дубли, берёт лайки/ответы/репосты и время', () => {
    const doc = load('feed');
    const posts = parseAllPosts(doc, 'feed');
    expect(posts.map((p) => p.id)).toEqual(['user_1/post/DKx1abc', 'user_2/post/DKx2def']);
    const p1 = posts[0]!;
    expect(p1.authorHandle).toBe('user_1');
    expect(p1.authorName).toBeUndefined(); // в ленте Threads текст ссылки = handle, имени нет
    expect(p1.url).toBe('https://www.threads.com/@user_1/post/DKx1abc');
    expect(p1.text).toContain('Постим каждый день');
    expect(p1.text).toContain('Что я делаю не так?');
    expect(p1.text).not.toContain('user_1');
    expect(p1.text).not.toMatch(/1\s?ч\./); // время не попадает в текст
    expect(p1.likes).toBe(1205);
    expect(p1.replies).toBe(48);
    expect(p1.reposts).toBe(3);
    expect(p1.postedAt).toBe(Date.parse('2026-09-25T08:15:35.000Z'));
    expect(posts[1]!.likes).toBe(12); // «Убрать "Нравится"» тоже считается иконкой лайка
    expect(posts[1]!.replies).toBe(0);
  });

  it('self-test на ленте зелёный, а на пустой странице ловит поломку', () => {
    expect(runSelfTest(URLS.feed, load('feed')).broken).toEqual([]);
    const empty = new DOMParser().parseFromString('<html><body><div>ничего</div></body></html>', 'text/html');
    const r = runSelfTest(URLS.feed, empty);
    expect(r.page).toBe('feed');
    expect(r.broken).toContain('postContainer');
    expect(r.broken).toContain('navProfileLink');
  });
});

describe('profile', () => {
  it('handle из URL, имя, bio, подписчики; свой handle из левого меню', () => {
    const doc = load('profile');
    const p = parseProfile(URLS.profile('user_1'), doc, 'self_user');
    expect(p).toMatchObject({ handle: 'user_1', displayName: 'Ольга Иванова', followers: 3412, isSelf: false });
    expect(p?.bio).toContain('Основатель онлайн-школы');
    expect(p?.bio).not.toContain('подписчиков');
    expect(p?.bio).not.toContain('Маркетинг'); // теги не bio
    expect(p?.bio).not.toContain('40 заявок'); // текст поста не bio
    expect(detectSelfHandle(doc)).toBe('self_user');
    expect(parseProfile(URLS.profile('self_user'), doc, 'self_user')?.isSelf).toBe(true);
    expect(runSelfTest(URLS.profile('user_1'), doc).broken).toEqual([]);
  });
});

describe('thread-page', () => {
  it('корневой пост и ответы с isReplyTo', () => {
    const t = parseThreadPage('https://www.threads.com/@user_1/post/DKx1abc', load('post'));
    expect(t?.root.id).toBe('user_1/post/DKx1abc');
    expect(t?.root.likes).toBe(1205);
    expect(t?.replies.map((r) => r.post.authorHandle)).toEqual(['self_user', 'user_1']);
    expect(t?.replies[0]?.post.isReplyTo).toBe('user_1/post/DKx1abc');
    expect(t?.replies[0]?.post.source).toBe('thread');
  });
});

describe('followers', () => {
  it('уникальные handle без ссылок на посты', () => {
    expect(parseFollowers(load('followers'))).toEqual(['user_10', 'user_11']);
    expect(parseFollowers(load('followers'), ['user_10'])).toEqual(['user_11']);
  });
});

describe('submit button', () => {
  it('находит круглую кнопку «Ответ» рядом с inline-редактором, а не счётчик ответов на карточке', async () => {
    const { findSubmitFor, findSubmitButton } = await import('@/content/actions/submit');
    const doc = load('composer');
    const editor = doc.getElementById('editor')!;
    expect(findSubmitFor(editor)?.id).toBe('submit');
    expect(findSubmitButton(doc)?.id).toBe('submit');
  });
});

describe('search: вкладка «Недавние»', () => {
  it('кликает «Недавние», если активен «Топ», и не трогает, если уже активна', async () => {
    const { ensureRecentTab } = await import('@/content/collector');
    const doc = new DOMParser().parseFromString(
      '<div><div role="tab" aria-selected="true"><span>Топ</span></div><div role="tab" aria-selected="false" id="recent"><span>Недавние</span></div><div role="tab">Профили</div></div>',
      'text/html',
    );
    let clicks = 0;
    doc.getElementById('recent')!.addEventListener('click', () => clicks++);
    expect(await ensureRecentTab(doc)).toBe(true);
    expect(clicks).toBe(1);
    doc.getElementById('recent')!.setAttribute('aria-selected', 'true');
    await ensureRecentTab(doc);
    expect(clicks).toBe(1);
    const none = new DOMParser().parseFromString('<div>нет вкладок</div>', 'text/html');
    expect(await ensureRecentTab(none)).toBe(false);
  }, 10_000);
});

describe('pageKind', () => {
  it.each([
    ['https://www.threads.com/', 'feed'],
    ['https://www.threads.com/search?q=x', 'search'],
    ['https://www.threads.com/@a/post/B', 'post'],
    ['https://www.threads.com/@a', 'profile'],
    ['https://www.threads.com/@a/followers', 'profile'],
    ['https://www.threads.com/activity', 'activity'],
    ['https://www.threads.com/messages', 'messages'],
    ['https://www.threads.com/login', 'other'],
  ])('%s → %s', (url, kind) => {
    expect(pageKind(url)).toBe(kind);
  });
});

// ЕДИНСТВЕННОЕ место, где живут селекторы Threads. Классы у Threads обфусцированы и меняются —
// опираемся на роли, aria-label, href-паттерны и <time>. Каждая запись имеет список кандидатов:
// первый сработавший используется, self-test сообщает, какие записи не находят ничего.
// Локализация: aria-label зависят от языка интерфейса — карта ru/en ниже.

export type PageKind = 'feed' | 'search' | 'post' | 'profile' | 'activity' | 'messages' | 'other';

// Реальная вёрстка Threads (снимок 25.09.2026, ru): у svg нет aria-label, есть атрибут title и <title>:
// «Поставить "Нравится"» / «Убрать "Нравится"», «Ответ», «Сделать репост», «Поделиться».
export const LABELS = {
  like: ['Нравится', 'Like', 'Unlike'],
  reply: ['Ответ', 'Ответить', 'Reply'],
  repost: ['репост', 'Repost'],
  post: ['Опубликовать', 'Post'],
  profileNav: ['Профиль', 'Profile'],
  more: ['Ещё', 'Еще', 'More'],
  close: ['Закрыть', 'Close'],
  followers: ['подписчик', 'followers', 'follower'],
  send: ['Отправить', 'Send'],
  messages: ['Сообщения', 'Messages'],
} as const;

export function ariaIn(labels: readonly string[]): string {
  return labels.map((l) => `[aria-label="${l}"]`).join(',');
}

/** svg-иконка: подпись может быть в title или aria-label, точная или как подстрока («Поставить "Нравится"»). */
export function iconSel(labels: readonly string[]): string {
  return labels.flatMap((l) => [`svg[title*="${l}"]`, `svg[aria-label*="${l}"]`]).join(',');
}

/** Селектор-запись: имя + список кандидатов, обязательность для страницы. */
export interface SelectorDef {
  candidates: string[];
  /** На каких страницах запись должна находить хотя бы один элемент (для self-test). */
  requiredOn: PageKind[];
}

export const SELECTORS = {
  /** Контейнер одного поста в ленте/поиске/треде. */
  postContainer: {
    candidates: ['div[data-pressable-container="true"]', 'article', 'div[role="article"]'],
    requiredOn: ['feed', 'search', 'post', 'profile'],
  },
  /** Ссылка на пост (permalink) внутри контейнера — по ней берём code и время. */
  postLink: {
    candidates: ['a[href*="/post/"]'],
    requiredOn: ['feed', 'search', 'post', 'profile'],
  },
  /** Ссылка на автора внутри контейнера. */
  authorLink: {
    candidates: ['a[href^="/@"]'],
    requiredOn: ['feed', 'search', 'post', 'profile'],
  },
  /** Текстовые блоки поста. */
  postText: {
    candidates: ['div[dir="auto"]', 'span[dir="auto"]'],
    requiredOn: ['feed', 'search', 'post'],
  },
  time: { candidates: ['time[datetime]'], requiredOn: ['feed', 'search', 'post', 'profile'] },
  likeIcon: { candidates: [iconSel(LABELS.like)], requiredOn: ['feed', 'search', 'post'] },
  replyIcon: { candidates: [iconSel(LABELS.reply)], requiredOn: ['feed', 'search', 'post'] },
  repostIcon: { candidates: [iconSel(LABELS.repost)], requiredOn: [] },
  /** Имя в шапке профиля: <h1 dir="auto" translate="no"> внутри region «Содержимое столбца» (снимок 25.09.2026). */
  profileHeader: {
    candidates: ['div[role="region"] h1[dir="auto"][translate="no"]', 'div[role="region"] h1', 'main h1', 'header h1, header h2', 'h1[dir="auto"]'],
    requiredOn: ['profile'],
  },
  /** Счётчик подписчиков: role=button со span[title="<число>"] и текстом «N подписчиков». */
  followersLink: {
    candidates: ['a[href$="/followers"]', 'div[role="button"] span[dir="auto"] span[title]', 'a[href*="followers"]'],
    requiredOn: ['profile'],
  },
  /** Левое меню → ссылка на свой профиль (единственная nav-ссылка вида /@handle). */
  navProfileLink: {
    candidates: [`a[href^="/@"]${ariaIn(LABELS.profileNav)}`, 'nav a[href^="/@"]', 'div[role="navigation"] a[href^="/@"]'],
    requiredOn: ['feed', 'search', 'post', 'profile', 'activity'],
  },
  composer: {
    candidates: ['div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', 'textarea'],
    requiredOn: [],
  },
  /** Кнопка «Новая публикация» / «Создать» в меню или плейсхолдер «Пустое текстовое поле…» в ленте. */
  createPost: {
    candidates: [
      'div[role="button"][aria-label^="Пустое текстовое поле"]',
      `div[role="button"]:has(svg[aria-label="Новая публикация"]), div[role="button"]:has(svg[title="Новая публикация"])`,
      'div[role="button"]:has(svg[aria-label="Создать"]), a[aria-label="Создать"], div[role="button"][aria-label="Создать"]',
      'div[role="button"]:has(svg[aria-label="Create"]), div[role="button"][aria-label="Create"]',
    ],
    requiredOn: [],
  },
  postButton: {
    candidates: [
      `div[role="button"]${ariaIn(LABELS.post)}`,
      `button${ariaIn(LABELS.post)}`,
      'div[role="button"]', // + фильтр по тексту в actions
    ],
    requiredOn: [],
  },
  dialog: { candidates: ['div[role="dialog"]'], requiredOn: [] },
  dialogAuthorLinks: { candidates: ['div[role="dialog"] a[href^="/@"]'], requiredOn: [] },
  searchInput: { candidates: ['input[type="search"]', 'input[placeholder]'], requiredOn: ['search'] },
  activityItem: { candidates: ['div[data-pressable-container="true"]', 'a[href*="/post/"]'], requiredOn: ['activity'] },
  captcha: { candidates: ['iframe[src*="captcha"]', '#captcha', 'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]'], requiredOn: [] },
  toast: { candidates: ['div[role="alert"]', 'div[role="status"]', 'div[aria-live]'], requiredOn: [] },
} as const satisfies Record<string, SelectorDef>;

export type SelectorName = keyof typeof SELECTORS;

/** Первый кандидат, который находит хоть что-то в root. */
export function q<T extends Element = Element>(name: SelectorName, root: ParentNode = document): T | null {
  for (const c of SELECTORS[name].candidates) {
    const el = root.querySelector<T>(c);
    if (el) return el;
  }
  return null;
}

export function qa<T extends Element = Element>(name: SelectorName, root: ParentNode = document): T[] {
  for (const c of SELECTORS[name].candidates) {
    const els = Array.from(root.querySelectorAll<T>(c));
    if (els.length) return els;
  }
  return [];
}

export function pageKind(url: string): PageKind {
  const path = new URL(url).pathname;
  if (path.startsWith('/search')) return 'search';
  if (/\/@[^/]+\/post\//.test(path)) return 'post';
  if (/^\/@[^/]+\/?$/.test(path) || /^\/@[^/]+\/(replies|reposts|followers|following)/.test(path)) return 'profile';
  if (path.startsWith('/activity')) return 'activity';
  if (path.startsWith('/messages') || path.startsWith('/direct')) return 'messages';
  if (path === '/' || path === '/following' || path === '/for-you' || path === '/for_you') return 'feed';
  return 'other';
}

export const URLS = {
  feed: 'https://www.threads.com/',
  search: (q: string, recent = false) =>
    `https://www.threads.com/search?q=${encodeURIComponent(q)}&serp_type=${recent ? 'recent' : 'default'}`,
  profile: (handle: string) => `https://www.threads.com/@${handle.replace(/^@/, '')}`,
  followers: (handle: string) => `https://www.threads.com/@${handle.replace(/^@/, '')}/followers`,
  activity: 'https://www.threads.com/activity',
  messages: 'https://www.threads.com/messages',
};

export function handleFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/@([A-Za-z0-9._]+)/);
  return m ? (m[1] ?? null) : null;
}

export function postCodeFromHref(href: string | null | undefined): { handle: string; code: string } | null {
  if (!href) return null;
  const m = href.match(/\/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)/);
  return m && m[1] && m[2] ? { handle: m[1], code: m[2] } : null;
}

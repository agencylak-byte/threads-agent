import { SELECTORS, pageKind, type PageKind, type SelectorName } from './selectors';

/** Проверяет, какие обязательные для этой страницы селекторы не находят ничего. */
export function runSelfTest(url: string, root: ParentNode = document): { page: PageKind; broken: string[] } {
  const page = pageKind(url);
  const broken: string[] = [];
  for (const [name, def] of Object.entries(SELECTORS) as Array<[SelectorName, (typeof SELECTORS)[SelectorName]]>) {
    if (!(def.requiredOn as readonly PageKind[]).includes(page)) continue;
    const found = def.candidates.some((c) => {
      try {
        return root.querySelector(c) !== null;
      } catch {
        return false;
      }
    });
    if (!found) broken.push(name);
  }
  return { page, broken };
}

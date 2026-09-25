# Фикстуры DOM Threads

- `raw/` — сырые снимки страниц из браузера Леры (в git не идут, см. `.gitignore`).
  Снять: DevTools → Elements → правый клик на `<html>` → Copy → Copy outerHTML → сохранить как `raw/<page>.html`.
  Нужные страницы: `feed`, `search`, `post`, `profile`, `followers`, `activity`, `messages`.
- `*.html` — санитизированные фикстуры для тестов парсеров: handle'ы заменены на `user_N`,
  тексты укорочены, скрипты и стили вырезаны. Пока реальных снимков нет, здесь лежат
  **синтетические** фикстуры, повторяющие известную структуру Threads (роли, `href`, `time`, `aria-label`).
  После спайка с реальным DOM их нужно заменить — это часть починки селекторов.

Санитизация (после появления raw):
```bash
node scripts/sanitize-fixture.mjs raw/feed.html feed.html
```

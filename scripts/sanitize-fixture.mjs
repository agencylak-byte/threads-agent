#!/usr/bin/env node
// Санитизация сырого снимка DOM Threads в фикстуру для тестов:
// вырезает script/style/svg-path/img, заменяет handle'ы на user_N, обрезает длинные тексты.
// Использование: node scripts/sanitize-fixture.mjs tests/fixtures/threads/raw/feed.html tests/fixtures/threads/feed.html

import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: sanitize-fixture.mjs <raw.html> <out.html>');
  process.exit(1);
}

let html = readFileSync(input, 'utf8');
html = html
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<link[^>]*>/gi, '')
  .replace(/<path[\s\S]*?(\/>|<\/path>)/gi, '')
  .replace(/<img[^>]*>/gi, '')
  .replace(/\sclass="[^"]*"/gi, '')
  .replace(/\sstyle="[^"]*"/gi, '');

const handles = new Map();
html = html.replace(/\/@([A-Za-z0-9._]+)/g, (_, h) => {
  if (!handles.has(h)) handles.set(h, `user_${handles.size + 1}`);
  return `/@${handles.get(h)}`;
});
for (const [real, fake] of handles) html = html.split(real).join(fake);

writeFileSync(output, html);
console.log(`ok: ${output} (${handles.size} handles заменены)`);

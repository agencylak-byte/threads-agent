// Снимок DOM для разработчика: без script/style/img-данных и без классов (они обфусцированы и бесполезны),
// но с ролями, aria-label, href, datetime — всем, на что опираются селекторы.

export function dumpPage(root: Document = document): string {
  const clone = root.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, link[rel="stylesheet"], noscript, video, audio, source').forEach((el) => el.remove());
  clone.querySelectorAll('img').forEach((img) => {
    img.removeAttribute('src');
    img.removeAttribute('srcset');
  });
  clone.querySelectorAll('svg path, svg polygon, svg circle, svg line, svg rect').forEach((el) => el.remove());
  clone.querySelectorAll('*').forEach((el) => {
    el.removeAttribute('class');
    el.removeAttribute('style');
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on') || attr.value.length > 300) el.removeAttribute(attr.name);
    }
  });
  return `<!-- ${root.location.href} @ ${new Date().toISOString()} -->\n` + clone.outerHTML;
}

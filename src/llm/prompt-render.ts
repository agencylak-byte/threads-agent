// Промты лежат в src/prompts/*.md и импортируются как строки (?raw).
// Формат файла: необязательный комментарий <!-- promptVersion: N -->, затем секции "# SYSTEM" и "# USER".
// Переменные — {{name}}; незаполненная переменная — ошибка (чтобы промт не ушёл с дыркой).

export interface RenderedPrompt {
  system: string;
  user: string;
  version: number;
}

export function renderPrompt(md: string, vars: Record<string, string | number | undefined>): RenderedPrompt {
  const version = Number(md.match(/<!--\s*promptVersion:\s*(\d+)\s*-->/)?.[1] ?? 1);
  const body = md.replace(/<!--[\s\S]*?-->/g, '');
  const sysIdx = body.search(/^# SYSTEM\s*$/m);
  const userIdx = body.search(/^# USER\s*$/m);
  if (sysIdx < 0 || userIdx < 0 || userIdx < sysIdx) throw new Error('prompt: нужны секции "# SYSTEM" и "# USER"');
  const system = fill(body.slice(sysIdx, userIdx).replace(/^# SYSTEM\s*$/m, ''), vars);
  const user = fill(body.slice(userIdx).replace(/^# USER\s*$/m, ''), vars);
  return { system: system.trim(), user: user.trim(), version };
}

function fill(text: string, vars: Record<string, string | number | undefined>): string {
  const missing: string[] = [];
  const out = text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const v = vars[name];
    if (v === undefined) {
      missing.push(name);
      return '';
    }
    return String(v);
  });
  if (missing.length) throw new Error(`prompt: не заполнены переменные ${missing.join(', ')}`);
  return out;
}

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { extract, importBindings } from '../../codegraph/lexical.mjs';

// contract: static relative imports, transitively; unread is unknown
export function importClosure(entry) {
  const files = new Set();
  const unknown = [];
  const walk = (file) => {
    if (files.has(file)) return;
    let src;
    try { src = readFileSync(file, 'utf8'); } catch (e) { unknown.push({ file, reason: e.code || e.message }); return; }
    files.add(file);
    const lexed = extract(src);
    if (!lexed.ok) { unknown.push({ file, reason: lexed.reason }); return; }
    for (const b of importBindings(lexed.masked, src)) {
      if (/^\.\.?\//.test(b.spec)) walk(resolve(dirname(file), b.spec));
    }
  };
  walk(resolve(entry));
  return { files: [...files].sort(), unknown };
}

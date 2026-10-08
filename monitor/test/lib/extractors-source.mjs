// monitor/test/lib/extractors-source.mjs — the extractors' SOURCE, wherever in the split it now lives.
//
// THE PROBLEM THIS EXISTS FOR. monitor/extractors.mjs is being split into part modules under
// monitor/extractors/, and the tests that read it as TEXT went blind one slice at a time, in two
// opposite ways. One asserts that no extractor parses an artifact with a bare
// JSON.parse(readFileSync(...)). After five slices it still passed, still reading only the barrel,
// so a violation added to any part file would have passed with it. Another asserts the two osv.sarif
// parsers agree; it went red the moment the second parser moved. The loud one was the harmless one.
// admin/test/lib/panel-source.mjs is the same seam for the panel, found the same way.
//
// extractorsSource() is the barrel followed by EVERY .mjs under monitor/extractors/, sorted, each
// behind a marker line naming its file. It reads the directory rather than a list, so a part module
// added later is covered without anyone remembering to add it.
//
// FAILS CLOSED. A missing barrel or an unreadable directory throws: an absent source is not an empty
// one, and a text guard fed an empty string passes everything.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MONITOR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// `base` exists so the tests below can point THIS function at a synthetic tree, rather than
// re-implementing its rules to check them.
export function extractorFiles({ base = MONITOR } = {}) {
  const parts = readdirSync(join(base, 'extractors')).filter((f) => f.endsWith('.mjs')).sort();
  return [join(base, 'extractors.mjs'), ...parts.map((f) => join(base, 'extractors', f))];
}

/** The barrel plus every part module, LF-normalised, each preceded by `// ==== <path> ====`. */
export function extractorsSource({ base = MONITOR } = {}) {
  return extractorFiles({ base })
    .map((p) => `// ==== ${p.slice(base.length + 1).split('\\').join('/')} ====\n${readFileSync(p, 'utf8').split('\r\n').join('\n')}`)
    .join('\n');
}

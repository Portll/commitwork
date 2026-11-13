#!/usr/bin/env node
// bin/codeql-index-filters.mjs — a CodeQL filter file as the value of LGTM_INDEX_FILTERS.
//
// usage: node bin/codeql-index-filters.mjs <filter-file>
// Prints the file's rules, dropping comments, blank lines and every \r. A CRLF checkout leaves \r on
// each rule, which the extractor rejects.
// exit: 0 rules printed · 1 the file is unreadable or holds no rule, with nothing on stdout, so the
//       lane sees a failure rather than an empty (unbounded) filter · 2 usage
import { readFileSync } from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';

/** The filter file's rules: comments and blank lines dropped, \r stripped, nothing else touched. */
export function parseFilterText(text) {
  return String(text).replace(/\r/g, '').split('\n')
    .map((l) => l.replace(/^\s*#.*$/, ''))
    .filter((l) => l.trim() !== '');
}

if (isMainModule(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { process.stderr.write('usage: codeql-index-filters.mjs <filter-file>\n'); process.exitCode = 2; }
  else {
    let text = null;
    try { text = readFileSync(file, 'utf8'); } catch (e) {
      process.stderr.write(`codeql-index-filters: cannot read ${file}: ${e.code || e.message}\n`);
      process.exitCode = 1;
    }
    if (text !== null) {
      const lines = parseFilterText(text);
      // exitCode, never process.exit(): a piped stdout is cut off by an exit before it drains
      if (lines.length) process.stdout.write(lines.join('\n') + '\n');
      else {
        process.stderr.write(`codeql-index-filters: REFUSED: ${file} holds no rule after comments and blank lines\n`);
        process.exitCode = 1;
      }
    }
  }
}

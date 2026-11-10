// monitor/rule-titles.mjs — the rule titles ShellCheck and hadolint publish, for lanes whose
// artifact names a rule but never describes it.
//
// shellcheck --format=json1 and hadolint's JSON carry a code and a per-hit message, and the message
// is not a title: ShellCheck formats names and paths into it ("SOURCE appears unused", "Not
// following: ./.bashrc"). Measured 2026-10-20 over the fleet's latest artifacts, 22 of 130
// ShellCheck codes had more than one message, so a title taken from one hit would be wrong for the
// next. Each tool publishes one line per code, and this module reads those lists:
//   shellcheck  https://www.shellcheck.net/wiki/ — the ShellCheck wiki's sitemap, one line per code
//   hadolint    the Rules table in hadolint's README, which lists the SC codes it runs as well
//
// The table is monitor/data/rule-titles.json. It is built by running this module on the two
// documents and is never edited by hand. An absent or unreadable table gives no titles, never
// invented ones.
//
// usage: node monitor/rule-titles.mjs <shellcheck-sitemap.html> <hadolint-README.md> [--retrieved YYYY-MM-DD]
//   curl -o sitemap.html https://www.shellcheck.net/wiki/
//   curl -o README.md https://raw.githubusercontent.com/hadolint/hadolint/master/README.md
// exit: 0 written · 2 wrong arguments, an unreadable document, or a document with no rules in it
// env, read at call time: CW_RULE_TITLES (the table's path, default monitor/data/rule-titles.json) ·
//   CW_NOW (the retrieved date when --retrieved is not given)

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeParseFile } from './safe-parse.mjs';
import { ruleTitleText } from './sarif-read.mjs';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCES = {
  shellcheck: 'https://www.shellcheck.net/wiki/',
  hadolint: 'https://github.com/hadolint/hadolint/blob/master/README.md#rules',
};

export const ruleTitlesPath = () => process.env.CW_RULE_TITLES || join(ROOT, 'monitor', 'data', 'rule-titles.json');

/** The {code: title} map one tool publishes, or null when the table is absent or unreadable. */
export function publishedTitles(tool, p = ruleTitlesPath()) {
  let j; try { j = safeParseFile(p); } catch { return null; }
  const m = j && j.titles && j.titles[tool];
  return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
}

/** The cleaned, capped title a published map gives a code, or null. Own keys only, so a code such as
 *  `constructor` cannot read a property every object inherits. */
export function publishedTitle(map, code) {
  if (!map || !code || !Object.hasOwn(map, code) || typeof map[code] !== 'string') return null;
  return ruleTitleText(map[code], code);
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return Object.hasOwn(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : m;
  });
}
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

/** {SCnnnn: title} from the ShellCheck wiki sitemap: `<li><a href='SC1000'>SC1000</a> &ndash; text</li>`. */
export function parseShellcheckSitemap(html) {
  const out = {};
  for (const m of String(html || '').matchAll(/<li>\s*<a href=['"](SC\d{4})['"]>\s*SC\d{4}\s*<\/a>\s*(?:&ndash;|–)\s*([\s\S]*?)<\/li>/g)) {
    const text = oneLine(decodeEntities(m[2].replace(/<[^>]*>/g, '')));
    if (text) out[m[1]] = text;
  }
  return out;
}

/** {DLnnnn|SCnnnn: title} from the Rules table in hadolint's README: `| [DL3000](url) | Error | text |`.
 *  A pipe inside a cell is written `&#124;`, so the row splits before entities are decoded, and
 *  `<code>` spans become backticks like the rest of the table. */
export function parseHadolintReadme(md) {
  const out = {};
  for (const line of String(md || '').split('\n')) {
    if (!/^\|\s*\[(DL|SC)\d{4}\]/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    const code = (cells[1] || '').match(/^\[((?:DL|SC)\d{4})\]/);
    const cell = (cells[3] || '').replace(/\\\|/g, '|').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');   // `<package>` in a cell is text, not a tag
    const text = oneLine(decodeEntities(cell));
    if (code && text) out[code[1]] = text;
  }
  return out;
}

const sorted = (m) => Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]]));

/** The table, from the two published documents. Throws rather than write a table with an empty list. */
export function buildTable({ shellcheckHtml, hadolintMd, retrieved }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(retrieved || ''))) throw new Error(`retrieved must be YYYY-MM-DD, got ${retrieved}`);
  const shellcheck = parseShellcheckSitemap(shellcheckHtml);
  const hadolint = parseHadolintReadme(hadolintMd);
  if (!Object.keys(shellcheck).length) throw new Error('no ShellCheck codes found in the sitemap');
  if (!Object.keys(hadolint).length) throw new Error("no rules found in hadolint's README");
  return {
    about: 'One line per rule code, as each tool publishes it. Built by node monitor/rule-titles.mjs from the documents named in sources; never edited by hand.',
    sources: {
      hadolint: { url: SOURCES.hadolint, retrieved, codes: Object.keys(hadolint).length },
      shellcheck: { url: SOURCES.shellcheck, retrieved, codes: Object.keys(shellcheck).length },
    },
    titles: { hadolint: sorted(hadolint), shellcheck: sorted(shellcheck) },
  };
}

export const serialise = (table) => `${JSON.stringify(table, null, 1)}\n`;

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--retrieved');
  const retrieved = at >= 0 ? args[at + 1] : nowISO().slice(0, 10);
  const files = args.filter((a, i) => a !== '--retrieved' && args[i - 1] !== '--retrieved');
  if (files.length !== 2) {
    process.stderr.write('usage: node monitor/rule-titles.mjs <shellcheck-sitemap.html> <hadolint-README.md> [--retrieved YYYY-MM-DD]\n');
    process.exitCode = 2;
  } else {
    try {
      const table = buildTable({ shellcheckHtml: readFileSync(files[0], 'utf8'), hadolintMd: readFileSync(files[1], 'utf8'), retrieved });
      writeAtomic(ruleTitlesPath(), serialise(table));
      process.stdout.write(`${ruleTitlesPath()}: ${table.sources.shellcheck.codes} ShellCheck, ${table.sources.hadolint.codes} hadolint\n`);
    } catch (e) {
      process.stderr.write(`rule-titles: ${e.message}\n`);
      process.exitCode = 2;
    }
  }
}

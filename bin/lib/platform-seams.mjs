// bin/lib/platform-seams.mjs — measures the macOS-only seams in tracked source. docs/PLATFORM-SEAMS.md
// lists every file per class; bin/test/platform-seams.test.mjs fails on a file the doc does not list.
// Population: tracked .mjs/.cjs/.js/.sh/.bash/.zsh/.py/.ts outside test/ dirs. Whole-line comments
// are skipped (shebangs kept) except for users-path, so a seam is code or a literal, not prose.
// usage: node bin/lib/platform-seams.mjs [root] [--files]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule } from '../../lib/is-main.mjs';

export const SEAM_CLASSES = Object.freeze([
  { id: 'launchd', re: /\blaunchctl\b|\bLaunch(?:Agents|Daemons)\b|StartCalendarInterval|\bRunAtLoad\b/ },
  { id: 'keychain', re: /(?:execFile|spawn|exec|run)\w*\(\s*['"`]security['"`]|\bsecurity\s+(?:find|add|delete|dump)-|\bkeychain:|osxkeychain/ },
  // `peers`: a line that also names a portable peer is a name list (a classifier), not a dependency.
  { id: 'zsh', re: /^#!.*\bzsh\b|['"`]zsh['"`]|\bzsh\s+-|\.zshrc\b|\.zprofile\b/, peers: /\bbash\b/ },
  // Comments count here: a home path in prose discloses as much as one in code.
  { id: 'users-path', re: /\/Users\/[A-Za-z0-9_.-]/, comments: true },
  { id: 'homebrew', re: /\/opt\/homebrew\b|\/usr\/local\/Cellar\b|\bbrew\s+(?:install|--prefix|list|upgrade|info|outdated|shellenv|uninstall)\b|['"`]brew['"`]/ },
  { id: 'sandbox-exec', re: /\bsandbox-exec\b/ },
  { id: 'macos-tools', re: /\b(?:sw_vers|osascript|xcrun|codesign|notarytool|spctl|plutil|pbcopy|pbpaste|system_profiler|softwareupdate|mdfind|tccutil)\b|['"`]open['"`]\s*,\s*\[|['"`]ditto['"`]|['"`]xattr['"`]|sed -i ''|\bstat -f\b|\bdate -j\b/,
    peers: /\b(?:python|perl|ruby|node)\b/ },
]);

const SOURCE_RE = /\.(?:mjs|cjs|js|sh|bash|zsh|py|ts)$/;
const isTest = (p) => /(^|\/)test\//.test(p);
// The measurer itself names every pattern.
const SELF = new Set(['bin/lib/platform-seams.mjs']);

export const isCommentLine = (line) => {
  const t = line.trimStart();
  if (t.startsWith('#!')) return false;
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#');
};

/** Seam classes one text hits: Map<classId, lineCount>. */
export function seamsIn(text) {
  const hits = new Map();
  for (const line of text.split(/\r?\n/)) {
    const comment = isCommentLine(line);
    for (const c of SEAM_CLASSES) {
      if (comment && !c.comments) continue;
      if (c.re.test(line) && !(c.peers && c.peers.test(line))) hits.set(c.id, (hits.get(c.id) || 0) + 1);
    }
  }
  return hits;
}

/** Tracked source paths in `root`, sorted. Throws on any git failure (fail closed). */
export function sourcePaths(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return out.split('\0').filter((p) => p && SOURCE_RE.test(p) && !isTest(p) && !SELF.has(p)).sort();
}

/**
 * { population, read, missing, classes: { id: { files: { path: lines }, lines } } }.
 * A tracked path deleted from the working tree is `missing` (ENOENT only); any other read error throws.
 */
export function measure(root) {
  const paths = sourcePaths(root);
  const classes = Object.fromEntries(SEAM_CLASSES.map((c) => [c.id, { files: {}, lines: 0 }]));
  const missing = [];
  let read = 0;
  for (const p of paths) {
    let text;
    try { text = readFileSync(join(root, p), 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') { missing.push(p); continue; }
      throw e;
    }
    read++;
    for (const [id, n] of seamsIn(text)) { classes[id].files[p] = n; classes[id].lines += n; }
  }
  return { population: paths.length, read, missing, classes };
}

/** `| <class> | \`<path>\` |` rows under the doc's ratchet heading: Map<classId, Set<path>>. */
export function listedFiles(docText) {
  const start = docText.indexOf('## Ratchet allow-list');
  if (start < 0) throw new Error('PLATFORM-SEAMS.md has no "## Ratchet allow-list" section');
  const rest = docText.slice(start + 1);
  const end = rest.search(/\n## /);
  const section = end < 0 ? rest : rest.slice(0, end);
  const listed = new Map(SEAM_CLASSES.map((c) => [c.id, new Set()]));
  for (const m of section.matchAll(/^\|\s*([a-z-]+)\s*\|\s*`([^`]+)`\s*\|/gm)) {
    if (!listed.has(m[1])) throw new Error(`allow-list names unknown class "${m[1]}"`);
    listed.get(m[1]).add(m[2]);
  }
  return listed;
}

if (isMainModule(import.meta.url)) {
  const root = process.argv[2] || process.cwd();
  const r = measure(root);
  console.log(`population ${r.population} tracked source files, read ${r.read}, missing ${r.missing.length}`);
  for (const c of SEAM_CLASSES) {
    const k = r.classes[c.id];
    console.log(`${c.id.padEnd(13)} ${String(Object.keys(k.files).length).padStart(3)} files ${String(k.lines).padStart(4)} lines`);
    if (process.argv.includes('--files')) for (const [p, n] of Object.entries(k.files)) console.log(`  ${p} ${n}`);
  }
}

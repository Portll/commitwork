#!/usr/bin/env node
// usage: log-evidence.mjs [rootDir]   (default '.')
// exit: 0 ran · 2 could not run
// env, read at call time: CW_LOG_SKIP_DIRS (comma list of directory names or a/b paths; default
//   .git,node_modules,.claude/worktrees,fixtures/scan-canary/dirty — every skip is listed)
// output: {tool, summary:{findings, byRule, filesScanned, linesScanned, ...}, findings[]}
//   rule ids, paths, line counts, first/last timestamps and the NAMES of targeted secrets only —
//   never a payload, a request, an address or a value.
//
// A log that records an attack is the one place a backup still holds the attack itself, and no
// other lane reads one as evidence: on 2026-10-08 a WordPress tree from an exploited server
// carried hundreds of blind-SQL-injection lines in its own application logs, each extracting a
// secret one character at a time, and every lane passed over them. A row here says an attack was ATTEMPTED and
// recorded; whether it succeeded is never claimed, because a log cannot say.
import { readdirSync, lstatSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isMainModule } from '../lib/is-main.mjs';

export const TOOL = 'log-evidence';

export const RULES = Object.freeze({
  'sqli-blind-extraction': { sev: 'high', cwe: 'CWE-89', rx: /\b(ASCII|ORD)\s*\(\s*(SUBSTR(ING)?|MID)\s*\(|\bIF\s*\(\s*\(?\s*(ASCII|ORD|LENGTH)\s*\(/i },
  // SLEEP( only in SQL position — after AND/OR/SELECT/THEN, a comma, a quote or their encodings —
  // because `time.sleep(5)` and `await sleep(5)` are in every application log.
  'sqli-time-based': { sev: 'high', cwe: 'CWE-89', rx: /(\b(AND|OR|THEN|ELSE)\b|\bSELECT\s*\(?|[,'+]|%27|%2C|%20|%28)\s*(SLEEP|BENCHMARK)\s*\(\s*\d|\bpg_sleep\s*\(\s*\d|\bWAITFOR\s+DELAY\s+'/i },
  'sqli-union': { sev: 'med', cwe: 'CWE-89', rx: /\bUNION(\s|\/\*[^*]*\*\/|%20|\+)+(ALL(\s|%20|\+)+)?SELECT\b/i },
  'sqli-schema-probe': { sev: 'med', cwe: 'CWE-89', rx: /\binformation_schema\.(tables|columns|schemata)\b/i },
  'path-traversal': { sev: 'med', cwe: 'CWE-22', rx: /(\.\.|%2e%2e)(\/|%2f|\\|%5c)(\.\.|%2e%2e)(\/|%2f|\\|%5c)[^\s"]{0,200}(etc(\/|%2f)passwd|wp-config\.php|\.env\b|win\.ini|proc(\/|%2f)self)/i },
  'jndi-lookup': { sev: 'high', cwe: 'CWE-917', rx: /\$\{\s*(jndi|j\$\{[^}]*\}ndi)\s*:\s*(ldaps?|rmi|dns|iiop|nis|nds|corba|https?)/i },
  'php-object-injection': { sev: 'med', cwe: 'CWE-502', rx: /\bO:\d+:"[A-Za-z0-9_\\]{2,}":\d+:\{/ },
  'upload-dir-php-request': { sev: 'high', cwe: 'CWE-434', rx: /"(GET|POST|PUT|HEAD)\s+\/[^"\s]*\/(uploads|upload)\/[^"\s?]*\.(php[0-9]?|phtml|phar)(\?|\s)/i },
  'command-injection': { sev: 'med', cwe: 'CWE-78', rx: /"(GET|POST|PUT)\s+[^"\s]*(%3B|;|%7C|\||%60|`|%24%28|\$\()\s*(%20|\+)*(id|whoami|uname(%20|\+)+-a|cat(%20|\+)+(\/|%2f)etc(\/|%2f)passwd|wget(%20|\+)|curl(%20|\+)|nc(%20|\+)+-e)\b/i },
});
// A blind extraction names what it is after; the name, never the value, is the forensic lead.
const TARGET_RX = /\b(option_name|meta_key|name|key)\s*=\s*'([A-Za-z0-9_]{3,64})'/gi;
const SECRETISH = /(secret|key|pass|token|salt|auth|nonce|private|credential)/i;
const INJECTION_MARK = /\b(SLEEP|BENCHMARK)\s*\(|\b(ASCII|ORD)\s*\(\s*(SUBSTR|MID)|\bUNION\s+(ALL\s+)?SELECT\b/i;

const LOG_NAME = /(\.log(\.\d+)?(\.gz)?$|^(access|error|ssl_access|ssl_error)_log(\.\d+)?(\.gz)?$|^debug\.log$)/i;
const DEFAULT_SKIP = ['.git', 'node_modules', '.claude/worktrees', 'fixtures/scan-canary/dirty'];
const CHUNK = 4 * 1024 * 1024;
const TARGETS_CAP = 10;
const LIST_CAP = 50;
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

export const skipDirs = () => {
  const raw = process.env.CW_LOG_SKIP_DIRS;
  return raw == null ? DEFAULT_SKIP : raw.split(',').map((s) => s.trim()).filter(Boolean);
};

export const isLogFile = (name) => LOG_NAME.test(name);

// The first timestamp on a line, normalised to `YYYY-MM-DD HH:MM:SS`; null when the line has none.
// Three shapes cover web servers and PHP: ISO-ish, Apache's [dd/Mon/yyyy:hh:mm:ss] and PHP's
// [dd-Mon-yyyy hh:mm:ss].
export function lineTimestamp(line) {
  let m = /\b(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(line);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}`;
  m = /\[(\d{2})[/-]([A-Za-z]{3})[/-](\d{4})[: ](\d{2}:\d{2}:\d{2})/.exec(line);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1]} ${m[4]}`;
  return null;
}

export function lineRules(line) {
  const out = [];
  for (const [rule, r] of Object.entries(RULES)) if (r.rx.test(line)) out.push(rule);
  return out;
}

// The response status, where the line is a request a web server logged: Apache/nginx combined
// (`"GET /x HTTP/1.1" 404`), arrow-style app logs (`-> 403`) and key=value logs. null when the
// line carries none — a database or PHP log records the attempt but not the answer.
export function responseStatus(line) {
  const m = /"\s+([1-5]\d{2})\s|->\s*([1-5]\d{2})\b|\bstatus[=:]\s*"?([1-5]\d{2})\b/.exec(line);
  return m ? Number(m[1] || m[2] || m[3]) : null;
}

export function extractionTargets(line) {
  if (!INJECTION_MARK.test(line)) return [];
  const out = [];
  for (const m of line.matchAll(TARGET_RX)) if (SECRETISH.test(m[2])) out.push(m[2]);
  return out;
}

// Streams a file line by line in chunks, so a 400 MB debug.log is read whole without being held.
function* lines(abs, gz) {
  if (gz) {
    const text = gunzipSync(readFileSync(abs)).toString('latin1');
    yield* text.split(/\r?\n/);
    return;
  }
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let carry = '';
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      const text = carry + buf.toString('latin1', 0, n);
      const parts = text.split(/\r?\n/);
      carry = parts.pop();
      yield* parts;
    }
    if (carry) yield carry;
  } finally {
    closeSync(fd);
  }
}

export function scanFile(abs, name) {
  const gz = /\.gz$/i.test(name);
  const per = {};
  let count = 0;
  let last = null;
  for (const line of lines(abs, gz)) {
    count++;
    const ts = lineTimestamp(line);
    if (ts) last = ts;
    if (line.length < 8) continue;
    const hits = lineRules(line);
    if (!hits.length) continue;
    const targets = extractionTargets(line);
    for (const rule of hits) {
      const p = per[rule] || (per[rule] = { lines: 0, first: null, last: null, undated: 0, targets: new Set(), refused: 0, answered: 0, noStatus: 0 });
      p.lines++;
      const status = responseStatus(line);
      if (status == null) p.noStatus++;
      else if (status >= 400) p.refused++;
      else p.answered++;
      if (last) { if (!p.first) p.first = last; p.last = last; } else p.undated++;
      for (const t of targets) if (p.targets.size < TARGETS_CAP) p.targets.add(t);
    }
  }
  return { lines: count, per, gz };
}

const fileDate = (rel) => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(rel); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

export function scanTree(root) {
  const skip = new Set(skipDirs());
  const summary = {
    findings: 0, byRule: {}, filesScanned: 0, linesScanned: 0, bytesRead: 0, gzipped: 0, unreadable: 0,
    skipDirs: [...skip], skippedPaths: [], unreadableFiles: [],
  };
  const findings = [];
  const listed = (arr, entry) => { if (arr.length < LIST_CAP) arr.push(entry); };
  const unreadable = (rel, why) => { summary.unreadable++; listed(summary.unreadableFiles, { path: rel, why }); };

  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { unreadable(relative(root, dir) || '.', `readdir failed: ${e.code || e.message}`); return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).split('\\').join('/');
      let st;
      try { st = lstatSync(abs); } catch (err) { unreadable(rel, `lstat failed: ${err.code || err.message}`); continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (skip.has(e.name) || skip.has(rel)) { listed(summary.skippedPaths, rel); continue; }
        walk(abs);
        continue;
      }
      if (!st.isFile() || !isLogFile(e.name)) continue;
      summary.filesScanned++;
      let r;
      try { r = scanFile(abs, e.name); } catch (err) { unreadable(rel, `read failed: ${err.code || err.message}`); continue; }
      summary.linesScanned += r.lines;
      summary.bytesRead += st.size;
      if (r.gz) summary.gzipped++;
      for (const [rule, p] of Object.entries(r.per)) {
        const fallback = fileDate(rel);
        const first = p.first || fallback;
        const lastSeen = p.last || fallback;
        const when = first ? (first === lastSeen ? ` at ${first}` : ` between ${first} and ${lastSeen}`) : ' (undated)';
        const from = !p.first && fallback ? ' (date from the filename)' : '';
        const targets = p.targets.size ? `; targets ${[...p.targets].sort().join(', ')}` : '';
        // Every recorded answer a refusal is a probe that bounced, still worth a row because it says
        // the site is being aimed at, but not at the rule's own severity. Any line without a status
        // (a query log, a PHP log) keeps the rule's severity: the answer there was never recorded.
        const allRefused = p.refused > 0 && p.answered === 0 && p.noStatus === 0;
        const answers = p.refused || p.answered ? `; responses: ${p.answered} answered (1xx-3xx), ${p.refused} refused (4xx/5xx)${p.noStatus ? `, ${p.noStatus} without a status` : ''}` : '';
        const verdict = allRefused ? 'every recorded response refused it' : 'whether it succeeded is not determined';
        findings.push({ rule, path: rel, sev: allRefused ? 'low' : RULES[rule].sev, cwe: RULES[rule].cwe, lines: p.lines,
          first: first || null, last: lastSeen || null, answered: p.answered, refused: p.refused,
          detail: `${p.lines} line(s)${when}${from}${targets}${answers} — an attempt was recorded; ${verdict}` });
      }
    }
  };
  walk(root);

  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  for (const f of findings) summary.byRule[f.rule] = (summary.byRule[f.rule] || 0) + 1;
  summary.byRule = Object.fromEntries(Object.entries(summary.byRule).sort(([a], [b]) => (a < b ? -1 : 1)));
  summary.findings = findings.length;
  if (summary.unreadable) {
    summary.partial = true;
    summary.partialReasons = [`${summary.unreadable} log file(s) unreadable`];
  }
  if (summary.filesScanned === 0) {
    summary.voidReason = 'no log file in the tree (*.log, access_log, error_log, debug.log), so there was nothing to read; '
      + 'a tree without logs is a void, not evidence that nothing was attempted';
  }
  return { tool: TOOL, summary, findings };
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] || '.');
  let st;
  try { st = lstatSync(root); } catch (e) { process.stderr.write(`log-evidence: cannot read ${root}: ${e.code || e.message}\n`); process.exit(2); }
  if (!st.isDirectory()) { process.stderr.write(`log-evidence: ${root} is not a directory\n`); process.exit(2); }
  let report;
  try { report = scanTree(root); } catch (e) { process.stderr.write(`log-evidence: could not run: ${e.message}\n`); process.exit(2); }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

#!/usr/bin/env node
// bin/wp-authz.mjs — WordPress access control from source. Every place a request enters a plugin,
// theme or site (wp_ajax_ and wp_ajax_nopriv_, admin_post_ and admin_post_nopriv_,
// register_rest_route, init/admin_init and the other request hooks) is followed to the state it
// writes, and the guards on the way are read: a capability check, a nonce check, a
// permission_callback. bin/lib/wp-authz-facts.php extracts those facts with nikic/php-parser,
// parsing the code as data; the tree is never included or executed. This file decides what the
// facts mean, and most of them are not decided: a rule publishes a severity only where its
// precision was measured on adjudicated rows (RULES below says which), and everything else is an
// undetermined row with its claim kept.
//
// usage: wp-authz.mjs [rootDir]   (default '.')
// exit: 0 ran, or wrote a void or not-applicable report saying why it measured nothing · 127 php or nikic/php-parser 5
//   is absent, so the tree is UNSCANNED (stderr says so; no report) · 2 the root is unreadable or the
//   analyser failed (no report: a crash is never an empty result)
// env, read at call time: CW_PHP_BIN (default `php`), CW_PHP_PARSER_DIR (default
//   ~/.composer/vendor/nikic/php-parser, then ~/.config/composer/vendor/nikic/php-parser),
//   CW_WP_AUTHZ_SKIP_DIRS (comma list; default the shared scan exclusions plus tests, test and
//   fixtures/scan-canary), CW_WP_AUTHZ_TIMEOUT_MS (default 900000), CW_WP_AUTHZ_MEMORY (default 2G)
// output: {tool, summary:{findings, byRule, filesScanned, entries, undetermined, setAside, ...},
//   findings[], undetermined[]}
import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { excludeDirs } from './scan-exclusions.mjs';
import { headersFrom, readHead } from './lib/wordpress.mjs';

export const TOOL = 'wp-authz';
const FACTS = join(dirname(fileURLToPath(import.meta.url)), 'lib', 'wp-authz-facts.php');
const MARKER_DEPTH = 3;
const SAMPLE = 20;

export const skipDirs = () => {
  const raw = process.env.CW_WP_AUTHZ_SKIP_DIRS;
  if (raw != null) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [...excludeDirs(), 'tests', 'test', 'fixtures/scan-canary'];
};
const timeoutMs = () => { const n = Number(process.env.CW_WP_AUTHZ_TIMEOUT_MS); return Number.isFinite(n) && n > 0 ? n : 900000; };
const memory = () => (/^\d+[KMG]?$/.test(process.env.CW_WP_AUTHZ_MEMORY || '') ? process.env.CW_WP_AUTHZ_MEMORY : '2G');
const phpBin = () => process.env.CW_PHP_BIN || 'php';

/** The nikic/php-parser 5 checkout to load, or null. Read from disk, never from the scanned tree. */
export function parserDir() {
  const want = process.env.CW_PHP_PARSER_DIR;
  const tries = want ? [want] : [join(homedir(), '.composer', 'vendor', 'nikic', 'php-parser'), join(homedir(), '.config', 'composer', 'vendor', 'nikic', 'php-parser')];
  for (const d of tries) {
    const f = join(d, 'lib', 'PhpParser', 'ParserFactory.php');
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    if (text.includes('createForNewestSupportedVersion')) return d;   // the version 5 API
  }
  return null;
}

/** PHP files to parse and WordPress markers, walked in name order; symlinks are never followed. */
export function walkTree(root) {
  const skip = skipDirs();
  const names = new Set(skip.filter((d) => !d.includes('/')));
  const paths = skip.filter((d) => d.includes('/'));
  const skipped = [];
  const unreadable = [];
  const php = [];
  const markers = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { unreadable.push({ path: relative(root, dir) || '.', why: e.code || e.message }); return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).split('\\').join('/');
      let st;
      try { st = lstatSync(abs); } catch (err) { unreadable.push({ path: rel, why: err.code || err.message }); continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (e.name === '.git' || e.name.startsWith('.') || names.has(e.name) || paths.some((p) => rel === p || rel.endsWith(`/${p}`))) { skipped.push(rel); continue; }
        walk(abs, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      if (e.name.endsWith('.php')) php.push(rel);
      if (depth > MARKER_DEPTH) continue;
      if (rel === 'wp-includes/version.php' || rel.endsWith('/wp-includes/version.php')) markers.push({ kind: 'site', path: rel });
      else if (e.name.endsWith('.php') || e.name === 'style.css') {
        let h;
        try { h = headersFrom(readHead(abs), ['Plugin Name', 'Theme Name']); } catch (err) { unreadable.push({ path: rel, why: err.code || err.message }); continue; }
        if (e.name.endsWith('.php') && h['Plugin Name']) markers.push({ kind: 'plugin', path: rel });
        if (e.name === 'style.css' && h['Theme Name']) markers.push({ kind: 'theme', path: rel });
      }
    }
  };
  walk(root, 0);
  return { php, markers, skipped, unreadable };
}

// ── the decision ──────────────────────────────────────────────────────────────────────────────────
// publish: the rule's rows carry a severity. It is true only where held-out adjudicated precision
// cleared the bar written down before measuring; the measurement is in the lane's formatNotes. A
// rule with publish false keeps every row, in undetermined[], with its claim.
export const RULES = Object.freeze({
  'wp-nopriv-unguarded-write': { publish: false, cwe: 'CWE-862', claim: 'unauthenticated handler writes request data with no capability check and no nonce check' },
  'wp-ajax-unguarded-write': { publish: false, cwe: 'CWE-862', claim: 'handler open to any logged-in user (subscriber and up) writes request data with no capability check and no nonce check' },
  'wp-rest-unguarded-write': { publish: false, cwe: 'CWE-862', claim: 'REST route with no permission_callback (WordPress treats it as public) writes request data with no capability or nonce check in its callback' },
  'wp-check-discarded': { publish: false, cwe: 'CWE-252', claim: 'a nonce or capability check is called as a bare statement, so its answer gates nothing' },
  'wp-nonce-only-write': { publish: false, cwe: 'CWE-862', claim: 'handler writes state behind a nonce check and no capability check; who can reach it is whoever can obtain the nonce' },
  'wp-unproven-guard-write': { publish: false, cwe: 'CWE-862', claim: 'handler writes request data and its only guard is one this lane cannot read (a weak capability, a permission callback with no capability check, or a call named like a guard it cannot resolve)' },
  'wp-rest-public-write': { publish: false, cwe: 'CWE-862', claim: 'REST route declared public (permission_callback __return_true) writes request data' },
  'wp-rest-no-permission-callback': { publish: false, cwe: 'CWE-862', claim: 'REST route with no permission_callback (WordPress treats it as public); its callback writes nothing this lane can see, so what it discloses is the question' },
  'wp-hook-request-write': { publish: false, cwe: 'CWE-862', claim: 'a hook that runs on every request writes state when the request asks for it, with no capability check' },
  'wp-triggered-write': { publish: true, sev: 'low', cwe: 'CWE-862', claim: 'a handler with no capability check and no nonce check writes site state whenever it is called; this lane saw no request value reach the write' },
});

const NOPRIV = new Set(['ajax-nopriv', 'admin-post-nopriv']);
const PRIV = new Set(['ajax', 'admin-post']);
const strongCaps = (e) => (e.cap || []).filter((c) => !c.weak);
const anyNonce = (e) => (e.nonce || []).length > 0 || (e.nonceByName || []).length > 0;
const unprovenGuard = (e) => (e.cap || []).some((c) => c.weak) || (e.capByName || []).length > 0;
const writes = (e, pred) => (e.muts || []).filter((m) => (m.weight === 'high' || m.weight === 'med') && pred(m));
const influenced = (e) => writes(e, (m) => m.influenced);

/** Pre-registered severity: who chooses WHAT is written, then how much it matters. */
export function sevFor(muts) {
  if (muts.some((m) => m.weight === 'high' && m.keyFromRequest)) return 'high';
  if (muts.some((m) => m.weight === 'high')) return 'med';
  return 'low';
}
const mutText = (ms) => [...new Set(ms.map((m) => m.call))].slice(0, 6).join(', ');
const whereText = (ms) => { const m = ms[0]; return m ? ` (first: ${m.call} in ${m.fn}, ${m.file})` : ''; };

/** facts (bin/lib/wp-authz-facts.php's output) -> rows. Pure; deterministic in its input. */
export function classify(facts) {
  const rows = [];
  const setAside = {};
  const aside = (why) => { setAside[why] = (setAside[why] || 0) + 1; };
  const entries = Array.isArray(facts.entries) ? facts.entries : [];
  // A handler registered for both wp_ajax_ and wp_ajax_nopriv_ is judged once, as the public one.
  const publicHandlers = new Set(entries.filter((e) => NOPRIV.has(e.kind)).map((e) => `${e.handlerFile}|${e.handler}`));
  const restGuard = Array.isArray(facts.restGuard) && facts.restGuard.length > 0;
  const push = (rule, e, detail, muts, extra = {}) => {
    // a write reached only through a method name several classes share is not a proven path
    const certain = muts.some((m) => !m.viaAmbiguous);
    const sev = RULES[rule].publish && (certain || !muts.length) ? (RULES[rule].sev || sevFor(muts)) : '';
    rows.push({ rule, path: e.handlerFile, handler: e.handler, hook: e.hook, entry: e.kind, line: e.handlerLine,
      sev, cwe: RULES[rule].cwe, claim: RULES[rule].claim, detail: certain || !muts.length ? detail : `${detail}; every write found is reached through an ambiguous method name`, ...extra });
  };
  for (const e of entries) {
    const label = `${e.hook} -> ${e.handler}`;
    const strong = strongCaps(e).length > 0;
    const infl = influenced(e);
    const trig = writes(e, (m) => !m.influenced);
    const nonceTo = (e.nonce || []).map((n) => n.issuedTo);
    if (NOPRIV.has(e.kind) || PRIV.has(e.kind)) {
      if (PRIV.has(e.kind) && publicHandlers.has(`${e.handlerFile}|${e.handler}`)) { aside('also registered for unauthenticated users; judged there'); continue; }
      const pub = NOPRIV.has(e.kind);
      if (strong) { aside('capability check on the path'); continue; }
      if (!infl.length && !trig.length) { aside('no write on the path'); continue; }
      if (anyNonce(e)) {
        if (nonceTo.length && nonceTo.every((t) => t === 'cap')) { aside('nonce issued only where a capability is checked'); continue; }
        push('wp-nonce-only-write', e, `${label} writes ${mutText([...infl, ...trig])}${whereText([...infl, ...trig])} behind a nonce (${(e.nonce || []).map((n) => `${n.action}: issued ${n.issuedTo}`).concat(e.nonceByName || []).join('; ')}) and no capability check`, [...infl, ...trig], { issuedTo: [...new Set(nonceTo)].sort() });
        continue;
      }
      if (unprovenGuard(e)) { push('wp-unproven-guard-write', e, `${label} writes ${mutText([...infl, ...trig])}; guard: ${[...(e.cap || []).map((c) => c.cap), ...(e.capByName || [])].join(', ')}`, [...infl, ...trig]); continue; }
      if (infl.length) push(pub ? 'wp-nopriv-unguarded-write' : 'wp-ajax-unguarded-write', e, `${label} writes request data via ${mutText(infl)}${whereText(infl)}`, infl);
      else push('wp-triggered-write', e, `${label} writes ${mutText(trig)}${whereText(trig)} on every call; no request value reaches it`, trig);
      continue;
    }
    if (e.kind === 'rest') {
      const r = e.rest || {};
      if (r.perm === 'closed') { aside('route closed (__return_false)'); continue; }
      if (r.perm === 'callback' && r.permFacts && (r.permFacts.strong || (r.permFacts.nonce || []).length)) { aside('permission_callback checks a capability or nonce'); continue; }
      if (strong) { aside('capability check on the path'); continue; }
      if (r.perm === 'callback' || r.perm === 'unresolved') {
        if (infl.length) push('wp-unproven-guard-write', e, `REST ${e.hook} [${r.methods || 'GET'}] -> ${e.handler} writes ${mutText(infl)}; permission_callback ${r.perm === 'unresolved' ? 'could not be resolved' : `checks no capability (${(r.permFacts?.cap || []).concat(r.permFacts?.byName || []).join(', ') || 'none seen'})`}`, infl);
        else aside('permission_callback present, no request-driven write');
        continue;
      }
      if (r.perm === 'return-true') {
        if (infl.length) push('wp-rest-public-write', e, `REST ${e.hook} [${r.methods || 'GET'}] -> ${e.handler} is declared public and writes request data via ${mutText(infl)}${whereText(infl)}`, infl);
        else aside('declared public, no request-driven write');
        continue;
      }
      // permission_callback missing
      if (infl.length && !anyNonce(e) && !unprovenGuard(e) && !restGuard) {
        push('wp-rest-unguarded-write', e, `REST ${e.hook} [${r.methods || 'GET'}] -> ${e.handler} has no permission_callback and writes request data via ${mutText(infl)}${whereText(infl)}`, infl);
      } else if (infl.length) {
        push('wp-unproven-guard-write', e, `REST ${e.hook} [${r.methods || 'GET'}] -> ${e.handler} has no permission_callback and writes ${mutText(infl)}; ${restGuard ? `the tree filters ${facts.restGuard.join(', ')}, which may guard it` : 'a guard this lane cannot read is on the path'}`, infl);
      } else if (trig.length && !anyNonce(e) && !unprovenGuard(e)) {
        push('wp-triggered-write', e, `REST ${e.hook} [${r.methods || 'GET'}] -> ${e.handler} has no permission_callback and writes ${mutText(trig)}${whereText(trig)} on every call; no request value reaches it`, trig);
      } else {
        push('wp-rest-no-permission-callback', e, `REST ${e.hook} [${r.methods || 'GET'}] -> ${e.handler} has no permission_callback`, []);
      }
      continue;
    }
    if (e.kind === 'hook') {
      if (String(e.hook).startsWith('load-')) { aside('load-* hook: core checks the page capability first'); continue; }
      if (e.hook === 'current_screen' && e.screen) { aside('current_screen callback scoped to a screen'); continue; }
      if (strong) { aside('capability check on the path'); continue; }
      const req = writes(e, (m) => m.influenced || m.triggered);
      if (!req.length) { aside('hook writes nothing the request influences or triggers'); continue; }
      push('wp-hook-request-write', e, `${e.hook} -> ${e.handler} writes ${mutText(req)}${whereText(req)} when the request asks${anyNonce(e) ? ', behind a nonce check' : ', no nonce check'}`, req);
    }
  }
  for (const d of Array.isArray(facts.discarded) ? facts.discarded : []) {
    rows.push({ rule: 'wp-check-discarded', path: d.file, handler: d.fn, hook: d.call, entry: 'statement', line: d.line,
      sev: RULES['wp-check-discarded'].publish ? 'low' : '', cwe: d.call === 'current_user_can' || d.call === 'user_can' ? 'CWE-862' : 'CWE-352',
      claim: RULES['wp-check-discarded'].claim, detail: `${d.call}() result discarded in ${d.fn}` });
  }
  // identity is (rule, path, handler, hook); a second registration of the same thing is one row
  const seen = new Map();
  for (const r of rows) { const k = `${r.rule}|${r.path}|${r.handler}|${r.hook}`; if (!seen.has(k)) seen.set(k, r); }
  const out = [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1
    : a.handler < b.handler ? -1 : a.handler > b.handler ? 1 : a.hook < b.hook ? -1 : a.hook > b.hook ? 1 : 0));
  return { findings: out.filter((r) => r.sev), undetermined: out.filter((r) => !r.sev), setAside };
}

function voidReport(summary, why) {
  return { tool: TOOL, summary: { ...summary, findings: 0, byRule: {}, filesScanned: 0, voidReason: why }, findings: [], undetermined: [] };
}

function notApplicable(summary, why) {
  return { tool: TOOL, summary: { ...summary, findings: 0, byRule: {}, filesScanned: 0, applicable: false, notApplicableReason: why }, findings: [], undetermined: [] };
}

export class Unscanned extends Error { constructor(m) { super(m); this.code = 127; } }

/** Run bin/lib/wp-authz-facts.php over the walked PHP files; throws Unscanned when it cannot run at all. */
export function extractFacts(root, phpFiles) {
  const pdir = parserDir();
  const php = phpBin();
  const ver = spawnSync(php, ['-r', 'echo PHP_VERSION;'], { encoding: 'utf8' });
  if (ver.error || ver.status !== 0) throw new Unscanned(`php is not runnable (${php}: ${ver.error ? ver.error.code : `exit ${ver.status}`})`);
  if (!pdir) throw new Unscanned('nikic/php-parser 5 was not found (set CW_PHP_PARSER_DIR, or composer global require nikic/php-parser:^5)');
  const r = spawnSync(php, ['-d', 'zend.assertions=-1', '-d', `memory_limit=${memory()}`, '-d', 'display_errors=stderr', FACTS, pdir, root],
    { input: `${phpFiles.join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs() });
  if (r.error) throw new Error(`the analyser did not finish: ${r.error.code || r.error.message}`);
  if (r.status === 127) throw new Unscanned(String(r.stderr || '').trim().slice(0, 300) || 'nikic/php-parser 5 did not load');
  if (r.status !== 0) throw new Error(`the analyser exited ${r.status}: ${String(r.stderr || '').trim().split('\n')[0].slice(0, 300)}`);
  let facts;
  try { facts = JSON.parse(r.stdout); } catch { throw new Error('the analyser printed something that is not JSON'); }
  if (!facts || facts.tool !== 'wp-authz-facts' || !Array.isArray(facts.entries)) throw new Error('the analyser output has the wrong shape');
  facts.php = ver.stdout.trim();
  return facts;
}

export function scanTree(root) {
  const walked = walkTree(root);
  const base = { findings: 0, byRule: {}, filesScanned: 0, phpFiles: walked.php.length, components: walked.markers,
    skipDirs: skipDirs(), skippedPaths: walked.skipped.slice(0, 200), unreadable: walked.unreadable.length };
  if (walked.unreadable.length) base.unreadableFiles = walked.unreadable.slice(0, SAMPLE);
  if (!walked.php.length) return voidReport(base, 'no PHP files outside the skipped directories');
  // PHP that is not WordPress is outside this lane, not unmeasured by it
  if (!walked.markers.length) return notApplicable(base, `no WordPress marker within ${MARKER_DEPTH} directories of the root (a Plugin Name header, a theme style.css, or wp-includes/version.php), so WordPress entry points cannot be assumed`);
  const facts = extractFacts(root, walked.php);
  const { findings, undetermined, setAside } = classify(facts);
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const undByRule = {};
  for (const u of undetermined) undByRule[u.rule] = (undByRule[u.rule] || 0) + 1;
  const kinds = {};
  for (const e of facts.entries) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  const summary = { ...base, findings: findings.length, byRule, filesScanned: facts.parsed, notWordPress: Number(facts.notWordPress) || 0, parser: { name: 'nikic/php-parser', major: 5, php: facts.php },
    entries: kinds, routes: facts.routes, unresolvedEntries: facts.unresolvedEntries.length,
    undetermined: { count: undetermined.length, byRule: undByRule, note: 'rows whose rule has no measured precision that clears the publication bar; each keeps its claim and carries no severity' },
    setAside: { count: Object.values(setAside).reduce((a, b) => a + b, 0), byReason: setAside } };
  const reasons = [];
  if (facts.parseErrors.length) { reasons.push(`${facts.parseErrors.length} PHP file(s) could not be parsed`); summary.parseErrors = facts.parseErrors.slice(0, SAMPLE); }
  if (facts.unresolvedEntries.length) { reasons.push(`${facts.unresolvedEntries.length} entry point(s) whose handler could not be resolved`); summary.unresolvedSample = facts.unresolvedEntries.slice(0, SAMPLE).map((u) => ({ kind: u.kind, hook: u.hook, file: u.file, how: u.how })); }
  const trunc = facts.entries.filter((e) => e.truncated).length;
  if (trunc) reasons.push(`${trunc} handler(s) call deeper than the analyser follows`);
  if (walked.unreadable.length) reasons.push(`${walked.unreadable.length} path(s) unreadable`);
  if (reasons.length) { summary.partial = true; summary.partialReasons = reasons; }
  if (!facts.parsed) return voidReport(base, `none of ${walked.php.length} PHP file(s) parsed`);
  return { tool: TOOL, summary, findings, undetermined };
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] || '.');
  let st;
  try { st = lstatSync(root); } catch (e) { process.stderr.write(`wp-authz: cannot read ${root}: ${e.code || e.message}\n`); process.exit(2); }
  if (!st.isDirectory()) { process.stderr.write(`wp-authz: ${root} is not a directory\n`); process.exit(2); }
  let report;
  try { report = scanTree(root); } catch (e) {
    if (e instanceof Unscanned) { process.stderr.write(`wp-authz: ${e.message} -- this lane did NOT run and this repo is UNSCANNED for WordPress access-control findings, not clean\n`); process.exit(127); }
    process.stderr.write(`wp-authz: could not run: ${e.message} -- NOT a clean scan\n`); process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

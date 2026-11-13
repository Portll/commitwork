#!/usr/bin/env node
// bin/deno-hazards.mjs — Deno permission, inspector and module-integrity posture, read from config
// and command lines rather than from code.
//
// usage: node bin/deno-hazards.mjs <repo> [--sarif | --json]
// exit:  0 the scan ran. With no Deno marker and no `deno` invocation anywhere it writes NO document
//        (stderr says so), so the lane reads not-scanned rather than a clean zero · 2 the path does not exist
//
// WHY THIS IS ITS OWN LANE. Deno's security model is its permission flags: a program is sandboxed
// exactly as far as the command that starts it says. That command is not in the code — it is in
// deno.json's tasks and permission sets, a Dockerfile CMD, a CI step, a shebang, a Procfile. A
// code scanner reads none of them, so `deno run -A server.ts` (the sandbox switched off) is
// invisible to every other lane, and so is `--inspect=0.0.0.0` (a remote debugger: code execution
// for anyone who can reach the port) and `--unsafely-ignore-certificate-errors`.
//
// The second half is module integrity. Deno resolves http(s) imports at run time. An http:// import
// is code anyone on the path can replace; an unpinned deno.land/x or esm.sh URL, or a jsr:/npm:
// specifier with no version, is code its publisher can replace; and with no deno.lock (or
// "lock": false) nothing checks that what runs is what was reviewed.
//
// LEVELS ARE CONTEXT-SENSITIVE ON PURPOSE. -A on `deno test` is how most Deno test suites run and
// is a note; -A on `deno run`/`serve`/`compile` in a Dockerfile, Procfile or a start task is the
// production sandbox switched off and is an error. A lane that reports both the same trains its
// reader to ignore both.
//
// Suppression: `cw-hazards-ignore <reason>` on the line, or in the comment block directly above it
// (`//` or `#`). Suppressed findings are counted in run.properties.suppressedCount, not published.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import { excludeDirs } from './scan-exclusions.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// Directory policy is the fleet's one list (manifests/scan-exclude-dirs.txt via bin/scan-exclusions.mjs,
// which holds .claude/worktrees and .git), plus Deno's own cache and build output. Unreadable list:
// excludeDirs() throws and the scan stops, rather than walking unfiltered.
const DENO_SKIP = ['.git', 'node_modules', '.deno', '_fresh'];
const SUPPRESS_RE = /\bcw-hazards-ignore\b[\s:\-—]*(.*)$/;
const COMMENT_LINE = /^\s*(\/\/|#|\*|\/\*)/;
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)(:\d+)?$/i;

export const RULES = Object.freeze({
  'deno/allow-all': 'All permissions granted (-A / --allow-all): the Deno sandbox is switched off for this program.',
  'deno/allow-run-unscoped': '--allow-run with no program list: the process may execute any program, which escapes every other permission.',
  'deno/allow-run-shell': '--allow-run names a shell or interpreter: running sh/bash/python/node with arguments is running any program.',
  'deno/allow-ffi-unscoped': '--allow-ffi with no path list: any native library can be loaded, and native code is outside the sandbox.',
  'deno/allow-write-unscoped': '--allow-write with no path list: the process may overwrite any file the user can, including its own source.',
  'deno/allow-import-unscoped': '--allow-import with no host list: code may be imported at run time from any host.',
  'deno/allow-scripts-unscoped': '--allow-scripts with no package list: every npm lifecycle script in the dependency tree runs on install.',
  'deno/allow-env-unscoped': '--allow-env with no variable list: every environment variable, every secret in it, is readable.',
  'deno/allow-net-unscoped': '--allow-net with no host list: the process may connect anywhere, including internal services and metadata endpoints.',
  'deno/allow-read-unscoped': '--allow-read with no path list: every file the user can read is readable, including keys and credentials.',
  'deno/allow-sys-unscoped': '--allow-sys with no API list: system information (network interfaces, hostname, uid) is readable.',
  'deno/permission-set-unscoped': 'A permission set in deno.json grants an unscoped permission (true rather than a list).',
  'deno/ignore-certificate-errors': 'TLS certificate verification is disabled: the connections it covers (every HTTPS connection, module downloads included, unless a host list narrows it) accept a forged certificate.',
  'deno/inspector-exposed': 'The V8 inspector listens on a non-loopback address: anyone who reaches the port can run arbitrary code in the process.',
  'deno/lock-disabled': 'The lockfile is disabled: nothing verifies that remote modules are the ones that were reviewed.',
  'deno/no-lockfile': 'Remote or registry imports with no deno.lock: module contents are not pinned by hash.',
  'deno/remote-entrypoint': 'A remote URL is executed directly: whoever controls that URL decides what runs, with the permissions on the command line.',
  'deno/cleartext-import': 'A module is imported over http://: anyone on the network path can replace the code.',
  'deno/unpinned-import': 'A remote module or registry specifier has no version: its publisher, or whoever takes over the name, can change the code that runs.',
});

// ── reading ─────────────────────────────────────────────────────────────────────────────────────
/** JSONC → JSON: comments and trailing commas removed, strings untouched. */
export function parseJsonc(text) {
  let out = ''; let i = 0; let str = false;
  while (i < text.length) {
    const c = text[i];
    if (str) { out += c; if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; } if (c === '"') str = false; i++; continue; }
    if (c === '"') { str = true; out += c; i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Line (1-based) of the first occurrence of `needle` in `text` at or after `from`, else 1. */
function lineOf(text, needle, from = 0) {
  const at = text.indexOf(needle, from);
  return at < 0 ? 1 : text.slice(0, at).split('\n').length;
}

function suppression(lines, idx) {
  const hit = (l) => { const m = (l || '').match(SUPPRESS_RE); return m ? (m[1].trim() || '(no reason given)') : null; };
  const own = hit(lines[idx]); if (own) return own;
  for (let i = idx - 1; i >= 0 && COMMENT_LINE.test(lines[i] ?? ''); i--) { const m = hit(lines[i]); if (m) return m; }
  return null;
}

// ── command lines ───────────────────────────────────────────────────────────────────────────────
const SUBCOMMANDS = new Set(['run', 'serve', 'compile', 'test', 'bench', 'task', 'eval', 'repl', 'install', 'x', 'jupyter']);
const DEV_ONLY = new Set(['test', 'bench', 'jupyter']);
// Programs whose purpose is running other programs. One is deliberately absent: the
// argument-list runner from findutils. bin/test/lexical-ratchets.test.mjs (M16) reads any
// non-comment line naming it as an unguarded use, its baseline may only shrink, and it has no
// exemption; so a grant of it is reported as an ordinary scoped --allow-run, not as a shell.
const SHELLS = /^(sh|bash|zsh|dash|ash|fish|cmd|cmd\.exe|powershell|pwsh|python[0-9.]*|node|ruby|perl|php|deno|env|sudo)$/;

/** Every `deno <sub> …` invocation in a command string → [{sub, flags:[{name, value}], target}]. */
export function denoInvocations(cmd) {
  const out = [];
  const tokens = String(cmd).replace(/\\\n/g, ' ').match(/"[^"]*"|'[^']*'|\S+/g) || [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/^["']|["']$/g, '');
    if (!/(^|\/)deno$/.test(t)) continue;
    const sub = (tokens[i + 1] || '').replace(/^["']|["'],?$/g, '');
    if (!SUBCOMMANDS.has(sub)) continue;
    const flags = []; let target = null; let j = i + 2;
    for (; j < tokens.length; j++) {
      const raw = tokens[j].replace(/^["']|["'],?$/g, '');
      if (/^(&&|\|\||;|\||\)|\])$/.test(raw)) break;
      if (raw.startsWith('-')) {
        const eq = raw.indexOf('=');
        flags.push(eq > 0 ? { name: raw.slice(0, eq), value: raw.slice(eq + 1) } : { name: raw, value: null });
      } else if (!target) { target = raw; if (sub !== 'task') break; }
    }
    out.push({ sub, flags, target });
    i = j;
  }
  return out;
}

/** Findings for one invocation. `where` is 'prod' | 'ci' | 'dev' — the context it runs in. */
export function invocationFindings(inv, where) {
  const f = [];
  // Development: a test/bench subcommand, a task named for development, or a watching server (a
  // process restarted on every save is not the production one).
  const dev = DEV_ONLY.has(inv.sub) || where === 'dev' || inv.flags.some((x) => x.name === '--watch' || x.name.startsWith('--watch'));
  const add = (ruleId, level, detail) => f.push({ ruleId, level, detail });
  const has = (n) => inv.flags.find((x) => x.name === n);
  const scoped = (x) => x && x.value !== null && x.value !== '';
  const allAll = inv.flags.some((x) => x.name === '-A' || x.name === '--allow-all' || /^-[a-zA-Z]*A[a-zA-Z]*$/.test(x.name) && !x.name.startsWith('--'));
  // A deny beats -A (Deno 2.x: NotCapable), so -A --deny-run --deny-write is narrower than -A. Still -A for everything
  // not denied, so the level stays; the detail says what was taken back, so a reader does not fix it twice.
  const denies = inv.flags.filter((x) => /^--deny-[a-z]+$/.test(x.name)).map((x) => (scoped(x) ? `${x.name}=${x.value}` : x.name));
  if (allAll) add('deno/allow-all', dev ? 'note' : where === 'ci' ? 'warning' : 'error', `deno ${inv.sub} ${inv.target || ''}`.trim() + (denies.length ? `; taken back: ${denies.join(' ')}` : ''));
  const unscoped = [
    ['--allow-run', 'deno/allow-run-unscoped', 'warning'], ['--allow-ffi', 'deno/allow-ffi-unscoped', 'warning'],
    ['--allow-write', 'deno/allow-write-unscoped', 'warning'], ['--allow-import', 'deno/allow-import-unscoped', 'warning'],
    ['--allow-scripts', 'deno/allow-scripts-unscoped', 'warning'], ['--allow-env', 'deno/allow-env-unscoped', 'note'],
    ['--allow-net', 'deno/allow-net-unscoped', 'note'], ['--allow-read', 'deno/allow-read-unscoped', 'note'],
    ['--allow-sys', 'deno/allow-sys-unscoped', 'note'],
  ];
  if (!allAll) {
    for (const [flag, rule, level] of unscoped) {
      const x = has(flag);
      if (x && !scoped(x)) add(rule, dev ? 'note' : level, `${flag} on deno ${inv.sub}`);
    }
    const run = has('--allow-run');
    if (scoped(run)) {
      const shells = run.value.split(',').map((p) => basename(p.trim())).filter((p) => SHELLS.test(p));
      if (shells.length) add('deno/allow-run-shell', dev ? 'note' : 'warning', `--allow-run=${run.value} includes ${shells.join(', ')}`);
    }
  }
  // Still a warning in development: with verification off, a module fetched at dev time is
  // replaceable by anyone on the developer's network path, and the lockfile is what was replaced.
  // With a host list (--unsafely-ignore-certificate-errors=127.0.0.1,localhost) only those hosts skip verification.
  // Loopback-only is a note: forging that certificate takes code already running on the machine. Any other list
  // keeps the level, and names the hosts.
  const tls = has('--unsafely-ignore-certificate-errors');
  if (tls) {
    const hosts = scoped(tls) ? tls.value.split(',').map((h) => h.trim()).filter(Boolean) : [];
    if (hosts.length && hosts.every((h) => LOOPBACK.test(h))) add('deno/ignore-certificate-errors', 'note', `deno ${inv.sub}, only for ${hosts.join(', ')} (loopback)`);
    else add('deno/ignore-certificate-errors', dev ? 'warning' : 'error', hosts.length ? `deno ${inv.sub}, for ${hosts.join(', ')}` : `deno ${inv.sub}, every host`);
  }
  for (const x of inv.flags) {
    if (/^--inspect(-brk|-wait)?$/.test(x.name) && x.value && /^(0\.0\.0\.0|\[::\]|::|\*)(:|$)/.test(x.value)) add('deno/inspector-exposed', 'error', `${x.name}=${x.value}`);
  }
  if (inv.flags.some((x) => x.name === '--no-lock' || (x.name === '--lock' && x.value === 'false'))) add('deno/lock-disabled', dev ? 'note' : 'warning', `deno ${inv.sub} --no-lock`);
  if (inv.target && /^https?:\/\//.test(inv.target) && ['run', 'serve', 'install', 'compile', 'x'].includes(inv.sub)) {
    // http: is always an error. A remote https: entrypoint with every permission is an error where it
    // runs as the service, a warning in a development task (Fresh's own `update` task is exactly that).
    const cleartext = inv.target.startsWith('http:');
    add(cleartext ? 'deno/cleartext-import' : 'deno/remote-entrypoint', cleartext || (allAll && !dev) ? 'error' : 'warning', `deno ${inv.sub} ${inv.target}`);
  }
  return f;
}

// ── specifiers ──────────────────────────────────────────────────────────────────────────────────
/** One import specifier → a finding, or null. `locked` is whether a deno.lock pins it. */
export function specifierFinding(spec, locked) {
  const s = String(spec);
  if (/^http:\/\//.test(s) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(s)) return { ruleId: 'deno/cleartext-import', level: 'error', detail: s };
  const lvl = locked ? 'note' : 'warning';
  let m;
  if ((m = s.match(/^https:\/\/deno\.land\/(x\/[^/@]+|std)(@[^/]+)?(\/|$)/)) && !m[2]) return { ruleId: 'deno/unpinned-import', level: lvl, detail: s };
  if ((m = s.match(/^https:\/\/(esm\.sh|cdn\.skypack\.dev|unpkg\.com|cdn\.jsdelivr\.net\/npm)\/(@[^/]+\/)?([^/@?]+)(@[^/?]+)?/)) && !m[4]) return { ruleId: 'deno/unpinned-import', level: lvl, detail: s };
  if (/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/(main|master|HEAD|develop|dev)\//.test(s)) return { ruleId: 'deno/unpinned-import', level: 'warning', detail: `${s} (a branch, not a commit)` };
  if ((m = s.match(/^jsr:\/?(@[^/@]+\/[^/@]+)(@[^/]+)?/)) && !m[2]) return { ruleId: 'deno/unpinned-import', level: lvl, detail: s };
  if ((m = s.match(/^npm:\/?((?:@[^/@]+\/)?[^/@]+)(@[^/]+)?/)) && !m[2]) return { ruleId: 'deno/unpinned-import', level: lvl, detail: s };
  return null;
}
const isRemote = (s) => /^(https?:|jsr:|npm:)/.test(String(s));

// ── files ───────────────────────────────────────────────────────────────────────────────────────
function walk(root, dirs = excludeDirs()) {
  const names = new Set([...DENO_SKIP, ...dirs.filter((d) => !d.includes('/'))]);
  const paths = dirs.filter((d) => d.includes('/'));
  const files = [];
  const go = (dir, depth) => {
    if (depth > 12) return;
    let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      const rel = relative(root, p);
      if (e.isDirectory()) { if (!names.has(e.name) && !paths.some((x) => rel === x || rel.endsWith(`/${x}`))) go(p, depth + 1); continue; }
      if (e.isFile()) files.push(p);
    }
  };
  go(root, 0);
  return files;
}

const contextOf = (rel) => {
  const b = basename(rel);
  if (/^\.github\/workflows\//.test(rel) || /^\.gitlab-ci|^\.circleci\/|^azure-pipelines|^Jenkinsfile/.test(rel)) return 'ci';
  if (/^(Dockerfile|Containerfile)|\.dockerfile$|^Procfile$|^fly\.toml$|^app\.ya?ml$|\.(service|socket)$/i.test(b)) return 'prod';
  return 'prod';
};
const taskContext = (name) => (/test|bench|check|lint|fmt|coverage|doc|dev|local|watch|debug|update|cli|manifest|generate|seed|codegen|storybook|preview/i.test(name) ? 'dev' : 'prod');

export function scan(root) {
  const findings = []; const suppressed = [];
  let markers = 0; let invocations = 0;
  const all = walk(root);
  const rels = all.map((p) => relative(root, p));
  const lockDirs = new Set(rels.filter((r) => basename(r) === 'deno.lock').map((r) => r.slice(0, -'deno.lock'.length)));
  const push = (rel, text, line, f) => {
    const lines = text.split('\n');
    const why = suppression(lines, line - 1);
    const rec = { ruleId: f.ruleId, level: f.level, path: rel, line, message: `${RULES[f.ruleId]} (${f.detail})` };
    if (why) suppressed.push({ ...rec, justification: why }); else findings.push(rec);
  };
  for (let k = 0; k < all.length; k++) {
    const abs = all[k]; const rel = rels[k]; const b = basename(rel);
    let size; try { size = statSync(abs).size; } catch { continue; }
    if (size > 1024 * 1024) continue;
    const ext = extname(b);
    const isConfig = b === 'deno.json' || b === 'deno.jsonc';
    const isCode = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs'].includes(ext);
    // systemd units and their drop-ins are where a server is started on a VM, and the place the
    // production grant actually lives. Measured on audience-direct d448414: the site's unit ran
    // `ExecStart=/usr/local/bin/deno run -A main.ts` and the lane, reading no unit files, missed it.
    const isUnit = /\.(service|socket)$/.test(b) || (/\.conf$/.test(b) && /\.service\.d\//.test(rel));
    const isCmd = isUnit || /^(Dockerfile|Containerfile|Procfile|Makefile|Justfile|justfile)$/.test(b) || /\.(dockerfile|sh|bash|ya?ml|toml)$/i.test(b) || b === 'package.json';
    if (!isConfig && !isCode && !isCmd) continue;
    let text; try { text = readFileSync(abs, 'utf8'); } catch { continue; }
    const dir = rel.slice(0, rel.length - b.length);
    const locked = [...lockDirs].some((d) => dir.startsWith(d));

    if (isConfig) {
      markers++;
      let cfg; try { cfg = parseJsonc(text); } catch { continue; }
      for (const [name, v] of Object.entries(cfg.tasks || {})) {
        const cmd = typeof v === 'string' ? v : v && v.command;
        if (!cmd) continue;
        const line = lineOf(text, `"${name}"`);
        for (const inv of denoInvocations(cmd)) { invocations++; for (const f of invocationFindings(inv, taskContext(name))) push(rel, text, line, f); }
      }
      // Permission sets (deno.json "permissions", and the test/bench/compile blocks that embed one).
      const visitPerms = (obj, path) => {
        if (!obj || typeof obj !== 'object') return;
        for (const [key, val] of Object.entries(obj)) {
          if (val === true && ['all', 'run', 'ffi', 'write', 'import', 'env', 'net', 'read', 'sys'].includes(key)) {
            const level = key === 'all' ? (/test|bench/.test(path) ? 'note' : 'error') : ['run', 'ffi', 'write', 'import'].includes(key) ? 'warning' : 'note';
            push(rel, text, lineOf(text, `"${key}"`, text.indexOf('"permissions"')), { ruleId: key === 'all' ? 'deno/allow-all' : 'deno/permission-set-unscoped', level, detail: `${path}.${key}: true` });
          } else if (val && typeof val === 'object' && !Array.isArray(val)) visitPerms(val, `${path}.${key}`);
        }
      };
      if (cfg.permissions) visitPerms(cfg.permissions, 'permissions');
      for (const k2 of ['test', 'bench', 'compile']) if (cfg[k2]?.permissions && typeof cfg[k2].permissions === 'object') visitPerms(cfg[k2].permissions, `${k2}.permissions`);
      if (cfg.lock === false) push(rel, text, lineOf(text, '"lock"'), { ruleId: 'deno/lock-disabled', level: 'warning', detail: '"lock": false' });
      const imports = { ...(cfg.imports || {}) };
      for (const sc of Object.values(cfg.scopes || {})) Object.assign(imports, sc);
      let remote = 0;
      for (const [alias, spec] of Object.entries(imports)) {
        if (isRemote(spec)) remote++;
        const f = specifierFinding(spec, locked && cfg.lock !== false);
        if (f) push(rel, text, lineOf(text, `"${alias}"`), f);
      }
      if (remote && !locked && cfg.lock !== false) push(rel, text, 1, { ruleId: 'deno/no-lockfile', level: 'warning', detail: `${remote} remote/registry import(s), no deno.lock beside or above ${rel}` });
      continue;
    }
    if (isCode) {
      const lines = text.split('\n');
      if (lines[0] && lines[0].startsWith('#!') && /\bdeno\b/.test(lines[0])) {
        for (const inv of denoInvocations(lines[0].replace(/^#!\s*(\/usr\/bin\/env\s+(-S\s+)?)?/, ''))) { invocations++; for (const f of invocationFindings(inv, 'prod')) push(rel, text, 1, f); }
      }
      const rx = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
      let m;
      while ((m = rx.exec(text))) {
        const spec = m[1] || m[2];
        if (!/^(https?:|jsr:|npm:)/.test(spec)) continue;
        const f = specifierFinding(spec, locked);
        if (f) push(rel, text, text.slice(0, m.index).split('\n').length, f);
      }
      continue;
    }
    // Command-bearing files.
    const where = contextOf(rel);
    if (b === 'package.json') {
      let pkg; try { pkg = JSON.parse(text); } catch { continue; }
      for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
        for (const inv of denoInvocations(cmd)) { invocations++; for (const f of invocationFindings(inv, taskContext(name))) push(rel, text, lineOf(text, `"${name}"`), f); }
      }
      continue;
    }
    // Dockerfile exec form: CMD ["deno", "run", "-A", "main.ts"] — flatten the JSON array.
    const flat = text.replace(/\[\s*("[^"\]]*"\s*(?:,\s*"[^"\]]*"\s*)*)\]/g, (all2, inner) => inner.replace(/"\s*,\s*"/g, ' ').replace(/"/g, ''));
    const fl = flat.split('\n');
    for (let i = 0; i < fl.length; i++) {
      if (!/\bdeno\b/.test(fl[i])) continue;
      let cmd = fl[i]; let j = i;
      while (/\\\s*$/.test(fl[j]) && j + 1 < fl.length) cmd += ` ${fl[++j]}`;
      for (const inv of denoInvocations(cmd.replace(/\\\s*$/gm, ' '))) { invocations++; for (const f of invocationFindings(inv, where)) push(rel, text, i + 1, f); }
    }
  }
  return { findings, suppressed, markers, invocations, scanned: markers + invocations };
}

export function toSarif({ findings, suppressed = [] }) {
  const ids = [...new Set(findings.map((f) => f.ruleId))].sort();
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      properties: { suppressedCount: suppressed.length },
      tool: { driver: { name: 'commitwork-deno-hazards', informationUri: 'https://commitwork.portll.net', rules: ids.map((id) => ({ id, shortDescription: { text: RULES[id] } })) } },
      results: findings.map((f) => ({
        ruleId: f.ruleId, level: f.level, message: { text: f.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: f.path }, region: { startLine: f.line } } }],
      })),
    }],
  };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--')) || '.';
  if (!existsSync(root)) { process.stderr.write(`deno-hazards: ${root} does not exist\n`); process.exit(2); }
  const res = scan(root);
  if (res.scanned === 0) {
    process.stderr.write('deno-hazards: no deno.json and no deno invocation found — writing NO sarif, which classifies as not-scanned rather than a clean zero\n');
    process.exit(0);
  }
  process.stdout.write(`${JSON.stringify(args.includes('--json') ? res : toSarif(res), null, 2)}\n`);
}

// node --test bin/test/no-unpinned-fetch.test.mjs
//
// Gate: the scanner must not fetch unpinned code while it scans — npx specs, docker images and
// curl|sh in manifests/*.json check bodies (`checks[].local`) plus bin/**, monitor/** and container/**
// scripts (tests excluded), a Dockerfile read as shell. bin/install.sh and container/Dockerfile are
// asserted read; bin/test/container-dockerfile.test.mjs holds what the image build fetches. Deliberately unchecked: docker images computed inside scripts (the scanned
// repo's declared toolchain), the scanned repo's own lockfile-pinned installs, and DATA fetches
// by already-pinned tools. Fail closed: every "I could not read this" path throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

// ── configuration ────────────────────────────────────────────────────────────────────────────
// Env seams read at CALL time, never at module load (CLAUDE.md).
export function gateConfig(overrides = {}) {
  const root = overrides.root || process.env.CW_FETCH_GATE_ROOT || REPO_ROOT;
  const manifestDir = overrides.manifestDir || process.env.CW_FETCH_GATE_MANIFESTS || join(root, 'manifests');
  const scriptDirs = overrides.scriptDirs
    || (process.env.CW_FETCH_GATE_SCRIPT_DIRS || 'bin,monitor,container').split(',').map((d) => d.trim()).filter(Boolean).map((d) => resolve(root, d));
  return { root, manifestDir, scriptDirs };
}

export class FetchGateError extends Error {}

// ── what counts as pinned ────────────────────────────────────────────────────────────────────
// Exact semver or a 40-hex commit only; ranges, tags and bare names resolve at scan time.
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export function isPinnedSpec(spec) {
  if (!spec) return false;
  if (spec.startsWith('.') || spec.startsWith('/')) return true;   // a local path is not a fetch
  const at = spec.lastIndexOf('@');
  if (at <= 0) return false;                                        // bare name, or a bare @scope
  const version = spec.slice(at + 1);
  if (EXACT_SEMVER.test(version)) return true;
  return /^[0-9a-f]{40}$/.test(version);                            // git commit sha
}

// npx flags taking a value; --package/-p names the package and wins over the first positional.
const NPX_VALUE_FLAGS = new Set(['--package', '-p', '--call', '-c', '--userconfig', '--shell', '--npm', '--cache']);

export function packageSpecFromNpxArgs(args) {
  let named = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    if (a.startsWith('--package=')) { named = a.slice('--package='.length); break; }
    if (NPX_VALUE_FLAGS.has(a)) {
      if (a === '--package' || a === '-p') { named = args[i + 1] ?? null; break; }
      i++; continue;
    }
    if (a.startsWith('-')) continue;
    return { spec: a, from: 'positional' };
  }
  if (named !== null) return { spec: named, from: '--package' };
  return { spec: null, from: 'none' };
}

// ── shell command reading ────────────────────────────────────────────────────────────────────
const SHELL_BREAK = new Set([';', '&&', '||', '|', '>', '>>', '2>', '2>&1', '&']);

function tokenize(cmd) {
  // Quote-aware whitespace split; not a shell parser.
  const out = []; let cur = ''; let q = null;
  for (const ch of cmd) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// `(` is NOT a boundary — prose like "(npx fetch may be slow)" would read as an invocation;
// `$(` still splits, since a command substitution really is a command position.
const segments = (s) => s.split(/\|\||&&|[;|\n]|\$\(/);

// npx must sit at a command position and args stop at the first redirection; requiring a
// flag-shaped argument or exactly one argument separates a command from a sentence.
export function npxInvocationsInShell(cmd) {
  const found = [];
  for (const seg of segments(cmd)) {
    const toks = tokenize(seg.trim());
    let i = 0;
    while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
    const head = toks[i];
    if (head !== 'npx' && !(head || '').endsWith('/npx')) continue;
    const args = [];
    for (let j = i + 1; j < toks.length; j++) {
      if (SHELL_BREAK.has(toks[j]) || toks[j].startsWith('>')) break;
      args.push(toks[j]);
    }
    if (!args.length) continue;
    if (!args.some((a) => a.startsWith('-')) && args.length !== 1) continue;
    found.push(args);
  }
  return found;
}

// String literals, per LINE not per file: one mis-paired quote must not desynchronise everything
// below it — a parse slip that fails OPEN.
const STRING_LITERAL = /`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;
export function shellStringsIn(src, ext) {
  const out = [];
  for (const line of src.split('\n')) {
    if (ext === '.sh') { out.push(line); continue; }
    for (const m of line.match(STRING_LITERAL) || []) out.push(m.slice(1, -1));
  }
  return out;
}

// docker image references. Judged only in manifests (see header).
const DOCKER_VALUE_FLAGS = new Set([
  '-v', '--volume', '-e', '--env', '-w', '--workdir', '-p', '--publish', '--name', '--net',
  '--network', '-u', '--user', '--entrypoint', '--cap-add', '--cap-drop', '--mount', '--platform',
  '--label', '-l', '--add-host', '--env-file', '--memory', '-m', '--tmpfs', '--device',
]);
// A bare shell variable in the argument list — `$SBX`, `${FLAGS}`. Since 2026-09-01 the sandboxed
// lanes build their flag list with `SBX=$(node bin/sandbox.mjs …)` and invoke `docker run $SBX
// <image>`, so a variable now legitimately sits where this scanner used to find the image.
const SHELL_VAR = /^\$\{?\w+\}?$/;

export function dockerImagesIn(cmd) {
  const toks = tokenize(cmd);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] !== 'docker' || !['run', 'create', 'pull'].includes(toks[i + 1])) continue;
    let pullAlways = false;
    let image = null;
    let skippedVar = false;
    for (let j = i + 2; j < toks.length; j++) {
      const t = toks[j];
      if (SHELL_BREAK.has(t) || t.startsWith('>')) break;
      if (t === '--pull=always') { pullAlways = true; continue; }
      if (DOCKER_VALUE_FLAGS.has(t)) { j++; continue; }
      if (t.startsWith('-')) continue;
      // A variable may expand to flags, so keep looking for a concrete image rather than reading
      // the variable AS the image — which is what reported `$SBX` as an unpinned image and, worse,
      // starved the deps-osv exemption of the token it is keyed to, so a deliberate decision
      // silently stopped applying. But do NOT simply skip it: if no concrete image follows, the
      // reference is genuinely unreadable from here and must say so rather than pass.
      if (SHELL_VAR.test(t)) { skippedVar = true; continue; }
      image = t; break;
    }
    if (image) out.push({ image, pullAlways });
    else if (skippedVar) out.push({ image: null, unreadable: true, pullAlways });
  }
  return out;
}
export function isPinnedImage(ref) {
  if (ref.includes('@sha256:')) return true;
  const lastColon = ref.lastIndexOf(':');
  const lastSlash = ref.lastIndexOf('/');
  if (lastColon <= lastSlash) return false;            // untagged ⇒ implicitly :latest
  return ref.slice(lastColon + 1) !== 'latest';
}

// curl/wget piped straight into an interpreter — the classic unverified-install one-liner.
const CURL_PIPE = /\b(?:curl|wget)\b[^;&|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python3?|node|perl|ruby)\b/;

// ── comment blanking ─────────────────────────────────────────────────────────────────────────
// Whole-line comment forms only: regex-vs-division is undecidable, and the permissive mistake
// hides real violations. A trailing `// npx bar` still flags — false positive is the safe side.
export function blankComments(text, ext) {
  const lines = text.split('\n');
  const hash = ext === '.sh';
  let inBlock = false;
  return lines.map((line) => {
    if (inBlock) { if (line.includes('*/')) inBlock = false; return ''; }
    const t = line.trim();
    if (hash && t.startsWith('#')) return '';
    if (!hash) {
      if (t.startsWith('//')) return '';
      if (t.startsWith('*')) return '';
      if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return ''; }
      return line.replace(/\/\*.*?\*\//g, ' ');
    }
    return line;
  }).join('\n');
}

// ── collecting sites ─────────────────────────────────────────────────────────────────────────
function readOrThrow(path) {
  try { return readFileSync(path, 'utf8'); }
  catch (e) { throw new FetchGateError(`unpinned-fetch gate cannot read ${path}: ${e.code || e.message} — refusing to pass on unread input`); }
}

export function collectManifestSites({ manifestDir }) {
  let entries;
  try { entries = readdirSync(manifestDir); }
  catch (e) { throw new FetchGateError(`unpinned-fetch gate cannot list ${manifestDir}: ${e.code || e.message} — refusing to pass having checked nothing`); }
  const jsons = entries.filter((f) => f.endsWith('.json')).sort();
  if (!jsons.length) throw new FetchGateError(`unpinned-fetch gate found no .json in ${manifestDir} — refusing to pass having checked nothing`);

  const sites = []; let checkManifests = 0;
  for (const f of jsons) {
    const path = join(manifestDir, f);
    let doc;
    try { doc = JSON.parse(readOrThrow(path)); }
    catch (e) {
      if (e instanceof FetchGateError) throw e;
      throw new FetchGateError(`unpinned-fetch gate cannot parse ${path}: ${e.message} — an unparseable manifest is not an empty manifest`);
    }
    if (!Array.isArray(doc.checks)) continue;   // tool catalogue / registry, not a check manifest
    checkManifests++;
    for (const c of doc.checks) {
      if (!Array.isArray(c.local)) continue;
      c.local.forEach((cmd, i) => sites.push({ kind: 'manifest', file: f, path, checkId: c.id || '(no id)', index: i, command: cmd }));
    }
  }
  if (!checkManifests) throw new FetchGateError(`unpinned-fetch gate found no check manifest (a .json with a "checks" array) in ${manifestDir} — refusing to pass having checked nothing`);
  return { sites, checkManifests };
}

const SKIP_DIRS = new Set(['test', 'tests', '__tests__', 'fixtures', 'node_modules', '.git', 'reports', 'data', 'schema']);
const SCRIPT_EXT = new Set(['.mjs', '.js', '.cjs', '.sh']);
const isDockerfile = (name) => name === 'Dockerfile' || name.endsWith('.Dockerfile');
// A Dockerfile's RUN lines are shell and its comments are `#`, so it is read the way a .sh is.
const kindOf = (path) => (isDockerfile(path.split(/[\\/]/).pop()) ? '.sh' : extname(path));
// `RUN` and its --mount/--network flags hold the command position the npx reader looks at.
const dockerRunsAsShell = (src) => src.replace(/^([ \t]*)RUN[ \t]+(?:--\S+[ \t]+)*/gim, '$1');

function walkScripts(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch (e) { throw new FetchGateError(`unpinned-fetch gate cannot list ${dir}: ${e.code || e.message} — refusing to pass having checked nothing`); }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkScripts(join(dir, e.name), out); continue; }
    if (SCRIPT_EXT.has(extname(e.name)) || isDockerfile(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

// One-level const resolution for argv arrays; anything still unresolved is a VIOLATION, not a pass.
const NPX_FLAG_LITERALS = ['--yes', '-y', '--package', '--no-install', '--prefer-online', '--call'];

function resolveConst(src, ident) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal or escaped value defined in the test
  const m = src.match(new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*=\\s*(['"\`])([^'"\`]*)\\1`));
  return m ? m[2] : null;
}

export function npxInvocationsInScript(src, ext = '.mjs') {
  const found = [];
  // (1) shell-command form: a string literal whose command is npx.
  for (const s of shellStringsIn(src, ext)) {
    for (const args of npxInvocationsInShell(s)) found.push({ form: 'shell', args });
  }
  // (2) argv-array form: a flat array literal carrying an npx flag, in a file that names npx.
  //     `-y` and `--yes` are apt-get's and dnf's flags too; without npx in the file they are theirs.
  const arrays = /\bnpx\b/.test(src) ? (src.match(/\[[^[\]]*\]/g) || []) : [];
  for (const arr of arrays) {
    const parts = arr.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    const lits = parts.map((p) => {
      const m = p.match(/^(['"`])(.*)\1$/);
      if (m) return m[2];
      if (/^[A-Za-z_$][\w$]*$/.test(p)) return { ident: p };
      return { unresolved: p };
    });
    if (!lits.some((l) => typeof l === 'string' && NPX_FLAG_LITERALS.includes(l))) continue;
    found.push({ form: 'argv', args: lits });
  }
  // (3) a spawn/exec whose command literal is npx: there MUST be a readable argv array in the file,
  //     or the gate cannot see what is fetched and says so.
  const spawnsNpx = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(\s*(['"])npx\1/.test(src);
  return { found, spawnsNpx };
}

export function collectScriptSites({ scriptDirs }) {
  const files = [];
  for (const d of scriptDirs) walkScripts(d, files);
  if (!files.length) throw new FetchGateError(`unpinned-fetch gate found no scripts under ${scriptDirs.join(', ')} — refusing to pass having checked nothing`);
  const sites = [];
  for (const path of files) {
    const text = blankComments(readOrThrow(path), kindOf(path));
    const src = isDockerfile(path.split(/[\\/]/).pop()) ? dockerRunsAsShell(text) : text;
    const { found, spawnsNpx } = npxInvocationsInScript(src, kindOf(path));
    for (const inv of found) {
      const args = inv.args.map((a) => (typeof a === 'string' ? a : (a.ident ? (resolveConst(src, a.ident) ?? `<unresolved:${a.ident}>`) : `<unresolved:${a.unresolved}>`)));
      sites.push({ kind: 'script', file: path, path, checkId: null, form: inv.form, args, command: `npx ${args.join(' ')}` });
    }
    if (spawnsNpx && !found.some((f) => f.form === 'argv')) {
      sites.push({ kind: 'script', file: path, path, checkId: null, form: 'opaque-spawn', args: null, command: "spawn('npx', <argv the gate cannot read>)" });
    }
    if (CURL_PIPE.test(src)) sites.push({ kind: 'script', file: path, path, checkId: null, form: 'curl-pipe', args: null, command: src.match(CURL_PIPE)[0] });
  }
  return { sites, files };
}

// ── exemptions ───────────────────────────────────────────────────────────────────────────────
// Keyed to file + check + exact token; every entry must fire or a failing test deletes it.
export const EXEMPTIONS = [
  {
    file: 'security-baseline.json',
    checkId: 'deps-osv',
    token: 'ghcr.io/google/osv-scanner:latest',
    decided: '2026-08-20',
    reason:
      'The osv-scanner image IS the advisory database, not merely the tool that reads one. A digest '
      + 'or version pin freezes the database, and a frozen vulnerability database reports "clean" about '
      + 'every advisory published since the pin — a silent false green, which is the exact failure this '
      + 'repo grades hardest. --pull=always was added deliberately on 2026-08-04 after the cached image '
      + 'on this host was measured 6 weeks stale; the written rationale in the check\'s own notes is '
      + '"an unreachable registry must not read as clean", and it accepts a hard failure when the '
      + 'registry is down as the correct price. Contrast supply-chain-guarddog, whose image is the tool '
      + 'and whose data is fetched live at scan time — that one IS pinned.',
  },
];

// Seen but not fixable this pass (file owned by another session); exact length asserted below.
export const DEFERRED = [];

const matches = (list, site, token) => list.find((x) => x.file === site.file && x.checkId === site.checkId && token.includes(x.token));

// ── the gate ─────────────────────────────────────────────────────────────────────────────────
export function runGate(overrides = {}) {
  const cfg = gateConfig(overrides);
  const { sites: mSites, checkManifests } = collectManifestSites(cfg);
  const { sites: sSites, files } = collectScriptSites(cfg);
  const violations = [];
  const exemptionsUsed = new Set();
  const deferredUsed = new Set();

  const record = (site, rule, detail) => {
    const ex = matches(EXEMPTIONS, site, detail);
    if (ex) { exemptionsUsed.add(EXEMPTIONS.indexOf(ex)); return; }
    const df = matches(DEFERRED, site, detail);
    if (df) { deferredUsed.add(DEFERRED.indexOf(df)); return; }
    violations.push({ where: `${relative(cfg.root, site.path)}${site.checkId ? `:${site.checkId}` : ''}`, rule, detail, command: site.command });
  };

  for (const site of mSites) {
    for (const args of npxInvocationsInShell(site.command)) {
      const { spec } = packageSpecFromNpxArgs(args);
      if (!isPinnedSpec(spec)) record(site, 'npx-unpinned', spec || '(no package spec)');
    }
    for (const { image, pullAlways, unreadable } of dockerImagesIn(site.command)) {
      // An image hidden behind a variable is not a pass. It is the docker analogue of
      // npx-argv-unreadable: nothing can be said about a reference this gate cannot see.
      if (unreadable) { record(site, 'docker-image-unreadable', site.command.slice(0, 120)); continue; }
      if (pullAlways) record(site, 'docker-pull-always', image);
      else if (!isPinnedImage(image)) record(site, 'docker-image-unpinned', image);
    }
    if (CURL_PIPE.test(site.command)) record(site, 'curl-pipe-to-shell', site.command.match(CURL_PIPE)[0]);
  }

  for (const site of sSites) {
    if (site.form === 'opaque-spawn') { record(site, 'npx-argv-unreadable', site.command); continue; }
    if (site.form === 'curl-pipe') { record(site, 'curl-pipe-to-shell', site.command); continue; }
    const { spec } = packageSpecFromNpxArgs(site.args);
    if (!isPinnedSpec(spec)) record(site, 'npx-unpinned', spec || '(no package spec)');
  }

  return {
    violations,
    stats: { checkManifests, manifestCommands: mSites.length, scriptFiles: files.length, scriptSites: sSites.length },
    scripts: files.map((f) => relative(cfg.root, f).split('\\').join('/')),
    unusedExemptions: EXEMPTIONS.filter((_, i) => !exemptionsUsed.has(i)),
    unusedDeferred: DEFERRED.filter((_, i) => !deferredUsed.has(i)),
  };
}

// ── fixture helper ───────────────────────────────────────────────────────────────────────────
const temps = [];
function fixture({ manifests = {}, scripts = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw-fetch-gate-'));
  temps.push(root);
  mkdirSync(join(root, 'manifests'), { recursive: true });
  mkdirSync(join(root, 'bin'), { recursive: true });
  for (const [name, body] of Object.entries(manifests)) {
    writeFileSync(join(root, 'manifests', name), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  for (const [name, body] of Object.entries(scripts)) writeFileSync(join(root, 'bin', name), body);
  if (!Object.keys(scripts).length) writeFileSync(join(root, 'bin', 'noop.mjs'), '// nothing here\n');
  return { root, manifestDir: join(root, 'manifests'), scriptDirs: [join(root, 'bin')] };
}
const oneCheck = (id, local) => ({ repo: 'fixture', checks: [{ id, local: [local] }] });
process.on('exit', () => { for (const d of temps) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } } });

// ── the invariant, on the real repository ────────────────────────────────────────────────────
test('this repository fetches nothing unpinned while it scans', () => {
  const r = runGate();
  assert.deepEqual(r.violations, [], `unpinned scan-time fetch(es):\n${r.violations.map((v) => `  ${v.where} [${v.rule}] ${v.detail}`).join('\n')}`);
});

test('the gate actually looked at something — the numbers are asserted, not assumed', () => {
  const r = runGate();
  assert.ok(r.stats.checkManifests >= 4, `expected ≥4 check manifests, saw ${r.stats.checkManifests}`);
  assert.ok(r.stats.manifestCommands >= 50, `expected ≥50 manifest commands, saw ${r.stats.manifestCommands}`);
  assert.ok(r.stats.scriptFiles >= 100, `expected ≥100 scripts, saw ${r.stats.scriptFiles}`);
  assert.ok(r.stats.scriptSites >= 3, `expected ≥3 npx sites in scripts, saw ${r.stats.scriptSites}`);
  for (const f of ['bin/install.sh', 'container/Dockerfile']) assert.ok(r.scripts.includes(f), `the gate never read ${f}`);
});

test('every exemption fires; a stale exemption is itself a failure', () => {
  const r = runGate();
  assert.deepEqual(r.unusedExemptions.map((e) => `${e.file}:${e.checkId}`), []);
  assert.deepEqual(r.unusedDeferred.map((e) => `${e.file}:${e.checkId}`), []);
});

test('the deferred list is at most one entry, and that entry names its fix', () => {
  assert.ok(DEFERRED.length <= 1, 'a second deferral must be argued for in review, not appended');
  for (const d of DEFERRED) assert.match(d.reason, /Fix:/);
});

// ── fail closed ──────────────────────────────────────────────────────────────────────────────
test('a missing manifest directory FAILS — it never reads as "nothing to check"', () => {
  assert.throws(() => runGate({ root: '/nonexistent-cw', manifestDir: '/nonexistent-cw/manifests', scriptDirs: ['/nonexistent-cw/bin'] }), FetchGateError);
});

test('an empty manifest directory FAILS', () => {
  const f = fixture();
  assert.throws(() => runGate(f), /found no \.json/);
});

test('a manifest directory with no CHECK manifest FAILS', () => {
  const f = fixture({ manifests: { 'catalog.json': { note: 'a tool catalogue, no checks array' } } });
  assert.throws(() => runGate(f), /found no check manifest/);
});

test('an unparseable manifest FAILS — an unparseable manifest is not an empty one', () => {
  const f = fixture({ manifests: { 'broken.json': '{ "checks": [ ' } });
  assert.throws(() => runGate(f), /cannot parse/);
});

test('a script directory that cannot be listed FAILS', () => {
  const f = fixture({ manifests: { 'm.json': oneCheck('c', 'echo hi') } });
  assert.throws(() => runGate({ ...f, scriptDirs: [join(f.root, 'does-not-exist')] }), /cannot list/);
});

test('a script directory containing no scripts FAILS', () => {
  const f = fixture({ manifests: { 'm.json': oneCheck('c', 'echo hi') } });
  rmSync(join(f.root, 'bin', 'noop.mjs'));
  assert.throws(() => runGate(f), /found no scripts/);
});

// ── the gate bites ───────────────────────────────────────────────────────────────────────────
const rules = (f) => runGate(f).violations.map((v) => v.rule);

test('a bare `npx --yes pkg` in a manifest is a violation', () => {
  const f = fixture({ manifests: { 'm.json': oneCheck('scan', 'npx --yes retire --path .') } });
  assert.deepEqual(rules(f), ['npx-unpinned']);
});

test('a RANGE is not a pin — ^, ~, x and latest all fail', () => {
  for (const v of ['^5.4.3', '~5.4', '5.x', 'latest', 'next']) {
    const f = fixture({ manifests: { 'm.json': oneCheck('scan', `npx --yes retire@${v} --path .`) } });
    assert.deepEqual(rules(f), ['npx-unpinned'], `retire@${v} must not read as pinned`);
  }
});

test('an exact pin passes, including a scoped package and a prerelease', () => {
  for (const spec of ['retire@5.4.3', '@cyclonedx/cyclonedx-npm@6.0.1', 'foo@1.0.0-rc.2']) {
    const f = fixture({ manifests: { 'm.json': oneCheck('scan', `npx --yes ${spec} --json`) } });
    assert.deepEqual(rules(f), [], `${spec} should be accepted`);
  }
});

test('--package names the package, and the command after `--` is not mistaken for one', () => {
  const bad = fixture({ manifests: { 'm.json': oneCheck('scan', 'npx --yes --package renovate -- renovate-config-validator renovate.json') } });
  assert.deepEqual(rules(bad), ['npx-unpinned']);
  const good = fixture({ manifests: { 'm.json': oneCheck('scan', 'npx --yes --package renovate@43.271.3 -- renovate-config-validator renovate.json') } });
  assert.deepEqual(rules(good), []);
});

test('a flags variable is not the image, and an image hidden behind one is UNREADABLE not clean', () => {
  // The sandboxed lanes build their flags with SBX=$(node bin/sandbox.mjs …) and run
  // `docker run $SBX <image>`. Before 2026-09-01 this scanner read $SBX AS the image: it reported a
  // bogus docker-image-unpinned on the variable, and — the worse half — the real image token was
  // never reported, so the deps-osv exemption keyed to it stopped firing. A deliberate, argued
  // decision silently stopped applying because the token it names was no longer produced.
  const viaVar = fixture({ manifests: { 'm.json': oneCheck('scan', 'docker run $SBX ghcr.io/x/y:v1.2.3 scan') } });
  assert.deepEqual(rules(viaVar), [], 'a pinned image after a flags variable must be seen and accepted');

  const varThenLatest = fixture({ manifests: { 'm.json': oneCheck('scan', 'docker run $SBX ghcr.io/x/y:latest scan') } });
  assert.deepEqual(rules(varThenLatest), ['docker-image-unpinned'],
    'skipping the variable must not skip the image behind it — that would be a silent pass');

  // The other direction: skipping a variable must not become a way to hide an image entirely.
  const hidden = fixture({ manifests: { 'm.json': oneCheck('scan', 'docker run --rm $IMAGE_REF') } });
  assert.deepEqual(rules(hidden), ['docker-image-unreadable'],
    'an image that is only a variable cannot be judged from here, and unreadable is not clean');
});

test('an untagged or :latest docker image in a manifest is a violation; a tag or digest is not', () => {
  const untagged = fixture({ manifests: { 'm.json': oneCheck('scan', 'docker run --rm -v "$PWD":/src ghcr.io/datadog/guarddog npm verify /src/package.json') } });
  assert.deepEqual(rules(untagged), ['docker-image-unpinned']);
  const latest = fixture({ manifests: { 'm.json': oneCheck('scan', 'docker run --rm ghcr.io/x/y:latest scan') } });
  assert.deepEqual(rules(latest), ['docker-image-unpinned']);
  const tagged = fixture({ manifests: { 'm.json': oneCheck('scan', 'docker run --rm -v "$PWD":/src ghcr.io/datadog/guarddog:v3.2.0 npm verify /src/package.json') } });
  assert.deepEqual(rules(tagged), []);
  const digest = fixture({ manifests: { 'm.json': oneCheck('scan', 'docker run --rm ghcr.io/x/y@sha256:' + 'a'.repeat(64) + ' scan') } });
  assert.deepEqual(rules(digest), []);
});

test('--pull=always is a violation UNLESS it is the named osv exemption', () => {
  const other = fixture({ manifests: { 'm.json': oneCheck('scan', 'docker run --rm --pull=always ghcr.io/other/tool:latest scan') } });
  assert.deepEqual(rules(other), ['docker-pull-always']);
  // keyed to file + check id + image — the same image under another check id still bites
  const copied = fixture({ manifests: { 'security-baseline.json': oneCheck('deps-osv-copy', 'docker run --rm --pull=always ghcr.io/google/osv-scanner:latest scan source') } });
  assert.deepEqual(rules(copied), ['docker-pull-always']);
  const exempt = fixture({ manifests: { 'security-baseline.json': oneCheck('deps-osv', 'docker run --rm --pull=always ghcr.io/google/osv-scanner:latest scan source') } });
  assert.deepEqual(rules(exempt), []);
});

test('curl piped into a shell is a violation, in a manifest and in a script', () => {
  const m = fixture({ manifests: { 'm.json': oneCheck('scan', 'curl -sSfL https://example.test/install.sh | sh') } });
  assert.deepEqual(rules(m), ['curl-pipe-to-shell']);
  const s = fixture({
    manifests: { 'm.json': oneCheck('scan', 'echo ok') },
    scripts: { 'inst.sh': 'set -e\nwget -qO- https://example.test/i | sudo bash\n' },
  });
  assert.deepEqual(rules(s), ['curl-pipe-to-shell']);
});

test('a script bites on a bare npx and passes on a pinned one', () => {
  const bad = fixture({
    manifests: { 'm.json': oneCheck('scan', 'echo ok') },
    scripts: { 'tool.mjs': "const r = sh('npx --yes depcheck --json');\n" },
  });
  assert.deepEqual(rules(bad), ['npx-unpinned']);
  const good = fixture({
    manifests: { 'm.json': oneCheck('scan', 'echo ok') },
    scripts: { 'tool.mjs': "const r = sh('npx --yes depcheck@1.4.7 --json');\n" },
  });
  assert.deepEqual(rules(good), []);
});

test('an argv-array npx is read, and a const-resolved pin satisfies it', () => {
  const bad = fixture({
    manifests: { 'm.json': oneCheck('scan', 'echo ok') },
    scripts: { 'r.mjs': "const args = ['--yes', 'renovate', '--platform=local'];\nspawnSync('npx', args);\n" },
  });
  assert.deepEqual(rules(bad), ['npx-unpinned']);
  const good = fixture({
    manifests: { 'm.json': oneCheck('scan', 'echo ok') },
    scripts: { 'r.mjs': "const PIN = 'renovate@43.271.3';\nconst args = ['--yes', PIN, '--platform=local'];\nspawnSync('npx', args);\n" },
  });
  assert.deepEqual(rules(good), []);
});

test('a package manager\'s -y in a file that never names npx is not an npx argv', () => {
  const apt = "const cmd = (pkg) => [...asRoot(), 'apt-get', 'install', '-y', pkg];\nspawnSync(cmd('x')[0], cmd('x').slice(1));\n";
  const clean = fixture({ manifests: { 'm.json': oneCheck('scan', 'echo ok') }, scripts: { 'setup.mjs': apt } });
  assert.deepEqual(rules(clean), []);
  const named = fixture({ manifests: { 'm.json': oneCheck('scan', 'echo ok') }, scripts: { 'setup.mjs': `${apt}spawnSync('npx', ['--yes', 'depcheck']);\n` } });
  assert.ok(rules(named).includes('npx-unpinned'), 'once the file names npx, a flagged array is read again');
});

test('an npx spawn whose argv the gate cannot read is a violation, not a pass', () => {
  const f = fixture({
    manifests: { 'm.json': oneCheck('scan', 'echo ok') },
    scripts: { 'r.mjs': "const args = buildArgs();\nspawnSync('npx', args, { cwd });\n" },
  });
  assert.deepEqual(rules(f), ['npx-argv-unreadable']);
});

test('an unresolvable identifier inside an argv array is a violation, not a pass', () => {
  const f = fixture({
    manifests: { 'm.json': oneCheck('scan', 'echo ok') },
    scripts: { 'r.mjs': "const args = ['--yes', pkgFromSomewhere, '--platform=local'];\nspawnSync('npx', args);\n" },
  });
  assert.deepEqual(rules(f), ['npx-unpinned']);
});

test('a Dockerfile is read as shell: its RUN lines bite and its # comments do not', () => {
  const f = fixture({ manifests: { 'm.json': oneCheck('scan', 'echo ok') } });
  mkdirSync(join(f.root, 'container'));
  const dirs = [...f.scriptDirs, join(f.root, 'container')];
  writeFileSync(join(f.root, 'container', 'Dockerfile'), 'FROM x@sha256:' + 'a'.repeat(64) + '\n# RUN npx --yes eslint .\nRUN echo ok\n');
  assert.deepEqual(rules({ ...f, scriptDirs: dirs }), []);
  writeFileSync(join(f.root, 'container', 'Dockerfile'), 'FROM x\nRUN curl -fsSL https://example.test/i.sh | sh\n');
  assert.deepEqual(rules({ ...f, scriptDirs: dirs }), ['curl-pipe-to-shell']);
  writeFileSync(join(f.root, 'container', 'build.Dockerfile'), 'FROM x\nRUN --mount=type=bind,target=/src npx --yes retire --path .\n');
  rmSync(join(f.root, 'container', 'Dockerfile'));
  assert.deepEqual(rules({ ...f, scriptDirs: dirs }), ['npx-unpinned']);
});

test('a commented-out fetch is not a finding (and a shell # comment neither)', () => {
  const f = fixture({
    manifests: { 'm.json': oneCheck('scan', 'echo ok') },
    scripts: {
      'a.mjs': "// we used to run npx --yes depcheck --json here\n/*\nnpx --yes eslint .\n*/\nconst x = 1;\n",
      'b.sh': '# npx --yes retire --path .\necho ok\n',
    },
  });
  assert.deepEqual(rules(f), []);
});

test('a glob string cannot be mistaken for the start of a block comment', () => {
  const f = fixture({
    manifests: { 'm.json': oneCheck('scan', 'echo ok') },
    scripts: { 'g.mjs': 'const glob = "admin/**/*.test.mjs";\nconst r = sh(\'npx --yes depcheck --json\');\n' },
  });
  assert.deepEqual(rules(f), ['npx-unpinned'], 'the npx line after a glob must still be read');
});

test('tests and fixtures are not scanned — this file would otherwise fail the repo', () => {
  const r = runGate();
  assert.ok(!r.violations.some((v) => v.where.includes('/test/')), 'test trees must be excluded');
});

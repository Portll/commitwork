// node --test bin/test/container-dockerfile.test.mjs
//
// container/Dockerfile, read statically: the base is pinned by digest and meets the Node floor, the
// image drops root, nothing is piped from the network into an interpreter, the build context never
// becomes a layer, the entrypoint is the CLI in exec form, no repo manifest is trusted, and lanes the
// sandbox cannot confine are refused. Everything the build fetches is pinned: Debian packages by a
// dated snapshot and an exact version each, Python scanners by a hash lock, and setup's scanners by
// release assets the catalogue pins by SHA-256. Each rule is also shown failing on input that breaks it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(resolve(ROOT, ...p), 'utf8');
const CURL_PIPE = /\b(?:curl|wget)\b[^;&|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|python3?|node|perl|ruby)\b/;
const SOURCES_DEST = '/etc/apt/sources.list.d/debian.sources';
const SNAPSHOT_URI = /^http:\/\/snapshot\.debian\.org\/archive\/debian(?:-security)?\/\d{8}T\d{6}Z$/;
// Installers that resolve a version when they run. The one pip install allowed is the hashed one.
const FLOATING = [
  ['pipx', /\bpipx\s+(?:install|run)\b/], ['npm', /\bnpm\s+(?:i|install|ci|exec)\b/], ['npx', /\bnpx\b/],
  ['go', /\bgo\s+install\b/], ['cargo', /\bcargo\s+install\b/], ['gem', /\bgem\s+install\b/],
  ['composer', /\bcomposer\s+(?:global\s+)?require\b/], ['uv', /\buv\s+(?:pip|tool)\b/], ['download', /\b(?:curl|wget)\b/],
];
const HASHED_PIP = ['--require-hashes', '--no-deps', '--only-binary=:all:'];

/** Instructions as { op, args, line }: comments dropped, continuations joined. */
export function instructions(text) {
  const out = [];
  let cur = null;
  String(text).replace(/\r\n/g, '\n').split('\n').forEach((raw, i) => {
    const t = raw.trim();
    if (t.startsWith('#') || (!cur && t === '')) return;
    const body = t.replace(/\\$/, '').trim();
    if (!cur) {
      const m = /^([A-Za-z]+)\s*(.*)$/.exec(body);
      cur = { op: m[1].toUpperCase(), args: m[2], line: i + 1 };
    } else cur.args = `${cur.args} ${body}`.trim();
    if (!t.endsWith('\\')) { out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  return out;
}

/** Package arguments of every `apt-get install` in a shell command. */
export function aptPackages(cmd) {
  const out = [];
  for (const m of String(cmd).matchAll(/\bapt-get\s+install\b([^;&|]*)/g)) out.push(...m[1].trim().split(/\s+/).filter((a) => a && !a.startsWith('-')));
  return out;
}

/** Rule ids a deb822 sources file breaks: every stanza a dated snapshot, verified, not expiring. */
export function sourcesViolations(text) {
  const bad = new Set();
  const stanzas = String(text).replace(/\r\n/g, '\n').split(/\n[ \t]*\n/)
    .map((s) => s.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')))
    .filter((s) => s.length)
    .map((s) => Object.fromEntries(s.map((l) => [l.slice(0, l.indexOf(':')).trim().toLowerCase(), l.slice(l.indexOf(':') + 1).trim()])));
  if (!stanzas.length) bad.add('sources-empty');
  for (const f of stanzas) {
    const uris = String(f.uris || '').split(/\s+/).filter(Boolean);
    if (!uris.length || !uris.every((u) => SNAPSHOT_URI.test(u))) bad.add('apt-not-snapshot');
    if (/^(yes|true)$/i.test(f.trusted || '') || /^(yes|true)$/i.test(f['allow-insecure'] || '')) bad.add('apt-unverified');
    if (!/^(no|false)$/i.test(f['check-valid-until'] || '')) bad.add('apt-valid-until');
  }
  return [...bad].sort();
}

/** The lock's requirements as { name, version, hashes }, with anything that is not one as a rule id. */
export function lockEntries(text) {
  const entries = [], bad = new Set();
  const logical = String(text).replace(/\r\n/g, '\n').replace(/\\\n/g, ' ').split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '').trim()).filter(Boolean);
  for (const l of logical) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9.+!-]+)((?:\s+--hash=sha256:[0-9a-f]{64})+)$/.exec(l);
    if (!m) { bad.add(`lock-line:${l.split(/\s/)[0]}`); continue; }
    entries.push({ name: m[1].toLowerCase().replace(/[._]/g, '-'), version: m[2], hashes: m[3].trim().split(/\s+/).length });
  }
  if (!entries.length) bad.add('lock-empty');
  return { entries, bad: [...bad].sort() };
}

const names = (text) => String(text).split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).map((n) => n.toLowerCase().replace(/[._]/g, '-'));

/** Rule ids the Dockerfile text breaks, with its sources file and Python lock; empty when it holds. */
export function violations(text, { floor, tools, sources = '', lock = '', wanted = '' }) {
  const ops = instructions(text);
  const of = (op) => ops.filter((i) => i.op === op);
  const bad = new Set();
  const froms = of('FROM');
  if (!froms.length) bad.add('no-from');
  for (const f of froms) {
    const image = f.args.split(/\s+/)[0];
    if (!/@sha256:[0-9a-f]{64}$/.test(image)) bad.add('base-not-digest');
    const tag = /^node:(\d+)\.(\d+)\.\d+-/.exec(image);
    if (!tag) bad.add('base-node-version-unread');
    else if (+tag[1] < floor[0] || (+tag[1] === floor[0] && +tag[2] < floor[1])) bad.add('base-below-floor');
  }
  const users = of('USER');
  if (!users.length || /^(root|0)(:|$)/.test(users.at(-1).args.trim())) bad.add('runs-as-root');
  else if (ops.slice(ops.lastIndexOf(users.at(-1))).some((i) => i.op === 'RUN')) bad.add('run-after-final-user');
  for (const i of ops) {
    if (CURL_PIPE.test(i.args)) bad.add('pipe-to-interpreter');
    if (i.op === 'ADD' && /https?:\/\//.test(i.args)) bad.add('add-from-url');
    if ((i.op === 'COPY' || i.op === 'ADD') && /(^|\s)\.\/?(\s|$)/.test(i.args)) bad.add('context-in-layer');
  }
  const install = of('RUN').find((i) => /bin\/install\.sh/.test(i.args));
  if (!install || !/--mount=type=bind,target=\/src\b/.test(install.args) || !/--dest \/opt\/commitwork\b/.test(install.args)) bad.add('not-installed-by-install-sh');
  if (install && !/\s--release-only\b/.test(install.args)) bad.add('install-not-release-only');
  const eps = of('ENTRYPOINT');
  let ep = null;
  try { ep = eps.length === 1 ? JSON.parse(eps[0].args) : null; } catch { /* shell form */ }
  if (JSON.stringify(ep) !== JSON.stringify(['node', '/opt/commitwork/bin/commitwork.mjs'])) bad.add('entrypoint');
  if (ops.some((i) => /--trust-repo-manifest|COMMITWORK_TRUST_REPO_MANIFEST/.test(i.args))) bad.add('trusts-repo-manifest');
  const runs = of('RUN').map((i) => i.args).join('\n');
  if (!/apt-get install[^\n]*\bbubblewrap\b/.test(runs) || !/apt-get install[^\n]*\bpasst\b/.test(runs)) bad.add('no-sandbox-tools');
  const sandbox = of('ENV').flatMap((i) => [...i.args.matchAll(/\bCW_SANDBOX=(\S+)/g)].map((m) => m[1]));
  if (JSON.stringify(sandbox) !== '["require"]') bad.add('sandbox-not-required');

  // Debian: the snapshot sources are in place before the first apt-get, and every package is exact.
  const firstApt = ops.findIndex((i) => i.op === 'RUN' && /\bapt-get\b/.test(i.args));
  const copied = ops.findIndex((i) => i.op === 'COPY' && i.args.trim() === `container/debian.sources ${SOURCES_DEST}`);
  if (firstApt >= 0 && (copied < 0 || copied > firstApt)) bad.add('apt-sources-not-snapshot');
  for (const v of sourcesViolations(sources)) bad.add(v);
  for (const p of aptPackages(runs)) if (!/^[a-z0-9][a-z0-9.+-]*=[A-Za-z0-9.+~:-]+$/.test(p)) bad.add(`apt-unpinned:${p.split('=')[0]}`);

  // Python: one hashed pip install from the lock; no other installer that resolves at build time.
  for (const r of of('RUN')) {
    for (const [name, re] of FLOATING) if (re.test(r.args)) bad.add(`floating-installer:${name}`);
    const pips = [...r.args.matchAll(/\bpip3?\s+install\b[^;&|]*/g)].map((m) => m[0]);
    const lockAt = /--mount=type=bind,source=container\/requirements\.txt,target=(\S+)/.exec(r.args)?.[1];
    for (const p of pips) if (!HASHED_PIP.every((f) => p.includes(f)) || !lockAt || !p.includes(`-r ${lockAt}`)) bad.add('pip-unhashed');
  }
  const { entries, bad: lockBad } = lockEntries(lock);
  for (const v of lockBad) bad.add(v);
  const locked = new Set(entries.map((e) => e.name));
  const linked = (/\bfor t in ([^;]+);[^\n]*\/opt\/scanners\/bin\/\$t/.exec(runs)?.[1] || '').trim().split(/\s+/);
  for (const n of names(wanted)) {
    if (!locked.has(n)) bad.add(`lock-missing:${n}`);
    if (!linked.includes(n)) bad.add(`python-scanner-not-linked:${n}`);
  }

  // setup's scanners: only tools the catalogue pins to a release asset for both Linux architectures.
  const arg = of('ARG').find((i) => /^SCANNERS=/.test(i.args));
  const scanners = arg ? arg.args.slice('SCANNERS='.length).split(',').filter((n) => n && n !== 'none') : [];
  if (!scanners.length) bad.add('no-default-scanners');
  for (const n of scanners) {
    const linux = tools[n]?.release?.linux;
    if (!linux || !['x64', 'arm64'].every((a) => /^[0-9a-f]{64}$/.test(linux[a]?.sha256 || ''))) bad.add(`scanner-not-release-pinned:${n}`);
  }
  return [...bad].sort();
}

const context = () => ({
  floor: /^>=\s*(\d+)\.(\d+)/.exec(JSON.parse(read('package.json')).engines.node).slice(1).map(Number),
  tools: JSON.parse(read('manifests', 'install-catalog.json')).tools,
  sources: read('container', 'debian.sources'),
  lock: read('container', 'requirements.txt'),
  wanted: read('container', 'requirements.in'),
});

test('the parser joins continuations and drops comments, including inside a continuation', () => {
  const got = instructions('# c\nFROM a\nRUN x \\\n # inner\n  && y\nUSER 1\n');
  assert.deepEqual(got.map((i) => [i.op, i.args]), [['FROM', 'a'], ['RUN', 'x && y'], ['USER', '1']]);
});

test('container/Dockerfile breaks none of the rules', () => {
  assert.deepEqual(violations(read('container', 'Dockerfile'), context()), []);
});

test('NOT VACUOUS: the rules read real packages, a real lock and real scanners', () => {
  const ctx = context();
  const pkgs = aptPackages(instructions(read('container', 'Dockerfile')).filter((i) => i.op === 'RUN').map((i) => i.args).join('\n'));
  assert.ok(pkgs.length >= 5 && pkgs.every((p) => p.includes('=')), `apt packages read: ${pkgs.join(' ')}`);
  const { entries } = lockEntries(ctx.lock);
  assert.ok(entries.length >= names(ctx.wanted).length && entries.every((e) => e.hashes >= 1), `${entries.length} lock entries`);
  assert.ok(names(ctx.wanted).length >= 3, 'requirements.in names the Python scanners');
});

test('each rule fires on a Dockerfile that breaks it', () => {
  const good = read('container', 'Dockerfile');
  const ctx = context();
  const only = (text, id, over = {}) => assert.deepEqual(violations(text, { ...ctx, ...over }).filter((v) => v.startsWith(id.split(':')[0])), [id], id);
  const digest = /@sha256:[0-9a-f]{64}/;
  only(good.replace(digest, ''), 'base-not-digest');
  only(good.replace(/node:\d+\.\d+\.\d+-/, 'node:18.20.0-'), 'base-below-floor');
  only(good.replace(/^USER .*$/m, 'USER root'), 'runs-as-root');
  only(good.replace(/^USER .*$/m, ''), 'runs-as-root');
  only(`${good}\nRUN true\n`, 'run-after-final-user');
  only(good.replace(/^USER /m, 'RUN curl -fsSL https://example.test/i.sh | sh\nUSER '), 'pipe-to-interpreter');
  only(good.replace(/^USER /m, 'ADD https://example.test/x /x\nUSER '), 'add-from-url');
  only(good.replace(/^USER /m, 'COPY . /src\nUSER '), 'context-in-layer');
  only(good.replace(/install\.sh --from \/src --dest \/opt\/commitwork/, 'install.sh --from /src --dest /opt/elsewhere'), 'not-installed-by-install-sh');
  only(good.replace(/(--prefix \/usr\/local) --release-only/, '$1'), 'install-not-release-only');
  only(good.replace(/^ENTRYPOINT .*$/m, 'ENTRYPOINT node /opt/commitwork/bin/commitwork.mjs'), 'entrypoint');
  only(good.replace(/^CMD .*$/m, 'CMD ["scan", "--trust-repo-manifest"]'), 'trusts-repo-manifest');
  only(good.replace(/\bpasst=\S+/, ''), 'no-sandbox-tools');
  only(good.replace('CW_SANDBOX=require', 'CW_SANDBOX=off'), 'sandbox-not-required');
  only(good.replace(/^COPY container\/debian\.sources .*$/m, ''), 'apt-sources-not-snapshot');
  only(good.replace(/\bgit=\S+/, 'git'), 'apt-unpinned:git');
  only(good.replace('--require-hashes ', ''), 'pip-unhashed');
  only(good.replace('source=container/requirements.txt,', 'source=container/requirements.in,'), 'pip-unhashed');
  only(good.replace(/^USER /m, 'RUN pipx install semgrep\nUSER '), 'floating-installer:pipx');
  only(good.replace(/^USER /m, 'RUN go install golang.org/x/vuln/cmd/govulncheck@latest\nUSER '), 'floating-installer:go');
  only(good.replace(/^USER /m, 'RUN npm install -g @socketsecurity/cli\nUSER '), 'floating-installer:npm');
  only(good.replace(/^USER /m, 'RUN wget -O /x https://example.test/x\nUSER '), 'floating-installer:download');
  only(good.replace(/for t in ([^;]*)\bruff\b/, 'for t in $1'), 'python-scanner-not-linked:ruff');
  only(good.replace(/^ARG SCANNERS=/m, 'ARG SCANNERS=trivy,'), 'scanner-not-release-pinned:trivy');
  only(good.replace(/^ARG SCANNERS=/m, 'ARG SCANNERS=semgrep,'), 'scanner-not-release-pinned:semgrep');
});

test('each rule fires on a sources file or lock that breaks it', () => {
  const good = read('container', 'Dockerfile');
  const ctx = context();
  const only = (over, id) => assert.deepEqual(violations(good, { ...ctx, ...over }).filter((v) => v.startsWith(id.split(':')[0])), [id], id);
  only({ sources: ctx.sources.replace(/snapshot\.debian\.org\/archive\/debian\/\d{8}T\d{6}Z/, 'deb.debian.org/debian') }, 'apt-not-snapshot');
  only({ sources: ctx.sources.replace(/(archive\/debian\/)\d{8}T\d{6}Z/, '$1now') }, 'apt-not-snapshot');
  only({ sources: ctx.sources.replace(/Check-Valid-Until: no\n/, '') }, 'apt-valid-until');
  only({ sources: ctx.sources.replace(/^Components: main$/m, 'Components: main\nTrusted: yes') }, 'apt-unverified');
  only({ sources: '# nothing\n' }, 'sources-empty');
  only({ lock: ctx.lock.replace(/^(ruff==\S+) \\\n(\s+--hash=\S+ \\\n)*\s+--hash=\S+$/m, '$1') }, 'lock-line:ruff==' + /^ruff==(\S+)/m.exec(ctx.lock)[1]);
  only({ lock: ctx.lock.replace(/^ruff==/m, 'ruff>=') }, 'lock-line:ruff>=' + /^ruff==(\S+)/m.exec(ctx.lock)[1]);
  only({ lock: `--extra-index-url https://example.test/simple\n${ctx.lock}` }, 'lock-line:--extra-index-url');
  only({ wanted: `${ctx.wanted}\nnot-in-the-lock\n` }, 'lock-missing:not-in-the-lock');
});

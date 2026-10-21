// codeql-go-build: what CodeQL runs to extract Go. It invokes CodeQL's go-extractor once per module
// (no `go build`, no tracer). buildModules is tested with an injected runner; the exit-status contract
// is tested end to end against a fake extractor binary on disk, because it lives in the process exit
// and a unit test of buildModules cannot see it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModules, extractorPath } from '../codeql-go-build.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'codeql-go-build.mjs');
const posix = { skip: process.platform === 'win32' && 'the fake go-extractor is a sh script' };
const made = [];
const scratch = (p) => { const d = mkdtempSync(join(tmpdir(), p)); made.push(d); return d; };
test.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const PLAT = 'testplat';
const ENV = { CODEQL_EXTRACTOR_GO_ROOT: '/cq/go', CODEQL_PLATFORM: PLAT };

function tree(dirs) {
  const root = scratch('cw-cqgo-test-');
  for (const d of dirs) {
    mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, d, 'go.mod'), 'module x\n');
  }
  return root;
}

test('the extractor path is built from CODEQL_EXTRACTOR_GO_ROOT and CODEQL_PLATFORM', () => {
  assert.equal(extractorPath({ CODEQL_EXTRACTOR_GO_ROOT: '/cq/go', CODEQL_PLATFORM: 'osx64' }), join('/cq/go', 'tools', 'osx64', 'go-extractor'));
});

test('either variable missing or empty means no extractor path, never a guessed one', () => {
  assert.equal(extractorPath({}), null);
  assert.equal(extractorPath({ CODEQL_EXTRACTOR_GO_ROOT: '/cq/go' }), null);
  assert.equal(extractorPath({ CODEQL_PLATFORM: 'osx64' }), null);
  assert.equal(extractorPath({ CODEQL_EXTRACTOR_GO_ROOT: '', CODEQL_PLATFORM: 'osx64' }), null);
});

test('without the CodeQL variables buildModules runs nothing and reports no extractor', () => {
  const root = tree(['m']);
  let calls = 0;
  const rows = buildModules(root, { run: () => { calls++; return { status: 0, stderr: '' }; }, env: {} });
  assert.equal(calls, 0);
  assert.equal(rows.extractor, null);
  assert.deepEqual([...rows], []);
});

test('a module that extracts and one that does not: all are attempted and each row says which', () => {
  const root = tree(['good', 'bad', 'later']);
  const seen = [];
  const run = (cmd, args, opts) => {
    seen.push(relative(root, opts.cwd));
    return opts.cwd.endsWith('bad') ? { status: 1, stderr: 'a\nb\nc\nd\nboom' } : { status: 0, stderr: '' };
  };
  const rows = buildModules(root, { run, env: ENV });
  assert.deepEqual(seen, ['bad', 'good', 'later'], 'a failing module must not abandon the ones after it');
  assert.deepEqual(rows.map((r) => [r.module, r.status]), [['bad', 1], ['good', 0], ['later', 0]]);
  assert.equal(rows[0].stderr, 'c / d / boom', 'the last three stderr lines are kept');
});

test('a runner that could not start (status null, error set) is a failed module carrying the reason', () => {
  const root = tree(['']);
  const rows = buildModules(root, { run: () => ({ status: null, error: new Error('spawn go-extractor ENOENT') }), env: ENV });
  assert.equal(rows[0].status, null);
  assert.match(rows[0].stderr, /ENOENT/);
});

test('the invocation is the extractor with ./... in the module directory, not go', () => {
  const root = tree(['m']);
  let call;
  buildModules(root, { run: (cmd, args, opts) => { call = { cmd, args, opts }; return { status: 0, stderr: '' }; }, env: ENV });
  assert.equal(call.cmd, join('/cq/go', 'tools', PLAT, 'go-extractor'));
  assert.deepEqual(call.args, ['./...']);
  assert.equal(call.opts.cwd, join(root, 'm'));
});

test('the environment is hermetic: GOTOOLCHAIN=local, caller GOFLAGS kept, -buildvcs=false appended', () => {
  const root = tree(['m']);
  let opts;
  buildModules(root, { run: (c, a, o) => { opts = o; return { status: 0, stderr: '' }; }, env: { ...ENV, PATH: '/x', GOFLAGS: '-mod=mod', GOTOOLCHAIN: 'auto' } });
  assert.equal(opts.env.GOTOOLCHAIN, 'local', 'a go.mod toolchain line must not trigger a download');
  assert.equal(opts.env.GOFLAGS, '-mod=mod -buildvcs=false');
  assert.equal(opts.env.PATH, '/x');
  assert.equal(opts.env.CODEQL_PLATFORM, PLAT, 'the CodeQL variables reach the extractor');
});

test('GOFLAGS is exactly -buildvcs=false when the caller set none', () => {
  const root = tree(['']);
  let flags;
  buildModules(root, { run: (c, a, o) => { flags = o.env.GOFLAGS; return { status: 0, stderr: '' }; }, env: ENV });
  assert.equal(flags, '-buildvcs=false');
});

test('the depth bound is reported on the result rather than silently dropped', () => {
  const root = tree(['a/b/c']);
  const rows = buildModules(root, { run: () => ({ status: 0, stderr: '' }), maxDepth: 1, env: ENV });
  assert.deepEqual([...rows], []);
  assert.deepEqual(rows.unexplored, ['a']);
});

// ── the process contract, with a fake go-extractor ──────────────────────────────────────────
function fakeExtractor({ failIn = [] } = {}) {
  const root = scratch('cw-cqgo-ext-');
  const dir = join(root, 'tools', PLAT);
  mkdirSync(dir, { recursive: true });
  const log = join(root, 'calls.log');
  const marks = failIn.map((d) => `*/${d}) echo "extractor boom in ${d}" >&2; exit 1;;`).join('\n');
  writeFileSync(join(dir, 'go-extractor'), `#!/bin/sh
printf '%s|%s|%s|%s\\n' "$PWD" "$GOTOOLCHAIN" "$GOFLAGS" "$*" >> "${log}"
case "$PWD" in
${marks}
esac
exit 0
`);
  chmodSync(join(dir, 'go-extractor'), 0o755);
  return { root, log };
}
const cli = (root, env) => spawnSync(process.execPath, [SCRIPT, root], {
  encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
});
const withExt = (ext, extra = {}) => ({ CODEQL_EXTRACTOR_GO_ROOT: ext.root, CODEQL_PLATFORM: PLAT, ...extra });

test('exit 0 when one module extracted and another did not', posix, () => {
  const root = tree(['good', 'bad']);
  const ext = fakeExtractor({ failIn: ['bad'] });
  const r = cli(root, withExt(ext, { GOFLAGS: '-mod=mod', GOTOOLCHAIN: 'auto' }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /good extracted/);
  assert.match(r.stderr, /bad did not extract \(exit 1\).*extractor boom in bad/);
  const calls = readFileSync(ext.log, 'utf8').trim().split('\n');
  assert.equal(calls.length, 2, 'both modules were attempted');
  assert.deepEqual(calls.map((c) => c.split('|')[0].split('/').pop()), ['bad', 'good'], 'deterministic order');
  for (const c of calls) {
    const [, tc, flags, argv] = c.split('|');
    assert.equal(tc, 'local');
    assert.equal(flags, '-mod=mod -buildvcs=false');
    assert.equal(argv, './...');
  }
});

test('exit 1 when every module fails to extract: nothing read is not a scan', posix, () => {
  const root = tree(['a', 'b']);
  const ext = fakeExtractor({ failIn: ['a', 'b'] });
  const r = cli(root, withExt(ext));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /0 of 2 modules extracted/);
  assert.match(r.stderr, /a did not extract/, 'per-module diagnostics are still printed');
  assert.match(r.stderr, /b did not extract/);
  assert.equal(readFileSync(ext.log, 'utf8').trim().split('\n').length, 2, 'both were attempted despite the first failing');
});

test('exit 1 when the extractor binary cannot be started at all', () => {
  const root = tree(['a']);
  const r = cli(root, { CODEQL_EXTRACTOR_GO_ROOT: scratch('cw-cqgo-empty-'), CODEQL_PLATFORM: PLAT });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /0 of 1 modules extracted/);
  assert.match(r.stderr, /ENOENT/);
});

test('exit 1 saying it runs as CodeQL\'s build command when the CodeQL variables are absent', () => {
  const root = tree(['m']);
  const r = cli(root, {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CODEQL_EXTRACTOR_GO_ROOT/);
  assert.match(r.stderr, /CodeQL's build command/);
  assert.doesNotMatch(r.stderr, /extracted\n/, 'no module may be reported extracted');
  const half = cli(root, { CODEQL_EXTRACTOR_GO_ROOT: '/cq/go' });
  assert.equal(half.status, 1, 'one variable alone is still not CodeQL');
});

test('exit 1 with a reason on stderr when there is no go.mod at any depth', posix, () => {
  const root = scratch('cw-cqgo-test-');
  mkdirSync(join(root, 'src'));
  const ext = fakeExtractor();
  const r = cli(root, withExt(ext));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no go\.mod at any depth/);
  assert.equal(readdirSync(ext.root).includes('calls.log'), false, 'the extractor was never run');
});

test('the CLI names the directories the depth bound cut off', posix, () => {
  const root = tree(['m', 'a/b/c/d/e/f']);
  const r = cli(root, withExt(fakeExtractor()));
  assert.equal(r.status, 0);
  assert.match(r.stderr, /walk stopped at max depth; not searched below: a\/b\/c\/d/);
});

test('the scanned tree is left exactly as found', posix, () => {
  const root = tree(['m']);
  const before = readdirSync(root, { recursive: true }).sort();
  assert.equal(cli(root, withExt(fakeExtractor())).status, 0);
  assert.deepEqual(readdirSync(root, { recursive: true }).sort(), before);
});

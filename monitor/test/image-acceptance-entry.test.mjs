// monitor/image-acceptance.mjs as a process on a fixture registry (CW_REGISTRY, reportsRoot in tmp),
// a fixture ledger (CW_IMAGE_ACCEPTANCE) and synthetic trivy scans, with a FAKE `docker` first on a
// PATH that holds no real one — the pin benchmark never reaches a daemon. Pins the verdict line and
// exit (CRIT is hard only under --strict, HIGH only under --strict-high, which implies --strict), the benchmark
// written into the NEWEST deployed batch, expired acceptances that stop suppressing, an expiry cliff
// named as one, the pin states, and the refusals: no ledger and no deployed scan are exit 2 skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'monitor', 'image-acceptance.mjs');
const POSIX = process.platform !== 'win32';

// `docker image inspect <tag> --format …` → the digest in $FAKE_DOCKER_DIR/<tag with / and : as _>,
// or exit 1 (not local). Nothing else is answered.
const FAKE_DOCKER = `#!/bin/sh
[ "$1" = image ] && [ "$2" = inspect ] || exit 1
f="$FAKE_DOCKER_DIR/$(printf '%s' "$3" | tr '/:' '__')"
[ -f "$f" ] && { cat "$f"; exit 0; }
exit 1
`;

const scan = (vulns) => ({ Results: [{ Target: 'image', Vulnerabilities: vulns.map(([id, pkg, sev]) => ({ VulnerabilityID: id, PkgName: pkg, Severity: sev })) }] });
const accepted = (cve, extra = {}) => ({ image: 'web', cve, severity: 'CRITICAL', fixStatus: 'no-fix', reachability: 'unreachable: not loaded',
  containment: ['read-only-fs'], recheckTrigger: 'upstream fix', expires: '2099-01-01', ...extra });
const PIN = 'sha256:' + 'a'.repeat(64);

function sandbox(t, { ledger, deployed = { 'images-20260201-deployed': { 'web.json': scan([]) } } }) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-image-acceptance-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const reports = join(dir, 'reports'); mkdirSync(reports);
  const reg = JSON.parse(readFileSync(join(CW, 'monitor', 'projects.example.json'), 'utf8'));
  reg.reportsRoot = reports;
  writeFileSync(join(dir, 'projects.json'), JSON.stringify(reg));
  for (const [batch, files] of Object.entries(deployed)) {
    mkdirSync(join(reports, batch));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(reports, batch, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  if (ledger !== null) writeFileSync(join(dir, 'ledger.json'), typeof ledger === 'string' ? ledger : JSON.stringify(ledger));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER); chmodSync(join(bin, 'docker'), 0o755);
  const digests = join(dir, 'digests'); mkdirSync(digests);
  return { dir, reports, digests, ledger: join(dir, 'ledger.json'), registry: join(dir, 'projects.json') };
}

function run(s, args = []) {
  const env = { ...process.env, CW_REGISTRY: s.registry, CW_IMAGE_ACCEPTANCE: s.ledger, FAKE_DOCKER_DIR: s.digests,
    PATH: `${join(s.dir, 'bin')}:/usr/bin:/bin` };
  delete env.CW_REGISTRY_REQUIRE_REAL;
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const bench = (s, batch = 'images-20260201-deployed') => readFileSync(join(s.reports, batch, 'acceptance-benchmark.md'), 'utf8');

const image = (extra = {}) => ({ web: { runningTag: 'example/web:1.0', targetTag: 'example/web:1.1', pin: `example/web@${PIN}`, disposition: 'keep', ...extra } });

test('every CRIT accepted or fixable-tracked is a PASS; an unaccepted HIGH is soft unless --strict --strict-high', { skip: !POSIX }, (t) => {
  const s = sandbox(t, {
    ledger: { images: image(), accepted: [accepted('CVE-2099-0001')], fixableViaRebuild: [{ image: 'web', cve: 'CVE-2099-0002', severity: 'CRITICAL', fix: 'rebuild on the patched base' }] },
    deployed: {
      'images-20260101-deployed': { 'web.json': scan([]) },
      'images-20260201-deployed': { 'web.json': scan([['CVE-2099-0001', 'libx', 'CRITICAL'], ['CVE-2099-0002', 'liby', 'CRITICAL'], ['CVE-2099-0003', 'libz', 'HIGH']]) },
    },
  });
  const r = run(s);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^CRIT BENCHMARK PASS\n/);
  assert.match(r.out, /1 accepted \(w\/ containment\) · 1 fixable-tracked · 0 crit unaccounted · 1 highs not-yet-accepted \(soft\) -> .*images-20260201-deployed\/acceptance-benchmark\.md/);
  const md = bench(s);
  assert.match(md, /^> \*\*CRIT BENCHMARK PASS\*\* · highs pending full-accept pass: 1 · accepted=1 · fixable-tracked=1\n/);
  assert.match(md, /\*\*CRIT \(2\):\*\* CVE-2099-0001✓ CVE-2099-0002⌁/);
  assert.match(md, /highs not yet in ledger \(1\): libz/);
  assert.equal(existsSync(join(s.reports, 'images-20260101-deployed', 'acceptance-benchmark.md')), false, 'only the newest batch is judged');
  assert.equal(run(s, ['--strict']).code, 0, 'no hard failure: --strict alone passes');
  assert.equal(run(s, ['--strict', '--strict-high']).code, 1, 'with --strict-high the unaccepted HIGH is hard');
});

test('an unaccepted CRIT fails the benchmark: reported always, exit 1 only under --strict', { skip: !POSIX }, (t) => {
  const s = sandbox(t, {
    ledger: { images: image(), accepted: [], fixableViaRebuild: [] },
    deployed: { 'images-20260201-deployed': { 'web.json': scan([['CVE-2099-0004', 'libq', 'CRITICAL']]) } },
  });
  const r = run(s);
  assert.equal(r.code, 0);
  assert.match(r.out, /^CRIT BENCHMARK FAIL \(1 unaccepted crit, 0 containment gaps\)/);
  assert.match(bench(s), /## web — ✗ CRIT unaccounted[\s\S]*UNACCEPTED CRIT: CVE-2099-0004 \(libq\)/);
  const strict = run(s, ['--strict']);
  assert.equal(strict.code, 1);
  assert.match(strict.out, /CRIT BENCHMARK FAIL/);
});

test('an expired acceptance stops suppressing and is listed; acceptances lapsing on one date are named as a cliff', { skip: !POSIX }, (t) => {
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const s = sandbox(t, {
    ledger: { images: image(), fixableViaRebuild: [], accepted: [
      accepted('CVE-2099-0005', { expires: '2000-01-01' }),
      accepted('CVE-2099-0006', { expires: soon }), accepted('CVE-2099-0007', { expires: soon }),
    ] },
    deployed: { 'images-20260201-deployed': { 'web.json': scan([['CVE-2099-0005', 'liba', 'CRITICAL'], ['CVE-2099-0006', 'libb', 'CRITICAL']]) } },
  });
  const r = run(s);
  assert.match(r.out, /CRIT BENCHMARK FAIL \(1 unaccepted crit/);
  const md = bench(s);
  assert.match(md, /## expired risk acceptances \(1\) — no longer suppressing\n\n- ⏰ web CVE-2099-0005 expired 2000-01-01/);
  assert.match(md, new RegExp(`- \\*\\*${soon}\\*\\* \\(in \\d+d\\) — \\*\\*2 acceptances lapse together\\.\\*\\*`));
  assert.match(md, /UNACCEPTED CRIT: CVE-2099-0005 \(liba\)/);
});

test('the pin benchmark reports match, drift and not-local from docker\'s answer', { skip: !POSIX }, (t) => {
  const s = sandbox(t, {
    ledger: { accepted: [], fixableViaRebuild: [], images: {
      ...image(),
      api: { runningTag: 'example/api:2.0', targetTag: 'example/api:2.1', pin: `example/api@${PIN}`, disposition: 'keep' },
      jobs: { runningTag: 'example/jobs:3.0', targetTag: 'example/jobs:3.1', pin: `example/jobs@${PIN}`, disposition: 'keep' },
    } },
    deployed: { 'images-20260201-deployed': { 'web.json': scan([]), 'api.json': scan([]), 'jobs.json': scan([]) } },
  });
  writeFileSync(join(s.digests, 'example_web_1.0'), `example/web@${PIN}\n`);
  writeFileSync(join(s.digests, 'example_api_2.0'), `example/api@sha256:${'b'.repeat(64)}\n`);
  assert.equal(run(s).code, 0);
  const md = bench(s);
  assert.match(md, /- \*\*web\*\* example\/web:1\.0 → example\/web:1\.1 · keep — ✓ matches pin/);
  assert.match(md, /- \*\*api\*\* example\/api:2\.0 → .* — ⚠ DRIFT run sha256:bbbbbbbbbbbbb… ≠ pin sha256:aaaaaaaaaaaaa…/);
  assert.match(md, /- \*\*jobs\*\* example\/jobs:3\.0 → .* — \(not local\)/);
});

test('a target-state scan is judged when declared; a rebuilding image with none is pending; an unreadable scan is named', { skip: !POSIX }, (t) => {
  const s = sandbox(t, {
    ledger: { accepted: [], fixableViaRebuild: [], images: {
      ...image({ targetScan: 'web-target.json' }),
      api: { runningTag: 'example/api:2.0', targetTag: 'example/api:2.1', pin: `example/api@${PIN}`, disposition: 'rebuilding', expectedResidual: 0 },
      jobs: { runningTag: 'example/jobs:3.0', targetTag: 'example/jobs:3.1', pin: `example/jobs@${PIN}`, disposition: 'keep' },
    } },
    deployed: { 'images-20260201-deployed': {
      // the running image's CRIT is gone in the target, so it must not be counted
      'web.json': scan([['CVE-2099-0008', 'libc', 'CRITICAL']]), 'web-target.json': scan([]),
      'jobs.json': '{ "Results": [',
    } },
  });
  const r = run(s);
  // jobs was never judged, so the benchmark cannot claim a pass; --strict says so in its exit
  assert.match(r.out, /^CRIT BENCHMARK UNMEASURED \(1 image scan unreadable\)/);
  assert.equal(r.code, 0);
  assert.equal(run(s, ['--strict']).code, 2);
  const md = bench(s);
  assert.match(md, /## web — ✓ {2}<span>\(target example\/web:1\.1\)<\/span>/);
  assert.match(md, /## api — ⏳ target pending {2}<span>\(target pending \(rebuilding, expect 0\)\)<\/span>/);
  assert.match(md, /## jobs — scan unreadable/);
});

test('no ledger is a stated skip (exit 2), never a pass, and writes no benchmark', { skip: !POSIX }, (t) => {
  const s = sandbox(t, { ledger: null });
  const r = run(s);
  assert.equal(r.code, 2);
  assert.equal(r.err.trim(), `image-acceptance: no acceptance ledger at ${s.ledger} (ENOENT) — benchmark not run`);
  assert.equal(existsSync(join(s.reports, 'images-20260201-deployed', 'acceptance-benchmark.md')), false);
});

test('an unparseable ledger is a failure, not a skip and not an empty ledger', { skip: !POSIX }, (t) => {
  const s = sandbox(t, { ledger: '{ "accepted": [' });
  const r = run(s);
  assert.notEqual(r.code, 0);
  assert.notEqual(r.code, 2, 'unreadable must not share the absent exit');
  assert.match(r.err, /JSON/);
  assert.equal(existsSync(join(s.reports, 'images-20260201-deployed', 'acceptance-benchmark.md')), false);
});

test('no images-*-deployed batch is a stated skip (exit 2)', { skip: !POSIX }, (t) => {
  const s = sandbox(t, { ledger: { images: image(), accepted: [], fixableViaRebuild: [] }, deployed: { 'images-20260201-partial': {} } });
  const r = run(s);
  assert.equal(r.code, 2);
  assert.equal(r.err.trim(), 'image-acceptance: no images-*-deployed scan found');
});

test('--strict-high on its own makes an unaccepted HIGH hard, and implies --strict for CRIT', { skip: !POSIX }, (t) => {
  const high = sandbox(t, {
    ledger: { images: image(), accepted: [], fixableViaRebuild: [] },
    deployed: { 'images-20260201-deployed': { 'web.json': scan([['CVE-2099-0010', 'libh', 'HIGH']]) } },
  });
  assert.equal(run(high, ['--strict']).code, 0, 'the HIGH is soft under --strict alone');
  const r = run(high, ['--strict-high']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /0 crit unaccounted · 1 highs not-yet-accepted/);
  const crit = sandbox(t, {
    ledger: { images: image(), accepted: [], fixableViaRebuild: [] },
    deployed: { 'images-20260201-deployed': { 'web.json': scan([['CVE-2099-0011', 'libk', 'CRITICAL']]) } },
  });
  assert.equal(run(crit, ['--strict-high']).code, 1, 'stricter about HIGH is never laxer about CRIT');
});

test('an accepted entry with no reachability is a containment gap that fails the benchmark, never a crash', { skip: !POSIX }, (t) => {
  const s = sandbox(t, {
    ledger: { images: image(), fixableViaRebuild: [], accepted: [accepted('CVE-2099-0012', { reachability: undefined })] },
    deployed: { 'images-20260201-deployed': { 'web.json': scan([['CVE-2099-0012', 'libr', 'CRITICAL']]) } },
  });
  const r = run(s);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^CRIT BENCHMARK FAIL \(0 unaccepted crit, 1 containment gaps\)\n/);
  const md = bench(s);
  assert.match(md, /- ✗ accepted web CVE-2099-0012 missing: reachability\n/);
  assert.match(md, /\| web \| CVE-2099-0012 \| CRITICAL \| no-fix \| ✗ missing \| read-only-fs \| upstream fix \|/);
  const strict = run(s, ['--strict']);
  assert.equal(strict.code, 1);
  assert.match(strict.out, /CRIT BENCHMARK FAIL \(0 unaccepted crit, 1 containment gaps\)/);
});

test('a pin without a digest is reported as malformed, not as an image that is merely not local', { skip: !POSIX }, (t) => {
  const s = sandbox(t, { ledger: { accepted: [], fixableViaRebuild: [], images: image({ pin: PIN }) } });
  run(s);
  assert.match(bench(s), /pin malformed — expected <repo>@<digest>/);
});

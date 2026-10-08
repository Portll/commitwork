// bin/test/lane-fixture.test.mjs — the fixture harness accepts only what the lane's extractor counts,
// allows a drafted artifact only where the manifest says a real run cannot measure the lane, and
// installs without clobbering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { laneSpec, scrubPaths, acceptLane, installFixture, realRunBlocker, seedRepo, readHistory, HISTORY_FILE, manifestCheck } from '../lane-fixture.mjs';

const TLS_TWO = JSON.stringify({ ran: true, target: 'https://fake.example', headers: { missing: ['Strict-Transport-Security', 'X-Frame-Options'] } });
const TLS_NONE = JSON.stringify({ ran: true, target: 'https://fake.example', headers: { missing: [] } });

function draftDir(file, content) {
  const d = mkdtempSync(join(tmpdir(), 'cw-lf-draft-'));
  writeFileSync(join(d, file), content);
  writeFileSync(join(d, `${file}.exit`), '1\n');
  return d;
}

test('laneSpec names the check and the artifact the extractor reads', () => {
  const s = laneSpec('shellLint');
  assert.equal(s.checkId, 'shell-lint');
  assert.deepEqual(s.artifacts, ['shellcheck.json']);
  assert.equal(laneSpec('no-such-lane'), null);
});

test('scrubPaths replaces every spelling of the scratch repo and the home directory', () => {
  const text = '/private/var/x/repo/a.sh and /var/x/repo/b.sh under /Users/x/.cache';
  const out = scrubPaths(text, ['/var/x/repo', '/private/var/x/repo'], '/Users/x');
  assert.equal(out, '/fixture/repo/a.sh and /fixture/repo/b.sh under /src/fixture/.cache');
});

test('realRunBlocker comes from the manifest and the machine, never from the draft', () => {
  const all = { hasTool: () => true, env: { K: 'v' }, docker: () => true };
  assert.match(realRunBlocker({ egress: 'target', requires: {} }, all), /live target/);
  assert.match(realRunBlocker({ egress: 'github', requires: {} }, all), /live target/);
  assert.match(realRunBlocker({ egress: 'none', requires: { tools: ['x'] } }, { ...all, hasTool: () => false }), /tools not installed: x/);
  assert.match(realRunBlocker({ egress: 'registry', requires: { secrets: ['K', 'J'] } }, all), /secrets unset: J/);
  assert.match(realRunBlocker({ egress: 'registry', requires: { docker: true } }, { ...all, docker: () => false }), /Docker/);
  assert.equal(realRunBlocker({ egress: 'none', requires: { tools: ['x'], secrets: ['K'], docker: true } }, all), null);
  assert.match(realRunBlocker(null, all), /not in the bundled manifest/);
});

// shellcheck present or absent on the machine running the suite decided which branch these took,
// so this failed on a box without it. The machine is now stated, both ways.
const SHELLCHECK_DRAFT = '{"comments":[{"file":"a.sh","line":1,"level":"warning","code":2086,"message":"x"}]}';

test('a file-reading lane with an empty seed is rejected, whatever the draft says', () => {
  const r = acceptLane({
    category: 'shellLint', seed: mkdtempSync(join(tmpdir(), 'cw-lf-seed-')),
    draft: draftDir('shellcheck.json', SHELLCHECK_DRAFT),
    machine: { hasTool: () => true, env: {}, docker: () => true },
  });
  assert.equal(r.accepted, false);
  assert.equal(r.blocker, undefined);
  assert.match(r.reason, /needs a seed/);
});

test('where the lane cannot run, the blocker is named and the draft is labelled synthetic, never real', () => {
  const r = acceptLane({
    category: 'shellLint', seed: mkdtempSync(join(tmpdir(), 'cw-lf-seed-')),
    draft: draftDir('shellcheck.json', SHELLCHECK_DRAFT),
    machine: { hasTool: () => false, env: {}, docker: () => true },
  });
  assert.match(r.blocker, /tools not installed: shellcheck/);
  assert.equal(r.run, undefined, 'no real run was attempted');
  assert.equal(r.source, 'synthetic');
});

test('a live-target lane accepts a counting draft and labels it synthetic with the reason', () => {
  const r = acceptLane({ category: 'tlsHeaders', draft: draftDir('tls-headers.json', TLS_TWO) });
  assert.equal(r.run, undefined, 'no real run against a scratch repo for a lane that reads a URL');
  assert.match(r.blocker, /live target/);
  assert.equal(r.source, 'synthetic');
  assert.equal(r.witness, 'counting');
  assert.equal(r.accepted, true);
});

test('a draft the extractor reads as zero is rejected, never installed as a pass', () => {
  const r = acceptLane({ category: 'tlsHeaders', draft: draftDir('tls-headers.json', TLS_NONE) });
  assert.equal(r.accepted, false);
  assert.equal(r.witness, 'zero-on-golden');
});

test('no draft for a live-target lane is a rejection that says why', () => {
  const r = acceptLane({ category: 'tlsHeaders' });
  assert.equal(r.accepted, false);
  assert.match(r.reason, /no artifact: a real run cannot measure this lane here/);
});

test('installFixture writes provenance with its reason, sorted, and refuses to overwrite without replace', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-lf-root-'));
  const prev = process.env.CW_LANE_FIXTURES;
  const prevNow = process.env.CW_NOW;
  process.env.CW_LANE_FIXTURES = root;
  process.env.CW_NOW = '2026-09-30';
  try {
    const r = acceptLane({ category: 'tlsHeaders', draft: draftDir('tls-headers.json', TLS_TWO) });
    installFixture(r, { draftedBy: 'test' });
    assert.deepEqual(readdirSync(join(root, 'tlsHeaders')).sort(), ['tls-headers.json', 'tls-headers.json.exit']);
    const prov = JSON.parse(readFileSync(join(root, 'PROVENANCE.json'), 'utf8'));
    assert.equal(prov.lanes.tlsHeaders.source, 'synthetic');
    assert.match(prov.lanes.tlsHeaders.why, /live target/);
    assert.deepEqual(prov.lanes.tlsHeaders.files, ['tls-headers.json', 'tls-headers.json.exit']);
    assert.equal(prov.lanes.tlsHeaders.draftedBy, 'test');
    assert.equal(prov.lanes.tlsHeaders.accepted, '2026-09-30');
    assert.throws(() => installFixture(r), /already holds a fixture/);
    mkdirSync(join(root, 'aaa'));
    installFixture(r, { replace: true });
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(root, 'PROVENANCE.json'), 'utf8')).lanes), ['tlsHeaders']);
  } finally {
    if (prev === undefined) delete process.env.CW_LANE_FIXTURES; else process.env.CW_LANE_FIXTURES = prev;
    if (prevNow === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prevNow;
  }
});

test('pruneSarif keeps only cited rules and remaps ruleIndex so every result still resolves', async () => {
  const { pruneSarif } = await import('../lane-fixture.mjs');
  const doc = { runs: [{ tool: { driver: { rules: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } }, results: [{ ruleId: 'c', ruleIndex: 2 }, { ruleId: 'a', ruleIndex: 0 }, { ruleId: 'c' }] }] };
  const r = pruneSarif(JSON.stringify(doc));
  assert.equal(r.pruned, true);
  assert.equal(r.removed, 1);
  const out = JSON.parse(r.text).runs[0];
  assert.deepEqual(out.tool.driver.rules.map((x) => x.id), ['c', 'a']);
  for (const res of out.results.filter((x) => Number.isInteger(x.ruleIndex))) assert.equal(out.tool.driver.rules[res.ruleIndex].id, res.ruleId);
  assert.equal(pruneSarif('not json').pruned, false);
  assert.equal(pruneSarif(JSON.stringify({ runs: [{ tool: { driver: { rules: [{ id: 'a' }] } }, results: [{ ruleId: 'a', ruleIndex: 0 }] }] })).pruned, false);
});

test('a seed history replays as commits with the declared authors and dates, and the file itself stays out of the tree', () => {
  const seed = mkdtempSync(join(tmpdir(), 'cw-lf-hist-'));
  writeFileSync(join(seed, 'README.md'), 'seed\n');
  writeFileSync(join(seed, HISTORY_FILE), JSON.stringify({ commits: [
    { message: 'one', date: '2026-02-01T10:00:00Z', author: { name: 'Dev One', email: 'one@example.com' }, files: { 'a/one.txt': '1\n' } },
    { message: 'two', date: '2026-02-01T10:05:00Z', author: { name: 'Dev Two', email: 'two@example.com' },
      committer: { name: 'Dev Three', email: 'three@example.com' }, files: { 'a/one.txt': '2\n' } },
  ] }));
  const repo = join(mkdtempSync(join(tmpdir(), 'cw-lf-repo-')), 'repo');
  assert.deepEqual(seedRepo(seed, repo), { commits: 3 });
  const log = execFileSync('git', ['log', '--reverse', '--format=%s|%an <%ae>|%cn <%ce>|%aI'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(log, [
    'lane fixture seed|Lane Fixture <fixture@example.com>|Lane Fixture <fixture@example.com>|2026-01-01T00:00:00Z',
    'one|Dev One <one@example.com>|Dev One <one@example.com>|2026-02-01T10:00:00Z',
    'two|Dev Two <two@example.com>|Dev Three <three@example.com>|2026-02-01T10:05:00Z',
  ]);
  assert.equal(readFileSync(join(repo, 'a', 'one.txt'), 'utf8'), '2\n');
  assert.equal(execFileSync('git', ['ls-files', HISTORY_FILE], { cwd: repo, encoding: 'utf8' }), '', 'the history file was committed');
});

test('a malformed or escaping seed history is refused, never half-applied', () => {
  const bad = (doc) => { const d = mkdtempSync(join(tmpdir(), 'cw-lf-bad-')); writeFileSync(join(d, HISTORY_FILE), typeof doc === 'string' ? doc : JSON.stringify(doc)); return d; };
  const ok = { message: 'm', date: '2026-02-01T10:00:00Z', author: { name: 'A', email: 'a@example.com' } };
  assert.throws(() => readHistory(bad('{ not json')), /lane-history/);
  assert.throws(() => readHistory(bad({ commits: [] })), /at least one commit/);
  assert.throws(() => readHistory(bad({ commits: [{ ...ok, date: 'yesterday' }] })), /ISO date/);
  assert.throws(() => readHistory(bad({ commits: [{ ...ok, author: { name: 'A' } }] })), /name and an email/);
  assert.throws(() => readHistory(bad({ commits: [{ ...ok, files: { '../x': 'y' } }] })), /leaves the repository/);
  assert.deepEqual(readHistory(mkdtempSync(join(tmpdir(), 'cw-lf-none-'))), [], 'no history file declares no history');
});

test('a check is found in whichever bundled manifest declares it, and the run uses that manifest', () => {
  assert.equal(manifestCheck('a11y-wcag').manifest, 'security-baseline');
  assert.equal(manifestCheck('test-hermetic').manifest, 'hermetic-tests', 'test-hermetic lives outside the baseline');
  assert.equal(manifestCheck('no-such-check'), null);
});

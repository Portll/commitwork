// /daily's read of cobolwork's advice document: the list in summary.ordered order with each entry's
// text, steps, fix location and compliance; the rule prose gone from the items an entry covers; and,
// without advice, the reason in the digest and the report with the items as they were. The stored
// document is `cobolwork advise` over cobolwork's bench/cases/001-argv-reaches-os-command, trimmed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDigest, digestIdOf, fitDigest, itemId } from '../daily.mjs';
import { ADVICE_LANE, adviceReport, adviceSection, attachAdvice } from '../daily-advice.mjs';
import { validateDigest, validateReport } from '../daily-validate.mjs';
import { envelopeFor, main } from '../../bin/daily-run.mjs';
import { AREA, REPO, dailyFixture, rows } from './lib/daily-fixture.mjs';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'test', 'fixtures');
const STUB = join(FIXTURES, 'cobolwork-advice-stub.mjs');
const STORED = JSON.parse(readFileSync(join(FIXTURES, 'cobolwork-advice-001.json'), 'utf8'));
const RULE = 'argv-or-env-to-os-command';
const COBOL_ID = itemId(REPO, 'sastCobol', RULE, 'P2.cbl');
const EXEC_ID = itemId(REPO, 'sastSemgrep', 'js.exec', 'src/app.js');
const BATCH = 'sweep-20261002000000';
const cobolRow = { repo: REPO, rule: RULE, file: 'P2.cbl', line: 10, sev: 'crit', evidence: 'path', cwe: 'CWE-78', program: 'P2',
  message: "Command-line or environment input reaches CALL 'SYSTEM'", remedy: 'Build the command only from fixed literals' };

function cobolFixture({ lane = true } = {}) {
  const fx = dailyFixture({ previousRows: {}, currentRows: { sastSemgrep: [rows.exec], sastCobol: [cobolRow] } });
  if (lane) {
    for (const stamp of ['20261001000000', '20261002000000']) {
      const p = join(fx.reports, `sweep-${stamp}-${AREA}`, REPO, 'checks-status.json');
      writeFileSync(p, JSON.stringify([...JSON.parse(readFileSync(p, 'utf8')), { check: ADVICE_LANE, status: 'pass' }]));
    }
  }
  return fx;
}
const build = (fx) => buildDigest({
  reportsRoot: fx.reports, areaOut: fx.areaOut, area: AREA, members: [REPO], config: fx.config, configSha256: 'a'.repeat(64),
  previousConfigSha: 'a'.repeat(64), now: new Date('2026-10-02T01:00:00Z'), guidanceFor: () => 'fix the sink',
});
const stubEnv = (caps) => ({ ...process.env, CW_COBOLWORK_BIN: STUB, CW_TEST_ADVICE_CAPS: caps, CW_TEST_ADVICE_DOC: '', CW_TEST_ADVICE_ARGV: '', CW_IRONWORK_BIN: '' });
const itemOf = (digest, id) => digest.repos[0].items.find((i) => i.id === id);

test('with advice, the repo carries cobolwork\'s order with each entry\'s text, steps, fix location and compliance, and the item it covers loses the rule prose', async () => {
  const fx = cobolFixture();
  const { digest, repoPaths } = build(fx);
  assert.equal(itemOf(digest, COBOL_ID).detail.remedy, cobolRow.remedy, 'before advice the item carries the rule prose');
  await attachAdvice(digest, { repoPathOf: (n) => repoPaths[n], env: stubEnv('advise'), maxEntries: 40, maxBytes: 300_000 });
  assert.deepEqual(validateDigest(digest), []);
  assert.equal(digest.digestId, digestIdOf(digest), 'the digest is restamped over its advice');
  const a = digest.repos[0].advice;
  assert.equal(a.state, 'read');
  assert.deepEqual(a.ordered.map((e) => e.id), STORED.summary.ordered);
  const [finding, ...practices] = a.ordered;
  const source = STORED.items[0];
  assert.deepEqual(finding.findingIds, [COBOL_ID]);
  assert.equal(finding.text, source.remediation.text);
  assert.deepEqual(finding.steps, source.remediation.steps);
  assert.deepEqual(finding.fixAt, { path: 'P2.cbl', line: 10, item: 'WS-LOCAL', test: source.remediation.fixAt.test });
  assert.deepEqual(finding.compliance.map((c) => `${c.framework} ${c.clause}`), ['dora Article 9(3)(b)', 'nist-800-53r5 SI-10', 'ffiec DA&M V', 'cobit-2019 DSS06.02']);
  assert.ok(practices.every((p) => p.kind === 'practice' && p.findingIds.length === 0), 'a practice no lane reports covers no item');
  assert.deepEqual(a.unmeasured, STORED.unmeasured);
  const covered = itemOf(digest, COBOL_ID);
  assert.equal(covered.detail.remedy, undefined, 'the advice entry replaces the rule prose');
  assert.equal(covered.detail.program, 'P2', 'and the rest of the detail stays');
  assert.equal(itemOf(digest, EXEC_ID).lane, 'sast', 'an item of another lane is untouched');
});

test('advise runs once per repo over the swept revision read from git objects, with CW_IRONWORK_BIN, and the tree is removed', async () => {
  const fx = cobolFixture();
  const { digest, repoPaths } = build(fx);
  const calls = [];
  const bridge = {
    adviceSupport: async (o) => { calls.push(['support', o.ironwork]); return { ok: true }; },
    advise: async (dir, o) => { calls.push(['advise', dir, readFileSync(join(dir, 'src', 'app.js'), 'utf8').includes('exec(userInput)'), o.ironwork]); return { ok: true, doc: STORED }; },
  };
  await attachAdvice(digest, { repoPathOf: (n) => repoPaths[n], bridge, env: { CW_IRONWORK_BIN: '/opt/ironwork/bin/ironwork' } });
  assert.deepEqual(calls.map((c) => [c[0], c[0] === 'advise' ? c[2] : null, c.at(-1)]), [['support', null, '/opt/ironwork/bin/ironwork'], ['advise', true, '/opt/ironwork/bin/ironwork']]);
  assert.equal(existsSync(calls[1][1]), false);
});

test('without advice, the repo says why, no tree is read, and its items keep the rule prose', async () => {
  const fx = cobolFixture();
  const { digest, repoPaths } = build(fx);
  let read = 0;
  await attachAdvice(digest, { repoPathOf: (n) => repoPaths[n], env: stubEnv('none'), materialise: async () => { read++; throw new Error('not read'); } });
  assert.deepEqual(validateDigest(digest), []);
  assert.deepEqual(digest.repos[0].advice, { state: 'unavailable', reason: 'cobolwork 0.9.0 has no advise command: its capabilities list no cobolwork-advice document' });
  assert.equal(read, 0);
  assert.equal(itemOf(digest, COBOL_ID).detail.remedy, cobolRow.remedy);
});

test('a repo whose cobolwork lane did not run has no advice, and nothing is asked', async () => {
  const fx = cobolFixture({ lane: false });
  const { digest, repoPaths } = build(fx);
  const before = digest.digestId;
  const bridge = { adviceSupport: async () => { throw new Error('not asked'); } };
  await attachAdvice(digest, { repoPathOf: (n) => repoPaths[n], bridge, env: {} });
  assert.equal('advice' in digest.repos[0], false);
  assert.equal(digest.digestId, before);
});

test('advice items under the data paths are left out as the digest leaves them, and the cap counts what is left', () => {
  const doc = JSON.parse(JSON.stringify(STORED));
  for (const i of doc.items) if (i.where.path === 'P1.cbl') i.where.path = 'bench/P1.cbl';
  const s = adviceSection({ ok: true, doc }, { repo: REPO, items: [], dataPaths: ['bench/'], maxEntries: 2 });
  assert.equal(s.dataPathItems, 3);
  assert.deepEqual(s.ordered.map((e) => e.where.path), ['P2.cbl', 'P2.cbl']);
  assert.equal(s.omitted, 2);
  assert.deepEqual(s.ordered[0].findingIds, [], 'an item the digest does not list is covered by nothing');
  assert.deepEqual(adviceSection({ ok: false, unavailable: 'why', reason: 'why' }, { repo: REPO }), { state: 'unavailable', reason: 'why' });
});

test('over the size limit, advice entries go from the end of the order before any item does', async () => {
  const fx = cobolFixture();
  const { digest, repoPaths } = build(fx);
  await attachAdvice(digest, { repoPathOf: (n) => repoPaths[n], env: stubEnv('advise') });
  const full = Buffer.byteLength(JSON.stringify(digest));
  fitDigest(digest, full - 2000);
  const a = digest.repos[0].advice;
  assert.ok(a.ordered.length < STORED.items.length && a.ordered.length > 0, `${a.ordered.length} entries left`);
  assert.deepEqual(a.ordered.map((e) => e.id), STORED.summary.ordered.slice(0, a.ordered.length));
  assert.equal(a.omitted, STORED.items.length - a.ordered.length);
  assert.equal(digest.repos[0].items.length, 2);
});

test('the report carries the advice list, read or unavailable, and meets its schema', async () => {
  const fx = cobolFixture();
  const { digest, repoPaths } = build(fx);
  await attachAdvice(digest, { repoPathOf: (n) => repoPaths[n], env: stubEnv('advise') });
  const report = (d) => ({ schema: 'commitwork.daily-report/1', area: AREA, batch: d.batch, previousBatch: d.previousBatch, digestId: d.digestId,
    generatedAt: '2026-10-02T01:00:00.000Z', ...envelopeFor(d), run: { model: 'operator-supplied', cli: 'n/a', attempts: 1, costUsd: null, durationMs: 0, skillSha256: null, authority: 'test' },
    headline: 'h', suggestions: [], notActioned: [] });
  const read = report(digest);
  assert.deepEqual(validateReport(read), []);
  assert.equal(read.advice[0].state, 'read');
  assert.deepEqual(read.advice[0].suggestions.map((e) => e.id), STORED.summary.ordered);
  assert.deepEqual(adviceReport(digest)[0].suggestions[0].findingIds, [COBOL_ID]);
  const plain = build(cobolFixture()).digest;
  plain.repos[0].advice = { state: 'unavailable', reason: 'cobolwork 0.9.0 has no advise command' };
  const fallback = report(plain);
  assert.deepEqual(validateReport(fallback), []);
  assert.deepEqual(fallback.advice, [{ repo: REPO, state: 'unavailable', reason: 'cobolwork 0.9.0 has no advise command' }]);
  assert.equal('advice' in envelopeFor(build(cobolFixture({ lane: false })).digest), false, 'an area with no advised repo reports none');
});

test('a daily run writes the advice into the digest and the report, and says why when cobolwork has none', async (t) => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  for (const caps of ['advise', 'none']) {
    const fx = cobolFixture();
    Object.assign(process.env, { CW_NOW: '2026-10-02T01:00:00Z', CW_REGISTRY: fx.registry, CW_DAILY_CONFIG: fx.configPath, CW_COBOLWORK_BIN: STUB, CW_TEST_ADVICE_CAPS: caps, CW_TEST_ADVICE_DOC: '', CW_TEST_ADVICE_ARGV: '', CW_IRONWORK_BIN: '' });
    const file = join(fx.root, 'suggestions.json');
    writeFileSync(file, JSON.stringify({ headline: 'h', suggestions: [], notActioned: [EXEC_ID, COBOL_ID].map((findingId) => ({ findingId, reason: 'low-value', note: 'n' })) }));
    assert.equal(await main(['--area', AREA, '--no-todos', '--suggestions', file]), 0);
    const daily = join(fx.areaOut, 'daily');
    const digest = JSON.parse(readFileSync(join(daily, `${BATCH}.digest.json`), 'utf8'));
    const report = JSON.parse(readFileSync(join(daily, `${BATCH}.json`), 'utf8'));
    assert.equal(report.digestId, digest.digestId);
    if (caps === 'advise') {
      assert.equal(report.advice[0].state, 'read');
      assert.equal(report.advice[0].suggestions[0].text, STORED.items[0].remediation.text);
      assert.equal(itemOf(digest, COBOL_ID).detail.remedy, undefined);
    } else {
      assert.deepEqual(report.advice, [{ repo: REPO, state: 'unavailable', reason: 'cobolwork 0.9.0 has no advise command: its capabilities list no cobolwork-advice document' }]);
      assert.equal(itemOf(digest, COBOL_ID).detail.remedy, cobolRow.remedy, 'the suggestions are written from the rule text as before');
    }
  }
});

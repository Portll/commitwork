// bin/test/digest-scheduled.test.mjs — the scheduled digest job: write, deliver only when a
// destination is configured, record every run, and have the next digest list a failed one. The
// CLI runs as a child against fixture stores; destinations are a node:http server on 127.0.0.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendRecord, readJournalFile } from '../lib/verdict-journal-core.mjs';
import { buildDigest, JOB_JOURNAL } from '../digest.mjs';
import { chainedSince, digestStep, MAX_CHAIN_MS } from '../digest-scheduled.mjs';
import { validateAgainstSchema } from '../../monitor/registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'digest-scheduled.mjs');
const SCHEMA = resolve(HERE, '..', '..', 'schema', 'digest.schema.json');
const tmp = mkdtempSync(join(tmpdir(), 'cw-digest-scheduled-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
let seq = 0;

const T1 = '2026-03-02T10:00:00.000Z';
const T2 = '2026-03-03T10:00:00.000Z';
const SECRET = 'T000FIXTURE/B000FIXTURE/scheduledfixturetoken';
const KEY = 're_scheduledfixturekey00';
const INHERITED = /^(CW_(DIGEST_|SECRETS_FILE|REPORTS_ROOT|ISSUES|VERDICT_DIR|DISREGARDED_WARNINGS|NOW|MAIL_|RESEND_)|RESEND_API_KEY$)/;

function fixture() {
  const root = join(tmp, `case-${seq++}`);
  const reports = join(root, 'reports');
  mkdirSync(join(root, 'verdicts'), { recursive: true });
  mkdirSync(reports, { recursive: true });
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !INHERITED.test(k)));
  const env = {
    ...base, CW_REPORTS_ROOT: reports, CW_ISSUES: join(root, 'absent-issues.json'), CW_VERDICT_DIR: join(root, 'verdicts'),
    CW_DISREGARDED_WARNINGS: join(root, 'register.json'), CW_SECRETS_FILE: join(root, 'absent-secrets.json'), CW_NOW: T1,
  };
  return { root, reports, env, journal: join(reports, JOB_JOURNAL) };
}

const run = (env, args = []) => new Promise((done) => {
  execFile(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 120_000 }, (err, stdout, stderr) => {
    done({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr });
  });
});

async function server(status) {
  const hits = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { hits.push({ url: req.url, body }); res.writeHead(status); res.end('x'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { hits, base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
}

const runs = (f) => readJournalFile(f.journal).records;
const step = (rec, name) => rec.steps.find((s) => s.step === name);
const digestFile = (f, stamp) => join(f.reports, 'digest', `digest-${stamp}.json`);

test('with no destination the digest is written, delivery is recorded not-configured (21), and the run exits 0', async () => {
  const f = fixture();
  const r = await run(f.env);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(digestFile(f, '20260302T100000Z')), 'the digest for the window was written');
  const [rec, ...more] = runs(f);
  assert.equal(more.length, 0);
  assert.deepEqual([rec.kind, rec.job, rec.exit, rec.window.until, rec.window.chained], ['scheduled-job-verdict', 'digest', 0, T1, false]);
  assert.equal(rec.window.since, '2026-03-01T10:00:00.000Z', 'unchained: the 24 hours before the run');
  assert.deepEqual(step(rec, 'write'), { step: 'write', exit: 20, written: true, outcome: 'not-all-measured', failed: false },
    'a digest with unmeasured sections is written and honest, not a failed run');
  assert.deepEqual(step(rec, 'deliver'), { step: 'deliver', exit: 21, outcome: 'not-configured', failed: false });
  assert.ok(!existsSync(join(f.reports, 'digest', 'deliveries.json')), 'nothing was attempted, so no ledger');
});

test('a configured destination is delivered, and no part of its URL reaches the record or the output', async () => {
  const f = fixture();
  const srv = await server(200);
  try {
    const r = await run({ ...f.env, CW_DIGEST_WEBHOOK_URL: `${srv.base}/hook/${SECRET}` });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(srv.hits.length, 1);
    assert.equal(JSON.parse(srv.hits[0].body).digestId, JSON.parse(readFileSync(digestFile(f, '20260302T100000Z'), 'utf8')).digestId,
      'the digest this run wrote is the one posted');
    const d = step(runs(f)[0], 'deliver');
    assert.deepEqual([d.exit, d.outcome, d.failed, d.results.map((x) => [x.kind, x.state])], [0, 'delivered', false, [['webhook', 'delivered']]]);
    const said = readFileSync(f.journal, 'utf8') + r.stdout + r.stderr;
    assert.ok(!said.includes(SECRET) && !said.includes('/hook/'), 'the URL path is a credential');
  } finally { await srv.close(); }
});

test('a failed delivery fails the run (21), and the next run chains its window and lists the failure', async () => {
  const f = fixture();
  const bad = await server(500);
  try {
    const r = await run({ ...f.env, CW_DIGEST_WEBHOOK_URL: `${bad.base}/hook/${SECRET}` });
    assert.equal(r.code, 21, r.stdout);
    assert.match(r.stderr, /deliver FAILED/);
    const d = step(runs(f)[0], 'deliver');
    assert.deepEqual([d.exit, d.outcome, d.failed], [20, 'failed', true]);
  } finally { await bad.close(); }

  const r2 = await run({ ...f.env, CW_NOW: T2 });
  assert.equal(r2.code, 0, r2.stderr);
  const second = runs(f)[1];
  assert.deepEqual([second.window.since, second.window.chained], [T1, true], 'the window starts where the last written one ended');
  const doc = JSON.parse(readFileSync(digestFile(f, '20260303T100000Z'), 'utf8'));
  const rows = doc.sections.failedWork.items.filter((i) => i.type === 'scheduled-job-failed');
  assert.deepEqual(rows.map((i) => [i.at, i.subject, i.key]), [[T1, 'digest/deliver', 'scheduled-job:step-failed|digest/deliver']],
    'the run recorded at the window start is this window\'s to report');
  assert.match(rows[0].detail, /^exit 20: failed/);
  assert.deepEqual(validateAgainstSchema(doc, { path: SCHEMA }).errors, []);
});

test('a digest that writes nothing fails the run (20), skips delivery, and is recorded for the next digest', async () => {
  const f = fixture();
  writeFileSync(join(f.reports, 'digest'), 'a file where the digest directory belongs');
  const r = await run({ ...f.env, CW_DIGEST_WEBHOOK_URL: 'http://127.0.0.1:9/never-called' });
  assert.equal(r.code, 20, r.stderr);
  const rec = runs(f)[0];
  const w = step(rec, 'write');
  assert.deepEqual([w.written, w.outcome, w.failed, w.exit], [false, 'not-written', true, 1]);
  assert.deepEqual(step(rec, 'deliver'), { step: 'deliver', exit: null, outcome: 'skipped', failed: false, reason: 'no digest was written this run' });
  assert.equal(chainedSince(runs(f), T2), null, 'a run that wrote nothing is not a window to chain from');

  const next = buildDigest({ root: f.root, env: { CW_NOW: T2 }, since: T1, issuesPath: f.env.CW_ISSUES, verdictDir: f.env.CW_VERDICT_DIR, reportsRoot: f.reports, registerPath: f.env.CW_DISREGARDED_WARNINGS });
  assert.deepEqual(next.sections.failedWork.items.map((i) => i.subject), ['digest/write']);
});

test('a declared secret that does not resolve is a failed delivery; one that resolves is delivered', async () => {
  const f = fixture();
  const table = join(f.root, 'secrets.json');
  const conf = join(f.root, 'hooks.conf');
  writeFileSync(table, JSON.stringify({ version: 1, secrets: { CW_DIGEST_SLACK_URL: `file:${conf}#slack` } }));
  const env = { ...f.env, CW_SECRETS_FILE: table };
  const r = await run(env);
  assert.equal(r.code, 21, r.stderr);
  const d = step(runs(f)[0], 'deliver');
  assert.deepEqual([d.outcome, d.failed], ['unresolved', true]);
  assert.match(d.reason, /CW_DIGEST_SLACK_URL is declared but did not resolve \(not-found\)/);

  const srv = await server(200);
  try {
    writeFileSync(conf, `slack = "${srv.base}/slack/${SECRET}"\n`);
    const r2 = await run({ ...env, CW_NOW: T2 });
    assert.equal(r2.code, 0, r2.stderr);
    assert.equal(srv.hits.length, 1, 'the secrets table is how a launchd run, which inherits no shell, gets the URL');
    assert.ok(!readFileSync(f.journal, 'utf8').includes(SECRET));
  } finally { await srv.close(); }
});

test('email resolves from the secrets table, as a launchd run needs: recipients, transport, sender and key', async () => {
  const f = fixture();
  const table = join(f.root, 'secrets.json');
  const conf = join(f.root, 'mail.conf');
  const srv = await server(200);
  try {
    writeFileSync(conf, `to = "a@example.invalid"\ntransport = "resend"\nfrom = "digest@example.invalid"\nkey = "${KEY}"\n`);
    writeFileSync(table, JSON.stringify({ version: 1, secrets: {
      CW_DIGEST_EMAIL_TO: `file:${conf}#to`, CW_MAIL_TRANSPORT: `file:${conf}#transport`, CW_MAIL_FROM: `file:${conf}#from`, RESEND_API_KEY: `file:${conf}#key`,
    } }));
    const r = await run({ ...f.env, CW_SECRETS_FILE: table, CW_RESEND_API_URL: `${srv.base}/emails`, CW_MAIL_OUTBOX: join(f.root, 'outbox.jsonl'), CW_MAIL_ATTEMPTS: '1' });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(srv.hits.map((h) => h.url), ['/emails']);
    const d = step(runs(f)[0], 'deliver');
    assert.deepEqual([d.outcome, d.results?.[0]?.kind, d.results?.[0]?.state, d.results?.[0]?.target], ['delivered', 'email', 'delivered', '1 recipient']);
    const journal = readFileSync(f.journal, 'utf8');
    assert.ok(!journal.includes(KEY) && !journal.includes('a@example.invalid'), 'the job journal names neither the key nor the inbox');
  } finally { await srv.close(); }
});

test('a run that cannot be recorded exits 22 and puts the record on stderr', async () => {
  const f = fixture();
  mkdirSync(f.journal);
  const r = await run(f.env);
  assert.equal(r.code, 22);
  assert.match(r.stderr, /NOT recorded/);
  const rec = JSON.parse(r.stderr.split('\n').find((l) => l.startsWith('{')));
  assert.equal(rec.window.note.startsWith('job journal unreadable'), true);
  assert.equal(step(rec, 'write').written, true);
});

test('--status lists recorded runs, fails closed on an unreadable journal, and refuses other arguments', async () => {
  const f = fixture();
  assert.match((await run(f.env, ['--status'])).stdout, /no scheduled digest run recorded/);
  await run(f.env);
  const s = await run(f.env, ['--status', '--limit', '1']);
  assert.equal(s.code, 0);
  assert.match(s.stdout, /^2026-03-02T10:00:00\.000Z {2}exit 0 {2}write not-all-measured · deliver not-configured\n$/);
  assert.equal((await run(f.env, ['--status', '--limit', '0'])).code, 23);
  assert.equal((await run(f.env, ['--now'])).code, 23);
  assert.equal((await run({ ...f.env, CW_NOW: 'yesterday' })).code, 23);
  rmSync(f.journal);
  mkdirSync(f.journal);
  assert.equal((await run(f.env, ['--status'])).code, 22);
});

test('chainedSince takes the newest written run under seven days old, and nothing else', () => {
  const rec = (until, written = true, job = 'digest') => ({ kind: 'scheduled-job-verdict', job, window: { until }, steps: [{ step: 'write', written }] });
  assert.equal(chainedSince([rec(T1)], T2), T1);
  assert.equal(chainedSince([rec('2026-03-01T00:00:00.000Z'), rec(T1), rec('2026-03-02T11:00:00.000Z', false)], T2), T1);
  assert.equal(chainedSince([rec(T1, true, 'other')], T2), null);
  assert.equal(chainedSince([rec(T2)], T2), null, 'no window of zero length');
  assert.equal(chainedSince([rec(new Date(Date.parse(T2) - MAX_CHAIN_MS - 1).toISOString())], T2), null, 'a gap past the cap starts afresh');
  assert.equal(chainedSince([], T2), null);
});

test('digestStep reads written from the file and every other exit as a failure with its reason', () => {
  assert.equal(digestStep({ status: 0 }, true).failed, false);
  assert.deepEqual(digestStep({ status: 0 }, false), { step: 'write', exit: 0, written: false, outcome: 'not-written', failed: true, reason: 'exited 0 but wrote no digest for the window' });
  assert.deepEqual(digestStep({ status: 21, stderr: 'x\nreturned warnings NOT recorded in r: busy\n' }, true),
    { step: 'write', exit: 21, written: true, outcome: 'returns-not-recorded', failed: true, reason: 'returned warnings NOT recorded in r: busy' });
  assert.equal(digestStep({ status: 2, stderr: 'usage' }, false).reason, 'usage');
  assert.match(digestStep({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }) }, false).reason, /timed out/);
  assert.equal(digestStep({ status: null, signal: 'SIGKILL' }, false).reason, 'killed by SIGKILL');
});

test('Failed work reads the job journal: absent is a caveat, unreadable is partial, a shapeless record is undetermined', () => {
  const f = fixture();
  mkdirSync(join(f.reports, 'area-a'));
  appendRecord(join(f.reports, 'area-a', 'sweep-journal.jsonl'), { v: 1, kind: 'sweep-area-verdict', at: '2026-03-02T05:00:00.000Z', area: 'area-a', repos: { scans: [], missing: [] }, rollup: 'published' });
  const fw = () => buildDigest({ root: f.root, env: { CW_NOW: T1 }, issuesPath: f.env.CW_ISSUES, verdictDir: f.env.CW_VERDICT_DIR, reportsRoot: f.reports, registerPath: f.env.CW_DISREGARDED_WARNINGS }).sections.failedWork;
  const input = (s) => s.input.find((i) => i.name === 'scheduled job journal');

  let s = fw();
  assert.equal(input(s).state, 'absent');
  assert.ok(s.caveats.some((c) => /no scheduled run has been recorded here/.test(c)));
  assert.equal(s.status, 'measured', 'a box that never ran the job has nothing to report about it');

  appendRecord(f.journal, { v: 1, kind: 'scheduled-job-verdict', job: 'digest', at: '2026-03-02T06:00:00.000Z', steps: [{ step: 'write', outcome: 'measured' }] });
  appendRecord(f.journal, { v: 1, kind: 'scheduled-job-verdict', job: 'digest', at: '2026-02-20T06:00:00.000Z', steps: [{ step: 'write', failed: true, outcome: 'not-written' }] });
  s = fw();
  assert.equal(input(s).state, 'read');
  assert.deepEqual(s.undetermined.filter((u) => u.source === 'scheduled job journal').map((u) => u.why), ['1 run record(s) carry no step outcomes']);
  assert.deepEqual(s.items, [], 'a failure before the window is not this window\'s');

  rmSync(f.journal);
  mkdirSync(f.journal);
  s = fw();
  assert.equal(input(s).state, 'unreadable');
  assert.equal(s.status, 'partial', 'an unreadable journal is never an empty one');
  assert.ok(s.notMeasured.some((m) => /a failed scheduled run cannot be seen/.test(m)));
});

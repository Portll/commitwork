// The Report tab, at the wire against a really-spawned panel: /api/report/states +
// /api/report/evidence replay any recorded state from the history index (the closed set), and the
// payload is redacted for hand-off — public identifiers only, withholding counted, never silent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-report-'));
// the hash-chained state log: the fixture seals its own history the way rollup.mjs does, so the
// routes are tested against a REAL chain, not a hand-authored one
import { sealHistory } from '../../monitor/history-chain.mjs';
import { createHash } from 'node:crypto';
import { panelSource } from './lib/panel-source.mjs';

// strings that must NEVER leave through this route — each appears in the fixture inputs below
const LEAK_MARKERS = [
  'file:///src/package-lock.json', // finding path (rollup + slice)
  'src/secret-holder.js',          // gitleaks file
  'abc123def456',                  // gitleaks commit
  '"path"',                        // the field itself is named out, not filtered out
  'internal-api.corp.example',     // free-text heuristic message (withheld wholesale)
];

const DEP_FINDING = {
  tool: 'osv', id: 'CVE-2026-11111', severity: 'high', cvss: 8.1, package: 'left-pad', version: '1.0.0',
  path: 'file:///src/package-lock.json', fixed: '1.0.9', title: 'left-pad: something public', advisory: 'https://osv.dev/vulnerability/CVE-2026-11111',
  kev: true, epss: 0.42, state: 'born', status: 'open',
};
const FIXTURE_ROLLUP = {
  generated: '2026-08-02T10:00:00.000Z', sliceVersion: 1, sliceId: 'sweep-20260802100000', kind: 'sweep',
  totals: { repos: 1, crit: 0, high: 1, med: 0, low: 0, kev: 1, cves: 1 },
  openTotals: { crit: 0, high: 1, med: 0, low: 0 },
  scanners: {
    secrets: { crit: 0, high: 1, med: 0, low: 0, total: 1, repos: 1, ran: 1, skipped: 0, noscan: 0 },
    supplyChainHeuristic: { crit: 0, high: 0, med: 0, low: 0, total: 1, repos: 1, ran: 0, skipped: 1, noscan: 0, carried: true, carriedFrom: 'sweep-20260801090000', carriedAt: '2026-08-01T09:00:00.000Z' },
  },
  scannerFindings: {
    secrets: [{ repo: 'alpha', rule: 'aws-key', file: 'src/secret-holder.js', line: 5, commit: 'abc123def456', redacted: true }],
    maliciousPackages: [],
    supplyChainHeuristic: [{ repo: 'alpha', rule: 'suspicious-install', package: 'evil-pkg', version: '0.0.1', message: 'phones home to internal-api.corp.example' }],
  },
  repos: [{ name: 'alpha', worst: 'high', findings: [DEP_FINDING] }],
};
const STAMP_OK = '20260801120000';
const STAMP_GONE = '20260726090000'; // named by the index, slice file deliberately absent
const FIXTURE_SLICE = {
  sliceVersion: 1, sliceId: 'sweep-20260801115900', kind: 'sweep', stamp: STAMP_OK,
  generated: '2026-08-01T12:00:00.000Z',
  totals: { repos: 1, crit: 1, high: 0, med: 0, low: 0 },
  openTotals: { crit: 1, high: 0, med: 0, low: 0 },
  scanners: { secrets: { crit: 0, high: 0, med: 0, low: 0, total: 0, repos: 1, ran: 1, skipped: 0, noscan: 0 } },
  delta: { new: 1, fixed: 1, newFindings: [{ ...DEP_FINDING, id: 'CVE-2026-22222', severity: 'crit' }], fixedFindings: [{ ...DEP_FINDING, id: 'CVE-2026-00000', state: 'fixed' }] },
  findings: [{ ...DEP_FINDING, id: 'CVE-2026-22222', severity: 'crit', repo: 'alpha' }],
};
const FIXTURE_INDEX = [
  { stamp: STAMP_GONE, sliceId: 'sweep-20260726085900', kind: 'sweep', file: `${STAMP_GONE}.json`, generated: '2026-07-26T09:00:00.000Z', total: 0, crit: 0, high: 0, med: 0, low: 0, new: 0, fixed: 0, carried: 0, accepted: 0 },
  { stamp: STAMP_OK, sliceId: 'sweep-20260801115900', kind: 'sweep', file: `${STAMP_OK}.json`, generated: '2026-08-01T12:00:00.000Z', total: 1, crit: 1, high: 0, med: 0, low: 0, new: 1, fixed: 1, carried: 0, accepted: 0 },
];

let localPort, child;
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const hit = (path) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: localPort, path, method: 'GET' }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  req.end();
});

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [], projects: [],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true },
      { slug: 'empty-area', label: 'empty-area', out: 'empty-area' }],
  }));
  mkdirSync(join(TMP, 'reports', 'fixarea', 'history'), { recursive: true });
  mkdirSync(join(TMP, 'reports', 'empty-area'), { recursive: true });
  writeFileSync(join(TMP, 'reports', 'fixarea', 'rollup.json'), JSON.stringify(FIXTURE_ROLLUP));
  const sliceBody = JSON.stringify(FIXTURE_SLICE);
  writeFileSync(join(TMP, 'reports', 'fixarea', 'history', `${STAMP_OK}.json`), sliceBody);
  // STAMP_GONE deliberately gets no slice file
  // R1b: the index row attests the exact bytes written above, then the whole history is sealed
  // into chain.jsonl — STAMP_OK from its recorded hash, STAMP_GONE with none (file absent)
  FIXTURE_INDEX[1].sliceSha256 = createHash('sha256').update(sliceBody).digest('hex');
  writeFileSync(join(TMP, 'reports', 'fixarea', 'history', 'index.json'), JSON.stringify(FIXTURE_INDEX));
  sealHistory(join(TMP, 'reports', 'fixarea', 'history'), FIXTURE_INDEX, '2026-08-29T12:00:00.000Z');

  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await hit('/api/csrf')).status === 200; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'panel did not come up against the fixture registry');
});
after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

test('states list: current first, then history newest-first — every state change is replayable', async () => {
  const r = await hit('/api/report/states?project=fixarea');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.states.map((s) => s.id), ['current', STAMP_OK, STAMP_GONE]);
});

test('state labels contextualise (when · kind · open · change) and leak nothing aimable', async () => {
  const r = await hit('/api/report/states?project=fixarea');
  const labels = r.json.states.map((s) => s.label).join('\n');
  // human granularity: month-name date (locale-unambiguous), open counts, the recorded change
  assert.match(labels, /Aug 2026/, 'labels carry a month-name date');
  assert.match(labels, /open \d+ \(\d+C \d+H \d+M \d+L\)/, 'labels carry open counts by severity');
  assert.match(labels, /\+1 new · −1 cleaned/, 'labels carry the recorded state change — the operator’s own action trail');
  for (const m of LEAK_MARKERS) assert.ok(!labels.includes(m), `label leaked ${m}`);
});

test('current evidence is redacted for hand-off — identifiers in, locations counted out', async () => {
  const r = await hit('/api/report/evidence?project=fixarea&state=current');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  // the evidence is PRESENT: public identifiers survive redaction, because they ARE the evidence
  const f = r.json.findings[0];
  assert.equal(f.id, 'CVE-2026-11111');
  assert.equal(f.package, 'left-pad');
  assert.equal(f.kev, true);
  // and the located half does not: named-out fields, counted, never silent
  for (const m of LEAK_MARKERS) assert.ok(!r.body.includes(m), `evidence leaked ${m}`);
  assert.ok(r.json.redaction.withheldLocations >= 2, 'withholding is counted (finding path + secrets location)');
  assert.ok(r.json.redaction.policy.some((p) => /attack chain/.test(p)), 'the chain policy is stated on the payload');
  // secrets arrive as rule+count evidence only — the located rows stay on the Secrets tab
  assert.deepEqual(r.json.secretsEvidence, [{ repo: 'alpha', rule: 'aws-key', count: 1 }]);
  // heuristic free text (which can embed hosts) is withheld wholesale
  assert.equal(r.json.supplyEvidence[0].rule, 'suspicious-install');
  assert.equal(r.json.supplyEvidence[0].message, undefined);
});

test('a recorded state replays from its own slice file, delta included, same redaction', async () => {
  const r = await hit(`/api/report/evidence?project=fixarea&state=${STAMP_OK}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.totals.crit, 1, 'totals are the slice’s own, not the current rollup’s');
  assert.equal(r.json.delta.new, 1);
  assert.equal(r.json.delta.newFindings[0].id, 'CVE-2026-22222');
  for (const m of LEAK_MARKERS) assert.ok(!r.body.includes(m), `replayed evidence leaked ${m}`);
});

test('the history index is the closed set — a well-formed unknown stamp is refused, not a filename', async () => {
  const r = await hit('/api/report/evidence?project=fixarea&state=99990101000000');
  assert.equal(r.status, 404);
  assert.equal(r.json.unknownState, true);
});

test('a malformed state is a 400, never a path', async () => {
  const r = await hit('/api/report/evidence?project=fixarea&state=..%2F..%2Fetc');
  assert.equal(r.status, 400);
});

test('an indexed state whose slice file is gone is declared unreadable — never an empty success', async () => {
  const r = await hit(`/api/report/evidence?project=fixarea&state=${STAMP_GONE}`);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /cannot be replayed/, 'the state exists and cannot be replayed — said, not blanked');
});

test('a declared-but-never-swept area is absent, not a clean report', async () => {
  const r = await hit('/api/report/states?project=empty-area');
  assert.equal(r.json.absent, true);
  assert.equal(r.json.states, null);
});

test('the strip order is a pin: Report sits immediately before Remediation', () => {
  const src = panelSource('index.html');
  const navAt = src.indexOf('<nav id="views"');
  const navEnd = src.indexOf('</nav>', navAt);
  const order = [...src.slice(navAt, navEnd).matchAll(/data-v="([a-z]+)"/g)].map((m) => m[1]);
  const rep = order.indexOf('report'), rem = order.indexOf('remediation');
  assert.ok(rep > -1 && rem > -1, 'both tabs exist in the strip');
  assert.equal(rem, rep + 1, 'a plan whose evidence sits after it invites acting before reading');
});

test('the state log is hash-chained: the states route verifies it and marks the retro-seal', async () => {
  const r = await hit('/api/report/states?project=fixarea');
  const c = r.json.chain;
  assert.equal(c.present, true);
  assert.equal(c.verified, true);
  assert.equal(c.retroSealed, 2, 'both fixture states were sealed retroactively and say so');
  assert.equal(c.unrecordedCount, 0, 'no index row dodged the log');
  assert.match(c.note, /pre-seal/, 'a retro-sealed chain must state it claims nothing pre-seal');
});

test('replayed evidence is byte-checked against the hash its index row attests', async () => {
  const r = await hit(`/api/report/evidence?project=fixarea&state=${STAMP_OK}`);
  assert.deepEqual([r.json.integrity.checked, r.json.integrity.match], [true, true]);
});

test('editing a recorded slice after the fact is NAMED on replay, not served as history', async () => {
  const p = join(TMP, 'reports', 'fixarea', 'history', `${STAMP_OK}.json`);
  const orig = readFileSync(p, 'utf8');
  writeFileSync(p, orig.replace('CVE-2026-22222', 'CVE-2026-99999')); // rewrite the past
  const r = await hit(`/api/report/evidence?project=fixarea&state=${STAMP_OK}`);
  assert.equal(r.json.integrity.match, false);
  assert.match(r.json.integrity.why, /changed after it was recorded/);
  writeFileSync(p, orig); // restore — later tests replay this state too
});

test('an area with no chain log yet says so — the state list is unattested, not broken', async () => {
  const r = await hit('/api/report/states?project=empty-area');
  // empty-area is absent entirely (no rollup, no history) — absence outranks chain talk
  assert.equal(r.json.absent, true);
});

test('the states route carries drift and anchor verdicts, and an unanchored area says so rather than passing', async () => {
  const r = await hit('/api/report/states?project=fixarea');
  const c = r.json.chain;
  assert.deepEqual([c.driftedCount, c.drifted], [0, []]);
  assert.equal(c.anchored, false, 'the fixture never anchored — consistency with nothing is not a pass');
  assert.match(c.anchorWhy, /no anchor|absent/);
  assert.equal(c.verified, true, 'and the missing anchor does not downgrade a chain that verifies on its own');
});

test('a slice rewritten TOGETHER with its index hash is named as drifted — the chain alone did not see it', async () => {
  const histDir = join(TMP, 'reports', 'fixarea', 'history');
  const ip = join(histDir, 'index.json');
  const orig = readFileSync(ip, 'utf8');
  const rows = JSON.parse(orig);
  rows[1].sliceSha256 = 'b'.repeat(64); // the index now attests bytes the log never recorded
  writeFileSync(ip, JSON.stringify(rows));
  const r = await hit('/api/report/states?project=fixarea');
  const c = r.json.chain;
  assert.equal(c.brokenAt, null, 'the chain is intact');
  assert.equal(c.unrecordedCount, 0, 'the stamp is recorded');
  assert.equal(c.driftedCount, 1);
  assert.equal(c.drifted[0].stamp, String(rows[1].stamp));
  assert.equal(c.verified, false);
  assert.match(c.note, /rewritten after the fact/);
  writeFileSync(ip, orig);
});

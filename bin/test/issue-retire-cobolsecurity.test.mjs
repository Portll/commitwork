// bin/issue-retire-cobolsecurity.mjs — carries the retired cobolSecurity lane's open issues onto
// sastCobol by rule|file, closes true duplicates as superseded, refuses what it cannot settle, and
// never reports a fix. Runs the tool as a subprocess against a synthetic store (CW_ISSUES, read at
// call time in the child) — never the live store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { emptyIssuesDoc, mintIssue, closeIssue, loadIssues, verifyChain, identityProblems } from '../../monitor/issue-store.mjs';
import { ingestArea } from '../../monitor/issue-ingest.mjs';

const TOOL = resolve(import.meta.dirname, '..', 'issue-retire-cobolsecurity.mjs');
const AT = '2026-09-20T00:00:00.000Z';
const REPO = 'fixrepo';

// cobolSecurity is no longer a registered category, so it has no class to mint under; the records
// the live store holds were minted when it did. `class` is how a fixture states it explicitly.
const mintCob = (doc, key, rule, { sev = 'high', members = null } = {}) => mintIssue(doc, {
  area: REPO, repo: REPO, kind: 'code', severity: sev, class: 'S',
  title: members ? `${rule} [cobolSecurity] (${REPO}) — ${members.length} hits` : `${rule} [cobolSecurity] (${REPO})`,
  source: { kind: 'scanner-row', key, tool: 'cobolSecurity', rule, ...(members ? {} : { model: 'byte-range' }) },
  groupMembers: members,
}, AT).id;
const mintSast = (doc, key, rule) => mintIssue(doc, {
  area: REPO, repo: REPO, kind: 'code', severity: 'high',
  title: `${rule} [sastCobol] (${REPO})`,
  source: { kind: 'scanner-row', key, tool: 'sastCobol', rule },
}, AT).id;

const sc = (cat, rule, file) => `sc:${REPO}|${cat}|${rule}|${file}`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'retire-cobolsecurity-'));
  const store = join(root, 'issues.json');
  const doc = emptyIssuesDoc();
  const ids = {};
  ids.carried = mintCob(doc, sc('cobolSecurity', 'cics-web-to-dynamic-sql', 'src/S1.cbl'), 'cics-web-to-dynamic-sql', { sev: 'crit' });
  ids.fixture = mintCob(doc, sc('cobolSecurity', 'cics-commarea-without-length-check', 'test/fixtures/cics/C2.cbl'), 'cics-commarea-without-length-check');
  ids.group = mintCob(doc, `gs:${REPO}|cobolSecurity|argv-or-env-to-os-command`, 'argv-or-env-to-os-command', {
    sev: 'crit',
    members: [sc('cobolSecurity', 'argv-or-env-to-os-command', 'src/A2.cbl'), sc('cobolSecurity', 'argv-or-env-to-os-command', 'src/A1.cbl')],
  });
  // Already filed under sastCobol at the very key a carry would take.
  ids.dup = mintCob(doc, sc('cobolSecurity', 'database-to-os-command', 'src/DB.cbl'), 'database-to-os-command');
  ids.dupHolder = mintSast(doc, sc('sastCobol', 'database-to-os-command', 'src/DB.cbl'), 'database-to-os-command');
  // Already filed under sastCobol, and since adopted onto its fingerprint.
  ids.adopted = mintCob(doc, sc('cobolSecurity', 'file-record-to-socket-send', 'src/X3.cbl'), 'file-record-to-socket-send');
  ids.adopter = mintSast(doc, `sc:${REPO}|sastCobol|fingerprint=${'a'.repeat(32)}`, 'file-record-to-socket-send');
  doc.issues[ids.adopter].priorKeys = [sc('sastCobol', 'file-record-to-socket-send', 'src/X3.cbl')];
  // The target slot is held by a CLOSED issue: reopening it or not is a disposition.
  ids.refused = mintCob(doc, sc('cobolSecurity', 'hidden-payload-in-identification-area', 'src/H.cbl'), 'hidden-payload-in-identification-area');
  ids.closedHolder = mintSast(doc, sc('sastCobol', 'hidden-payload-in-identification-area', 'src/H.cbl'), 'hidden-payload-in-identification-area');
  closeIssue(doc, ids.closedHolder, { as: 'fixed', evidence: 'fixture close', at: AT });
  // Closed under the retired lane: its key is history.
  ids.closed = mintCob(doc, sc('cobolSecurity', 'bidi-or-invisible-characters', 'src/B.cbl'), 'bidi-or-invisible-characters');
  closeIssue(doc, ids.closed, { as: 'refuted', evidence: 'fixture close', at: AT });
  // Another lane entirely.
  ids.other = mintIssue(doc, { area: REPO, repo: REPO, kind: 'code', severity: 'high', title: 't',
    source: { kind: 'scanner-row', key: `sc:${REPO}|mainframeSecrets|racf-command-password|jcl/J.jcl`, tool: 'mainframeSecrets', rule: 'racf-command-password' } }, AT).id;
  writeFileSync(store, JSON.stringify(doc, null, 1));
  return { root, store, ids };
}

const run = (store, extra = []) => spawnSync(process.execPath, [TOOL, ...extra],
  { encoding: 'utf8', env: { ...process.env, CW_ISSUES: store, CW_NOW: '2026-09-26T00:00:00.000Z' } });

test('dry run: plans carry, duplicate, refusal and fixture, and writes nothing', () => {
  const { store, ids } = fixture();
  const before = readFileSync(store, 'utf8');
  const r = run(store);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /open\s+6 record\(s\) under cobolSecurity/);
  assert.match(r.stdout, /carry\s+3 \(1 grouped\)/);
  assert.match(r.stdout, /duplicate\s+2\b/);
  assert.match(r.stdout, /refused\s+1\b/);
  assert.match(r.stdout, /closed\s+1 \(skipped/);
  assert.match(r.stdout, new RegExp(`CARRY ${ids.carried}\\s+sc:${REPO}\\|cobolSecurity\\|cics-web-to-dynamic-sql\\|src/S1\\.cbl\\s+->\\s+sc:${REPO}\\|sastCobol\\|cics-web-to-dynamic-sql\\|src/S1\\.cbl`));
  assert.match(r.stdout, new RegExp(`DUPLICATE ${ids.dup} .*same finding as ${ids.dupHolder}`));
  assert.match(r.stdout, new RegExp(`DUPLICATE ${ids.adopted} .*same finding as ${ids.adopter}`));
  assert.match(r.stdout, new RegExp(`REFUSED ${ids.refused} .*slot-taken.*${ids.closedHolder}`));
  assert.match(r.stdout, new RegExp(`FIXTURE ${ids.fixture}\\s+test/fixtures/cics/C2\\.cbl`));
  assert.match(r.stdout, /DRY RUN — nothing written/);
  assert.equal(readFileSync(store, 'utf8'), before, 'a dry run must leave the store byte-identical');
});

test('--write: carries by rule|file, closes duplicates as superseded, and reports no fix', () => {
  const { store, ids } = fixture();
  const beforeDoc = JSON.parse(readFileSync(store, 'utf8'));
  const r = run(store, ['--write']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /3 carried to sastCobol, 2 closed superseded, 1 refused, chain verifies/);
  const doc = loadIssues({ path: store });

  const c = doc.issues[ids.carried];
  const to = sc('sastCobol', 'cics-web-to-dynamic-sql', 'src/S1.cbl');
  assert.equal(c.state, 'open');
  assert.deepEqual(c.source, { kind: 'scanner-row', key: to, tool: 'sastCobol', rule: 'cics-web-to-dynamic-sql', model: 'byte-range' },
    'the analysis the finding was filed under travels with it');
  assert.deepEqual(c.priorKeys, [sc('cobolSecurity', 'cics-web-to-dynamic-sql', 'src/S1.cbl')]);
  assert.equal(c.title, `cics-web-to-dynamic-sql [sastCobol] (${REPO})`);
  assert.equal(c.severity, 'crit');
  assert.equal(c.createdAt, beforeDoc.issues[ids.carried].createdAt, 'the SLA clock is not restarted');
  assert.equal(doc.byKey[to], ids.carried);
  assert.equal(doc.byKey[sc('cobolSecurity', 'cics-web-to-dynamic-sql', 'src/S1.cbl')], undefined, 'the old slot is released');

  const g = doc.issues[ids.group];
  assert.equal(g.source.key, `gs:${REPO}|sastCobol|argv-or-env-to-os-command`);
  assert.deepEqual(g.groupMembers, [sc('sastCobol', 'argv-or-env-to-os-command', 'src/A1.cbl'), sc('sastCobol', 'argv-or-env-to-os-command', 'src/A2.cbl')]);
  assert.equal(g.title, `argv-or-env-to-os-command [sastCobol] (${REPO}) — 2 hits`);
  assert.equal(doc.issues[ids.fixture].source.tool, 'sastCobol', 'a fixture-path record is carried like the rest');

  for (const [id, of] of [[ids.dup, ids.dupHolder], [ids.adopted, ids.adopter]]) {
    const d = doc.issues[id];
    assert.equal(d.state, 'closed');
    assert.equal(d.closedAs, 'superseded', 'a retired lane is not a fix');
    assert.equal(d.deps.duplicateOf, of);
    assert.equal(d.source.tool, 'cobolSecurity', 'a closed record keeps its historical key');
    assert.equal(doc.issues[of].state, 'open');
  }
  assert.equal(doc.issues[ids.refused].source.tool, 'cobolSecurity', 'a refusal changes nothing');
  assert.equal(doc.issues[ids.refused].state, 'open');
  assert.equal(doc.issues[ids.closed].source.tool, 'cobolSecurity');
  assert.equal(doc.issues[ids.other].source.key, beforeDoc.issues[ids.other].source.key);
  assert.ok(!Object.values(doc.issues).some((i) => i.closedAs === 'fixed' && !beforeDoc.issues[i.id]?.closedAs),
    'nothing newly closed as fixed');
  assert.deepEqual(verifyChain(doc), []);
  assert.deepEqual(identityProblems(doc), []);
  assert.equal(doc.events.filter((e) => e.type === 'issue-key-migrated').length, 3);
});

test('idempotent: a second --write plans nothing and leaves the store byte-identical', () => {
  const { store } = fixture();
  assert.equal(run(store, ['--write']).status, 0);
  const after1 = readFileSync(store, 'utf8');
  const r = run(store, ['--write']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /carry\s+0\b/);
  assert.match(r.stdout, /nothing to carry/);
  assert.equal(readFileSync(store, 'utf8'), after1);
});

test('fail closed: a store whose chain does not verify is refused and left untouched', () => {
  const { store } = fixture();
  const doc = JSON.parse(readFileSync(store, 'utf8'));
  doc.events[1].hash = '0'.repeat(64);
  writeFileSync(store, JSON.stringify(doc, null, 1));
  const before = readFileSync(store, 'utf8');
  const r = run(store, ['--write']);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /does not verify BEFORE migrating/);
  assert.equal(readFileSync(store, 'utf8'), before);
});

// ── through the real ingest: the carry is only right if sastCobol then picks the records up ───────
const rollup = (gen, sliceId, rows) => ({
  generated: gen, sliceId, repos: [],
  scanners: { sastCobol: { ran: true, total: rows.length } },
  scannerFindings: { sastCobol: rows.map((r) => ({ repo: REPO, sev: 'crit', line: 10, model: 'byte-range', ...r })) },
});

test('the first sastCobol slice adopts the carried records and closes nothing as fixed', () => {
  const { store, ids } = fixture();
  assert.equal(run(store, ['--write']).status, 0);
  const doc = loadIssues({ path: store });
  const gen = '2026-09-26T01:00:00.000Z';
  const s = ingestArea(doc, {
    areaSlug: REPO, now: gen,
    rollup: rollup(gen, 'slice-after-retire', [
      { rule: 'cics-web-to-dynamic-sql', file: 'src/S1.cbl', fingerprint: 'b'.repeat(32) },
      { rule: 'argv-or-env-to-os-command', file: 'src/A1.cbl', fingerprint: 'c'.repeat(32) },
      { rule: 'argv-or-env-to-os-command', file: 'src/A2.cbl', fingerprint: 'd'.repeat(32) },
      { rule: 'file-record-to-socket-send', file: 'src/X3.cbl', fingerprint: 'a'.repeat(32) },
      { rule: 'database-to-os-command', file: 'src/DB.cbl', fingerprint: 'e'.repeat(32) },
      // the fixture-path finding is absent: sastCobol sets it aside rather than filing it
    ]),
  });
  assert.deepEqual(s.closed, [], 'no carried record is reported fixed');
  assert.equal(doc.issues[ids.carried].state, 'open');
  assert.equal(doc.issues[ids.carried].source.key, `sc:${REPO}|sastCobol|fingerprint=${'b'.repeat(32)}`,
    'adopted onto the fingerprint by the ingest\'s own identity migration — same id, same history');
  assert.equal(doc.issues[ids.group].state, 'open');
  assert.deepEqual(doc.issues[ids.group].groupMembers,
    [`sc:${REPO}|sastCobol|fingerprint=${'c'.repeat(32)}`, `sc:${REPO}|sastCobol|fingerprint=${'d'.repeat(32)}`]);
  const fx = doc.issues[ids.fixture];
  assert.equal(fx.state, 'open', 'a record the successor does not re-observe is not fixed');
  assert.equal(fx.suspect, true);
  assert.ok(!s.created.some((id) => doc.issues[id]?.source.rule === 'cics-web-to-dynamic-sql'), 'and is not filed twice');
});

test('a record whose row disappears under a different flow model is carried, not closed', () => {
  const { store, ids } = fixture();
  assert.equal(run(store, ['--write']).status, 0);
  const doc = loadIssues({ path: store });
  const gen = '2026-09-26T01:00:00.000Z';
  ingestArea(doc, {
    areaSlug: REPO, now: gen,
    rollup: rollup(gen, 'slice-new-model', [{ rule: 'other-rule', file: 'src/O.cbl', fingerprint: 'f'.repeat(32), model: 'next-model' }]),
  });
  const c = doc.issues[ids.carried];
  assert.equal(c.state, 'open');
  assert.match(c.evidence.at(-1).detail, /filed under byte-range — not comparable/);
});

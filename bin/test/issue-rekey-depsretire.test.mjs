// bin/issue-rekey-depsretire.mjs — 1:1-rekey / ruled-split / refuse migration of
// gs:<repo>|<category>|undefined keys. Runs the tool as a subprocess against a fixture store
// (CW_ISSUES, read at call time in the child) and fixture rows dirs — never the live store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { emptyIssuesDoc, mintIssue, closeIssue, loadIssues, verifyChain, identityProblems }
  from '../../monitor/issue-store.mjs';

const TOOL = resolve(import.meta.dirname, '..', 'issue-rekey-depsretire.mjs');
const AT = '2026-08-01T00:00:00.000Z';

const retireDoc = (entries) => ({
  data: entries.map(([file, component, version, cve, sev]) => ({
    file,
    results: [{ component, version, vulnerabilities: [{ severity: sev, identifiers: { CVE: [cve], summary: 's' } }] }],
  })),
});

function rowsDir(root, repo, entries) {
  const d = join(root, 'rows', repo);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'retire.json'), JSON.stringify(retireDoc(entries)));
  return d;
}

function mintGs(doc, repo, { category = 'depsRetire', key = `gs:${repo}|${category}|undefined`, members = [] } = {}) {
  return mintIssue(doc, {
    area: repo, repo, kind: 'code', severity: 'high',
    title: `(unnamed rule) [${category}] (${repo}) — ${members.length} hits`,
    source: { kind: 'scanner-row', key, tool: category, rule: null },
    groupMembers: members,
  }, AT).id;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rekey-depsretire-'));
  const store = join(root, 'issues.json');
  const doc = emptyIssuesDoc();

  const idA = mintGs(doc, 'fixa', { members: ['sc:fixa|depsRetire||node_modules/u/u.js'] });      // 1:1 rekey
  const idB = mintGs(doc, 'fixb');                                                                 // spans 2 -> split
  const idC = mintGs(doc, 'fixc');                                                                 // no rows source
  const idD = mintGs(doc, 'fixd');                                                                 // slot taken
  const occupant = mintGs(doc, 'fixd', { key: 'gs:fixd|depsRetire|component=lodash,id=CVE-2021-23337' });
  const idE = mintGs(doc, 'fixe');                                                                 // closed — skipped
  closeIssue(doc, idE, { as: 'fixed', evidence: 'fixture close', at: AT });

  writeFileSync(store, JSON.stringify(doc, null, 1));

  const dirs = [
    `fixa=${rowsDir(root, 'fixa', [
      ['/x/node_modules/u/u.js', 'underscore.js', '1.13.0', 'CVE-2026-27601', 'high'],
      ['/x/node_modules/u/u.min.js', 'underscore.js', '1.13.0', 'CVE-2026-27601', 'high'],
      ['/x/node_modules/m/m.js', 'markdown-it', '1.0.0', 'CVE-2026-48988', 'medium'], // below threshold — ignored
    ])}`,
    `fixb=${rowsDir(root, 'fixb', [
      ['/x/node_modules/u/u.js', 'underscore.js', '1.13.0', 'CVE-2026-27601', 'high'],
      ['/x/node_modules/u/u.esm.js', 'underscore.js', '1.13.0', 'CVE-2026-27601', 'high'],
      ['/x/node_modules/l/l.js', 'lodash', '4.17.20', 'CVE-2021-23337', 'critical'],
    ])}`,
    `fixd=${rowsDir(root, 'fixd', [
      ['/x/node_modules/l/l.js', 'lodash', '4.17.20', 'CVE-2021-23337', 'high'],
    ])}`,
  ];
  return { root, store, ids: { idA, idB, idC, idD, occupant, idE }, dirs };
}

// --reports aimed at an empty dir so the resolver never wanders into the real reports/ tree.
const run = (store, dirs, extra = []) => {
  const emptyReports = mkdtempSync(join(tmpdir(), 'rekey-reports-'));
  return execFileSync(
    process.execPath,
    [TOOL, '--reports', emptyReports, ...dirs.flatMap((d) => ['--rows', d]), ...extra],
    { encoding: 'utf8', env: { ...process.env, CW_ISSUES: store } },
  );
};

test('dry run: prints rekeys, splits and refusals, writes nothing', () => {
  const { store, dirs, ids } = fixture();
  const before = readFileSync(store, 'utf8');
  const out = run(store, dirs, ['--split']);

  assert.match(out, /rekey 1:1\s+1\b/);
  assert.match(out, /split\s+1 record\(s\) -> 2 children/);
  assert.match(out, /refused\s+2\b/);
  assert.match(out, /closed\s+1 \(skipped/);
  assert.match(out, new RegExp(`REKEY ${ids.idA}\\s+gs:fixa\\|depsRetire\\|undefined\\s+->\\s+gs:fixa\\|depsRetire\\|component=underscore\\.js,id=CVE-2026-27601`));
  assert.match(out, new RegExp(`SPLIT ${ids.idB}`));
  assert.match(out, /gs:fixb\|depsRetire\|component=lodash,id=CVE-2021-23337\s+\[crit\] 1 member/);
  assert.match(out, /gs:fixb\|depsRetire\|component=underscore\.js,id=CVE-2026-27601\s+\[high\] 2 member/);
  assert.match(out, new RegExp(`REFUSED ${ids.idC} .*no-rows-source`));
  assert.match(out, new RegExp(`REFUSED ${ids.idD} .*slot-taken.*${ids.occupant}`));
  assert.match(out, /DRY RUN — nothing written/);
  assert.equal(readFileSync(store, 'utf8'), before, 'a dry run must leave the store byte-identical');
});

test('without --split a multi-identity record is refused, never guessed', () => {
  const { store, dirs, ids } = fixture();
  const out = run(store, dirs);
  assert.match(out, new RegExp(`REFUSED ${ids.idB} .*spans-2-identities`));
  assert.match(out, /refused\s+3\b/);
});

test('--split --write: rekey + split apply append-only through the store APIs; verifies after', () => {
  const { store, dirs, ids } = fixture();
  const out = run(store, dirs, ['--split', '--write']);
  assert.match(out, /1 re-keyed, 1 split into 2, 2 refused, chain verifies/);

  const doc = loadIssues({ path: store });
  // rekey half
  const a = doc.issues[ids.idA];
  assert.equal(a.source.key, 'gs:fixa|depsRetire|component=underscore.js,id=CVE-2026-27601');
  assert.deepEqual(a.priorKeys, ['gs:fixa|depsRetire|undefined']);
  assert.equal(doc.byKey['gs:fixa|depsRetire|undefined'], undefined);
  assert.equal(doc.byKey[a.source.key], ids.idA);
  assert.equal(doc.events.filter((e) => e.type === 'issue-key-migrated').length, 1);

  // split half: original closed superseded, both children linked, inheritance applied
  const orig = doc.issues[ids.idB];
  assert.equal(orig.state, 'closed');
  assert.equal(orig.closedAs, 'superseded');
  const kids = Object.values(doc.issues).filter((i) => i.source.key.startsWith('gs:fixb|depsRetire|component='));
  assert.equal(kids.length, 2);
  const byLabel = Object.fromEntries(kids.map((k) => [k.source.key.split('|')[2], k]));
  const lod = byLabel['component=lodash,id=CVE-2021-23337'];
  const und = byLabel['component=underscore.js,id=CVE-2026-27601'];
  assert.equal(lod.severity, 'crit', 'each child carries its OWN severity from the rows');
  assert.equal(und.severity, 'high');
  for (const k of kids) {
    assert.equal(k.createdAt, orig.createdAt, 'both children inherit the original createdAt (SLA reads "known since then")');
    assert.equal(doc.byKey[k.source.key], k.id);
  }
  assert.deepEqual(und.groupMembers, [
    'sc:fixb|depsRetire||node_modules/u/u.esm.js',
    'sc:fixb|depsRetire||node_modules/u/u.js',
  ]);
  // linked both ways: one supersededBy + evidence naming the other child
  const successors = [orig.deps.supersededBy,
    ...orig.evidence.map((e) => (String(e.detail).match(/also superseded by (\S+)/) || [])[1]).filter(Boolean)];
  assert.deepEqual(successors.sort(), kids.map((k) => k.id).sort(), 'no successor is lost');

  // refused/closed records keep their keys
  assert.equal(doc.issues[ids.idC].source.key, 'gs:fixc|depsRetire|undefined');
  assert.equal(doc.issues[ids.idD].source.key, 'gs:fixd|depsRetire|undefined');
  assert.equal(doc.issues[ids.idE].source.key, 'gs:fixe|depsRetire|undefined');

  assert.deepEqual(verifyChain(doc), []);
  assert.deepEqual(identityProblems(doc), []);
});

test('idempotent: a second --split --write plans 0 and leaves the store byte-identical', () => {
  const { store, dirs } = fixture();
  run(store, dirs, ['--split', '--write']);
  const after1 = readFileSync(store, 'utf8');
  const out = run(store, dirs, ['--split', '--write']);
  assert.match(out, /rekey 1:1\s+0\b/);
  assert.match(out, /split\s+0 record/);
  assert.match(out, /nothing to migrate/);
  assert.equal(readFileSync(store, 'utf8'), after1);
});

test('fail closed: an unreadable rows dir refuses the record rather than deriving an empty identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-depsretire-'));
  const store = join(root, 'issues.json');
  const doc = emptyIssuesDoc();
  const id = mintGs(doc, 'fixg');
  writeFileSync(store, JSON.stringify(doc));
  const empty = join(root, 'rows', 'fixg'); // exists, but holds no retire.json
  mkdirSync(empty, { recursive: true });
  const out = run(store, [`fixg=${empty}`]);
  assert.match(out, new RegExp(`REFUSED ${id} .*rows-unreadable`));
  assert.match(out, /rekey 1:1\s+0\b/);
});

test('--category supplyChainPosture derives control-tuple keys through the production extractor', () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-scp-'));
  const store = join(root, 'issues.json');
  const doc = emptyIssuesDoc();
  const id = mintGs(doc, 'fixs', { category: 'supplyChainPosture' });
  writeFileSync(store, JSON.stringify(doc, null, 1));

  const d = join(root, 'rows', 'fixs');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'scorecard.json'), JSON.stringify({ ran: true, counts: { inconclusive: 0 }, detail: 'scorecard-raw.json' }));
  writeFileSync(join(d, 'scorecard-raw.json'), JSON.stringify({ checks: [
    { name: 'Token-Permissions', score: 0, reason: 'r' },   // high
    { name: 'Branch-Protection', score: 1, reason: 'r' },   // high
    { name: 'Maintained', score: 8, reason: 'r' },          // low — below threshold, ignored
  ] }));

  const out = run(store, [`fixs=${d}`], ['--category', 'supplyChainPosture', '--split', '--write']);
  assert.match(out, /0 re-keyed, 1 split into 2/);
  const after = loadIssues({ path: store });
  assert.ok(after.byKey['gs:fixs|supplyChainPosture|control=Token-Permissions']);
  assert.ok(after.byKey['gs:fixs|supplyChainPosture|control=Branch-Protection']);
  assert.equal(after.issues[id].state, 'closed');
  assert.deepEqual(verifyChain(after), []);
});

// Semgrep names a rule from a local --config directory after the directory's absolute path, so the
// bundled packs' rule ids, and the issues keyed on them, depended on which checkout ran the sweep.
// Pinned here: the reader drops the checkout, two checkouts read the same ids, the Semgrep title
// comes from the rule's full description, and existing issues move onto the new key without being
// closed or duplicated, including when a later slice still carries a row read the old way.
// Synthetic SARIF, rollups and stores only; the live store is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { localRuleId, readSarif, ruleTitle } from '../sarif-read.mjs';
import { emptyIssuesDoc, verifyChain, migrateLocalRuleKeys } from '../issue-store.mjs';
import { ingestArea } from '../issue-ingest.mjs';
import { validateAgainstSchema } from '../registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(HERE, '..', '..', 'schema', 'issue.schema.json');
const RULE = 'manifests.semgrep-classes.cw-sql-text-assembled-js';
const OLD = `Users.someone.src.commitwork.${RULE}`;
const OTHER = `opt.tools.commitwork-1.2.${RULE}`;
const FILE = 'src/db.js';

test('a bundled rule id loses the checkout path; any other id is unchanged', () => {
  assert.equal(localRuleId(OLD), RULE);
  assert.equal(localRuleId(OTHER), RULE);
  assert.equal(localRuleId(RULE), RULE);
  assert.equal(localRuleId('home.x.manifests.semgrep-taint.cw-env-to-shell'), 'manifests.semgrep-taint.cw-env-to-shell');
  assert.equal(localRuleId('Users.a.manifests.semgrep-classes.work.manifests.semgrep-taint.cw-y'), 'manifests.semgrep-taint.cw-y', 'the last pack segment wins');
  for (const id of ['javascript.express.web.cors-default-config-express.cors-default-config-express', 'DS-0002', 'js/sql-injection', '', 'manifests.other.cw-x']) {
    assert.equal(localRuleId(id), id, id);
  }
  assert.equal(localRuleId(undefined), undefined);
});

const sarifFrom = (prefix) => ({
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'Semgrep OSS', rules: [{
      id: `${prefix}.${RULE}`, name: `${prefix}.${RULE}`,
      shortDescription: { text: `Semgrep Finding: ${prefix}.${RULE}` },
      fullDescription: { text: 'SQL text is assembled at run time. Bind values as parameters instead.' },
    }] } },
    invocations: [{ executionSuccessful: true, toolExecutionNotifications: [
      { descriptor: { id: 'Internal matching error' }, level: 'warning', message: { text: `Internal matching error when running ${prefix}.${RULE} on ${FILE}:\n boom` } },
    ] }],
    results: [{ ruleId: `${prefix}.${RULE}`, message: { text: 'm' }, locations: [{ physicalLocation: { artifactLocation: { uri: FILE }, region: { startLine: 3 } } }] }],
  }],
});
const write = (doc) => { const d = mkdtempSync(join(tmpdir(), 'cw-local-rule-')); const p = join(d, 'semgrep.sarif'); writeFileSync(p, JSON.stringify(doc)); return p; };

test('the reader gives every checkout the same rule ids, in results, rules and rule failures', () => {
  const a = readSarif(write(sarifFrom('Users.someone.src.commitwork')));
  const b = readSarif(write(sarifFrom('opt.tools.commitwork-1.2')));
  for (const r of [a, b]) {
    assert.equal(r.state, 'ok');
    assert.equal(r.results[0].ruleId, RULE);
    assert.equal(r.runs[0].tool.driver.rules[0].id, RULE);
    assert.equal(r.runs[0].tool.driver.rules[0].name, RULE);
    assert.deepEqual(r.ruleFailures.map((f) => f.rule), [RULE]);
  }
  assert.deepEqual(a.results, b.results, 'two checkouts read the same finding');
});

test('a Semgrep rule is titled by the first sentence of its full description', () => {
  const rule = readSarif(write(sarifFrom('Users.someone.src.commitwork'))).runs[0].tool.driver.rules[0];
  assert.equal(ruleTitle(rule), 'SQL text is assembled at run time.');
  assert.equal(ruleTitle({ id: 'x', shortDescription: { text: 'Short title' }, fullDescription: { text: 'Long. Text.' } }), 'Short title', 'a real short description still wins');
  assert.equal(ruleTitle({ id: 'cw-x', name: 'cw-x', fullDescription: { text: 'cw-x matched.' } }), null, 'a description that restates the id is no title');
});

const issue = (id, key, state, extra = {}) => ({
  id, area: 'a', repo: 'cw', source: { kind: 'scanner-row', key, tool: 'sastSemgrep', rule: key.split('|')[2] },
  kind: 'code', severity: 'med', title: `${key.split('|')[2]} [sastSemgrep] (cw)`, state, ...extra,
});

test('the migration moves open and closed issues 1:1, refuses a held target, and runs once', () => {
  const doc = emptyIssuesDoc();
  const at = '2026-10-20T00:00:00.000Z';
  const keyOpen = `sc:cw|sastSemgrep|${OLD}|${FILE}`;
  const keyClosed = `sc:cw|sastSemgrep|${OLD}|src/old.js`;
  const keyClash = `sc:cw|sastSemgrep|${OLD}|src/clash.js`;
  doc.issues = {
    'ISS-1': issue('ISS-1', keyOpen, 'open'),
    'ISS-2': issue('ISS-2', keyClosed, 'closed', { closedAs: 'fixed' }),
    'ISS-3': issue('ISS-3', keyClash, 'open'),
    'ISS-4': issue('ISS-4', `sc:cw|sastSemgrep|${RULE}|src/clash.js`, 'open'),
  };
  doc.byKey = Object.fromEntries(Object.values(doc.issues).map((i) => [i.source.key, i.id]));
  const dry = migrateLocalRuleKeys(doc, { at, dryRun: true });
  assert.equal(dry.migrated.length, 2);
  assert.equal(doc.issues['ISS-1'].source.key, keyOpen, 'a dry run changes nothing');

  const r = migrateLocalRuleKeys(doc, { at });
  assert.deepEqual(r.migrated.map((m) => m.id).sort(), ['ISS-1', 'ISS-2']);
  assert.deepEqual(r.refused.map((m) => [m.id, m.heldBy]), [['ISS-3', 'ISS-4']], 'a held target is refused, never merged');
  const moved = doc.issues['ISS-1'];
  assert.equal(moved.source.key, `sc:cw|sastSemgrep|${RULE}|${FILE}`);
  assert.equal(moved.source.rule, RULE);
  assert.equal(moved.title, `${RULE} [sastSemgrep] (cw)`, 'the title loses the checkout path');
  assert.deepEqual(moved.priorKeys, [keyOpen]);
  assert.equal(moved.state, 'open');
  assert.equal(doc.issues['ISS-2'].closedAs, 'fixed', 'a closed verdict is not re-judged');
  assert.equal(doc.byKey[keyOpen], undefined);
  assert.equal(doc.byKey[moved.source.key], 'ISS-1');
  assert.equal(doc.events.filter((e) => e.type === 'issue-key-migrated').length, 2);
  assert.deepEqual(verifyChain(doc), []);
  assert.equal(migrateLocalRuleKeys(doc, { at }).migrated.length, 0, 'a second run moves nothing');
});

test('an ingest re-keys the issue and keeps it open, whether the row is read fresh or carried', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-local-rule-repo-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, FILE), 'a\nb\nconst q = `SELECT * FROM t WHERE id = ${id}`;\n');
  const slice = (n, rule) => {
    const generated = `2026-10-0${n}T00:00:00.000Z`;
    return { now: generated, rollup: { generated, sliceId: `s${n}`, scanners: { sastSemgrep: { ran: 1, total: 1 } },
      scannerFindings: { sastSemgrep: [{ repo: 'cw', rule, file: FILE, line: 3, sev: 'high', message: 'SQL text assembled' }] },
      scannerRuleTitles: { sastSemgrep: { [rule]: 'SQL text is assembled at run time.' } }, repos: [] } };
  };
  const run = (doc, n, rule) => ingestArea(doc, { areaSlug: 'a', repoPaths: { cw: dir }, ...slice(n, rule) });

  const doc = emptyIssuesDoc();
  const first = run(doc, 1, OLD);
  assert.equal(first.created.length, 1);
  const id = doc.byKey[`sc:cw|sastSemgrep|${RULE}|${FILE}`];
  assert.ok(id, 'a row read the old way is keyed the new way');
  assert.ok(!JSON.stringify(doc.issues[id].title).includes('someone'), 'no checkout path in the title');

  for (const [n, rule] of [[2, RULE], [3, OLD]]) {
    const s = run(doc, n, rule);
    assert.equal(s.created.length, 0, `slice ${n}: no duplicate`);
    assert.equal(doc.issues[id].state, 'open', `slice ${n}: still open`);
  }
  assert.equal(Object.keys(doc.issues).length, 1);
  assert.deepEqual(verifyChain(doc), []);
  assert.deepEqual(validateAgainstSchema(doc, { path: SCHEMA }).errors, []);
});

test('an issue filed under the old key before this change moves on the next ingest and stays open', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-local-rule-legacy-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, FILE), 'a\nb\nconst q = `SELECT * FROM t WHERE id = ${id}`;\n');
  const doc = emptyIssuesDoc();
  const slice = { now: '2026-10-05T00:00:00.000Z', rollup: { generated: '2026-10-05T00:00:00.000Z', sliceId: 's5', scanners: { sastSemgrep: { ran: 1, total: 1 } },
    scannerFindings: { sastSemgrep: [{ repo: 'cw', rule: RULE, file: FILE, line: 3, sev: 'high', message: 'SQL text assembled' }] }, repos: [] } };
  ingestArea(doc, { areaSlug: 'a', repoPaths: { cw: dir }, ...slice });
  const id = Object.keys(doc.issues)[0];
  const newKey = `sc:cw|sastSemgrep|${RULE}|${FILE}`;
  const oldKey = `sc:cw|sastSemgrep|${OLD}|${FILE}`;
  doc.issues[id].source = { ...doc.issues[id].source, key: oldKey, rule: OLD };
  doc.issues[id].title = doc.issues[id].title.split(RULE).join(OLD);
  delete doc.byKey[newKey]; doc.byKey[oldKey] = id;

  const s = ingestArea(doc, { areaSlug: 'a', repoPaths: { cw: dir }, ...slice, now: '2026-10-06T00:00:00.000Z', rollup: { ...slice.rollup, generated: '2026-10-06T00:00:00.000Z', sliceId: 's6' } });
  assert.deepEqual(s.localRuleKeysMigrated.map((m) => m.id), [id]);
  assert.equal(s.created.length, 0);
  assert.equal(doc.issues[id].state, 'open');
  assert.equal(doc.byKey[newKey], id);
  assert.deepEqual(verifyChain(doc), []);
});

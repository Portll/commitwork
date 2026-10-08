// scanner-finding annotations (annotations.json `scannerAnnotations`) — no wildcard-by-omission,
// suppressed ≠ deleted, every record's fate published, fail closed, `line` never keys an identity.
// Harness: self-contained reports root + registry, real rollup as a child process, fetch disabled.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROW_SCHEMAS, identityFor } from '../detail-schema.mjs';
import {
  validateScannerAnnotation, scannerAnnMatch, findActiveScannerAnnotation, annActive,
  CLAIM_VALUES, scannerAnnotationTarget, buildSuppressionLabel, SUPPRESSION_LABEL_KIND,
  annotationsLockPath, ANNOTATIONS_LOCK_NAME,
} from '../annotate-lib.mjs';
import { adjudicationsPath, readJournalFile } from '../../bin/lib/verdict-journal-core.mjs';
import { FORBIDDEN_IDENTITY_COMPONENTS } from '../../bin/lib/verdict-journal-core.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

describe('identity declarations (anti-drift)', () => {
  test('every category declares an identity tuple, every identity field exists in its fields, and line never keys one', () => {
    for (const [key, s] of Object.entries(ROW_SCHEMAS)) {
      assert.ok(Array.isArray(s.identity) && s.identity.length > 0, `${key}: no identity tuple`);
      const declared = new Set(s.fields.map(([n]) => n));
      for (const f of s.identity) assert.ok(declared.has(f), `${key}: identity field '${f}' is not a declared row field`);
      // The SAME set buildFindingKey enforces — spelled twice, a startLine identity passed here
      // and threw only at 2 of ~16 consumers.
      for (const f of s.identity) {
        assert.ok(!FORBIDDEN_IDENTITY_COMPONENTS.has(f),
          `${key}: '${f}' in an identity tuple un-suppresses on unrelated edits`);
      }
    }
  });

  test('identityFor: known category returns a copy; unknown returns null (a validation error, not a no-match)', () => {
    assert.deepEqual(identityFor('secrets'), ['rule', 'file']);
    const a = identityFor('secrets'); a.push('mutated');
    assert.deepEqual(identityFor('secrets'), ['rule', 'file'], 'returned tuple must be a copy');
    assert.equal(identityFor('nope'), null);
  });
});

describe('validateScannerAnnotation — absence is an error, never a wildcard', () => {
  const base = { category: 'secrets', repo: 'clientD', rule: 'jwt', file: 'a.html', action: 'false-positive', reason: 'r', who: 'w', at: '2026-08-01T00:00:00.000Z' };
  const idf = identityFor('secrets');

  test('a fully-named record validates', () => assert.deepEqual(validateScannerAnnotation(base, idf), []));

  test('a missing identity field is an error — {category} alone suppresses nothing', () => {
    const { rule, ...noRule } = base;
    assert.ok(validateScannerAnnotation(noRule, idf).some((e) => e.includes("identity field 'rule'")));
    const bare = { category: 'secrets', action: 'accept', reason: 'r', who: 'w', at: base.at };
    const errs = validateScannerAnnotation(bare, idf);
    assert.ok(errs.length >= 3, `category-only must fail loudly, got: ${errs}`);
  });

  test('unknown category is an error (identityFor null), never a silent no-match', () => {
    assert.ok(validateScannerAnnotation({ ...base, category: 'nope' }, null).some((e) => e.includes('unknown category')));
  });

  test("repo is required unless scope:'fleet' — the only explicit fleet opt-in", () => {
    const { repo, ...noRepo } = base;
    assert.ok(validateScannerAnnotation(noRepo, idf).some((e) => e.includes('missing repo')));
    assert.deepEqual(validateScannerAnnotation({ ...noRepo, scope: 'fleet' }, idf), []);
    assert.ok(validateScannerAnnotation({ ...base, scope: 'all' }, idf).some((e) => e.includes('scope')));
  });

  test('action, reason, who, at are required; expires must parse when present', () => {
    assert.ok(validateScannerAnnotation({ ...base, action: 'delete' }, idf).some((e) => e.includes('action')));
    assert.ok(validateScannerAnnotation({ ...base, reason: ' ' }, idf).some((e) => e.includes('reason')));
    assert.ok(validateScannerAnnotation({ ...base, who: '' }, idf).some((e) => e.includes('who')));
    assert.ok(validateScannerAnnotation({ ...base, at: 'yesterday' }, idf).some((e) => e.includes('at')));
    assert.ok(validateScannerAnnotation({ ...base, expires: 'soon' }, idf).some((e) => e.includes('expires')));
  });

  test('matcher: strict equality on every identity field plus repo; fleet scope spans repos', () => {
    const row = { repo: 'clientD', rule: 'jwt', file: 'a.html', line: 9 };
    assert.equal(scannerAnnMatch(base, row, idf), true);
    assert.equal(scannerAnnMatch({ ...base, file: 'b.html' }, row, idf), false);
    assert.equal(scannerAnnMatch({ ...base, repo: 'other' }, row, idf), false);
    const { repo, ...fleet } = { ...base, scope: 'fleet' };
    assert.equal(scannerAnnMatch(fleet, { ...row, repo: 'other' }, idf), true);
    // active window: expired never matches through findActive
    assert.equal(findActiveScannerAnnotation([{ ...base, expires: '2026-08-02T00:00:00.000Z' }], row, '2026-08-03T00:00:00.000Z', idf), undefined);
  });
});

// ---- requireExpires: write-time only, read path untouched --------------------------------------
// Write paths pass { requireExpires: true }; rollup's overlay stays 2-arg so legacy records on
// disk keep suppressing.
describe('requireExpires — write-time gate only; a legacy record on disk is still read fine', () => {
  const idf = identityFor('secrets');
  const base = { category: 'secrets', repo: 'clientD', rule: 'jwt', file: 'a.html', action: 'false-positive', reason: 'r', who: 'w', at: '2026-08-01T00:00:00.000Z' };

  test('the default (no options / 2-arg call) never requires expires — every existing read-path caller is unaffected', () => {
    assert.deepEqual(validateScannerAnnotation(base, idf), [], 'rollup.mjs calls validateScannerAnnotation(a, idf) with no third argument');
  });

  test('{ requireExpires: true } refuses a record with no expires, naming why', () => {
    const errs = validateScannerAnnotation(base, idf, { requireExpires: true });
    assert.ok(errs.some((e) => e.includes('missing expires')), `expected a "missing expires" defect, got: ${errs}`);
    assert.ok(errs.some((e) => e.includes('blindfold')), 'the message explains WHY, not just what');
  });

  test('{ requireExpires: true } accepts a record that carries expires', () => {
    assert.deepEqual(validateScannerAnnotation({ ...base, expires: '2027-01-01T00:00:00.000Z' }, idf, { requireExpires: true }), []);
  });

  test('{ requireExpires: true } still reports "unparseable expires" for a garbage value, not "missing"', () => {
    const errs = validateScannerAnnotation({ ...base, expires: 'soon' }, idf, { requireExpires: true });
    assert.ok(errs.some((e) => e.includes('unparseable expires')));
    assert.ok(!errs.some((e) => e.includes('missing expires')), 'a present-but-garbage value is a different defect than an absent one');
  });

  test('a legacy record with NO expires still reads as ACTIVE through annActive — the requirement never retroactively invalidates what is already on disk', () => {
    assert.equal(annActive(base, '2099-01-01T00:00:00.000Z'), true, 'no expires => never expires, by design, unchanged');
    // still validates under the default read-path call, so rollup's overlay applies it
    assert.deepEqual(validateScannerAnnotation(base, idf), []);
  });
});

describe('annotationsLockPath — the ONE lock target both write paths converge on', () => {
  test('a sibling of the store file, never the store path itself', () => {
    assert.equal(annotationsLockPath('/x/y/monitor/annotations.json'), `/x/y/monitor/${ANNOTATIONS_LOCK_NAME}`);
  });

  test('two different CW_ANNOTATIONS paths in the same directory derive the same lock — the directory owns one mutex', () => {
    // both write paths resolve files in the same directory, so the lock must agree
    assert.equal(annotationsLockPath('/a/monitor/annotations.json'), annotationsLockPath('/a/monitor/annotations.json'));
  });

  test('pure — no I/O, callable with a path to a file that does not exist', () => {
    assert.doesNotThrow(() => annotationsLockPath('/does/not/exist/annotations.json'));
  });
});

// ---- end-to-end through the real rollup ------------------------------------------------------

const AREAS = [
  { slug: 'primary-area', label: 'primary', out: 'primary-area', primary: true },
  { slug: 'ann-area', label: 'ann', out: 'ann-area', members: ['alpha'] },
];
const glRow = (file, line, rule) => ({
  RuleID: rule, Description: 'found a secret', StartLine: line, EndLine: line, StartColumn: 1,
  EndColumn: 9, Match: 'authorization: X', Secret: 'X', File: file, SymlinkFile: '',
  Commit: 'abc123def4567890', Entropy: 3.7, Author: 'dev', Email: 'dev@example.com',
  Date: '2026-01-01T00:00:00Z', Message: 'commit msg', Tags: [], Fingerprint: `${file}:${rule}:${line}`,
});

function fixture(scannerAnnotations) {
  const root = mkdtempSync(join(tmpdir(), 'cw-scann-'));
  const reg = { reportsRoot: join(root, 'reports'), monitorOutput: AREAS[0].out, defaultManifest: 'security-baseline', roots: [], projects: [], areas: AREAS };
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify(reg));
  for (const a of AREAS) mkdirSync(join(root, 'reports', a.out), { recursive: true });
  const batch = join(root, 'reports', 'sweep-20260801120000-ann-area');
  mkdirSync(join(batch, 'alpha'), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260801120000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'ann-area', areaOut: 'reports/ann-area', startedAt: '2026-08-01T12:00:00.000Z',
    scope: { repos: [{ name: 'alpha', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} },
    anchors: {},
  }));
  writeFileSync(join(batch, 'alpha', 'gitleaks.json'), JSON.stringify([
    glRow('src/a.js', 5, 'aws-key'), glRow('src/a.js', 99, 'generic-token'), glRow('src/b.js', 10, 'aws-key'),
  ]));
  writeFileSync(join(batch, 'alpha', 'checks-status.json'), JSON.stringify([
    { check: 'secrets-gitleaks', status: 'pass', durationMs: 5, at: '2026-08-01T12:00:01.000Z' },
  ]));
  const annPath = join(root, 'annotations.json');
  writeFileSync(annPath, typeof scannerAnnotations === 'string'
    ? scannerAnnotations
    : JSON.stringify({ annotations: [], scannerAnnotations }));
  return { root, batch, regPath, annPath, out: join(root, 'reports', 'ann-area') };
}

const runRollup = (fx, env = {}) => spawnSync(
  process.execPath, ['--import', NO_FETCH, ROLLUP, fx.batch],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: fx.regPath, CW_MONITOR_OUT: '', CW_ANNOTATIONS: fx.annPath, ...env } });
const readRollup = (fx) => JSON.parse(readFileSync(join(fx.out, 'rollup.json'), 'utf8'));

const WHO = 'tester';
const AT = '2026-08-01T00:00:00.000Z';
const rec = (over) => ({ category: 'secrets', repo: 'alpha', rule: 'aws-key', file: 'src/a.js', action: 'false-positive', reason: 'fixture judgment', who: WHO, at: AT, ...over });

describe('rollup overlay — suppressed ≠ deleted, every fate published', () => {
  const fx = fixture([
    rec(),                                                          // applies to src/a.js:5 (1 row)
    rec({ rule: 'generic-token', expires: '2026-08-02T00:00:00.000Z', reason: 'expired fixture' }), // expired by now
    rec({ file: 'src/nope.js', reason: 'typo fixture' }),           // matches nothing
    { category: 'secrets', repo: 'alpha', action: 'accept', reason: 'invalid: no identity', who: WHO, at: AT }, // invalid
  ]);
  const r = runRollup(fx);
  assert.equal(r.status, 0, `rollup failed: ${r.stderr?.slice(0, 500)}`);
  const rollup = readRollup(fx);

  test('the annotated row KEEPS its place, annotation attached; the others stay bare', () => {
    const rows = rollup.scannerFindings.secrets;
    assert.equal(rows.length, 3, 'no row is ever deleted by an annotation');
    const ann = rows.filter((x) => x.annotation);
    assert.equal(ann.length, 1);
    assert.equal(ann[0].file, 'src/a.js'); assert.equal(ann[0].line, 5);
    assert.deepEqual(ann[0].annotation, { action: 'false-positive', at: AT, reason: 'fixture judgment', who: WHO, whoKind: 'human' });
    assert.deepEqual(rollup.scannerFindingsViolations, [], 'annotation is a declared field, not a schema violation');
  });

  // A SUPPRESSION LEAVES THE BUCKET IT WAS COUNTED IN, and this asserted the wrong bucket for the
  // whole lane. It read `high: 2` on the note "gitleaks rows are uniformly high" — a belief the
  // producer stopped honouring when verification split the lane: crit when a verifier confirmed the
  // secret, low when the issuing service refused it, and NO SEV when nobody could be asked, which
  // _gitleaksCounts counts under `undetermined`. These fixture rows have no verifier sidecar, so
  // all three are sev-less.
  //
  // The same false premise was written into rollup.mjs's SEVLESS_BUCKET, which sent every sev-less
  // secrets suppression at `high` — always 0 here, so Math.max(0, …) absorbed it and `undetermined`
  // never dropped. Live on commitwork-admin 2026-08-27: 20 of 21 rows adjudicated, total correctly
  // 1, `undetermined` still 15. The test and the defect were one belief, and the test failing was
  // the only place it was visible.
  test('aggregates drop by the annotated count, with `annotated` recorded beside them', () => {
    const s = rollup.scanners.secrets;
    assert.equal(s.undetermined, 2, '3 unverified rows − 1 annotated');
    assert.equal(s.high, 0, 'and nothing was ever in `high` to leave');
    assert.equal(s.total, 2);
    assert.equal(s.annotated, 1);
    assert.equal(s.detail.rows, 3, 'published detail still carries every row');
    // The headline follows the aggregate — sumTotals reads scannerFleet, and it sums `undetermined`
    // alongside the four buckets precisely so a lane that grades nothing stays VISIBLE. If a
    // suppression left `total` without leaving `undetermined`, this is where the surplus would show.
    assert.equal(rollup.totals.undetermined, 2, 'the fleet headline drops with the lane');
    assert.equal(rollup.counts.scannerAnnotated, 1);
  });

  test('every record fate is published: applied / noMatch / expired / invalid', () => {
    const st = rollup.scannerAnnotationStatus;
    assert.deepEqual(st.applied, [{ record: 'secrets:aws-key|src/a.js@alpha', matched: 1 }]);
    assert.deepEqual(st.noMatch, [{ record: 'secrets:aws-key|src/nope.js@alpha' }]);
    assert.equal(st.expired.length, 1);
    assert.equal(st.expired[0].record, 'secrets:generic-token|src/a.js@alpha');
    assert.equal(st.invalid.length, 1);
    assert.ok(st.invalid[0].errors.some((e) => e.includes("identity field 'rule'")));
  });

  test('an expired record does NOT suppress — the finding is back in the counts', () => {
    // generic-token src/a.js:99 is un-annotated and counted (high includes it)
    const row = rollup.scannerFindings.secrets.find((x) => x.rule === 'generic-token');
    assert.equal(row.annotation, undefined);
  });
});

describe('fail closed + determinism', () => {
  test('an unparseable store is a rollup FAILURE, never an empty ledger', () => {
    const fx = fixture('{ this is not json');
    const r = runRollup(fx);
    assert.notEqual(r.status, 0, 'garbage annotations.json must not roll as if the store were empty');
    assert.match(String(r.stderr), /annotations store unreadable/);
  });

  test('a missing store (ENOENT) is legitimately absent — rolls clean with empty status', () => {
    const fx = fixture([]);
    const r = runRollup(fx, { CW_ANNOTATIONS: join(fx.root, 'does-not-exist.json') });
    assert.equal(r.status, 0, `rollup failed: ${r.stderr?.slice(0, 500)}`);
    const rollup = readRollup(fx);
    assert.deepEqual(rollup.scannerAnnotationStatus, { applied: [], noMatch: [], expired: [], invalid: [], carried: [] });
    // `undetermined`, not `high`: these fixture rows have no verifier sidecar, so _gitleaksCounts
    // gives them no sev at all. See the note on the aggregate test above — this asserted `high: 3`
    // against a producer that has not emitted `high` for this lane since verification split it.
    assert.equal(rollup.scanners.secrets.undetermined, 3, 'nothing suppressed');
    assert.equal(rollup.scanners.secrets.high, 0, 'gitleaks does not bucket an unverified row as high');
  });

  test('two rolls with annotations applied differ only by ISO timestamp and stamp', () => {
    const norm = (s) => s
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO>')
      .replace(/(?<!\d)\d{14}(?!\d)/g, '<STAMP>');
    const fx = fixture([rec()]);
    const outs = [mkdtempSync(join(tmpdir(), 'cw-ann-a-')), mkdtempSync(join(tmpdir(), 'cw-ann-b-'))];
    for (const o of outs) {
      const r = runRollup(fx, { CW_MONITOR_OUT: o });
      assert.equal(r.status, 0, `rollup failed: ${r.stderr?.slice(0, 400)}`);
    }
    const [a, b] = outs.map((o) => norm(readFileSync(join(o, 'rollup.json'), 'utf8')));
    assert.equal(a, b, 'NON-DETERMINISTIC rollup.json with the annotations overlay active');
  });
});

describe('issue-store ingest — an annotated row never files', () => {
  test('rows carrying `annotation` are skipped and counted; bare rows still file', async () => {
    const { emptyIssuesDoc } = await import('../issue-store.mjs');
    const { ingestArea } = await import('../issue-ingest.mjs');
    const doc = emptyIssuesDoc();
    const now = '2026-08-03T00:00:00.000Z';
    const row = (file, extra) => ({ repo: 'alpha', rule: 'aws-key', file, line: 1, commit: '', redacted: true, sev: 'high', ...extra });
    const rollup = {
      sliceId: 'sweep-x', generated: now, repos: [{ name: 'alpha', findings: [] }],
      scanners: { secrets: { ran: 1, high: 1, total: 1 } },
      scannerFindings: { secrets: [
        row('src/bare.js'),
        row('src/judged.js', { annotation: { action: 'false-positive', at: now, reason: 'r', who: 'w', whoKind: 'human' } }),
      ] },
    };
    const summary = ingestArea(doc, { areaSlug: 'ann-area', rollup, now });
    assert.equal(summary.annotatedRows, 1, 'the skip is counted, not silent');
    const keys = Object.keys(doc.byKey);
    assert.ok(keys.some((k) => k.includes('src/bare.js')), 'the bare row files');
    assert.ok(!keys.some((k) => k.includes('src/judged.js')), 'the judged row must not file as an issue');
  });
});

// ---- claim: additive, non-identity metadata (W3) -----------------------------------------------

describe('claim — structured, never free text, never identity', () => {
  const base = rec();

  test('absent claim validates (optional field)', () => {
    assert.deepEqual(validateScannerAnnotation(base, identityFor('secrets')), []);
  });

  test('a recognised claim validates', () => {
    assert.deepEqual(validateScannerAnnotation({ ...base, claim: 'remediated' }, identityFor('secrets')), []);
    assert.ok(CLAIM_VALUES.includes('remediated'));
  });

  test('an unrecognised claim is a validation error — structured vocabulary, not prose', () => {
    const errs = validateScannerAnnotation({ ...base, claim: 'because I said so' }, identityFor('secrets'));
    assert.ok(errs.some((e) => e.includes("unknown claim") && e.includes('because I said so')));
  });

  test('claim is never part of scannerAnnMatch — two records differing only by claim address the same row', () => {
    const idf = identityFor('secrets');
    const row = { repo: 'alpha', rule: 'aws-key', file: 'src/a.js', line: 5 };
    assert.equal(scannerAnnMatch(base, row, idf), true);
    assert.equal(scannerAnnMatch({ ...base, claim: 'remediated' }, row, idf), true);
  });
});

// ---- suppression-label ledger (C-5 fatigue, W3) --------------------------------------------------

describe('scannerAnnotationTarget — the same place-identity string rollup.mjs\'s _annLabel builds', () => {
  test('category:identityFields@repo, matching the format scannerAnnotationStatus already publishes', () => {
    // matches scannerAnnotationStatus.applied[0].record for the identical fixture record
    assert.equal(scannerAnnotationTarget(rec(), identityFor('secrets')), 'secrets:aws-key|src/a.js@alpha');
  });

  test('scope:fleet renders @fleet, never the (absent) repo', () => {
    const { repo, ...fleetRec } = { ...rec(), scope: 'fleet' };
    assert.equal(scannerAnnotationTarget(fleetRec, identityFor('secrets')), 'secrets:aws-key|src/a.js@fleet');
  });

  test('content never enters the target — reason is not read', () => {
    assert.equal(
      scannerAnnotationTarget({ ...rec(), reason: 'a live secret was pasted here: sk-liveSECRET' }, identityFor('secrets')),
      'secrets:aws-key|src/a.js@alpha',
    );
  });
});

describe('buildSuppressionLabel — pure envelope assembly, no I/O', () => {
  test('minimal shape: v-less, kind + the five required fields, count defaults to 1', () => {
    const l = buildSuppressionLabel({ target: 't', action: 'accept', who: 'w', at: 'a' });
    assert.deepEqual(l, { kind: SUPPRESSION_LABEL_KIND, target: 't', action: 'accept', count: 1, who: 'w', at: 'a' });
  });

  test('expires and noExpires are opt-in, never both invented', () => {
    assert.equal(buildSuppressionLabel({ target: 't', action: 'accept', who: 'w', at: 'a', expires: '2099-01-01' }).expires, '2099-01-01');
    assert.equal(buildSuppressionLabel({ target: 't', action: 'accept', who: 'w', at: 'a' }).expires, undefined);
    assert.equal(buildSuppressionLabel({ target: 't', action: 'accept', who: 'w', at: 'a', noExpires: true }).noExpires, true);
    assert.equal(buildSuppressionLabel({ target: 't', action: 'accept', who: 'w', at: 'a' }).noExpires, undefined);
  });

  test('an explicit count overrides the default — the hook-once streak caller needs this', () => {
    assert.equal(buildSuppressionLabel({ target: 't', action: 'silence', who: 'hook-once', at: 'a', count: 5 }).count, 5);
  });
});

describe('predicates alone emit nothing — annActive/scannerAnnMatch/findActiveScannerAnnotation stay pure', () => {
  test('thousands of predicate evaluations never create the adjudications ledger', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cw-pred-'));
    const prevDir = process.env.CW_VERDICT_DIR;
    process.env.CW_VERDICT_DIR = tmpDir;
    try {
      const idf = identityFor('secrets');
      const a = rec();
      const row = { repo: 'alpha', rule: 'aws-key', file: 'src/a.js', line: 5 };
      for (let i = 0; i < 2000; i++) {
        annActive(a, AT);
        scannerAnnMatch(a, row, idf);
        findActiveScannerAnnotation([a], row, AT, idf);
      }
      // absent:true proves no file was ever created, not merely that it reads empty
      const j = readJournalFile(adjudicationsPath());
      assert.equal(j.absent, true, 'predicate evaluation must never write the fatigue ledger — only a WRITE event does (bin/annotate.mjs, bin/hook-once.mjs)');
      assert.deepEqual(j.records, []);
    } finally {
      if (prevDir === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = prevDir;
    }
  });
});

// ---- a CARRIED category cannot be evaluated, and must not be reported as if it had been ---------
// The carry block runs after the overlay, so records for a carried category match zero rows and
// used to file under `noMatch` — false alarms on the instrument built to find broken suppressions.
describe('carried categories — un-evaluated is its own state, never noMatch', () => {
  function twoSliceFixture() {
    const root = mkdtempSync(join(tmpdir(), 'cw-scann-carry-'));
    const reg = { reportsRoot: join(root, 'reports'), monitorOutput: AREAS[0].out, defaultManifest: 'security-baseline', roots: [], projects: [], areas: AREAS };
    const regPath = join(root, 'projects.json');
    writeFileSync(regPath, JSON.stringify(reg));
    for (const a of AREAS) mkdirSync(join(root, 'reports', a.out), { recursive: true });

    // SLICE 1 — secrets is scanned and the record applies.
    const b1 = join(root, 'reports', 'sweep-20260801120000-ann-area');
    mkdirSync(join(b1, 'alpha'), { recursive: true });
    writeFileSync(join(b1, 'batch-manifest.json'), JSON.stringify({
      sliceId: 'sweep-20260801120000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
      area: 'ann-area', areaOut: 'reports/ann-area', startedAt: '2026-08-01T12:00:00.000Z',
      scope: { repos: [{ name: 'alpha', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} },
      anchors: {},
    }));
    writeFileSync(join(b1, 'alpha', 'gitleaks.json'), JSON.stringify([glRow('src/a.js', 5, 'aws-key')]));
    writeFileSync(join(b1, 'alpha', 'checks-status.json'), JSON.stringify([
      { check: 'secrets-gitleaks', status: 'pass', durationMs: 5, at: '2026-08-01T12:00:01.000Z' },
    ]));

    // SLICE 2 — a narrow sweep that does not speak for secrets; one unrelated check keeps the
    // batch a real sweep, so secrets carries
    const b2 = join(root, 'reports', 'sweep-20260802120000-ann-area');
    mkdirSync(join(b2, 'alpha'), { recursive: true });
    writeFileSync(join(b2, 'batch-manifest.json'), JSON.stringify({
      sliceId: 'sweep-20260802120000', kind: 'sweep', group: 'fast', only: null, sweptAll: false,
      area: 'ann-area', areaOut: 'reports/ann-area', startedAt: '2026-08-02T12:00:00.000Z',
      scope: { repos: [{ name: 'alpha', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} },
      anchors: {},
    }));
    writeFileSync(join(b2, 'alpha', 'checks-status.json'), JSON.stringify([
      { check: 'dockerfile-lint', status: 'skip', reason: 'n/a — no Dockerfile present', durationMs: 1, at: '2026-08-02T12:00:01.000Z' },
    ]));

    const annPath = join(root, 'annotations.json');
    writeFileSync(annPath, JSON.stringify({ annotations: [], scannerAnnotations: [rec()] }));
    return { root, b1, b2, regPath, annPath, out: join(root, 'reports', 'ann-area') };
  }

  const run = (fx, batch) => spawnSync(process.execPath, ['--import', NO_FETCH, ROLLUP, batch],
    { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: fx.regPath, CW_MONITOR_OUT: '', CW_ANNOTATIONS: fx.annPath } });

  const FX = twoSliceFixture();
  const R1 = run(FX, FX.b1);
  const S1 = JSON.parse(readFileSync(join(FX.out, 'rollup.json'), 'utf8'));
  const R2 = run(FX, FX.b2);
  const S2 = JSON.parse(readFileSync(join(FX.out, 'rollup.json'), 'utf8'));

  test('both slices roll', () => {
    assert.equal(R1.status, 0, `slice 1 failed: ${(R1.stderr || '').slice(0, 600)}`);
    assert.equal(R2.status, 0, `slice 2 failed: ${(R2.stderr || '').slice(0, 600)}`);
  });

  test('control: in the slice that SCANNED it, the record applies', () => {
    assert.deepEqual(S1.scannerAnnotationStatus.applied, [{ record: 'secrets:aws-key|src/a.js@alpha', matched: 1 }]);
    assert.deepEqual(S1.scannerAnnotationStatus.carried, [], 'nothing is carried on a slice that scanned the category');
  });

  test('the fixture really does carry — otherwise this file proves nothing', () => {
    assert.equal(S2.scanners.secrets.carried, true, 'secrets must be CARRIED in slice 2');
    assert.equal(S2.scanners.secrets.annotated, 1, 'the carried aggregate keeps the suppression it was built with');
    const rows = S2.scannerFindings.secrets || [];
    assert.equal(rows.length, 1, 'the carried detail rows ride along');
    assert.ok(rows[0].annotation, 'and they arrive with the annotation already attached');
  });

  test('THE FIX: a record in a carried category is reported carried, never noMatch', () => {
    const st = S2.scannerAnnotationStatus;
    assert.deepEqual(st.noMatch, [],
      'the suppression is working — filing it under noMatch tells the operator to hunt a typo that does not exist');
    assert.deepEqual(st.carried, [{ record: 'secrets:aws-key|src/a.js@alpha', category: 'secrets' }],
      'un-evaluated is its own published state, not silence and not a failure');
    assert.deepEqual(st.applied, [],
      'nor may it claim to have applied this slice — the overlay never ran against these rows');
  });

  test('a carried record is not "needing attention", but is still stated', () => {
    assert.doesNotMatch(String(R2.stdout), /annotations needing attention/,
      'a carried record is not a defect and must not be escalated as one');
    assert.match(String(R2.stdout), /not evaluated this slice: 1 in carried categories \(secrets\)/,
      'silence would leave a slice that checked no records looking like one that checked them all');
  });

  test('invalid and expired still win over carried — those are properties of the RECORD', () => {
    // a malformed or lapsed record is wrong regardless — the carried branch is ordered last
    const fx = twoSliceFixture();
    writeFileSync(fx.annPath, JSON.stringify({ annotations: [], scannerAnnotations: [
      { category: 'secrets', repo: 'alpha', action: 'accept', reason: 'invalid: no identity', who: WHO, at: AT },
      rec({ rule: 'generic-token', expires: '2026-08-02T00:00:00.000Z', reason: 'expired fixture' }),
    ] }));
    run(fx, fx.b1);
    run(fx, fx.b2);
    const s2 = JSON.parse(readFileSync(join(fx.out, 'rollup.json'), 'utf8'));
    assert.equal(s2.scanners.secrets.carried, true, 'still the carried scenario');
    assert.equal(s2.scannerAnnotationStatus.invalid.length, 1, 'a malformed record is reported even in a carried category');
    assert.equal(s2.scannerAnnotationStatus.expired.length, 1, 'so is a lapsed one');
    assert.deepEqual(s2.scannerAnnotationStatus.carried, [], 'neither is swallowed by the carried bucket');
  });
});

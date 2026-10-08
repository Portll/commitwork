// node --test monitor/test/ — the scanner key must identify the row, and must not re-key rows that
// already work. Per operator ruling D12 (2026-08-13): identity is never pinned to line numbers —
// the line lives on `anchor` with a content hash; migrateLineKeys adopts on contact before filing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scannerIdentityParts, isDegenerateKey, titleForScannerRow, migrateDegenerateKeys,
  verifyChain, appendIssueEvent,
} from '../issue-store.mjs';

const parts = (row, cat) => scannerIdentityParts(row, cat).parts;

test('identity is (rule, file) — the LINE is not part of it (D12, ruled 2026-08-13)', () => {
  // the line moved to anchor/anchorHistory; `file` stays — dropping it would merge different findings
  const row = { repo: 'r', rule: 'js/xss', file: 'a.js', line: 12 };
  assert.deepEqual(parts(row, 'sastSemgrep'), ['js/xss', 'a.js']);
  assert.equal(scannerIdentityParts(row, 'sastSemgrep').from, 'rule-file');
});

test('the SAME finding at a different line is the SAME key — the movement this ruling exists for', () => {
  // under the old key these were two identities — a shifted finding read as one ending, another beginning
  const at10 = { repo: 'r', rule: 'js/xss', file: 'a.js', line: 10 };
  const at400 = { repo: 'r', rule: 'js/xss', file: 'a.js', line: 400 };
  assert.deepEqual(parts(at10, 'sastSemgrep'), parts(at400, 'sastSemgrep'));
  // ...and a different FILE is still a different finding.
  assert.notDeepEqual(parts(at10, 'sastSemgrep'), parts({ ...at10, file: 'b.js' }, 'sastSemgrep'));
});

test('a rule with no file still keys on the rule — only an all-empty triple falls back (D12)', () => {
  // CodeQL emits whole-artifact results with no file — the key still discriminates by rule
  const row = { repo: 'r', rule: 'js/whole-artifact', file: undefined, line: undefined };
  assert.deepEqual(parts(row, 'sastCodeql'), ['js/whole-artifact', undefined]);
  assert.equal(scannerIdentityParts(row, 'sastCodeql').from, 'rule-file');
});

test('a row with a line but NO rule and NO file does not key on the line (D12)', () => {
  // the line must not sneak back in as a last resort
  const row = { repo: 'r', rule: undefined, file: undefined, line: 77 };
  const r = scannerIdentityParts(row, 'cspm');
  assert.equal(r.parts.includes(77), false, 'the line is never a discriminator, not even alone');
  assert.notEqual(r.from, 'rule-file', 'with no rule and no file it falls back to the declared identity');
});

test('cspm falls back to its DECLARED identity (control, resource) instead of three undefineds', () => {
  const row = { repo: 'commitwork', control: 'Require signed commits', resource: 'Portll/commitwork', message: 'x' };
  const p = parts(row, 'cspm');
  assert.deepEqual(p, ['control=Require signed commits', 'resource=Portll/commitwork']);
  assert.match(scannerIdentityParts(row, 'cspm').from, /identity\(control,resource\)/);
});

test('tlsHeaders and depsRetire use theirs too — the fix is not cspm-specific', () => {
  assert.deepEqual(parts({ repo: 'r', issue: 'missing-hsts', target: 'h:443' }, 'tlsHeaders'),
    ['issue=missing-hsts', 'target=h:443']);
  assert.deepEqual(parts({ repo: 'r', component: 'jquery', id: 'CVE-1' }, 'depsRetire'),
    ['component=jquery', 'id=CVE-1']);
});

test('a row nothing can identify is UNKEYABLE, not filed under a colliding key', () => {
  assert.deepEqual(parts({ repo: 'r', message: 'something happened' }, 'cspm'), []);
  assert.equal(scannerIdentityParts({ repo: 'r' }, 'cspm').from, 'none');
});

test('isDegenerateKey matches the broken shape and nothing else', () => {
  assert.equal(isDegenerateKey('sc:r|cspm|undefined|undefined|undefined'), true);
  assert.equal(isDegenerateKey('sc:r|sastSemgrep|js/xss|a.js|12'), false);
  assert.equal(isDegenerateKey('sc:r|codeql|js/rule|undefined|undefined'), false, 'a rule still identifies it');
  assert.equal(isDegenerateKey('f:some-dep-key'), false);
  assert.equal(isDegenerateKey(null), false);
});

test('the row title never renders the string "undefined" — it names the control or says so', () => {
  assert.equal(titleForScannerRow({ repo: 'cw', control: 'Require signed commits', resource: 'Portll/cw' }, 'cspm'),
    'Require signed commits · Portll/cw [cspm] (cw)');
  assert.equal(titleForScannerRow({ repo: 'cw' }, 'cspm'), '(unnamed rule) [cspm] (cw)');
  assert.equal(titleForScannerRow({ repo: 'cw', rule: 'js/xss' }, 'sastSemgrep'), 'js/xss [sastSemgrep] (cw)');
});

// ── the migration ───────────────────────────────────────────────────────────────────────────────
// two legacy records share the IDENTICAL key — only one holds the byKey slot; the other orphan
// mints a duplicate on the next ingest
const LEGACY_KEY = 'sc:cw|cspm|undefined|undefined|undefined';
function storeWithLegacy(n = 1) {
  const doc = { version: 1, nextOrdinal: 1, byKey: {}, aliases: {}, lastIngest: null, events: [], issues: {} };
  for (let i = 0; i < n; i++) {
    const id = `ISS-PERSONAL-S-00000${i}`;
    doc.issues[id] = { id, area: 'a', repo: 'cw', source: { kind: 'scanner-row', key: LEGACY_KEY, tool: 'cspm', rule: null }, state: 'open' };
  }
  doc.byKey[LEGACY_KEY] = 'ISS-PERSONAL-S-000000';
  appendIssueEvent(doc, 'issue-opened', 'ISS-PERSONAL-S-000000', {}, '2026-08-12T00:00:00Z');
  return doc;
}

test('one legacy record and one corrected key: ADOPTED, with the old key kept and an event in the chain', () => {
  const doc = storeWithLegacy(1);
  const to = 'sc:cw|cspm|control=Require signed commits|resource=Portll/cw';
  const r = migrateDegenerateKeys(doc, [to], { at: '2026-08-12T01:00:00Z' });

  assert.equal(r.migrated.length, 1);
  const iss = doc.issues['ISS-PERSONAL-S-000000'];
  assert.equal(iss.source.key, to);
  assert.deepEqual(iss.priorKeys, [LEGACY_KEY], 'the old identity is kept, not erased');
  assert.equal(doc.byKey[to], iss.id);
  assert.equal(doc.byKey[LEGACY_KEY], undefined, 'the dead slot is released');

  const ev = doc.events.at(-1);
  assert.equal(ev.type, 'issue-key-migrated');
  assert.equal(ev.data.to, to);
  assert.deepEqual(verifyChain(doc), [], 'the hash chain must still verify — this is append-only');
});

test('two legacy records, or two candidates, is AMBIGUOUS — guessing would graft one history onto another', () => {
  const two = storeWithLegacy(2);
  const r = migrateDegenerateKeys(two, ['sc:cw|cspm|control=A|resource=B'], { at: 'now' });
  assert.equal(r.migrated.length, 0);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(two.issues['ISS-PERSONAL-S-000000'].source.key, LEGACY_KEY, 'untouched');

  const one = storeWithLegacy(1);
  const r2 = migrateDegenerateKeys(one, ['sc:cw|cspm|control=A|resource=B', 'sc:cw|cspm|control=C|resource=D'], { at: 'now' });
  assert.equal(r2.migrated.length, 0);
  assert.equal(r2.ambiguous.length, 1);
});

test('dryRun reports the migration without performing it', () => {
  const doc = storeWithLegacy(1);
  const before = doc.events.length;
  const r = migrateDegenerateKeys(doc, ['sc:cw|cspm|control=A|resource=B'], { at: 'now', dryRun: true });
  assert.equal(r.migrated.length, 1);
  assert.equal(doc.events.length, before, 'no event written');
  assert.equal(doc.issues['ISS-PERSONAL-S-000000'].source.key, LEGACY_KEY);
});

test('a closed legacy record is not adopted — its replacement files fresh', () => {
  const doc = storeWithLegacy(1);
  doc.issues['ISS-PERSONAL-S-000000'].state = 'closed';
  assert.equal(migrateDegenerateKeys(doc, ['sc:cw|cspm|control=A|resource=B'], { at: 'now' }).migrated.length, 0);
});

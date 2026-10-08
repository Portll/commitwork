// D-UNMEASURED: an unread defenceVector must not publish a verdict nobody reached.
//
// The defect this pins: `open` is the value normAxis() invents for a missing cell, so a vector
// nobody populated looked — by state alone — exactly like one measured and found undefended. The
// verdict fell through to `exploitable` for both. Measured on the live fleet 2026-08-26: every
// osv finding carried residualVerdict:"exploitable" with all eight axes state:"open", evidence:"",
// including CVE-2023-44487 against a repo with no HTTP/2 server and CVE-2025-31125 against a repo
// that starts no Vite dev server.
//
// Both directions are asserted separately. A test that only proves "unmeasured => undetermined"
// would still pass if the fix swallowed the real exploitable verdicts too, and that is the
// direction that lies to you: it converts every genuine finding into a shrug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDefence, verdictForClient, isUnmeasured, ALL_AXES, QUORUM_AXES } from '../defence-vector.mjs';

const OPEN = { state: 'open', evidence: '', ref: '' };
const vec = (over = {}) => Object.fromEntries(ALL_AXES.map(ax => [ax, { ...OPEN, ...(over[ax] || {}) }]));

test('an entirely unpopulated vector is undetermined, never exploitable', () => {
  for (const input of [undefined, {}, vec()]) {
    const d = computeDefence({ defenceVector: input });
    assert.equal(d.residualVerdict, 'undetermined',
      `defenceVector ${JSON.stringify(input)} must not publish a verdict`);
    assert.equal(d.unmeasured, true);
  }
});

test('the live-fleet shape reproduces the defect input exactly', () => {
  // verbatim from reports/100randomrepos/lifecycle.json, key
  // ffuf_ffuf|osv|CVE-2023-44487|golang.org/x/net|file:///src/go.mod
  const live = Object.fromEntries(ALL_AXES.map(ax => [ax, { state: 'open', evidence: '', ref: '' }]));
  const d = computeDefence({ id: 'CVE-2023-44487', defenceVector: live });
  assert.equal(d.residualVerdict, 'undetermined');
  assert.notEqual(d.residualVerdict, 'exploitable');
});

// The direction that lies to you. If these regress, the fix has silenced real findings.
test('a MEASURED but undefended vector still reports exploitable', () => {
  const measured = vec({
    reachability: { state: 'open', evidence: 'call graph reaches the sink at handler.mjs:44' },
  });
  const d = computeDefence({ defenceVector: measured });
  assert.equal(d.unmeasured, false, 'evidence on any axis means the vector was read');
  assert.equal(d.residualVerdict, 'exploitable');
});

test('one axis with a non-open state is enough to count as measured', () => {
  for (const st of ['blocks', 'partial', 'n/a']) {
    const d = computeDefence({
      defenceVector: vec({ networkExposure: { state: st, rationale: 'r', evidence: 'internal-network only' } }),
    });
    assert.equal(d.unmeasured, false, `state '${st}' is a reading`);
    assert.notEqual(d.residualVerdict, 'undetermined');
  }
});

test('whitespace-only evidence does not count as a reading', () => {
  const d = computeDefence({ defenceVector: vec({ dataAtRisk: { state: 'open', evidence: '   \n\t ' } }) });
  assert.equal(d.unmeasured, true);
  assert.equal(d.residualVerdict, 'undetermined');
});

test('a contained vector is unaffected — the quorum path still wins', () => {
  const blocks = (ev) => ({ state: 'blocks', evidence: ev, ref: ev });
  const d = computeDefence({
    defenceVector: vec({
      networkExposure: blocks('air-gapped segment'),
      inputMediation: blocks('WAF rule 942100'),
      privilegeBlast: blocks('runs unprivileged in a scratch container'),
    }),
    residualExpires: '2026-12-01T00:00:00Z',
    recheckTrigger: 'next fleet upgrade',
  });
  assert.equal(d.unmeasured, false);
  assert.equal(d.quorumMet >= QUORUM_AXES.length - 4, true);
  assert.equal(d.residualVerdict, 'contained');
});

test('undetermined never demands expires/recheckTrigger (D-EXPIRE applies to contained only)', () => {
  const d = computeDefence({ defenceVector: {} });
  assert.equal(d.residualVerdict, 'undetermined');
  assert.deepEqual(d.violations, [], 'an unread vector is not a contract violation, just unread');
});

test('isUnmeasured is exported and agrees with the verdict it drives', () => {
  assert.equal(isUnmeasured({}), true);
  assert.equal(isUnmeasured(vec()), true);
  assert.equal(isUnmeasured(vec({ detectability: { state: 'blocks' } })), false);
  assert.equal(isUnmeasured(vec({ detectability: { evidence: 'alert wired to pagerduty' } })), false);
});

test('the client render states the absence rather than hedging the finding', () => {
  assert.equal(verdictForClient('undetermined'), 'defences not assessed');
  assert.equal(verdictForClient('exploitable'), 'exploitable');
  assert.match(verdictForClient('contained', '2026-12-01T00:00:00Z'), /^accepted\+contained/);
});

test('undetermined is declared in BOTH schemas that gate it', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const dir = fileURLToPath(new URL('../schema/', import.meta.url));
  const status = JSON.parse(await readFile(dir + 'status-enum.json', 'utf8'));
  const record = JSON.parse(await readFile(dir + 'lifecycle-record.schema.json', 'utf8'));
  // Derived from the artifacts, not retyped here — a hand-listed expectation would pass while
  // the schema the validator actually reads had drifted.
  assert.ok(status.definitions.residualVerdict.enum.includes('undetermined'),
    'status-enum.json must declare it or validate-authored-judgment rejects every unread record');
  assert.ok(record.properties.residualVerdict.enum.includes('undetermined'),
    'lifecycle-record.schema.json is the enum the validator reads out');
  assert.deepEqual(
    [...status.definitions.residualVerdict.enum].sort(),
    [...record.properties.residualVerdict.enum].sort(),
    'the two enums must not drift apart');
});

// The probe answers "is this advisory still live on upstream HEAD?" and the whole point is that a
// wrong answer either fabricates a redundant PR (fixed:false when fixed) or suppresses a needed one
// (fixed:true when live). The govulncheck exit-code trap and the fail-closed direction are pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretGovulncheck, parseConcatJson, probeUpstreamHead, slugFromGitUrl } from '../upstream-probe.mjs';

const config = '{"config":{"scanner_name":"govulncheck"}}';
const findingFor = (id) => JSON.stringify({ finding: { osv: id, trace: [{ module: 'm', function: 'F' }] } });

test('advisory present in the analysis -> still live (propose), regardless of exit status', () => {
  const out = `${config}\n${findingFor('GO-2026-6061')}`;
  assert.equal(interpretGovulncheck('GO-2026-6061', { status: 0, stdout: out }).fixed, false);
  // presence is trustworthy even if the run also errored on some other package
  assert.equal(interpretGovulncheck('GO-2026-6061', { status: 1, stdout: out }).fixed, false);
});

test('absence + clean exit (status 0) -> fixed', () => {
  const out = `${config}\n${findingFor('GO-2025-0001')}`; // a DIFFERENT advisory is present
  assert.equal(interpretGovulncheck('GO-2026-6061', { status: 0, stdout: out }).fixed, true);
});

test('absence + FAILED build (status != 0) -> null, never a false fixed (the 1Panel/coze case)', () => {
  // config emitted but the scan errored, so it may never have reached the vulnerable symbol —
  // "advisory unseen" here is "could not analyse", not "remediated".
  const out = `${config}\n${findingFor('GO-2025-0001')}`;
  const v = interpretGovulncheck('GO-2026-6061', { status: 1, stdout: out });
  assert.equal(v.fixed, null);
  assert.match(v.reason, /incomplete-analysis/);
});

test('no analysis (tool missing / crash / empty) -> null, fail closed', () => {
  for (const r of [{ status: null, stdout: '' }, { status: 1, stdout: 'panic: boom' }, { status: 0, stdout: '   ' }]) {
    assert.equal(interpretGovulncheck('GO-x', r).fixed, null, JSON.stringify(r));
  }
});

test('a finding without a traced function is not counted as reachable', () => {
  const out = `${config}\n${JSON.stringify({ finding: { osv: 'GO-x', trace: [{ module: 'm' }] } })}`;
  assert.equal(interpretGovulncheck('GO-x', { status: 0, stdout: out }).fixed, true);
});

test('parseConcatJson tolerates a garbage chunk mid-stream', () => {
  const recs = parseConcatJson(`${config}\nNOT JSON\n${findingFor('GO-1')}`);
  assert.ok(recs.some((r) => r.config));
  assert.ok(recs.some((r) => r.finding));
});

test('probe refuses a checkout whose origin is not the intended repo (provenance)', () => {
  const v = probeUpstreamHead(
    { id: 'GO-1', upstream: { repo: 'trufflesecurity/trufflehog' } },
    { checkoutDir: '/x', run: () => ({ status: 0, stdout: config }), originOf: () => 'attacker/fork', shaOf: () => 'deadbeef' },
  );
  assert.equal(v.fixed, null);
  assert.match(v.reason, /checkout-origin-mismatch/);
});

test('probe records the upstream SHA it measured at', () => {
  const v = probeUpstreamHead(
    { id: 'GO-1', upstream: { repo: 'o/r' } },
    { checkoutDir: '/x', run: () => ({ status: 0, stdout: `${config}\n${findingFor('GO-1')}` }), originOf: () => 'o/r', shaOf: () => 'abc123' },
  );
  assert.equal(v.fixed, false);
  assert.equal(v.sha, 'abc123');
});

test('slugFromGitUrl: github https/ssh -> slug; non-github -> null', () => {
  assert.equal(slugFromGitUrl('https://github.com/1Panel-dev/1Panel.git'), '1Panel-dev/1Panel');
  assert.equal(slugFromGitUrl('git@github.com:o/r.git'), 'o/r');
  assert.equal(slugFromGitUrl('https://gitlab.com/o/r.git'), null);
});

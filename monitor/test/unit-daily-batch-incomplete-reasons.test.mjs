// Why a batch is not complete, one reason per condition (monitor/daily.mjs batchIncompleteReasons), and
// that batchIsComplete is exactly "no reasons".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchIncompleteReasons, batchIsComplete, DAILY_JOB_LABEL } from '../daily.mjs';

const full = () => ({
  manifest: { group: 'all', scope: { repos: [{ name: 'a' }, { name: 'b' }] } },
  verdict: { rollup: 'published', repos: { resolved: 2, scanned: 2, scans: [{ name: 'a', manifest: 'security-baseline', ran: true, why: 'clean' }] } },
});

const CASES = {
  complete: [(x) => x, []],
  'no verdict': [(x) => ({ ...x, verdict: null }), ['no batch verdict yet: in flight, deferred or never finished']],
  'no manifest': [(x) => ({ ...x, manifest: null }), ['no batch manifest']],
  narrowed: [(x) => ({ ...x, manifest: { ...x.manifest, only: ['a'] } }), ['group all (narrowed), not a full all sweep']],
  'other group': [(x) => ({ ...x, manifest: { ...x.manifest, group: 'deep' } }), ['group deep, not a full all sweep']],
  unpublished: [(x) => ({ ...x, verdict: { ...x.verdict, rollup: 'held' } }), ['rollup held']],
  'none resolved': [(x) => ({ ...x, verdict: { ...x.verdict, repos: { resolved: 0, scanned: 0, scans: [] } } }), ['no repos resolved']],
  'partly scanned': [(x) => ({ ...x, verdict: { ...x.verdict, repos: { ...x.verdict.repos, scanned: 1 } } }), ['scanned 1 of 2 repos']],
  'a scan did not run': [(x) => ({ ...x, verdict: { ...x.verdict, repos: { ...x.verdict.repos, scans: [{ name: 'a', manifest: 'deps', ran: false, why: 'timed out' }] } } }), ['1 scan(s) did not run: a:deps (timed out)']],
  'member out of scope': [(x) => ({ ...x, manifest: { ...x.manifest, scope: { repos: [{ name: 'a' }] } } }), ["members outside the sweep's scope: b"]],
};

test('each condition batchIsComplete checks has its own reason, and complete means none', () => {
  for (const [name, [change, want]] of Object.entries(CASES)) {
    const batch = change(full());
    assert.deepEqual(batchIncompleteReasons(batch, ['a', 'b']), want, name);
    assert.equal(batchIsComplete(batch, ['a', 'b']), want.length === 0, name);
  }
});

test('several failures are all named, in batchIsComplete\'s order', () => {
  const x = full();
  const batch = { manifest: { group: 'deep', scope: { repos: [] } }, verdict: { ...x.verdict, rollup: 'held' } };
  assert.deepEqual(batchIncompleteReasons(batch, ['a']), ['group deep, not a full all sweep', 'rollup held', "members outside the sweep's scope: a"]);
});

test('the daily job label is declared once, for install-agents and readers', () => {
  assert.equal(DAILY_JOB_LABEL, 'com.portll.commitwork-daily');
});

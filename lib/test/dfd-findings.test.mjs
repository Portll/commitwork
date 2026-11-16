// dfd@1 findings overlay: referential validation (lib/dfd.mjs) and the badge/legend/table render
// (lib/dfd-render.mjs). The adapter that enriches an overlay from a facts ledger is tested in
// flow/test/dfd-adapter.test.mjs. A finding is anchored to a node or a flow and carries a status
// (live / mitigated / undetermined) — the dimension the overlay exists to show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDfd, analyse, FINDING_SEVERITIES, FINDING_STATUSES } from '../dfd.mjs';
import { layout, renderSvg, findingsOverlay, findingsSection } from '../dfd-render.mjs';

/** a → p → s, with whatever findings the caller supplies. */
function base(findings) {
  return {
    v: 1, kind: 'dfd',
    nodes: [
      { id: 'a', kind: 'external', subtype: 'actor', label: 'Attacker' },
      { id: 'p', kind: 'process', label: 'parser' },
      { id: 's', kind: 'store', subtype: 'file', label: 'sink' },
    ],
    flows: [{ from: 'a', to: 'p', mode: 'sync' }, { from: 'p', to: 's', mode: 'sync' }],
    ...(findings ? { findings } : {}),
  };
}
const laid = (m) => layout(m, analyse(m), { orientation: 'TB' });

test('the enums are the ones the schema and renderer share', () => {
  assert.deepEqual([...FINDING_SEVERITIES], ['critical', 'high', 'medium', 'low', 'undetermined']);
  assert.deepEqual([...FINDING_STATUSES], ['live', 'mitigated', 'dismissed', 'undetermined']);
});

test('a findings overlay with valid node and flow anchors validates', () => {
  const doc = base([
    { id: 'F1', cwe: 'CWE-190', severity: 'high', status: 'mitigated', at: { node: 'p' } },
    { id: 'F2', severity: 'undetermined', status: 'undetermined', at: { flow: { from: 'p', to: 's' } } },
  ]);
  assert.equal(validateDfd(doc).ok, true);
});

test('a finding anchored to a node that is not declared is rejected', () => {
  const r = validateDfd(base([{ id: 'F1', at: { node: 'nope' } }]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /F1.*anchored to node "nope", which is not a node/);
});

test('a finding anchored to a flow the document does not carry is rejected', () => {
  // a->s is not a flow in base(); its endpoints exist but the edge does not
  const r = validateDfd(base([{ id: 'F1', at: { flow: { from: 'a', to: 's' } } }]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /F1.*flow "a" -> "s" that the document does not carry/);
});

test('a finding anchored to a flow whose endpoint is not a node is rejected', () => {
  const r = validateDfd(base([{ id: 'F1', at: { flow: { from: 'p', to: 'ghost' } } }]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /F1.*whose to "ghost" is not a node/);
});

test('a duplicate finding id is rejected', () => {
  const r = validateDfd(base([{ id: 'F1', at: { node: 'p' } }, { id: 'F1', at: { node: 's' } }]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /finding id "F1" is declared more than once/);
});

test('a model with no findings is unchanged — the overlay is absent, not empty', () => {
  const m = base();
  assert.equal(validateDfd(m).ok, true);
  assert.equal(findingsOverlay(m, laid(m)), '');
  assert.equal(findingsSection(m, new Map()), '');
});

test('each anchored finding draws one badge, carrying its severity and status classes', () => {
  const m = base([
    { id: 'F1', severity: 'high', status: 'live', at: { node: 'p' } },
    { id: 'F2', severity: 'low', status: 'mitigated', at: { node: 's' } },
    { id: 'F3', severity: 'undetermined', status: 'undetermined', at: { flow: { from: 'p', to: 's' } } },
  ]);
  const svg = findingsOverlay(m, laid(m));
  assert.equal((svg.match(/class="fbadge/g) || []).length, 3);
  assert.match(svg, /fbadge sev-high st-live/);
  assert.match(svg, /fbadge sev-low st-mitigated/);
  assert.match(svg, /fbadge sev-undetermined st-undetermined/);
  // the state glyph rides in the label
  assert.match(svg, />F1 !</);
  assert.match(svg, />F2 ✓</);
  assert.match(svg, />F3 \?</);
});

test('onlyLive drops every badge and table row that is not a live finding', () => {
  const m = base([
    { id: 'F1', severity: 'high', status: 'live', at: { node: 'p' } },
    { id: 'F2', severity: 'high', status: 'mitigated', at: { node: 's' } },
  ]);
  const svg = findingsOverlay(m, laid(m), { onlyLive: true });
  assert.equal((svg.match(/class="fbadge/g) || []).length, 1);
  assert.match(svg, /F1 !/);
  assert.doesNotMatch(svg, /F2/);
  const section = findingsSection(m, new Map([['p', 'P1'], ['s', 'D1']]), { onlyLive: true });
  assert.match(section, /live only/);
  assert.match(section, /F1/);
  assert.doesNotMatch(section, /<td[^>]*>F2</);
});

test('renderSvg embeds the findings layer; the full page carries the findings table', () => {
  const m = base([{ id: 'F1', cwe: 'CWE-22', severity: 'high', status: 'live', title: 'traversal', at: { node: 'p' } }]);
  const svg = renderSvg(m, laid(m));
  assert.match(svg, /class="findings"/);
  const section = findingsSection(m, new Map([['p', 'P1']]));
  assert.match(section, /Findings overlay/);
  assert.match(section, /CWE-22/);
  assert.match(section, /traversal/);
  assert.match(section, /P1/); // anchor shown by its diagram ref, not the raw id
});

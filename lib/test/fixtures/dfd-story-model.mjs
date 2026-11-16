// A small document for the story view's tests: clearly a fixture, no real system.
/** Two areas (one with a lane), a way in, three endings, five weak points, a loose ruling and two change sets. */
export const STORY = () => ({
  v: 1, kind: 'dfd', title: 'toy',
  groups: [{ id: 'g1', label: 'g1 label', plain: 'Our code', boundary: 'system' }, { id: 'l1', label: 'lane one', boundary: 'system', parent: 'g1' }, { id: 'g2', label: 'Their code', boundary: 'trust' }],
  nodes: [
    { id: 'in', kind: 'external', subtype: 'actor', label: 'in', plain: 'A stranger' },
    { id: 'cfg', kind: 'external', subtype: 'env', label: 'cfg' },
    { id: 'a', kind: 'process', label: 'a()', plain: 'Reader of things with a very long name that wraps twice over and more', group: 'l1' },
    { id: 'b', kind: 'process', label: 'b', group: 'l1' },
    { id: 'c', kind: 'process', label: 'c', group: 'g2', unknown: true },
    { id: 'lone', kind: 'process', label: 'lone' },
    { id: 'far', kind: 'process', label: 'far', group: 'g1' },
    { id: 'boom', kind: 'external', subtype: 'system', label: 'boom', plain: 'Everything burns', impact: 'critical' },
    { id: 'leak', kind: 'store', subtype: 'file', label: 'leak', impact: 'low' },
    { id: 'ok', kind: 'external', subtype: 'system', label: 'ok' },
  ],
  flows: [
    { from: 'in', to: 'a', label: 'bytes' }, { from: 'cfg', to: 'a' }, { from: 'a', to: 'b', label: 'x' }, { from: 'a', to: 'b', label: 'y' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' },
    { from: 'b', to: 'boom', gate: { state: 'unevaluated', finding: 'W2' } }, { from: 'c', to: 'boom', gate: { state: 'safe', finding: 'W1@c', evidence: { level: 'static' } } },
    { from: 'a', to: 'leak', label: 'spill' }, { from: 'a', to: 'ok' }, { from: 'in', to: 'lone' }, { from: 'lone', to: 'leak', existence: 'unknown' },
    { from: 'a', to: 'a' }, { from: 'ghost', to: 'a' },
  ].map((f) => ({ mode: 'sync', ...f })),
  findings: [
    { id: 'W1', at: { node: 'a' }, title: 'a reads too far', severity: 'low', status: 'mitigated' },
    { id: 'W1@c', at: { node: 'c' }, title: 'a reads too far', severity: 'low', status: 'live' },
    { id: 'W2', at: { node: 'b' }, title: 'b trusts a length', severity: 'medium', status: 'dismissed', note: 'said to be fine' },
    { id: 'W3', at: { flow: { from: 'lone', to: 'leak' } }, severity: 'high', status: 'live' },
    { id: 'W4', at: { node: 'ghost' }, severity: 'low' },
    { id: 'W5', at: { node: 'a' }, title: 'a held twice', severity: 'weird', status: 'dismissed', controls: [{ axis: 'source', what: 's', test: 't1' }, { axis: 'sink', what: 'k', test: 't2' }] },
  ],
  prs: [{ id: 'p1', title: 'first', plain: 'First fix' }, { id: 'p2', title: 'second' }],
  patches: [
    { id: 'K1', pr: 'p1', title: 'k one', plain: 'Adds a check', caveat: 'One thing left', note: 'tech note', findings: ['W1'], guard: { from: 'in', to: 'a' }, closes: [{ from: 'a', to: 'leak' }], rejects: [{ from: 'a', to: 'ok' }], evidence: { level: 'tested' } },
    { id: 'K2', pr: 'p2', findings: ['W2'], closes: [] },
  ],
});

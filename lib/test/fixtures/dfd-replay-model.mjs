// A small synthetic document for the replay view's tests and its fixture page: a made-up parcel
// intake service. Every name is invented; no real system, product or person.
const proc = (id, label, group, extra = {}) => ({ id, kind: 'process', label, group, ...extra });
const flow = (from, to, label, extra = {}) => ({ from, to, label, mode: 'sync', ...extra });

/** Two pull requests, one change set from shared commits, a loose ruling, nested and trust groups. */
export const MODEL = () => ({
  v: 1,
  kind: 'dfd',
  title: 'Parcel intake service',
  source: { producer: 'hand-written fixture', note: 'Synthetic: invented names only.' },
  groups: [
    { id: 'g_in', label: 'intake', plain: 'Manifest intake', boundary: 'system' },
    { id: 'g_parse', label: 'intake/parse', plain: 'Manifest parser', boundary: 'system', parent: 'g_in' },
    { id: 'g_led', label: 'ledger', plain: 'Ledger writer', boundary: 'system' },
    { id: 'g_carrier', label: 'carrier', plain: 'Carrier platform', boundary: 'trust' },
  ],
  nodes: [
    { id: 'S1', kind: 'external', subtype: 'actor', label: 'Uploaded parcel manifest', plain: 'Manifest upload from sender' },
    { id: 'S2', kind: 'external', subtype: 'endpoint', label: 'Partner webhook' },
    proc('P1', 'intake/reader.js', 'g_in', { plain: 'Manifest reader', coverage: { lines: { covered: 45, total: 50 } } }),
    proc('P2', 'intake/parse/fields.js', 'g_parse', { plain: 'Field parser', coverage: { lines: { covered: 30, total: 60 } } }),
    proc('P3', 'intake/parse/units.js', 'g_parse', { plain: 'Unit converter' }),
    proc('P4', 'ledger/write.js', 'g_led', { plain: 'Ledger row writer', coverage: { lines: { covered: 20, total: 20 } } }),
    proc('P5', 'ledger/notify.js', 'g_led', { plain: 'Sender notifier', note: 'Formats a notice; see ledger/templates/notice.txt.' }),
    { id: 'D1', kind: 'store', subtype: 'database', label: 'Ledger database', group: 'g_led' },
    { id: 'C1', kind: 'external', subtype: 'system', label: 'Carrier rate API', group: 'g_carrier' },
    { id: 'L1', kind: 'store', subtype: 'file', label: 'config/limits.json' },
    { id: 'L2', kind: 'external', subtype: 'env', label: 'PARCEL_MODE' },
    { id: 'X1', kind: 'external', subtype: 'system', label: 'Shell command run', plain: 'Command execution on host', impact: 'critical' },
    { id: 'X2', kind: 'store', subtype: 'database', label: 'Ledger tampering', impact: 'high' },
    { id: 'X3', kind: 'external', subtype: 'system', label: 'Intake crash (DoS)', impact: 'low' },
    { id: 'R1', kind: 'external', subtype: 'system', label: 'Typed reject to sender' },
  ],
  flows: [
    flow('S1', 'P1', 'manifest bytes'),
    flow('S2', 'P1', 'partner manifest'),
    flow('P1', 'P2', 'raw fields', { evidence: { existence: 'confirmed', method: 'taint' } }),
    flow('P2', 'P3', 'weight field'),
    flow('P2', 'P4', 'parsed row'),
    flow('P3', 'P4', 'converted row'),
    flow('P4', 'D1', 'ledger row'),
    flow('P4', 'P5', 'row id'),
    flow('P5', 'C1', 'rate request'),
    flow('C1', 'P5', 'rate quote'),
    flow('L1', 'P1', 'limits'),
    flow('L2', 'P1', 'mode flag'),
    flow('P2', 'X1', 'field as shell argument'),
    flow('P2', 'R1', 'parse error'),
    flow('P4', 'X2', 'unescaped query'),
    flow('P1', 'X3', 'oversized manifest'),
    flow('P3', 'X3', 'unit overflow'),
  ],
  findings: [
    { id: 'H1', title: 'Command entry from manifest field', severity: 'high', status: 'mitigated', cwe: 'CWE-78', at: { node: 'P2' },
      source: { tool: 'synthetic scanner', rule: 'cmd-injection', file: 'intake/parse/fields.js', line: 42, message: 'Field reaches a shell argument.', steps: [{ file: 'intake/reader.js', line: 10 }, { file: 'intake/parse/fields.js', line: 42 }] } },
    { id: 'H2', title: 'Ledger query injection', severity: 'medium', status: 'mitigated', cwe: 'CWE-89', at: { node: 'P4' }, source: { rule: 'sql-injection', file: 'ledger/write.js', line: 12 } },
    { id: 'H3', title: 'Oversized manifest DoS', severity: 'low', status: 'mitigated', at: { node: 'P1' } },
    { id: 'H4', title: 'Unit overflow', severity: 'medium', status: 'dismissed', at: { node: 'P3' }, controls: [{ axis: 'flow', what: 'clamp', test: 'intake/test/units.test.js: clamps' }], note: 'Judged harmless.' },
    { id: 'H5', title: 'Notice template injection', severity: 'low', status: 'dismissed', at: { node: 'P5' },
      controls: [{ axis: 'sink', what: 'escape', test: 'ledger/test/notify.test.js: escapes' }, { axis: 'source', what: 'allow list', test: 'ledger/test/notify.test.js: allow list' }] },
    { id: 'H6', title: 'Rate quote trusted unchecked', severity: 'critical', status: 'live', at: { flow: { from: 'C1', to: 'P5' } } },
    { id: 'H7', title: 'Weight parse overflow', severity: 'undetermined', status: 'mitigated', at: { node: 'P3' } },
  ],
  prs: [
    { id: 'pr-1', title: 'Bound field parser', state: 'merged', files: ['intake/parse/fields.js', 'intake/parse/test/fields.test.js'] },
    { id: 'pr-2', plain: 'Parameterised ledger writes', title: 'fix: parameterise ledger writes', state: 'open', files: ['ledger/write.js'] },
  ],
  patches: [
    { id: 'K1', pr: 'pr-1', title: 'Field allow list', findings: ['H1'], guard: { from: 'P1', to: 'P2' }, closes: [{ from: 'P2', to: 'X1' }], rejects: [{ from: 'P2', to: 'R1' }],
      evidence: { level: 'tested', control: { kind: 'test', failsWithout: true, passesWith: true, test: 'intake/parse/test/fields.test.js: rejects shell metacharacters' } }, note: 'Rejects any field outside the allow list.' },
    { id: 'K2', pr: 'pr-2', title: 'Bound query parameters', findings: ['H2'], guard: { from: 'P2', to: 'P4' }, closes: [{ from: 'P4', to: 'X2' }], evidence: { level: 'inspected', refs: ['ledger/write.js:12'] } },
    { id: 'K3', title: 'Manifest size cap', findings: ['H3'], guard: { from: 'S1', to: 'P1' }, closes: [{ from: 'P1', to: 'X3' }], commits: ['a1b2c3d4e5f6a7b8'], evidence: { level: 'asserted', refs: ['intake/reader.js:5'] } },
    { id: 'K4', title: 'Weight bound', findings: ['H7'], closes: [{ from: 'P3', to: 'X3' }], commits: ['a1b2c3d4e5f6a7b8', 'b2c3d4e5f6a7b8c9'], evidence: { level: 'rescanned' } },
  ],
});

/** No declared pull requests: patches grouped by shared commits, then by shared evidence refs. */
export const UNDECLARED = () => {
  const m = MODEL();
  delete m.prs;
  m.patches = [
    { id: 'A', findings: ['H1'], closes: [], commits: ['1111111aaaa'] },
    { id: 'B', findings: ['H2'], closes: [], commits: ['1111111aaaa', '2222222bbbb'] },
    { id: 'C', findings: ['H3'], closes: [], evidence: { level: 'asserted', refs: ['intake/reader.js:5 size'] } },
    { id: 'D', findings: ['H7'], closes: [], evidence: { level: 'asserted', refs: ['intake/reader.js:9'] } },
    { id: 'E', findings: [], closes: [] },
  ];
  return m;
};

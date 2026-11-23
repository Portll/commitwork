// The replay fixture plus what only the record view reads: declared layers, routes and an error sink. Invented names only.
import { MODEL, UNDECLARED } from './dfd-replay-model.mjs';

const LAYER = { S1: 'edge', S2: 'edge', P1: 'intake', P2: 'intake', P3: 'intake', P4: 'ledger', P5: 'ledger', D1: 'ledger', G1: 'ledger' };
const record = (m) => ({
  ...m,
  layers: ['edge', 'intake', 'ledger'],
  nodes: [...m.nodes, { id: 'G1', kind: 'store', subtype: 'log', label: 'Write audit log' }].map((n) => (LAYER[n.id] ? { ...n, layer: LAYER[n.id] } : n)),
  flows: [...m.flows, { from: 'P4', to: 'G1', label: 'failed row', mode: 'async', role: 'error' }],
  routes: [
    { id: 'Q1', status: 'open', claim: 'A unit suffix reaches the parser unchecked', node: 'P3', test: 'intake/parse/test/units.test.js' },
    { id: 'Q2', status: 'closed', claim: 'A recorded manifest replays clean', harness: 'replay-fixture.sh' },
  ],
});

export const RECORD = () => record(MODEL());
export const RECORD_UNDECLARED = () => record(UNDECLARED());
/** No node declares impact and no patch rejects, so outcomes fall back to the non-process sinks. */
export const SINKS = () => { const m = RECORD(); m.nodes = m.nodes.map(({ impact, ...n }) => n); m.patches = m.patches.map(({ rejects, ...k }) => k); return m; };

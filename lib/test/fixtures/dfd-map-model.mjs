// A small document for the map view's tests: clearly a fixture, no real system.
export const proc = (id, extra = {}) => ({ id, kind: 'process', label: id, ...extra });
export const file = (id, extra = {}) => ({ id, kind: 'store', subtype: 'file', label: id, ...extra });
export const env = (id) => ({ id, kind: 'external', subtype: 'env', label: id });
export const flow = (from, to, extra = {}) => ({ from, to, mode: 'sync', ...extra });
export const taint = { evidence: { existence: 'confirmed', method: 'taint' } };

/** Two groups, a nested one, ungrouped leaves and code, four issues, traced flows. */
export const MODEL = () => ({
  v: 1, kind: 'dfd', title: 'shop',
  groups: [{ id: 'api', label: 'api', boundary: 'system' }, { id: 'core', label: 'core', boundary: 'system', parent: 'api' }, { id: 'web', boundary: 'system' }, { id: 'empty', label: 'empty', boundary: 'system' }],
  nodes: [
    proc('api/routes.js', { group: 'api', coverage: { lines: { covered: 6, total: 10 } } }),
    proc('api/db.js', { group: 'core', coverage: { lines: { covered: 10, total: 10 } } }),
    proc('api/none.js', { group: 'core', coverage: { lines: { covered: 0, total: 0 } } }),
    proc('web/page.js', { group: 'web', note: 'a note' }),
    proc('loose.js'),
    file('orders.db', { impact: 'high' }),
    file('cache.json'), file('log.txt'), env('DB_URL'), env('PORT'),
    { id: 'req', kind: 'external', subtype: 'actor', label: 'request' },
    { id: 'odd', kind: 'external', label: 'odd' },
    { id: 'cfg', kind: 'store', subtype: 'file', label: 'cfg', group: 'api' },
  ],
  flows: [
    flow('req', 'api/routes.js', taint), flow('api/routes.js', 'api/db.js', taint), flow('api/db.js', 'orders.db'),
    flow('api/routes.js', 'api/db.js'), flow('api/routes.js', 'cache.json'), flow('log.txt', 'api/routes.js'), flow('DB_URL', 'api/db.js'), flow('PORT', 'api/routes.js'),
    flow('web/page.js', 'api/routes.js'), flow('api/routes.js', 'api/routes.js'), flow('cfg', 'api/routes.js'), flow('cache.json', 'log.txt'), flow('ghost', 'api/db.js'),
  ],
  findings: [
    { id: 'F2', at: { node: 'api/db.js' }, title: 'sql injection', severity: 'critical', cwe: 'CWE-89', status: 'live' },
    { id: 'F1', at: { flow: { from: 'api/routes.js', to: 'api/db.js' } }, severity: 'medium' },
    { id: 'F3', at: { node: 'web/page.js' }, title: 'odd one', severity: 'weird' },
    { id: 'F4', at: { flow: { from: 'loose.js', to: 'loose.js' } }, severity: 'low' },
  ],
});

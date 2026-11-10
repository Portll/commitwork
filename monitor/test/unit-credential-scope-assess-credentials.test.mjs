// Per-secret scope rows, undeclared store items and overall credential state (monitor/credential-scope.mjs assessCredentials).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessCredentials } from '../credential-scope.mjs';

const orders = [(s, a) => [s, a], (s, a) => [a, s]];
const schemes = ['', 'keychain', 'kc', 'keyring', 'security', 'secret', 'secrets', 'macos', 'osxkeychain', 'store', 'cred'];
const formats = [(s, a) => ({ service: s, account: a }), (s, a) => [s, a]].concat(
  schemes.flatMap((p) => (p ? [':', '://', '/'] : ['']).flatMap((j) => ['/', ':', '#', '@'].flatMap((k) =>
    orders.map((o) => (s, a) => `${p}${j}${o(s, a).join(k)}`)))),
);
const parses = (f) => {
  try {
    const r = assessCredentials(
      { secrets: { p: f('svc', 'acct'), q: f('oth', 'b1') } },
      { namespaces: ['svc', 'oth'], radius: {} },
      [{ service: 'svc', account: 'acct', label: 'l' }, { service: 'oth', account: 'b1', label: 'l' }],
    );
    return r.undeclared.length === 0;
  } catch {
    return false;
  }
};
const ref = formats.find(parses) ?? formats[0];

test('After a sweep rows are sorted by name and marked unresolvable, radius-undeclared or held with env exposure', () => {
  const secrets = { zeta: ref('svc', 'acct'), alpha: ref('svc', 'gone'), mid: ref('svc', 'b1') };
  const scope = { namespaces: ['svc'], radius: { zeta: 'repo', alpha: 'org' } };
  const observed = [
    { service: 'svc', account: 'acct', label: 'l1' },
    { service: 'svc', account: 'b1', label: 'l2' },
    { service: 'oth', account: 'gone', label: 'l3' },
  ];
  const r = assessCredentials({ secrets }, scope, observed, new Set(['zeta']));
  const alphaRow = { name: 'alpha', ref: secrets.alpha, state: 'unresolvable', radius: 'org' };
  assert.deepEqual(r, {
    rows: [
      alphaRow,
      { name: 'mid', ref: secrets.mid, state: 'radius-undeclared' },
      { name: 'zeta', ref: secrets.zeta, state: 'held', radius: 'repo', envExposed: true },
    ],
    undeclared: [],
    findings: [alphaRow],
    state: 'findings',
    swept: true,
    namespaceItems: 2,
  });
});

test('A sweep where every secret is held with a declared radius is ok', () => {
  const secrets = { a1: ref('svc', 'acct') };
  const observed = [{ service: 'svc', account: 'acct', label: 'l' }];
  const r = assessCredentials({ secrets }, { namespaces: ['svc'], radius: { a1: 'repo' } }, observed);
  assert.deepEqual(r, {
    rows: [{ name: 'a1', ref: secrets.a1, state: 'held', radius: 'repo' }],
    undeclared: [],
    findings: [],
    state: 'ok',
    swept: true,
    namespaceItems: 1,
  });
});

test('A sweep with a radius-undeclared row is partial and an empty radius counts as declared but is omitted', () => {
  const secrets = { c: ref('svc', 'acct'), b: ref('svc', 'b1') };
  const observed = [{ service: 'svc', account: 'acct', label: 'l1' }, { service: 'svc', account: 'b1', label: 'l2' }];
  const r = assessCredentials({ secrets }, { namespaces: ['svc'], radius: { c: '' } }, observed, new Set(['zz']));
  assert.deepEqual(r, {
    rows: [{ name: 'b', ref: secrets.b, state: 'radius-undeclared' }, { name: 'c', ref: secrets.c, state: 'held' }],
    undeclared: [],
    findings: [],
    state: 'partial',
    swept: true,
    namespaceItems: 2,
  });
});

test('Without a store sweep rows keep radius and env exposure and the result is partial with nothing undeclared', () => {
  const secrets = { k: ref('svc', 'acct'), j: ref('oth', 'b1') };
  const r = assessCredentials({ secrets }, { namespaces: ['svc'], radius: { k: 'repo' } }, null, new Set(['j']));
  assert.deepEqual(r.rows.map((x) => [x.name, x.ref, x.radius, x.envExposed]), [
    ['j', secrets.j, undefined, true],
    ['k', secrets.k, 'repo', undefined],
  ]);
  assert.deepEqual([r.undeclared, r.findings, r.state, r.swept, r.namespaceItems], [null, [], 'partial', false, null]);
});

test('An empty table without a sweep is partial with no rows and no namespace count', () => {
  const r = assessCredentials({ secrets: {} }, { namespaces: ['svc'], radius: {} }, null);
  assert.deepEqual(r, { rows: [], undeclared: null, findings: [], state: 'partial', swept: false, namespaceItems: null });
});

test('Undeclared items in the namespaces are sorted by account and become findings', () => {
  const secrets = { s1: ref('svc', 'acct') };
  const observed = [
    { service: 'svc', account: 'b1', label: 'l1' },
    { service: 'oth', account: 'a0', label: 'l2' },
    { service: 'svc', account: 'acct', label: 'l3' },
    { service: 'alt', account: 'a1', label: 'l4' },
  ];
  const r = assessCredentials({ secrets }, { namespaces: ['svc', 'alt'], radius: { s1: 'repo' } }, observed);
  const und = [
    { service: 'alt', account: 'a1', label: 'l4', state: 'undeclared' },
    { service: 'svc', account: 'b1', label: 'l1', state: 'undeclared' },
  ];
  assert.deepEqual(r, {
    rows: [{ name: 's1', ref: secrets.s1, state: 'held', radius: 'repo' }],
    undeclared: und,
    findings: und,
    state: 'findings',
    swept: true,
    namespaceItems: 3,
  });
});

test('Undeclared items with the same account keep their observed order', () => {
  const observed = [{ service: 'svc', account: 'mm', label: 'l1' }, { service: 'alt', account: 'mm', label: 'l2' }];
  const r = assessCredentials({ secrets: {} }, { namespaces: ['svc', 'alt'], radius: {} }, observed);
  const und = [
    { service: 'svc', account: 'mm', label: 'l1', state: 'undeclared' },
    { service: 'alt', account: 'mm', label: 'l2', state: 'undeclared' },
  ];
  assert.deepEqual(r, { rows: [], undeclared: und, findings: und, state: 'findings', swept: true, namespaceItems: 2 });
});

test('A sweep that finds only items outside the namespaces is ok with zero namespace items', () => {
  const observed = [{ service: 'oth', account: 'a0', label: 'l' }];
  const r = assessCredentials({ secrets: {} }, { namespaces: ['svc'], radius: {} }, observed);
  assert.deepEqual(r, { rows: [], undeclared: [], findings: [], state: 'ok', swept: true, namespaceItems: 0 });
});

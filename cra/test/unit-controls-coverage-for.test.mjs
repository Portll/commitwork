// Computes per-framework control rows for a product, marking each control evidenced or mapped (cra/controls.mjs coverageFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageFor } from '../controls.mjs';

test('reports a control as evidenced when the scanner for a mapped check ran', () => {
  const product = { id: 'p1', name: 'P1', version: '1.0', repos: ['r1'] };
  const controls = {
    frameworks: {
      cra: { name: 'CRA', items: { c1: 'Control One' } },
      soc2: { name: 'SOC2', controls: { c1: 'Control One' } },
      nist80053: { name: 'NIST', items: { c1: 'Control One' } },
    },
    checks: {
      check1: { category: 'maliciousPackages', cra: ['c1'], soc2: [], nist80053: [] },
    },
    evidenceSources: {
      'remediation-ledger': { cra: [], soc2: [], nist80053: [] },
      'annotations': { cra: [], soc2: [], nist80053: [] },
      'monitoring-program': { cra: [], soc2: [], nist80053: [] },
      'audit-records': { cra: [], soc2: [], nist80053: [] },
      'kev-epss': { cra: [], soc2: [], nist80053: [] },
    },
  };
  const rollup = { repos: [{ name: 'r1', scanners: { maliciousPackages: { ran: true } } }] };
  const res = coverageFor(product, controls, rollup, [], null, null);
  assert.equal(res.product.id, 'p1');
  assert.equal(res.frameworks.cra.rows[0].status, 'evidenced');
  assert.equal(res.frameworks.cra.rows[0].control, 'c1');
  assert.equal(res.frameworks.cra.rows[0].title, 'Control One');
  assert.deepEqual(res.frameworks.cra.rows[0].evidencingChecks, ['check1']);
  assert.deepEqual(res.frameworks.cra.rows[0].repos, ['r1']);
  assert.equal(res.frameworks.soc2.rows.length, 0);
  assert.equal(res.frameworks.nist80053.rows.length, 0);
});

test('returns mapped status when scanner ran is false', () => {
  const product = { id: 'p1', name: 'P1', version: '1.0', repos: ['r1'] };
  const controls = {
    frameworks: {
      cra: { name: 'CRA', items: { c1: 'Control One' } },
      soc2: { name: 'SOC2', controls: {} },
      nist80053: { name: 'NIST', items: {} },
    },
    checks: {
      check1: { category: 'maliciousPackages', cra: ['c1'], soc2: [], nist80053: [] },
    },
    evidenceSources: {
      'remediation-ledger': { cra: [], soc2: [], nist80053: [] },
      'annotations': { cra: [], soc2: [], nist80053: [] },
      'monitoring-program': { cra: [], soc2: [], nist80053: [] },
      'audit-records': { cra: [], soc2: [], nist80053: [] },
      'kev-epss': { cra: [], soc2: [], nist80053: [] },
    },
  };
  const rollup = { repos: [{ name: 'r1', scanners: { maliciousPackages: { ran: false } } }] };
  const res = coverageFor(product, controls, rollup, [], null, null);
  assert.equal(res.frameworks.cra.rows[0].status, 'mapped');
  assert.deepEqual(res.frameworks.cra.rows[0].evidencingChecks, []);
  assert.deepEqual(res.frameworks.cra.rows[0].repos, []);
});

test('returns mapped status when scanner is unparseable', () => {
  const product = { id: 'p1', name: 'P1', version: '1.0', repos: ['r1'] };
  const controls = {
    frameworks: {
      cra: { name: 'CRA', items: { c1: 'Control One' } },
      soc2: { name: 'SOC2', controls: {} },
      nist80053: { name: 'NIST', items: {} },
    },
    checks: {
      check1: { category: 'maliciousPackages', cra: ['c1'], soc2: [], nist80053: [] },
    },
    evidenceSources: {
      'remediation-ledger': { cra: [], soc2: [], nist80053: [] },
      'annotations': { cra: [], soc2: [], nist80053: [] },
      'monitoring-program': { cra: [], soc2: [], nist80053: [] },
      'audit-records': { cra: [], soc2: [], nist80053: [] },
      'kev-epss': { cra: [], soc2: [], nist80053: [] },
    },
  };
  const rollup = { repos: [{ name: 'r1', scanners: { maliciousPackages: { ran: true, unparseable: true } } }] };
  const res = coverageFor(product, controls, rollup, [], null, null);
  assert.equal(res.frameworks.cra.rows[0].status, 'mapped');
});

test('returns mapped status when scanner is nosrc', () => {
  const product = { id: 'p1', name: 'P1', version: '1.0', repos: ['r1'] };
  const controls = {
    frameworks: {
      cra: { name: 'CRA', items: { c1: 'Control One' } },
      soc2: { name: 'SOC2', controls: {} },
      nist80053: { name: 'NIST', items: {} },
    },
    checks: {
      check1: { category: 'maliciousPackages', cra: ['c1'], soc2: [], nist80053: [] },
    },
    evidenceSources: {
      'remediation-ledger': { cra: [], soc2: [], nist80053: [] },
      'annotations': { cra: [], soc2: [], nist80053: [] },
      'monitoring-program': { cra: [], soc2: [], nist80053: [] },
      'audit-records': { cra: [], soc2: [], nist80053: [] },
      'kev-epss': { cra: [], soc2: [], nist80053: [] },
    },
  };
  const rollup = { repos: [{ name: 'r1', scanners: { maliciousPackages: { ran: true, nosrc: true } } }] };
  const res = coverageFor(product, controls, rollup, [], null, null);
  assert.equal(res.frameworks.cra.rows[0].status, 'mapped');
});

test('returns mapped status when scanner is neverran', () => {
  const product = { id: 'p1', name: 'P1', version: '1.0', repos: ['r1'] };
  const controls = {
    frameworks: {
      cra: { name: 'CRA', items: { c1: 'Control One' } },
      soc2: { name: 'SOC2', controls: {} },
      nist80053: { name: 'NIST', items: {} },
    },
    checks: {
      check1: { category: 'maliciousPackages', cra: ['c1'], soc2: [], nist80053: [] },
    },
    evidenceSources: {
      'remediation-ledger': { cra: [], soc2: [], nist80053: [] },
      'annotations': { cra: [], soc2: [], nist80053: [] },
      'monitoring-program': { cra: [], soc2: [], nist80053: [] },
      'audit-records': { cra: [], soc2: [], nist80053: [] },
      'kev-epss': { cra: [], soc2: [], nist80053: [] },
    },
  };
  const rollup = { repos: [{ name: 'r1', scanners: { maliciousPackages: { ran: true, neverran: true } } }] };
  const res = coverageFor(product, controls, rollup, [], null, null);
  assert.equal(res.frameworks.cra.rows[0].status, 'mapped');
});

test('returns mapped status when scanner is toolfailed', () => {
  const product = { id: 'p1', name: 'P1', version: '1.0', repos: ['r1'] };
  const controls = {
    frameworks: {
      cra: { name: 'CRA', items: { c1: 'Control One' } },
      soc2: { name: 'SOC2', controls: {} },
      nist80053: { name: 'NIST', items: {} },
    },
    checks: {
      check1: { category: 'maliciousPackages', cra: ['c1'], soc2: [], nist80053: [] },
    },
    evidenceSources: {
      'remediation-ledger': { cra: [], soc2: [], nist80053: [] },
      'annotations': { cra: [], soc2: [], nist80053: [] },
      'monitoring-program': { cra: [], soc2: [], nist80053: [] },
      'audit-records': { cra: [], soc2: [], nist80053: [] },
      'kev-epss': { cra: [], soc2: [], nist80053: [] },
    },
  };
  const rollup = { repos: [{ name: 'r1', scanners: { maliciousPackages: { ran: true, toolfailed: true } } }] };
  const res = coverageFor(product, controls, rollup, [], null, null);
  assert.equal(res.frameworks.cra.rows[0].status, 'mapped');
});

test('returns mapped status when scanner is norules', () => {
  const product = { id: 'p1', name: 'P1', version: '1.0', repos: ['r1'] };
  const controls = {
    frameworks: {
      cra: { name: 'CRA', items: { c1: 'Control One' } },
      soc2: { name: 'SOC2', controls: {} },
      nist80053: { name: 'NIST', items: {} },
    },
    checks: {
      check1: { category: 'maliciousPackages', cra: ['c1'], soc2: [], nist80053: [] },
    },
    evidenceSources: {
      'remediation-ledger': { cra: [], soc2: [], nist80053: [] },
      'annotations': { cra: [], soc2: [], nist80053: [] },
      'monitoring-program': { cra: [], soc2: [], nist80053: [] },
      'audit-records': { cra: [], soc2: [], nist80053: [] },
      'kev-epss': { cra: [], soc2: [], nist80053: [] },
    },
  };
  const rollup = { repos: [{ name: 'r1', scanners: { maliciousPackages: { ran: true, norules: true } } }] };
  const res = coverageFor(product, controls, rollup, [], null, null);
  assert.equal(res.frameworks.cra.rows[0].status, 'mapped');
});

test('evidences control via remediation ledger entry', () => {
  const product = { id: 'p1', name: 'P1', version: '1.0', repos: ['r1'] };
  const controls = {
    frameworks: {
      cra: { name: 'CRA', items: { c1: 'Control One' } },
      soc2: { name: 'SOC2', controls: {} },
      nist80053: { name: 'NIST', items: {} },
    },
    checks: {
      check1: { category: 'maliciousPackages', cra: [], soc2: [], nist80053: [] },
    },
    evidenceSources: {
      'remediation-ledger': { cra: ['c1'], soc2: [], nist80053: [] },
      'annotations': { cra: [], soc2: [], nist80053: [] },
      'monitoring-program': { cra: [], soc2: [], nist80053: [] },
      'audit-records': { cra: [], soc2: [], nist80053: [] },
      'kev-epss': { cra: [], soc2: [], nist80053: [] },
    },
  };
  const rollup = { repos: [] };
  const ledgerEntries = [{ repo: 'r1', evidence: { tier: 'strong' } }];
  const res = coverageFor(product, controls, rollup, ledgerEntries, null, null);
  assert.equal(res.frameworks.cra.rows[0].status, 'evidenced');
  assert.deepEqual(res.frameworks.cra.rows[0].evidencingSources, ['remediation-ledger']);
  assert.deepEqual(res.frameworks.cra.rows[0].evidencingChecks, []);
});

test('evidences control via annotation', () => {
  const product = { id: 'p1', name: 'P1', version: '1.0', repos: ['r1'] };
  const controls = {
    frameworks: {
      cra: { name: 'CRA', items: { c1: 'Control One' } },
      soc2: { name: 'SOC2', controls: {} },
      nist80053: { name: 'NIST', items: {} },
    },
    checks: {
      check1: { category: 'maliciousPackages', cra: [], soc2: [], nist80053: [] },
    },
    evidenceSources: {
      'remediation-ledger': { cra: [], soc2: [], nist80053: [] },
      'annotations': { cra: ['c1'], soc2: [], nist80053: [] },
      'monitoring-program': { cra: [], soc2: [], nist80053: [] },
      'audit-records': { cra: [], soc2: [], nist80053: [] },
      'kev-epss': { cra: [], soc2: [], nist80053: [] },
    },
  };
  const rollup = { repos: [] };
  const annDoc = { annotations: [{ repo: 'r1', text: 'note' }] };
  const res = coverageFor(product, controls, rollup, [], annDoc, null);
  assert.equal(res.frameworks.cra.rows[0].status, 'evidenced');
  assert.deepEqual(res.frameworks.cra.rows[0].evidencingSources, ['annotations']);
});

test('evidences control via monitoring program when slice covers product', () => {
  const product = { id: 'p1', name: 'P1', version: '1.0', repos: ['r1'] };
  const controls = {
    frameworks: {
      cra: { name: 'CRA', items: { c1: 'Control One' } },
      soc2: { name: 'SOC2', controls: {} },
      nist80053: { name: 'NIST', items: {} },
    },
    checks: {
      check1: { category: 'maliciousPackages', cra: [], soc2: [], nist80053: [] },
    },
    evidenceSources: {
      'remediation-ledger': { cra: [], soc2: [], nist80053: [] },
      'annotations': { cra: [], soc2: [], nist80053: [] },
      'monitoring-program': { cra: ['c1'], soc2: [], nist80053: [] },
      'audit-records': { cra: [], soc2: [], nist80053: [] },
      'kev-epss': { cra: [], soc2: [], nist80053: [] },
    },
  };
  const rollup = { repos: [{ name: 'r1', scanners: {} }] };
  const res = coverageFor(product, controls, rollup, [], null, null);
  assert.equal(res.frameworks.cra.rows[0].status, 'evidenced');
  assert.deepEqual(res.frameworks.cra.rows[0].evidencingSources, ['monitoring-program']);
});

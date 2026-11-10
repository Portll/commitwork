// Generates a CRA documentation pack with vulnerability handling, CVD policy, remediation log and index (cra/pack.mjs buildPack).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPack } from '../pack.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'buildPack-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('produces empty checks table when baseline has no checks', () => {
  withTempDir(dir => {
    const product = { id: 'p', name: 'Prod', version: '1.0', repos: [] };
    const manufacturer = { name: 'Man', contact: 'contact@man' };
    const baseline = { checks: [] };
    const ledgerEntries = [];
    const paths = { out: join(dir, 'out'), ledger: join(dir, 'ledger.json') };
    writeFileSync(paths.ledger, '');
    const pack = buildPack(product, manufacturer, baseline, ledgerEntries, paths, '2026-10-21T00:00Z');
    assert.ok(pack['vulnerability-handling.md'].includes('| Check | What it does | Groups |'));
    assert.ok(!pack['vulnerability-handling.md'].includes('| c1 |'));
    assert.ok(pack['vulnerability-handling.md'].includes('manifest(s) **security-baseline**'));
  });
});

test('uses provided manifestIds for manifest label', () => {
  withTempDir(dir => {
    const product = { id: 'p', name: 'Prod', version: '1.0', repos: [] };
    const manufacturer = { name: 'Man', contact: 'c@man' };
    const baseline = { checks: [], manifestIds: ['m1', 'm2'] };
    const ledgerEntries = [];
    const paths = { out: join(dir, 'out'), ledger: join(dir, 'ledger.json') };
    writeFileSync(paths.ledger, '');
    const pack = buildPack(product, manufacturer, baseline, ledgerEntries, paths, 'now');
    assert.ok(pack['vulnerability-handling.md'].includes('manifest(s) **m1, m2**'));
  });
});

test('includes verified fixes stats and remediation rows when ledger has strong/medium entries', () => {
  withTempDir(dir => {
    const product = { id: 'p', name: 'Prod', version: '1.0', repos: ['r1'] };
    const manufacturer = { name: 'Man', contact: 'c@man' };
    const baseline = { checks: [{ id: 'c1' }], manifestIds: [] };
    const ledgerEntries = [
      { repo: 'r1', evidence: { tier: 'strong' }, bornSlice: 'sweep-20230101000000', resolvedSlice: 'sweep-20230105000000', vulnId: 'V1', package: 'pkg', fromVersion: '1.0', toVersion: '1.1' },
      { repo: 'r1', evidence: { tier: 'medium' }, bornSlice: 'sweep-20230201000000', resolvedSlice: 'sweep-20230202000000', vulnId: 'V2' }
    ];
    const paths = { out: join(dir, 'out'), ledger: join(dir, 'ledger.json') };
    writeFileSync(paths.ledger, '');
    const pack = buildPack(product, manufacturer, baseline, ledgerEntries, paths, 'now');
    const vh = pack['vulnerability-handling.md'];
    assert.ok(vh.includes('Verified fixes for this product to date: **2**'));
    assert.ok(vh.includes('mean time-to-remediate'));
    const rem = pack['remediation-log.md'];
    assert.ok(rem.includes('| V1 | r1 | pkg | 1.0 \u2192 1.1 | strong | sweep-20230105000000 |'));
    assert.ok(rem.includes('| V2 | r1 |  | ? \u2192 ? | medium | sweep-20230202000000 |'));
  });
});

test('shows no verified fixes message and empty remediation table when no strong/medium entries', () => {
  withTempDir(dir => {
    const product = { id: 'p', name: 'Prod', version: '1.0', repos: ['r1'] };
    const manufacturer = { name: 'Man', contact: 'c@man' };
    const baseline = { checks: [{ id: 'c1' }], manifestIds: [] };
    const ledgerEntries = [{ repo: 'r1', evidence: { tier: 'weak' } }];
    const paths = { out: join(dir, 'out'), ledger: join(dir, 'ledger.json') };
    writeFileSync(paths.ledger, '');
    const pack = buildPack(product, manufacturer, baseline, ledgerEntries, paths, 'now');
    const vh = pack['vulnerability-handling.md'];
    assert.ok(vh.includes('No verified fixes recorded for this product yet.'));
    const rem = pack['remediation-log.md'];
    assert.ok(rem.includes('| _none yet_ |'));
  });
});

test('sbom row status switches between generated and run command depending on file existence', () => {
  withTempDir(dir => {
    const product = { id: 'p', name: 'Prod', version: '1.0', repos: [] };
    const manufacturer = { name: 'Man', contact: 'c@man' };
    const baseline = { checks: [] };
    const ledgerEntries = [];
    const outPath = join(dir, 'out');
    const sbomPath = join(outPath, 'sbom', `${product.id}-${product.version}.cdx.json`);
    const paths = { out: outPath, ledger: join(dir, 'ledger.json') };
    writeFileSync(paths.ledger, '');
    let pack = buildPack(product, manufacturer, baseline, ledgerEntries, paths, 'now');
    assert.ok(pack['index.md'].includes('| (1) Identify & document vulnerabilities and components (SBOM) | vulnerability-handling.md \u00b7 sbom/p-1.0.cdx.json \u00b7 vex/p.{vex.cdx,vex.csaf,openvex}.json | run cra/sbom.mjs |'));
    mkdirSync(join(outPath, 'sbom'), { recursive: true });
    writeFileSync(sbomPath, '{}');
    pack = buildPack(product, manufacturer, baseline, ledgerEntries, paths, 'now');
    assert.ok(pack['index.md'].includes('| (1) Identify & document vulnerabilities and components (SBOM) | vulnerability-handling.md \u00b7 sbom/p-1.0.cdx.json \u00b7 vex/p.{vex.cdx,vex.csaf,openvex}.json | generated |'));
  });
});

test('index reflects EU market flag and category correctly', () => {
  withTempDir(dir => {
    const product = { id: 'p', name: 'Prod', version: '1.0', repos: [], market: { category: 'cat' } };
    const manufacturer = { name: 'Man', contact: 'c@man' };
    const baseline = { checks: [] };
    const ledgerEntries = [];
    const paths = { out: join(dir, 'out'), ledger: join(dir, 'ledger.json') };
    writeFileSync(paths.ledger, '');
    const pack = buildPack(product, manufacturer, baseline, ledgerEntries, paths, 'now');
    const idx = pack['index.md'];
    assert.ok(idx.includes('EU market: no (flip market.eu in the product registry when placed on the EU market)'));
    assert.ok(idx.includes('category: cat'));
  });
});

test('vulnerability-handling.md contains correct Annex I Part II section headers and case path', () => {
  withTempDir(dir => {
    const product = { id: 'p', name: 'Prod', version: '1.0', repos: [], supportEndsAt: '2027-01-01' };
    const manufacturer = { name: 'Man', contact: 'c@man' };
    const baseline = { checks: [] };
    const ledgerEntries = [];
    const paths = { out: join(dir, 'out'), ledger: join(dir, 'ledger.json') };
    writeFileSync(paths.ledger, '');
    const pack = buildPack(product, manufacturer, baseline, ledgerEntries, paths, 'now');
    const vh = pack['vulnerability-handling.md'];
    assert.ok(vh.includes('## Continuous identification (Annex I Part II (1), (3))'));
    assert.ok(vh.includes('## Components documented (Annex I Part II (1))'));
    assert.ok(vh.includes('reports/cra/cases/<caseId>/'));
    assert.ok(vh.includes('until 2027-01-01'));
  });
});

test('advisories.md uses advisoriesUrl when provided, otherwise fallback text', () => {
  withTempDir(dir => {
    const product = { id: 'p', name: 'Prod', version: '1.0', repos: [], advisoriesUrl: 'https://adv.example' };
    const manufacturer = { name: 'Man', contact: 'c@man' };
    const baseline = { checks: [] };
    const ledgerEntries = [];
    const paths = { out: join(dir, 'out'), ledger: join(dir, 'ledger.json') };
    writeFileSync(paths.ledger, '');
    const pack = buildPack(product, manufacturer, baseline, ledgerEntries, paths, 'now');
    assert.ok(pack['advisories.md'].includes('index into https://adv.example'));
  });
});

test('index.md contains correct requirement numbers and contact fallback', () => {
  withTempDir(dir => {
    const product = { id: 'p', name: 'Prod', version: '1.0', repos: [] };
    const manufacturer = { name: 'Man' };
    const baseline = { checks: [] };
    const ledgerEntries = [];
    const paths = { out: join(dir, 'out'), ledger: join(dir, 'ledger.json') };
    writeFileSync(paths.ledger, '');
    const pack = buildPack(product, manufacturer, baseline, ledgerEntries, paths, 'now');
    const idx = pack['index.md'];
    assert.ok(idx.includes('| (3) Effective & regular tests and reviews |'));
    assert.ok(idx.includes('| (6) Measures to facilitate vulnerability reports | cvd-policy.md (contact: TODO) |'));
    assert.ok(idx.includes('| (8) Free, timely security updates + advisories |'));
  });
});

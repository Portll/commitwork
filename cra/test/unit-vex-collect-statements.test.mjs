// Worst-state VEX statements per vuln id from open findings and verified ledger fixes (cra/vex.mjs collectStatements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectStatements } from '../vex.mjs';

const AT = '2024-06-01T00:00:00.000Z';
const BORN = '2024-05-01T00:00:00.000Z';
const LATER = '2024-06-01T00:00:00.001Z';
const P = { repos: ['repo-a'] };
const NONE = { annotations: [] };
const roll = (findings, extra = { sliceId: 's1' }) => {
  const repos = [];
  for (const name of new Set(findings.map((f) => f.repo))) {
    const fs = findings.filter((f) => f.repo === name);
    const r = Object.assign([...fs], { repo: name, name, findings: fs, open: fs, vulns: fs });
    repos.push(r);
    repos[name] = r;
  }
  return { ...extra, findings, open: findings, vulns: findings, repos, byRepo: repos };
};
const fin = (o = {}) => ({ id: 'cve-2024-0001', repo: 'repo-a', package: 'lodash', version: '4.17.20', state: 'persisting', status: 'open', open: true, ...o });
const aff = (ref, repo, pkg, version) => ({ ref, repo, package: pkg, version });
const LODASH = aff('repo-a/lodash@4.17.20', 'repo-a', 'lodash', '4.17.20');
const st = (o = {}) => ({
  vulnId: 'CVE-2024-0001', state: 'exploitable', origin: 'finding', decision: null, reason: null, advisory: null,
  cvss: null, severity: null, affects: [LODASH], detail: 'open in slice s1 (state: persisting; KEV=false; EPSS=unknown)',
  firstIssued: AT, lastUpdated: AT, ...o,
});
const led = (o = {}) => ({
  vulnId: 'cve-2024-0002', repo: 'repo-a', package: 'openssl', fromVersion: '3.0.1', toVersion: '3.0.2',
  evidence: { tier: 'strong', detail: 'lockfile bump' }, bornSlice: 's0', resolvedSlice: 's1', at: BORN, ...o,
});
const res = (o = {}) => ({
  vulnId: 'CVE-2024-0002', state: 'resolved', origin: 'ledger', decision: null, reason: null, advisory: null,
  cvss: null, severity: null, affects: [aff('repo-a/openssl@3.0.2', 'repo-a', 'openssl', '3.0.2')],
  detail: 'verified remediation (strong): openssl 3.0.1 \u2192 3.0.2 \u2014 lockfile bump [ledger s0 \u2192 s1]',
  firstIssued: BORN, lastUpdated: BORN, ...o,
});

test('strong or medium ledger fixes in product repos become resolved statements and all other entries are dropped', () => {
  const ledger = [
    led({ fixCommit: 'abc1234' }),
    led({ vulnId: 'cve-2024-0003', repo: 'repo-b' }),
    led({ vulnId: 'cve-2024-0004', evidence: { tier: 'weak', detail: 'guess' } }),
    led({ vulnId: 'cve-2024-0005', evidence: undefined }),
    led({ vulnId: undefined }),
    led({ vulnId: 'cve-2024-0006', fromVersion: undefined, toVersion: undefined, at: undefined, evidence: { tier: 'medium', detail: 'tag diff' } }),
  ];
  assert.deepEqual(collectStatements(P, roll([]), ledger, NONE, AT), [
    res({ detail: 'verified remediation (strong): openssl 3.0.1 \u2192 3.0.2 \u2014 lockfile bump (commit abc1234) [ledger s0 \u2192 s1]' }),
    res({
      vulnId: 'CVE-2024-0006', affects: [aff('repo-a/openssl', 'repo-a', 'openssl', null)],
      detail: 'verified remediation (medium): openssl ? \u2192 ? \u2014 tag diff [ledger s0 \u2192 s1]', firstIssued: AT, lastUpdated: AT,
    }),
  ]);
});

test('ledger fixes for the same vuln merge their components without repeating a ref', () => {
  const ledger = [
    led({ vulnId: 'cve-2024-0005', package: 'zlib', fromVersion: '1.2.13', toVersion: '1.3.1' }),
    led({ vulnId: 'CVE-2024-0005', package: 'libpng', fromVersion: '1.6.40', toVersion: '1.6.43', evidence: { tier: 'medium', detail: 'rebuild' } }),
    led({ vulnId: 'cve-2024-0005', package: 'zlib', fromVersion: '1.2.13', toVersion: '1.3.1', fixCommit: 'ffff' }),
  ];
  assert.deepEqual(collectStatements(P, roll([]), ledger, NONE, AT), [res({
    vulnId: 'CVE-2024-0005',
    affects: [aff('repo-a/zlib@1.3.1', 'repo-a', 'zlib', '1.3.1'), aff('repo-a/libpng@1.6.43', 'repo-a', 'libpng', '1.6.43')],
    detail: 'verified remediation (strong): zlib 1.2.13 \u2192 1.3.1 \u2014 lockfile bump [ledger s0 \u2192 s1]',
  })]);
});

test('a product without repos or with other repos yields no statements', () => {
  assert.deepEqual(collectStatements({}, roll([fin()]), [led()], {}, AT), []);
  assert.deepEqual(collectStatements({ repos: ['repo-z'] }, roll([fin()]), [led()], NONE, AT), []);
});

test('open findings in product repos are exploitable and keep cvss, version and slice detail', () => {
  const findings = [
    fin({ cvss: 7.5, severity: 'high', advisory: 'GHSA-aaaa-bbbb-cccc', kev: true, epss: 0.42 }),
    fin({ id: 'cve-2024-0007', package: undefined, version: undefined, cvss: '9.8', epss: '0.9' }),
    fin({ id: 'cve-2024-0008', version: undefined, state: 'new', kev: 'yes' }),
    fin({ id: 'cve-2024-0009', repo: 'repo-b', cvss: 4 }),
    fin({ id: '' }),
  ];
  assert.deepEqual(collectStatements(P, roll(findings), [], NONE, AT), [
    st({ advisory: 'GHSA-aaaa-bbbb-cccc', cvss: 7.5, severity: 'high', detail: 'open in slice s1 (state: persisting; KEV=true; EPSS=0.42)' }),
    st({ vulnId: 'CVE-2024-0007', affects: [aff('repo-a', 'repo-a', null, null)] }),
    st({ vulnId: 'CVE-2024-0008', affects: [aff('repo-a/lodash', 'repo-a', 'lodash', null)], detail: 'open in slice s1 (state: new; KEV=false; EPSS=unknown)' }),
  ]);
});

test('carried findings are in triage and the slice name falls back to the generated stamp', () => {
  const findings = [fin({ carried: true }), fin({ id: 'cve-2024-0010', state: 'new', carried: false })];
  const slice = 'open in slice 2024-06-01T00:00:00Z';
  assert.deepEqual(collectStatements(P, roll(findings, { generated: '2024-06-01T00:00:00Z' }), [], NONE, AT), [
    st({ state: 'in_triage', detail: `${slice} (state: persisting; KEV=false; EPSS=unknown)` }),
    st({ vulnId: 'CVE-2024-0010', detail: `${slice} (state: new; KEV=false; EPSS=unknown)` }),
  ]);
});

test('an active matching annotation sets the state, decision and reason of a finding', () => {
  const findings = [fin({ cvss: 5 }), fin({ id: 'cve-2024-0011', package: 'express', version: '4.18.0' })];
  const annDoc = { annotations: [
    { id: 'cve-2024-0001', package: 'lodash', repo: 'repo-a', action: 'false-positive', reason: 'not reachable', who: 'sam', at: BORN },
    { id: 'cve-2024-0011', package: 'koa', action: 'accept', reason: 'other package' },
  ] };
  assert.deepEqual(collectStatements(P, roll(findings), [], annDoc, AT), [
    st({ state: 'false_positive', decision: 'false-positive', reason: 'not reachable', cvss: 5, detail: `annotation false-positive by sam at ${BORN}: not reachable` }),
    st({ vulnId: 'CVE-2024-0011', affects: [aff('repo-a/express@4.18.0', 'repo-a', 'express', '4.18.0')] }),
  ]);
});

test('annotations apply from their at time until their expiry and actions without a state are skipped', () => {
  const ids = ['cve-2024-0001', 'cve-2024-0012', 'cve-2024-0013', 'cve-2024-0014'];
  const annDoc = { annotations: [
    { id: ids[0], action: 'accept', expires: AT },
    { id: ids[1], action: 'wont-fix', at: AT },
    { id: ids[2], action: 'accept', reason: 'later', at: LATER },
    { id: ids[3], action: 'note', reason: 'fyi' },
    { id: ids[3], action: 'accept', who: 'kim', expires: LATER },
  ] };
  assert.deepEqual(collectStatements(P, roll(ids.map((id) => fin({ id }))), [], annDoc, AT), [
    st(),
    st({ vulnId: 'CVE-2024-0012', state: 'accepted', decision: 'wont-fix', detail: `annotation wont-fix by unknown at ${AT}:` }),
    st({ vulnId: 'CVE-2024-0013' }),
    st({ vulnId: 'CVE-2024-0014', state: 'accepted', decision: 'accept', detail: 'annotation accept by kim at unknown:' }),
  ]);
});

test('a worse state replaces a milder one, an equal state adds new refs and a milder one is ignored', () => {
  const findings = [
    fin({ carried: true }),
    fin({ package: 'qs', version: '6.5.0' }),
    fin({ package: 'qs', version: '6.5.0' }),
    fin({ package: 'ms', version: '2.0.0', carried: true }),
    fin(),
  ];
  const ledger = [led({ vulnId: 'cve-2024-0001', package: 'qs', toVersion: '6.5.3' })];
  assert.deepEqual(collectStatements(P, roll(findings), ledger, NONE, AT), [
    st({ affects: [aff('repo-a/qs@6.5.0', 'repo-a', 'qs', '6.5.0'), LODASH] }),
  ]);
});

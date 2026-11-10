// Slim stored row for one vulnerability match: publish decision, severity or original claim, kev, epss, joined fix (monitor/update-vulns.mjs slimRow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slimRow } from '../update-vulns.mjs';

const ID = 'CVE-2024-0001';

function match(over) {
  return {
    id: ID,
    severity: 'High',
    namespace: 'github:language:javascript',
    dataSource: 'https://github.com/advisories/GHSA-0000-0000-0000',
    component: 'left-pad',
    componentVersion: '1.0.0',
    type: 'npm',
    matchTypes: ['exact-direct-match'],
    matchDetails: [],
    cvss: [],
    urls: [],
    aliases: [],
    relatedVulnerabilities: [],
    locations: [],
    fixVersions: [],
    ...over,
  };
}

function ctx() {
  return { kevSet: new Set(), epss: new Map() };
}

function expectedKeys(publish) {
  return ['id', 'component', 'componentVersion', 'publish', publish === 'severity' ? 'severity' : 'originalClaim', 'kev', 'epss', 'fix'];
}

test('No recorded fix versions give a null fix', () => {
  const input = match({ fixVersions: [] });
  const result = slimRow(input, ctx());
  assert.equal(result.fix, null);
});

test('A single fix version is stored as that version', () => {
  const input = match({ fixVersions: ['1.0.1'] });
  const result = slimRow(input, ctx());
  assert.equal(result.fix, '1.0.1');
});

test('Several fix versions are joined with a pipe in order', () => {
  const input = match({ fixVersions: Array.from({ length: 3 }, (_, i) => `1.${i + 1}.0`) });
  const result = slimRow(input, ctx());
  assert.equal(result.fix, '1.1.0|1.2.0|1.3.0');
});

test('A github advisory row carries severity exactly when it is published by severity', () => {
  const input = match({ fixVersions: ['1.0.1'] });
  const result = slimRow(input, ctx());
  assert.deepEqual(
    [Object.hasOwn(result, 'severity'), Object.hasOwn(result, 'originalClaim')],
    [result.publish === 'severity', result.publish !== 'severity'],
  );
});

test('An nvd cpe row carries the original claim exactly when it is not published by severity', () => {
  const input = match({ namespace: 'nvd:cpe', dataSource: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0001', matchTypes: ['cpe-match'] });
  const result = slimRow(input, ctx());
  assert.deepEqual(
    [Object.hasOwn(result, 'originalClaim'), Object.hasOwn(result, 'severity')],
    [result.publish !== 'severity', result.publish === 'severity'],
  );
});

test('The row keys follow the publish decision in a fixed order', () => {
  const input = match({ namespace: 'nvd:cpe', matchTypes: ['cpe-match'], fixVersions: ['2.0.0', '2.1.0'] });
  const context = { kevSet: new Set([ID]), epss: new Map([[ID, 0.42]]) };
  const result = slimRow(input, context);
  assert.deepEqual(Object.keys(result), expectedKeys(result.publish));
});

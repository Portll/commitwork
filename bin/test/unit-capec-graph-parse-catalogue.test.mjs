// Maps CAPEC XML attack patterns into a graph with CWE and ATT&CK links (bin/capec-graph.mjs parseCatalogue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogue } from '../capec-graph.mjs';

test('returns empty structures when no attack patterns are present', () => {
  const r = parseCatalogue('<root></root>');
  assert.deepEqual(r, { patterns: {}, byCwe: {}, dropped: { deprecated: 0 } });
});

test('drops patterns whose status is Deprecated or Obsolete', () => {
  const xml = [
    '<Attack_Pattern ID="100" Name="A" Status="Deprecated" Abstraction="L1"></Attack_Pattern>',
    '<Attack_Pattern ID="101" Name="B" Status="Obsolete" Abstraction="L1"></Attack_Pattern>',
    '<Attack_Pattern ID="102" Name="C" Status="Active" Abstraction="L1"></Attack_Pattern>',
  ].join('');
  const r = parseCatalogue(xml);
  assert.equal(r.dropped.deprecated, 2);
  assert.equal(Object.keys(r.patterns).length, 1);
  assert.deepEqual(r.patterns['102'], { name: 'C', abstraction: 'L1', status: 'Active' });
});

test('extracts CWE ids from Related_Weakness elements and builds byCwe index', () => {
  const xml = [
    '<Attack_Pattern ID="200" Name="X" Status="Active" Abstraction="L1">',
    '<Related_Weakness CWE_ID="79"></Related_Weakness>',
    '<Related_Weakness CWE_ID="89"></Related_Weakness>',
    '</Attack_Pattern>',
  ].join('');
  const r = parseCatalogue(xml);
  assert.deepEqual(r.patterns['200'].cwe, ['79', '89']);
  assert.deepEqual(r.byCwe, { '79': ['200'], '89': ['200'] });
});

test('extracts ATT&CK technique ids from Taxonomy_Mapping and prefixes with T', () => {
  const xml = [
    '<Attack_Pattern ID="300" Name="Y" Status="Active" Abstraction="L1">',
    '<Taxonomy_Mapping Taxonomy_Name="ATTACK"><Entry_ID>1499</Entry_ID><Entry_ID>1542.002</Entry_ID></Taxonomy_Mapping>',
    '</Attack_Pattern>',
  ].join('');
  const r = parseCatalogue(xml);
  assert.deepEqual(r.patterns['300'].attack, ['T1499', 'T1542.002']);
});

test('ignores Taxonomy_Mapping entries that are not numeric technique ids', () => {
  const xml = [
    '<Attack_Pattern ID="400" Name="Z" Status="Active" Abstraction="L1">',
    '<Taxonomy_Mapping Taxonomy_Name="ATTACK"><Entry_ID>T1499</Entry_ID><Entry_ID>abc</Entry_ID><Entry_ID>1542.002</Entry_ID></Taxonomy_Mapping>',
    '</Attack_Pattern>',
  ].join('');
  const r = parseCatalogue(xml);
  assert.deepEqual(r.patterns['400'].attack, ['T1542.002']);
});

test('deduplicates CWE ids and sorts byCwe keys numerically', () => {
  const xml = [
    '<Attack_Pattern ID="500" Name="P" Status="Active" Abstraction="L1">',
    '<Related_Weakness CWE_ID="99"></Related_Weakness>',
    '<Related_Weakness CWE_ID="99"></Related_Weakness>',
    '<Related_Weakness CWE_ID="10"></Related_Weakness>',
    '</Attack_Pattern>',
  ].join('');
  const r = parseCatalogue(xml);
  assert.deepEqual(r.patterns['500'].cwe, ['10', '99']);
  assert.deepEqual(r.byCwe, { '10': ['500'], '99': ['500'] });
});

test('handles multiple patterns and indexes each under its CWEs', () => {
  const xml = [
    '<Attack_Pattern ID="600" Name="M" Status="Active" Abstraction="L1">',
    '<Related_Weakness CWE_ID="5"></Related_Weakness>',
    '</Attack_Pattern>',
    '<Attack_Pattern ID="601" Name="N" Status="Active" Abstraction="L1">',
    '<Related_Weakness CWE_ID="5"></Related_Weakness>',
    '<Related_Weakness CWE_ID="6"></Related_Weakness>',
    '</Attack_Pattern>',
  ].join('');
  const r = parseCatalogue(xml);
  assert.deepEqual(r.byCwe, { '5': ['600', '601'], '6': ['601'] });
  assert.equal(r.patterns['600'].cwe[0], '5');
  assert.deepEqual(r.patterns['601'].cwe, ['5', '6']);
});

test('omits cwe and attack keys when no related weaknesses or mappings exist', () => {
  const xml = '<Attack_Pattern ID="700" Name="Solo" Status="Active" Abstraction="L2"></Attack_Pattern>';
  const r = parseCatalogue(xml);
  assert.deepEqual(r.patterns['700'], { name: 'Solo', abstraction: 'L2', status: 'Active' });
  assert.equal('cwe' in r.patterns['700'], false);
  assert.equal('attack' in r.patterns['700'], false);
});

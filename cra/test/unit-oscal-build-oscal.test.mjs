// Builds an OSCAL component-definition document from coverage and controls metadata (cra/oscal.mjs buildOscal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOscal } from '../oscal.mjs';

const baseCov = {
  product: { id: 'p1', name: 'P1', version: '1.0.0' },
  frameworks: {
    nist80053: {
      scope: 'nist-scope',
      mapped: 1, catalog: 10, baselineModerate: 5, evidenced: 1,
      rows: [{ control: 'AC-1', title: 'Access Control', status: 'evidenced', evidencingChecks: ['c1'], evidencingSources: [], repos: ['r1'], mappingChecks: [] }]
    },
    soc2: {
      mapped: 1, evidenced: 1,
      rows: [{ control: 'CC1.1', title: 'CC1.1 Title', status: 'evidenced', evidencingChecks: ['c2'], evidencingSources: [], repos: [], mappingChecks: [] }]
    }
  }
};

const baseControls = {
  frameworks: {
    soc2: {
      catalogSource: 'https://example.com/soc2',
      controls: { 'CC1.1': 'CC1.1 Desc' }
    }
  }
};

test('throws when soc2 catalogSource is missing', () => {
  const badControls = { frameworks: { soc2: { controls: {} } } };
  assert.throws(() => buildOscal(baseCov, badControls, '2024-01-01T00:00:00Z'), {
    name: 'Error',
    message: 'controls.json frameworks.soc2.catalogSource is missing; an OSCAL control-implementation requires a source'
  });
});

test('does not throw when soc2 catalogSource is present', () => {
  const result = buildOscal(baseCov, baseControls, '2024-01-01T00:00:00Z');
  assert.equal(result['component-definition'].metadata['last-modified'], '2024-01-01T00:00:00Z');
});

test('socIds includes controls from socMeta.controls and extra rows from socRows', () => {
  const cov = {
    product: { id: 'p1', name: 'P1', version: '1.0.0' },
    frameworks: {
      nist80053: { scope: '', mapped: 0, catalog: 10, baselineModerate: 5, evidenced: 0, rows: [] },
      soc2: {
        mapped: 2, evidenced: 1,
        rows: [
          { control: 'CC1.1', title: 'CC1.1 Title', status: 'evidenced', evidencingChecks: ['c2'], evidencingSources: [], repos: [], mappingChecks: [] },
          { control: 'CC9.9', title: 'Extra Title', status: 'mapped', evidencingChecks: [], evidencingSources: [], repos: [], mappingChecks: ['mc1'] }
        ]
      }
    }
  };
  const controls = {
    frameworks: {
      soc2: {
        catalogSource: 'https://example.com/soc2',
        controls: { 'CC1.1': 'CC1.1 Desc', 'CC2.2': 'CC2.2 Desc' }
      }
    }
  };
  const result = buildOscal(cov, controls, '2024-01-01T00:00:00Z');
  const socImpl = result['component-definition'].components[0]['control-implementations'][1];
  const ids = socImpl['implemented-requirements'].map(r => r['control-id']).sort();
  assert.deepEqual(ids, ['cc1.1', 'cc2.2', 'cc9.9']);
});

test('requirement title falls back to controls title then row title then id', () => {
  const cov = {
    product: { id: 'p1', name: 'P1', version: '1.0.0' },
    frameworks: {
      nist80053: { scope: '', mapped: 0, catalog: 10, baselineModerate: 5, evidenced: 0, rows: [] },
      soc2: {
        mapped: 3, evidenced: 0,
        rows: [
          { control: 'CC1.1', title: 'Row Title 1', status: 'mapped', evidencingChecks: [], evidencingSources: [], repos: [], mappingChecks: [] },
          { control: 'CC2.2', status: 'mapped', evidencingChecks: [], evidencingSources: [], repos: [], mappingChecks: [] },
          { control: 'CC3.3', status: 'mapped', evidencingChecks: [], evidencingSources: [], repos: [], mappingChecks: [] }
        ]
      }
    }
  };
  const controls = {
    frameworks: {
      soc2: {
        catalogSource: 'https://example.com/soc2',
        controls: { 'CC1.1': 'Controls Title 1', 'CC3.3': '' }
      }
    }
  };
  const result = buildOscal(cov, controls, '2024-01-01T00:00:00Z');
  const socImpl = result['component-definition'].components[0]['control-implementations'][1];
  const reqs = socImpl['implemented-requirements'];
  const titles = reqs.map(r => r.description.split('.')[0]).sort();
  assert.deepEqual(titles, ["CC2", "CC3", "Controls Title 1"]);
});

test('socNotEvidenced counts requirements with evidence-status not-evidenced', () => {
  const cov = {
    product: { id: 'p1', name: 'P1', version: '1.0.0' },
    frameworks: {
      nist80053: { scope: '', mapped: 0, catalog: 10, baselineModerate: 5, evidenced: 0, rows: [] },
      soc2: {
        mapped: 2, evidenced: 1,
        rows: [
          { control: 'CC1.1', title: 'Evidenced', status: 'evidenced', evidencingChecks: ['c1'], evidencingSources: [], repos: [], mappingChecks: [] },
          { control: 'CC2.2', title: 'Not Evidenced', status: 'mapped', evidencingChecks: [], evidencingSources: [], repos: [], mappingChecks: ['mc1'] }
        ]
      }
    }
  };
  const controls = {
    frameworks: {
      soc2: {
        catalogSource: 'https://example.com/soc2',
        controls: {}
      }
    }
  };
  const result = buildOscal(cov, controls, '2024-01-01T00:00:00Z');
  const socImpl = result['component-definition'].components[0]['control-implementations'][1];
  const notEvidenced = socImpl['implemented-requirements'].filter(r => r.props.find(p => p.name === 'evidence-status').value === 'not-evidenced').length;
  assert.equal(notEvidenced, 0);
  const desc = socImpl.description;
  assert.equal(desc.includes('1 have no supplying check or evidence source (not evidenced)'), false);
});

test('remarks mentions Rev 5 and SOC 2', () => {
  const result = buildOscal(baseCov, baseControls, '2024-01-01T00:00:00Z');
  const remarks = result['component-definition'].metadata.remarks;
  assert.equal(remarks.includes('NIST SP 800-53 Rev 5'), true);
  assert.equal(remarks.includes('SOC 2 Trust Services Criteria'), true);
});

test('component props scope uses nist.scope when defined and empty string when undefined', () => {
  const covWithScope = JSON.parse(JSON.stringify(baseCov));
  const covWithoutScope = JSON.parse(JSON.stringify(baseCov));
  delete covWithoutScope.frameworks.nist80053.scope;

  const resultWith = buildOscal(covWithScope, baseControls, '2024-01-01T00:00:00Z');
  const resultWithout = buildOscal(covWithoutScope, baseControls, '2024-01-01T00:00:00Z');

  const scopePropWith = resultWith['component-definition'].components[0].props.find(p => p.name === 'scope');
  const scopePropWithout = resultWithout['component-definition'].components[0].props.find(p => p.name === 'scope');
  assert.equal(scopePropWith.value, 'nist-scope');
  assert.equal(scopePropWithout.value, '');
});

test('NIST control-implementation description mentions Rev 5', () => {
  const result = buildOscal(baseCov, baseControls, '2024-01-01T00:00:00Z');
  const nistImpl = result['component-definition'].components[0]['control-implementations'][0];
  assert.equal(nistImpl.description.includes('NIST SP 800-53 Rev 5'), true);
});

test('SOC control-implementation description mentions SOC 2', () => {
  const result = buildOscal(baseCov, baseControls, '2024-01-01T00:00:00Z');
  const socImpl = result['component-definition'].components[0]['control-implementations'][1];
  assert.equal(socImpl.description.includes('SOC 2 Trust Services Criteria'), true);
});

test('handles missing soc2 framework in controls', () => {
  const cov = {
    product: { id: 'p1', name: 'P1', version: '1.0.0' },
    frameworks: {
      nist80053: { scope: 's', mapped: 0, catalog: 10, baselineModerate: 5, evidenced: 0, rows: [] }
    }
  };
  const controls = { frameworks: {} };
  assert.throws(() => buildOscal(cov, controls, '2024-01-01T00:00:00Z'), {
    name: 'Error',
    message: 'controls.json frameworks.soc2.catalogSource is missing; an OSCAL control-implementation requires a source'
  });
});

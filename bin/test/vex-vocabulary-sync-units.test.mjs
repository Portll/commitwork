// bin/test/vex-vocabulary-sync-units.test.mjs — case tests for deriveCsaf, deriveCycloneDx, deriveOpenVex.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCsaf, deriveCycloneDx, deriveOpenVex } from '../vex-vocabulary-sync.mjs';

test('returns empty arrays for null input', () => {
  const result = deriveCsaf(null);
  assert.deepEqual(result, { status: [], justification: null, threat: null, response: null });
});

test('returns empty arrays for undefined input', () => {
  const result = deriveCsaf(undefined);
  assert.deepEqual(result, { status: [], justification: null, threat: null, response: null });
});

test('extracts product_status keys from properties', () => {
  const doc = {
    properties: {
      vulnerabilities: {
        items: {
          properties: {
            product_status: {
              properties: {
                fixed: {},
                under_investigation: {},
                not_affected: {}
              }
            }
          }
        }
      }
    }
  };
  const result = deriveCsaf(doc);
  assert.deepEqual(result.status, ['fixed', 'under_investigation', 'not_affected']);
});

test('extracts enum from flags label', () => {
  const doc = {
    properties: {
      vulnerabilities: {
        items: {
          properties: {
            flags: {
              items: {
                properties: {
                  label: { enum: ['inline_mitigations_already_exist', 'not_affected'] }
                }
              }
            }
          }
        }
      }
    }
  };
  const result = deriveCsaf(doc);
  assert.deepEqual(result.justification, ['inline_mitigations_already_exist', 'not_affected']);
});

test('extracts enum from threats category', () => {
  const doc = {
    properties: {
      vulnerabilities: {
        items: {
          properties: {
            threats: {
              items: {
                properties: {
                  category: { enum: ['exploit_status', 'impact'] }
                }
              }
            }
          }
        }
      }
    }
  };
  const result = deriveCsaf(doc);
  assert.deepEqual(result.threat, ['exploit_status', 'impact']);
});

test('extracts enum from remediations category', () => {
  const doc = {
    properties: {
      vulnerabilities: {
        items: {
          properties: {
            remediations: {
              items: {
                properties: {
                  category: { enum: ['fix', 'workaround', 'mitigation'] }
                }
              }
            }
          }
        }
      }
    }
  };
  const result = deriveCsaf(doc);
  assert.deepEqual(result.response, ['fix', 'workaround', 'mitigation']);
});

test('returns null for missing enum paths', () => {
  const doc = { properties: {} };
  const result = deriveCsaf(doc);
  assert.equal(result.status.length, 0);
  assert.equal(result.justification, null);
  assert.equal(result.threat, null);
  assert.equal(result.response, null);
});

test('returns nulls for empty object', () => {
  const result = deriveCycloneDx({});
  assert.deepEqual(result, { status: null, justification: null, response: null });
});

test('returns nulls for null input', () => {
  const result = deriveCycloneDx(null);
  assert.deepEqual(result, { status: null, justification: null, response: null });
});

test('returns nulls for undefined input', () => {
  const result = deriveCycloneDx(undefined);
  assert.deepEqual(result, { status: null, justification: null, response: null });
});

test('extracts enums from definitions.vulnerability.properties.analysis', () => {
  const doc = {
    definitions: {
      vulnerability: {
        properties: {
          analysis: {
            properties: {
              state: { enum: ['fixed', 'exploitable'] },
              justification: { enum: ['component_not_present'] },
              response: { enum: ['patch', 'replace'] },
            },
          },
        },
      },
    },
  };
  const result = deriveCycloneDx(doc);
  assert.deepEqual(result.status, ['fixed', 'exploitable']);
  assert.deepEqual(result.justification, ['component_not_present']);
  assert.deepEqual(result.response, ['patch', 'replace']);
});

test('resolves $ref for state property', () => {
  const doc = {
    definitions: {
      vulnerability: {
        properties: {
          analysis: {
            properties: {
              state: { $ref: '#/definitions/stateEnum' },
              justification: { enum: ['a'] },
              response: { enum: ['b'] },
            },
          },
        },
      },
      stateEnum: { enum: ['resolved', 'unresolved'] },
    },
  };
  const result = deriveCycloneDx(doc);
  assert.deepEqual(result.status, ['resolved', 'unresolved']);
  assert.deepEqual(result.justification, ['a']);
  assert.deepEqual(result.response, ['b']);
});

test('returns null for missing analysis properties', () => {
  const doc = {
    definitions: {
      vulnerability: {
        properties: {
          analysis: {
            properties: {},
          },
        },
      },
    },
  };
  const result = deriveCycloneDx(doc);
  assert.deepEqual(result, { status: null, justification: null, response: null });
});

test('extracts status and justification from properties.statements.items', () => {
  const doc = {
    properties: {
      statements: {
        items: {
          properties: {
            status: { enum: ['affected', 'not_affected', 'fixed', 'under_investigation'] },
            justification: { enum: ['vulnerable_code_not_present', 'vulnerable_code_not_reachable', 'vulnerable_code_not_included', 'inline_mitigations_already_exist', 'inline_mitigations_are_not_sufficient'] },
          },
        },
      },
    },
  };
  const result = deriveOpenVex(doc);
  assert.deepEqual(result.status, ['affected', 'not_affected', 'fixed', 'under_investigation']);
  assert.deepEqual(result.justification, ['vulnerable_code_not_present', 'vulnerable_code_not_reachable', 'vulnerable_code_not_included', 'inline_mitigations_already_exist', 'inline_mitigations_are_not_sufficient']);
});

test('extracts from $defs.statement when properties.statements is absent', () => {
  const doc = {
    $defs: {
      statement: {
        properties: {
          status: { enum: ['affected', 'not_affected'] },
          justification: { enum: ['vulnerable_code_not_present'] },
        },
      },
    },
  };
  const result = deriveOpenVex(doc);
  assert.deepEqual(result.status, ['affected', 'not_affected']);
  assert.deepEqual(result.justification, ['vulnerable_code_not_present']);
});

test('extracts from definitions.statement when $defs is absent', () => {
  const doc = {
    definitions: {
      statement: {
        properties: {
          status: { enum: ['affected'] },
          justification: { enum: ['vulnerable_code_not_present', 'vulnerable_code_not_reachable'] },
        },
      },
    },
  };
  const result = deriveOpenVex(doc);
  assert.deepEqual(result.status, ['affected']);
  assert.deepEqual(result.justification, ['vulnerable_code_not_present', 'vulnerable_code_not_reachable']);
});

test('returns null for missing fields', () => {
  const doc = {
    properties: {
      statements: {
        items: {
          properties: {},
        },
      },
    },
  };
  const result = deriveOpenVex(doc);
  assert.equal(result.status, null);
  assert.equal(result.justification, null);
});

test('handles $ref in status field', () => {
  const doc = {
    $defs: {
      status: { enum: ['affected', 'not_affected', 'fixed', 'under_investigation'] },
    },
    properties: {
      statements: {
        items: {
          properties: {
            status: { $ref: '#/$defs/status' },
            justification: { enum: ['vulnerable_code_not_present'] },
          },
        },
      },
    },
  };
  const result = deriveOpenVex(doc);
  assert.deepEqual(result.status, ['affected', 'not_affected', 'fixed', 'under_investigation']);
  assert.deepEqual(result.justification, ['vulnerable_code_not_present']);
});

test('returns null for null input', () => {
  const result = deriveOpenVex(null);
  assert.equal(result.status, null);
  assert.equal(result.justification, null);
});

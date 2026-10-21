// Renders the frozen definitions module text from a schema JSON object (bin/actions-schema-gen.mjs renderSchemaModule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSchemaModule } from '../actions-schema-gen.mjs';

test('renders header comments and version exports for a minimal schema', () => {
  const schemaJson = {
    version: '1.0.0',
    definitions: {
      Foo: { type: 'string' }
    }
  };
  const result = renderSchemaModule(schemaJson, '2.1.0');
  const expected = [
    '// The workflow schema GitHub Actions reads workflow files against: definition names, mapping',
    '// properties, scalar forms, one-of choices and the contexts expressions may use at each site.',
    '// Derived from workflow-v1.0 in @actions/workflow-parser 2.1.0 (MIT, GitHub), descriptions',
    '// removed; see docs/THIRD-PARTY-NOTICES.md. Regenerate with bin/actions-schema-gen.mjs rather than edit.',
    '',
    'export const schemaVersion = "1.0.0";',
    'export const schemaSource = "@actions/workflow-parser 2.1.0";',
    '',
    'export const definitions = Object.freeze({',
    '  "Foo": {"type":"string"},',
    '});',
    '',
  ].join('\n');
  assert.equal(result, expected);
});

test('removes description fields from definition objects', () => {
  const schemaJson = {
    version: '1.0.0',
    definitions: {
      Bar: {
        type: 'object',
        description: 'A bar object',
        properties: {
          name: { type: 'string', description: 'The name' }
        }
      }
    }
  };
  const result = renderSchemaModule(schemaJson, '1.0.0');
  const expected = [
    '// The workflow schema GitHub Actions reads workflow files against: definition names, mapping',
    '// properties, scalar forms, one-of choices and the contexts expressions may use at each site.',
    '// Derived from workflow-v1.0 in @actions/workflow-parser 1.0.0 (MIT, GitHub), descriptions',
    '// removed; see docs/THIRD-PARTY-NOTICES.md. Regenerate with bin/actions-schema-gen.mjs rather than edit.',
    '',
    'export const schemaVersion = "1.0.0";',
    'export const schemaSource = "@actions/workflow-parser 1.0.0";',
    '',
    'export const definitions = Object.freeze({',
    '  "Bar": {"type":"object","properties":{"name":{"type":"string","description":"The name"}}},',
    '});',
    '',
  ].join('\n');
  assert.equal(result, expected);
});

test('preserves string property specs without modification', () => {
  const schemaJson = {
    version: '1.0.0',
    definitions: {
      Baz: {
        type: 'object',
        properties: {
          ref: 'string',
          other: { type: 'number' }
        }
      }
    }
  };
  const result = renderSchemaModule(schemaJson, '1.0.0');
  const expected = [
    '// The workflow schema GitHub Actions reads workflow files against: definition names, mapping',
    '// properties, scalar forms, one-of choices and the contexts expressions may use at each site.',
    '// Derived from workflow-v1.0 in @actions/workflow-parser 1.0.0 (MIT, GitHub), descriptions',
    '// removed; see docs/THIRD-PARTY-NOTICES.md. Regenerate with bin/actions-schema-gen.mjs rather than edit.',
    '',
    'export const schemaVersion = "1.0.0";',
    'export const schemaSource = "@actions/workflow-parser 1.0.0";',
    '',
    'export const definitions = Object.freeze({',
    '  "Baz": {"type":"object","properties":{"ref":"string","other":{"type":"number"}}},',
    '});',
    '',
  ].join('\n');
  assert.equal(result, expected);
});

test('removes description from mapping properties when key is mapping', () => {
  const schemaJson = {
    version: '1.0.0',
    definitions: {
      Qux: {
        type: 'object',
        mapping: {
          properties: {
            key: { type: 'string', description: 'A key' },
            val: { type: 'number' }
          }
        }
      }
    }
  };
  const result = renderSchemaModule(schemaJson, '1.0.0');
  const expected = [
    '// The workflow schema GitHub Actions reads workflow files against: definition names, mapping',
    '// properties, scalar forms, one-of choices and the contexts expressions may use at each site.',
    '// Derived from workflow-v1.0 in @actions/workflow-parser 1.0.0 (MIT, GitHub), descriptions',
    '// removed; see docs/THIRD-PARTY-NOTICES.md. Regenerate with bin/actions-schema-gen.mjs rather than edit.',
    '',
    'export const schemaVersion = "1.0.0";',
    'export const schemaSource = "@actions/workflow-parser 1.0.0";',
    '',
    'export const definitions = Object.freeze({',
    '  "Qux": {"type":"object","mapping":{"properties":{"key":{"type":"string"},"val":{"type":"number"}}}},',
    '});',
    '',
  ].join('\n');
  assert.equal(result, expected);
});

test('handles multiple definitions in order', () => {
  const schemaJson = {
    version: '2.0.0',
    definitions: {
      First: { type: 'string' },
      Second: { type: 'number' },
      Third: { type: 'boolean' }
    }
  };
  const result = renderSchemaModule(schemaJson, '3.0.0');
  const expected = [
    '// The workflow schema GitHub Actions reads workflow files against: definition names, mapping',
    '// properties, scalar forms, one-of choices and the contexts expressions may use at each site.',
    '// Derived from workflow-v1.0 in @actions/workflow-parser 3.0.0 (MIT, GitHub), descriptions',
    '// removed; see docs/THIRD-PARTY-NOTICES.md. Regenerate with bin/actions-schema-gen.mjs rather than edit.',
    '',
    'export const schemaVersion = "2.0.0";',
    'export const schemaSource = "@actions/workflow-parser 3.0.0";',
    '',
    'export const definitions = Object.freeze({',
    '  "First": {"type":"string"},',
    '  "Second": {"type":"number"},',
    '  "Third": {"type":"boolean"},',
    '});',
    '',
  ].join('\n');
  assert.equal(result, expected);
});

test('handles empty definitions object', () => {
  const schemaJson = {
    version: '1.0.0',
    definitions: {}
  };
  const result = renderSchemaModule(schemaJson, '1.0.0');
  const expected = [
    '// The workflow schema GitHub Actions reads workflow files against: definition names, mapping',
    '// properties, scalar forms, one-of choices and the contexts expressions may use at each site.',
    '// Derived from workflow-v1.0 in @actions/workflow-parser 1.0.0 (MIT, GitHub), descriptions',
    '// removed; see docs/THIRD-PARTY-NOTICES.md. Regenerate with bin/actions-schema-gen.mjs rather than edit.',
    '',
    'export const schemaVersion = "1.0.0";',
    'export const schemaSource = "@actions/workflow-parser 1.0.0";',
    '',
    'export const definitions = Object.freeze({',
    '});',
    '',
  ].join('\n');
  assert.equal(result, expected);
});

test('preserves non-mapping nested objects without stripping their properties', () => {
  const schemaJson = {
    version: '1.0.0',
    definitions: {
      Nested: {
        type: 'object',
        items: {
          properties: {
            inner: { type: 'string', description: 'inner desc' }
          }
        }
      }
    }
  };
  const result = renderSchemaModule(schemaJson, '1.0.0');
  const expected = [
    '// The workflow schema GitHub Actions reads workflow files against: definition names, mapping',
    '// properties, scalar forms, one-of choices and the contexts expressions may use at each site.',
    '// Derived from workflow-v1.0 in @actions/workflow-parser 1.0.0 (MIT, GitHub), descriptions',
    '// removed; see docs/THIRD-PARTY-NOTICES.md. Regenerate with bin/actions-schema-gen.mjs rather than edit.',
    '',
    'export const schemaVersion = "1.0.0";',
    'export const schemaSource = "@actions/workflow-parser 1.0.0";',
    '',
    'export const definitions = Object.freeze({',
    '  "Nested": {"type":"object","items":{"properties":{"inner":{"type":"string","description":"inner desc"}}}},',
    '});',
    '',
  ].join('\n');
  assert.equal(result, expected);
});

test('handles definition with only description field', () => {
  const schemaJson = {
    version: '1.0.0',
    definitions: {
      OnlyDesc: { description: 'just a description' }
    }
  };
  const result = renderSchemaModule(schemaJson, '1.0.0');
  const expected = [
    '// The workflow schema GitHub Actions reads workflow files against: definition names, mapping',
    '// properties, scalar forms, one-of choices and the contexts expressions may use at each site.',
    '// Derived from workflow-v1.0 in @actions/workflow-parser 1.0.0 (MIT, GitHub), descriptions',
    '// removed; see docs/THIRD-PARTY-NOTICES.md. Regenerate with bin/actions-schema-gen.mjs rather than edit.',
    '',
    'export const schemaVersion = "1.0.0";',
    'export const schemaSource = "@actions/workflow-parser 1.0.0";',
    '',
    'export const definitions = Object.freeze({',
    '  "OnlyDesc": {},',
    '});',
    '',
  ].join('\n');
  assert.equal(result, expected);
});

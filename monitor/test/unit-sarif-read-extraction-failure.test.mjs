// Extracts extraction failure details from a SARIF notification (monitor/sarif-read.mjs extractionFailure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractionFailure } from '../sarif-read.mjs';

test('returns null when notification is null', () => {
  assert.equal(extractionFailure(null), null);
});

test('returns null when descriptor is missing', () => {
  assert.equal(extractionFailure({ message: { text: 'x' } }), null);
});

test('returns null when descriptor id does not match extraction error pattern', () => {
  assert.equal(extractionFailure({ descriptor: { id: 'other/error' } }), null);
});

test('returns null when uri cannot be determined', () => {
  const n = {
    descriptor: { id: '/diagnostics/extraction-errors' },
    message: { text: 'No match here' }
  };
  assert.equal(extractionFailure(n), null);
});

test('returns uri from artifactLocation when present', () => {
  const n = {
    descriptor: { id: '/diagnostics/extraction-errors' },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///a.js' } } }],
    message: { text: 'Extraction failed in file:///b.js with error boom' }
  };
  assert.deepEqual(extractionFailure(n), { uri: "file:///a.js", line: null, error: "boom" });
});

test('returns uri from message when artifactLocation is absent', () => {
  const n = {
    descriptor: { id: '/diagnostics/extraction-errors' },
    locations: [{ physicalLocation: {} }],
    message: { text: 'Extraction failed in file:///b.js with error boom' }
  };
  assert.deepEqual(extractionFailure(n), { uri: "file:///b.js", line: null, error: "boom" });
});

test('returns line from region when present', () => {
  const n = {
    descriptor: { id: '/diagnostics/extraction-errors' },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///a.js' }, region: { startLine: 42 } } }],
    message: { text: 'Extraction failed in file:///a.js with error boom' }
  };
  assert.deepEqual(extractionFailure(n), { uri: "file:///a.js", line: 42, error: "boom" });
});

test('returns null line when region is absent', () => {
  const n = {
    descriptor: { id: '/diagnostics/extraction-errors' },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///a.js' } } }],
    message: { text: 'Extraction failed in file:///a.js with error boom' }
  };
  assert.deepEqual(extractionFailure(n), { uri: "file:///a.js", line: null, error: "boom" });
});

test('returns trimmed error text from message', () => {
  const n = {
    descriptor: { id: '/diagnostics/extraction-errors' },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///a.js' } } }],
    message: { text: 'Extraction failed in file:///a.js with error   boom  ' }
  };
  assert.deepEqual(extractionFailure(n), { uri: "file:///a.js", line: null, error: "boom" });
});

test('returns raw text as error when message does not match pattern', () => {
  const n = {
    descriptor: { id: '/diagnostics/extraction-errors' },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///a.js' } } }],
    message: { text: 'Something else entirely' }
  };
  assert.deepEqual(extractionFailure(n), { uri: "file:///a.js", line: null, error: "Something else entirely" });
});

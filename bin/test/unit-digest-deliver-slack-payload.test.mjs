// Builds a Slack Block Kit payload from a digest document (bin/digest-deliver.mjs slackPayload).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slackPayload } from '../digest-deliver.mjs';

test('returns header and context blocks for a measured digest with one section', () => {
  const doc = {
    window: { since: '2024-01-01T00:00:00Z', until: '2024-01-02T00:00:00Z' },
    status: 'measured',
    sections: {
      coverage: {
        title: 'Coverage',
        status: 'measured',
        headline: 'All good',
        notMeasured: []
      }
    },
    digestId: 'abc123'
  };
  const result = slackPayload(doc);
  assert.equal(result.blocks[0].type, 'header');
  assert.equal(result.blocks[0].text.text, 'commitwork digest');
  assert.equal(result.blocks[1].type, 'context');
  assert.equal(result.blocks[1].elements[0].text, 'Window 2024-01-01T00:00:00Z \u2192 2024-01-02T00:00:00Z \u00b7 measured');
  assert.equal(result.blocks[2].type, 'section');
  assert.equal(result.blocks[2].text.text, '*Coverage* \u2014 measured\nAll good');
  assert.equal(result.blocks[3].type, 'context');
  assert.equal(result.blocks[3].elements[0].text, 'digestId abc123');
  assert.equal(result.text, 'commitwork digest (2024-01-02T00:00:00Z): All good');
});

test('includes not measured reasons when status is not measured', () => {
  const doc = {
    window: { since: '2024-01-01T00:00:00Z', until: '2024-01-02T00:00:00Z' },
    status: 'partial',
    sections: {
      coverage: {
        title: 'Coverage',
        status: 'not-measured',
        headline: 'Missing data',
        notMeasured: ['reason1', 'reason2']
      }
    },
    digestId: 'def456'
  };
  const result = slackPayload(doc);
  assert.equal(result.blocks[2].text.text, '*Coverage* \u2014 NOT MEASURED\nMissing data\n\u2022 not measured: reason1\n\u2022 not measured: reason2');
  assert.equal(result.text, 'commitwork digest (2024-01-02T00:00:00Z): Missing data');
});

test('truncates not measured reasons beyond five and adds a summary line', () => {
  const doc = {
    window: { since: '2024-01-01T00:00:00Z', until: '2024-01-02T00:00:00Z' },
    status: 'partial',
    sections: {
      coverage: {
        title: 'Coverage',
        status: 'not-measured',
        headline: 'Many reasons',
        notMeasured: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']
      }
    },
    digestId: 'ghi789'
  };
  const result = slackPayload(doc);
  const expected = '*Coverage* \u2014 NOT MEASURED\nMany reasons\n\u2022 not measured: r1\n\u2022 not measured: r2\n\u2022 not measured: r3\n\u2022 not measured: r4\n\u2022 not measured: r5\n\u2022 \u2026and 2 more not measured';
  assert.equal(result.blocks[2].text.text, expected);
});

test('uses fallback headline when headline is missing', () => {
  const doc = {
    window: { since: '2024-01-01T00:00:00Z', until: '2024-01-02T00:00:00Z' },
    status: 'measured',
    sections: {
      coverage: {
        title: 'Coverage',
        status: 'measured',
        notMeasured: []
      }
    },
    digestId: 'jkl012'
  };
  const result = slackPayload(doc);
  assert.equal(result.blocks[2].text.text, '*Coverage* \u2014 measured\nCoverage: measured');
  assert.equal(result.text, 'commitwork digest (2024-01-02T00:00:00Z): Coverage: measured');
});

test('handles unknown status by stringifying it', () => {
  const doc = {
    window: { since: '2024-01-01T00:00:00Z', until: '2024-01-02T00:00:00Z' },
    status: 'weird-status',
    sections: {
      coverage: {
        title: 'Coverage',
        status: 'weird-status',
        headline: 'Weird',
        notMeasured: []
      }
    },
    digestId: 'mno345'
  };
  const result = slackPayload(doc);
  assert.equal(result.blocks[1].elements[0].text, 'Window 2024-01-01T00:00:00Z \u2192 2024-01-02T00:00:00Z \u00b7 weird-status');
  assert.equal(result.blocks[2].text.text, '*Coverage* \u2014 weird-status\nWeird');
});

test('handles null status in section by defaulting to unknown status', () => {
  const doc = {
    window: { since: '2024-01-01T00:00:00Z', until: '2024-01-02T00:00:00Z' },
    status: 'measured',
    sections: {
      coverage: {
        title: 'Coverage',
        status: null,
        headline: 'Null status',
        notMeasured: []
      }
    },
    digestId: 'pqr678'
  };
  const result = slackPayload(doc);
  assert.equal(result.blocks[2].text.text, '*Coverage* \u2014 unknown status\nNull status');
});

test('handles missing notMeasured array by treating it as empty', () => {
  const doc = {
    window: { since: '2024-01-01T00:00:00Z', until: '2024-01-02T00:00:00Z' },
    status: 'partial',
    sections: {
      coverage: {
        title: 'Coverage',
        status: 'partial',
        headline: 'Partial'
      }
    },
    digestId: 'stu901'
  };
  const result = slackPayload(doc);
  assert.equal(result.blocks[2].text.text, '*Coverage* \u2014 partly measured\nPartial');
});

test('renders missing window fields as the text undefined', () => {
  const doc = {
    status: 'measured',
    sections: {
      coverage: {
        title: 'Coverage',
        status: 'measured',
        headline: 'No window',
        notMeasured: []
      }
    },
    digestId: 'vwx234'
  };
  const result = slackPayload(doc);
  assert.equal(result.blocks[1].elements[0].text, 'Window undefined \u2192 undefined \u00b7 measured');
  assert.equal(result.text, 'commitwork digest (undefined): No window');
});

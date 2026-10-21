// Builds the HTTP request object for a digest destination (bin/digest-deliver.mjs requestFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestFor } from '../digest-deliver.mjs';

test('returns JSON body and content-type header for slack destination', () => {
  const dest = { kind: 'slack' };
  const doc = {
    digestId: 'd1',
    window: { since: '2024-01-01', until: '2024-01-02' },
    status: 'measured',
    sections: {
      s1: { title: 'S1', status: 'measured', headline: 'All good' }
    }
  };
  const result = requestFor(dest, { raw: 'ignored', doc });
  assert.equal(result.headers['content-type'], 'application/json');
  assert.equal(result.headers['x-commitwork-digest-id'], undefined);
  const parsed = JSON.parse(result.body);
  assert.equal(parsed.blocks[0].type, 'header');
  assert.equal(parsed.blocks[0].text.text, 'commitwork digest');
  assert.equal(parsed.blocks[1].type, 'context');
  assert.equal(parsed.blocks[1].elements[0].text, 'Window 2024-01-01 \u2192 2024-01-02 \u00b7 measured');
  assert.equal(parsed.blocks[2].type, 'section');
  assert.equal(parsed.blocks[2].text.text, '*S1* \u2014 measured\nAll good');
  assert.equal(parsed.blocks[3].type, 'context');
  assert.equal(parsed.blocks[3].elements[0].text, 'digestId d1');
  assert.equal(parsed.text, 'commitwork digest (2024-01-02): All good');
});

test('returns raw body with digest-id header for non-slack destination', () => {
  const dest = { kind: 'email' };
  const doc = { digestId: 'abc123' };
  const result = requestFor(dest, { raw: 'raw-body-content', doc });
  assert.equal(result.body, 'raw-body-content');
  assert.equal(result.headers['content-type'], 'application/json');
  assert.equal(result.headers['x-commitwork-digest-id'], 'abc123');
});

test('returns raw body with digest-id header for webhook destination', () => {
  const dest = { kind: 'webhook' };
  const doc = { digestId: 'xyz789' };
  const result = requestFor(dest, { raw: 'webhook-payload', doc });
  assert.equal(result.body, 'webhook-payload');
  assert.equal(result.headers['content-type'], 'application/json');
  assert.equal(result.headers['x-commitwork-digest-id'], 'xyz789');
});

test('slack payload includes not-measured reasons up to max of 5', () => {
  const dest = { kind: 'slack' };
  const doc = {
    digestId: 'd2',
    window: { since: '2024-02-01', until: '2024-02-02' },
    status: 'partial',
    sections: {
      s1: {
        title: 'S1',
        status: 'not-measured',
        headline: 'Could not measure',
        notMeasured: ['reason1', 'reason2', 'reason3', 'reason4', 'reason5']
      }
    }
  };
  const result = requestFor(dest, { raw: '', doc });
  const parsed = JSON.parse(result.body);
  const sectionText = parsed.blocks[2].text.text;
  assert.ok(sectionText.includes('\u2022 not measured: reason1'));
  assert.ok(sectionText.includes('\u2022 not measured: reason2'));
  assert.ok(sectionText.includes('\u2022 not measured: reason3'));
  assert.ok(sectionText.includes('\u2022 not measured: reason4'));
  assert.ok(sectionText.includes('\u2022 not measured: reason5'));
  assert.ok(!sectionText.includes('\u2026and'));
});

test('slack payload truncates not-measured reasons beyond 5 with count', () => {
  const dest = { kind: 'slack' };
  const doc = {
    digestId: 'd3',
    window: { since: '2024-03-01', until: '2024-03-02' },
    status: 'partial',
    sections: {
      s1: {
        title: 'S1',
        status: 'not-measured',
        headline: 'Could not measure',
        notMeasured: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']
      }
    }
  };
  const result = requestFor(dest, { raw: '', doc });
  const parsed = JSON.parse(result.body);
  const sectionText = parsed.blocks[2].text.text;
  assert.ok(sectionText.includes('\u2022 not measured: r1'));
  assert.ok(sectionText.includes('\u2022 not measured: r5'));
  assert.ok(!sectionText.includes('\u2022 not measured: r6'));
  assert.ok(sectionText.includes('\u2022 \u2026and 2 more not measured'));
});

test('slack payload omits not-measured lines when status is measured', () => {
  const dest = { kind: 'slack' };
  const doc = {
    digestId: 'd4',
    window: { since: '2024-04-01', until: '2024-04-02' },
    status: 'measured',
    sections: {
      s1: {
        title: 'S1',
        status: 'measured',
        headline: 'All good',
        notMeasured: ['should not appear']
      }
    }
  };
  const result = requestFor(dest, { raw: '', doc });
  const parsed = JSON.parse(result.body);
  const sectionText = parsed.blocks[2].text.text;
  assert.equal(sectionText, '*S1* \u2014 measured\nAll good');
  assert.ok(!sectionText.includes('not measured'));
});

test('slack payload uses default headline when headline is missing', () => {
  const dest = { kind: 'slack' };
  const doc = {
    digestId: 'd5',
    window: { since: '2024-05-01', until: '2024-05-02' },
    status: 'partial',
    sections: {
      s1: {
        title: 'MySection',
        status: 'partial'
      }
    }
  };
  const result = requestFor(dest, { raw: '', doc });
  const parsed = JSON.parse(result.body);
  const sectionText = parsed.blocks[2].text.text;
  assert.ok(sectionText.includes('MySection: partly measured'));
});

test('slack payload handles empty sections object', () => {
  const dest = { kind: 'slack' };
  const doc = {
    digestId: 'd6',
    window: { since: '2024-06-01', until: '2024-06-02' },
    status: 'measured',
    sections: {}
  };
  const result = requestFor(dest, { raw: '', doc });
  const parsed = JSON.parse(result.body);
  assert.equal(parsed.blocks.length, 3);
  assert.equal(parsed.blocks[0].type, 'header');
  assert.equal(parsed.blocks[1].type, 'context');
  assert.equal(parsed.blocks[2].type, 'context');
  assert.equal(parsed.text, 'commitwork digest (2024-06-02): ');
});

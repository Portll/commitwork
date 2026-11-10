// Builds the subject, plain-text body, and escaped HTML body for a digest document (bin/digest-deliver.mjs emailPayload).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailPayload } from '../digest-deliver.mjs';

test('measured doc with no sections yields minimal payload', () => {
  const doc = {
    digestId: 'd1',
    status: 'measured',
    window: { since: '2024-01-01T00:00:00Z', until: '2024-01-02T00:00:00Z' },
    sections: {},
  };
  const r = emailPayload(doc);
  assert.equal(r.subject, 'commitwork digest 2024-01-02T00:00:00Z \u00b7 measured');
  assert.equal(r.text, 'commitwork digest\nWindow 2024-01-01T00:00:00Z \u2192 2024-01-02T00:00:00Z \u00b7 measured\n\ndigestId d1');
  assert.equal(r.html, '<h1>commitwork digest</h1>\n<p>Window 2024-01-01T00:00:00Z \u2192 2024-01-02T00:00:00Z \u00b7 measured</p>\n<p>digestId d1</p>');
});

test('partial doc with one measured section and no reasons', () => {
  const doc = {
    digestId: 'd2',
    status: 'partial',
    window: { since: 's', until: 'u' },
    sections: { a: { title: 'A', status: 'measured', headline: 'ok' } },
  };
  const r = emailPayload(doc);
  assert.equal(r.subject, 'commitwork digest u \u00b7 partly measured');
  assert.equal(r.text, 'commitwork digest\nWindow s \u2192 u \u00b7 partly measured\n\nA \u2014 measured\nok\n\ndigestId d2');
  assert.equal(r.html, '<h1>commitwork digest</h1>\n<p>Window s \u2192 u \u00b7 partly measured</p>\n<h2>A \u2014 measured</h2>\n<p>ok</p>\n<p>digestId d2</p>');
});

test('not-measured section with exactly five reasons shows all', () => {
  const reasons = ['r1', 'r2', 'r3', 'r4', 'r5'];
  const doc = {
    digestId: 'd3',
    status: 'not-measured',
    window: { since: 's', until: 'u' },
    sections: { b: { title: 'B', status: 'not-measured', notMeasured: reasons } },
  };
  const r = emailPayload(doc);
  assert.equal(r.subject, 'commitwork digest u \u00b7 NOT MEASURED');
  assert.equal(r.text, 'commitwork digest\nWindow s \u2192 u \u00b7 NOT MEASURED\n\nB \u2014 NOT MEASURED\nB: NOT MEASURED\n  \u2022 not measured: r1\n  \u2022 not measured: r2\n  \u2022 not measured: r3\n  \u2022 not measured: r4\n  \u2022 not measured: r5\n\ndigestId d3');
  assert.equal(r.html, '<h1>commitwork digest</h1>\n<p>Window s \u2192 u \u00b7 NOT MEASURED</p>\n<h2>B \u2014 NOT MEASURED</h2>\n<p>B: NOT MEASURED</p>\n<ul><li>not measured: r1</li><li>not measured: r2</li><li>not measured: r3</li><li>not measured: r4</li><li>not measured: r5</li></ul>\n<p>digestId d3</p>');
});

test('not-measured section with six reasons truncates to five plus summary', () => {
  const reasons = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
  const doc = {
    digestId: 'd4',
    status: 'not-measured',
    window: { since: 's', until: 'u' },
    sections: { c: { title: 'C', status: 'not-measured', notMeasured: reasons } },
  };
  const r = emailPayload(doc);
  assert.equal(r.text, 'commitwork digest\nWindow s \u2192 u \u00b7 NOT MEASURED\n\nC \u2014 NOT MEASURED\nC: NOT MEASURED\n  \u2022 not measured: r1\n  \u2022 not measured: r2\n  \u2022 not measured: r3\n  \u2022 not measured: r4\n  \u2022 not measured: r5\n  \u2022 \u2026and 1 more not measured\n\ndigestId d4');
  assert.equal(r.html, '<h1>commitwork digest</h1>\n<p>Window s \u2192 u \u00b7 NOT MEASURED</p>\n<h2>C \u2014 NOT MEASURED</h2>\n<p>C: NOT MEASURED</p>\n<ul><li>not measured: r1</li><li>not measured: r2</li><li>not measured: r3</li><li>not measured: r4</li><li>not measured: r5</li><li>\u2026and 1 more not measured</li></ul>\n<p>digestId d4</p>');
});

test('section with unknown status and missing headline falls back', () => {
  const doc = {
    digestId: 'd5',
    status: 'weird',
    window: { since: 's', until: 'u' },
    sections: { d: { title: 'D', status: 'broken' } },
  };
  const r = emailPayload(doc);
  assert.equal(r.subject, 'commitwork digest u \u00b7 weird');
  assert.equal(r.text, 'commitwork digest\nWindow s \u2192 u \u00b7 weird\n\nD \u2014 broken\nD: broken\n\ndigestId d5');
  assert.equal(r.html, '<h1>commitwork digest</h1>\n<p>Window s \u2192 u \u00b7 weird</p>\n<h2>D \u2014 broken</h2>\n<p>D: broken</p>\n<p>digestId d5</p>');
});

test('subject is clipped to 200 characters with ellipsis', () => {
  const until = 'x'.repeat(250);
  const doc = {
    digestId: 'd6',
    status: 'measured',
    window: { since: 's', until },
    sections: {},
  };
  const r = emailPayload(doc);
  assert.equal(r.subject.length, 200);
  assert.ok(r.subject.endsWith('\u2026'));
  assert.equal(r.subject, `commitwork digest ${until.slice(0, 181)}\u2026`);
});

test('subject under 200 characters is not clipped', () => {
  const until = 'y'.repeat(100);
  const doc = {
    digestId: 'd7',
    status: 'measured',
    window: { since: 's', until },
    sections: {},
  };
  const r = emailPayload(doc);
  assert.equal(r.subject, `commitwork digest ${until} \u00b7 measured`);
  assert.equal(r.subject.length, 129);
});

test('html escapes angle brackets and ampersands in titles and headlines', () => {
  const doc = {
    digestId: 'd8',
    status: 'measured',
    window: { since: 's', until: 'u' },
    sections: { e: { title: '<A&B>', status: 'measured', headline: 'x<y>&z' } },
  };
  const r = emailPayload(doc);
  assert.equal(r.html, '<h1>commitwork digest</h1>\n<p>Window s \u2192 u \u00b7 measured</p>\n<h2>&lt;A&amp;B&gt; \u2014 measured</h2>\n<p>x&lt;y&gt;&amp;z</p>\n<p>digestId d8</p>');
  assert.equal(r.text, 'commitwork digest\nWindow s \u2192 u \u00b7 measured\n\n<A&B> \u2014 measured\nx<y>&z\n\ndigestId d8');
});

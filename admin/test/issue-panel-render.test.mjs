// The Issues tab's per-issue lodging panel, rendered — issPanelHTML lifted from admin/index.html
// source, since a restated copy would keep passing after the real panel changed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_SRC = panelSource('index.html');

const escLine = INDEX_SRC.split('\n').find((l) => l.startsWith('const esc='));
const fnAt = INDEX_SRC.indexOf('function issPanelHTML(d){');
assert.ok(escLine && fnAt > -1, 'issPanelHTML not found in admin/index.html');
const fnSrc = INDEX_SRC.slice(fnAt, INDEX_SRC.indexOf('\n}', fnAt) + 2);
// ISS_GREEN (greenKind -> [pill class, tooltip]) lifted from source for the same reason.
const greenAt = INDEX_SRC.indexOf('const ISS_GREEN={');
assert.ok(greenAt > -1, 'ISS_GREEN not found in admin/index.html');
const greenSrc = INDEX_SRC.slice(greenAt, INDEX_SRC.indexOf('\n};', greenAt) + 3);

// nosemgrep: javascript.browser.security.eval-detected.eval-detected -- test harness evaluating an esc() helper extracted from panel source under test, no external input
const esc = eval(`(${escLine.slice(escLine.indexOf('=') + 1).replace(/;$/, '')})`);
const render = new Function('esc', `${greenSrc}\n${fnSrc}\nreturn issPanelHTML;`)(esc);

const VOCAB = {
  fixTypes: ['code-change', 'config-change', 'dep-upgrade', 'compensating-control', 'suppression', 'wont-fix'],
  dispositions: ['false-positive', 'remediated', 'not-applicable'],
  rescanLevels: ['all', 'fast', 'none', 'sast-codeql'],
  notes: { min: 8, max: 2000 },
};
const D = (over = {}) => ({
  ok: true, id: 'ISS-PORTLL-S-000001', area: 'fixarea', repo: 'commitwork', kind: 'code',
  severity: 'high', state: 'open', closedAs: null, suspect: false,
  rule: 'js/code-injection', tool: 'sastCodeql', remediation: null, fix: null, llm: null,
  greenKind: 'open', subjectDigest: `sha256:${'a'.repeat(64)}`, dispositions: [],
  vocab: VOCAB, promptAvailable: true, ...over,
});

describe('the lodging form', () => {
  test('renders the ruling and the fix type as SEPARATE controls, each with its own vocabulary', () => {
    const h = render(D());
    assert.match(h, /data-f="disposition"/, 'the ruling has its own control');
    assert.match(h, /data-f="fixType"/, 'the fix type has its own control');
    assert.ok(h.indexOf('data-f="disposition"') !== h.indexOf('data-f="fixType"'), 'they are two controls, not one');
    for (const w of VOCAB.dispositions) assert.ok(h.includes(`>${w}</option>`), `ruling option ${w} must render`);
    for (const w of VOCAB.fixTypes) assert.ok(h.includes(`>${w}</option>`), `fix type option ${w} must render`);
  });

  test('the annotation is a textarea carrying the server\'s own bounds, not the page\'s guess', () => {
    const h = render(D());
    assert.match(h, /<textarea[^>]*data-f="notes"/);
    assert.match(h, /2000/, 'the maximum comes from vocab.notes.max');
    assert.match(h, /minimum 8/, 'the minimum comes from vocab.notes.min');
  });

  test('a word the server did not send is not offered — the page holds no copy of a closed set', () => {
    const h = render(D({ vocab: { ...VOCAB, fixTypes: ['code-change'], dispositions: ['remediated'] } }));
    assert.ok(h.includes('>code-change</option>'));
    assert.ok(!h.includes('>suppression</option>'), 'a fix type the payload omitted must not appear');
    assert.ok(!h.includes('>false-positive</option>'), 'a ruling the payload omitted must not appear');
  });

  test('an existing lodging pre-fills the form and is shown as a record with its attribution', () => {
    const h = render(D({ fix: { fixType: 'dep-upgrade', notes: 'bumped to 4.17.21', who: 'op@example.com', at: '2026-08-04T00:00:00.000Z', dispositionId: null } }));
    assert.match(h, /<option value="dep-upgrade" selected>/, 'the recorded fix type is the selected one');
    assert.ok(h.includes('bumped to 4.17.21'));
    assert.ok(h.includes('op@example.com'), 'a lodging is attributed where it is displayed');
  });

  test('re-scan offers the server\'s levels with "none" sayable out loud', () => {
    const h = render(D());
    assert.match(h, /data-f="rescan"/);
    assert.ok(h.includes('<option value="none" selected>none</option>'), '"none" is the default and is stated, never implied by omission');
  });
});

describe('the tunnel line', () => {
  test('on the operator port the three source-bearing actions are offered', () => {
    const h = render(D({ promptAvailable: true }));
    for (const act of ['copy', 'local', 'claude']) assert.match(h, new RegExp(`data-act="${act}"`), `${act} must be offered locally`);
    assert.ok(!h.includes('iss-local-note'), 'no local-only explanation is needed when they are present');
  });

  test('through the tunnel they are ABSENT and the panel states why, naming the operator port', () => {
    const h = render(D({ promptAvailable: false }));
    for (const act of ['copy', 'local', 'claude']) assert.ok(!h.includes(`data-act="${act}"`), `${act} must not be offered remotely`);
    assert.match(h, /iss-local-note/, 'the absence is explained, not silent');
    assert.match(h, /127\.0\.0\.1:7879/, 'the explanation names the way to get them');
    assert.match(h, /source/i, 'and says what the reason is');
    // the lodging half is unaffected — that is the whole point of the split
    assert.match(h, /data-f="fixType"/);
    assert.match(h, /data-act="lodge"/);
    assert.match(h, /data-act="rule"/);
  });
});

describe('states rendered as themselves', () => {
  test('human-green and scanner-clean get different pills — the two greens never merge', () => {
    const human = render(D({ greenKind: 'human-green' }));
    const scanner = render(D({ greenKind: 'scanner-clean' }));
    assert.match(human, /pill green-human/);
    assert.ok(!/pill green-human/.test(scanner), 'a scanner-proved clean must not wear the human-green pill');
    assert.match(human, /a person ruled on it/, 'the legend travels with the pill');
  });

  test('claimed-fixed is rendered as unproven, distinctly from either green', () => {
    const h = render(D({ greenKind: 'claimed-fixed' }));
    assert.match(h, /unproven, still queued/);
    assert.ok(!/pill green-human/.test(h) && !/pill live/.test(h), 'a claim wears neither green');
  });

  test('a suspect issue says so — an absent row is not a fixed one', () => {
    assert.match(render(D({ suspect: true })), /suspect/);
    assert.ok(!/suspect<\/span>/.test(render(D({ suspect: false }))));
  });

  test('the model block always states that a verdict closes nothing', () => {
    const h = render(D({ llm: { at: '2026-08-04T00:00:00.000Z', engine: 'lmstudio', model: 'qwen', verdict: 'false-positive', confidence: 'high', truncated: false } }));
    assert.match(h, /false-positive/);
    assert.match(h, /a model verdict is a claim, not a close/);
  });

  test('a model that gave no verdict says so, rather than rendering an empty verdict', () => {
    const h = render(D({ llm: { at: 'x', engine: 'ollama', model: 'm', verdict: null, confidence: null, truncated: true } }));
    assert.match(h, /none recorded/);
    assert.match(h, /truncated/, 'a reply cut off mid-flight is a different fact from a declined verdict');
  });

  test('scanner guidance is labelled as the scanner\'s, separate from the human\'s account', () => {
    const h = render(D({ remediation: 'fix available: 4.17.21' }));
    assert.match(h, /scanner guidance: fix available: 4\.17\.21/);
  });

  test('rulings render with their in-force status and reasoning', () => {
    const h = render(D({ dispositions: [
      { id: 'DSP-0123456789ab', disposition: 'false-positive', who: 'op@example.com', whoKind: 'human', channel: 'http', at: '2026-08-03T00:00:00.000Z', expires: '2026-11-01T00:00:00.000Z', reason: 'the sink is a constant', status: 'in-force' },
      { id: 'DSP-0123456789ac', disposition: 'not-applicable', who: 'op@example.com', whoKind: 'human', channel: 'http', at: '2026-07-01T00:00:00.000Z', expires: null, reason: 'superseded by the rewrite', status: 'invalidated' },
    ] }));
    assert.match(h, /rulings \(2\)/);
    assert.match(h, /in-force/);
    assert.match(h, /invalidated/, 'a ruling out of force is shown as such, never dropped');
    assert.match(h, /the sink is a constant/);
  });
});

describe('nothing injects', () => {
  test('hostile server strings reach innerHTML escaped', () => {
    const bad = '"><img src=x onerror=alert(1)>';
    const h = render(D({
      rule: bad, tool: bad, repo: bad, remediation: bad,
      fix: { fixType: 'code-change', notes: bad, who: bad, at: bad, dispositionId: null },
      llm: { at: bad, engine: bad, model: bad, verdict: bad, confidence: bad, truncated: false },
      dispositions: [{ id: 'DSP-0123456789ab', disposition: bad, who: bad, whoKind: bad, channel: 'http', at: bad, expires: bad, reason: bad, status: bad }],
    }));
    assert.ok(!h.includes('<img src=x'), 'no unescaped tag may reach the DOM');
    assert.ok(h.includes('&lt;img src=x'), 'and the text is still shown, escaped');
    assert.ok(!/onerror=/.test(h.replace(/&lt;[^&]*/g, '')), 'no live handler survives');
  });
});

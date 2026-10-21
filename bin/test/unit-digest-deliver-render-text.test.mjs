// Renders a plain-text digest summary with per-destination status lines (bin/digest-deliver.mjs renderText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderText } from '../digest-deliver.mjs';

test('renders not-configured outcome with both env vars', () => {
  const r = {
    digestId: 'abcdef1234567890',
    digest: 'daily',
    outcome: 'not-configured',
    results: []
  };
  const expected = [
    'digest abcdef123456\u2026 (daily)',
    '  no destination configured: set CW_DIGEST_SLACK_URL and/or CW_DIGEST_WEBHOOK_URL; nothing sent',
    ''
  ].join('\n');
  assert.equal(renderText(r), expected);
});

test('renders would-send state without problem', () => {
  const r = {
    digestId: 'abcdef1234567890',
    digest: 'weekly',
    outcome: 'ok',
    results: [
      { kind: 'slack', target: 'https://hooks.slack.com/T000/B000', state: 'would-send', problem: null }
    ]
  };
  const expected = [
    'digest abcdef123456\u2026 (weekly)',
    '  slack    https://hooks.slack.com/T000/B000  would send',
    ''
  ].join('\n');
  assert.equal(renderText(r), expected);
});

test('renders would-send state with problem', () => {
  const r = {
    digestId: 'abcdef1234567890',
    digest: 'weekly',
    outcome: 'ok',
    results: [
      { kind: 'webhook', target: 'https://example.com/hook', state: 'would-send', problem: 'rate limited' }
    ]
  };
  const expected = [
    'digest abcdef123456\u2026 (weekly)',
    '  webhook  https://example.com/hook  would send \u2014 but refused: rate limited',
    ''
  ].join('\n');
  assert.equal(renderText(r), expected);
});

test('renders already-delivered state with timestamp', () => {
  const r = {
    digestId: 'abcdef1234567890',
    digest: 'daily',
    outcome: 'ok',
    results: [
      { kind: 'slack', target: 'https://hooks.slack.com/T000/B000', state: 'already-delivered', at: '2024-01-01T00:00:00Z' }
    ]
  };
  const expected = [
    'digest abcdef123456\u2026 (daily)',
    '  slack    https://hooks.slack.com/T000/B000  already delivered 2024-01-01T00:00:00Z; not re-sent',
    ''
  ].join('\n');
  assert.equal(renderText(r), expected);
});

test('renders already-delivered state without timestamp', () => {
  const r = {
    digestId: 'abcdef1234567890',
    digest: 'daily',
    outcome: 'ok',
    results: [
      { kind: 'webhook', target: 'https://example.com/hook', state: 'already-delivered', at: null }
    ]
  };
  const expected = [
    'digest abcdef123456\u2026 (daily)',
    '  webhook  https://example.com/hook  already delivered; not re-sent',
    ''
  ].join('\n');
  assert.equal(renderText(r), expected);
});

test('renders delivered state with HTTP status', () => {
  const r = {
    digestId: 'abcdef1234567890',
    digest: 'daily',
    outcome: 'ok',
    results: [
      { kind: 'slack', target: 'https://hooks.slack.com/T000/B000', state: 'delivered', status: 200 }
    ]
  };
  const expected = [
    'digest abcdef123456\u2026 (daily)',
    '  slack    https://hooks.slack.com/T000/B000  delivered (HTTP 200)',
    ''
  ].join('\n');
  assert.equal(renderText(r), expected);
});

test('renders not-delivered state with reason', () => {
  const r = {
    digestId: 'abcdef1234567890',
    digest: 'daily',
    outcome: 'ok',
    results: [
      { kind: 'webhook', target: 'https://example.com/hook', state: 'failed', reason: 'connection refused' }
    ]
  };
  const expected = [
    'digest abcdef123456\u2026 (daily)',
    '  webhook  https://example.com/hook  NOT DELIVERED: connection refused',
    ''
  ].join('\n');
  assert.equal(renderText(r), expected);
});

test('renders multiple results in order', () => {
  const r = {
    digestId: 'abcdef1234567890',
    digest: 'daily',
    outcome: 'ok',
    results: [
      { kind: 'slack', target: 'https://hooks.slack.com/T000/B000', state: 'delivered', status: 200 },
      { kind: 'webhook', target: 'https://example.com/hook', state: 'failed', reason: 'timeout' }
    ]
  };
  const expected = [
    'digest abcdef123456\u2026 (daily)',
    '  slack    https://hooks.slack.com/T000/B000  delivered (HTTP 200)',
    '  webhook  https://example.com/hook  NOT DELIVERED: timeout',
    ''
  ].join('\n');
  assert.equal(renderText(r), expected);
});

// Computes the list of active delivery destinations from environment variables (bin/digest-deliver.mjs configuredDestinations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuredDestinations } from '../digest-deliver.mjs';

test('returns an empty array when no destination environment variables are set', () => {
  const result = configuredDestinations({});
  assert.deepEqual(result, []);
});

test('returns an empty array when destination environment variables are empty strings', () => {
  const result = configuredDestinations({
    CW_DIGEST_SLACK_URL: '',
    CW_DIGEST_WEBHOOK_URL: '',
  });
  assert.deepEqual(result, []);
});

test('returns an empty array when destination environment variables contain only whitespace', () => {
  const result = configuredDestinations({
    CW_DIGEST_SLACK_URL: '   ',
    CW_DIGEST_WEBHOOK_URL: '\t\n',
  });
  assert.deepEqual(result, []);
});

test('returns an empty array when destination environment variables are not strings', () => {
  const result = configuredDestinations({
    CW_DIGEST_SLACK_URL: 123,
    CW_DIGEST_WEBHOOK_URL: null,
  });
  assert.deepEqual(result, []);
});

test('includes a slack destination when CW_DIGEST_SLACK_URL is a valid URL', () => {
  const url = 'https://hooks.slack.com/services/T000/B000/XXXX';
  const result = configuredDestinations({ CW_DIGEST_SLACK_URL: url });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'slack');
  assert.equal(result[0].env, 'CW_DIGEST_SLACK_URL');
  assert.equal(result[0].url, url);
  assert.equal(result[0].target, 'https://hooks.slack.com/\u2026');
  assert.match(result[0].key, /^slack:[0-9a-f]{16}$/);
});

test('includes a webhook destination when CW_DIGEST_WEBHOOK_URL is a valid URL', () => {
  const url = 'https://example.com/webhook';
  const result = configuredDestinations({ CW_DIGEST_WEBHOOK_URL: url });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'webhook');
  assert.equal(result[0].env, 'CW_DIGEST_WEBHOOK_URL');
  assert.equal(result[0].url, url);
  assert.equal(result[0].target, 'https://example.com/\u2026');
  assert.match(result[0].key, /^webhook:[0-9a-f]{16}$/);
});

test('includes both destinations when both environment variables are set to valid URLs', () => {
  const slackUrl = 'https://hooks.slack.com/services/T000/B000/XXXX';
  const webhookUrl = 'https://example.com/webhook';
  const result = configuredDestinations({
    CW_DIGEST_SLACK_URL: slackUrl,
    CW_DIGEST_WEBHOOK_URL: webhookUrl,
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].kind, 'slack');
  assert.equal(result[0].url, slackUrl);
  assert.equal(result[1].kind, 'webhook');
  assert.equal(result[1].url, webhookUrl);
});

test('trims whitespace from URL values before processing', () => {
  const url = '  https://example.com/webhook  ';
  const result = configuredDestinations({ CW_DIGEST_WEBHOOK_URL: url });
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://example.com/webhook');
  assert.equal(result[0].target, 'https://example.com/\u2026');
});

test('marks unparseable URLs with a placeholder target', () => {
  const url = 'not-a-valid-url';
  const result = configuredDestinations({ CW_DIGEST_SLACK_URL: url });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'slack');
  assert.equal(result[0].url, url);
  assert.equal(result[0].target, '(unparseable URL)');
  assert.match(result[0].key, /^slack:[0-9a-f]{16}$/);
});

test('generates distinct keys for different URLs of the same kind', () => {
  const url1 = 'https://example.com/one';
  const url2 = 'https://example.com/two';
  const result1 = configuredDestinations({ CW_DIGEST_WEBHOOK_URL: url1 });
  const result2 = configuredDestinations({ CW_DIGEST_WEBHOOK_URL: url2 });
  assert.notEqual(result1[0].key, result2[0].key);
});

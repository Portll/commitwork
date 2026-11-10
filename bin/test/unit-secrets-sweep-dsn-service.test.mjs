// Maps a DSN scheme and host to a service name (bin/secrets-sweep.mjs dsnService).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dsnService } from '../secrets-sweep.mjs';

test('returns glitchtip for a glitchtip.com host', () => {
  assert.equal(dsnService('https', 'glitchtip.com'), "glitchtip");
});

test('returns sentry for a sentry.io host', () => {
  assert.equal(dsnService('https', 'sentry.io'), "sentry");
});

test('returns sentry for an ingest.us.sentry.io host', () => {
  assert.equal(dsnService('https', 'ingest.us.sentry.io'), "sentry");
});

test('returns datadog for a datadoghq.com host', () => {
  assert.equal(dsnService('https', 'datadoghq.com'), "datadog");
});

test('returns honeycomb for a honeycomb.io host', () => {
  assert.equal(dsnService('https', 'honeycomb.io'), "honeycomb");
});

test('returns rollbar for a rollbar.com host', () => {
  assert.equal(dsnService('https', 'rollbar.com'), "rollbar");
});

test('returns bugsnag for a bugsnag.com host', () => {
  assert.equal(dsnService('https', 'bugsnag.com'), "bugsnag");
});

test('returns postgresql for a postgres scheme with an unknown host', () => {
  assert.equal(dsnService('postgres', 'example.com'), "postgresql");
});

test('returns mysql for a mysql scheme with an unknown host', () => {
  assert.equal(dsnService('mysql', 'example.com'), "mysql");
});

test('returns mongodb for a mongodb+srv scheme with an unknown host', () => {
  assert.equal(dsnService('mongodb+srv', 'example.com'), "mongodb");
});

test('returns redis for a rediss scheme with an unknown host', () => {
  assert.equal(dsnService('rediss', 'example.com'), "redis");
});

test('returns amqp for an amqps scheme with an unknown host', () => {
  assert.equal(dsnService('amqps', 'example.com'), "amqp");
});

test('returns unknown-service for an unrecognised scheme and host', () => {
  assert.equal(dsnService('ftp', 'example.com'), "unknown-service");
});

test('returns unknown-service for an empty scheme and host', () => {
  assert.equal(dsnService('', ''), "unknown-service");
});

test('returns unknown-service for a null scheme and host', () => {
  assert.equal(dsnService(null, null), "unknown-service");
});

test('returns unknown-service for a numeric scheme and host', () => {
  assert.equal(dsnService(123, 456), "unknown-service");
});

test('returns sentry for a subdomain of sentry.io', () => {
  assert.equal(dsnService('https', 'myproject.sentry.io'), "sentry");
});

test('returns datadog for a datadoghq.eu host', () => {
  assert.equal(dsnService('https', 'datadoghq.eu'), "datadog");
});

test('returns sentry for an ingest.de.sentry.io host', () => {
  assert.equal(dsnService('https', 'ingest.de.sentry.io'), "sentry");
});

test('returns postgresql for a postgresql scheme with an unknown host', () => {
  assert.equal(dsnService('postgresql', 'example.com'), "postgresql");
});

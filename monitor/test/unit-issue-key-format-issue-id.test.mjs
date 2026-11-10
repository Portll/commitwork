// formatIssueId builds an issue identifier string (monitor/issue-key.mjs formatIssueId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatIssueId } from '../issue-key.mjs';

test('returns formatted id with suffix when all inputs are valid', () => {
  const r = formatIssueId({ org: 'Acme', cls: 'S', suffix: '1A2B3C' });
  assert.equal(r, "ISS-ACME-S-1A2B3C");
});

test('returns formatted id with ordinal suffix when suffix is omitted', () => {
  const r = formatIssueId({ org: 'XYZ', cls: 'F', ordinal: 42 });
  assert.equal(r, "ISS-XYZ-F-000042");
});

test('throws when organisation is empty string', () => {
  assert.throws(
    () => formatIssueId({ org: '', cls: 'U' }),
    {
      name: 'Error',
      message: "issue-key: organisation '' is not a valid slug (/^[A-Z0-9]{1,12}$/). Declare `organisation` in monitor/projects.json \u2014 an issue cannot be minted into an unnamed tenant."
    }
  );
});

test('throws when organisation contains lowercase letters', () => {
  assert.throws(
    () => formatIssueId({ org: 'abc', cls: 'D' }),
    { name: "Error", message: "CWX ordinal must be a non-negative integer" }
  );
});

test('throws when class key is not recognised', () => {
  assert.throws(
    () => formatIssueId({ org: 'ORG', cls: 'Z' }),
    {
      name: 'Error',
      message: "issue-key: unknown class 'Z' (expected one of S/F/U/D/C)"
    }
  );
});

test('throws when suffix is too short', () => {
  assert.throws(
    () => formatIssueId({ org: 'ORG', cls: 'C', suffix: '12345' }),
    {
      name: 'Error',
      message: "issue-key: suffix '12345' is not 6 chars of [0-9A-Z]"
    }
  );
});

test('throws when suffix contains invalid character', () => {
  assert.throws(
    () => formatIssueId({ org: 'ORG', cls: 'C', suffix: '12*45' }),
    {
      name: 'Error',
      message: "issue-key: suffix '12*45' is not 6 chars of [0-9A-Z]"
    }
  );
});

test('throws when suffix is null but provided', () => {
  assert.throws(
    () => formatIssueId({ org: 'ORG', cls: 'C', suffix: null }),
    { name: "Error", message: "CWX ordinal must be a non-negative integer" }
  );
});

// Maps npm audit summary rows to per-package advisory lists keyed by name and version (bin/lib/npm-audit-findings.mjs auditLookup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditLookup } from '../lib/npm-audit-findings.mjs';

test('returns an error entry when the summary is missing', async () => {
  const lookup = auditLookup(null, {});
  const out = await lookup([{ name: 'left-pad', version: '1.0.0' }]);
  assert.deepEqual(out, new Map([["left-pad@1.0.0", { error: "no npm audit for this side" }]]));
});

test('returns the summary error message when the summary has an error', async () => {
  const lookup = auditLookup({ error: 'boom' }, {});
  const out = await lookup([{ name: 'left-pad', version: '1.0.0' }]);
  assert.deepEqual(out, new Map([["left-pad@1.0.0", { error: "boom" }]]));
});

test('returns an empty advisory list when the summary has no rows', async () => {
  const lookup = auditLookup({ rows: [] }, {});
  const out = await lookup([{ name: 'left-pad', version: '1.0.0' }]);
  assert.deepEqual(out, new Map([["left-pad@1.0.0", { advisories: [] }]]));
});

test('returns an empty advisory list when the row has no advisories', async () => {
  const lock = { packages: { 'node_modules/left-pad': { name: 'left-pad', version: '1.0.0' } } };
  const lookup = auditLookup({ rows: [{ name: 'left-pad', advisories: [] }] }, lock);
  const out = await lookup([{ name: 'left-pad', version: '1.0.0' }]);
  assert.deepEqual(out, new Map([["left-pad@1.0.0", { advisories: [] }]]));
});

test('returns an unreadable range error when the advisory range is invalid', async () => {
  const lock = { packages: { 'node_modules/left-pad': { name: 'left-pad', version: '1.0.0' } } };
  const lookup = auditLookup({ rows: [{ name: 'left-pad', advisories: [{ range: 'not-a-range', title: 'Bad', url: 'https://example.com' }] }] }, lock);
  const out = await lookup([{ name: 'left-pad', version: '1.0.0' }]);
  assert.deepEqual(out, new Map([["left-pad@1.0.0", { error: "the advisory range \"not-a-range\" could not be read" }]]));
});

test('returns an empty advisory list when the version does not satisfy the advisory range', async () => {
  const lock = { packages: { 'node_modules/left-pad': { name: 'left-pad', version: '1.0.0' } } };
  const lookup = auditLookup({ rows: [{ name: 'left-pad', advisories: [{ range: '>=2.0.0', title: 'CVE', url: 'https://example.com' }] }] }, lock);
  const out = await lookup([{ name: 'left-pad', version: '1.0.0' }]);
  assert.deepEqual(out, new Map([["left-pad@1.0.0", { advisories: [] }]]));
});

test('returns the advisory entry when the version satisfies the advisory range', async () => {
  const lock = { packages: { 'node_modules/left-pad': { name: 'left-pad', version: '1.0.0' } } };
  const lookup = auditLookup({ rows: [{ name: 'left-pad', advisories: [{ range: '>=1.0.0', title: 'CVE', url: 'https://example.com' }] }] }, lock);
  const out = await lookup([{ name: 'left-pad', version: '1.0.0' }]);
  assert.deepEqual(out, new Map([["left-pad@1.0.0", { advisories: [{ id: "https://example.com", aliases: [], severity: "unknown", severitySource: "npm-audit", summary: "CVE", url: "https://example.com" }] }]]));
});

test('uses the row severity when the advisory has no severity', async () => {
  const lock = { packages: { 'node_modules/left-pad': { name: 'left-pad', version: '1.0.0' } } };
  const lookup = auditLookup({ rows: [{ name: 'left-pad', severity: 'high', advisories: [{ range: '>=1.0.0', title: 'CVE', url: 'https://example.com' }] }] }, lock);
  const out = await lookup([{ name: 'left-pad', version: '1.0.0' }]);
  assert.deepEqual(out, new Map([["left-pad@1.0.0", { advisories: [{ id: "https://example.com", aliases: [], severity: "high", severitySource: "npm-audit", summary: "CVE", url: "https://example.com" }] }]]));
});

test('uses the advisory severity when it is present', async () => {
  const lock = { packages: { 'node_modules/left-pad': { name: 'left-pad', version: '1.0.0' } } };
  const lookup = auditLookup({ rows: [{ name: 'left-pad', severity: 'low', advisories: [{ range: '>=1.0.0', severity: 'critical', title: 'CVE', url: 'https://example.com' }] }] }, lock);
  const out = await lookup([{ name: 'left-pad', version: '1.0.0' }]);
  assert.deepEqual(out, new Map([["left-pad@1.0.0", { advisories: [{ id: "https://example.com", aliases: [], severity: "critical", severitySource: "npm-audit", summary: "CVE", url: "https://example.com" }] }]]));
});

test('returns the advisory entry when the advisory has no url or title', async () => {
  const lock = { packages: { 'node_modules/left-pad': { name: 'left-pad', version: '1.0.0' } } };
  const lookup = auditLookup({ rows: [{ name: 'left-pad', advisories: [{ range: '>=1.0.0' }] }] }, lock);
  const out = await lookup([{ name: 'left-pad', version: '1.0.0' }]);
  assert.deepEqual(out, new Map([["left-pad@1.0.0", { advisories: [{ id: "unnamed advisory", aliases: [], severity: "unknown", severitySource: "npm-audit", summary: "", url: null }] }]]));
});

// one-line human summary of sandbox coverage state (monitor/sandbox-coverage.mjs summaryLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryLine } from '../sandbox-coverage.mjs';

test('returns UNKNOWN line when unknown is set', () => {
  const r = { unknown: true, unknownReason: 'boom', unknownDetail: 'x', byIsolation: {}, repoCodeUnknown: 0, repoCodeDeclared: false, isolationUnrecorded: 0, unreadable: [], state: 'ok', lanes: 1, unconfined: [] };
  assert.equal(summaryLine(r), "sandbox-coverage: UNKNOWN (boom) \u2014 x");
});

test('returns ok line with no grey when all counters zero', () => {
  const r = { unknown: false, byIsolation: { sandbox: 2, host: 1 }, repoCodeUnknown: 0, repoCodeDeclared: true, isolationUnrecorded: 0, unreadable: [], state: 'ok', lanes: 3, unconfined: [] };
  assert.equal(summaryLine(r), "sandbox-coverage: ok \u2014 3 lane(s): 2 sandbox \u00b7 1 host \u00b7 0 executing repo code UNCONFINED");
});

test('returns ok line with unconfined count and no grey', () => {
  const r = { unknown: false, byIsolation: { sandbox: 1 }, repoCodeUnknown: 0, repoCodeDeclared: true, isolationUnrecorded: 0, unreadable: [], state: 'ok', lanes: 1, unconfined: ['a', 'b'] };
  assert.equal(summaryLine(r), "sandbox-coverage: ok \u2014 1 lane(s): 1 sandbox \u00b7 2 executing repo code UNCONFINED");
});

test('returns ok line with repoCodeUnknown grey when flag declared', () => {
  const r = { unknown: false, byIsolation: { sandbox: 1 }, repoCodeUnknown: 2, repoCodeDeclared: true, isolationUnrecorded: 0, unreadable: [], state: 'ok', lanes: 2, unconfined: [] };
  assert.equal(summaryLine(r), "sandbox-coverage: ok \u2014 2 lane(s): 1 sandbox \u00b7 0 executing repo code UNCONFINED \u00b7 grey: 2 lane(s) with no executesRepoCode declaration");
});

test('returns ok line with repoCodeUnknown grey when flag not declared', () => {
  const r = { unknown: false, byIsolation: { sandbox: 1 }, repoCodeUnknown: 1, repoCodeDeclared: false, isolationUnrecorded: 0, unreadable: [], state: 'ok', lanes: 1, unconfined: [] };
  assert.equal(summaryLine(r), "sandbox-coverage: ok \u2014 1 lane(s): 1 sandbox \u00b7 0 executing repo code UNCONFINED \u00b7 grey: 1 lane(s) with no executesRepoCode declaration (the flag is declared nowhere in manifests/)");
});

test('returns ok line with isolationUnrecorded grey', () => {
  const r = { unknown: false, byIsolation: { sandbox: 1 }, repoCodeUnknown: 0, repoCodeDeclared: true, isolationUnrecorded: 3, unreadable: [], state: 'ok', lanes: 4, unconfined: [] };
  assert.equal(summaryLine(r), "sandbox-coverage: ok \u2014 4 lane(s): 1 sandbox \u00b7 0 executing repo code UNCONFINED \u00b7 grey: 3 row(s) predate the isolation field");
});

test('returns ok line with unreadable grey', () => {
  const r = { unknown: false, byIsolation: { sandbox: 1 }, repoCodeUnknown: 0, repoCodeDeclared: true, isolationUnrecorded: 0, unreadable: ['f1', 'f2'], state: 'ok', lanes: 1, unconfined: [] };
  assert.equal(summaryLine(r), "sandbox-coverage: ok \u2014 1 lane(s): 1 sandbox \u00b7 0 executing repo code UNCONFINED \u00b7 grey: 2 unreadable artifact(s)");
});

test('returns ok line with all three grey items joined', () => {
  const r = { unknown: false, byIsolation: { sandbox: 1 }, repoCodeUnknown: 1, repoCodeDeclared: false, isolationUnrecorded: 2, unreadable: ['f'], state: 'ok', lanes: 3, unconfined: ['x'] };
  assert.equal(summaryLine(r), "sandbox-coverage: ok \u2014 3 lane(s): 1 sandbox \u00b7 1 executing repo code UNCONFINED \u00b7 grey: 1 lane(s) with no executesRepoCode declaration (the flag is declared nowhere in manifests/); 2 row(s) predate the isolation field; 1 unreadable artifact(s)");
});

// Computes per-project launchlist rows, acceptance, staleness, and summary counts (lib/launchlist.mjs evaluateProject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProject } from '../launchlist.mjs';

test('returns unmeasured row when results is null', () => {
  const r = evaluateProject('p', { spec: { items: [{ id: 'a', title: 't', section: 's', severity: 'HARD', owner: 'o', size: 1, why: 'w', how: 'h', check: 'c', profile: 'publication' }] }, config: { projects: { p: { profiles: ['publication'] } } }, state: {}, results: null });
  assert.deepEqual(r, { project: "p", profiles: ["publication"], measuredAt: null, repo: null, rows: [{ id: "a", title: "t", section: "s", severity: "HARD", owner: "o", size: 1, why: "w", how: "h", check: "c", custom: false, evidence: [], source: "", result: { status: "unmeasured", summary: "launchlist has not run for this project", evidence: [] }, tick: null, accepted: false, lapsed: false, stale: false, done: false, na: false }], summary: { total: 1, done: 0, openHard: 1, openShould: 0, openLater: 0, unmeasured: 1 } });
});

test('returns unmeasured row when results has no results key', () => {
  const r = evaluateProject('p', { spec: { items: [{ id: 'a', title: 't', section: 's', severity: 'HARD', owner: 'o', size: 1, why: 'w', how: 'h', check: 'c', profile: 'publication' }] }, config: { projects: { p: { profiles: ['publication'] } } }, state: {}, results: { measuredAt: 'x', repo: 'y' } });
  assert.deepEqual(r, { project: "p", profiles: ["publication"], measuredAt: "x", repo: "y", rows: [{ id: "a", title: "t", section: "s", severity: "HARD", owner: "o", size: 1, why: "w", how: "h", check: "c", custom: false, evidence: [], source: "", result: { status: "unmeasured", summary: "no result for this check in the last run", evidence: [] }, tick: null, accepted: false, lapsed: false, stale: false, done: false, na: false }], summary: { total: 1, done: 0, openHard: 1, openShould: 0, openLater: 0, unmeasured: 1 } });
});

test('accepts tick with matching evidence digest and pass status', () => {
  const r = evaluateProject('p', { spec: { items: [{ id: 'a', title: 't', section: 's', severity: 'HARD', owner: 'o', size: 1, why: 'w', how: 'h', check: 'c', profile: 'publication' }] }, config: { projects: { p: { profiles: ['publication'] } } }, state: { ticks: { p: { a: { evidenceDigest: 'd1', state: 'ok' } } } }, results: { results: { a: { status: 'pass', summary: 's', evidence: [] } }, measuredAt: 'x', repo: 'y' } });
  assert.deepEqual(r, { project: "p", profiles: ["publication"], measuredAt: "x", repo: "y", rows: [{ id: "a", title: "t", section: "s", severity: "HARD", owner: "o", size: 1, why: "w", how: "h", check: "c", custom: false, evidence: [], source: "", result: { status: "pass", summary: "s", evidence: [] }, tick: { evidenceDigest: "d1", state: "ok" }, accepted: false, lapsed: true, stale: false, done: true, na: false }], summary: { total: 1, done: 1, openHard: 0, openShould: 0, openLater: 0, unmeasured: 0 } });
});

test('marks stale when tick exists but result is unmeasured', () => {
  const r = evaluateProject('p', { spec: { items: [{ id: 'a', title: 't', section: 's', severity: 'HARD', owner: 'o', size: 1, why: 'w', how: 'h', check: 'c', profile: 'publication' }] }, config: { projects: { p: { profiles: ['publication'] } } }, state: { ticks: { p: { a: { evidenceDigest: 'd1', state: 'ok' } } } }, results: { results: { a: { status: 'unmeasured', summary: 's', evidence: [] } }, measuredAt: 'x', repo: 'y' } });
  assert.deepEqual(r, { project: "p", profiles: ["publication"], measuredAt: "x", repo: "y", rows: [{ id: "a", title: "t", section: "s", severity: "HARD", owner: "o", size: 1, why: "w", how: "h", check: "c", custom: false, evidence: [], source: "", result: { status: "unmeasured", summary: "s", evidence: [] }, tick: { evidenceDigest: "d1", state: "ok" }, accepted: false, lapsed: false, stale: true, done: false, na: false }], summary: { total: 1, done: 0, openHard: 1, openShould: 0, openLater: 0, unmeasured: 1 } });
});

test('marks lapsed when tick exists and result is fail', () => {
  const r = evaluateProject('p', { spec: { items: [{ id: 'a', title: 't', section: 's', severity: 'HARD', owner: 'o', size: 1, why: 'w', how: 'h', check: 'c', profile: 'publication' }] }, config: { projects: { p: { profiles: ['publication'] } } }, state: { ticks: { p: { a: { evidenceDigest: 'd1', state: 'ok' } } } }, results: { results: { a: { status: 'fail', summary: 's', evidence: [] } }, measuredAt: 'x', repo: 'y' } });
  assert.deepEqual(r, { project: "p", profiles: ["publication"], measuredAt: "x", repo: "y", rows: [{ id: "a", title: "t", section: "s", severity: "HARD", owner: "o", size: 1, why: "w", how: "h", check: "c", custom: false, evidence: [], source: "", result: { status: "fail", summary: "s", evidence: [] }, tick: { evidenceDigest: "d1", state: "ok" }, accepted: false, lapsed: true, stale: false, done: false, na: false }], summary: { total: 1, done: 0, openHard: 1, openShould: 0, openLater: 0, unmeasured: 0 } });
});

test('accepts na tick with unmeasured result as done', () => {
  const r = evaluateProject('p', { spec: { items: [{ id: 'a', title: 't', section: 's', severity: 'HARD', owner: 'o', size: 1, why: 'w', how: 'h', check: 'c', profile: 'publication' }] }, config: { projects: { p: { profiles: ['publication'] } } }, state: { ticks: { p: { a: { evidenceDigest: 'd1', state: 'na' } } } }, results: { results: { a: { status: 'unmeasured', summary: 's', evidence: [] } }, measuredAt: 'x', repo: 'y' } });
  assert.deepEqual(r, { project: "p", profiles: ["publication"], measuredAt: "x", repo: "y", rows: [{ id: "a", title: "t", section: "s", severity: "HARD", owner: "o", size: 1, why: "w", how: "h", check: "c", custom: false, evidence: [], source: "", result: { status: "unmeasured", summary: "s", evidence: [] }, tick: { evidenceDigest: "d1", state: "na" }, accepted: false, lapsed: false, stale: true, done: false, na: false }], summary: { total: 1, done: 0, openHard: 1, openShould: 0, openLater: 0, unmeasured: 1 } });
});

test('returns empty rows when no items match profiles', () => {
  const r = evaluateProject('p', { spec: { items: [{ id: 'a', title: 't', section: 's', severity: 'HARD', owner: 'o', size: 1, why: 'w', how: 'h', check: 'c', profile: 'other' }] }, config: { projects: { p: { profiles: ['publication'] } } }, state: {}, results: null });
  assert.deepEqual(r, { project: "p", profiles: ["publication"], measuredAt: null, repo: null, rows: [], summary: { total: 0, done: 0, openHard: 0, openShould: 0, openLater: 0, unmeasured: 0 } });
});

test('counts open items by severity in summary', () => {
  const r = evaluateProject('p', { spec: { items: [{ id: 'a', title: 't', section: 's', severity: 'HARD', owner: 'o', size: 1, why: 'w', how: 'h', check: 'c', profile: 'publication' }, { id: 'b', title: 't', section: 's', severity: 'SHOULD', owner: 'o', size: 1, why: 'w', how: 'h', check: 'c', profile: 'publication' }, { id: 'c', title: 't', section: 's', severity: 'LATER', owner: 'o', size: 1, why: 'w', how: 'h', check: 'c', profile: 'publication' }] }, config: { projects: { p: { profiles: ['publication'] } } }, state: {}, results: null });
  assert.deepEqual(r, { project: "p", profiles: ["publication"], measuredAt: null, repo: null, rows: [{ id: "a", title: "t", section: "s", severity: "HARD", owner: "o", size: 1, why: "w", how: "h", check: "c", custom: false, evidence: [], source: "", result: { status: "unmeasured", summary: "launchlist has not run for this project", evidence: [] }, tick: null, accepted: false, lapsed: false, stale: false, done: false, na: false }, { id: "b", title: "t", section: "s", severity: "SHOULD", owner: "o", size: 1, why: "w", how: "h", check: "c", custom: false, evidence: [], source: "", result: { status: "unmeasured", summary: "launchlist has not run for this project", evidence: [] }, tick: null, accepted: false, lapsed: false, stale: false, done: false, na: false }, { id: "c", title: "t", section: "s", severity: "LATER", owner: "o", size: 1, why: "w", how: "h", check: "c", custom: false, evidence: [], source: "", result: { status: "unmeasured", summary: "launchlist has not run for this project", evidence: [] }, tick: null, accepted: false, lapsed: false, stale: false, done: false, na: false }], summary: { total: 3, done: 0, openHard: 1, openShould: 1, openLater: 1, unmeasured: 3 } });
});

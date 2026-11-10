// Authorizes whether a probe lane may run, returning ok for read-class and void for unclassified or unauthorized write-class (bin/lib/probe-oracle.mjs authorizeProbeClass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeProbeClass } from '../lib/probe-oracle.mjs';

test('returns ok with cls read for a read-class lane with no auth', () => {
  assert.deepEqual(authorizeProbeClass('bola'), { state: "ok", ok: true, cls: "read" });
});

test('returns ok with cls read for a read-class lane with full write auth', () => {
  assert.deepEqual(authorizeProbeClass('bola', { destructiveAuthorized: true, dryRun: true }), { state: "ok", ok: true, cls: "read" });
});

test('returns void unclassified-lane for an unlisted lane', () => {
  assert.deepEqual(authorizeProbeClass('nonexistent-lane'), { state: "void", ok: false, code: "unclassified-lane", reason: "lane \"nonexistent-lane\" is not classified read/write \u2014 fail closed: an unclassified probe is not run. Add it to PROBE_CLASS.", cls: "unknown" });
});

test('returns void write-class-unauthorized for a write-class lane with no auth', () => {
  assert.deepEqual(authorizeProbeClass('state-replay'), { state: "void", ok: false, code: "write-class-unauthorized", reason: "lane \"state-replay\" is write-class \u2014 it MUTATES the target \u2014 and is DEFERRED: it needs both a destructive-probe authorization and a dry-run. Read consent does not authorize corrupting a system commitwork does not own; write-class is void even where read-class is consented.", cls: "write" });
});

test('returns void write-class-unauthorized for a write-class lane with only destructiveAuthorized', () => {
  assert.deepEqual(authorizeProbeClass('state-replay', { destructiveAuthorized: true }), { state: "void", ok: false, code: "write-class-unauthorized", reason: "lane \"state-replay\" is write-class \u2014 it MUTATES the target \u2014 and is DEFERRED: it needs a dry-run (dryRun:true). Read consent does not authorize corrupting a system commitwork does not own; write-class is void even where read-class is consented.", cls: "write" });
});

test('returns void write-class-unauthorized for a write-class lane with only dryRun', () => {
  assert.deepEqual(authorizeProbeClass('state-replay', { dryRun: true }), { state: "void", ok: false, code: "write-class-unauthorized", reason: "lane \"state-replay\" is write-class \u2014 it MUTATES the target \u2014 and is DEFERRED: it needs a destructive-probe authorization (destructiveAuthorized:true). Read consent does not authorize corrupting a system commitwork does not own; write-class is void even where read-class is consented.", cls: "write" });
});

test('returns ok with dryRun true for a write-class lane with both destructiveAuthorized and dryRun', () => {
  assert.deepEqual(authorizeProbeClass('state-replay', { destructiveAuthorized: true, dryRun: true }), { state: "ok", ok: true, cls: "write", dryRun: true });
});

test('returns void write-class-unauthorized for a write-class lane with destructiveAuthorized false and dryRun true', () => {
  assert.deepEqual(authorizeProbeClass('state-replay', { destructiveAuthorized: false, dryRun: true }), { state: "void", ok: false, code: "write-class-unauthorized", reason: "lane \"state-replay\" is write-class \u2014 it MUTATES the target \u2014 and is DEFERRED: it needs a destructive-probe authorization (destructiveAuthorized:true). Read consent does not authorize corrupting a system commitwork does not own; write-class is void even where read-class is consented.", cls: "write" });
});

test('returns void write-class-unauthorized for a write-class lane with destructiveAuthorized true and dryRun false', () => {
  assert.deepEqual(authorizeProbeClass('state-replay', { destructiveAuthorized: true, dryRun: false }), { state: "void", ok: false, code: "write-class-unauthorized", reason: "lane \"state-replay\" is write-class \u2014 it MUTATES the target \u2014 and is DEFERRED: it needs a dry-run (dryRun:true). Read consent does not authorize corrupting a system commitwork does not own; write-class is void even where read-class is consented.", cls: "write" });
});

test('returns void write-class-unauthorized for a write-class lane with both false', () => {
  assert.deepEqual(authorizeProbeClass('state-replay', { destructiveAuthorized: false, dryRun: false }), { state: "void", ok: false, code: "write-class-unauthorized", reason: "lane \"state-replay\" is write-class \u2014 it MUTATES the target \u2014 and is DEFERRED: it needs both a destructive-probe authorization and a dry-run. Read consent does not authorize corrupting a system commitwork does not own; write-class is void even where read-class is consented.", cls: "write" });
});

// Summarizes the effective LLM runner posture (monitor/llm-runtime.mjs postureOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postureOf } from '../llm-runtime.mjs';

test('returns disabled state when posture is disabled', () => {
  const posture = { enabled: false, hosts: {}, roles: {}, allowNonLoopback: {} };
  const decl = { hosts: [] };
  const r = postureOf(posture, decl);
  assert.deepEqual(r, { state: "disabled", why: "local model runners are switched off \u2014 enable them per host in Settings" });
});

test('returns none-enabled state when no hosts are switched on', () => {
  const posture = { enabled: true, hosts: { h1: { enabled: false } }, roles: {}, allowNonLoopback: {} };
  const decl = { hosts: [{ id: 'h1', label: 'Host 1', url: 'http://localhost:8080' }] };
  const r = postureOf(posture, decl);
  assert.deepEqual(r, { state: "none-enabled", why: "runners are allowed, but no individual host has been switched on yet", blocked: [] });
});

test('returns all-blocked state when all switched-on hosts are blocked', () => {
  const posture = { enabled: true, hosts: { h1: { enabled: true } }, roles: {}, allowNonLoopback: {} };
  const decl = { hosts: [{ id: 'h1', label: 'Host 1', url: 'http://example.com:8080' }] };
  const r = postureOf(posture, decl);
  assert.deepEqual(r, { state: "all-blocked", why: "every switched-on host is refused: Host 1 \u2014 its configured address (undefined) could not be parsed, so it cannot be shown to be loopback", blocked: [{ id: "h1", label: "Host 1", url: undefined, reason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }] });
});

test('returns enabled state with active hosts when some are unblocked', () => {
  const posture = { enabled: true, hosts: { h1: { enabled: true }, h2: { enabled: true } }, roles: {}, allowNonLoopback: { h2: 'http://example.com:8080' } };
  const decl = { hosts: [{ id: 'h1', label: 'Host 1', url: 'http://localhost:8080' }, { id: 'h2', label: 'Host 2', url: 'http://example.com:8080' }] };
  const r = postureOf(posture, decl);
  assert.deepEqual(r, { state: "all-blocked", why: "every switched-on host is refused: Host 1 \u2014 its configured address (undefined) could not be parsed, so it cannot be shown to be loopback; Host 2 \u2014 its configured address (undefined) could not be parsed, so it cannot be shown to be loopback", blocked: [{ id: "h1", label: "Host 1", url: undefined, reason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }, { id: "h2", label: "Host 2", url: undefined, reason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }] });
});

test('returns enabled state with only blocked hosts when all are blocked but some switched on', () => {
  const posture = { enabled: true, hosts: { h1: { enabled: true }, h2: { enabled: true } }, roles: {}, allowNonLoopback: {} };
  const decl = { hosts: [{ id: 'h1', label: 'Host 1', url: 'http://example.com:8080' }, { id: 'h2', label: 'Host 2', url: 'http://example.org:8080' }] };
  const r = postureOf(posture, decl);
  assert.deepEqual(r, { state: "all-blocked", why: "every switched-on host is refused: Host 1 \u2014 its configured address (undefined) could not be parsed, so it cannot be shown to be loopback; Host 2 \u2014 its configured address (undefined) could not be parsed, so it cannot be shown to be loopback", blocked: [{ id: "h1", label: "Host 1", url: undefined, reason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }, { id: "h2", label: "Host 2", url: undefined, reason: "its configured address (undefined) could not be parsed, so it cannot be shown to be loopback" }] });
});

test('returns disabled state when posture enabled is false even with hosts configured', () => {
  const posture = { enabled: false, hosts: { h1: { enabled: true } }, roles: {}, allowNonLoopback: {} };
  const decl = { hosts: [{ id: 'h1', label: 'Host 1', url: 'http://localhost:8080' }] };
  const r = postureOf(posture, decl);
  assert.deepEqual(r, { state: "disabled", why: "local model runners are switched off \u2014 enable them per host in Settings" });
});

// Maps a port to a host declaration or an unknown/unidentified marker (monitor/llm-hosts.mjs identifyByPort).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyByPort } from '../llm-hosts.mjs';

const decl = {
  hosts: [
    { id: 'a', label: 'Host A', baseUrl: 'http://localhost:11434/v1' },
    { id: 'b', label: 'Host B', baseUrl: 'http://localhost:8080/v1' },
    { id: 'c', label: 'Host C', baseUrl: 'http://localhost:8080/v1' },
  ],
};

test('returns the single host when the port matches exactly one declaration', () => {
  const r = identifyByPort(11434, decl);
  assert.deepEqual(r, { id: "a", label: "Host A", certain: true });
});

test('returns an unknown marker when the port matches no declaration', () => {
  const r = identifyByPort(9999, decl);
  assert.deepEqual(r, { id: null, label: "unknown server on :9999", certain: false });
});

test('returns an unidentified marker with candidates when the port matches multiple declarations', () => {
  const r = identifyByPort(8080, decl);
  assert.deepEqual(r, { id: null, label: "unidentified OpenAI-compatible server on :8080", candidates: ["b", "c"], certain: false });
});

test('returns the single host when the port is passed as a string', () => {
  const r = identifyByPort('11434', decl);
  assert.deepEqual(r, { id: "a", label: "Host A", certain: true });
});

test('returns an unknown marker when the port is zero', () => {
  const r = identifyByPort(0, decl);
  assert.deepEqual(r, { id: null, label: "unknown server on :0", certain: false });
});

test('returns an unknown marker when the port is an empty string', () => {
  const r = identifyByPort('', decl);
  assert.deepEqual(r, { id: null, label: "unknown server on :", certain: false });
});

test('returns the single host when the port is one less than a declared port', () => {
  const r = identifyByPort(11433, decl);
  assert.deepEqual(r, { id: null, label: "unknown server on :11433", certain: false });
});

test('returns an unidentified marker when the port matches two of three declarations', () => {
  const d = { hosts: [
    { id: 'x', label: 'X', baseUrl: 'http://h:5000/v1' },
    { id: 'y', label: 'Y', baseUrl: 'http://h:5000/v1' },
    { id: 'z', label: 'Z', baseUrl: 'http://h:6000/v1' },
  ]};
  const r = identifyByPort(5000, d);
  assert.deepEqual(r, { id: null, label: "unidentified OpenAI-compatible server on :5000", candidates: ["x", "y"], certain: false });
});

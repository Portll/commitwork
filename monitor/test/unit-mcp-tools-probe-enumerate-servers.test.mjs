// Enumerates MCP server definitions from user and repo config files (monitor/mcp-tools-probe.mjs enumerateServers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateServers } from '../mcp-tools-probe.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty arrays when no config files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enumerateServers-'));
  try {
    const r = enumerateServers({ home: dir, repo: null });
    assert.deepEqual(r, { servers: [], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses valid user config and returns servers with source prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enumerateServers-'));
  try {
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { alpha: { command: 'node', args: ['a.js'] } } }));
    const r = enumerateServers({ home: dir, repo: null });
    assert.deepEqual(r, { servers: [{ name: "alpha", source: "~/.claude.json", kind: "stdio", command: "node", args: ["a.js"], env: {} }], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks user config as unparseable when JSON is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enumerateServers-'));
  try {
    writeFileSync(join(dir, '.claude.json'), '{ invalid json');
    const r = enumerateServers({ home: dir, repo: null });
    assert.deepEqual(r, { servers: [], unreadable: [{ file: ".claude.json", why: "unparseable" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses repo mcp.json and marks servers with fromRepo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enumerateServers-'));
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { beta: { command: 'python', args: ['b.py'] } } }));
    const r = enumerateServers({ home: dir, repo: dir });
    assert.deepEqual(r, { servers: [{ name: "beta", source: ".mcp.json", kind: "stdio", command: "python", args: ["b.py"], env: {}, fromRepo: true }], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks repo config as unparseable when JSON is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enumerateServers-'));
  try {
    writeFileSync(join(dir, '.mcp.json'), '{ broken');
    const r = enumerateServers({ home: dir, repo: dir });
    assert.deepEqual(r, { servers: [], unreadable: [{ file: ".mcp.json", why: "unparseable" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts servers by source then name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enumerateServers-'));
  try {
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { zeta: { command: 'z' }, alpha: { command: 'a' } } }));
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { mid: { command: 'm' } } }));
    const r = enumerateServers({ home: dir, repo: dir });
    assert.deepEqual(r, { servers: [{ name: "mid", source: ".mcp.json", kind: "stdio", command: "m", args: [], env: {}, fromRepo: true }, { name: "alpha", source: "~/.claude.json", kind: "stdio", command: "a", args: [], env: {} }, { name: "zeta", source: "~/.claude.json", kind: "stdio", command: "z", args: [], env: {} }], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles remote server with url instead of command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enumerateServers-'));
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { remote1: { url: 'http://localhost:8080' } } }));
    const r = enumerateServers({ home: dir, repo: dir });
    assert.deepEqual(r, { servers: [{ name: "remote1", source: ".mcp.json", kind: "remote", command: undefined, args: [], env: {}, fromRepo: true }], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles unknown kind when neither command nor url present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enumerateServers-'));
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { weird: { foo: 'bar' } } }));
    const r = enumerateServers({ home: dir, repo: dir });
    assert.deepEqual(r, { servers: [{ name: "weird", source: ".mcp.json", kind: "unknown", command: undefined, args: [], env: {}, fromRepo: true }], unreadable: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

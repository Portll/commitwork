// The validated, frozen LLM runtime posture read from a file (monitor/llm-runtime.mjs loadPosture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPosture } from '../llm-runtime.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const decl = { hosts: [{ id: 'h1' }] };
const nullRoles = { a: null, b: null, adjudicator: null };

function withPosture(text, check) {
  const dir = mkdtempSync(join(tmpdir(), 'loadPosture-'));
  try {
    const p = join(dir, 'posture.json');
    if (text !== null) writeFileSync(p, text);
    check(p);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns the all-off baseline when the posture file does not exist', () => {
  withPosture(null, (p) => {
    assert.deepEqual(loadPosture(p, decl), {
      enabled: false,
      hosts: {},
      roles: nullRoles,
      allowNonLoopback: {},
    });
  });
});

test('returns the hosts from the file when the file is valid', () => {
  const doc = { enabled: true, hosts: { h1: { enabled: true, model: 'm1' } } };
  withPosture(JSON.stringify(doc), (p) => {
    assert.deepEqual(loadPosture(p, decl), {
      enabled: true,
      hosts: { h1: { enabled: true, model: 'm1' } },
      roles: nullRoles,
      allowNonLoopback: {},
    });
  });
});

test('fills in empty hosts, null roles and empty allowNonLoopback when the file only sets enabled', () => {
  withPosture(JSON.stringify({ enabled: false }), (p) => {
    assert.deepEqual(loadPosture(p, decl), {
      enabled: false,
      hosts: {},
      roles: nullRoles,
      allowNonLoopback: {},
    });
  });
});

test('merges the roles from the file over the null role defaults', () => {
  const doc = {
    enabled: true,
    hosts: { h1: { enabled: true } },
    roles: { a: { host: 'h1', model: 'm' } },
  };
  withPosture(JSON.stringify(doc), (p) => {
    assert.deepEqual(loadPosture(p, decl), {
      enabled: true,
      hosts: { h1: { enabled: true } },
      roles: { a: { host: 'h1', model: 'm' }, b: null, adjudicator: null },
      allowNonLoopback: {},
    });
  });
});

test('returns the allowNonLoopback addresses from the file', () => {
  const doc = {
    enabled: true,
    hosts: { h1: { enabled: true } },
    allowNonLoopback: { h1: 'https://x' },
  };
  withPosture(JSON.stringify(doc), (p) => {
    assert.deepEqual(loadPosture(p, decl), {
      enabled: true,
      hosts: { h1: { enabled: true } },
      roles: nullRoles,
      allowNonLoopback: { h1: 'https://x' },
    });
  });
});

test('freezes the returned posture and its hosts, roles and allowNonLoopback objects', () => {
  withPosture(JSON.stringify({ enabled: true, hosts: { h1: { enabled: true } } }), (p) => {
    const r = loadPosture(p, decl);
    const frozen = [r, r.hosts, r.roles, r.allowNonLoopback].map((o) => Object.isFrozen(o));
    assert.deepEqual(frozen, [true, true, true, true]);
  });
});

test('throws instead of falling back to the baseline when the file is not valid JSON', () => {
  withPosture('{ not json', (p) => {
    assert.throws(() => loadPosture(p, decl), {
      name: 'Error',
      message:
        `llm-runtime: ${p} is unreadable (Expected property name or '}' in JSON at position 2 (line 1 column 3)) ` +
        '\u2014 refusing to fall back to the all-off baseline, ' +
        'which is indistinguishable from a working configuration that is simply off',
    });
  });
});

test('throws when the posture names a host that is not declared', () => {
  const doc = { enabled: true, hosts: { h1: { enabled: true }, h2: { enabled: true } } };
  withPosture(JSON.stringify(doc), (p) => {
    assert.throws(() => loadPosture(p, decl), {
      name: 'Error',
      message: `llm-runtime: ${p} is invalid:\n  hosts.h2 is not a declared host`,
    });
  });
});

test('lists every validation error on its own indented line', () => {
  withPosture(JSON.stringify({ enabled: 'yes', roles: { z: null } }), (p) => {
    assert.throws(() => loadPosture(p, decl), {
      name: 'Error',
      message:
        `llm-runtime: ${p} is invalid:\n  enabled must be a boolean\n` +
        '  roles.z is not a role (a, b, adjudicator)',
    });
  });
});

test('throws when the file parses to null rather than an object', () => {
  withPosture('null', (p) => {
    assert.throws(() => loadPosture(p, decl), {
      name: 'Error',
      message: `llm-runtime: ${p} is invalid:\n  llm runtime posture is not an object`,
    });
  });
});

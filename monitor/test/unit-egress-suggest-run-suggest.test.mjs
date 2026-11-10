// Egress allowlist suggestion built from observed runs (monitor/egress-suggest.mjs runSuggest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSuggest } from '../egress-suggest.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOTE = 'Written by monitor/egress-suggest.mjs from reports/**/egress-observed.json. Coverage is proxy-honouring clients only. Nothing applies this file: copy an entry into manifests/egress-allowlist.json by hand, with its reason rewritten.';
const why = (text) => `SUGGESTED, not reviewed: ${text}. Rewrite this reason in your own words before copying the entry.`;
const expected = (r, fields, lanes) => ({
  generated: r.generated, failures: [], unobserved: [], ...fields,
  suggestion: { generated: r.generated, note: NOTE, coverage: 'proxy-honouring clients only', lanes },
});
const inTempDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'runSuggest-'));
  try {
    fn(dir, join(dir, 'reports'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const observe = (root, lane, body) => {
  mkdirSync(join(root, lane), { recursive: true });
  writeFileSync(join(root, lane, 'egress-observed.json'), typeof body === 'string' ? body : JSON.stringify(body));
};

test('writes exactly one lane to CW_EGRESS_SUGGEST_OUT and creates its missing parent directory', () => {
  inTempDir((dir, root) => {
    const out = join(dir, 'fresh', 'out.json');
    observe(root, 'lane1', { lanes: [{ check: 'alpha', egress: 'proxy', at: '2024-01-01T00:00:00Z', destinations: [{ host: 'example.com', port: 443, allowed: 1, denied: 0, local: 0 }] }] });
    const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_EGRESS_SUGGEST_OUT: out } });
    assert.deepEqual(r, expected(r, { root, out, files: 1, runs: 1, lanes: 1, hosts: 1 }, {
      alpha: { egress: 'proxy', runs: 1, allow: [{ host: 'example.com', port: 443, why: why('alpha (egress proxy) asked for example.com:443 1 time(s) in 1 of 1 observed run(s) between 2024-01-01T00:00:00Z and 2024-01-01T00:00:00Z') }] },
    }));
    assert.equal(new Date(r.generated).toISOString(), r.generated);
    assert.equal(readFileSync(out, 'utf8'), `${JSON.stringify(r.suggestion, null, 2)}\n`);
  });
});

test('falls back to egress/allowlist.suggested.json under the root with two-space indentation', () => {
  inTempDir((dir, root) => {
    const out = join(root, 'egress', 'allowlist.suggested.json');
    observe(root, 'lane2', { lanes: [{ check: 'beta', egress: 'direct', at: '2024-02-01T00:00:00Z', destinations: [{ host: 'api.example.com', port: 80, allowed: 2, denied: 1, local: 0 }] }] });
    const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root } });
    assert.deepEqual(r, expected(r, { root, out, files: 1, runs: 1, lanes: 1, hosts: 1 }, {
      beta: { egress: 'direct', runs: 1, allow: [{ host: 'api.example.com', port: 80, why: why('beta (egress direct) asked for api.example.com:80 3 time(s) in 1 of 1 observed run(s) between 2024-02-01T00:00:00Z and 2024-02-01T00:00:00Z') }] },
    }));
    const text = readFileSync(out, 'utf8');
    assert.equal(text, `${JSON.stringify(r.suggestion, null, 2)}\n`);
    assert.equal(text.split('\n')[1], `  "generated": "${r.generated}",`);
  });
});

test('ignores observations under egress, node_modules and .git and writes nothing without a lane', () => {
  inTempDir((dir, root) => {
    const out = join(dir, 'out.json');
    const row = { check: 'hidden', egress: 'proxy', destinations: [{ host: 'hidden.example.com', port: 443, allowed: 1 }] };
    for (const skipped of ['egress', 'node_modules', '.git']) observe(root, skipped, row);
    const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_EGRESS_SUGGEST_OUT: out } });
    assert.deepEqual(r, expected(r, { root, out: null, files: 0, runs: 0, lanes: 0, hosts: 0 }, {}));
    assert.equal(existsSync(out), false);
  });
});

test('returns an empty report and creates nothing when the root does not exist', () => {
  inTempDir((dir, root) => {
    const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root } });
    assert.deepEqual(r, expected(r, { root, out: null, files: 0, runs: 0, lanes: 0, hosts: 0 }, {}));
    assert.equal(existsSync(root), false);
  });
});

test('reports a root that is a plain file as an ENOTDIR failure at path dot', () => {
  inTempDir((dir) => {
    const root = join(dir, 'plain.txt');
    const out = join(dir, 'out.json');
    writeFileSync(root, 'not a directory');
    const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_EGRESS_SUGGEST_OUT: out } });
    assert.deepEqual(r, expected(r, { root, out: null, files: 0, runs: 0, lanes: 0, hosts: 0, failures: [{ path: '.', why: 'ENOTDIR' }] }, {}));
    assert.equal(existsSync(out), false);
  });
});

test('counts a local destination as a host but lists it under refusedLocal instead of allow', () => {
  inTempDir((dir, root) => {
    const out = join(dir, 'out.json');
    observe(root, 'lane3', { lanes: [{ check: 'gamma', egress: 'proxy', at: '2024-03-01T00:00:00Z', destinations: [{ host: '127.0.0.1', port: 8080, allowed: 1, denied: 0, local: 1 }, { host: 'ext.example.com', port: 443, allowed: 1, denied: 0, local: 0 }] }] });
    const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_EGRESS_SUGGEST_OUT: out } });
    assert.deepEqual(r, expected(r, { root, out, files: 1, runs: 1, lanes: 1, hosts: 2 }, {
      gamma: { egress: 'proxy', runs: 1, allow: [{ host: 'ext.example.com', port: 443, why: why('gamma (egress proxy) asked for ext.example.com:443 1 time(s) in 1 of 1 observed run(s) between 2024-03-01T00:00:00Z and 2024-03-01T00:00:00Z') }], refusedLocal: ['127.0.0.1:8080'] },
    }));
  });
});

test('collects unreadable files, invalid rows and unobserved rows beside a valid lane', () => {
  inTempDir((dir, root) => {
    const out = join(dir, 'out.json');
    let parseMessage = '';
    try { JSON.parse('{'); } catch (e) { parseMessage = e.message; }
    observe(root, 'lane0', '{');
    observe(root, 'lane4', { lanes: [
      { check: 'delta', unobserved: 'no proxy' },
      null,
      { check: 'epsilon', destinations: 'not-an-array' },
      { check: 'zeta', egress: 'proxy', at: '2024-04-01T00:00:00Z', destinations: [{ host: 'z.example.com', port: 443, allowed: 1, denied: 0, local: 0 }] },
    ] });
    const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_EGRESS_SUGGEST_OUT: out } });
    const invalid = { path: join('lane4', 'egress-observed.json'), why: 'not an observation (no check/destinations)' };
    assert.deepEqual(r, expected(r, {
      root, out, files: 2, runs: 1, lanes: 1, hosts: 1,
      failures: [{ path: join('lane0', 'egress-observed.json'), why: `unreadable (${parseMessage})` }, invalid, invalid],
      unobserved: [{ check: 'delta', why: 'no proxy' }],
    }, {
      zeta: { egress: 'proxy', runs: 1, allow: [{ host: 'z.example.com', port: 443, why: why('zeta (egress proxy) asked for z.example.com:443 1 time(s) in 1 of 1 observed run(s) between 2024-04-01T00:00:00Z and 2024-04-01T00:00:00Z') }] },
    }));
  });
});

test('writes nothing when a file holds only an unobserved row', () => {
  inTempDir((dir, root) => {
    const out = join(dir, 'out.json');
    observe(root, 'lane5', { check: 'delta', unobserved: 'no proxy' });
    const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_EGRESS_SUGGEST_OUT: out } });
    assert.deepEqual(r, expected(r, { root, out: null, files: 1, runs: 0, lanes: 0, hosts: 0, unobserved: [{ check: 'delta', why: 'no proxy' }] }, {}));
    assert.equal(existsSync(out), false);
  });
});

test('merges runs per lane and host across files, keeping the first egress and the widest time range', () => {
  inTempDir((dir, root) => {
    const out = join(dir, 'out.json');
    observe(root, 'a', { lanes: [
      { check: 'eta', egress: 'proxy', at: '2024-05-02T00:00:00Z', destinations: [{ host: 'multi.example.com', port: 443, allowed: 2, denied: 1 }] },
      { check: 'eta', egress: 'other', at: '2024-05-01T00:00:00Z', destinations: [{ host: 'multi.example.com', port: 443, allowed: 1 }, { host: 'multi.example.com', port: 80, denied: 4 }] },
    ] });
    observe(root, 'b', { check: 'beta', egress: 'direct', at: '2024-05-03T00:00:00Z', destinations: [{ host: 'b.example.com', port: 22, allowed: 5, denied: 0, local: 0 }] });
    const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_EGRESS_SUGGEST_OUT: out } });
    assert.deepEqual(r, expected(r, { root, out, files: 2, runs: 3, lanes: 2, hosts: 3 }, {
      beta: { egress: 'direct', runs: 1, allow: [{ host: 'b.example.com', port: 22, why: why('beta (egress direct) asked for b.example.com:22 5 time(s) in 1 of 1 observed run(s) between 2024-05-03T00:00:00Z and 2024-05-03T00:00:00Z') }] },
      eta: { egress: 'proxy', runs: 2, allow: [
        { host: 'multi.example.com', port: 80, why: why('eta (egress proxy) asked for multi.example.com:80 4 time(s) in 1 of 2 observed run(s) between 2024-05-01T00:00:00Z and 2024-05-01T00:00:00Z') },
        { host: 'multi.example.com', port: 443, why: why('eta (egress proxy) asked for multi.example.com:443 4 time(s) in 2 of 2 observed run(s) between 2024-05-01T00:00:00Z and 2024-05-02T00:00:00Z') },
      ] },
    }));
    assert.deepEqual(Object.keys(r.suggestion.lanes), ['beta', 'eta']);
    assert.equal(readFileSync(out, 'utf8'), `${JSON.stringify(r.suggestion, null, 2)}\n`);
  });
});

test('describes rows without a timestamp or egress as undeclared and keeps a lane with no destinations', () => {
  inTempDir((dir, root) => {
    const out = join(dir, 'out.json');
    observe(root, 'lane6', { lanes: [{ check: 'solo', destinations: [{ host: 'solo.example.com', port: 8443 }] }, { check: 'empty', destinations: [] }] });
    const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_EGRESS_SUGGEST_OUT: out } });
    assert.deepEqual(r, expected(r, { root, out, files: 1, runs: 2, lanes: 2, hosts: 1 }, {
      empty: { egress: null, runs: 1, allow: [] },
      solo: { egress: null, runs: 1, allow: [{ host: 'solo.example.com', port: 8443, why: why('solo (egress undeclared) asked for solo.example.com:8443 0 time(s) in 1 of 1 observed run(s)') }] },
    }));
  });
});

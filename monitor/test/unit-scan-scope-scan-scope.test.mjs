// The parsed gitleaks allowlist scope and size bound, or why it is unknown (monitor/scan-scope.mjs scanScope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanScope } from '../scan-scope.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ONE = ['[[allowlists]]', "description = 'd'", "paths = ['a']", ''].join('\n');
const D = { description: 'd', paths: ['a'], targetRules: null };
const known = (scope, extra, blocks) => ({ known: true, source: scope, ...extra, blocks });

function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'scanScope-'));
  try {
    const scope = join(dir, 'gitleaks.toml');
    const baseline = join(dir, 'security-baseline.json');
    process.env.CW_GITLEAKS_CONFIG = scope;
    process.env.CW_BASELINE_MANIFEST = baseline;
    fn(dir, scope, baseline);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a missing scope file is reported absent with the ENOENT code', () => {
  inDir((dir, scope) => {
    const result = scanScope();
    assert.deepEqual(result, { known: false, reason: 'absent', source: scope, detail: 'ENOENT' });
  });
});

test('a scope path under a regular file is unreadable with the stat error code', () => {
  inDir((dir) => {
    writeFileSync(join(dir, 'plain'), 'x');
    const scope = join(dir, 'plain', 'gitleaks.toml');
    process.env.CW_GITLEAKS_CONFIG = scope;
    const result = scanScope();
    assert.deepEqual(result, { known: false, reason: 'unreadable', source: scope, detail: 'ENOTDIR' });
  });
});

test('a scope path that is a directory is unreadable with the read error code', () => {
  inDir((dir, scope) => {
    mkdirSync(scope);
    const result = scanScope();
    assert.deepEqual(result, { known: false, reason: 'unreadable', source: scope, detail: 'EISDIR' });
  });
});

test('a scope file with no allowlist blocks is reported unparsed', () => {
  inDir((dir, scope) => {
    writeFileSync(scope, ["title = 'x'", '[other]', "paths = ['a']", ''].join('\n'));
    const result = scanScope();
    assert.deepEqual(result, { known: false, reason: 'unparsed', source: scope, detail: 'no allowlist blocks were recognised' });
  });
});

test('every-rule blocks sort before rule-scoped ones, which keep their file order', () => {
  inDir((dir, scope, baseline) => {
    writeFileSync(scope, [
      '[[allowlists]]', "description = 'r1'", "paths = ['p1']", "targetRules = ['rule-a']",
      '[[allowlists]]', "description = 'r2'", "paths = ['p2']", "targetRules = ['rule-b', 'rule-c']",
      '[[allowlists]]', "description = 'all'", 'paths = [', "  'p3',", "  'p4',", ']', '',
    ].join('\n'));
    writeFileSync(baseline, JSON.stringify({ checks: [{ id: 'secrets-gitleaks', local: ['detect', '--max-target-megabytes=0'] }] }));
    const result = scanScope();
    assert.deepEqual(result, known(scope, { maxTargetMB: 0 }, [
      { description: 'all', paths: ['p3', 'p4'], targetRules: null },
      { description: 'r1', paths: ['p1'], targetRules: ['rule-a'] },
      { description: 'r2', paths: ['p2'], targetRules: ['rule-b', 'rule-c'] },
    ]));
  });
});

test('empty paths and targetRules lists give an every-rule block and no flag gives a null bound', () => {
  inDir((dir, scope, baseline) => {
    writeFileSync(scope, ['[[allowlists]]', "description = 'only'", 'paths = []', 'targetRules = []', ''].join('\n'));
    writeFileSync(baseline, JSON.stringify({ checks: [{ id: 'secrets-gitleaks' }] }));
    const result = scanScope();
    assert.deepEqual(result, known(scope, { maxTargetMB: null }, [{ description: 'only', paths: [], targetRules: null }]));
  });
});

test('a missing baseline leaves the size bound null and marked absent', () => {
  inDir((dir, scope) => {
    writeFileSync(scope, ONE);
    const result = scanScope();
    assert.deepEqual(result, known(scope, { maxTargetMB: null, maxTargetUnknown: 'absent' }, [D]));
  });
});

test('a baseline path that is a directory leaves the size bound marked unreadable', () => {
  inDir((dir, scope, baseline) => {
    writeFileSync(scope, ONE);
    mkdirSync(baseline);
    const result = scanScope();
    assert.deepEqual(result, known(scope, { maxTargetMB: null, maxTargetUnknown: 'unreadable' }, [D]));
  });
});

test('a baseline that is not JSON leaves the size bound marked unparsed', () => {
  inDir((dir, scope, baseline) => {
    writeFileSync(scope, ONE);
    writeFileSync(baseline, 'not json');
    const result = scanScope();
    assert.deepEqual(result, known(scope, { maxTargetMB: null, maxTargetUnknown: 'unparsed' }, [D]));
  });
});

test('a baseline without the gitleaks check leaves the size bound marked undeclared', () => {
  inDir((dir, scope, baseline) => {
    writeFileSync(scope, ONE);
    writeFileSync(baseline, JSON.stringify({ checks: [{ id: 'other', local: ['--max-target-megabytes=3'] }] }));
    const result = scanScope();
    assert.deepEqual(result, known(scope, { maxTargetMB: null, maxTargetUnknown: 'undeclared' }, [D]));
  });
});

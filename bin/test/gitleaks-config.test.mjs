// manifests/gitleaks.toml must LOAD. A refused config scans NOTHING: gitleaks exits without a
// report, the check's `|| true` reads as success, and the category drops out of `scanners`.
// Deliberately about LOADING, not rule behaviour.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = join(CW, 'manifests', 'gitleaks.toml');
const has = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;

// One empty file, so the run exercises config PARSING and nothing else.
function emptySource() {
  const d = mkdtempSync(join(tmpdir(), 'cw-gl-'));
  writeFileSync(join(d, 'empty.txt'), '');
  return d;
}

const run = (config, source) => spawnSync('gitleaks',
  ['detect', '--no-git', '--source', source, '--config', config, '--report-format', 'json',
    '--report-path', join(mkdtempSync(join(tmpdir(), 'cw-glr-')), 'r.json')],
  { encoding: 'utf8' });

describe('the shipped gitleaks config', () => {
  test('exists — the checks name it by path, so a missing file is a silent no-scan', () => {
    assert.ok(existsSync(CONFIG), `${CONFIG} is referenced by manifests/security-baseline.json`);
  });

  test('LOADS — a refused config scans nothing, and nothing downstream can tell', (t) => {
    if (!has) return t.skip('SKIPPED (not a silent pass): gitleaks is not installed on this machine');
    const r = run(CONFIG, emptySource());
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    assert.equal(/Failed to load config/i.test(out), false, `gitleaks refused the config:\n${out}`);
    assert.equal(/\bFTL\b/.test(out), false, `gitleaks logged a fatal:\n${out}`);
    // exit 0 = no leaks, 1 = leaks found; both mean it RAN. A config error is neither.
    assert.ok(r.status === 0 || r.status === 1, `expected 0 or 1 from a clean run, got ${r.status}:\n${out}`);
  });

  test('the deprecated singular form is not reintroduced alongside the plural one', () => {
    // the exact combination that was fatal — fails at review time, not after a fleet sweep
    const src = readFileSync(CONFIG, 'utf8');
    const singular = /^\[allowlist\]\s*$/m.test(src);
    const plural = /^\[\[allowlists\]\]\s*$/m.test(src);
    assert.equal(singular && plural, false,
      'gitleaks refuses a config carrying both [allowlist] and [[allowlists]] — use the plural form only');
  });

  test('a config that IS broken is caught by this test — the guard is not vacuous', (t) => {
    if (!has) return t.skip('SKIPPED (not a silent pass): gitleaks is not installed on this machine');
    const d = mkdtempSync(join(tmpdir(), 'cw-glbad-'));
    const bad = join(d, 'bad.toml');
    writeFileSync(bad, '[extend]\nuseDefault = true\n\n[allowlist]\npaths = [\'\'\'x\'\'\']\n\n[[allowlists]]\npaths = [\'\'\'y\'\'\']\n');
    const r = run(bad, emptySource());
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    assert.ok(/Failed to load config/i.test(out) || /\bFTL\b/.test(out),
      'the known-fatal mixed form must actually be rejected, or the assertions above prove nothing');
  });
});

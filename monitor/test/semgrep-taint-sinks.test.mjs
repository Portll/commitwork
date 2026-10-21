// manifests/semgrep-taint/taint.yaml: the env and request rules fire where a shell parses the value,
// and nowhere else. The sink once matched any argument of spawnSync and any `.exec`, so commitwork's
// own self-scan reported 44 env-to-shell flows: `env: { ...process.env }` handed to a child, argv
// spawns that run no shell, and RegExp#exec. This SHELLS OUT to semgrep (OSS engine; these flows are
// intra-procedural) and skips by name when semgrep is absent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES = process.env.CW_SEMGREP_TAINT || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'manifests', 'semgrep-taint', 'taint.yaml');
const semgrepPresent = () => spawnSync('semgrep', ['--version'], { encoding: 'utf8' }).status === 0;

const SHELL_PARSED = [
  "import cp from 'node:child_process';",
  "import { execSync } from 'node:child_process';",
  'cp.execSync(process.env.A);',
  'execSync(`make ${process.env.B}`);',
  "cp.spawnSync('sh', ['-c', process.env.C]);",
  "cp.spawn('/bin/bash', ['-e', '-c', process.env.D]);",
  'cp.spawnSync(process.env.E, [], { shell: true });',
].join('\n');
const NOT_SHELL = [
  "import cp from 'node:child_process';",
  "cp.spawnSync('git', ['status'], { env: { ...process.env, X: '1' } });",
  "cp.spawnSync('node', [process.env.F]);",
  'const m = /x(\\d)/.exec(process.env.G);',
  "const re = new RegExp('y'); re.exec(process.env.H);",
].join('\n');

test('env input fires at every shell-parsed position and at no other', (t) => {
  if (!semgrepPresent()) { t.skip('SKIPPED (not a silent pass): semgrep is not installed, so the sinks were NOT exercised here'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'cw-taint-sinks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'shell.mjs'), `${SHELL_PARSED}\n`);
  writeFileSync(join(dir, 'plain.mjs'), `${NOT_SHELL}\n`);
  const out = join(dir, 'out.json');
  spawnSync('semgrep', ['scan', '--config', RULES, '--metrics=off', '--json', '--output', out, '.'], { cwd: dir, encoding: 'utf8', timeout: 300000 });
  const res = JSON.parse(readFileSync(out, 'utf8')).results.filter((r) => r.check_id.endsWith('cw-env-to-shell'));
  assert.deepEqual(res.filter((r) => r.path === 'shell.mjs').map((r) => r.start.line), [3, 4, 5, 6, 7]);
  assert.deepEqual(res.filter((r) => r.path === 'plain.mjs').map((r) => r.start.line), []);
});

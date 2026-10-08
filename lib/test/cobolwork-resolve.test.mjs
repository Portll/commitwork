// lib/cobolwork-resolve.mjs and the bridge on top of it: CW_COBOLWORK_BIN, else the verified pinned
// install, else unavailable with the install command, and a cobolwork on PATH is never run; the
// bridge uses only a cobolwork whose capabilities --json meets the interim contract.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { resolveCobolwork, resolvePinnedTool, isPinnedTool, toolEnvVar, readPin, capabilitiesProblem } from '../cobolwork-resolve.mjs';
import { explain, gate, runCobolwork, cobolworkCommand } from '../cobolwork-bridge.mjs';
import { install } from '../../bin/cobolwork-pin.mjs';
import { COMMIT, capabilitiesFor, packCobolwork, pinFor, writePins } from './fixtures/cobolwork-pack.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-cobolwork-resolve-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const pack = packCobolwork();
const PINS = writePins(TMP, pinFor({ sha256: pack.sha256 }));
const TGZ = join(TMP, 'cobolwork-9.9.9.tgz');
writeFileSync(TGZ, pack.tgz);
const EMPTY_ROOT = join(TMP, 'empty-root');
const ROOT = join(TMP, 'root');
const base = (over = {}) => ({ ...process.env, CW_TOOL_PINS: PINS, CW_TOOLS_ROOT: EMPTY_ROOT, CW_COBOLWORK_BIN: '', ...over });

// A `cobolwork` on PATH that records it was run: the working checkout this resolver keeps out.
const PATH_DIR = join(TMP, 'path');
const MARK = join(TMP, 'path-cobolwork-ran');
mkdirSync(PATH_DIR);
writeFileSync(join(PATH_DIR, 'cobolwork'), `#!/bin/sh\ntouch '${MARK}'\necho '{"tool":"cobolwork-capabilities","schemaVersion":1,"identity":{"version":"cobolwork/v1"},"commands":{}}'\n`);
chmodSync(join(PATH_DIR, 'cobolwork'), 0o755);
const withPathCobolwork = (env) => ({ ...env, PATH: `${PATH_DIR}${delimiter}${env.PATH || ''}` });

test('with nothing installed and no override, cobolwork is unavailable, the reason names the pin and the install, and PATH is never consulted', async () => {
  const env = withPathCobolwork(base());
  const r = resolveCobolwork({ env });
  assert.equal(r.ok, false);
  assert.equal(r.source, 'pinned');
  assert.match(r.reason, /cobolwork 9\.9\.9, pinned in .*tool-pins\.json, is not installed: nothing is installed at /);
  assert.match(r.reason, /`node bin\/cobolwork-pin\.mjs --install`/);
  assert.match(r.reason, /a cobolwork on PATH is not used/);
  const run = await runCobolwork(['capabilities', '--json'], { env });
  assert.equal(run.ok, false);
  assert.equal(run.unavailable, true);
  assert.equal(existsSync(MARK), false, 'the cobolwork on PATH was not run');
  assert.equal(cobolworkCommand(['scan'], { env }).unavailable, true);
});

test('precedence: CW_COBOLWORK_BIN over the verified pinned install, the pinned install over nothing', async () => {
  const inst = await install({ env: base({ CW_TOOLS_ROOT: ROOT }), from: TGZ });
  assert.equal(inst.ok, true, inst.reason);
  const pinned = resolveCobolwork({ env: withPathCobolwork(base({ CW_TOOLS_ROOT: ROOT })) });
  assert.equal(pinned.ok, true, pinned.reason);
  assert.equal(pinned.source, 'pinned');
  assert.equal(pinned.path, join(ROOT, 'cobolwork', '9.9.9', 'package', 'bin', 'cobolwork.mjs'));
  assert.deepEqual([pinned.file, pinned.args], [process.execPath, [pinned.path]], 'run with this node');
  assert.equal(pinned.commit, COMMIT);

  const other = join(TMP, 'other-cobolwork.mjs');
  const over = resolveCobolwork({ env: base({ CW_TOOLS_ROOT: ROOT, CW_COBOLWORK_BIN: other }) });
  assert.equal(over.source, 'override');
  assert.equal(over.path, other);
  assert.deepEqual(over.args, [other]);
  const exe = resolveCobolwork({ env: base({ CW_COBOLWORK_BIN: '/opt/x/cobolwork' }) });
  assert.deepEqual([exe.file, exe.args], ['/opt/x/cobolwork', []]);

  // The bridge runs what the resolver found, and only that.
  const caps = await runCobolwork(['capabilities', '--json'], { env: withPathCobolwork(base({ CW_TOOLS_ROOT: ROOT })) });
  assert.equal(caps.ok, true, caps.reason);
  assert.equal(caps.json.toolRevision.commit, COMMIT);
  assert.equal(existsSync(MARK), false);
});

test('the env is read per call, and the runner\'s registry names cobolwork and its lane variable', () => {
  assert.equal(isPinnedTool('cobolwork'), true);
  assert.equal(isPinnedTool('gitleaks'), false);
  assert.equal(resolvePinnedTool('gitleaks'), null, 'an unpinned tool is left to PATH, as before');
  assert.equal(toolEnvVar('cobolwork'), 'CW_TOOL_COBOLWORK');
  const saved = process.env.CW_COBOLWORK_BIN;
  process.env.CW_COBOLWORK_BIN = '/set/after/import';
  try { assert.equal(resolveCobolwork().path, '/set/after/import'); }
  finally { if (saved === undefined) delete process.env.CW_COBOLWORK_BIN; else process.env.CW_COBOLWORK_BIN = saved; }
});

test('a pin file that is absent, off-schema or inconsistent is refused, never defaulted', () => {
  assert.match(readPin({ env: base({ CW_TOOL_PINS: join(TMP, 'none.json') }) }).reason, /could not be read \(ENOENT\)/);
  const bad = writePins(TMP, { ...pinFor({ sha256: pack.sha256 }), sha256: 'nothex' }, 'bad.json');
  assert.match(readPin({ env: base({ CW_TOOL_PINS: bad }) }).reason, /does not satisfy schema\/tool-pins\.schema\.json/);
  const moved = writePins(TMP, { ...pinFor({ sha256: pack.sha256 }), tag: 'v9.9.8' }, 'moved.json');
  assert.match(readPin({ env: base({ CW_TOOL_PINS: moved }) }).reason, /url is not https:\/\/github\.com\/Portll\/cobolwork\/releases\/download\/v9\.9\.8\//);
  assert.equal(resolveCobolwork({ env: base({ CW_TOOL_PINS: bad }) }).ok, false);
});

// A cobolwork that states `caps`, and runs nothing else.
function stating(name, caps) {
  const p = join(TMP, `${name}.mjs`);
  writeFileSync(p, `const a = process.argv.slice(2);\nif (a[0] === 'capabilities') process.stdout.write(${JSON.stringify(JSON.stringify(caps))});\nelse { process.stderr.write('ran ' + a[0] + '\\n'); process.exitCode = 3; }\n`);
  return p;
}

test('the bridge uses no cobolwork whose capabilities are another schemaVersion or identity, or lack what it passes', async () => {
  const fp = 'a'.repeat(32), sha = 'b'.repeat(40);
  const cases = [
    ['schema-2', { ...capabilitiesFor(), schemaVersion: 2 }, /capabilities schemaVersion is 2, and commitwork reads only 1/],
    ['identity-v2', { ...capabilitiesFor(), identity: { version: 'cobolwork/v2' } }, /fingerprint identity is "cobolwork\/v2", and commitwork reads only cobolwork\/v1/],
    ['no-identity', { ...capabilitiesFor(), identity: undefined }, /fingerprint identity is undefined/],
    ['other-tool', { ...capabilitiesFor(), tool: 'cobolwork' }, /wrote "cobolwork", not cobolwork-capabilities/],
  ];
  for (const [name, caps, why] of cases) {
    const env = base({ CW_COBOLWORK_BIN: stating(name, caps) });
    const e = await explain(TMP, fp, { env });
    assert.equal(e.ok, false, name);
    assert.equal(e.unavailable, true, `${name}: unavailable, never a refusal or a result`);
    assert.match(e.reason, why);
    const g = await gate(TMP, { base: sha, head: sha, target: fp }, { env });
    assert.equal(g.unavailable, true);
    assert.match(g.reason, why);
  }
  const noTargetOnly = capabilitiesFor();
  noTargetOnly.commands.gate.options = ['--base', '--head', '--target'];
  const env = base({ CW_COBOLWORK_BIN: stating('no-target-only', noTargetOnly) });
  const g = await gate(TMP, { base: sha, head: sha, target: fp, targetOnly: true }, { env });
  assert.equal(g.unavailable, true);
  assert.match(g.reason, /its gate takes no --target-only/);
  const full = await gate(TMP, { base: sha, head: sha, target: fp }, { env });
  assert.equal(full.unavailable, true, 'without --target-only the contract holds, and the gate itself ran');
  assert.match(full.reason, /cobolwork gate exited 3: ran gate/);
  assert.equal(capabilitiesProblem(capabilitiesFor(), { needs: { gate: ['--target-only'] } }), null);
});

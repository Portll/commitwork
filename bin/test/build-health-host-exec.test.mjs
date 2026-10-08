// build-health's host side runs outside the container and outside the host sandbox, so nothing a
// scanned tree controls may become host command text (review 2026-10-07): its path reaching a
// `sh -c` (D5), or its repo-local core.fsmonitor reaching a `git status` (D6). docker is a stub
// that records its argv, so the measurement needs no daemon and runs nothing of the repo's.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = realpathSync(mkdtempSync(join(tmpdir(), 'cw-bh-hostexec-')));
after(() => rmSync(T, { recursive: true, force: true }));
const posix = process.platform !== 'win32';

const STUB = join(T, 'stub-bin');
const ARGV_LOG = join(T, 'docker-argv.log');
mkdirSync(STUB);
writeFileSync(join(STUB, 'docker'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done >> "${ARGV_LOG}"\nprintf '\\n' >> "${ARGV_LOG}"\necho __CW_WORKSPACE_READY\nexit 0\n`);
chmodSync(join(STUB, 'docker'), 0o755);

const MARK = 'cw-hostexec-marker';
const landed = () => [T, ...readdirSync(T).map((d) => join(T, d)).filter((d) => { try { return readdirSync(d) && true; } catch { return false; } })]
  .filter((d) => existsSync(join(d, MARK)));
const bh = (sub, repo) => spawnSync(process.execPath, [join(CW, 'bin', 'build-health.mjs'), sub, repo], {
  cwd: T, encoding: 'utf8', env: { ...process.env, PATH: `${STUB}${delimiter}${process.env.PATH}`, BH_DOCKER_ARGS: '' },
});
const dockerCalls = () => (existsSync(ARGV_LOG) ? readFileSync(ARGV_LOG, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\0').filter((x, i, a) => i < a.length - 1)) : []);

test('a repository named repo$(touch …) runs nothing on the host, and its path reaches docker as one argv word', { skip: posix ? false : 'needs a POSIX shell to name the payload' }, () => {
  const repo = join(T, `repo$(touch ${MARK})`);
  mkdirSync(repo);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ engines: { node: '20' }, scripts: { test: 'node t.js' } }));
  rmSync(ARGV_LOG, { force: true });
  const r = bh('toolchain', repo);
  assert.deepEqual(landed(), [], `the directory name executed on the host:\n${r.stderr}`);
  const calls = dockerCalls();
  assert.equal(calls.length, 1, `docker stub was not reached, so the absence of a marker proves nothing:\n${r.stdout}\n${r.stderr}`);
  assert.ok(calls[0].includes(`${repo}:/src:ro`), `the mount spec was not one word: ${JSON.stringify(calls[0])}`);
  // the control: the same name through a shell is exactly the payload the argv form refuses to build
  spawnSync('sh', ['-c', `true "${repo}"`], { cwd: T });
  assert.deepEqual(landed(), [T], 'the payload does not fire through a shell, so the assertion above proves nothing');
  rmSync(join(T, MARK));
});

test('the java lanes pass the work dir as $1 and never execute a repo-local core.fsmonitor', { skip: posix ? false : 'POSIX fsmonitor hook' }, () => {
  const repo = join(T, `java$(touch ${MARK})`);
  mkdirSync(repo);
  writeFileSync(join(repo, 'build.gradle'), "java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }\ntasks.register('bootTest') {}\n");
  writeFileSync(join(repo, 'gradlew'), '#!/bin/sh\n');
  const fsmon = join(T, 'fsmon-fired');
  const hook = join(T, 'fsmonitor.sh');
  writeFileSync(hook, `#!/bin/sh\ntouch "${fsmon}"\nexit 1\n`);
  chmodSync(hook, 0o755);
  const g = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(g('init', '-q').status, 0);
  g('config', 'core.fsmonitor', hook);
  rmSync(ARGV_LOG, { force: true });
  for (const sub of ['toolchain', 'boottest']) {
    const r = bh(sub, repo);
    assert.deepEqual(landed(), [], `${sub}: the directory name executed on the host:\n${r.stderr}`);
    assert.ok(!existsSync(fsmon), `${sub}: the scanned repo's core.fsmonitor ran on the host`);
  }
  const calls = dockerCalls();
  assert.equal(calls.length, 2, `the docker stub was not reached by both lanes: ${JSON.stringify(calls)}`);
  for (const c of calls) {
    const i = c.indexOf('-c');
    assert.match(c[i + 1], /cd "\$1" && /, 'the work dir is spliced into the container script');
    assert.deepEqual(c.slice(i + 2), ['sh', '/w'], 'the work dir is not the script\'s $1');
  }
  // the control: plain git status on the same tree does run the hook, so the fixture is armed
  g('status', '--porcelain');
  assert.ok(existsSync(fsmon), 'git status never ran the fsmonitor hook, so its absence above proves nothing');
});

test('BH_DOCKER_ARGS with shell syntax is refused as env-blocked, never reinterpreted', { skip: posix ? false : 'POSIX' }, () => {
  const repo = join(T, 'plain');
  mkdirSync(repo);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ engines: { node: '20' } }));
  rmSync(ARGV_LOG, { force: true });
  const r = spawnSync(process.execPath, [join(CW, 'bin', 'build-health.mjs'), 'toolchain', repo], {
    cwd: T, encoding: 'utf8', env: { ...process.env, PATH: `${STUB}${delimiter}${process.env.PATH}`, BH_DOCKER_ARGS: `--network n $(touch ${MARK})` },
  });
  assert.deepEqual(landed(), []);
  assert.equal(dockerCalls().length, 0, 'docker ran with a refused BH_DOCKER_ARGS');
  const out = JSON.parse(r.stdout);
  const js = (out.results || out.languages || []).find((x) => /script|javascript/.test(x.lang)) || JSON.stringify(out);
  assert.match(JSON.stringify(js), /env-blocked[\s\S]*BH_DOCKER_ARGS holds shell syntax|BH_DOCKER_ARGS holds shell syntax[\s\S]*env-blocked/);
});

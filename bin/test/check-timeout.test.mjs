// A lane that never returns used to hold the whole fleet: deps-osv on 1Panel sat 32,005s inside
// `docker pull` and stalled sweep-20260822153004 for 8.9 h with no alarm — spawnSync had no timeout
// at all. The bound alone is not the fix, and that is what this file pins:
//
//   killing `sh` does not kill the container   `docker run` is a CLIENT. The container keeps the
//                                              source mounted and the report dir writable, and
//                                              finishes writing into a batch already finalised.
//   a partial report is not a small one        a truncated SARIF has a valid header. Classified,
//                                              it reads as "scanned, fewer findings" — the exact
//                                              false-green the exit-code rule exists to refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkTimeoutSec, runCheckLocal } from '../commitwork.mjs';
import { containerName, killByPrefix, reapOrphans } from '../../monitor/containers.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'cw-timeout-'));

// Fake docker: records every invocation, reports one running container per queried prefix.
function fakeDocker(dir, { running = [] } = {}) {
  const p = join(dir, 'docker');
  writeFileSync(p, `#!/bin/sh
echo "$@" >> "$FAKE_LOG"
case "$1" in
  ps) ${running.length ? `printf '%s\\n' ${running.map((n) => `'${n}'`).join(' ')}` : 'true'}; exit 0;;
  rm|kill) exit 0;;
esac
exit 0
`);
  chmodSync(p, 0o755);
  return p;
}
const withDocker = (opts, fn) => {
  const dir = tmp(); const log = join(dir, 'calls.log');
  const prev = { d: process.env.CW_DOCKER, l: process.env.FAKE_LOG };
  process.env.CW_DOCKER = fakeDocker(dir, opts); process.env.FAKE_LOG = log;
  try { return fn(() => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []), dir); }
  finally {
    if (prev.d === undefined) delete process.env.CW_DOCKER; else process.env.CW_DOCKER = prev.d;
    if (prev.l === undefined) delete process.env.FAKE_LOG; else process.env.FAKE_LOG = prev.l;
  }
};
const withEnv = (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); }
  finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

// ── the bound ───────────────────────────────────────────────────────────────────────────────────

test('timeoutSec resolves manifest → env → default, and a nonsense value never disables the bound', () => {
  withEnv({ CW_CHECK_TIMEOUT_SEC: null }, () => {
    assert.equal(checkTimeoutSec({ id: 'x' }), 1800, 'the default is above every measured lane maximum on the 100-repo corpus');
    assert.equal(checkTimeoutSec({ id: 'x', timeoutSec: 3000 }), 3000);
  });
  withEnv({ CW_CHECK_TIMEOUT_SEC: '60' }, () => {
    assert.equal(checkTimeoutSec({ id: 'x' }), 60);
    assert.equal(checkTimeoutSec({ id: 'x', timeoutSec: 3000 }), 3000, 'the manifest wins over the env');
  });
  for (const bad of [0, -1, 'soon', null, undefined, NaN]) {
    assert.equal(withEnv({ CW_CHECK_TIMEOUT_SEC: null }, () => checkTimeoutSec({ id: 'x', timeoutSec: bad })), 1800,
      `timeoutSec ${JSON.stringify(bad)} must fall back to the default, never to unbounded`);
  }
});

test('the bundled manifest declares a bound for every lane whose measured maximum exceeds the default', () => {
  const m = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
  const byId = Object.fromEntries(m.checks.map((c) => [c.id, c]));
  // measured on sweep-20260822153004, 51 repos: deps-reachability 1981s, posture-scorecard 1352s
  for (const id of ['deps-reachability', 'posture-scorecard']) {
    assert.ok(byId[id].timeoutSec > 1800 || byId[id].timeoutSec >= 2100,
      `${id} runs close to or past the 1800s default and must declare its own bound`);
  }
});

// ── what a kill leaves behind ───────────────────────────────────────────────────────────────────

test('a command that overruns is noscan with the reason — never fail, never pass', () => {
  withDocker({}, () => {
    const dir = tmp();
    const r = withEnv({ CW_REPORT_DIR: dir }, () => runCheckLocal({ id: 'slow', timeoutSec: 1, local: ['sleep 30'] }, dir));
    assert.equal(r.status, 'noscan', 'a killed tool produced no trustworthy output; that is a void, not a failure of the repo');
    assert.equal(r.timedOut, true);
    assert.match(r.reason, /exceeded 1s and was killed/);
    assert.match(r.reason, /raise timeoutSec/, 'the message names the knob');
    assert.equal(r.coverage, 'unknown');
  });
});

test('the partial report is set aside and the exit witness says 124 — a truncated SARIF is never classified', () => {
  withDocker({}, () => {
    const dir = tmp();
    const check = { id: 'slow', timeoutSec: 1, local: ['sleep 30'], report: { file: 'out.sarif', format: 'sarif' } };
    writeFileSync(join(dir, 'out.sarif'), '{"runs":[{"results":[');  // what a killed writer leaves
    withEnv({ CW_REPORT_DIR: dir }, () => runCheckLocal(check, dir));
    assert.equal(existsSync(join(dir, 'out.sarif')), false, 'the partial report must not remain where a parser will read it');
    assert.equal(readFileSync(join(dir, 'out.sarif.killed'), 'utf8'), '{"runs":[{"results":[', 'it is preserved, not deleted — evidence of the kill');
    assert.equal(readFileSync(join(dir, 'out.sarif.exit'), 'utf8').trim(), '124',
      'the runner writes the witness itself: the killed command never reached its own `echo $? >` line');
  });
});

test('the containers the check started are removed by name — killing sh leaves them running', () => {
  withDocker({ running: ['cw-cli-repo-slow-scan'] }, (calls) => {
    const dir = tmp();
    const r = withEnv({ CW_REPORT_DIR: dir, CW_SLICE: null, CW_REPO_SLUG: null }, () =>
      runCheckLocal({ id: 'slow', timeoutSec: 1, local: ['sleep 30'] }, dir));
    const rms = calls().filter((c) => c.startsWith('rm -f'));
    assert.ok(rms.some((c) => c.includes('cw-cli-repo-slow-scan')), `expected the named container to be removed, saw: ${JSON.stringify(calls())}`);
    assert.match(r.reason, /removed container\(s\) cw-cli-repo-slow-scan/, 'and the receipt says which');
  });
});

test('a leftover container is removed BEFORE the command starts, or `docker run --name` would refuse', () => {
  withDocker({ running: ['cw-cli-repo-fast-scan'] }, (calls) => {
    const dir = tmp();
    withEnv({ CW_REPORT_DIR: dir }, () => runCheckLocal({ id: 'fast', local: ['true'] }, dir));
    assert.ok(calls().some((c) => c.startsWith('rm -f')), 'the pre-start sweep ran');
  });
});

test('a command that succeeds inside its bound is untouched — no rename, no witness, no kill claim', () => {
  withDocker({}, () => {
    const dir = tmp();
    const check = { id: 'ok', timeoutSec: 30, local: ['true'], report: { file: 'out.json', format: 'json' } };
    writeFileSync(join(dir, 'out.json'), '{"ok":true}');
    const r = withEnv({ CW_REPORT_DIR: dir }, () => runCheckLocal(check, dir));
    assert.equal(r.status, 'pass');
    assert.equal(r.timedOut, undefined);
    assert.equal(existsSync(join(dir, 'out.json.killed')), false);
    assert.equal(existsSync(join(dir, 'out.json.exit')), false, 'the runner writes an exit witness only for a kill; the lane owns it otherwise');
  });
});

// ── names and the reaper ────────────────────────────────────────────────────────────────────────

test('container names are deterministic and path-safe, so a kill can find them without a pid', () => {
  assert.equal(containerName('deps-osv', { slice: 'sweep-20260822153004', repo: 'MrLesk_Backlog.md' }),
    'cw-sweep-20260822153004-MrLesk_Backlog.md-deps-osv');
  assert.equal(containerName('a/b', { slice: 'x/y', repo: '../escape' }), 'cw-x_y-.._escape-a_b',
    'nothing in a name can reach out of the name');
  withEnv({ CW_SLICE: null, CW_REPO_SLUG: null }, () =>
    assert.equal(containerName('x'), 'cw-cli-repo-x', 'outside a sweep the slice is `cli`, never blank'));
});

test('the reaper spares every LIVE slice and removes only the rest — concurrent areas are not orphans', () => {
  withDocker({ running: ['cw-sweep-A-r1-deps-osv', 'cw-sweep-B-r2-sast', 'cw-sweep-DEAD-r3-sast'] }, (calls) => {
    const r = reapOrphans(['sweep-A', 'sweep-B']);
    assert.deepEqual(r.orphans, ['cw-sweep-DEAD-r3-sast']);
    assert.equal(r.killed.length, 1);
    const removed = calls().filter((c) => c.startsWith('rm -f')).join(' ');
    assert.ok(!removed.includes('sweep-A') && !removed.includes('sweep-B'), 'a peer sweep mid-scan must survive');
  });
});

test('with docker absent nothing is claimed killed, and no branch throws', () => {
  withEnv({ CW_DOCKER: '/nonexistent/docker' }, () => {
    assert.deepEqual(killByPrefix('cw-x-'), { names: [], killed: [], failed: [] });
    assert.deepEqual(reapOrphans(['s']).orphans, []);
  });
});

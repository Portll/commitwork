// The joern lane, against a fake launcher shaped like the real one. The three facts it has to keep:
// the language is chosen here rather than guessed, the JVM's stderr lands in a file this run owns
// (the distribution launcher hardcodes a shared /tmp path every joern-scan truncates), and a
// language that never reached a scan pass is named rather than covered by another language's.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, chmodSync, realpathSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FRONTENDS, COVERED_EXTS, TMP_LOG, resolveLauncher, readQueryDb, countSources, failureLine, runLane, runJoern, EXIT_NO_LAUNCHER } from '../joern-lane.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-joern-lane-'));
let n = 0;
const dir = (name) => { const p = join(T, `${name}${n++}`); mkdirSync(p, { recursive: true }); return p; };

const QUERIES = [
  { language: 'c', tags: ['badfn', 'default'] },
  { language: 'java', tags: ['default'] },
  { language: 'kotlin', tags: ['android'] },
  { language: 'php', tags: ['remote-code-execution'] },
  { language: 'android', tags: ['android'] },
  { language: 'ghidra', tags: ['badfn'] },
  { language: 'c', tags: ['metrics'] },
];

// A launcher with the shape that matters: it writes the JVM's stderr to the shared /tmp path, and
// resolves its own directory from $0. `behaviour` decides what each language run does.
function fakeLauncher(behaviour) {
  const d = dir('launcher');
  const p = join(d, 'joern-scan');
  writeFileSync(p, `#!/bin/sh
SCRIPT_ABS_DIR=$(dirname "$0")
{
  case "$*" in
    *--dump-to*) cat "${behaviour.querydb}" > "$2"; exit 0 ;;
  esac
  lang=""
  prev=""
  for a in "$@"; do [ "$prev" = "--language" ] && lang="$a"; prev="$a"; done
  sh "${d}/behave-$lang.sh"
} 2> ${TMP_LOG}
exit $?
`);
  chmodSync(p, 0o755);
  for (const [lang, script] of Object.entries(behaviour.languages)) writeFileSync(join(d, `behave-${lang}.sh`), script);
  return p;
}

const querydb = (queries = QUERIES) => { const p = join(T, `qdb${n++}.json`); writeFileSync(p, JSON.stringify(queries)); return p; };

const SCAN_OK = (results = 1) => `echo "[INFO] running"\n${Array.from({ length: results }, (_, i) => `echo "Result: 8.0 : Dangerous function gets() used: a.c:${i + 1}:main"`).join('\n')}\necho "ScanPass completed"\nexit 0\n`;
const SCAN_HUSK = 'echo "Writing logs to: /tmp/joern-scan-log.txt"\necho "value javasrc is not a member of io.joern.console.cpgcreation.ImportCode" >&2\nexit 1\n';
const SCAN_SILENT_FAILURE = 'echo "Writing logs to: /tmp/joern-scan-log.txt"\necho "[ERROR] Process exited with code 1." >&2\nexit 0\n';

function srcTree(files) {
  const d = dir('src');
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(d, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return d;
}

const RX = '(.*/)?(node_modules|vendor)/.*';
const laneJson = (rd) => JSON.parse(readFileSync(join(rd, 'joern-lane.json'), 'utf8'));

describe('what the lane covers is what the bundle has queries for', () => {
  test('the manifest gate and the frontend map are the same list', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
    const check = manifest.checks.find((c) => c.id === 'sast-joern');
    assert.deepEqual([...check.appliesIfSourceExt].sort(), [...COVERED_EXTS].sort(),
      'a lane that applies to an extension no frontend here reads would build a graph no query can use');
  });

  test('no frontend claims a language the generated script cannot name', () => {
    for (const f of FRONTENDS) {
      assert.ok(!['javasrc', 'pythonsrc'].includes(f.language),
        `${f.language} is advertised by --list-languages and is not an ImportCode member: the scan never runs`);
    }
  });

  test('a query language nothing maps to is reported, not dropped', () => {
    const rd = dir('rd');
    runLane(srcTree({ 'a.c': 'int main(){}' }), rd, RX,
      { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: { c: SCAN_OK() } }) });
    assert.deepEqual(laneJson(rd).unmapped, ['ghidra'], 'the bundle has ghidra queries and this lane passes no binary — say so');
  });

  test('sources decide which frontends run, and only those', () => {
    const rd = dir('rd');
    const src = srcTree({ 'a.c': 'int main(){}', 'B.java': 'class B {}', 'web/index.ts': 'export const x = 1;', 'node_modules/dep/d.c': 'int dep(){}' });
    const code = runLane(src, rd, RX, { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: { c: SCAN_OK(2), java: SCAN_OK(1) } }) });
    const rec = laneJson(rd);
    assert.equal(code, 0);
    assert.deepEqual(rec.languages.map((l) => l.id), ['c', 'java']);
    assert.equal(rec.sourceCounts.c, 1, 'the excluded vendored .c is not a source of this repo');
    assert.equal(rec.languages.find((l) => l.id === 'c').results, 2);
  });

  test('a tree with nothing the bundle covers scans nothing and says so', () => {
    const rd = dir('rd');
    const code = runLane(srcTree({ 'app.ts': 'export const x = 1;', 'main.go': 'package main' }), rd, RX,
      { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: {} }) });
    assert.equal(code, 3);
    assert.deepEqual(laneJson(rd).languages, []);
    assert.equal(existsSync(join(rd, 'joern.txt')), false, 'no artifact, so nothing downstream can read a zero out of it');
  });
});

describe('a failed language is named, never covered by a passing one', () => {
  test('one language scanning does not certify the other', () => {
    const rd = dir('rd');
    const code = runLane(srcTree({ 'a.c': 'int main(){}', 'B.java': 'class B {}' }), rd, RX,
      { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: { c: SCAN_OK(1), java: SCAN_HUSK } }) });
    assert.equal(code, 1, 'the lane exits non-zero so the runner records a fail with a reason');
    const rec = laneJson(rd);
    const java = rec.languages.find((l) => l.id === 'java');
    assert.equal(java.scanRan, false);
    assert.match(java.reason, /is not a member/, 'the reason comes from the JVM stderr this run owns');
    assert.equal(rec.languages.find((l) => l.id === 'c').scanRan, true);
  });

  test('exit 0 with no scan pass is a failure — this tool\'s exit code has lied three measured ways', () => {
    const rd = dir('rd');
    const code = runLane(srcTree({ 'a.c': 'int main(){}' }), rd, RX,
      { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: { c: SCAN_SILENT_FAILURE } }) });
    assert.equal(code, 1);
    const c = laneJson(rd).languages[0];
    assert.equal(c.exit, 0);
    assert.equal(c.scanRan, false);
    assert.match(c.reason, /\[ERROR\]/);
  });

  test('the JVM stderr is written per language, not to the shared /tmp path', () => {
    const rd = dir('rd');
    runLane(srcTree({ 'a.c': 'int main(){}' }), rd, RX,
      { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: { c: SCAN_SILENT_FAILURE } }) });
    assert.equal(laneJson(rd).launcher.stderrCaptured, true);
    assert.match(readFileSync(join(rd, 'joern-c.log'), 'utf8'), /\[ERROR\] Process exited/);
  });

  test('the merged artifact heads each section with the language it came from', () => {
    const rd = dir('rd');
    runLane(srcTree({ 'a.c': 'int main(){}', 'B.java': 'class B {}' }), rd, RX,
      { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: { c: SCAN_OK(1), java: SCAN_OK(1) } }) });
    const txt = readFileSync(join(rd, 'joern.txt'), 'utf8');
    assert.match(txt, /^# joern-lane language=c exit=0 files=1$/m);
    assert.match(txt, /^# joern-lane language=java exit=0 files=1$/m);
    assert.equal((txt.match(/^Result: /gm) || []).length, 2);
  });
});

describe('the pieces', () => {
  test('a query db yields its languages and every tag but metrics', () => {
    const db = readQueryDb(querydb());
    assert.deepEqual(Object.keys(db.languages).sort(), ['android', 'c', 'ghidra', 'java', 'kotlin', 'php']);
    assert.ok(!db.tags.includes('metrics'));
    assert.ok(db.tags.includes('badfn'));
  });

  test('an unreadable query db is null, so the caller falls back rather than scanning with no tags', () => {
    assert.equal(readQueryDb(join(T, 'nope.json')), null);
    assert.equal(readQueryDb(querydb([])), null);
  });

  test('the source walk honours the shared exclusion policy', () => {
    const src = srcTree({ 'a.c': '', 'deep/b.cpp': '', 'node_modules/x/c.c': '', 'reports/d.c': '', 'X.kt': '' });
    const { counts } = countSources(src);
    assert.equal(counts.c, 2);
    assert.equal(counts.kotlin, 1);
    assert.equal(counts.php, 0);
  });

  test('failureLine prefers the line that names the cause over the header above it', () => {
    const stderr = '-- [E008] Not Found Error: /tmp/wrapped-script.sc:6:14\n| value pythonsrc is not a member of ImportCode\nException in thread "main"';
    assert.match(failureLine(stderr), /^value pythonsrc is not a member/);
    assert.equal(failureLine('WARNING: a deprecated method\nat io.joern.Whatever'), null);
  });

  test('a shim is followed to the launcher it execs, keeping its JAVA_HOME default', () => {
    const d = dir('shim');
    const launcher = join(d, 'real-joern-scan');
    writeFileSync(launcher, `#!/bin/sh\necho hi 2> ${TMP_LOG}\n`);
    const shim = join(d, 'joern-scan');
    writeFileSync(shim, `#!/bin/bash\nJAVA_HOME="\${JAVA_HOME:-/opt/jdk/Home}" exec "${launcher}"  "$@"\n`);
    const r = resolveLauncher({ CW_JOERN_SCAN: shim });
    assert.equal(r.path, realpathSync(launcher));
    assert.equal(r.javaHome, '/opt/jdk/Home');
    assert.equal(r.captured, true);
  });

  test('a launcher whose text does not carry the shared path is run as-is and says the stderr is not ours', () => {
    const d = dir('plain');
    const p = join(d, 'joern-scan');
    writeFileSync(p, '#!/bin/sh\nexit 0\n');
    chmodSync(p, 0o755);
    assert.equal(resolveLauncher({ CW_JOERN_SCAN: p }).captured, false);
  });
});

describe('an absent or unreadable launcher is not a result', () => {
  test('no joern-scan on PATH exits 127, which the runner reads as a void and not as found-something', () => {
    const rd = dir('rd');
    const code = runLane(srcTree({ 'a.c': 'int main(){}' }), rd, RX, { PATH: dir('emptybin') });
    assert.equal(code, 127);
    assert.equal(EXIT_NO_LAUNCHER, 127);
    assert.equal(existsSync(join(rd, 'joern-lane.json')), false, 'nothing ran, so no sidecar can certify anything');
  });

  test('a dangling launcher path is the same void, not a throw', () => {
    assert.equal(resolveLauncher({ CW_JOERN_SCAN: join(T, 'does-not-exist') }), null);
    assert.equal(runLane(srcTree({ 'a.c': '' }), dir('rd'), RX, { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: join(T, 'does-not-exist') }), 127);
  });

  test('a launcher the process may not read is the same void, not an EACCES out of the lane', { skip: process.getuid && process.getuid() === 0 ? 'root reads everything' : false }, () => {
    const p = join(dir('noperm'), 'joern-scan');
    writeFileSync(p, '#!/bin/sh\nexit 0\n');
    chmodSync(p, 0o000);
    try {
      assert.equal(resolveLauncher({ CW_JOERN_SCAN: p }), null);
      assert.equal(runLane(srcTree({ 'a.c': '' }), dir('rd'), RX, { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: p }), 127);
    } finally { chmodSync(p, 0o644); }
  });
});

describe('two runs on one report dir do not share a workspace', () => {
  test('a peer run\'s in-flight directories survive this run, and a stale query db is not read', () => {
    const rd = dir('rd');
    // The fixed names the lane used to own: a peer's workspace and a half-written query db.
    for (const peer of ['joern-work-dump', 'joern-work-c']) { mkdirSync(join(rd, peer)); writeFileSync(join(rd, peer, 'inflight'), 'x'); }
    writeFileSync(join(rd, 'joern-querydb.json'), '{');
    runLane(srcTree({ 'a.c': 'int main(){}' }), rd, RX,
      { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: { c: SCAN_OK() } }) });
    assert.ok(existsSync(join(rd, 'joern-work-dump', 'inflight')));
    assert.ok(existsSync(join(rd, 'joern-work-c', 'inflight')));
    assert.equal(readFileSync(join(rd, 'joern-querydb.json'), 'utf8'), '{', 'not this run\'s file, so not touched');
    assert.equal(laneJson(rd).querydb.source, 'dump');
  });

  test('this run leaves no workspace of its own behind on a normal finish', () => {
    const rd = dir('rd');
    runLane(srcTree({ 'a.c': 'int main(){}' }), rd, RX,
      { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: { c: SCAN_OK() } }) });
    assert.deepEqual(readdirSync(rd).filter((f) => f.startsWith('joern-run-')), []);
  });

  test('a peer run directory is left alone', () => {
    const rd = dir('rd');
    mkdirSync(join(rd, 'joern-run-peer'));
    writeFileSync(join(rd, 'joern-run-peer', 'inflight'), 'x');
    runLane(srcTree({ 'a.c': '' }), rd, RX,
      { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: { c: SCAN_OK() } }), CW_JOERN_RUN_ID: 'mine' });
    assert.ok(existsSync(join(rd, 'joern-run-peer', 'inflight')));
  });

  test('a query db that could not be dumped is recorded as the fallback, with why', () => {
    const rd = dir('rd');
    const p = join(dir('nodump'), 'joern-scan');
    writeFileSync(p, `#!/bin/sh\n{\ncase "$*" in *--dump-to*) exit 3 ;; esac\n${SCAN_OK()}} 2> ${TMP_LOG}\nexit $?\n`);
    chmodSync(p, 0o755);
    runLane(srcTree({ 'a.c': 'int main(){}' }), rd, RX, { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: p });
    const q = laneJson(rd).querydb;
    assert.equal(q.source, 'fallback');
    assert.match(q.fallbackReason, /dump exit 3/);
  });
});

describe('what has already run survives a kill', () => {
  test('a lane killed mid-language leaves the finished language on disk and the rest named as unfinished', () => {
    const rd = dir('rd');
    const src = srcTree({ 'a.c': 'int main(){}', 'B.java': 'class B {}' });
    const launcher = fakeLauncher({ querydb: querydb(), languages: { c: SCAN_OK(1), java: 'echo "Result: 5.0 : half: B.java:1:m"\nkill -9 "$LANE_PID"\nsleep 5\n' } });
    const mod = new URL('../joern-lane.mjs', import.meta.url).href;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { runLane } from ${JSON.stringify(mod)}; process.env.LANE_PID = String(process.pid); runLane(${JSON.stringify(src)}, ${JSON.stringify(rd)}, ${JSON.stringify(RX)}, { ...process.env, PATH: '/usr/bin:/bin', CW_JOERN_SCAN: ${JSON.stringify(launcher)} });`],
      { encoding: 'utf8' });
    assert.equal(r.signal, 'SIGKILL');
    assert.match(readFileSync(join(rd, 'joern.txt'), 'utf8'), /^Result: 8\.0 .*a\.c:1/m, 'the finished language is on disk');
    const rec = laneJson(rd);
    assert.equal(rec.languages.find((l) => l.id === 'c').scanRan, true);
    const java = rec.languages.find((l) => l.id === 'java');
    assert.equal(java.scanRan, false);
    assert.match(java.reason, /not completed/, 'a sidecar naming only c would certify c as the whole repository');
    const left = readdirSync(rd).filter((f) => f.startsWith('joern-run-'));
    assert.equal(left.length, 1, 'the killed run keeps its workspace');
    assert.match(readFileSync(join(rd, left[0], 'java.txt'), 'utf8'), /half/, 'the partial stdout of the language that was running');
  });
});

describe('the stderr caveat follows the evidence', () => {
  test('a launcher that names the shared path but never writes it does not claim captured stderr', () => {
    const rd = dir('rd');
    const p = join(dir('liar'), 'joern-scan');
    writeFileSync(p, `#!/bin/sh\n# mentions ${TMP_LOG} without redirecting to it\ncase "$*" in *--dump-to*) cat "${querydb()}" > "$2"; exit 0 ;; esac\nexit 1\n`);
    chmodSync(p, 0o755);
    assert.equal(resolveLauncher({ CW_JOERN_SCAN: p }).captured, true);
    runLane(srcTree({ 'a.c': 'int main(){}' }), rd, RX, { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: p });
    assert.match(laneJson(rd).languages[0].reason, /shared \/tmp log and is not attributable/);
  });

  test('a launcher that does write the file carries no such caveat', () => {
    const rd = dir('rd');
    runLane(srcTree({ 'a.c': 'int main(){}' }), rd, RX,
      { PATH: '/usr/bin:/bin', CW_JOERN_SCAN: fakeLauncher({ querydb: querydb(), languages: { c: 'exit 1\n' } }) });
    assert.doesNotMatch(laneJson(rd).languages[0].reason, /shared \/tmp log/);
  });
});

describe('a captured launcher runs as if exec\'d', () => {
  test('$0 is the launcher, arguments arrive intact, and the JVM stderr goes to this run\'s log', () => {
    const d = dir('exec');
    const p = join(d, 'joern-scan');
    writeFileSync(p, `#!/bin/sh\n{ printf '%s\\n' "$0" "$@"; echo jvm-said >&2; } 2> ${TMP_LOG}\n`);
    chmodSync(p, 0o755);
    const launcher = resolveLauncher({ CW_JOERN_SCAN: p });
    assert.equal(launcher.captured, true);
    const outPath = join(d, 'out.txt');
    const errPath = join(d, "it's the log.txt");
    const r = runJoern(launcher, ['--language', 'a b; $(x) `y`'], { cwd: d, outPath, errPath, env: { PATH: '/usr/bin:/bin' } });
    assert.equal(r.status, 0, r.launcherStderr);
    assert.deepEqual(readFileSync(outPath, 'utf8').split('\n').filter(Boolean), [realpathSync(p), '--language', 'a b; $(x) `y`']);
    assert.equal(readFileSync(errPath, 'utf8'), 'jvm-said\n');
  });
});

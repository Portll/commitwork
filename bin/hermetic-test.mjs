#!/usr/bin/env node
// bin/hermetic-test.mjs — a Rust repository's test suite, run the way a bare CI runner sees it.
//
// A developer's own `cargo test` inherits their machine. On 2026-09-27 veld's suite passed here
// because ~/Library/Caches/veld already held the ONNX runtime and MiniLM, while the runner, which
// has neither, failed 216 tests (and hid it behind a pipe). This runs the suite with an EMPTY home,
// so every cache the code consults starts as empty as a runner's, with debug info off, in a target
// folder of its own, after the preparation steps the OPERATOR declared for the repository in the
// registry (projects[].hermeticTest.prepare). A repository never declares its own: they run.
//
// It also reports what the build occupies against a hosted runner's free disk, because the same
// job on the runner died of "No space left on device" before it could report anything at all.
//
// usage: hermetic-test.mjs [repoDir] [--prepare <cmd>]...
//   env, read at call time: CARGO_TARGET_DIR (the runner sets the sweep's folder; this uses a
//   `hermetic` subfolder of it), CW_REGISTRY, CW_RUNNER_DISK_GB (default 14),
//   CW_HERMETIC_TIMEOUT_SEC (default 5400), CARGO_HOME / RUSTUP_HOME (default under the real home).
// Output: a rule-counts report on stdout. Exit 0 ran · 2 could not run.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { registryPath } from '../monitor/registry.mjs';
import { sweepCargoTargetDir } from './lib/cargo-target.mjs';

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const expandHome = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const DEFAULT_RUNNER_DISK_GB = 14;
const HEADROOM_SHARE = 0.7;

/**
 * Where libclang lives on this host, or null. A runner gets it from its "Install LLVM" step; here
 * it is the toolchain, not a cache, so the lane hands it over explicitly. It must: on 2026-09-28
 * librocksdb-sys's build script aborted under the empty home because dyld had been finding
 * libclang only through its $HOME/lib fallback (~/lib/libclang.dylib, a machine-local link).
 */
export function libclangDir(env = process.env) {
  if (env.LIBCLANG_PATH && existsSync(env.LIBCLANG_PATH)) return env.LIBCLANG_PATH;
  const xcode = spawnSync('xcode-select', ['-p'], { encoding: 'utf8' });
  const candidates = ['/opt/homebrew/opt/llvm/lib', '/usr/local/opt/llvm/lib', '/Library/Developer/CommandLineTools/usr/lib',
    ...(xcode.status === 0 ? [join(xcode.stdout.trim(), 'Toolchains/XcodeDefault.xctoolchain/usr/lib')] : []),
    '/usr/lib/llvm-20/lib', '/usr/lib/llvm-19/lib', '/usr/lib/llvm-18/lib', '/usr/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu'];
  return candidates.find((d) => existsSync(join(d, 'libclang.dylib')) || existsSync(join(d, 'libclang.so'))) || null;
}

const tail = (text, n = 6) => String(text || '').split('\n').filter((l) => l.trim()).slice(-n).join(' | ').slice(0, 600);

/** The operator's declaration for this repository, or null. An unreadable registry is thrown, never treated as "none declared". */
export function declaredHermetic(repoPath, env = process.env) {
  const path = env.CW_REGISTRY ? resolve(env.CW_REGISTRY) : registryPath();
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const reg = JSON.parse(text);
  const want = real(repoPath);
  const p = (reg.projects || []).find((x) => x && typeof x.path === 'string' && real(expandHome(x.path)) === want);
  return p && p.hermeticTest ? { name: p.name, ...p.hermeticTest } : null;
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Per-binary results from `cargo test` output: counts summed over every binary, and each failing test. */
export function parseCargoTest(log) {
  let binary = '';
  const failures = [];
  const totals = { passed: 0, failed: 0, ignored: 0 };
  let binaries = 0;
  for (const raw of stripAnsi(log).split('\n')) {
    const line = raw.trimEnd();
    const run = /^\s*Running (?:unittests )?(\S+) \(/.exec(line);
    if (run) { binary = run[1]; binaries++; continue; }
    const doc = /^\s*Doc-tests (\S+)/.exec(line);
    if (doc) { binary = `doc-tests ${doc[1]}`; binaries++; continue; }
    const fail = /^test (.+) \.\.\. FAILED$/.exec(line);
    if (fail) { failures.push({ binary, test: fail[1] }); continue; }
    const res = /^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored;/.exec(line);
    if (res) { totals.passed += +res[1]; totals.failed += +res[2]; totals.ignored += +res[3]; }
  }
  const compileError = /^error(\[E\d+\])?: /m.test(stripAnsi(log)) && /could not compile/.test(log);
  // Each failure's panic, from cargo's "---- <test> stdout ----" section: the message a reader
  // needs to tell a missing prerequisite from a broken test without re-running anything.
  const panics = new Map();
  const clean = stripAnsi(log);
  for (const m of clean.matchAll(/^---- (\S+) stdout ----\n([\s\S]*?)(?=\n---- |\n\nfailures:|\ntest result:|(?![\s\S]))/gm)) {
    const body = m[2].split('\n').filter((l) => l.trim() && !/^note: run with/.test(l));
    const at = body.findIndex((l) => /panicked at/.test(l));
    // The OS thread id differs on every run; kept, it would make every report a new one.
    panics.set(m[1], (at > -1 ? body.slice(at, at + 3) : body.slice(0, 3)).join(' ')
      .replace(/^thread '[^']*' (?:\(\d+\) )?/, '').replace(/\s+/g, ' ').slice(0, 300));
  }
  for (const f of failures) if (panics.has(f.test)) f.panic = panics.get(f.test);
  return { totals, failures, binaries, compileError };
}

const duBytes = (dir) => {
  const r = spawnSync('du', ['-sk', dir], { encoding: 'utf8' });
  const kb = r.status === 0 ? Number(String(r.stdout).split(/\s+/)[0]) : NaN;
  return Number.isFinite(kb) ? kb * 1024 : null;
};

export function runHermetic({ repo, extraPrepare = [], env = process.env }) {
  const summary = { findings: 0, byRule: {}, filesScanned: 0, void: false };
  const out = { tool: 'test-hermetic', summary, findings: [] };
  const add = (f) => { out.findings.push(f); summary.byRule[f.rule] = (summary.byRule[f.rule] || 0) + 1; summary.findings++; };
  if (!existsSync(join(repo, 'Cargo.toml'))) return { ...out, summary: { ...summary, void: true, voidReason: 'no Cargo.toml at the repository root — a stated void, not a passing suite' } };

  const declared = declaredHermetic(repo, env);
  const prepare = [...((declared && declared.prepare) || []), ...extraPrepare];
  const budgetGb = Number(env.CW_RUNNER_DISK_GB) > 0 ? Number(env.CW_RUNNER_DISK_GB) : (declared && declared.runnerDiskGb) || DEFAULT_RUNNER_DISK_GB;
  const target = join(env.CARGO_TARGET_DIR || sweepCargoTargetDir(repo, env), 'hermetic');
  mkdirSync(target, { recursive: true });

  const home = mkdtempSync(join(tmpdir(), 'cw-hermetic-home-'));
  const childEnv = { ...env };
  for (const k of Object.keys(childEnv)) if (/^XDG_(CACHE|DATA|CONFIG|STATE)_HOME$/.test(k)) delete childEnv[k];
  Object.assign(childEnv, {
    HOME: home,
    CARGO_HOME: env.CARGO_HOME || join(homedir(), '.cargo'),
    RUSTUP_HOME: env.RUSTUP_HOME || join(homedir(), '.rustup'),
    CARGO_TARGET_DIR: target,
    CARGO_PROFILE_DEV_DEBUG: '0',
    CARGO_PROFILE_TEST_DEBUG: '0',
  });
  const clang = libclangDir(env);
  if (clang) {
    childEnv.LIBCLANG_PATH = clang;
    // A link in $HOME/lib, not DYLD_FALLBACK_LIBRARY_PATH: SIP strips DYLD_* from /bin/sh and
    // everything it starts, so a prepare step (run through sh) never saw the variable, while dyld's
    // default fallback reads $HOME/lib from HOME, which SIP leaves alone. This is the one thing the
    // lane puts in the home, and the report names it.
    const lib = process.platform === 'darwin' ? join(clang, 'libclang.dylib') : join(clang, 'libclang.so');
    if (existsSync(lib)) { mkdirSync(join(home, 'lib')); symlinkSync(lib, join(home, 'lib', basename(lib))); }
  }
  Object.assign(summary, { prepareSteps: prepare.length, declaredBy: declared ? `registry projects[${declared.name}].hermeticTest` : null,
    runnerDiskGb: budgetGb, toolchainLibs: clang });
  const timeout = (Number(env.CW_HERMETIC_TIMEOUT_SEC) > 0 ? Number(env.CW_HERMETIC_TIMEOUT_SEC) : 5400) * 1000;
  // The log lives OUTSIDE the home: the home must hold nothing the suite did not put there.
  const logDir = mkdtempSync(join(tmpdir(), 'cw-hermetic-log-'));
  const logPath = join(logDir, 'cargo-test.log');
  try {
    for (const [i, cmd] of prepare.entries()) {
      const p = spawnSync('sh', ['-c', cmd], { cwd: repo, env: childEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout });
      if (p.status !== 0) {
        add({ rule: 'prepare-failed', path: 'registry:hermeticTest.prepare', sev: 'high', step: i + 1,
          detail: `declared prepare step ${i + 1} exited ${p.status ?? p.signal ?? 'on error'}; the suite was not run, so no test result is claimed. Last output: ${tail(`${p.stdout || ''}\n${p.stderr || ''}`)}` });
        summary.testsRun = false;
        return out;
      }
    }
    const fd = openSync(logPath, 'w');
    let r;
    try { r = spawnSync('cargo', ['test', '--no-fail-fast'], { cwd: repo, env: childEnv, stdio: ['ignore', fd, fd], timeout }); }
    finally { closeSync(fd); }
    if (r.error && r.error.code === 'ENOENT') return { ...out, summary: { ...summary, void: true, voidReason: 'cargo is not on PATH' } };
    if (r.error && r.error.code === 'ETIMEDOUT') return { ...out, summary: { ...summary, void: true, voidReason: `cargo test exceeded ${timeout / 1000}s — a truncated suite is not a result` } };
    const parsed = parseCargoTest(readFileSync(logPath, 'utf8'));
    Object.assign(summary, { testsRun: true, cargoExit: r.status, passed: parsed.totals.passed, failed: parsed.totals.failed,
      ignored: parsed.totals.ignored, binaries: parsed.binaries, filesScanned: parsed.binaries });
    for (const f of parsed.failures) {
      add({ rule: 'test-failed', path: f.binary || '(unknown binary)', sev: 'high', test: f.test,
        detail: `${f.test} failed on an empty home${f.panic ? `: ${f.panic}` : ''}` });
    }
    if (parsed.compileError && !parsed.binaries) add({ rule: 'build-failed', path: 'Cargo.toml', sev: 'high', detail: 'cargo test did not compile; no test ran' });
    if (r.status !== 0 && !parsed.failures.length && !(parsed.compileError && !parsed.binaries)) {
      add({ rule: 'test-failed', path: '(cargo test)', sev: 'high', test: '(exit status)', detail: `cargo test exited ${r.status} with no failing test named — the exit is the finding` });
    }
    const bytes = duBytes(target);
    summary.targetBytes = bytes;
    if (bytes !== null && bytes > HEADROOM_SHARE * budgetGb * 1e9) {
      add({ rule: 'disk-headroom', path: 'CARGO_TARGET_DIR', sev: 'med',
        detail: `the test build occupies ${(bytes / 1e9).toFixed(1)} GB, ${Math.round((100 * bytes) / (budgetGb * 1e9))}% of a hosted runner's ~${budgetGb} GB free disk` });
    }
    return out;
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const extraPrepare = [];
  const positional = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === '--prepare') extraPrepare.push(args[++i]); else positional.push(args[i]); }
  const repo = real(positional[0] || '.');
  let out;
  try { out = runHermetic({ repo, extraPrepare }); }
  catch (e) { process.stderr.write(`hermetic-test: ${e.code || ''} ${e.message}\n`); process.exit(2); }
  // exitCode, not exit(): exit() can cut off a piped stdout before the report is flushed.
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exitCode = out.summary.void ? 2 : 0;
}

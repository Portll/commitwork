// bin/test/hermetic-test.test.mjs — the hermetic test lane, over a real fixture crate.
//
// The property that matters is the one veld's CI lacked on 2026-09-27: the suite runs against an
// EMPTY home, so a cache on this machine cannot make a test pass that fails on a runner. The fixture
// crate asserts that about its own environment from inside cargo test, so the witness is the suite.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runHermetic, parseCargoTest, declaredHermetic } from '../hermetic-test.mjs';

const hasCargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' }).status === 0;

function crate() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-hermetic-fixture-'));
  const repo = join(dir, 'fx');
  mkdirSync(join(repo, 'src'), { recursive: true }); mkdirSync(join(repo, 'tests'));
  writeFileSync(join(repo, 'Cargo.toml'), '[package]\nname = "hermetic_fixture"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n');
  writeFileSync(join(repo, 'src', 'lib.rs'), `
#[cfg(test)]
mod tests {
    #[test]
    fn passes() { assert_eq!(1 + 1, 2); }

    #[test]
    fn the_home_holds_only_what_prepare_put_there() {
        // lib/ is the lane's one addition when the host has libclang: a single toolchain link.
        let home = std::env::var("HOME").unwrap();
        let mut entries: Vec<String> = std::fs::read_dir(&home).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).filter(|n| n != "lib").collect();
        entries.sort();
        assert_eq!(entries, vec![".cache".to_string()], "home {} held {:?}", home, entries);
        if let Ok(libs) = std::fs::read_dir(std::path::Path::new(&home).join("lib")) {
            let names: Vec<String> = libs.map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
            assert!(names.iter().all(|n| n.starts_with("libclang.")), "lib held {:?}", names);
        }
    }

    #[test]
    fn prepare_ran_in_this_home() {
        let home = std::env::var("HOME").unwrap();
        assert!(std::path::Path::new(&home).join(".cache/probe").exists());
    }
}
`);
  writeFileSync(join(repo, 'tests', 'other.rs'), '#[test]\nfn fails_on_purpose() { assert!(false, "planted"); }\n');
  return { dir, repo };
}

const PREPARE = 'mkdir -p "$HOME/.cache" && touch "$HOME/.cache/probe"';

describe('over a real crate', { skip: !hasCargo && 'cargo is not installed here' }, () => {
  const { dir, repo } = hasCargo ? crate() : { dir: null, repo: null };
  const base = hasCargo ? { CARGO_TARGET_DIR: join(dir, 'target'), CW_REGISTRY: join(dir, 'no-registry.json') } : {};
  const env = { ...process.env, ...base };

  test('counts sum over every binary; the planted failure is named with its binary; the home was empty', () => {
    const out = runHermetic({ repo, extraPrepare: [PREPARE], env });
    const s = out.summary;
    assert.equal(s.testsRun, true, JSON.stringify(s));
    assert.deepEqual({ passed: s.passed, failed: s.failed }, { passed: 3, failed: 1 }, 'the two home assertions ran inside cargo test and passed');
    const fails = out.findings.filter((f) => f.rule === 'test-failed');
    assert.deepEqual(fails.map((f) => [f.path, f.test]), [['tests/other.rs', 'fails_on_purpose']]);
    assert.equal(s.cargoExit, 101);
    assert.equal(out.findings.some((f) => f.rule === 'disk-headroom'), false, 'a tiny crate is far inside a runner\'s disk');
  });

  test('a build over the runner budget is a disk-headroom finding', () => {
    const out = runHermetic({ repo, extraPrepare: [PREPARE], env: { ...env, CW_RUNNER_DISK_GB: '0.000001' } });
    const h = out.findings.find((f) => f.rule === 'disk-headroom');
    assert.ok(h, JSON.stringify(out.summary));
    assert.match(h.detail, /of a hosted runner's ~1e-06 GB free disk|% of a hosted runner/);
  });

  test('without the prepare step the suite fails exactly where the empty home bites', () => {
    const out = runHermetic({ repo, extraPrepare: [], env });
    const failed = out.findings.filter((f) => f.rule === 'test-failed').map((f) => f.test).sort();
    assert.deepEqual(failed, ['fails_on_purpose', 'tests::prepare_ran_in_this_home', 'tests::the_home_holds_only_what_prepare_put_there']);
  });

  test('a failing prepare step is a finding, and no test result is claimed', () => {
    const out = runHermetic({ repo, extraPrepare: ['exit 3'], env });
    assert.deepEqual(out.findings.map((f) => f.rule), ['prepare-failed']);
    assert.equal(out.summary.testsRun, false);
    assert.equal(out.summary.passed, undefined);
  });

  test('the operator declares prepare steps in the registry, matched by the repository\'s path', () => {
    const reg = join(dir, 'registry.json');
    writeFileSync(reg, JSON.stringify({ projects: [{ name: 'fx', path: repo, manifest: ['hermetic-tests'], hermeticTest: { prepare: [PREPARE] } }] }));
    assert.deepEqual(declaredHermetic(repo, { CW_REGISTRY: reg }), { name: 'fx', prepare: [PREPARE] });
    const out = runHermetic({ repo, env: { ...env, CW_REGISTRY: reg } });
    assert.equal(out.summary.declaredBy, 'registry projects[fx].hermeticTest');
    assert.equal(out.summary.passed, 3);
  });

  test('cleanup', () => { if (dir) rmSync(dir, { recursive: true, force: true }); });
});

test('parseCargoTest sums every binary, keeps each failure\'s binary, and sees doc-tests', () => {
  const log = [
    '     Running unittests src/lib.rs (target/debug/deps/x-1)',
    'test a ... ok', 'test b ... FAILED',
    'test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
    '     Running tests/it.rs (target/debug/deps/it-2)',
    'test c ... ok',
    'test result: ok. 4 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s',
    '   Doc-tests x',
    'test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s',
  ].join('\n');
  const p = parseCargoTest(log);
  assert.deepEqual(p.totals, { passed: 5, failed: 1, ignored: 3 });
  assert.deepEqual(p.failures, [{ binary: 'src/lib.rs', test: 'b' }]);
  assert.equal(p.binaries, 3);
});

test('parseCargoTest keeps each failure\'s panic message', () => {
  const log = [
    '     Running tests/it.rs (target/debug/deps/it-2)',
    'test models::loads ... FAILED',
    '', 'failures:', '',
    '---- models::loads stdout ----',
    '',
    'thread \'models::loads\' panicked at tests/it.rs:12:5:',
    'Failed to initialize MiniLM embedder (ONNX model)',
    'note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace',
    '', '', 'failures:', '    models::loads',
    'test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s',
  ].join('\n');
  const [f] = parseCargoTest(log).failures;
  assert.equal(f.panic, 'panicked at tests/it.rs:12:5: Failed to initialize MiniLM embedder (ONNX model)');
  const withThreadId = log.replace('thread \'models::loads\' panicked', 'thread \'models::loads\' (128098294) panicked');
  assert.equal(parseCargoTest(withThreadId).failures[0].panic, f.panic, 'current Rust prints the OS thread id, which differs on every run');
});

test('an unreadable registry is an error, never "nothing declared"', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-hermetic-reg-'));
  try {
    mkdirSync(join(d, 'registry.json'));
    assert.throws(() => declaredHermetic(d, { CW_REGISTRY: join(d, 'registry.json') }), /EISDIR|illegal operation/);
    assert.equal(declaredHermetic(d, { CW_REGISTRY: join(d, 'absent.json') }), null, 'only ENOENT is an absence');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

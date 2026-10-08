// bin/test/actions-gaps-pipe.test.mjs — exit-masked-by-pipe.
//
// veld's Tests job ran `cargo test --no-fail-fast 2>&1 | tee test-output.txt` under GitHub's
// default `bash -e {0}` from 2026-05-21 to 2026-09-27, and 216 failures could not fail it. The last
// test here is the rule's second witness: it runs the shells the rule reasons about and checks that
// they really behave the way the rule claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseYaml, scanWorkflow, maskedPipelines, effectiveShell, shellDropsPipefail } from '../actions-gaps.mjs';

const scan = (yaml) => scanWorkflow('.github/workflows/ci.yml', parseYaml(yaml)).findings.filter((f) => f.rule === 'exit-masked-by-pipe');
const wf = (steps, { jobExtra = '', top = '', runsOn = 'ubuntu-latest' } = {}) =>
  `name: CI\non: push\n${top}jobs:\n  test:\n    name: Tests\n    runs-on: ${runsOn}\n${jobExtra}    steps:\n${steps}`;
const step = (name, run, extra = '') => `      - name: ${name}\n${extra}        run: |\n${run.split('\n').map((l) => `          ${l}`).join('\n')}\n`;

test('veld\'s own step, as it stood, is found; the fixed step is not', () => {
  const before = scan(wf(step('Run all tests', 'cargo test --no-fail-fast 2>&1 | tee test-output.txt')));
  assert.equal(before.length, 1);
  assert.deepEqual({ job: before[0].job, step: before[0].step, sev: before[0].sev, cwe: before[0].cwe }, { job: 'test', step: 'Run all tests', sev: 'med', cwe: 'CWE-252' });
  assert.match(before[0].detail, /into tee on the default shell \(bash -e, no pipefail\).*failure of cargo cannot fail the job/);
  assert.equal(scan(wf(step('Run all tests', 'set -o pipefail\ncargo test --no-fail-fast 2>&1 | tee test-output.txt'))).length, 0);
});

test('one finding per job: the row identity is (rule, workflow, job), so later steps are counted, not repeated', () => {
  const f = scan(wf(step('first', 'make test | tee a.log') + step('second', 'make lint | tee b.log')));
  assert.equal(f.length, 1);
  assert.equal(f[0].step, 'first');
  assert.match(f[0].detail, /1 more step\(s\) in this job do the same/);
});

test('a script that hands PIPESTATUS back is handled, like pipefail', () => {
  assert.equal(scan(wf(step('t', 'python bench/guard.py 2>&1 | tee out.txt\nexit "${PIPESTATUS[0]}"'))).length, 0);
});

test('the detail names commands, never the script', () => {
  const [f] = scan(wf(step('t', 'SECRET=hunter2 cargo test --features x 2>&1 | tee out.txt')));
  assert.doesNotMatch(f.detail, /hunter2|--features|out\.txt/);
});

test('shells that keep pipefail are clean, at step, job and workflow level; sh and templates without it are not', () => {
  const pipe = 'make check | tee log.txt';
  assert.equal(scan(wf(step('t', pipe, '        shell: bash\n'))).length, 0, 'step shell: bash runs -eo pipefail');
  assert.equal(scan(wf(step('t', pipe), { jobExtra: '    defaults:\n      run:\n        shell: bash\n' })).length, 0, 'job default');
  assert.equal(scan(wf(step('t', pipe), { top: 'defaults:\n  run:\n    shell: bash\n' })).length, 0, 'workflow default');
  assert.equal(scan(wf(step('t', pipe, '        shell: sh\n'))).length, 1, 'sh -e has no pipefail');
  assert.equal(scan(wf(step('t', pipe, '        shell: bash {0}\n'))).length, 1, 'a custom template drops the default flags');
  assert.equal(scan(wf(step('t', pipe, '        shell: bash -eo pipefail {0}\n'))).length, 0);
  assert.equal(scan(wf(step('t', pipe), { runsOn: 'windows-latest' })).length, 0, 'a Windows job runs pwsh by default');
});

test('pipelines that hide nothing, or whose failure is handled, are not findings', () => {
  const none = [
    'echo "## Results" | tee -a "$GITHUB_STEP_SUMMARY"',
    'printf "%s\\n" x | sort',
    'cargo test | tee out.txt || true',
    'if cargo metadata | grep -q ironwork; then echo yes; fi',
    'grep "a|b" file.txt',
    '# cargo test | tee out.txt',
    'cat <<EOF > note.md\ncargo test | tee out.txt\nEOF',
    'cargo test > out.txt 2>&1',
    'PASSED=$(grep -oE "[0-9]+ passed;" out.txt | awk \'{s+=$1} END {print s+0}\')',
    'VERSION=$(grep \'^version = \' Cargo.toml | head -1 | sed \'s/"//g\')',
    'count() { grep -oE "[0-9]+ $1;" test-output.txt | awk \'{s+=$1} END {print s+0}\'; }',
    'LLAMA_SERVER=$(find llama -name "llama-server" -type f | head -1)',
  ];
  for (const s of none) assert.deepEqual(maskedPipelines(s), [], s);
});

test('pipelines that hide a failure are found, including across continuations and in assignments', () => {
  assert.deepEqual(maskedPipelines('cargo test --no-fail-fast 2>&1 | tee test-output.txt'), [{ source: 'cargo', sink: 'tee' }]);
  assert.deepEqual(maskedPipelines('cargo test \\\n  --all | tee x.txt'), [{ source: 'cargo', sink: 'tee' }]);
  assert.deepEqual(maskedPipelines('RESULT=$(npm test | tail -1)'), [{ source: 'npm', sink: 'tail' }]);
  assert.deepEqual(maskedPipelines('npm test | grep -v warn; go vet ./... | cat'), [{ source: 'npm', sink: 'grep' }, { source: 'go', sink: 'cat' }]);
  assert.deepEqual(maskedPipelines('for f in $(git ls-files \'*.mjs\' | sort); do node --check "$f"; done'), [{ source: 'git', sink: 'sort' }],
    'a failing git ls-files gives an empty loop and a false pass');
  assert.deepEqual(maskedPipelines('if [ -f Cargo.toml ]; then cargo test | tee t.txt; fi'), [{ source: 'cargo', sink: 'tee' }]);
  assert.deepEqual(maskedPipelines('run() { cargo test "$@" | tee t.txt; }'), [{ source: 'cargo', sink: 'tee' }]);
  assert.deepEqual(maskedPipelines('CI=1 pytest -q | tee r.txt'), [{ source: 'pytest', sink: 'tee' }]);
});

test('effectiveShell prefers the step, then the job, then the workflow', () => {
  const doc = parseYaml('defaults:\n  run:\n    shell: sh\njobs:\n  a:\n    defaults:\n      run:\n        shell: bash\n    steps:\n      - run: x\n        shell: pwsh\n      - run: y\n');
  const job = doc.entries.get('jobs').entries.get('a');
  const [s1, s2] = job.entries.get('steps').items;
  assert.equal(effectiveShell(doc, job, s1), 'pwsh');
  assert.equal(effectiveShell(doc, job, s2), 'bash');
  assert.equal(shellDropsPipefail(''), true);
  assert.equal(shellDropsPipefail('bash'), false);
  assert.equal(shellDropsPipefail('sh'), true);
});

// The second witness. The rule's whole claim is about shell semantics, so the shells are asked.
test('the shells behave as the rule claims: bash -e and sh -e hide a failing left side; -o pipefail does not', { skip: process.platform === 'win32' && 'no POSIX shell' }, () => {
  const run = (shell, args, script) => spawnSync(shell, [...args, '-c', script], { encoding: 'utf8' }).status;
  assert.equal(run('bash', ['-e'], 'false | tee /dev/null'), 0, 'GitHub\'s default bash -e {0}: masked');
  assert.equal(run('sh', ['-e'], 'false | tee /dev/null'), 0, 'shell: sh runs sh -e {0}: masked');
  assert.equal(run('bash', ['--noprofile', '--norc', '-eo', 'pipefail'], 'false | tee /dev/null'), 1, 'shell: bash runs -eo pipefail: not masked');
  assert.equal(run('bash', ['-e'], 'set -o pipefail; false | tee /dev/null'), 1, 'set -o pipefail in the script: not masked');
});

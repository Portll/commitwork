// node --test monitor/test/ — item 8. Pinned: the judgment is about the DIRECT parent (on macOS
// every chain reaches launchd, so chain-contains-launchd discriminates nothing); a chain that
// cannot be walked is its own unknown state; the lens excludes itself from evidence; enumeration
// failure is unknown, never "nothing relevant running".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePidPpidComm, parsePidArgs, assessAncestry, runLens, ALLOWED_PARENTS } from '../process-ancestry.mjs';

const COMM = `    1     0 /sbin/launchd
  100     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal
  200   100 /bin/zsh
  300   200 /usr/local/bin/node
  400   300 /usr/local/bin/node
  500     1 /opt/homebrew/bin/ollama
  600   601 /usr/bin/python3
  700   600 /usr/local/bin/node
`;
const ARGS = `    1 /sbin/launchd
  100 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal
  200 -zsh
  300 node /opt/commitwork/monitor/sweep.mjs all
  400 node /opt/commitwork/admin/serve.mjs
  500 /opt/homebrew/bin/ollama serve
  600 python3 dropper.py
  700 node /opt/commitwork/monitor/rollup.mjs
`;

describe('parsers', () => {
  test('comm keeps paths with spaces whole; args joins by pid', () => {
    const procs = parsePidPpidComm('  10  1 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin)\n');
    assert.equal(procs.get(10).comm, '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin)');
    assert.equal(parsePidArgs('  10 node a.mjs --flag\n').get(10), 'node a.mjs --flag');
  });
});

describe('assessment — the direct parent is the fact that discriminates', () => {
  const procs = parsePidPpidComm(COMM);
  const argsBy = parsePidArgs(ARGS);

  test('the verdicts, precisely', () => {
    const r = assessAncestry(procs, argsBy);
    const byPid = Object.fromEntries(r.rows.map((x) => [x.pid, x]));
    assert.equal(byPid[300].parent.name, 'zsh');
    assert.equal(byPid[300].verdict, 'expected');
    assert.deepEqual(byPid[300].chain, ['zsh', 'Terminal', 'launchd']);
    assert.equal(byPid[400].parent.name, 'node');
    assert.equal(byPid[400].verdict, 'expected');
    assert.equal(byPid[500].parent.name, 'launchd');
    assert.equal(byPid[500].verdict, 'expected');
    // The signal: a rollup spawned by a python dropper — python3 is not an allowed parent.
    assert.equal(byPid[700].parent.name, 'python3');
    assert.equal(byPid[700].verdict, 'unexpected-parent');
    assert.equal(r.state, 'findings');
    assert.deepEqual(r.findings.map((f) => f.pid), [700]);
  });

  test('a walkable-but-incomplete chain still judges the direct parent, and says it is incomplete', () => {
    // pid 700's parent 600 exists, but 600's parent 601 does not — the chain breaks above.
    const r = assessAncestry(procs, argsBy);
    const row = r.rows.find((x) => x.pid === 700);
    assert.equal(row.chainIncomplete, true);
  });

  test('a missing DIRECT parent is unknown(truncated) — never expected, never a finding', () => {
    const p = parsePidPpidComm('  50  49 /usr/local/bin/node\n');
    const a = parsePidArgs('  50 node /x/commitwork/monitor/sweep.mjs\n');
    const r = assessAncestry(p, a);
    assert.equal(r.rows[0].unknownReason, 'truncated');
    assert.equal(r.rows[0].verdict, null);
    assert.equal(r.state, 'partial');
  });

  test('the lens excludes its own process from evidence', () => {
    const p = parsePidPpidComm('  60   1 /usr/local/bin/node\n');
    const a = parsePidArgs('  60 node /x/commitwork/monitor/sweep.mjs\n');
    assert.equal(assessAncestry(p, a, { selfPid: 60 }).rows.length, 0);
  });

  test('an engine worker parented by its own app is expected — the exception is per-entry, never global', () => {
    const p = parsePidPpidComm('   90    1 /Applications/LM Studio.app/Contents/MacOS/LM Studio\n   91   90 /Applications/LM Studio.app/Contents/Resources/worker\n   92   90 /usr/bin/python3\n');
    const a = parsePidArgs('   91 LM Studio inference worker\n   92 python3 LM Studio-adjacent-thing\n');
    const r = assessAncestry(p, a);
    const byPid = Object.fromEntries(r.rows.map((x) => [x.pid, x]));
    assert.equal(byPid[91].verdict, 'expected', "the engine's own app is an ordinary parent for the engine");
    // And the exception does not leak: python3 stays disallowed globally even under an ownParents entry —
    // ownParents allows the APP as parent, it does not allow arbitrary parents for the entry.
    const p2 = parsePidPpidComm('   93   92 /Applications/LM Studio.app/Contents/Resources/worker\n   92    1 /usr/bin/python3\n');
    const a2 = parsePidArgs('   93 LM Studio worker\n');
    assert.equal(assessAncestry(p2, a2).rows[0].verdict, 'unexpected-parent', 'python3 parenting an engine worker still fires');
  });

  test('irrelevant processes are not judged at all', () => {
    const p = parsePidPpidComm('  70  1 /usr/bin/python3\n');
    const a = parsePidArgs('  70 python3 something-else.py\n');
    assert.deepEqual(assessAncestry(p, a).rows, []);
  });
});

describe('discipline', () => {
  test('ps failure is unknown — never "nothing relevant running"', () => {
    const r = runLens({ exec: () => { const e = new Error('nope'); e.code = 'EPERM'; throw e; } });
    assert.equal(r.unknown, true);
    assert.equal(r.state, 'unknown');
  });

  test('the allowlist is small on purpose — growing it is a decision', () => {
    assert.ok(ALLOWED_PARENTS.size <= 24, `ALLOWED_PARENTS grew to ${ALLOWED_PARENTS.size}; an over-broad allowlist is a lens that cannot fire`);
    assert.ok(!ALLOWED_PARENTS.has('python3'));
    assert.ok(!ALLOWED_PARENTS.has('nc'));
  });
});

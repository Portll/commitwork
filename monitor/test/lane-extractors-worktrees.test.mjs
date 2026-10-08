// The seven lanes landed 2026-09 set nested-worktree rows aside exactly as _minifyCounts does:
// out of the totals, severity intact, enumerable under `worktrees`. Measured 2026-09-16 on
// commitwork: 21 of 21 agent-instructions rows and 5 of 5 model-artefacts rows named a copy
// under .claude/worktrees/ and were lodged as issues on the repository itself.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _agentInstructionsCounts, _agentConfigCounts, _modelArtefactsCounts, _depsContentCounts,
  _commitProvenanceCounts, _actionsGapsCounts, _commitVelocityCounts,
} from '../extractors.mjs';

const WT = '.claude/worktrees/agent-x/CLAUDE.md';
const REAL = 'CLAUDE.md';

const LANES = [
  ['agent-instructions', _agentInstructionsCounts, { filesScanned: 2 }, {}],
  ['agent-config', _agentConfigCounts, { filesScanned: 2 }, { key: 'k' }],
  ['model-artefacts', _modelArtefactsCounts, { filesScanned: 2 }, { line: 3 }],
  ['deps-content', _depsContentCounts, { filesScanned: 2 }, {}],
  ['commit-provenance', _commitProvenanceCounts, { commitsScanned: 2 }, { sha: 'abc' }],
  ['actions-gaps', _actionsGapsCounts, { filesScanned: 2 }, { job: 'j', step: '' }],
  ['commit-velocity', _commitVelocityCounts, { filesScanned: 2 }, {}],
];

function artifact(tool, summary, extra) {
  const row = (path) => ({ rule: 'r', path, sev: 'high', cwe: 'CWE-1', detail: 'd', ...extra });
  return `${JSON.stringify({ tool, summary: { findings: 2, byRule: { r: 2 }, ...summary }, findings: [row(WT), row(REAL)] })}\n`;
}

describe('a row under a nested agent worktree is set aside, never counted and never dropped', () => {
  for (const [tool, fn, summary, extra] of LANES) {
    test(tool, () => {
      const d = mkdtempSync(join(tmpdir(), 'cw-lane-wt-'));
      try {
        const file = `${tool}.json`;
        writeFileSync(join(d, file), artifact(tool, summary, extra));
        const r = fn(d, file);
        assert.equal(r.ran, true);
        assert.equal(r.total, 1, 'the real row alone is counted');
        assert.equal(r.high, 1);
        assert.ok(Object.keys(r).includes('worktrees'), 'the set-aside is an enumerable key');
        assert.equal(r.worktrees.total, 1);
        assert.equal(r.worktrees.high, 1, 'severity survives the set-aside');
        assert.equal(r.worktrees.of, 2);
        assert.deepEqual(r.worktrees.byPattern, { '.claude/worktrees': 1 });
        assert.deepEqual(r.worktrees.byName, { 'agent-x': 1 });
        assert.equal(r.worktrees.rows.length, 1);
        assert.equal(r.worktrees.rows[0].file, WT);
        assert.equal(r.worktrees.rows[0].sev, 'high');
        assert.equal(r.worktrees.rows[0].name, 'agent-x');
        assert.match(r.worktrees.note, /excluded from these counts/);
        const rest = JSON.stringify({ ...r, worktrees: undefined });
        assert.ok(!rest.includes('.claude/worktrees'), 'the worktree row appears nowhere but under worktrees');
        assert.ok(rest.includes(REAL), 'the real row is published');
      } finally { rmSync(d, { recursive: true, force: true }); }
    });
  }
});

test('CW_WORKTREE_PATHS=off counts everything and publishes no worktrees key', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-lane-wt-'));
  const prev = process.env.CW_WORKTREE_PATHS;
  process.env.CW_WORKTREE_PATHS = 'off';
  try {
    writeFileSync(join(d, 'agent-instructions.json'), artifact('agent-instructions', { filesScanned: 2 }, {}));
    const r = _agentInstructionsCounts(d, 'agent-instructions.json');
    assert.equal(r.total, 2);
    assert.equal(r.worktrees, undefined);
  } finally {
    if (prev === undefined) delete process.env.CW_WORKTREE_PATHS; else process.env.CW_WORKTREE_PATHS = prev;
    rmSync(d, { recursive: true, force: true });
  }
});

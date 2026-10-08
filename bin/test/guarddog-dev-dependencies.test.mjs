// bin/test/guarddog-dev-dependencies.test.mjs — the devDependencies flag stays on the command.
//
// WHAT THIS IS AND IS NOT. This asserts a FLAG IS PRESENT; it cannot assert the tool obeys it,
// because that needs Docker, the network and ~4 minutes. The behaviour was established by
// measurement instead, 2026-09-18 against the pinned v3.2.0 image, on two scratch manifests
// differing only in which map holds shelljs@0.8.5:
//
//   {"dependencies":    {"shelljs":"^0.8.5", …}} -> 15 capability-* results, exit 0
//   {"devDependencies": {"shelljs":"^0.8.5"}}    ->  0 results, exit 0, 63 rules loaded
//   the same devDeps-only manifest + --include-dev-dependencies -> 5 results
//
// The middle line is the reason this test exists: 0 results with a full rule set and exit 0 is
// indistinguishable from a clean tree, so dropping the flag would restore a silent void rather
// than a visible failure. commitwork declares 0 dependencies and 1 devDependency, so it was
// scanning nothing and publishing pass. Re-measure with the fixtures above if this ever fails;
// do not "fix" it by deleting the assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const roster = JSON.parse(readFileSync(join(CW, 'manifests/security-baseline.json'), 'utf8'));
const check = roster.checks.find((c) => c.id === 'supply-chain-guarddog');

test('the guarddog lane still exists and scans package.json', () => {
  assert.ok(check, 'supply-chain-guarddog must be in the roster');
  const cmd = (check.local || []).join('\n');
  assert.match(cmd, /npm verify \S*package\.json/, 'must scan package.json, never a lockfile');
});

test('every guarddog npm verify passes --include-dev-dependencies', () => {
  const commands = (check.local || []).filter((c) => /npm verify/.test(c));
  assert.ok(commands.length, 'expected at least one npm verify command');
  for (const c of commands) {
    assert.match(c, /--include-dev-dependencies/,
      'without this flag GuardDog scans only `dependencies`, and a devDependencies-only repo '
      + 'produces a rules-only SARIF with exit 0 — a void that reads as a clean tree');
  }
});

test('the notes record the measurement rather than asserting the behaviour', () => {
  assert.match(check.notes, /--include-dev-dependencies|include-dev-dependencies/);
  assert.match(check.notes, /shelljs/, 'the fixture that produced the 15/0/5 counts is named');
});

// Renders a GitHub step summary from SARIF summary, decision, run exit, and fail-on. (bin/lib/github-action.mjs renderSummary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSummary } from '../lib/github-action.mjs';

test('renders ok sarif with no unmeasured and no failure', () => {
  const sarif = { state: 'ok', results: 3, levels: { error: 1, warning: 1, note: 1 }, unmeasured: [], reduced: [], undetermined: 0 };
  const decision = { failed: false, reasons: [], warnings: [] };
  assert.deepEqual(renderSummary({ sarif, decision, runExit: 0, failOn: 'none' }), "### commitwork\n\n| | |\n|---|---|\n| Results | 3 (1 error, 1 warning, 1 note) |\n| Lanes that did not measure | 0 |\n| Lanes with reduced coverage | 0 |\n| Undetermined, not counted as results | 0 |\n| `commitwork run` exit | 0 |\n\nThe step does not fail (fail-on: none).\n");
});

test('renders ok sarif with unmeasured lanes and failure reasons', () => {
  const sarif = { state: 'ok', results: 2, levels: { error: 2, warning: 0, note: 0 }, unmeasured: [{ lane: 'a', level: 'warning', text: 'lane a did not measure' }], reduced: [{ lane: 'b', level: 'note', text: 'lane b reduced' }], undetermined: 1 };
  const decision = { failed: true, reasons: ['2 result(s) at level error or above', '1 lane(s) did not measure'], warnings: [] };
  assert.deepEqual(renderSummary({ sarif, decision, runExit: 1, failOn: 'error' }), "### commitwork\n\n| | |\n|---|---|\n| Results | 2 (2 error, 0 warning, 0 note) |\n| Lanes that did not measure | 1 |\n| Lanes with reduced coverage | 1 |\n| Undetermined, not counted as results | 1 |\n| `commitwork run` exit | 1 |\n\nDid not measure, so neither clean nor a finding:\n\n- lane a did not measure\n\nThe step fails (fail-on: error):\n\n- 2 result(s) at level error or above\n- 1 lane(s) did not measure\n");
});

test('renders non-ok sarif state with failure', () => {
  const sarif = { state: 'absent', why: 'ENOENT' };
  const decision = { failed: true, reasons: ['no SARIF to judge (absent: ENOENT)'], warnings: [] };
  assert.deepEqual(renderSummary({ sarif, decision, runExit: 2, failOn: 'none' }), "### commitwork\n\nNo SARIF to report (absent). `commitwork run` exited 2.\n\nThe step fails (fail-on: none):\n\n- no SARIF to judge (absent: ENOENT)\n");
});

test('renders non-ok sarif state with no failure', () => {
  const sarif = { state: 'unreadable', why: 'bad json' };
  const decision = { failed: false, reasons: [], warnings: [] };
  assert.deepEqual(renderSummary({ sarif, decision, runExit: 0, failOn: 'none' }), "### commitwork\n\nNo SARIF to report (unreadable). `commitwork run` exited 0.\n\nThe step does not fail (fail-on: none).\n");
});

test('renders ok sarif with unmeasured and warnings in decision', () => {
  const sarif = { state: 'ok', results: 1, levels: { error: 0, warning: 1, note: 0 }, unmeasured: [{ lane: 'x', level: 'warning', text: 'x did not measure' }], reduced: [], undetermined: 0 };
  const decision = { failed: false, reasons: [], warnings: ['x did not measure'] };
  assert.deepEqual(renderSummary({ sarif, decision, runExit: 0, failOn: 'none' }), "### commitwork\n\n| | |\n|---|---|\n| Results | 1 (0 error, 1 warning, 0 note) |\n| Lanes that did not measure | 1 |\n| Lanes with reduced coverage | 0 |\n| Undetermined, not counted as results | 0 |\n| `commitwork run` exit | 0 |\n\nDid not measure, so neither clean nor a finding:\n\n- x did not measure\n\nThe step does not fail (fail-on: none).\n");
});

test('renders ok sarif with zero results and no failure', () => {
  const sarif = { state: 'ok', results: 0, levels: { error: 0, warning: 0, note: 0 }, unmeasured: [], reduced: [], undetermined: 0 };
  const decision = { failed: false, reasons: [], warnings: [] };
  assert.deepEqual(renderSummary({ sarif, decision, runExit: 0, failOn: 'none' }), "### commitwork\n\n| | |\n|---|---|\n| Results | 0 (0 error, 0 warning, 0 note) |\n| Lanes that did not measure | 0 |\n| Lanes with reduced coverage | 0 |\n| Undetermined, not counted as results | 0 |\n| `commitwork run` exit | 0 |\n\nThe step does not fail (fail-on: none).\n");
});

test('renders ok sarif with multiple unmeasured lanes and failure', () => {
  const sarif = { state: 'ok', results: 5, levels: { error: 3, warning: 2, note: 0 }, unmeasured: [{ lane: 'a', level: 'warning', text: 'a' }, { lane: 'b', level: 'warning', text: 'b' }], reduced: [], undetermined: 2 };
  const decision = { failed: true, reasons: ['3 result(s) at level error or above', '2 lane(s) did not measure'], warnings: [] };
  assert.deepEqual(renderSummary({ sarif, decision, runExit: 1, failOn: 'error' }), "### commitwork\n\n| | |\n|---|---|\n| Results | 5 (3 error, 2 warning, 0 note) |\n| Lanes that did not measure | 2 |\n| Lanes with reduced coverage | 0 |\n| Undetermined, not counted as results | 2 |\n| `commitwork run` exit | 1 |\n\nDid not measure, so neither clean nor a finding:\n\n- a\n- b\n\nThe step fails (fail-on: error):\n\n- 3 result(s) at level error or above\n- 2 lane(s) did not measure\n");
});

test('renders ok sarif with reduced lanes and no unmeasured', () => {
  const sarif = { state: 'ok', results: 4, levels: { error: 0, warning: 0, note: 4 }, unmeasured: [], reduced: [{ lane: 'c', level: 'note', text: 'c reduced' }], undetermined: 0 };
  const decision = { failed: false, reasons: [], warnings: [] };
  assert.deepEqual(renderSummary({ sarif, decision, runExit: 0, failOn: 'none' }), "### commitwork\n\n| | |\n|---|---|\n| Results | 4 (0 error, 0 warning, 4 note) |\n| Lanes that did not measure | 0 |\n| Lanes with reduced coverage | 1 |\n| Undetermined, not counted as results | 0 |\n| `commitwork run` exit | 0 |\n\nThe step does not fail (fail-on: none).\n");
});

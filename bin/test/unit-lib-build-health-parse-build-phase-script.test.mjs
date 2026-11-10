// Builds a shell script that runs build phases sequentially with timeout and phase markers (bin/lib/build-health-parse.mjs buildPhaseScript).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPhaseScript } from '../lib/build-health-parse.mjs';

test('throws when steps is not an array', () => {
  assert.throws(() => buildPhaseScript(null), { name: 'Error', message: 'buildPhaseScript: steps must be a non-empty array' });
});

test('throws when steps is an empty array', () => {
  assert.throws(() => buildPhaseScript([]), { name: 'Error', message: 'buildPhaseScript: steps must be a non-empty array' });
});

test('returns script with single step and default timeout', () => {
  const r = buildPhaseScript([{ name: 'build', cmd: 'make' }]);
  assert.equal(r, "cw_rc=0; if [ \"$cw_rc\" -eq 0 ]; then timeout 1800 sh -c 'make'; cw_p=$?; echo \"__CW_PHASE name=build attempted=1 exit=$cw_p\"; cw_rc=$cw_p; else echo \"__CW_PHASE name=build attempted=0 exit=-\"; fi; echo \"__CW_PHASE end=1\"");
});

test('returns script with custom timeout', () => {
  const r = buildPhaseScript([{ name: 'test', cmd: 'npm test' }], { timeoutSeconds: 60 });
  assert.equal(r, "cw_rc=0; if [ \"$cw_rc\" -eq 0 ]; then timeout 60 sh -c 'npm test'; cw_p=$?; echo \"__CW_PHASE name=test attempted=1 exit=$cw_p\"; cw_rc=$cw_p; else echo \"__CW_PHASE name=test attempted=0 exit=-\"; fi; echo \"__CW_PHASE end=1\"");
});

test('returns script with multiple steps', () => {
  const r = buildPhaseScript([
    { name: 'compile', cmd: 'gcc -o app main.c' },
    { name: 'run', cmd: './app' },
  ]);
  assert.equal(r, "cw_rc=0; if [ \"$cw_rc\" -eq 0 ]; then timeout 1800 sh -c 'gcc -o app main.c'; cw_p=$?; echo \"__CW_PHASE name=compile attempted=1 exit=$cw_p\"; cw_rc=$cw_p; else echo \"__CW_PHASE name=compile attempted=0 exit=-\"; fi; if [ \"$cw_rc\" -eq 0 ]; then timeout 1800 sh -c './app'; cw_p=$?; echo \"__CW_PHASE name=run attempted=1 exit=$cw_p\"; cw_rc=$cw_p; else echo \"__CW_PHASE name=run attempted=0 exit=-\"; fi; echo \"__CW_PHASE end=1\"");
});

test('throws when phase name contains a space', () => {
  assert.throws(() => buildPhaseScript([{ name: 'bad name', cmd: 'echo hi' }]), { name: 'Error', message: 'buildPhaseScript: bad phase name "bad name"' });
});

test('throws when phase name contains a newline', () => {
  assert.throws(() => buildPhaseScript([{ name: 'bad\nname', cmd: 'echo hi' }]), { name: 'Error', message: 'buildPhaseScript: bad phase name "bad\\nname"' });
});

test('quotes single quotes in command', () => {
  const r = buildPhaseScript([{ name: 'q', cmd: "echo 'it'" }]);
  assert.equal(r, "cw_rc=0; if [ \"$cw_rc\" -eq 0 ]; then timeout 1800 sh -c 'echo '\\''it'\\'''; cw_p=$?; echo \"__CW_PHASE name=q attempted=1 exit=$cw_p\"; cw_rc=$cw_p; else echo \"__CW_PHASE name=q attempted=0 exit=-\"; fi; echo \"__CW_PHASE end=1\"");
});

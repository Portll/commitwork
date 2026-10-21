// Builds the shell script text for the commit-msg hook (bin/lib/commit-msg-hook.mjs msgHookText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msgHookText } from '../lib/commit-msg-hook.mjs';

test('returns a shebang and marker comment for simple inputs', () => {
  const out = msgHookText({ node: '/usr/bin/node', script: '/opt/commitwork/bin/commit-msg-hook.mjs' });
  assert.equal(
    out,
    `#!/bin/sh
# commitwork commit-msg gate (installed by commitwork's bin/install-commit-msg.mjs; change or remove it there, not here).
# Refuses a Co-Authored-By trailer and a subject outside the commit rules on a bare \`git commit\`;
# bin/commit-phase.mjs applies the same rules on the commit-tree path, which runs no hooks.
node='/usr/bin/node'
[ -x "$node" ] || node="$(command -v node)"
script='/opt/commitwork/bin/commit-msg-hook.mjs'
if [ -z "$node" ] || [ ! -f "$script" ]; then
  echo "commit-msg: REFUSED. The gate cannot run: node or $script is missing. Nothing was committed." >&2
  echo "  Reinstall it: node <commitwork>/bin/install-commit-msg.mjs --write <this repository>" >&2
  exit 1
fi
exec "$node" "$script" "$1"
`
  );
});

test('escapes single quotes in the node path', () => {
  const out = msgHookText({ node: "/usr/bin/node's", script: '/opt/script.mjs' });
  assert.ok(out.includes("node='/usr/bin/node'\\''s'"));
});

test('escapes single quotes in the script path', () => {
  const out = msgHookText({ node: '/usr/bin/node', script: "/opt/commitwork's/script.mjs" });
  assert.ok(out.includes("script='/opt/commitwork'\\''s/script.mjs'"));
});

test('escapes multiple single quotes in the node path', () => {
  const out = msgHookText({ node: "a'b'c", script: '/s.mjs' });
  assert.ok(out.includes("node='a'\\''b'\\''c'"));
});

test('escapes multiple single quotes in the script path', () => {
  const out = msgHookText({ node: '/n', script: "x'y'z" });
  assert.ok(out.includes("script='x'\\''y'\\''z'"));
});

test('handles paths with no quotes', () => {
  const out = msgHookText({ node: '/usr/local/bin/node', script: '/home/user/commitwork/bin/commit-msg-hook.mjs' });
  assert.ok(out.includes("node='/usr/local/bin/node'"));
  assert.ok(out.includes("script='/home/user/commitwork/bin/commit-msg-hook.mjs'"));
});

test('includes the refusal message referencing the script variable', () => {
  const out = msgHookText({ node: '/n', script: '/s' });
  assert.ok(out.includes('echo "commit-msg: REFUSED. The gate cannot run: node or $script is missing. Nothing was committed." >&2'));
});

test('includes the reinstall hint with the install script path', () => {
  const out = msgHookText({ node: '/n', script: '/s' });
  assert.ok(out.includes('echo "  Reinstall it: node <commitwork>/bin/install-commit-msg.mjs --write <this repository>" >&2'));
});

test('ends with exec of node script and the first argument', () => {
  const out = msgHookText({ node: '/n', script: '/s' });
  assert.ok(out.endsWith('exec "$node" "$script" "$1"\n'));
});

test('converts non-string inputs to strings for quoting', () => {
  const out = msgHookText({ node: 123, script: 456 });
  assert.ok(out.includes("node='123'"));
  assert.ok(out.includes("script='456'"));
});

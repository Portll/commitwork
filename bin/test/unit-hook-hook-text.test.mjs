// Generates the shell script text for the commitwork pre-commit hook (bin/hook.mjs hookText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookText } from '../hook.mjs';

test('produces the full hook script with no chain', () => {
  const r = hookText({ node: '/usr/bin/node', script: '/opt/hook.mjs', args: ['--strict'], chain: false });
  assert.equal(r, "#!/bin/sh\n# commitwork pre-commit hook (written by `commitwork hook install`; change or remove it with that command, not here).\n# Checks the STAGED content, the index this commit is built from, before the commit lands.\nnode='/usr/bin/node'\n[ -x \"$node\" ] || node=\"$(command -v node)\"\nscript='/opt/hook.mjs'\nif [ -z \"$node\" ] || [ ! -f \"$script\" ]; then\n  echo \"commitwork pre-commit: REFUSED. The check cannot run: node or $script is missing. Nothing was committed.\" >&2\n  echo \"  Reinstall it with commitwork hook install, or remove it with commitwork hook uninstall.\" >&2\n  exit 1\nfi\n\"$node\" \"$script\" run '--strict' || exit $?\nexit 0\n");
});

test('produces the full hook script with a chain', () => {
  const r = hookText({ node: '/usr/bin/node', script: '/opt/hook.mjs', args: [], chain: true });
  assert.equal(r, "#!/bin/sh\n# commitwork pre-commit hook (written by `commitwork hook install`; change or remove it with that command, not here).\n# Checks the STAGED content, the index this commit is built from, before the commit lands.\nnode='/usr/bin/node'\n[ -x \"$node\" ] || node=\"$(command -v node)\"\nscript='/opt/hook.mjs'\nif [ -z \"$node\" ] || [ ! -f \"$script\" ]; then\n  echo \"commitwork pre-commit: REFUSED. The check cannot run: node or $script is missing. Nothing was committed.\" >&2\n  echo \"  Reinstall it with commitwork hook install, or remove it with commitwork hook uninstall.\" >&2\n  exit 1\nfi\n\"$node\" \"$script\" run  || exit $?\n# chained: the hook that was here before, kept at pre-commit.commitwork-chained; uninstall puts it back\nchained=\"$(dirname \"$0\")/pre-commit.commitwork-chained\"\nif [ ! -x \"$chained\" ]; then\n  echo \"commitwork pre-commit: REFUSED. The chained hook $chained is missing or not executable, so it did not run.\" >&2\n  exit 1\nfi\nexec \"$chained\" \"$@\"\n");
});

test('quotes single quotes in the node path', () => {
  const r = hookText({ node: "/bin/node's", script: '/opt/hook.mjs', args: [], chain: false });
  assert.equal(r, "#!/bin/sh\n# commitwork pre-commit hook (written by `commitwork hook install`; change or remove it with that command, not here).\n# Checks the STAGED content, the index this commit is built from, before the commit lands.\nnode='/bin/node'\\''s'\n[ -x \"$node\" ] || node=\"$(command -v node)\"\nscript='/opt/hook.mjs'\nif [ -z \"$node\" ] || [ ! -f \"$script\" ]; then\n  echo \"commitwork pre-commit: REFUSED. The check cannot run: node or $script is missing. Nothing was committed.\" >&2\n  echo \"  Reinstall it with commitwork hook install, or remove it with commitwork hook uninstall.\" >&2\n  exit 1\nfi\n\"$node\" \"$script\" run  || exit $?\nexit 0\n");
});

test('quotes single quotes in the script path', () => {
  const r = hookText({ node: '/usr/bin/node', script: "/opt/hook's.mjs", args: [], chain: false });
  assert.equal(r, "#!/bin/sh\n# commitwork pre-commit hook (written by `commitwork hook install`; change or remove it with that command, not here).\n# Checks the STAGED content, the index this commit is built from, before the commit lands.\nnode='/usr/bin/node'\n[ -x \"$node\" ] || node=\"$(command -v node)\"\nscript='/opt/hook'\\''s.mjs'\nif [ -z \"$node\" ] || [ ! -f \"$script\" ]; then\n  echo \"commitwork pre-commit: REFUSED. The check cannot run: node or $script is missing. Nothing was committed.\" >&2\n  echo \"  Reinstall it with commitwork hook install, or remove it with commitwork hook uninstall.\" >&2\n  exit 1\nfi\n\"$node\" \"$script\" run  || exit $?\nexit 0\n");
});

test('quotes single quotes in args', () => {
  const r = hookText({ node: '/usr/bin/node', script: '/opt/hook.mjs', args: ["it's"], chain: false });
  assert.equal(r, "#!/bin/sh\n# commitwork pre-commit hook (written by `commitwork hook install`; change or remove it with that command, not here).\n# Checks the STAGED content, the index this commit is built from, before the commit lands.\nnode='/usr/bin/node'\n[ -x \"$node\" ] || node=\"$(command -v node)\"\nscript='/opt/hook.mjs'\nif [ -z \"$node\" ] || [ ! -f \"$script\" ]; then\n  echo \"commitwork pre-commit: REFUSED. The check cannot run: node or $script is missing. Nothing was committed.\" >&2\n  echo \"  Reinstall it with commitwork hook install, or remove it with commitwork hook uninstall.\" >&2\n  exit 1\nfi\n\"$node\" \"$script\" run 'it'\\''s' || exit $?\nexit 0\n");
});

test('joins multiple args with spaces', () => {
  const r = hookText({ node: '/usr/bin/node', script: '/opt/hook.mjs', args: ['--a', '--b', '--c'], chain: false });
  assert.equal(r, "#!/bin/sh\n# commitwork pre-commit hook (written by `commitwork hook install`; change or remove it with that command, not here).\n# Checks the STAGED content, the index this commit is built from, before the commit lands.\nnode='/usr/bin/node'\n[ -x \"$node\" ] || node=\"$(command -v node)\"\nscript='/opt/hook.mjs'\nif [ -z \"$node\" ] || [ ! -f \"$script\" ]; then\n  echo \"commitwork pre-commit: REFUSED. The check cannot run: node or $script is missing. Nothing was committed.\" >&2\n  echo \"  Reinstall it with commitwork hook install, or remove it with commitwork hook uninstall.\" >&2\n  exit 1\nfi\n\"$node\" \"$script\" run '--a' '--b' '--c' || exit $?\nexit 0\n");
});

test('uses the exact refusal message for missing node or script', () => {
  const r = hookText({ node: '/usr/bin/node', script: '/opt/hook.mjs', args: [], chain: false });
  assert.equal(r, "#!/bin/sh\n# commitwork pre-commit hook (written by `commitwork hook install`; change or remove it with that command, not here).\n# Checks the STAGED content, the index this commit is built from, before the commit lands.\nnode='/usr/bin/node'\n[ -x \"$node\" ] || node=\"$(command -v node)\"\nscript='/opt/hook.mjs'\nif [ -z \"$node\" ] || [ ! -f \"$script\" ]; then\n  echo \"commitwork pre-commit: REFUSED. The check cannot run: node or $script is missing. Nothing was committed.\" >&2\n  echo \"  Reinstall it with commitwork hook install, or remove it with commitwork hook uninstall.\" >&2\n  exit 1\nfi\n\"$node\" \"$script\" run  || exit $?\nexit 0\n");
});

test('uses the exact chained refusal message', () => {
  const r = hookText({ node: '/usr/bin/node', script: '/opt/hook.mjs', args: [], chain: true });
  assert.equal(r, "#!/bin/sh\n# commitwork pre-commit hook (written by `commitwork hook install`; change or remove it with that command, not here).\n# Checks the STAGED content, the index this commit is built from, before the commit lands.\nnode='/usr/bin/node'\n[ -x \"$node\" ] || node=\"$(command -v node)\"\nscript='/opt/hook.mjs'\nif [ -z \"$node\" ] || [ ! -f \"$script\" ]; then\n  echo \"commitwork pre-commit: REFUSED. The check cannot run: node or $script is missing. Nothing was committed.\" >&2\n  echo \"  Reinstall it with commitwork hook install, or remove it with commitwork hook uninstall.\" >&2\n  exit 1\nfi\n\"$node\" \"$script\" run  || exit $?\n# chained: the hook that was here before, kept at pre-commit.commitwork-chained; uninstall puts it back\nchained=\"$(dirname \"$0\")/pre-commit.commitwork-chained\"\nif [ ! -x \"$chained\" ]; then\n  echo \"commitwork pre-commit: REFUSED. The chained hook $chained is missing or not executable, so it did not run.\" >&2\n  exit 1\nfi\nexec \"$chained\" \"$@\"\n");
});

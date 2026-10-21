// usage: msgHookText({ node, script }) -> the commit-msg hook bin/install-commit-msg.mjs and monitor/install-git-hook.mjs write
export const MSG_HOOK_MARKER = 'commitwork commit-msg gate';

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// fact: the hook fails closed: a gate that cannot run refuses the commit rather than passing it
export function msgHookText({ node, script }) {
  return `#!/bin/sh
# ${MSG_HOOK_MARKER} (installed by commitwork's bin/install-commit-msg.mjs; change or remove it there, not here).
# Refuses a Co-Authored-By trailer and a subject outside the commit rules on a bare \`git commit\`;
# bin/commit-phase.mjs applies the same rules on the commit-tree path, which runs no hooks.
node=${shq(node)}
[ -x "$node" ] || node="$(command -v node)"
script=${shq(script)}
if [ -z "$node" ] || [ ! -f "$script" ]; then
  echo "commit-msg: REFUSED. The gate cannot run: node or $script is missing. Nothing was committed." >&2
  echo "  Reinstall it: node <commitwork>/bin/install-commit-msg.mjs --write <this repository>" >&2
  exit 1
fi
exec "$node" "$script" "$1"
`;
}

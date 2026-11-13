// usage: msgHookText({ node, script, revision }) -> the commit-msg hook bin/install-commit-msg.mjs and monitor/install-git-hook.mjs write
export const MSG_HOOK_MARKER = 'commitwork commit-msg gate';

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// fact: the hook fails closed: a gate that cannot run refuses the commit rather than passing it
// fact: `revision` names the commit whose exported copy `script` is in (bin/lib/gate-pin.mjs); the
// remedy for a missing copy is --refresh, and for an unpinned gate it is a reinstall, so the
// refusal names the one that applies rather than the one the reader has to translate
export function msgHookText({ node, script, revision = null }) {
  const pinned = revision ? `# Pinned to commitwork ${revision}: the gate runs an exported copy of that commit, so an
# uncommitted edit in the checkout changes nothing until it is committed and re-exported.
` : '';
  const missing = revision
    ? `node or the pinned copy of commitwork ${revision} at $script is missing`
    : 'node or $script is missing';
  const remedy = revision
    ? '  echo "  Re-export it: node <commitwork>/bin/install-commit-msg.mjs --refresh --write" >&2'
    : '  echo "  Reinstall it: node <commitwork>/bin/install-commit-msg.mjs --write <this repository>" >&2';
  return `#!/bin/sh
# ${MSG_HOOK_MARKER} (installed by commitwork's bin/install-commit-msg.mjs; change or remove it there, not here).
# Refuses a Co-Authored-By trailer and a subject outside the commit rules on a bare \`git commit\`;
# bin/commit-phase.mjs applies the same rules on the commit-tree path, which runs no hooks.
${pinned}node=${shq(node)}
[ -x "$node" ] || node="$(command -v node)"
script=${shq(script)}
if [ -z "$node" ] || [ ! -f "$script" ]; then
  echo "commit-msg: REFUSED. The gate cannot run: ${missing}. Nothing was committed." >&2
${remedy}
  exit 1
fi
exec "$node" "$script" "$1"
`;
}

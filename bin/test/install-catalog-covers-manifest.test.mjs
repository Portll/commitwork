// bin/test/install-catalog-covers-manifest.test.mjs — the two files that describe "the tool set"
// must agree.
//
// THE DEFECT THIS EXISTS FOR, measured 2026-09-02. security-baseline.json declared 44 distinct
// tools across its checks' `requires.tools`. manifests/install-catalog.json — the list
// `commitwork setup` installs from — carried 24, and EIGHT of the manifest's tools were absent from
// it: bandit, brakeman, bundle-audit, cargo-audit, elixir, hlint, mix, phpcs.
//
// WHY IT SURVIVED SO LONG IS THE INTERESTING PART. A lane whose tool is missing skips with
// `n/a — tool:<name>`, which is indistinguishable at a glance from the language gate's
// `n/a — none of Gemfile.lock present`. Both read as "correctly not applicable here". So a lane
// could name a tool that no setup path would ever provide, skip on every repo forever, and look
// exactly like a lane doing its job. Four of the eight covered languages the fleet actually has
// (python, ruby x2, rust), so those lanes were dark on real repositories.
//
// The check is cheap and structural: it reads two JSON files. It does not probe the host, because
// "is it installed here" is a different question from "can it be installed at all" — that one is
// bin/test/joern-local-repairs.test.mjs's shape, and conflating them would make this test fail on
// any box that simply had not run setup yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJSON = (p) => JSON.parse(readFileSync(join(REPO, p), 'utf8'));

const manifest = readJSON('manifests/security-baseline.json');
const catalog = readJSON('manifests/install-catalog.json');

/** Every tool named by any check's requires.tools, with the checks that name it. */
function declaredTools() {
  const byTool = new Map();
  for (const c of manifest.checks || []) {
    for (const t of (c.requires || {}).tools || []) {
      if (!byTool.has(t)) byTool.set(t, []);
      byTool.get(t).push(c.id);
    }
  }
  return byTool;
}

// RUNTIMES, not scanner installs. The catalog's own note calls itself a "scanner install catalog",
// and these are the interpreters and toolchains a scanner runs ON. Listing them would make
// `commitwork setup` claim to install a JDK. They are EXEMPT BY DECLARATION rather than by the
// assertion being loosened: a name added here is a deliberate statement that this is a prerequisite
// the operator supplies, and anything not on the list must be catalogued.
//
// `cargo` is deliberately NOT here — clippy is a real scanner lane and the toolchain is how you get
// it, so it carries a catalog entry with a rustup url.
const RUNTIMES = new Set([
  'bash',       // POSIX shell; authz-test drives its harness through it
  'node',       // this project's own runtime — if it is missing, nothing here runs at all
  'npm', 'npx', // ship with node
  'java',       // JDK; CodeQL's Java extractor and pmd run on it
  'deno',       // separate runtime, supplied per-repo rather than fleet-wide
  'xcodebuild', // ships with Xcode; macOS-only and not installable by a package manager
]);

test('every tool a check REQUIRES is in the install catalog', () => {
  const byTool = declaredTools();
  assert.ok(byTool.size > 0, 'no requires.tools found at all — the parse is wrong, not the data');
  const known = new Set(Object.keys(catalog.tools || {}));
  const missing = [...byTool.keys()].filter((t) => !known.has(t) && !RUNTIMES.has(t)).sort();
  assert.deepEqual(missing, [],
    `${missing.length} tool(s) are required by a lane and absent from install-catalog.json, so `
    + '`commitwork setup` cannot install them and those lanes stay a blocked void naming `tool:x` '
    + 'on every repo they match, with no install that clears it:\n'
    + missing.map((t) => `  ${t}  (required by ${byTool.get(t).join(', ')})`).join('\n'));
});

test('every catalog entry says HOW to get it, or declares that it cannot be installed', () => {
  const MANAGERS = ['brew', 'winget', 'scoop', 'pipx', 'cargo', 'npm', 'gem'];
  const unreachable = [];
  for (const [name, e] of Object.entries(catalog.tools || {})) {
    if (e.manual === true) continue;              // checked and reported, never auto-installed
    if (e.providedBy) continue;                   // ships with another catalogued tool (mix <- elixir)
    if (MANAGERS.some((m) => e[m])) continue;
    if (e.url) continue;                          // no manager, but a human has somewhere to go
    unreachable.push(name);
  }
  assert.deepEqual(unreachable, [],
    'catalog entries with no manager, no url, no providedBy and not marked manual — nothing tells '
    + `anyone how to obtain these: ${unreachable.join(', ')}`);
});

test('a providedBy entry names a tool the catalog actually carries', () => {
  // `mix` ships with elixir. If elixir ever leaves the catalog, mix becomes unobtainable while
  // still looking accounted for — the same silent-gap shape one level down.
  for (const [name, e] of Object.entries(catalog.tools || {})) {
    if (!e.providedBy) continue;
    assert.ok(catalog.tools[e.providedBy],
      `${name} says it is provided by ${e.providedBy}, which is not in the catalog`);
  }
});

test('the catalog does not carry tools no lane requires — a dead entry is a claim nobody checks', () => {
  // Not an error, but it must be DECLARED. Several catalog tools are used by scripts rather than by
  // a check's requires.tools (docker, go, act), so this asserts the exception list stays explicit
  // rather than letting the set drift silently.
  const required = new Set(declaredTools().keys());
  // A PREREQUISITE OF A LANE TOOL is a third category, and it needs saying rather than exempting.
  // `phpcs` is PHP_CodeSniffer, a style linter that ships no security rules; the lane's rules come
  // from phpcs-security-audit, a THIRD-PARTY composer package, which in turn needs composer. Neither
  // appears in any requires.tools — a lane names the binary it invokes, not the chain that put the
  // rules on disk — and both must still be installable or the lane refuses forever with exit 127.
  // `requiredBy` states the edge, and the assertion below walks it, so a prerequisite whose target
  // leaves the catalog stops being accounted for instead of quietly persisting.
  const prerequisiteOf = (name) => {
    const e = (catalog.tools || {})[name];
    return e && typeof e.requiredBy === 'string' ? e.requiredBy : null;
  };
  const NON_LANE = new Set([
    'docker',       // the sandbox several lanes run INSIDE, never a lane's own tool
    'go', 'act',    // toolchain / workflow runner used by scripts
    'codeql', 'syft', 'testssl.sh', 'schemathesis', 'socket', 'safe-chain',
    // These two run through docker images rather than a host binary, so no check names them in
    // requires.tools — but the operator still has to be able to get them.
    'guarddog', 'osv-scanner',
    // Not a scanner and not a binary: the spine's four hand-set pieces (MCP registration, two
    // hooks, launchd plist), catalogued so the Overwatch tab's precondition chips have a remedy to
    // name. Its `steps` are keyed by admin/lib/spine-preconditions.mjs check ids and
    // admin/test/spine-preconditions.test.mjs holds the two in agreement.
    'overwatch-layer-spine',
    // An OPTIONAL second witness: model-artefacts runs its own zero-dependency opcode walker and
    // records modelscan's verdict beside it when present. Naming it in requires.tools would gate a
    // lane that needs nothing, so it is catalogued here instead.
    'modelscan',
    // Package managers the language-manager entries install through: pipx for nine scanners, gem
    // (with Ruby) for brakeman and bundler-audit. A lane names the scanner, never its installer.
    'pipx', 'gem',
    // The Linux host sandbox every lane runs inside, as docker is for the containerised ones, and
    // the user-mode network its open lanes run behind.
    'bwrap', 'pasta',
  ]);
  // `providedBy` is equally an accounting: mix ships with elixir, cargo-clippy with cargo. Those
  // entries exist to say "do not try to install this separately", and the entry they name carries
  // the obligation — the chain test below walks it either way.
  const orphans = Object.keys(catalog.tools || {})
    .filter((t) => !required.has(t) && !NON_LANE.has(t) && !prerequisiteOf(t)
      && !(catalog.tools[t] || {}).providedBy).sort();
  assert.deepEqual(orphans, [],
    `catalog entries no lane requires and not on the declared non-lane list: ${orphans.join(', ')}. `
    + 'Either a lane should require them, they belong on NON_LANE with a reason, or they are a '
    + 'prerequisite of another catalogued tool and should declare requiredBy.');
});

test('a requiredBy chain terminates in a tool some lane actually requires', () => {
  // Otherwise a prerequisite can point at a prerequisite forever and nothing at the end of it is a
  // lane's tool — the entry stays "accounted for" while supporting nothing that runs.
  const required = new Set(declaredTools().keys());
  const tools = catalog.tools || {};
  for (const [name, e] of Object.entries(tools)) {
    if (!e.requiredBy) continue;
    const seen = [name];
    let cur = e.requiredBy;
    while (cur && !required.has(cur) && !seen.includes(cur)) {
      assert.ok(tools[cur], `${name} declares requiredBy: ${cur}, which is not in the catalog`);
      seen.push(cur);
      cur = tools[cur].requiredBy;
    }
    assert.ok(cur && required.has(cur),
      `${name}'s requiredBy chain (${seen.join(' -> ')}${cur ? ` -> ${cur}` : ''}) never reaches a tool any lane requires`);
  }
});

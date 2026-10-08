// fact: a config pointing at a REMOVED host is the failure removal actually causes / ollama came out of the declaration on 2026-08-27 and overwatch-layer/.mcp.json went on naming :11434 for a day — the host list was updated and the things that dial it were not (expiry: never, prev: not built)
//
// The declaration says which hosts exist. Nothing said the fleet's own configs had to agree with
// it, so `overwatch-layer/.mcp.json` kept launching internal-d-mcp against ollama's port after ollama was
// removed — a config that reads as deliberate, points at nothing, and fails only when someone tries
// to use it.
//
// This checks the OTHER repos, so it has the same absent-sibling problem as the memory-layer drift test and
// the same answer: a repo that is not checked out is reported SKIPPED with the path it looked for,
// never passed. "Found no violations" and "could not look" are different results.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadLlmHosts } from '../../monitor/llm-hosts.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLEET = resolve(REPO, '..');

// Repos that dial a local LLM. Overridable so a differently-laid-out checkout can still run this.
const siblings = () => {
  if (process.env.CW_FLEET_REPOS) {
    return process.env.CW_FLEET_REPOS.split(',').map((n) => n.trim()).filter(Boolean);
  }
  // Discover consumers by the configuration surface they carry. Hardcoding private checkout names
  // disclosed them in the public test and went stale on rename; scanning every sibling made this
  // small guard walk the whole fleet. A local-LLM consumer carries either the shared declaration
  // or an MCP launch config, which is the bounded population this check is about.
  return readdirSync(FLEET, { withFileTypes: true })
    .filter((e) => e.isDirectory() && resolve(FLEET, e.name) !== resolve(REPO))
    .filter((e) => {
      if (!isCheckoutOfSelf(join(FLEET, e.name))) return true;
      skippedSelfWorktrees.push(e.name);   // announced by the test, never silently dropped
      return false;
    })
    .filter((e) => {
      const owner = linkedWorktreeOwner(join(FLEET, e.name));
      if (!owner) return true;
      skippedForeignWorktrees.push(`${e.name} (of ${basename(owner)})`);   // announced below
      return false;
    })
    .map((e) => e.name)
    .filter((name) => existsSync(join(FLEET, name, '.mcp.json'))
      || existsSync(join(FLEET, name, 'manifests', 'llm-hosts.json')))
    .filter(declaresSharedHosts);
};

// A sibling that is a linked worktree of THIS repo is this repo under another name, and excluding
// commitwork by name alone did not cover it: on 2026-09-06 a `git worktree add ../commitwork-comments`
// put a full copy of monitor/detection-reducer.mjs beside the checkout, and this guard reported
// commitwork's own ollama dial as a fleet violation while the checkout itself stays exempt. Identity
// is the `.git` FILE's gitdir resolving under our own `.git`, never the directory name — the
// session-start hook recommends exactly such siblings (`commitwork-<date>`), so the names vary.
const skippedSelfWorktrees = [];
// fact: git's common dir is the repository's identity; every checkout of it, main or linked, under any directory name, shares one
const commonDir = (dir) => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
};
/**
 * A COPY of this repository that shares no git history with it — a `git archive` export, a snapshot,
 * a tarball. Git identity cannot see these: the export has no `.git` at all, or a fresh one with its
 * own root commit, so `commonDir` returns null or a different path and the copy reads as a fleet
 * member. It then reports commitwork's own `ollama` dial as somebody else's violation.
 *
 * Measured 2026-10-04 while running the suite from a clean export of HEAD: two sibling export trees
 * were enlisted and the guard failed naming `<dir>/monitor/detection-reducer.mjs:31`. That is a
 * false FINDING, and the publication harness makes it reachable rather than hypothetical —
 * `lib/launchlist-checks.mjs` exports HEAD into `os.tmpdir()`, where FLEET is the whole temp
 * directory and any concurrent export of this repo is a sibling.
 *
 * Keyed on the manifest's own declared name, which is what a copy of this repository carries and no
 * fleet consumer does — not on the directory name, which varies by design.
 */
const isUntrackedCopyOfSelf = (dir) => {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'commitwork'; }
  catch { return false; }
};
const isCheckoutOfSelf = (dir) => {
  if (isLinkedWorktreeOfSelf(dir)) return true;
  if (isUntrackedCopyOfSelf(dir)) return true;
  const own = commonDir(REPO);
  return own !== null && commonDir(dir) === own;
};

export function isLinkedWorktreeOfSelf(dir, self = REPO) {
  const dotGit = join(dir, '.git');
  let st;
  try { st = statSync(dotGit); } catch { return false; }
  if (!st.isFile()) return false;
  let text;
  try { text = readFileSync(dotGit, 'utf8'); } catch { return false; }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!m) return false;
  const gitdir = resolve(dir, m[1]);
  const own = resolve(self, '.git');
  return gitdir === own || gitdir.startsWith(own + sep);
}

// A sibling that is a linked worktree of ANOTHER repo is that repo on another branch, not a fleet
// consumer of its own. Its config is the branch's, the checkout it belongs to is the one the fleet
// declares, and `git worktree remove` makes it vanish without a commit. Identity is the gitdir
// resolving under some checkout's `.git/worktrees/`; the owner is announced so the skip is visible.
const skippedForeignWorktrees = [];
export function linkedWorktreeOwner(dir) {
  const dotGit = join(dir, '.git');
  let st;
  try { st = statSync(dotGit); } catch { return null; }
  if (!st.isFile()) return null;
  let text;
  try { text = readFileSync(dotGit, 'utf8'); } catch { return null; }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!m) return null;
  const owner = /^(.*)\/\.git\/worktrees\/[^/]+\/?$/.exec(resolve(dir, m[1]));
  return owner ? owner[1] : null;
}

test('a linked worktree of THIS repo is recognised by gitdir, and only that — both directions', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'cw-llm-hosts-'));
  try {
    const self = join(tmp, 'self');
    mkdirSync(join(self, '.git'), { recursive: true });
    const ours = join(tmp, 'self-comments');
    mkdirSync(ours);
    writeFileSync(join(ours, '.git'), `gitdir: ${join(self, '.git', 'worktrees', 'self-comments')}\n`);
    assert.equal(isLinkedWorktreeOfSelf(ours, self), true, 'gitdir under our own .git is us');

    const theirs = join(tmp, 'other-wt');
    mkdirSync(theirs);
    writeFileSync(join(theirs, '.git'), `gitdir: ${join(tmp, 'elsewhere', '.git', 'worktrees', 'x')}\n`);
    assert.equal(isLinkedWorktreeOfSelf(theirs, self), false, 'a worktree of another repo is a real sibling');

    const plain = join(tmp, 'plain-repo');
    mkdirSync(join(plain, '.git'), { recursive: true });
    assert.equal(isLinkedWorktreeOfSelf(plain, self), false, 'a .git DIRECTORY is a repo of its own');

    const none = join(tmp, 'not-a-repo');
    mkdirSync(none);
    assert.equal(isLinkedWorktreeOfSelf(none, self), false, 'no .git at all is not us either');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Config and source that carries a runtime endpoint. Docs are deliberately excluded: prose naming a
// retired host is untidy, and this test is for things that DIAL one.
// `.ts` was missing until 2026-09-01 and the omission was self-concealing. One consumer is
// TypeScript compiled to a tracked esbuild bundle, so this guard read `server/index.js:15492` — the
// BUNDLE — and could not see `src/OpenAICompatClient.ts:36`, the line that produces it. The obvious
// remedy for a bundle hit is to skip build artifacts, and doing that WITHOUT this extension would
// have turned a true finding into a green: the artifact was the only form of the dial the guard
// could read. The blind spot and the thing it hid were one mechanism, again.
const INTERESTING = /\.(mjs|js|ts|mts|cts|tsx|json|rs|toml)$/;
const SKIP_DIRS = new Set([
  'node_modules', 'target', '.git', 'dist', 'build', 'planning', 'evaluations',
  'docs', 'imported-from-integrate-this', 'reports', '.claude',
  // Compiled output. A stale artifact would fail this forever after its source was fixed, and the
  // thing to repoint is the source — `out/` is untracked here, so git-based checks never saw it
  // and only this filesystem walk did.
  'out',
]);

// The declaration RECORDS which hosts were removed, so its prose names retired ports on purpose.
// It is the one file that may mention one without dialing it — the same self-reference that made
// entity_cap.rs match its own marker over in memory-layer.
const SELF_REFERENCE = /manifests\/llm-hosts\.json$/;

/**
 * Is this line a DIAL, or merely a mention?
 *
 * The header above says docs are excluded because this check is for things that dial a retired
 * host — but exclusion was by DIRECTORY, so a `///` doc comment or an `assert!` inside a .rs file
 * was reported as a config pointing at ollama. Measured 2026-09-01: of 7 reported violations, 4
 * were not dials — two doc comments giving 11434 as the EXAMPLE of an endpoint, and two test
 * assertions using it as a URL literal, each duplicated across shodh-memory and shodh-memory-1.
 *
 * Over-reporting is not the safe direction. A guard that fails a repo for documenting the host it
 * migrated away FROM teaches its readers to skim it, and a skimmed guard is a disabled one. So the
 * distinction is a classification with its own field rather than a filter: a mention is reported as
 * a diagnostic and never fails, which keeps it visible without letting it assert something false.
 */
export const IS_TEST_FILE = /(^|[./\\_-])(test|tests|spec|__tests__)[./\\_-]|\.(test|spec)\.[a-z]+$/i;

export function classifyReference(line, file = '') {
  // FILE-level first, because a line-level rule cannot see an enclosing call. Both remaining false
  // positives on 2026-09-01 were continuation lines of a multi-line `expect(...)` —
  // `'Ollama server is not running at http://127.0.0.1:11434 (connection refused)'` on its own line
  // matches no assertion keyword and reads exactly like a config value. The file it sits in is the
  // evidence the line cannot carry.
  if (file && IS_TEST_FILE.test(file)) return 'a test file';
  // A sitemap index is DERIVED from another repo's source. Each URL it lists carries a `source` on a
  // neighbouring line, and the dial is judged there; the index itself configures nothing. Found when
  // substrate's sitemap index for an internal project listed a URL from lanDiscovery.test.ts.
  if (file && /\.sitemap\.json$/.test(file)) return 'a generated sitemap index';
  const t = line.trim();
  // Comment markers for every language INTERESTING admits: js/mjs (//, /*, *), rust (//, ///, //!),
  // toml (#). JSON has no comments, so a JSON hit is always a dial.
  if (/^(\/\/|\/\*|\*|#)/.test(t)) return 'a comment';
  // A URL inside an assertion is test DATA. The give-away is that it is an argument to an assert,
  // not a value assigned to a key or a field.
  if (/\bassert(_eq|_ne)?!|\bexpect\(|#\[test\]/.test(t)) return 'a test assertion';
  return 'dial';
}

function walk(dir, out, depth = 0) {
  if (depth > 6) return;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out, depth + 1);
    else if (INTERESTING.test(name)) out.push(p);
  }
}

// An MCP config alone does not make this declaration authoritative: several independent tools
// deliberately support Ollama. Bind the check only to repos that carry the declaration or name it
// as their source of truth. That keeps a removed commitwork host from outlawing an unrelated
// product feature while still finding the three consumers this guard was written for.
function declaresSharedHosts(name) {
  const root = resolve(FLEET, name);
  if (existsSync(join(root, 'manifests', 'llm-hosts.json'))) return true;
  const files = [];
  walk(root, files);
  return files.some((file) => {
    try { return readFileSync(file, 'utf8').includes('llm-hosts.json'); } catch { return false; }
  });
}

/** Ports a removed host used to answer on, taken from the declaration's own record. */
function removedPorts(decl) {
  // `removed` names the host but not its port — the port left with it. These are the literals the
  // fleet actually had written down, kept here because the declaration deliberately does not carry
  // configuration for hosts it no longer supports.
  const KNOWN = { ollama: ['11434'] };
  const out = new Map();
  for (const r of decl.removed || []) {
    if (KNOWN[r.id]) out.set(r.id, KNOWN[r.id]);
  }
  return out;
}

test('classifyReference separates a dial from a mention — asserted in BOTH directions', () => {
  // Both halves, because only one of them lies to you. A classifier that called everything a
  // mention would make the guard below pass forever while reading the same files, and its output
  // would be indistinguishable from a fleet that had migrated. The real lines are the ones this
  // guard actually reported on 2026-09-01.
  const mentions = [
    '/// * `endpoint` - Base URL (e.g., "http://localhost:11434" for Ollama)',
    'assert!(!is_insecure_remote_url("http://localhost:11434"));',
    '// ollama used to answer on http://127.0.0.1:11434',
    '# default = "http://127.0.0.1:11434"',
  ];
  for (const line of mentions) {
    assert.notEqual(classifyReference(line), 'dial', `should not be a dial: ${line}`);
  }

  const dials = [
    '    "LOCAL_LLM_URL": "http://localhost:11434/v1",',
    '      "default": "http://127.0.0.1:11434"',
    '  ollama: "http://127.0.0.1:11434"',
    'const OLLAMA_URL = process.env.X || "http://127.0.0.1:11434";',
    '  baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",',
  ];
  for (const line of dials) {
    assert.equal(classifyReference(line), 'dial', `should be a dial: ${line}`);
  }

  // A bare string on its own line inside a multi-line expect() is indistinguishable from a config
  // value BY THE LINE. Only the path says otherwise, so the path has to be consulted.
  const inTest = "      'Ollama server is not running at http://127.0.0.1:11434 (connection refused)'";
  assert.equal(classifyReference(inTest), 'dial',
    'the line alone genuinely looks like a dial — this is why the file argument exists');
  assert.equal(classifyReference(inTest, '/x/src/OpenAICompatClient.test.ts'), 'a test file');

  // And the file rule must not swallow production source, which is the direction that would
  // silently disarm this guard.
  assert.equal(classifyReference(inTest, '/x/src/OpenAICompatClient.ts'), 'dial');
  // A derived sitemap index is not config, but a hand-written JSON config beside it still is.
  const sitemapLine = '   "url": "http://192.168.1.60:11434",';
  assert.equal(classifyReference(sitemapLine, '/x/server/data/app.sitemap.json'), 'a generated sitemap index');
  assert.equal(classifyReference(sitemapLine, '/x/server/data/app.config.json'), 'dial');
  assert.equal(classifyReference('  ollama: "http://127.0.0.1:11434"', '/x/src/config.ts'), 'dial');
});

test('the declaration still records at least one removed host — or this test asserts nothing', () => {
  const decl = loadLlmHosts();
  assert.ok((decl.removed || []).length >= 1,
    'nothing has been removed, so there is no retired port to look for and this guard is vacuous');
  assert.ok(removedPorts(decl).size >= 1,
    'a removed host has no known port recorded here, so its config references cannot be detected');
});

test('no fleet repo dials a REMOVED host, and an absent repo is reported rather than passed', (t) => {
  const decl = loadLlmHosts();
  const retired = removedPorts(decl);

  const missing = [];
  const checked = [];
  const violations = [];
  const mentions = [];

  for (const repo of siblings()) {
    const root = resolve(FLEET, repo);
    if (!existsSync(root)) { missing.push(root); continue; }
    checked.push(repo);

    const files = [];
    walk(root, files);
    for (const file of files) {
      if (SELF_REFERENCE.test(file)) continue;
      let text;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      for (const [host, ports] of retired) {
        for (const port of ports) {
          if (!text.includes(`:${port}`)) continue;
          for (const [n, line] of text.split('\n').entries()) {
            if (!line.includes(`:${port}`)) continue;
            const where = `${repo}/${file.slice(root.length + 1)}:${n + 1}`;
            const kind = classifyReference(line, file);
            if (kind === 'dial') {
              violations.push(`${where} still dials ${host} — ${line.trim().slice(0, 110)}`);
            } else {
              mentions.push(`${where} MENTIONS ${host} in ${kind} — ${line.trim().slice(0, 110)}`);
            }
          }
        }
      }
    }
  }

  if (skippedSelfWorktrees.length) {
    // A copy of this repo is not a fleet consumer, but what it showed is still true of THIS repo,
    // which siblings() exempts by name: the skip is announced so the exemption stays visible.
    t.diagnostic(`SKIPPED checkout(s) of this repo, not fleet members: ${skippedSelfWorktrees.join(', ')} — anything they dial, commitwork dials too, and commitwork is exempt from this guard by name`);
  }
  if (skippedForeignWorktrees.length) {
    // A branch checkout of a declared repo is not a second consumer; what it dials is judged where
    // the repo itself is checked. Announced, never silently dropped.
    t.diagnostic(`SKIPPED linked worktree(s) of other repos, not fleet members: ${skippedForeignWorktrees.join(', ')}`);
  }
  if (missing.length) {
    // Announced, not swallowed. A guard that quietly passes when it cannot see its subject is the
    // same false clean as no guard.
    t.diagnostic(`NOT CHECKED (repo absent): ${missing.join(', ')} — set CW_FLEET_REPOS to point at them`);
  }
  if (mentions.length) {
    // Reported, never asserted on. A doc comment or a test literal naming a retired port is not a
    // config pointing at one, and failing on it would make this guard cry wolf about the very
    // repos that migrated correctly.
    t.diagnostic(`MENTIONS (not dials, no action required): ${mentions.length}\n  ${mentions.join('\n  ')}`);
  }
  // fact: discovery finding no fleet at all is a checkout without one (a public clone, CI); named repos that are absent still fail
  if (!process.env.CW_FLEET_REPOS && !checked.length && !missing.length) {
    t.skip(`no local-LLM consumer beside commitwork in ${FLEET} — this checkout has no fleet for the guard to read`);
    return;
  }
  assert.ok(checked.length >= 1,
    `no fleet repo was found beside commitwork (looked in ${FLEET}) — this checked NOTHING`);

  assert.deepEqual(violations, [],
    `a config still points at a host the declaration removed:\n  ${violations.join('\n  ')}\n` +
    'Removing a host from manifests/llm-hosts.json does not repoint the things that dial it.');
});

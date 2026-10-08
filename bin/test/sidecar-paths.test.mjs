// The sidecar contract. The stores that must survive but must not ship live in a private git repo
// next door — CW_SIDECAR, defaulting to `commitwork-sidecar` beside the checkout — and are reached
// from this tree by DIRECTORY symlink. Four ways that degrades silently, each caught here:
//
//   1. A directory symlink is replaced by a real directory (a `mkdir -p` in a script, a restored
//      backup). Writes keep succeeding, into a tree with no history — the original defect, back.
//   2. Someone "tidies" a FILE symlink into place instead. rename() onto a file symlink replaces
//      the link and orphans the target, so appends keep succeeding into a file nobody reads. This
//      repo writes atomically by house rule, so a file symlink is a false-clean generator.
//   3. A .gitignore pattern regrows its trailing slash. A trailing slash matches DIRECTORIES only,
//      and git classifies a symlink as a file — so `/evaluations/` stops matching the instant the
//      path becomes a link, and 306 files of client-naming audit output reappear as untracked, one
//      `git add -A` from being committed.
//   4. A file that is still TRACKED under one of these paths gets restored by a checkout or a merge
//      and lands on top of the symlink. Observed the same day: every write after
//      that point went to the restored file and the sidecar copy silently stopped changing. This is
//      why bin/test/inert-ignore-rules.test.mjs is a separate guard — a path can only be safely
//      symlinked once nothing under it is in the index, and that is a different question.
//
// Second witness, per the house rule that a guard needs one that cannot share its failure mode:
// the symlink check and the INODE check are independent. lstat says "this is a link"; comparing
// st_ino through the repo path against st_ino in the sidecar says "and it is the same file". A
// dangling link that happens to be re-created, or a link pointing at a stale copy, passes the
// first and fails the second.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, statSync, existsSync, readFileSync, readlinkSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIDECAR = process.env.CW_SIDECAR || resolve(REPO, '..', 'commitwork-sidecar');

/** The contract, declared once. repoPath is relative to REPO; sidecarPath relative to SIDECAR. */
const SIDECAR_PATHS = Object.freeze([
  { repoPath: '.claude/verdicts', sidecarPath: 'verdicts', witness: 'docs-doctor.jsonl' },
  { repoPath: '.claude/store', sidecarPath: 'store', witness: 'gate-baseline.json' },
  { repoPath: 'evaluations', sidecarPath: 'evaluations', witness: 'DECISIONS.md' },
  // The four whose ignore rules had been inert since they were written (2026-08-27). The stores
  // reached by monitor/private are load-bearing: issues.json is hash-chained lifecycle and
  // projects.json is the hand-maintained registry, so both must survive AND must not ship.
  { repoPath: 'monitor/private', sidecarPath: 'monitor', witness: 'issues.json' },
  { repoPath: 'monitor/private', sidecarPath: 'monitor', witness: 'projects.json' },
  { repoPath: 'map/data/client-a', sidecarPath: 'map-data/client-a', witness: 'migration-state.json' },
  { repoPath: 'map/data/internal-b-dev', sidecarPath: 'map-data/internal-b-dev', witness: 'migration-state.json' },
]);

/** Ignore patterns that must never regrow a trailing slash, because they now name symlinks. */
const SLASHLESS = Object.freeze([
  '/evaluations', '/monitor/private', '/map/data/client-a', '/map/data/internal-b-dev',
]);

/** stat/lstat, or null when the path is absent. Only ENOENT is absence; anything else throws. */
const ifPresent = (statFn, p) => {
  try { return statFn(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};

const configured = ifPresent(statSync, SIDECAR) !== null;

// WHICH CHECKOUT THE CONTRACT BINDS. `configured` is a fact about the directory next door, not
// about this checkout: a `git worktree add` or a second clone beside the operator's checkout
// resolves the same sidecar directory without ever having been linked to it. The links are
// untracked and ignored, so no clone, checkout or worktree creates one. A checkout holding none has
// never adopted the sidecar, and the link and inode checks skip, saying so. A checkout holding even
// one has adopted it, and from then on every declared path must be a link — a partial set is the
// 2026-08-28 degradation. Holding none is also what losing every link at once looks like (a
// re-clone in place), so an unadopted checkout whose stores hold content still FAILS, below.
const adopted = configured
  && SIDECAR_PATHS.some(({ repoPath }) => ifPresent(lstatSync, join(REPO, repoPath))?.isSymbolicLink());
const UNADOPTED = configured
  ? `this checkout holds no link to the sidecar at ${SIDECAR} (the links are untracked, so a clone or \`git worktree add\` never has one)`
  : `no sidecar at ${SIDECAR}`;

describe('sidecar paths — the stores that were moved out to get a history', () => {
  test('the declared set is non-empty and every entry is complete — no vacuous pass', () => {
    // Without this, deleting the array above turns every assertion below into a green no-op.
    assert.ok(SIDECAR_PATHS.length >= 7, 'the sidecar contract lost entries — was a store moved back?');
    for (const p of SIDECAR_PATHS) {
      assert.ok(p.repoPath && p.sidecarPath && p.witness, `incomplete declaration: ${JSON.stringify(p)}`);
    }
  });

  test('no declared path is a FILE symlink — rename() would orphan the target while writes succeed', (t) => {
    // Checkable anywhere, sidecar or not: it is a statement about this tree's shape, and it is the
    // failure mode that stays silent longest, because nothing errors.
    let checked = 0;
    for (const { repoPath } of SIDECAR_PATHS) {
      const full = join(REPO, repoPath);
      if (!existsSync(full)) continue;
      const st = lstatSync(full);
      if (!st.isSymbolicLink()) continue;
      checked += 1;
      assert.ok(
        statSync(full).isDirectory(),
        `${repoPath} is a symlink to a FILE. An atomic tmp+rename onto it replaces the link and ` +
        `orphans the sidecar copy — appends keep succeeding into a file nobody reads. Symlink the ` +
        `containing DIRECTORY instead, so the rename happens inside the resolved directory.`,
      );
    }
    // THE BACKSTOP USED TO BE `checked > 0`, WHICH ONE SURVIVING LINK SATISFIED. Three paths are
    // declared, so .claude/verdicts could degrade to a real directory while evaluations and
    // .claude/store stayed linked: checked === 2, test green, over exactly the degradation this
    // file exists to catch. That happened on 2026-08-28 and was found by measuring, not by this
    // guard — and the shadowed .claude/verdicts had meanwhile hidden gate-ratchet.jsonl from
    // bin/test/adjudication-sampler.test.mjs, which surfaced an unclassified verdict the instant
    // the link was restored. Count what is PRESENT and require all of it: the tolerance that lets
    // a check run in varied environments is the tolerance that hides the defect.
    const present = SIDECAR_PATHS.filter(({ repoPath }) => existsSync(join(REPO, repoPath)));
    if (!adopted) {
      if (checked === 0) t.skip(`no declared path is a symlink, so there is nothing to check: ${UNADOPTED}`);
      return;
    }
    assert.equal(checked, present.length,
      `${present.length - checked} declared sidecar path(s) exist but are NOT symlinks — a store `
      + `was moved back and its writes are no longer versioned. Declared and present: `
      + `${present.map((p) => p.repoPath).join(', ')}`);
  });

  // THE SECOND HALF OF THE SAME DEFECT, and the half that actually hid the 2026-08-28 incident.
  // The inode-identity block below — the ONLY one that asserts isSymbolicLink() per declared path
  // — is gated on `adopted`, which needs SIDECAR to resolve. Nothing existed at CW_SIDECAR's
  // default (the sidecar beside the checkout) until a convenience symlink was created there on
  // 2026-08-28, so that block had been self-skipping wholesale. Both halves were blind at once: one
  // skipping per path, the other skipping entirely, which is why three degraded stores went unseen.
  // It passes today only because that convenience symlink exists; delete it and the strong block
  // goes dormant again, in silence.
  //
  // So an unresolved sidecar must not be a bare skip. It has two causes and only one is benign: a
  // fresh clone or CI box that never held the stores (declared paths absent or empty), versus a
  // tree where the stores sit right there as real directories full of data that nothing versions.
  // The second IS the degradation. A sidecar that resolves while this checkout holds no link to it
  // splits the same way, so this runs for any unadopted checkout. Once a checkout holds a link, the
  // assertion above requires every present path to be one, so the branches together leave no gap.
  test('an unresolved sidecar with the stores present as real directories is the degradation, not an absence',
    { skip: adopted ? 'this checkout is linked: the present-paths assertion above and the inode block below cover it' : false }, () => {
      const populated = SIDECAR_PATHS
        .map(({ repoPath }) => ({ repoPath, full: join(REPO, repoPath) }))
        .filter(({ full }) => {
          const st = ifPresent(lstatSync, full);
          return st && !st.isSymbolicLink() && st.isDirectory() && readdirSync(full).length > 0;
        });
      assert.deepEqual(populated.map((p) => p.repoPath), [],
        `${UNADOPTED}, yet these declared stores exist as real directories holding content — they `
        + `are being written and nothing is versioning them, which is the state the sidecar `
        + `migration exists to prevent. Set CW_SIDECAR, or restore the symlinks. If a test run wrote `
        + `them, the producer's CW_* override is missing from AMBIENT_OUTPUTS in bin/test-run.mjs.`);
    });

  test('an ignore pattern naming a symlink carries no trailing slash', () => {
    const ignore = readFileSync(join(REPO, '.gitignore'), 'utf8');
    for (const pat of SLASHLESS) {
      const lines = ignore.split('\n').map((l) => l.trim());
      assert.ok(
        !lines.includes(`${pat}/`),
        `.gitignore has '${pat}/'. A trailing slash matches directories only and git classifies a ` +
        `symlink as a file, so this pattern stops matching and the store reappears as untracked.`,
      );
      assert.ok(lines.includes(pat), `.gitignore lost the '${pat}' rule entirely`);
    }
  });

  test('git still ignores every declared path — the effect, not just the pattern text', () => {
    // Asserting the pattern's spelling is asserting a marker. This asserts what git actually does,
    // which is the only thing that decides whether the store can be committed by accident.
    for (const { repoPath } of SIDECAR_PATHS) {
      if (!existsSync(join(REPO, repoPath))) continue;
      const out = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--', repoPath], { encoding: 'utf8' });
      assert.equal(
        out.trim(), '',
        `git reports '${repoPath}' as changed/untracked:\n${out}\nA sidecar store must stay ignored here.`,
      );
    }
  });
  // fact: a file committed UNDER a declared path is restored as a real file on the next checkout and rebuilds a real directory over the symlink / that is failure mode 1 arriving from a direction mode 1 cannot see, because nothing replaced the link on purpose, and every write after it is orphaned (expiry: never, prev: not built)
  // fact: evaluations/bifocal-releases-atom-2026-08-27.json passed node --check, the test globs, tracked-imports, comment-schema and docs-doctor before a commit cleaned it up a day later / none of those watch this axis, and this assertion would have failed at the moment of that commit (expiry: never, prev: missing)
  test('no file under a declared path is TRACKED — a tracked file rebuilds the directory over the link', () => {
    let checkedPaths = 0;
    for (const { repoPath } of SIDECAR_PATHS) {
      // Fail closed: git failing here must not read as "nothing is tracked". An empty stdout is the
      // pass condition, so an unrun command is indistinguishable from a clean tree unless we throw.
      let out;
      try {
        out = execFileSync('git', ['-C', REPO, 'ls-files', '--', repoPath], { encoding: 'utf8' });
      } catch (e) {
        assert.fail(`git ls-files could not be run for ${repoPath} (${e.message.split('\n')[0]}) — `
          + 'the tracked set is UNKNOWN, not empty');
      }
      const tracked = out.split('\n').filter(Boolean);
      assert.deepEqual(tracked, [],
        `${tracked.length} tracked file(s) under ${repoPath}: ${tracked.slice(0, 5).join(', ')}. `
        + 'On the next checkout git restores these as real files, which rebuilds a real directory '
        + 'over the symlink and orphans every subsequent write. Move them into the sidecar and '
        + '`git rm --cached` the paths here.');
      checkedPaths++;
    }
    // No vacuous pass: an empty SIDECAR_PATHS would make the loop green without asserting anything.
    assert.equal(checkedPaths, SIDECAR_PATHS.length, 'not every declared path was checked');
  });
});

describe('sidecar paths — inode identity (skipped without a sidecar, and it says so)', { skip: adopted ? false : UNADOPTED }, () => {
  test('each declared path is a symlink resolving INTO the sidecar', () => {
    for (const { repoPath, sidecarPath } of SIDECAR_PATHS) {
      const full = join(REPO, repoPath);
      assert.ok(existsSync(full), `${repoPath} is missing entirely`);
      assert.ok(lstatSync(full).isSymbolicLink(), `${repoPath} is a real directory, not a symlink — it has stopped being versioned`);
      assert.equal(
        resolve(dirname(full), readlinkSync(full)),
        resolve(SIDECAR, sidecarPath),
        `${repoPath} points somewhere other than the sidecar (link: ${readlinkSync(full)})`,
      );
    }
  });

  test('the same inode is reached by both routes — the second witness', () => {
    for (const { repoPath, sidecarPath, witness } of SIDECAR_PATHS) {
      const viaRepo = join(REPO, repoPath, witness);
      const viaSidecar = join(SIDECAR, sidecarPath, witness);
      assert.ok(existsSync(viaSidecar), `${sidecarPath}/${witness} absent from the sidecar`);
      assert.equal(
        statSync(viaRepo).ino, statSync(viaSidecar).ino,
        `${repoPath}/${witness} and ${sidecarPath}/${witness} are different files. The link resolves ` +
        `but not to the versioned copy — writes through this tree are not being recorded.`,
      );
    }
  });

  test('the sidecar is a git repository, which is the entire point of moving them', () => {
    // A plain directory outside the repo would satisfy every check above and fix nothing: still one
    // disk, still no history. The reason these moved is version control.
    assert.ok(existsSync(join(SIDECAR, '.git')), `${SIDECAR} is not a git repository — the stores have no history again`);
    const tracked = execFileSync('git', ['-C', SIDECAR, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.ok(tracked.length > 50, `sidecar tracks only ${tracked.length} files — the stores are present but uncommitted`);
  });

});

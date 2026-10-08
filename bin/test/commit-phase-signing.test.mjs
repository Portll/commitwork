// Signing, end to end against real git and a real (throwaway) ssh key.
//
// WHAT THIS EXISTS TO CATCH, stated as the defect it was written from: `commit.gpgsign true` was
// set globally on 2026-08-04 and every commit on main still read `%G? = N` on 2026-09-06. The
// config was never wrong and never fired, because `commit.gpgsign` is porcelain-only — `git commit`
// reads it, `git commit-tree` does not, and bin/commit-phase.mjs lands with commit-tree. Sixteen
// months of "signing is configured" describing nothing. A test that asserted the CONFIG would have
// been green for all of it.
//
// So this file asserts the SIGNATURE ON THE OBJECT, and asserts it in BOTH directions, because only
// one of those directions lies to you:
//   · false negative — commit-phase must produce a signed commit  (the guard works)
//   · false positive — a raw commit-tree WITHOUT -S in the SAME repo, under the SAME config, must
//     produce an unsigned one                                     (the guard is what did it)
// Without the second, a scratch repo that happened to sign by default would make the first pass for
// a reason that has nothing to do with the code under test.
//
// The key is generated per scratch repo and thrown away. Nothing here reads ~/.ssh, so this runs
// identically on a fresh clone and in the Linux container — which is the whole reason the other
// commit-phase test files set CW_ALLOW_UNSIGNED=1 and point here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commit-phase.mjs');
const EMAIL = 'signer@example.invalid';
// Every commit stamps package.json from its parent's, so each fixture carries one.
const PKG = '{\n  "name": "fixture",\n  "version": "0.1.0",\n  "private": true\n}\n';

const g = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** ssh-keygen is the one external tool this file needs. Absent ⇒ SKIP WITH A REASON, never a pass. */
function haveSshKeygen() {
  try {
    execFileSync('ssh-keygen', ['-A', '-h'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return e.status !== undefined;             // it ran and complained = present; ENOENT = absent
  }
}

/**
 * Run the CLI; never throws — a refusal is data, not an exception.
 *
 * spawnSync, not execFileSync-in-a-try: the throwing form only surfaces stderr on the FAILURE path,
 * so a warning printed by a run that exits 0 is invisible to the caller. The unsigned-escape test
 * below is exactly that shape — it asserts a warning on a SUCCESSFUL land — and it failed against
 * an empty string until this helper stopped discarding the stream it was asked about.
 */
function cli(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CW_COMMIT_REPO: cwd,
      CW_TOUCH_LEDGER: join(cwd, '.cw-test-touches.jsonl'),
      CW_ALLOW_UNSIGNED: '',                   // explicit: this file is the one that DOES sign
      ...env,
    },
  });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

/**
 * A repo that signs with a key it owns. Every signing setting is LOCAL to the repo, so the
 * operator's global config cannot make this pass and its absence cannot make it fail.
 */
function scratch({ breakKey = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-signing-'));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', EMAIL]);
  g(dir, ['config', 'user.name', 'signer']);

  const key = join(dir, 'id_test');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'cw-test', '-f', key]);
  const allowed = join(dir, 'allowed_signers');
  const pub = readFileSync(`${key}.pub`, 'utf8').trim();
  writeFileSync(allowed, `${EMAIL} ${pub.split(' ').slice(0, 2).join(' ')}\n`);

  g(dir, ['config', 'gpg.format', 'ssh']);
  // The broken case points at a path that does not exist. This is the realistic failure — a key
  // that moved, an agent that is not running — not a synthetic one.
  g(dir, ['config', 'user.signingkey', breakKey ? join(dir, 'no-such-key.pub') : `${key}.pub`]);
  g(dir, ['config', 'gpg.ssh.allowedSignersFile', allowed]);
  // commit.gpgsign is deliberately NOT set: it is the porcelain flag that did nothing here, and
  // leaving it off proves the signature comes from commit-phase passing -S rather than from config.
  g(dir, ['config', 'commit.gpgsign', 'false']);

  writeFileSync(join(dir, 'mine.txt'), 'base\n');
  writeFileSync(join(dir, 'package.json'), PKG);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-q', '-m', 'test: base']);
  return dir;
}

const sigMark = (dir, ref = 'HEAD') => g(dir, ['log', '-1', '--format=%G?', ref]);

test('commit-phase lands a VERIFIED signature — and a bare commit-tree in the same repo does not', (t) => {
  if (!haveSshKeygen()) return t.skip('ssh-keygen not on PATH — signing cannot be exercised here');
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'mine.txt'), 'signed work\n');
  const r = cli(dir, ['-m', 'test: sign a commit', '--', 'mine.txt']);
  assert.equal(r.code, 0, r.err);

  // Direction 1: the guard works. G, not merely "not N" — the principal matched too, so this also
  // covers the allowed_signers half that made real commits read U rather than G.
  assert.equal(sigMark(dir), 'G', `expected a verified signature, got ${sigMark(dir)}\n${r.err}`);

  // Direction 2: the guard is what did it. Same repo, same config, same tree — no -S, no signature.
  // If this ever reads G, the test above has stopped proving anything about commit-phase.
  const tree = g(dir, ['rev-parse', 'HEAD^{tree}']);
  const bare = g(dir, ['commit-tree', tree, '-p', 'HEAD', '-m', 'control: no -S']);
  assert.equal(g(dir, ['log', '-1', '--format=%G?', bare]), 'N',
    'the control commit was signed without -S — this repo signs by default, so the assertion above is vacuous');
});

test('signing failure REFUSES the land, and nothing moves', (t) => {
  if (!haveSshKeygen()) return t.skip('ssh-keygen not on PATH — signing cannot be exercised here');
  const dir = scratch({ breakKey: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const before = g(dir, ['rev-parse', 'HEAD']);
  writeFileSync(join(dir, 'mine.txt'), 'work that must not land\n');
  const r = cli(dir, ['-m', 'test: expect a refusal', '--', 'mine.txt']);

  assert.notEqual(r.code, 0, 'commit-phase returned success with a broken signing key');
  assert.match(r.err, /REFUSED/, r.err);
  // The refusal has to be a REFUSAL, not a complaint after the fact. An unsigned commit that landed
  // cannot be signed later: a signature is part of the commit object, so fixing one rewrites every
  // sha below it. HEAD not moving is the only assertion that distinguishes the two.
  assert.equal(g(dir, ['rev-parse', 'HEAD']), before, 'HEAD moved despite the refusal');
});

test('CW_ALLOW_UNSIGNED=1 lands anyway, unsigned, and says so out loud', (t) => {
  if (!haveSshKeygen()) return t.skip('ssh-keygen not on PATH — signing cannot be exercised here');
  const dir = scratch({ breakKey: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const before = g(dir, ['rev-parse', 'HEAD']);
  writeFileSync(join(dir, 'mine.txt'), 'deliberately unsigned\n');
  const r = cli(dir, ['-m', 'test: escape hatch', '--', 'mine.txt'], { CW_ALLOW_UNSIGNED: '1' });

  assert.equal(r.code, 0, r.err);
  assert.notEqual(g(dir, ['rev-parse', 'HEAD']), before, 'the escape did not land anything');
  assert.equal(sigMark(dir), 'N', 'expected an unsigned commit under the escape');
  // The escape must leave a record. A silent one is indistinguishable from the defect this whole
  // file exists to catch — an unsigned commit nobody chose.
  assert.match(r.err, /UNSIGNED/, `the escape landed without warning:\n${r.err}`);
});

test('the escape is exactly "1" — no truthy-string near miss opens it', (t) => {
  if (!haveSshKeygen()) return t.skip('ssh-keygen not on PATH — signing cannot be exercised here');
  const dir = scratch({ breakKey: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'mine.txt'), 'near miss\n');
  // 'true', '0' and 'yes' are all truthy strings in JS. A `if (process.env.X)` implementation would
  // open the escape on every one of them, including '0' — and on the empty-string default the other
  // test files set. The value is compared, not coerced.
  for (const v of ['true', '0', 'yes', 'false', '']) {
    const r = cli(dir, ['-m', `near miss ${v}`, '--', 'mine.txt'], { CW_ALLOW_UNSIGNED: v });
    assert.notEqual(r.code, 0, `CW_ALLOW_UNSIGNED=${JSON.stringify(v)} opened the escape`);
  }
});

// ── merged from origin/main: the state every fresh machine is in ─────────────
// fact: %G? reads N for signed-but-unverifiable; the header decides
/** Signing configured, allowedSignersFile deliberately UNSET — the state that broke the first guard. */
function unverifiableRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sign-unv-'));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 'test@example.invalid']);
  g(dir, ['config', 'user.name', 'test']);
  const key = join(dir, 'k');
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'test', '-f', key], { stdio: 'ignore' });
  g(dir, ['config', 'gpg.format', 'ssh']);
  g(dir, ['config', 'user.signingkey', `${key}.pub`]);
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  writeFileSync(join(dir, 'package.json'), PKG);
  g(dir, ['add', '-A']); g(dir, ['commit', '-q', '-m', 'base', '--no-gpg-sign']);
  return dir;
}
const objectHeaders = (dir, sha) => execFileSync('git', ['cat-file', 'commit', sha], { cwd: dir, encoding: 'utf8' }).split('\n\n')[0];

test('a SIGNED but UNVERIFIABLE commit lands — %G? says N and the object says otherwise', (t) => {
  if (!haveSshKeygen()) return t.skip('ssh-keygen not on PATH — signing cannot be exercised here');
  const dir = unverifiableRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a.txt'), 'work\n');
  const r = cli(dir, ['-m', 'test: sign without a verifier', '--', 'a.txt']);
  assert.equal(r.code, 0, `refused a correctly signed commit: ${r.err}`);
  const sha = r.out.split('\n')[0].trim();
  assert.match(objectHeaders(dir, sha), /^gpgsig(?:-sha256)? /m, 'the object must carry the signature');
  // fact: git reports N or U here, by version; neither is a verified signature
  const mark = g(dir, ['log', '-1', '--format=%G?', sha]);
  assert.ok(mark === 'N' || mark === 'U', `expected an unverified mark, got ${mark} — the fixture no longer reproduces the defect`);
});

test('the unsigned escape says it is permanent', (t) => {
  if (!haveSshKeygen()) return t.skip('ssh-keygen not on PATH — signing cannot be exercised here');
  const dir = unverifiableRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a.txt'), 'work\n');
  const r = cli(dir, ['-m', 'test: skip the signature on purpose', '--', 'a.txt'], { CW_ALLOW_UNSIGNED: '1' });
  assert.equal(r.code, 0, r.err);
  const sha = r.out.split('\n')[0].trim();
  assert.doesNotMatch(objectHeaders(dir, sha), /^gpgsig/m, 'the escape must actually skip signing');
  assert.match(r.err, /permanent|cannot be added/i, 'an unsigned land must say it cannot be repaired later');
});

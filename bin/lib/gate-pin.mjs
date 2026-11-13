// usage: the COMMITTED copy of commitwork that each installed commit-msg gate runs
// (bin/install-commit-msg.mjs, monitor/install-git-hook.mjs).
//
// WHY A COPY RATHER THAN THE CHECKOUT. A hook pointing into a working tree runs whatever is in that
// tree at the instant of the commit. Eight-plus sessions share this one, so a half-finished edit to
// the verb list, or a syntax error in any module the gate imports, decides every repository's
// commits — and the session that made the edit is not the one being refused. The gate runs an
// export of one commit instead, named in the hook text, and it moves only when --refresh exports a
// newer one.
//
// The export is the WHOLE tree, not the gate's import closure. bin/commit-msg.mjs reaches
// bin/commit-phase.mjs and bin/lib/store-paths.mjs, which reaches monitor/store-paths.mjs, so a
// closure named by hand is already wrong and would go wrong again silently. ensureExport then RUNS
// the copy before it will install it, because "the files are there" is not "the gate works".
//
// env, read at CALL time: CW_GATE_DIR (where exports and the ledger live), CW_GATE_REF (the
// revision to pin). A module-load read of either silently defeats any test that sets it afterwards.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeAtomic } from '../../monitor/lockfile.mjs';

// The trunk, not a remote-tracking ref: what a remote's main names depends on when it was last
// fetched and on which remote, and the gate must run what this checkout has landed.
const REFS = Object.freeze(['main', 'HEAD']);   // HEAD: a clone sitting on another branch still pins a COMMIT

const REVISION = /^[0-9a-f]{40}$/;
const ARCHIVE_MAX = 1 << 30;

/** Where the exports and the installer's ledger live. CW_GATE_DIR overrides, read at call time. */
export const gateDir = (cw) => (process.env.CW_GATE_DIR
  ? resolve(process.env.CW_GATE_DIR)
  : join(cw, '.claude', 'store', 'commit-msg-gate'));

/** The repositories whose gate this installer pinned, so --refresh knows what to rewrite. */
export const ledgerPath = (cw) => join(gateDir(cw), 'installed.json');

/** One revision's exported tree. Immutable: a new revision is a new directory, never an edit. */
export const exportDir = (cw, revision) => join(gateDir(cw), revision);

/** The gate script inside a revision's export — the path a pinned hook execs. */
export const gateScript = (cw, revision) => join(exportDir(cw, revision), 'bin', 'commit-msg.mjs');

/** { ok, ref, revision } for the revision to pin, or { ok: false, why }. */
export function resolveRevision(cw) {
  const refs = process.env.CW_GATE_REF ? [process.env.CW_GATE_REF] : REFS;
  for (const ref of refs) {
    const r = spawnSync('git', ['-C', cw, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { encoding: 'utf8' });
    const sha = r.status === 0 ? String(r.stdout).trim() : '';
    if (REVISION.test(sha)) return { ok: true, ref, revision: sha };
  }
  return { ok: false, why: `${cw} resolves none of ${refs.join(', ')} to a commit, so there is no committed gate to pin` };
}

// A message every rule set accepts, and the same message carrying the one trailer every rule set
// refuses. The pair is deliberately not a policy check: which subjects pass is the pinned
// revision's business and may legitimately tighten, so the first message only has to produce a
// VERDICT (exit 0, or a refusal line — either way the copy ran), while the second must actually be
// refused. The trailer path is also the deepest import chain the gate has, through
// bin/commit-phase.mjs, so a copy missing a module cannot pass this.
const VERIFY_PLAIN = 'feat(gates): pin the commit-msg gate to a committed revision\n';
const VERIFY_TRAILER = `${VERIFY_PLAIN}\nCo-Authored-By: nobody <nobody@example.invalid>\n`;

const firstLine = (s) => String(s).split('\n').find((l) => l.trim()) || '';

/**
 * Run an exported gate on both messages above. { ok } when it produced a verdict on the first and
 * refused the second; { ok: false, why } otherwise. Asserts the EFFECT — never that files exist.
 */
export function verifyExport(script) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gate-verify-'));
  // cwd is outside any repository on purpose: the gate reads `git config commitwork.rules` from
  // its cwd, and a verification whose verdict depends on the ambient repo's config is no check.
  try {
    const file = join(dir, 'COMMIT_EDITMSG');
    const run = (text) => {
      writeFileSync(file, text);
      const r = spawnSync(process.execPath, [script, file], { cwd: dir, encoding: 'utf8' });
      const err = String(r.stderr || '') + String(r.error ? r.error.message : '');
      return { status: r.status, verdict: /^commit-msg: REFUSED\./m.test(err), err };
    };
    const plain = run(VERIFY_PLAIN);
    if (plain.status !== 0 && !plain.verdict) return { ok: false, why: `does not run: ${firstLine(plain.err)}` };
    const trailer = run(VERIFY_TRAILER);
    if (trailer.status === 0 || !trailer.verdict) {
      return { ok: false, why: `does not refuse a Co-Authored-By trailer (exit ${trailer.status}): ${firstLine(trailer.err)}` };
    }
    return { ok: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Export `revision` if it is not already there, verify it runs, and return { ok, script, exported }
 * or { ok: false, why }. Idempotent: an export that exists is reused, so a refresh after the trunk
 * has not moved writes nothing.
 */
export function ensureExport(cw, revision) {
  const script = gateScript(cw, revision);
  if (existsSync(script)) return { ok: true, script, exported: false };
  const dir = gateDir(cw);
  let tmp;
  try {
    mkdirSync(dir, { recursive: true });
    // Beside the destination, so the rename below is on one filesystem and therefore atomic: a
    // commit firing mid-export sees the old copy or the new one, never a half-extracted tree.
    tmp = mkdtempSync(join(dir, `.export-${revision.slice(0, 12)}-`));
    const tar = execFileSync('git', ['-C', cw, 'archive', '--format=tar', revision], { maxBuffer: ARCHIVE_MAX });
    execFileSync('tar', ['-x', '-C', tmp], { input: tar, maxBuffer: ARCHIVE_MAX });
    const ran = verifyExport(join(tmp, 'bin', 'commit-msg.mjs'));
    if (!ran.ok) return { ok: false, why: `the export of ${revision} ${ran.why}` };
    try {
      renameSync(tmp, exportDir(cw, revision));
      tmp = undefined;
    } catch (e) {
      // A peer exported the same revision first: identical content, so its copy is ours.
      if (!existsSync(script)) throw e;
    }
    return { ok: true, script, exported: true };
  } catch (e) {
    return { ok: false, why: `${revision} could not be exported to ${dir} (${e.code || e.message})` };
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The pin an installer should write: { ok, ref, revision, script, exported } or { ok: false, why }.
 * Without `write` it reports the revision and the path it would use and exports nothing.
 */
export function pinFor(cw, { write = false } = {}) {
  const rev = resolveRevision(cw);
  if (!rev.ok) return rev;
  const pin = { ok: true, ref: rev.ref, revision: rev.revision, script: gateScript(cw, rev.revision), exported: false };
  if (!write) return pin;
  const made = ensureExport(cw, rev.revision);
  return made.ok ? { ...pin, exported: made.exported } : made;
}

/** The ledger, { repos: [{ repo, rules, revision }] }. Only ENOENT is an empty one. */
export function readLedger(cw) {
  const path = ledgerPath(cw);
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { repos: [] };
    throw e;   // a permission error is not "no gate is installed"
  }
  const data = JSON.parse(text);   // a ledger that does not parse is not an empty ledger either
  if (!data || !Array.isArray(data.repos)) throw new Error(`${path} holds no repos[] array`);
  return data;
}

/** Replace the ledger. Sorted by path and written atomically, so re-runs are byte-identical. */
export function writeLedger(cw, repos) {
  const rows = [...repos]
    .map(({ repo, rules, revision }) => ({ repo, rules, revision }))
    .sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
  writeAtomic(ledgerPath(cw), `${JSON.stringify({ repos: rows }, null, 2)}\n`, { mkdir: true });
}

/** Record one pinned install, replacing any earlier row for the same repository. */
export function recordRepo(cw, { repo, rules, revision }) {
  const led = readLedger(cw);
  writeLedger(cw, [...led.repos.filter((r) => r.repo !== repo), { repo, rules, revision }]);
}

/** Drop a repository's row. Returns whether there was one. Writes nothing when there was not. */
export function forgetRepo(cw, repo) {
  const led = readLedger(cw);
  const kept = led.repos.filter((r) => r.repo !== repo);
  if (kept.length === led.repos.length) return false;
  writeLedger(cw, kept);
  return true;
}

/**
 * Remove every export no row in `keep` names, newest-last by name order. A hook pointing at one
 * that goes is not left guessing: it refuses the commit and names --refresh (bin/lib/commit-msg-hook.mjs).
 */
export function pruneExports(cw, keep) {
  const dir = gateDir(cw);
  let names;
  try { names = readdirSync(dir); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const gone = names.filter((n) => REVISION.test(n) && !keep.has(n)).sort();
  for (const n of gone) rmSync(join(dir, n), { recursive: true, force: true });
  return gone;
}

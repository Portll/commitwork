#!/usr/bin/env node
// workflow-harden.mjs — prepare a workflow-security remediation the way the fleet did it by hand
// (clientC PR #4, trufflehog E–I): pin every action to a commit SHA, apply zizmor's safe
// autofixes for the rest, add a dependabot lane so the pins stay fresh, and VERIFY the result — all
// declare-only. This never pushes, forks, or opens a PR; it prepares the tree and hands off, the same
// boundary remediation-pr.mjs holds. The point is to stop hand-editing YAML: zizmor already FINDS
// these, and zizmor --fix + a tiny SHA pinner already FIX them, so the remaining work is orchestration.
//
// DIVISION OF LABOUR, deliberate:
//   pinning (unpinned-uses)          -> here. zizmor does not pin well; the rewrite is line-local and
//                                       safe, so a small deterministic pass owns it.
//   persist-credentials, template-   -> zizmor --fix=safe. Doing persist-credentials by hand means
//   injection, permissions              merging into an existing `with:` block, and getting that
//                                       wrong DUPLICATES the key (measured live, PR #4: two files).
//                                       zizmor's own fixer handles the merge; we do not re-derive it.
//   keeping pins fresh               -> a dependabot github-actions lane. A pin with no bump path
//                                       rots into a stale SHA nobody updates; the lane is the other
//                                       half of pinning, not a nicety.
//
// Determinism: pinning is a pure text transform over an injected SHA resolver; the same (text,
// resolver) yields byte-identical output. Env at call time. The resolver + zizmor runner are seams,
// so the core is offline-testable and the network only happens in the default seams.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isMainModule } from '../lib/is-main.mjs';

const env = (k) => process.env[k];

const SHA_RE = /^[0-9a-f]{40}$/;                 // a pinned ref is a full commit SHA
// owner/repo[/path]. Each segment is bounded by `/`: the earlier `(?:X*\/X+)+` let adjacent
// segments trade characters and backtracked exponentially on a scanned repo's `uses:` value.
const ACTION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;
const TAG_RE = /^[\w.\/-]+$/;                    // a ref (tag/branch) — validated before any subprocess arg

/** True for refs we must NOT try to pin: local actions, docker images, already-a-SHA. */
export function unpinnable(action, ref) {
  if (action.startsWith('./') || action.startsWith('../')) return 'local-action';
  if (action.startsWith('docker://')) return 'docker-image';
  if (SHA_RE.test(ref)) return 'already-pinned';
  if (!ACTION_RE.test(action) || !TAG_RE.test(ref)) return 'unrecognised';
  return null;
}

/**
 * Rewrite every `uses: owner/repo@ref` in a workflow to `owner/repo@<sha> # ref`. Pure: takes a
 * resolver `(action, ref) -> sha|null`. A null resolution (couldn't look it up) leaves the line
 * UNCHANGED — pinning fails open on a lookup, because a wrong SHA is worse than an unpinned tag.
 * Idempotent: an already-pinned line, or one already carrying `# ref`, is left alone.
 * @returns {{ text:string, pinned:Array<{action,ref,sha}>, skipped:Array<{action,ref,reason}> }}
 */
export function pinUses(text, resolveSha) {
  const pinned = [], skipped = [];
  // CRLF. The trailer group below is `(\s*(#.*)?)$`, and `.` does not match `\r` while `$` without
  // the `m` flag matches only the end of the string — so under a CRLF checkout (the Git for Windows
  // default) any `uses:` line CARRYING A TRAILING COMMENT failed to match at all, and `if (!m)
  // return line` returned it silently. Not pinned, and NOT pushed to `skipped` either.
  //
  // Measured on one two-action workflow: LF gave pinned=[checkout, setup-node] skipped=[];
  // CRLF gave pinned=[setup-node] skipped=[]. The unpinned action vanished from both lists — an
  // unpinned third-party action reported as nothing at all, which is grey published as green on
  // the supply-chain axis. And `uses: actions/x@<sha> # v4.1.1` is the STANDARD pinning
  // convention, so the affected case is the normal one, not an edge.
  //
  // The line ending is preserved rather than normalised: rewriting a CRLF workflow as LF would
  // put a whole-file diff around a one-line change. bin/pin-actions.mjs does the same job with
  // `\s*$` instead of `(#.*)?$` and was never affected — two implementations, one correct.
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const out = text.split(/\r?\n/).map((line) => {
    const m = line.match(/^(\s*(?:- )?uses:\s*)([^@\s]+)@([^\s#]+)(\s*(#.*)?)$/);
    if (!m) return line;
    const [, prefix, action, ref, trailer] = m;
    const why = unpinnable(action, ref);
    if (why) { if (why !== 'already-pinned') skipped.push({ action, ref, reason: why }); return line; }
    const sha = resolveSha(action, ref);
    if (!sha || !SHA_RE.test(sha)) { skipped.push({ action, ref, reason: 'unresolved' }); return line; }
    pinned.push({ action, ref, sha });
    // keep any pre-existing trailing comment only if it is not just a tag we are now encoding
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- keyIndent is whitespace and ref a [\w./-] workflow token captured by an earlier regex
    const keptComment = /#/.test(trailer) && !new RegExp(`#\\s*${ref}\\b`).test(trailer) ? ` ${trailer.trim()}` : '';
    return `${prefix}${action}@${sha} # ${ref}${keptComment}`;
  });
  return { text: out.join(eol), pinned, skipped };
}

/**
 * Add `persist-credentials: false` to every actions/checkout step (artipacked). Pure. This is the
 * fix whose HAND version duplicated the `with:` key (PR #4, two files): the safe form MERGES into an
 * existing `with:` block rather than adding a second one, and is idempotent if the key is already
 * set. Only `actions/checkout` steps are touched — the finding is specific to the token it persists.
 * @returns {{ text:string, changed:number }}
 */
export function addPersistCredentials(text) {
  // Same CRLF discipline as pinUses. The matching here survives CRLF on its own (`\s*$` and `\s`
  // both match `\r`), but `split('\n')` left the `\r` ON each existing line while the lines this
  // function INSERTS have none — so a CRLF workflow came back with mixed endings, which is a
  // whole-file diff in most editors and a lint failure in some. Split and rejoin deliberately.
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = line.match(/^(\s*)(- )?uses:\s*actions\/checkout(@|\s|$)/);
    if (!m) continue;
    const keyIndent = m[1] + (m[2] ? '  ' : '');           // indent of the step's keys (uses:, with:)
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- keyIndent is whitespace and ref a [\w./-] workflow token captured by an earlier regex
    const withRe = new RegExp('^' + keyIndent + 'with:\\s*$');
    const next = lines[i + 1] ?? '';
    if (withRe.test(next)) {
      // existing with: block — scan it; add the key only if absent (no duplicate `with:`)
      let j = i + 2, has = false;
      const childIndent = keyIndent + '  ';
      while (j < lines.length && (lines[j].startsWith(childIndent) || lines[j].trim() === '')) {
        if (/persist-credentials\s*:/.test(lines[j])) has = true;
        j++;
      }
      if (!has) { out.push(lines[i + 1]); out.push(`${childIndent}persist-credentials: false`); i++; changed++; }
    } else {
      // no with: block — add one
      out.push(`${keyIndent}with:`);
      out.push(`${keyIndent}  persist-credentials: false`);
      changed++;
    }
  }
  return { text: out.join(eol), changed };
}

/**
 * Merge a github-actions lane into an existing dependabot config text (or create one). Idempotent:
 * if a `package-ecosystem: "github-actions"` entry already exists, the text is returned unchanged.
 * Kept as a string transform (not a YAML round-trip) so an existing hand-authored config is not
 * reformatted out from under its author.
 * @returns {{ text:string, added:boolean }}
 */
export function ensureDependabotActions(existing) {
  const cur = existing || '';
  if (/package-ecosystem:\s*["']?github-actions["']?/.test(cur)) return { text: cur, added: false };
  const block = [
    '  - package-ecosystem: "github-actions"',
    '    directory: "/"',
    '    schedule:',
    '      interval: "weekly"',
    '',
  ].join('\n');
  if (!cur.trim()) {
    return { text: `version: 2\nupdates:\n${block}`, added: true };
  }
  // append under an existing `updates:` list, else append a fresh updates block
  if (/^\s*updates:\s*$/m.test(cur)) {
    const text = cur.replace(/(\n?)$/, (cur.endsWith('\n') ? '' : '\n') + block);
    return { text, added: true };
  }
  return { text: `${cur.replace(/\n?$/, '\n')}updates:\n${block}`, added: true };
}

// ── default live seams ───────────────────────────────────────────────────────────────────────────

/** Resolve owner/repo@ref to a commit SHA via gh. Validates args; null on any failure (fail open). */
export function resolveActionShaGh(action, ref) {
  if (!ACTION_RE.test(action) || !TAG_RE.test(ref)) return null;
  const repo = action.split('/').slice(0, 2).join('/');           // strip any /subpath
  const r = spawnSync('gh', ['api', `repos/${repo}/commits/${ref}`, '--jq', '.sha'], { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) return null;
  const sha = (r.stdout || '').trim();
  return SHA_RE.test(sha) ? sha : null;
}

/** Run `zizmor --fix=safe` over a workflows dir (its own with-block-safe autofixer). Injectable. */
export function zizmorFix(dir) {
  const r = spawnSync('zizmor', ['--fix=safe', dir], { encoding: 'utf8', timeout: 120000 });
  return { status: r.status, stderr: (r.stderr || '').slice(0, 2000) };
}

/** Count zizmor findings over a dir (the verify oracle). Returns null if zizmor could not run. */
export function zizmorCount(dir) {
  const r = spawnSync('zizmor', ['--format', 'json', dir], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(r.stdout || '').length; } catch { return null; }
}

const isYaml = (n) => n.endsWith('.yml') || n.endsWith('.yaml');

/**
 * Prepare (never apply) the hardening of one repo's workflows. Pins uses, runs zizmor --fix, ensures
 * a dependabot lane, then VERIFIES with a fresh zizmor count. Returns a plan/report; the caller (a
 * human, via the remediation-pr flow) commits and opens the PR.
 * @param {{ repoDir:string, resolve?:Function, fix?:Function, count?:Function, apply?:boolean }} opts
 */
export function hardenWorkflows({ repoDir, resolve = resolveActionShaGh, fix = zizmorFix, count = zizmorCount, apply = false } = {}) {
  const wfDir = join(repoDir, '.github', 'workflows');
  let files = [];
  try { files = readdirSync(wfDir).filter(isYaml); } catch { return { ok: false, reason: 'no .github/workflows dir' }; }

  const before = count(wfDir);
  const pinnedAll = [], skippedAll = [];
  let persistFixed = 0;
  const edits = [];
  for (const f of files) {
    const path = join(wfDir, f);
    const orig = readFileSync(path, 'utf8');
    // commitwork OWNS these two fixes natively (no scanner needed): SHA-pin every action, and
    // persist-credentials:false on every checkout (merged into any existing with: block).
    const { text: t1, pinned, skipped } = pinUses(orig, resolve);
    const { text: t2, changed } = addPersistCredentials(t1);
    pinnedAll.push(...pinned.map((p) => ({ file: f, ...p })));
    skippedAll.push(...skipped.map((s) => ({ file: f, ...s })));
    persistFixed += changed;
    if (apply && t2 !== orig) writeFileSync(path, t2);
    else if (t2 !== orig) edits.push({ file: f });
  }

  // Remaining classes (template-injection, cache-poisoning, permissions) are handed to zizmor's own
  // with-block-aware fixer rather than re-derived here — the one place delegation still earns its
  // keep. zizmor stays the FIND + VERIFY oracle regardless (below).
  let after = before;
  if (apply) { fix(wfDir); after = count(wfDir); }

  // dependabot lane (report the intended text; only write under --apply)
  const dbPath = join(repoDir, '.github', 'dependabot.yml');
  let dbExisting = '';
  try { dbExisting = readFileSync(dbPath, 'utf8'); } catch { /* none */ }
  const db = ensureDependabotActions(dbExisting);
  if (apply && db.added) writeFileSync(dbPath, db.text);

  return {
    ok: true,
    applied: apply,
    files,
    pinned: pinnedAll,
    persistCredentialsFixed: persistFixed,
    skipped: skippedAll,
    dependabot: { added: db.added, path: dbPath },
    verify: { findingsBefore: before, findingsAfter: after, cleared: (before != null && after != null) ? before - after : null },
    note: apply ? 'applied to the working tree — commit and open the PR (human act)' : 'DRY RUN — nothing written; pass apply:true to edit the tree, then a human submits',
  };
}

// ── CLI: dry-run by default; --apply edits the tree (still never commits/pushes) ───────────────────
function main(argv) {
  const repoDir = argv.find((a) => !a.startsWith('--')) || '.';
  const apply = argv.includes('--apply');
  const out = hardenWorkflows({ repoDir, apply });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  if (out.ok) process.stderr.write(`pinned=${out.pinned.length} skipped=${out.skipped.length} dependabot=${out.dependabot.added ? 'added' : 'present'} verify=${JSON.stringify(out.verify)} ${apply ? '(APPLIED)' : '(dry-run)'}\n`);
}
if (isMainModule(import.meta.url)) main(process.argv.slice(2));

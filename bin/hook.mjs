#!/usr/bin/env node
// bin/hook.mjs — a commitwork pre-commit hook for any git repository: install, uninstall, run.
// The check reads the INDEX — the content the commit is built from — never the working tree.
//
// usage:
//   commitwork hook install   [--repo <path>] [--chain] [--dry-run] [<run options>]
//   commitwork hook uninstall [--repo <path>] [--dry-run]
//   commitwork hook run       [--repo <path>] [--json] [<run options>]
// run options (install bakes them into the hook it writes):
//   --lanes secrets[,gitleaks]  secrets: built in, always runnable. gitleaks: `gitleaks git
//                               --pre-commit --staged`, opt-in (CW_GITLEAKS names the binary).
//   --unrun block|warn          a lane that could not run (scanner missing, scan failure): block
//                               the commit (default) or let it through saying it was NOT checked.
//   --fail-on-context           also block on SENSITIVE-CONTEXT (emails, home paths, LAN addresses).
//   --block-existing            also block on a secret the commit did not add (already in HEAD).
//
// Never reads a repo-local commitwork.json: the lanes are built in, so nothing the scanned repo
// declares executes here (repo manifests need --trust-repo-manifest, on `run`/`scan` only).
//
// exit, run:       0 every lane ran, nothing blocking · 20 findings — commit blocked
//                  21 a lane could not run and --unrun block · 2 usage
// exit, install/uninstall: 0 done (or dry run) · 22 refused: a hook commitwork did not write · 2 usage
import { readFileSync, existsSync, mkdirSync, unlinkSync, renameSync, mkdtempSync, rmSync, lstatSync } from 'node:fs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { scanBuffer, maxBytes, VERDICT, UNSCANNED } from './secrets-sweep.mjs';
import { mainCheckout } from './install-commit-msg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const HOOK_MARKER = 'commitwork pre-commit hook';
export const CHAINED = 'pre-commit.commitwork-chained';
export const LANES = ['secrets', 'gitleaks'];
export const EXIT = { CLEAN: 0, USAGE: 2, FINDINGS: 20, UNRUN: 21, REFUSED: 22 };
const ZERO_SHA = /^0+$/;
const SUBMODULE = '160000';
const SYMLINK = '120000';

// a hook's output lands in terminals, IDE panes and CI logs: name the place and the rule, not the credential
export const redact = (m) => (m.length <= 8 ? '…' : `${m.slice(0, 4)}…(${m.length} chars)`);

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// fact: inherits the caller's env — inside a hook git exports GIT_INDEX_FILE for `commit -a`/`commit <paths>`, and stripping it would scan the wrong index
function git(repo, args, opts = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { maxBuffer: 1024 * 1024 * 1024, ...opts });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : String(r.stderr || '').trim() || `exit ${r.status}`;
    throw new Error(`git ${args[0]}: ${why}`);
  }
  return r.stdout;
}

// ── options ─────────────────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const opts = { repo: process.cwd(), lanes: ['secrets'], unrun: 'block', failOnContext: false,
    blockExisting: false, chain: false, dryRun: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--repo' || a === '-r') opts.repo = val();
    else if (a.startsWith('--repo=')) opts.repo = a.slice(7);
    else if (a === '--lanes') opts.lanes = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--lanes=')) opts.lanes = a.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--unrun') opts.unrun = val();
    else if (a.startsWith('--unrun=')) opts.unrun = a.slice(8);
    else if (a === '--fail-on-context') opts.failOnContext = true;
    else if (a === '--block-existing') opts.blockExisting = true;
    else if (a === '--chain') opts.chain = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.lanes.length) throw new Error('--lanes names no lane');
  for (const l of opts.lanes) if (!LANES.includes(l)) throw new Error(`unknown lane '${l}' (lanes: ${LANES.join(', ')})`);
  if (opts.unrun !== 'block' && opts.unrun !== 'warn') throw new Error(`--unrun is block or warn, not '${opts.unrun}'`);
  opts.repo = resolve(opts.repo);
  return opts;
}

/** The run options an installed hook passes, in a fixed order so a re-install is byte-identical. */
export function runArgs(opts) {
  const a = ['--lanes', opts.lanes.join(','), '--unrun', opts.unrun];
  if (opts.failOnContext) a.push('--fail-on-context');
  if (opts.blockExisting) a.push('--block-existing');
  return a;
}

// ── the staged set ──────────────────────────────────────────────────────────────────────────
/** Parse `git diff --cached --raw -z -M --no-abbrev`. Renames and copies carry two paths. */
export function parseRaw(buf) {
  const tok = buf.toString('utf8').split('\0');
  const out = [];
  for (let i = 0; i < tok.length - 1;) {
    const head = tok[i++];
    if (!head.startsWith(':')) throw new Error(`unparseable raw diff record: ${JSON.stringify(head)}`);
    const [oldMode, newMode, oldSha, newSha, status] = head.slice(1).split(' ');
    const twoPaths = status[0] === 'R' || status[0] === 'C';
    const src = tok[i++];
    const path = twoPaths ? tok[i++] : src;
    out.push({ status: status[0], oldMode, newMode, oldSha, newSha, path, src });
  }
  return out;
}

/** Fetch blobs from the object store in one process each for sizes and bytes. Over-ceiling
 *  blobs come back as { tooLarge }; a missing object THROWS — never read as empty. */
export function readBlobs(repo, shas, ceiling = maxBytes()) {
  const uniq = [...new Set(shas)];
  const blobs = new Map();
  if (!uniq.length) return blobs;
  const check = git(repo, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    { input: `${uniq.join('\n')}\n` }).toString('utf8').trim().split('\n');
  const want = [];
  for (const line of check) {
    const [sha, type, size] = line.split(' ');
    if (type === 'missing' || type !== 'blob') throw new Error(`object ${sha} is ${type}, not a blob`);
    if (Number(size) > ceiling) blobs.set(sha, { tooLarge: true });
    else want.push(sha);
  }
  if (!want.length) return blobs;
  const raw = git(repo, ['cat-file', '--batch'], { input: `${want.join('\n')}\n` });
  let at = 0;
  for (let n = 0; n < want.length; n++) {
    const nl = raw.indexOf(0x0a, at);
    const [sha, , size] = raw.subarray(at, nl).toString('utf8').split(' ');
    const start = nl + 1;
    const end = start + Number(size);
    if (!Number.isFinite(Number(size)) || end > raw.length) throw new Error(`cat-file --batch output truncated at ${sha}`);
    blobs.set(sha, { buf: raw.subarray(start, end) });
    at = end + 1;
  }
  return blobs;
}

// ── lane: secrets (built in) ────────────────────────────────────────────────────────────────
export function laneSecrets(repo, { failOnContext = false, blockExisting = false } = {}) {
  const lane = { lane: 'secrets', ran: false, scannedFiles: 0, findings: [], existing: [], context: [], unscanned: [] };
  try {
    const entries = parseRaw(git(repo, ['diff', '--cached', '--raw', '-z', '-M', '--no-abbrev', '--no-color']));
    const scan = [];
    for (const e of entries) {
      if (e.status === 'D') continue;
      if (e.newMode === SUBMODULE) { lane.unscanned.push({ file: e.path, reason: 'submodule' }); continue; }
      if (e.newMode === SYMLINK) { lane.unscanned.push({ file: e.path, reason: UNSCANNED.NOT_A_FILE }); continue; }
      // the pre-image says what this commit ADDED; a copy's source stays put, so a copy adds all of it
      const prior = (e.status === 'M' || e.status === 'R') && !ZERO_SHA.test(e.oldSha)
        && e.oldMode !== SUBMODULE && e.oldMode !== SYMLINK ? e.oldSha : null;
      scan.push({ ...e, prior });
    }
    const blobs = readBlobs(repo, scan.flatMap((e) => (e.prior ? [e.newSha, e.prior] : [e.newSha])));
    for (const e of scan) {
      const blob = blobs.get(e.newSha);
      if (blob.tooLarge) { lane.unscanned.push({ file: e.path, reason: UNSCANNED.TOO_LARGE }); continue; }
      const res = scanBuffer(blob.buf, e.path);
      if (res.unscanned) { lane.unscanned.push({ file: e.path, reason: res.unscanned }); continue; }
      lane.scannedFiles++;
      // identity is the fingerprint (class + matched span), never the line: a moved secret is the same secret
      const before = new Set();
      const priorBlob = e.prior && blobs.get(e.prior);
      if (priorBlob && priorBlob.buf) for (const h of scanBuffer(priorBlob.buf, e.src).findings || []) before.add(h.fingerprint);
      for (const raw of res.findings) {
        const h = { ...raw, match: redact(raw.match) };
        if (h.verdict === VERDICT.SECRET) (before.has(h.fingerprint) ? lane.existing : lane.findings).push(h);
        else if (h.verdict === VERDICT.CONTEXT) lane.context.push(h);
      }
    }
    lane.ran = true;
  } catch (e) {
    lane.error = e.message;
    return lane;
  }
  lane.blocking = lane.findings.length
    + (blockExisting ? lane.existing.length : 0)
    + (failOnContext ? lane.context.length : 0);
  return lane;
}

// ── lane: gitleaks (external, opt-in) ───────────────────────────────────────────────────────
export function laneGitleaks(repo) {
  const bin = process.env.CW_GITLEAKS || 'gitleaks';
  const lane = { lane: 'gitleaks', ran: false, findings: [] };
  const dir = mkdtempSync(join(tmpdir(), 'cw-hook-gitleaks-'));
  const report = join(dir, 'report.json');
  try {
    // --exit-code 20: gitleaks' default 1 is also what it exits on an error, so a leak and a crash would be one code
    const r = spawnSync(bin, ['git', '--pre-commit', '--staged', '--redact', '--no-banner', '--log-level', 'error',
      '--exit-code', String(EXIT.FINDINGS), '--report-format', 'json', '--report-path', report, repo],
    // no cwd: a missing repo dir would then raise ENOENT and read as a missing scanner
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) {
      lane.error = r.error.code === 'ENOENT' ? `${bin} is not installed (not found on PATH; CW_GITLEAKS names it)` : r.error.message;
      lane.missing = r.error.code === 'ENOENT';
      return lane;
    }
    if (r.status !== 0 && r.status !== EXIT.FINDINGS) {
      lane.error = `${bin} exited ${r.status}: ${String(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`;
      return lane;
    }
    let rows;
    try { rows = JSON.parse(readFileSync(report, 'utf8')); } catch (e) {
      lane.error = `${bin} exited ${r.status} but its report is unreadable (${e.code || e.message})`;
      return lane;
    }
    if (!Array.isArray(rows) || (r.status === EXIT.FINDINGS) !== rows.length > 0) {
      lane.error = `${bin} exited ${r.status} with ${Array.isArray(rows) ? rows.length : 'a non-array'} report rows; the two disagree`;
      return lane;
    }
    lane.findings = rows.map((x) => ({ file: x.File, line: x.StartLine, cls: x.RuleID, fingerprint: x.Fingerprint }))
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.cls.localeCompare(b.cls));
    lane.ran = true;
    lane.blocking = lane.findings.length;
    return lane;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
export function runCheck(opts) {
  const lanes = opts.lanes.map((l) => (l === 'secrets' ? laneSecrets(opts.repo, opts) : laneGitleaks(opts.repo)));
  const blocking = lanes.reduce((n, l) => n + (l.ran ? l.blocking : 0), 0);
  const unrun = lanes.filter((l) => !l.ran).map((l) => l.lane);
  let exit = EXIT.CLEAN;
  if (blocking) exit = EXIT.FINDINGS;
  else if (unrun.length && opts.unrun === 'block') exit = EXIT.UNRUN;
  return { verdict: exit === EXIT.FINDINGS ? 'blocked-findings' : exit === EXIT.UNRUN ? 'blocked-unrun'
    : unrun.length ? 'allowed-unchecked' : 'clean', exit, blocking, unrun, unrunPolicy: opts.unrun, lanes };
}

export function render(result) {
  const L = [];
  const head = {
    'clean': 'commitwork pre-commit: clean — every lane ran over the staged content',
    'blocked-findings': `commitwork pre-commit: BLOCKED — ${result.blocking} finding${result.blocking === 1 ? '' : 's'} in the staged content`,
    'blocked-unrun': `commitwork pre-commit: BLOCKED — ${result.unrun.join(', ')} could not run, so this commit is unchecked (--unrun block)`,
    'allowed-unchecked': `commitwork pre-commit: ALLOWED UNCHECKED — ${result.unrun.join(', ')} could not run (--unrun warn); this is not a pass`,
  }[result.verdict];
  L.push(head);
  for (const l of result.lanes) {
    if (!l.ran) { L.push(`  ${l.lane}  NOT RUN — ${l.error}`); continue; }
    const extra = l.lane === 'secrets' ? ` · ${l.scannedFiles} staged file${l.scannedFiles === 1 ? '' : 's'} scanned · ${l.unscanned.length} unscanned` : '';
    L.push(`  ${l.lane}  ran${extra} · ${l.findings.length} added secret${l.findings.length === 1 ? '' : 's'}`);
    for (const f of l.findings) L.push(`    ${f.file}:${f.line}${f.col ? `:${f.col}` : ''}  ${f.cls}${f.match ? `  ${f.match}` : ''}`);
    for (const f of l.existing || []) L.push(`    already in HEAD, not added by this commit: ${f.file}:${f.line}  ${f.cls} — rotate it`);
    for (const f of l.context || []) L.push(`    SENSITIVE-CONTEXT ${f.file}:${f.line}  ${f.cls}`);
    for (const u of l.unscanned || []) L.push(`    UNSCANNED ${u.file}  ${u.reason}`);
  }
  if (result.verdict === 'blocked-findings') {
    L.push('  Remove the credential from the staged file, re-stage it, and commit again. A credential that');
    L.push('  was ever committed or pushed must be rotated at its issuer as well.');
  }
  if (result.verdict === 'blocked-unrun') {
    L.push('  Install the missing scanner, drop the lane (commitwork hook install --lanes secrets), or');
    L.push('  reinstall with --unrun warn to let commits through marked unchecked.');
  }
  return L.join('\n');
}

// ── install / uninstall ─────────────────────────────────────────────────────────────────────
export function hookText({ node, script, args, chain }) {
  const lines = [
    '#!/bin/sh',
    `# ${HOOK_MARKER} (written by \`commitwork hook install\`; change or remove it with that command, not here).`,
    '# Checks the STAGED content, the index this commit is built from, before the commit lands.',
    `node=${shq(node)}`,
    '[ -x "$node" ] || node="$(command -v node)"',
    `script=${shq(script)}`,
    'if [ -z "$node" ] || [ ! -f "$script" ]; then',
    `  echo "commitwork pre-commit: REFUSED. The check cannot run: node or $script is missing. Nothing was committed." >&2`,
    '  echo "  Reinstall it with commitwork hook install, or remove it with commitwork hook uninstall." >&2',
    '  exit 1',
    'fi',
    `"$node" "$script" run ${args.map(shq).join(' ')} || exit $?`,
  ];
  if (chain) {
    lines.push(
      `# chained: the hook that was here before, kept at ${CHAINED}; uninstall puts it back`,
      `chained="$(dirname "$0")/${CHAINED}"`,
      'if [ ! -x "$chained" ]; then',
      '  echo "commitwork pre-commit: REFUSED. The chained hook $chained is missing or not executable, so it did not run." >&2',
      '  exit 1',
      'fi',
      'exec "$chained" "$@"',
    );
  } else lines.push('exit 0');
  return `${lines.join('\n')}\n`;
}

export const isOurs = (text) => text.includes(HOOK_MARKER);

function hooksDir(repo) {
  return git(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks'], { encoding: 'utf8' }).trim();
}

function hooksPathSetting(repo) {
  const r = spawnSync('git', ['-C', repo, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;   // exit 1 = unset, the only absent case git reports
}

const readIfPresent = (p) => {
  try { return readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
const present = (p) => {
  try { lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
};

/** Returns { code, line }. Never overwrites a hook it did not write: refuses, or with `chain`
 *  moves it aside to CHAINED and runs it after the check. */
export function installHook(opts, { node = process.execPath, script = process.env.CW_HOOK_SCRIPT || join(mainCheckout(resolve(HERE, '..')), 'bin', 'hook.mjs') } = {}) {
  const dir = hooksDir(opts.repo);
  const hook = join(dir, 'pre-commit');
  const chained = join(dir, CHAINED);
  const setting = hooksPathSetting(opts.repo);
  const where = setting ? ` (core.hooksPath ${setting})` : '';
  const existing = readIfPresent(hook);
  const foreign = existing !== null && !isOurs(existing);
  if (foreign && !opts.chain) {
    return { code: EXIT.REFUSED, line: `${hook} exists and was not written by commitwork; left in place. `
      + 'Re-run with --chain to keep it and run it after the commitwork check, or remove it yourself.' };
  }
  if (foreign && present(chained)) {
    return { code: EXIT.REFUSED, line: `${hook} is foreign and ${chained} already exists; refusing to overwrite either.` };
  }
  // a re-install over our own hook keeps an existing chain, or the moved-aside hook would be orphaned
  const chain = foreign || (existing !== null && present(chained));
  const text = hookText({ node, script, args: runArgs(opts), chain });
  if (existing === text) return { code: EXIT.CLEAN, line: `${hook} already installed, unchanged${where}` };
  const verb = foreign ? `chain the existing hook to ${CHAINED} and install` : existing === null ? 'install' : 'replace';
  if (opts.dryRun) return { code: EXIT.CLEAN, line: `DRY RUN — would ${verb} ${hook}${where}` };
  mkdirSync(dir, { recursive: true });
  if (foreign) renameSync(hook, chained);
  try {
    writeAtomic(hook, text, { mode: 0o755 });
  } catch (e) {
    if (foreign) renameSync(chained, hook);
    throw e;
  }
  return { code: EXIT.CLEAN, line: `${foreign ? 'chained the existing hook and installed' : existing === null ? 'installed' : 'replaced'} ${hook}${where} — lanes ${opts.lanes.join(',')}, unrun ${opts.unrun}` };
}

export function uninstallHook(opts) {
  const dir = hooksDir(opts.repo);
  const hook = join(dir, 'pre-commit');
  const chained = join(dir, CHAINED);
  const existing = readIfPresent(hook);
  if (existing === null) {
    return present(chained)
      ? { code: EXIT.REFUSED, line: `no pre-commit hook, but ${chained} exists; move it back to ${hook} yourself` }
      : { code: EXIT.CLEAN, line: `no pre-commit hook in ${dir}` };
  }
  if (!isOurs(existing)) return { code: EXIT.REFUSED, line: `${hook} was not written by commitwork; left in place` };
  const restore = present(chained);
  if (opts.dryRun) return { code: EXIT.CLEAN, line: `DRY RUN — would ${restore ? `restore ${CHAINED} over` : 'remove'} ${hook}` };
  if (restore) renameSync(chained, hook);
  else unlinkSync(hook);
  return { code: EXIT.CLEAN, line: restore ? `removed the commitwork check; restored the chained hook to ${hook}` : `removed ${hook}` };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
const USAGE = `usage: commitwork hook install|uninstall|run [--repo <path>] [--lanes secrets[,gitleaks]]
                       [--unrun block|warn] [--fail-on-context] [--block-existing]
                       [--chain] [--dry-run] [--json]
  exit (run): 0 clean · 20 findings, blocked · 21 a lane could not run (--unrun block) · 2 usage
  exit (install/uninstall): 0 done · 22 refused, a hook commitwork did not write · 2 usage`;

export function main(argv = process.argv.slice(2)) {
  const [sub, ...rest] = argv;
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') { process.stdout.write(`${USAGE}\n`); return sub ? 0 : EXIT.USAGE; }
  let opts;
  try { opts = parseArgs(rest); } catch (e) { process.stderr.write(`commitwork hook: ${e.message}\n${USAGE}\n`); return EXIT.USAGE; }
  try {
    if (sub === 'run') {
      const result = runCheck(opts);
      process.stderr.write(opts.json ? '' : `${render(result)}\n`);
      if (opts.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.exit;
    }
    if (sub === 'install' || sub === 'uninstall') {
      const r = sub === 'install' ? installHook(opts) : uninstallHook(opts);
      (r.code ? process.stderr : process.stdout).write(`commitwork hook ${sub}: ${r.line}\n`);
      return r.code;
    }
  } catch (e) {
    // not a repo, an unreadable hook, a failed rename: a refusal to act, never a silent success
    process.stderr.write(`commitwork hook ${sub}: ${e.message}\n`);
    return sub === 'run' ? EXIT.UNRUN : EXIT.USAGE;
  }
  process.stderr.write(`commitwork hook: unknown subcommand '${sub}'\n${USAGE}\n`);
  return EXIT.USAGE;
}

// exitCode, never process.exit(): a piped stdout would be truncated
if (isMainModule(import.meta.url)) process.exitCode = main();

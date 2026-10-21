// monitor/transcript-secrets.mjs — credentials in the agent's own records. A session transcript
// holds every tool result the agent read, so a token read once lives in ~/.claude/projects until
// the file is deleted, outside every repository scan. This lens runs bin/secrets-sweep's scanner
// over the transcript roots and, where gitleaks is installed, gitleaks as a second witness that
// shares none of its rules.

// Findings are keyed on root, file, class and verdict; a value is never printed, not even
// truncated, and the fingerprints are hashes of the span. An unreadable or oversize file is
// UNSCANNED, stated; a root that is absent is stated; nothing scanned is never clean.
// fact: only shaped credential classes are findings here; high-entropy runs and sensitive context are counted, not reported per file / a transcript carries base64 signatures, request ids and the operator's home path on every line (expiry: never, prev: wrong)
//
//   node monitor/transcript-secrets.mjs [--root <dir>]… [--since <ISO|<n>d|all>] [--json]
//
// env (read at call time): CW_TRANSCRIPT_ROOTS (comma list; default ~/.claude/projects,
//   ~/.codex/sessions, ~/.cursor), CW_TRANSCRIPT_SINCE (default 7d, by mtime), CW_TRANSCRIPT_MAX_BYTES
//   (default 64 MiB), CW_TRANSCRIPT_GITLEAKS (a binary path, or `off`; default `gitleaks` on PATH), CW_NOW
// exit: 0 scanned and no credential · 21 a credential class with the REAL-SECRET verdict, from either
//       witness · 2 a scan failure, or nothing scanned
import { readdirSync, statSync, readFileSync, mkdtempSync, linkSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, relative, basename } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { scanBuffer, VERDICT } from '../bin/secrets-sweep.mjs';
import { sinceMs } from './agent-run-judge.mjs';

export const EXIT = Object.freeze({ clean: 0, secrets: 21, failed: 2 });
export const ENTROPY_CLASS = 'high-entropy';
export const DEFAULT_ROOTS = () => [join(homedir(), '.claude', 'projects'), join(homedir(), '.codex', 'sessions'), join(homedir(), '.cursor')];
const roots = (env) => (env.CW_TRANSCRIPT_ROOTS ? env.CW_TRANSCRIPT_ROOTS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ROOTS());
const maxBytes = (env) => { const n = Number(env.CW_TRANSCRIPT_MAX_BYTES); return Number.isFinite(n) && n > 0 ? n : 64 * 1024 * 1024; };
const TEXT_EXT = /\.(?:jsonl|json|md|txt|log)$/i;

/** Text files under root changed since sinceAt; a directory that cannot be listed is a failure, not an empty one. */
export function listFiles(root, sinceAt) {
  const files = []; const failures = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { failures.push({ file: relative(root, dir).split('\\').join('/') || '.', failure: `${e.code || 'ERROR'}: cannot list` }); return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile() || !TEXT_EXT.test(e.name)) continue;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.mtimeMs >= sinceAt) files.push({ abs: p, rel: relative(root, p).split('\\').join('/'), size: st.size });
    }
  };
  walk(root);
  return { files: files.sort((a, b) => a.rel.localeCompare(b.rel)), failures };
}

/** Scan one root. Values never leave this function: only class, verdict, fingerprint and counts do. */
export function scanRoot(root, { sinceAt, env = process.env } = {}) {
  if (!existsSync(root)) return { root, present: false, files: 0, scanned: 0, unscanned: [], failures: [], findings: [], scannedFiles: [] };
  const { files, failures } = listFiles(root, sinceAt);
  const cap = maxBytes(env);
  const unscanned = []; const grouped = new Map(); const scannedFiles = [];
  const context = {}; let entropyRuns = 0; let placeholders = 0;
  let scanned = 0;
  for (const f of files) {
    if (f.size > cap) { unscanned.push({ file: f.rel, reason: `too-large (${f.size} > ${cap})` }); continue; }
    let buf;
    try { buf = readFileSync(f.abs); } catch (e) { if (e.code === 'ENOENT') { unscanned.push({ file: f.rel, reason: 'vanished' }); continue; } failures.push({ file: f.rel, failure: `${e.code || 'ERROR'}: cannot read` }); continue; }
    const res = scanBuffer(buf, f.rel);
    if (res.unscanned) { unscanned.push({ file: f.rel, reason: res.unscanned }); continue; }
    scanned++; scannedFiles.push({ abs: f.abs, rel: f.rel });
    for (const h of res.findings) {
      if (h.verdict === VERDICT.PLACEHOLDER) { placeholders++; continue; }
      if (h.verdict === VERDICT.CONTEXT) { context[h.cls] = (context[h.cls] || 0) + 1; continue; }
      if (h.cls === ENTROPY_CLASS) { entropyRuns++; continue; }
      const key = `${f.rel}\u0000${h.cls}`;
      const g = grouped.get(key) || { file: f.rel, cls: h.cls, verdict: h.verdict, count: 0, fingerprints: new Set(), firstLine: h.line, ...(h.service ? { service: h.service } : {}) };
      g.count++; g.fingerprints.add(h.fingerprint); g.firstLine = Math.min(g.firstLine, h.line);
      grouped.set(key, g);
    }
  }
  const findings = [...grouped.values()].map((g) => ({ ...g, fingerprints: [...g.fingerprints].sort() }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.cls.localeCompare(b.cls) || a.verdict.localeCompare(b.verdict));
  return { root, present: true, files: files.length, scanned, unscanned, failures, findings, counted: { entropyRuns, placeholders, context }, scannedFiles };
}

// gitleaks reads a directory, so the in-window files are hard-linked into a scratch directory; a
// volume that refuses the link falls back to one run per file. --redact keeps values out of its report.
export function gitleaksWitness(scans, { env = process.env } = {}) {
  const bin = env.CW_TRANSCRIPT_GITLEAKS || 'gitleaks';
  if (bin === 'off') return { tool: 'gitleaks', state: 'off' };
  const probe = spawnSync(bin, ['version'], { encoding: 'utf8' });
  if (probe.error && probe.error.code === 'ENOENT') return { tool: 'gitleaks', state: 'absent' };
  if (probe.error || probe.status !== 0) return { tool: 'gitleaks', state: 'failed', why: probe.error ? probe.error.message : `version exited ${probe.status}` };
  const version = String(probe.stdout || '').trim().split('\n')[0];
  const scratch = mkdtempSync(join(tmpdir(), 'cw-transcript-secrets-'));
  const perFile = new Map(); const errors = [];
  const run = (source, relOf) => {
    const report = join(scratch, `report-${perFile.size}-${Math.random().toString(36).slice(2)}.json`);
    const r = spawnSync(bin, ['detect', '--no-git', '--no-banner', '--redact', '--source', source, '--report-format', 'json', '--report-path', report], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error || (r.status !== 0 && r.status !== 1)) { errors.push(`${basename(source)}: ${r.error ? r.error.message : `exited ${r.status}: ${String(r.stderr || '').trim().slice(0, 200)}`}`); return; }
    let rows = [];
    try { rows = JSON.parse(readFileSync(report, 'utf8')); } catch (e) { errors.push(`${basename(source)}: report unreadable (${e.message})`); return; }
    for (const row of Array.isArray(rows) ? rows : []) {
      const file = relOf(String(row.File || ''));
      const key = `${file}\u0000${row.RuleID}`;
      const g = perFile.get(key) || { file, rule: String(row.RuleID), count: 0 };
      g.count++; perFile.set(key, g);
    }
  };
  try {
    for (const s of scans) {
      const files = s.scannedFiles || [];
      if (!files.length) continue;
      const dir = join(scratch, Buffer.from(s.root).toString('hex').slice(0, 24));
      let linked = true;
      for (const f of files) {
        const target = join(dir, f.rel);
        try { mkdirSync(join(target, '..'), { recursive: true }); linkSync(f.abs, target); } catch { linked = false; break; }
      }
      if (linked) run(dir, (p) => relative(dir, p).split('\\').join('/'));
      else for (const f of files) run(f.abs, () => f.rel);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  const findings = [...perFile.values()].sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + f.count;
  return { tool: 'gitleaks', state: errors.length ? 'failed' : 'ran', version, findings: findings.reduce((n, f) => n + f.count, 0), byRule, perFile: findings, ...(errors.length ? { errors } : {}) };
}

export function runLens({ roots: given = null, since = null, env = process.env, witness = gitleaksWitness } = {}) {
  const now = nowISO(env);
  const spec = since || env.CW_TRANSCRIPT_SINCE || '7d';
  const sinceAt = spec === 'all' ? -Infinity : sinceMs(spec, now);
  const scans = (given && given.length ? given : roots(env)).map((r) => scanRoot(r, { sinceAt, env }));
  const second = witness(scans, { env });
  for (const s of scans) delete s.scannedFiles;
  const findings = scans.flatMap((s) => s.findings.map((f) => ({ root: s.root, ...f })));
  const counted = { entropyRuns: 0, placeholders: 0, context: {} };
  for (const s of scans) if (s.counted) { counted.entropyRuns += s.counted.entropyRuns; counted.placeholders += s.counted.placeholders; for (const [k, v] of Object.entries(s.counted.context)) counted.context[k] = (counted.context[k] || 0) + v; }
  const byClass = {};
  for (const f of findings) byClass[f.cls] = (byClass[f.cls] || 0) + f.count;
  const summary = {
    roots: scans.length, rootsPresent: scans.filter((s) => s.present).length,
    files: scans.reduce((n, s) => n + s.files, 0), scanned: scans.reduce((n, s) => n + s.scanned, 0),
    unscanned: scans.reduce((n, s) => n + s.unscanned.length, 0), failures: scans.reduce((n, s) => n + s.failures.length, 0),
    secrets: findings.reduce((n, f) => n + f.count, 0), byClass, counted, secondWitness: second.state, secondWitnessFindings: second.findings || 0,
  };
  return { generated: now, since: sinceAt === -Infinity ? 'all' : new Date(sinceAt).toISOString(), roots: scans, findings, secondWitness: second, summary };
}

export function exitCodeFor(r) {
  if (r.summary.failures > 0 || r.summary.scanned === 0 || r.secondWitness.state === 'failed') return EXIT.failed;
  if (r.summary.secrets > 0 || (r.secondWitness.findings || 0) > 0) return EXIT.secrets;
  return EXIT.clean;
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const given = []; let since = null;
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--root') given.push(argv[++i]); else if (argv[i] === '--since') since = argv[++i]; }
  const r = runLens({ roots: given, since });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    const s = r.summary;
    console.log(`transcript-secrets: ${s.scanned} file(s) scanned of ${s.files} in ${s.rootsPresent}/${s.roots} root(s) since ${r.since}; ${s.unscanned} unscanned, ${s.failures} failure(s)`);
    for (const root of r.roots) if (!root.present) console.log(`  root absent: ${root.root}`);
    console.log(`  ${VERDICT.SECRET} ${s.secrets} ${JSON.stringify(s.byClass)} · counted, not reported per file: ${s.counted.entropyRuns} high-entropy run(s), ${s.counted.placeholders} placeholder(s), context ${JSON.stringify(s.counted.context)}`);
    for (const f of r.findings) console.log(`  ${f.cls.padEnd(34)} ×${f.count}  ${f.root}/${f.file} (first at line ${f.firstLine})`);
    const w = r.secondWitness;
    console.log(`  second witness gitleaks: ${w.state}${w.version ? ` ${w.version}` : ''}${w.state === 'ran' ? ` — ${w.findings} finding(s)${w.findings ? ` ${JSON.stringify(w.byRule)}` : ''}` : ''}${w.why ? ` (${w.why})` : ''}${w.errors ? ` errors: ${w.errors.join('; ')}` : ''}`);
    for (const f of w.perFile || []) console.log(`  gitleaks ${f.rule.padEnd(28)} ×${f.count}  ${f.file}`);
    for (const root of r.roots) for (const u of root.unscanned.slice(0, 10)) console.log(`  unscanned: ${root.root}/${u.file} — ${u.reason}`);
    if (!s.scanned) console.log('  nothing scanned: a clean box is not what this means');
  }
  process.exitCode = exitCodeFor(r);
}

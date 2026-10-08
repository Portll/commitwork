#!/usr/bin/env node
// bin/secrets-canary.mjs — plant known secrets, run the REAL scanner, score class AND count.
//
// secrets-sweep-fixture: every credential in this file is synthetic and authenticates to nothing.
// Read by bin/secrets-sweep.mjs (see FIXTURE_MARKER). It downgrades this file's planted keys to
// FALSE-POSITIVE/declared-fixture; it does not hide them — they are still found, still counted, and
// this file is listed by name under DECLARED FIXTURES in every report. The pre-publish gate ignores
// the declaration entirely.
//
// Assertion is class AND count, never "nonzero" — a missing class is a false clean an exit code
// cannot see. Isolation: every scenario lives under a fresh mkdtemp via CW_SECRETS_ROOT; the live
// tree is never touched. Plants are synthesized at run time, never committed as fixtures — the
// injection corpus stays out of agents' default context.
//
// usage:
//   node bin/secrets-canary.mjs                 # run all scenarios, print the scorecard
//   node bin/secrets-canary.mjs --json
//   node bin/secrets-canary.mjs --only S-MIXED
//   node bin/secrets-canary.mjs --write         # ALSO append adjudications to the LIVE ledger
//                                               # (kind:'adjudication' — truth by construction).
//                                               # Dry by default.
//
// exit codes — the only thing a scheduled caller sees, so each failure gets its own:
//   0  every scenario scored correct
//   1  a false ALARM (a class or count came back HIGHER than planted — wrong, but loud-wrong)
//   2  a false CLEAN — a planted secret was not reported. The failure this instrument exists for.
//   3  the scanner could not be run at all (a broken instrument is not a passing one)
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { journal } from './lib/verdict-journal-core.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SCANNER = join(REPO, 'bin', 'secrets-sweep.mjs');
const GATE = 'secrets-sweep';

// ── the plants ──────────────────────────────────────────────────────────────────────────────
// Synthesized shapes: right prefix, right length, no account behind any of them. Generated from a
// fixed seed so a scorecard is comparable between runs, and so a failure can be reproduced.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function synth(n, seed) {
  let s = '';
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; s += ALPHABET[x % ALPHABET.length]; }
  return s;
}
const hex = (n, seed) => {
  let s = '';
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; s += '0123456789abcdef'[x % 16]; }
  return s;
};

/** cls → a line that must produce exactly one finding of that class. */
export const PLANTS = {
  'provider-key/aws': () => `aws_key = "AKIA${synth(16, 41).toUpperCase().replace(/[^A-Z0-9]/g, '7')}"`,
  'provider-key/github': () => `gh: ghp_${synth(36, 11)}`,
  'provider-key/google': () => `maps: AIza${synth(35, 7)}`,
  'provider-key/slack': () => `bot: xoxb-2419081273-4471928374615-${synth(24, 37)}`,
  'provider-key/twilio': () => `sid: SK${hex(32, 53)}`,
  // The class both off-the-shelf scanners missed on 2026-08-20, and the reason all of this exists.
  'credential-url/dsn-userinfo': () => `dsn: https://${hex(32, 43)}@ingest.example.net/7`,
  'credential-url/userinfo-password': () => `db: postgres://svcacct:${synth(14, 61)}@db.example.test:5432/app`,
  // nosemgrep: generic.secrets.security.detected-jwt-token.detected-jwt-token -- synthetic test value, not a credential
  jwt: () => 'session: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ik5vYm9keSJ9.q3TmpRs9k7Vd2XcF8bLn4WgYuHz1ApQeR6MjNsK0iCo',
  'private-key': () => '-----BEGIN OPENSSH PRIVATE KEY-----',
  'bearer-credential': () => `curl -H 'Authorization: Bearer ${synth(32, 67)}'`,
  'high-entropy': () => `blob=${synth(34, 71)}`,
};

/** Lines that must produce NO credential finding. A canary that only plants secrets measures half. */
export const DECOYS = [
  'verified-against: 2026-08-20 8e425ff79c7c294266f1a4093c553d06af472609',
  '"digest": "57c0c455d8387d98c1c911b2508f888b869fa54df4c06e1c2207db65924b5546"',
  'password: body.password',
  'clientSecret: OAUTH_ENV.GOOGLE_OAUTH_CLIENT_SECRET',
  'const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";',
  'void methodArgumentNotValidReturns422WithFieldErrors() {}',
  'see https://alice@example.org/notes',
  'id: c9c61b6c-dbeb-44b2-8907-55acb218da7c',
];

// ── scenarios ───────────────────────────────────────────────────────────────────────────────
// `expect` is a class → count map. Anything the scanner reports outside it, or short of it, is a
// scored failure with a direction.
const SCENARIOS = [
  {
    id: 'S-EACH',
    what: 'one plant per class, one per file — every rule must fire exactly once',
    build: (root) => {
      const dir = join(root, 'plants');
      mkdirSync(dir, { recursive: true });
      let i = 0;
      for (const [cls, make] of Object.entries(PLANTS)) {
        writeFileSync(join(dir, `p${String(i++).padStart(2, '0')}.md`), `# evidence\n${make()}\n`);
      }
      return Object.fromEntries(Object.keys(PLANTS).map((c) => [c, 1]));
    },
  },
  {
    id: 'S-MIXED',
    what: 'every plant in ONE file, interleaved with decoys that must stay quiet',
    build: (root) => {
      const lines = ['# mixed evidence'];
      for (const make of Object.values(PLANTS)) { lines.push(make()); lines.push(DECOYS[lines.length % DECOYS.length]); }
      for (const d of DECOYS) lines.push(d);
      mkdirSync(join(root, 'plants'), { recursive: true });
      writeFileSync(join(root, 'plants', 'all.md'), `${lines.join('\n')}\n`);
      return Object.fromEntries(Object.keys(PLANTS).map((c) => [c, 1]));
    },
  },
  {
    id: 'S-DECOYS',
    what: 'decoys ONLY — a clean tree must score clean, or every count above is meaningless',
    build: (root) => {
      mkdirSync(join(root, 'plants'), { recursive: true });
      writeFileSync(join(root, 'plants', 'decoys.md'), `${DECOYS.join('\n')}\n`);
      return {};
    },
  },
  {
    id: 'S-DUP',
    what: 'the same DSN planted three times across three files — count, not just class',
    build: (root) => {
      const dir = join(root, 'plants');
      mkdirSync(dir, { recursive: true });
      const line = PLANTS['credential-url/dsn-userinfo']();
      for (const n of ['a', 'b', 'c']) writeFileSync(join(dir, `${n}.md`), `evidence:\n${line}\n`);
      return { 'credential-url/dsn-userinfo': 3 };
    },
  },
  {
    id: 'S-DECLARED',
    what: 'a declared fixture must be DOWNGRADED and still listed — a suppression that is visible',
    build: (root) => {
      const dir = join(root, 'plants');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'corpus.md'), `# secrets-sweep-fixture: synthetic\n${PLANTS['provider-key/aws']()}\n`);
      writeFileSync(join(dir, 'real.md'), `${PLANTS['provider-key/github']()}\n`);
      return { 'provider-key/github': 1 };
    },
    alsoExpect: (result) => {
      if (!result.fixtureFiles.includes('plants/corpus.md')) return 'the declaring file was not listed by name';
      const d = result.findings.find((f) => f.file === 'plants/corpus.md');
      if (!d) return 'the declared fixture was dropped entirely instead of downgraded';
      if (d.reason !== 'declared-fixture') return `downgrade reason was ${d.reason}, not declared-fixture`;
      return null;
    },
  },
];

// ── running ─────────────────────────────────────────────────────────────────────────────────
function runScanner(root) {
  let stdout = '';
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [SCANNER, '--paths', 'plants', '--json'], {
      cwd: REPO, encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, CW_SECRETS_ROOT: root },
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : -1;
    stdout = String(e.stdout || '');
  }
  let result = null;
  try { result = JSON.parse(stdout); } catch { result = null; }
  return { code, result };
}

/** Score one observation against planted truth. MISS (false clean) and EXTRA (false alarm)
 * stay separate — averaging them would hide the only one that matters. */
export function scoreCounts(expect, observed) {
  const misses = [];
  const extras = [];
  for (const cls of new Set([...Object.keys(expect), ...Object.keys(observed)])) {
    const want = expect[cls] || 0;
    const got = observed[cls] || 0;
    if (got < want) misses.push({ cls, want, got });
    else if (got > want) extras.push({ cls, want, got });
  }
  misses.sort((a, b) => a.cls.localeCompare(b.cls));
  extras.sort((a, b) => a.cls.localeCompare(b.cls));
  return { ok: misses.length === 0 && extras.length === 0, misses, extras };
}

export function runScenario(s) {
  const root = mkdtempSync(join(tmpdir(), `cw-canary-${s.id}-`));
  try {
    const expect = s.build(root);
    const { code, result } = runScanner(root);
    if (!result) {
      return { id: s.id, what: s.what, verdict: 'instrument-broken', expect, observed: {},
               note: `scanner produced no parseable JSON (exit ${code})`, misses: [], extras: [] };
    }
    if (result.failures.length) {
      return { id: s.id, what: s.what, verdict: 'instrument-broken', expect, observed: {},
               note: `scanner reported ${result.failures.length} scan failures`, misses: [], extras: [] };
    }
    const observed = {};
    for (const f of result.findings) {
      if (f.verdict !== 'REAL-SECRET') continue;
      observed[f.cls] = (observed[f.cls] || 0) + 1;
    }
    const { ok, misses, extras } = scoreCounts(expect, observed);
    let note = null;
    if (ok && s.alsoExpect) note = s.alsoExpect(result);
    const verdict = note ? 'wrong-shape'
      : misses.length ? 'false-clean'
      : extras.length ? 'false-alarm'
      : 'correct';
    return { id: s.id, what: s.what, verdict, expect, observed, misses, extras, note };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const EXIT = { correct: 0, 'false-alarm': 1, 'false-clean': 2, 'wrong-shape': 1, 'instrument-broken': 3 };

export function main(argv = process.argv.slice(2)) {
  const only = [];
  let json = false;
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--write') write = true;
    else if (a === '--only') { const v = argv[++i]; if (v) only.push(...v.split(',').map((s) => s.trim())); }
    else if (a === '--help' || a === '-h') { process.stdout.write(`${HELP}\n`); return 0; }
    else { process.stderr.write(`unknown flag: ${a}\n\n${HELP}\n`); return 3; }
  }
  const unknown = only.filter((id) => !SCENARIOS.some((s) => s.id === id));
  if (unknown.length) { process.stderr.write(`unknown scenario(s): ${unknown.join(', ')}\n`); return 3; }

  const chosen = only.length ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
  const results = chosen.map(runScenario);

  // Worst verdict wins the exit code.
  const worst = results.reduce((w, r) => Math.max(w, EXIT[r.verdict] ?? 3), 0);

  if (write) {
    for (const r of results) {
      const res = journal(GATE, {
        kind: 'adjudication', canary: r.id, verdict: r.verdict,
        truth: 'by-construction', expect: r.expect, observed: r.observed,
        misses: r.misses, extras: r.extras, note: r.note ?? null,
      }, { session: 'secrets-canary' });
      // A ledger that refuses the write is not a ledger that recorded it. Say so; do not pretend.
      if (!res.ok) process.stderr.write(`secrets-canary: ledger write refused for ${r.id}: ${res.error}\n`);
    }
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ results, worst, wrote: write }, null, 2)}\n`);
    return worst;
  }
  const L = [`secrets-canary — ${results.length} scenario(s), truth by construction`, ''];
  for (const r of results) {
    L.push(`${r.verdict === 'correct' ? '✔' : '✖'} ${r.id}  ${r.verdict}`);
    L.push(`    ${r.what}`);
    for (const m of r.misses) L.push(`    MISS   ${m.cls}: planted ${m.want}, reported ${m.got}  ← false clean`);
    for (const x of r.extras) L.push(`    EXTRA  ${x.cls}: planted ${x.want}, reported ${x.got}`);
    if (r.note) L.push(`    NOTE   ${r.note}`);
  }
  L.push('');
  L.push(`exit ${worst}  (0 correct · 1 false alarm · 2 FALSE CLEAN · 3 instrument broken)`);
  process.stdout.write(`${L.join('\n')}\n`);
  return worst;
}

const HELP = `commitwork secrets-canary — plant known secrets, score the scanner's class AND count

  node bin/secrets-canary.mjs [--only <ID>[,<ID>…]] [--json] [--write]

  scenarios: ${SCENARIOS.map((s) => s.id).join(', ')}
  exit: 0 correct · 1 false alarm · 2 FALSE CLEAN · 3 instrument broken`;

export { SCENARIOS };

// exitCode, not exit(): process.exit() truncates async piped stdout.
if (isMainModule(import.meta.url)) process.exitCode = main();

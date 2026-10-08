#!/usr/bin/env node
// monitor/secret-verify.mjs — turn a gitleaks CANDIDATE into a verified/refuted/unknown verdict.
//
// fact: gitleaks is a regex-and-entropy detector with no verifier, no network call and no way to say whether the string it matched is a LIVE credential / its extractor said so in its own comment and published 2,368 rows at HIGH anyway — zero of them carrying a verification field (100-repo corpus, 2026-08-24) while the sibling TruffleHog lane, which does verify, found exactly 3 live credentials in the whole fleet (expiry: never, prev: broken)
// fact: a detector that grades nothing must not emit the second-highest severity — that is unsupported finding (expiry: never, prev: broken)
//
// WHAT IT DOES. TruffleHog already ships verifiers for hundreds of credential types and is already
// installed for the secretsHistory lane. This feeds gitleaks' candidate strings to those verifiers
// and returns a THREE-STATE verdict per candidate:
//
//   verified: true   the issuing service confirmed the credential is live      -> crit
//   verified: false  a verifier ran and the service refused it                 -> low
//   verified: null   no verifier exists for this pattern, or none could run    -> UNDETERMINED
//
// The third state is the common one and it is not a failure. `generic-api-key` — the rule carrying
// 51 of 70 affected repos — names no service, so there is nothing to ask. `null` must never be
// collapsed into either of the other two.
//
// fact: verification is impossible without sending the candidate to the issuing service, so this module handles REAL credentials by design (operator ruling 2026-08-24) and the rules below are not optional (expiry: never, prev: unknown)
// fact: candidates go to a 0700 temp dir under the OS temp root, NEVER under reports/, at 0600, removed in a `finally` including on throw (expiry: never, prev: broken)
// fact: NOTHING returned from here carries the secret — the join key is a salted hash whose salt is PER-INVOCATION, so it cannot be correlated across runs or rainbow-tabled (expiry: never, prev: broken)
// fact: the boundary is this function and not a caller / rollup.json is served over the published tunnel, so a secret reaching a return value here reaches the network (expiry: never, prev: broken)
//
// DETERMINISM. `CW_NOW` is honoured for the stamp. The salt is random by necessity — a fixed salt
// would make the hashes correlatable, which is the thing being prevented — so callers that need
// byte-identical output across runs must not persist the keys, only the verdicts.

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { isMainModule } from '../lib/is-main.mjs';

/** Per-invocation salt. Never persisted, never returned. */
const newSalt = () => randomBytes(16).toString('hex');

/** The join key for a candidate: salted, so it identifies without disclosing. */
export const candidateKey = (secret, salt) =>
  createHash('sha256').update(`${salt}:${String(secret ?? '')}`).digest('hex').slice(0, 16);

/** Normalize a secret for a cross-tool join: strip all whitespace. gitleaks reports the matched
 *  SUBSTRING and TruffleHog reports its own Raw/RawV2 of the SAME credential; for a PEM key the two
 *  differ only by a trailing newline (measured on webstudio: 240 vs 241 bytes) — byte-equality
 *  misses it and grades a live key `undetermined`, defeating the whole verify pass. */
const _norm = (s) => String(s ?? '').replace(/\s+/g, '');

/** True when `secret` matches any raw string in `raws`, tolerant of whitespace and of one tool
 *  capturing a sub/superstring of the other. Exact normalized equality always counts; containment
 *  counts only when BOTH sides are long enough (>=24) that a coincidental substring is implausible —
 *  a short token must never verify by sitting inside a longer, unrelated raw. */
export function rawMatches(secret, raws) {
  const s = _norm(secret); if (!s) return false;
  for (const r of raws) {
    const n = _norm(r); if (!n) continue;
    if (n === s) return true;
    if (s.length >= 24 && n.length >= 24 && (n.includes(s) || s.includes(n))) return true;
  }
  return false;
}

/**
 * Parse TruffleHog's JSON-lines output into a set of VERIFIED raw strings.
 * Deliberately narrow: only `Verified === true` counts. TruffleHog emits unverified detections too,
 * and reading those as "attempted and refused" would be wrong — it does not distinguish
 * "verifier ran and the service said no" from "no verifier for this detector".
 */
export function verifiedRawSet(stdout) {
  const out = new Set();
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim(); if (!t) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }   // banners interleave with JSON
    if (o && o.Verified === true) {
      for (const k of ['Raw', 'RawV2']) if (typeof o[k] === 'string' && o[k]) out.add(o[k]);
    }
  }
  return out;
}

/**
 * Which detectors TruffleHog reported at all, verified or not. A candidate whose string appears
 * here was SEEN by a verifier; one that does not appear was never a candidate any verifier knew.
 * That is the difference between `false` and `null`, and it cannot be recovered any other way.
 */
export function seenRawSet(stdout) {
  const out = new Set();
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim(); if (!t) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    if (!o || o.Verified === undefined) continue;
    for (const k of ['Raw', 'RawV2']) if (typeof o[k] === 'string' && o[k]) out.add(o[k]);
  }
  return out;
}

/**
 * Verify candidates. `run(dir)` is injected — it must execute a verifying scanner over `dir` and
 * return its stdout. Injected rather than hard-wired so the whole verdict path is testable without
 * a network call or a real credential.
 *
 * @param {Array<{secret:string, rule?:string, file?:string, line?:number}>} candidates
 * @returns {{verdicts: Array<{key:string, rule:string, file:string, line:number, verified:boolean|null}>,
 *            attempted:number, verified:number, refuted:number, unknown:number, ran:boolean}}
 */
export function verifyCandidates(candidates, { run, salt = newSalt() } = {}) {
  const list = (candidates || []).filter((c) => c && typeof c.secret === 'string' && c.secret.length);
  const base = { verdicts: [], attempted: 0, verified: 0, refuted: 0, unknown: 0, ran: false };
  if (!list.length || typeof run !== 'function') return base;

  let dir = null; let stdout = '';
  try {
    dir = mkdtempSync(join(tmpdir(), 'cw-secret-verify-'));
    // 0700 on the directory and 0600 on every file: this tree holds live credentials for the
    // duration of one scan and must not be readable by another user on a shared host.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    list.forEach((c, i) => {
      // One candidate per file. Batching them into one file makes a verifier's line attribution
      // ambiguous, and an ambiguous verdict on a credential is worse than no verdict.
      writeFileSync(join(dir, `c${i}.txt`), c.secret, { mode: 0o600 });
    });
    stdout = String(run(dir) ?? '');
  } catch {
    // Fail closed: an error during verification yields UNKNOWN for everything, never "refuted".
    // Reporting a credential as dead because the verifier crashed is the whole defect, inverted.
    return { ...base, verdicts: list.map((c) => ({ ...meta(c), key: candidateKey(c.secret, salt), verified: null })), unknown: list.length };
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  const ok = verifiedRawSet(stdout);
  const seen = seenRawSet(stdout);
  const verdicts = list.map((c) => {
    const verified = rawMatches(c.secret, ok) ? true : (rawMatches(c.secret, seen) ? false : null);
    return { ...meta(c), key: candidateKey(c.secret, salt), verified };
  });
  return {
    verdicts,
    attempted: list.length,
    ran: true,
    verified: verdicts.filter((v) => v.verified === true).length,
    refuted: verdicts.filter((v) => v.verified === false).length,
    unknown: verdicts.filter((v) => v.verified === null).length,
  };
}

/** Provenance only — never the secret. */
const meta = (c) => ({ rule: String(c.rule || ''), file: String(c.file || ''), line: Number(c.line) || 0 });

/**
 * Severity for a verification verdict. THE POINT OF THE WHOLE MODULE.
 * `null` returns no severity at all — the caller must place it in `undetermined`, outside
 * crit/high/med/low, because a bucket is an assertion and there is nothing here to assert.
 */
export function severityFor(verified) {
  if (verified === true) return 'crit';    // a live credential in a public repo
  if (verified === false) return 'low';    // committed credential material, refused by its service
  return null;                             // undetermined — NOT high, which is what shipped before
}

/**
 * Candidates from an UNREDACTED gitleaks report. Returns [] for a redacted one rather than
 * pretending — the published `gitleaks.json` runs with `--redact`, so every `Secret` in it is the
 * literal string "REDACTED" and there is nothing to verify. Discovering that late is how a
 * verification pass ends up reporting "0 verified" and being believed.
 */
export function candidatesFrom(report) {
  const arr = Array.isArray(report) ? report : (report && report.findings) || [];
  return arr
    .filter((f) => f && typeof f.Secret === 'string' && f.Secret && !/^REDACTED$/i.test(f.Secret))
    .map((f) => ({ secret: f.Secret, rule: String(f.RuleID || ''), file: String(f.File || ''), line: Number(f.StartLine) || 0 }));
}

/** True when the report is redacted — i.e. this pass cannot verify anything and must say so. */
export const isRedacted = (report) => {
  const arr = Array.isArray(report) ? report : (report && report.findings) || [];
  return arr.length > 0 && arr.every((f) => /^REDACTED$/i.test(String(f && f.Secret)));
};

// ── #3 ENCRYPTED CONTAINER AWARENESS ───────────────────────────────────────────────────────────
// A committed key file is a LEAK only if the key material is usable. An encrypted PEM or a
// password-protected PKCS#12 (.pfx/.p12) whose password is NOT in the repo is a CONTAINER, not an
// exposed credential — the Magpie case, a signing cert whose password was a build-time arg. The
// mirror case is the dangerous one: when the passphrase IS committed beside the key (ragflow ships
// conf/private.pem AND the literal passphrase `Welcome` in api/utils/crypt.py), the encryption is
// defeated by the same clone and the finding should ESCALATE, not relax.

/** 'encrypted' | 'plaintext' | '' — read straight from the PEM armor. `Proc-Type: 4,ENCRYPTED`
 *  and `DEK-Info` are the classic (SSLeay) encrypted form; `BEGIN ENCRYPTED PRIVATE KEY` is the
 *  PKCS#8 form. A bare `BEGIN … PRIVATE KEY` is plaintext and usable as-is. */
export function keyEncryption(text) {
  const t = String(text || '');
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(t) || /Proc-Type:\s*4,ENCRYPTED/.test(t) || /^DEK-Info:/m.test(t)) return 'encrypted'; // gitleaks:allow — the detector's own armor patterns
  if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/.test(t)) return 'plaintext';
  return '';
}

/** A rule/file that denotes a private-key CONTAINER, whose exposure depends on encryption + where
 *  the password lives — as opposed to a bearer token, which is exposed the instant it is readable. */
export function isKeyContainer(rule, file) {
  return /private-key|pkcs12|pkcs8|rsa|keystore/i.test(String(rule || '')) || /\.(pfx|p12|pem|key|jks|keystore)$/i.test(String(file || ''));
}

// ── #4 SHARED-STATIC-KEY DETECTION ─────────────────────────────────────────────────────────────
// A committed key that the application's own NON-TEST source reads at a fixed path is a different,
// systemically worse finding than a stray leaked artifact: it is a shared secret baked into every
// deployment (ragflow's conf/private.pem, read by api/utils/crypt.py on every login). This
// distinguishes "someone leaked a key" from "the design ships one key for everyone".

const _TEST_SRC = /(^|\/)(test|tests|spec|specs|__tests__|testdata|fixtures?|examples?|samples?|mocks?|docs?)\//i;

/** Non-test source files (from `sources`, a map of relPath -> text) that reference `keyBasename`.
 *  A pure function so the correlation is unit-testable without a repo on disk. */
export function sharedStaticRefs(keyBasename, sources) {
  const base = String(keyBasename || ''); if (!base) return [];
  const hits = [];
  for (const [rel, text] of Object.entries(sources || {})) {
    if (_TEST_SRC.test(rel)) continue;
    if (String(text || '').includes(base)) hits.push(rel);
  }
  return hits.sort();
}

export default { verifyCandidates, verifiedRawSet, seenRawSet, candidateKey, severityFor, candidatesFrom, isRedacted, rawMatches, keyEncryption, isKeyContainer, sharedStaticRefs };

// ---- CLI ---------------------------------------------------------------------------------------
// usage: node monitor/secret-verify.mjs --repo <dir> --out <reportDir>
//
// Runs gitleaks WITHOUT --redact into a private 0700 temp, verifies the candidates through
// TruffleHog, writes <reportDir>/gitleaks-verify.json (verdicts only, never a secret), and shreds
// the temp. The published gitleaks.json is untouched and stays redacted — the unredacted copy
// exists only inside this process's temp dir and only for the duration of the verify.
if (isMainModule(import.meta.url)) {
  const { execFileSync } = await import('node:child_process');
  const { readFileSync, writeFileSync: wf } = await import('node:fs');
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const repo = arg('--repo'); const out = arg('--out');
  if (!repo || !out) { process.stderr.write('usage: secret-verify.mjs --repo <dir> --out <reportDir>\n'); process.exit(2); }

  const stamp = process.env.CW_NOW || new Date().toISOString();
  const write = (o) => wf(join(out, 'gitleaks-verify.json'), `${JSON.stringify({ at: stamp, ...o }, null, 2)}\n`);
  let tmp = null;
  try {
    tmp = mkdtempSync(join(tmpdir(), 'cw-gl-unredacted-'));
    const raw = join(tmp, 'gitleaks.json');
    // Same config and bounds as the published pass, minus --redact. A DIFFERENT scope here would
    // verify a different set than the one being graded, which is worse than not verifying.
    try {
      execFileSync('gitleaks', ['detect', '--no-git', '--source', repo,
        ...(process.env.CW_ROOT ? ['--config', join(process.env.CW_ROOT, 'manifests', 'gitleaks.toml')] : []),
        '--max-target-megabytes', '50', '--report-format', 'json', '--report-path', raw],
      { stdio: 'ignore', timeout: 600_000 });
    } catch { /* gitleaks exits 1 when it finds leaks — the report is still written */ }

    let report = []; try { report = JSON.parse(readFileSync(raw, 'utf8')); } catch { report = []; }
    if (isRedacted(report)) { write({ ran: false, reason: 'gitleaks report is redacted — nothing to verify', verdicts: [] }); process.exit(0); }
    const cands = candidatesFrom(report);
    if (!cands.length) { write({ ran: true, attempted: 0, verified: 0, refuted: 0, unknown: 0, verdicts: [] }); process.exit(0); }

    const r = verifyCandidates(cands, {
      run: (dir) => execFileSync('trufflehog', ['filesystem', dir, '--json', '--no-update'],
        { encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 * 1024 }),
    });

    // #3/#4 enrichment. verifyCandidates preserves order, so cands[i] is verdicts[i]. The secret
    // never leaves this block — only the derived classification (container encryption, whether the
    // app's own non-test source reads the key at a fixed path) is written to the sidecar.
    const rel = (p) => (p && p.startsWith(repo) ? p.slice(repo.length).replace(/^[\\/]/, '') : String(p || ''));
    const enrich = (v, c) => {
      if (!c || !isKeyContainer(c.rule, c.file)) return v;
      const container = keyEncryption(c.secret) || (/\.(pfx|p12|jks|keystore)$/i.test(c.file) ? 'encrypted' : '');
      const base = String(c.file || '').split(/[\\/]/).pop();
      let refs = [];
      if (base) {
        try {
          const g = execFileSync('grep', ['-rlI', '--exclude-dir=.git', '--exclude-dir=node_modules', '--fixed-strings', base, repo],
            { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
          const relKey = rel(c.file);
          refs = sharedStaticRefs(base, Object.fromEntries(
            g.split('\n').map((s) => s.trim()).filter(Boolean).map((p) => [rel(p), base]) // presence, not content — grep already matched
          )).filter((f) => f !== relKey);
        } catch { /* grep exits 1 on no match; refs stays [] */ }
      }
      return { ...v, ...(container ? { container } : {}), ...(refs.length ? { sharedStatic: true, sharedStaticRefs: refs.slice(0, 5) } : {}) };
    };
    const verdicts = r.verdicts.map((v, i) => enrich(v, cands[i]));
    write({ ran: r.ran, attempted: r.attempted, verified: r.verified, refuted: r.refuted, unknown: r.unknown, verdicts });
  } catch (e) {
    // Fail closed and SAY SO. A verify pass that dies silently leaves every row undetermined, which
    // is the correct grade — but a reader must be able to tell "no verifier ran" from "asked, no answer".
    write({ ran: false, reason: String(e && e.message).slice(0, 200), verdicts: [] });
  } finally {
    if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
}

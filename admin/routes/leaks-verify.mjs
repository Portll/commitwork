// admin/routes/leaks-verify.mjs — secondary evidence for a gitleaks row a human already marked
// false-positive. A stated reason ("test fixture", "expired", "rolled") is a claim; this asks
// whether anything ELSE agrees with it, or admits nothing could be asked.
//
// Tiers are monitor/ledger.mjs's, not a second scale: strong / medium / weak, and weak is never
// promoted — there it is 'unconfirmed, not cleaned', here it is 'unverified, not corroborated'.
// A verifier that could not run yields weak/none, which is neither corroboration nor refutation:
// over-reporting a human's judgment as refuted costs the same as rubber-stamping it.
//
// Advisory: writes no annotation, mutates no store.

import { nowISO } from '../../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scannedGit } from '../../bin/lib/git-env.mjs';
import { CW } from '../../monitor/area.mjs';
import { identityFor } from '../../monitor/detail-schema.mjs';
import { findActiveScannerAnnotation } from '../../monitor/annotate-lib.mjs';
import { repoRoot, safeJoin, readContext, scrub } from './leaks-check.mjs';
import { annotationsPathFor } from '../../monitor/store-paths.mjs';

export const TIERS = ['strong', 'medium', 'weak'];
export const REASON_CLASSES = ['rolled', 'expired', 'test-fixture'];
export const TIER_VOCABULARY = 'strong/medium/weak — the tiers monitor/ledger.mjs uses; weak is never promoted';

const CATEGORY = 'secrets';
const MIN_TRACE_TOKEN = 12;

const storePath = () => annotationsPathFor(CW);

// Reason prose -> the one claim we can go and check. Priority order: the decisive verifiers first,
// so "expired token in a fixture" is checked by decoding the token rather than by reading the path.
const REASON_PATTERNS = [
  ['rolled', /\broll(?:ed|ing)\b|\brotat(?:ed|ing|ion)\b|\brepla?ced\b|\bre-?issued\b|\bnew\s+(?:key|token|secret|credential)\b/i],
  ['expired', /\bexpir(?:ed|es|y|ation)\b|\bno longer valid\b|\bpast its\s+ttl\b/i],
  ['test-fixture', /\bfixtures?\b|\btest\s*(?:file|data|path|dir|only|credential|key|value)?\b|\bspec\s+file\b|\bmock(?:ed|s)?\b|\bdummy\b|\bsample\s+(?:data|value|key|token)\b|\bexample\s+(?:key|value|token|credential|secret)\b|\bplaceholder\b/i],
];

export function classifyReason(reason) {
  const text = typeof reason === 'string' ? reason : '';
  for (const [cls, re] of REASON_PATTERNS) if (re.test(text)) return cls;
  return 'unrecognised';
}

const TEST_SEGMENTS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'fixture', 'fixtures',
  'testdata', 'test-data', 'testing', 'mocks', '__mocks__', 'e2e']);

export function isTestPath(relPath) {
  const parts = String(relPath || '').split('/').filter(Boolean);
  if (!parts.length) return false;
  const base = parts.pop();
  if (parts.some((p) => TEST_SEGMENTS.has(p.toLowerCase()))) return true;
  return /(?:^|[.\-_])(?:tests?|specs?|fixtures?)\.[^.]+$/i.test(base);
}

// base64url -> JSON, or null. No signature check: the exp claim is readable without one, and a
// forged exp on a value already judged false-positive is not the risk this answers.
export function decodeJwt(text) {
  const m = /eyJ[A-Za-z0-9_-]{6,}\.([A-Za-z0-9_-]{6,})\.[A-Za-z0-9_-]*/.exec(String(text || ''));
  if (!m) return null;
  try {
    const json = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return (payload && typeof payload === 'object') ? { payload, token: m[0] } : null;
  } catch { return null; }
}

// Published example values. `weight` is the witness's strength, not the finding's: gitleaks
// allowlists AKIAIOSFODNN7EXAMPLE by default, so a row carrying it is already anomalous and the
// string proves little on its own.
export function publishedExample(matchedLine) {
  const line = String(matchedLine || '');
  if (/wJalrXUtnFEMI\/K7MDENG\/bPxRfiCYEXAMPLEKEY/.test(line)) return { id: 'aws-docs-secret-key', weight: 'known' };
  const jwt = decodeJwt(line);
  if (jwt && String(jwt.payload.sub) === '1234567890' && /^(?:John Doe|Nobody)$/.test(String(jwt.payload.name || ''))) {
    return { id: 'jwt.io-example-token', weight: 'known' };
  }
  if (/AKIAIOSFODNN7EXAMPLE/.test(line)) return { id: 'aws-docs-access-key-id', weight: 'default-allowlisted' };
  return null;
}

// ---- verifiers. Each returns { tier, verdict, detail, checks } ---------------------------------
// verdict: 'supports' | 'contradicts' | 'none'. 'none' always carries tier 'weak'.

export function verifyTestFixture({ file, matched }) {
  const onTestPath = isTestPath(file);
  const example = publishedExample(matched);
  const checks = [
    { name: 'test-path', result: onTestPath ? 'pass' : 'fail', detail: onTestPath ? 'a path segment names a test/fixture/spec/testdata directory' : 'no path segment names a test/fixture/spec/testdata directory' },
    { name: 'published-example', result: example ? 'pass' : 'fail', detail: example ? `matches ${example.id} (${example.weight})` : 'the value matches no published example this route knows' },
  ];
  const known = example && example.weight === 'known';
  if (onTestPath && known) return { tier: 'strong', verdict: 'supports', detail: `test path and a published example value (${example.id})`, checks };
  if (onTestPath) return { tier: 'medium', verdict: 'supports', detail: example ? `test path; the only value match is ${example.id}, which gitleaks allowlists by default and which corroborates little` : 'test path; the value matches no published example', checks };
  if (known) return { tier: 'medium', verdict: 'supports', detail: `published example value (${example.id}), but the path is not a test directory`, checks };
  return { tier: 'weak', verdict: 'none', detail: 'neither the path nor the value corroborates a fixture', checks };
}

export function verifyExpired({ matched, now }) {
  const jwt = decodeJwt(matched);
  if (!jwt) return { tier: 'weak', verdict: 'none', detail: 'no decodable JWT on the line; expiry is not checkable locally', checks: [{ name: 'jwt-decode', result: 'unavailable', detail: 'the line carries no three-part JWT' }] };
  const exp = jwt.payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return { tier: 'weak', verdict: 'none', detail: 'the token decoded but carries no numeric exp claim', checks: [{ name: 'jwt-decode', result: 'pass', detail: 'payload decoded' }, { name: 'exp-claim', result: 'unavailable', detail: 'no numeric exp claim' }] };
  }
  const expIso = new Date(exp * 1000).toISOString();
  const past = exp * 1000 < Date.parse(now);
  const checks = [
    { name: 'jwt-decode', result: 'pass', detail: 'payload decoded' },
    { name: 'exp-claim', result: past ? 'pass' : 'fail', detail: `exp ${expIso} vs ${now}` },
  ];
  return past
    ? { tier: 'strong', verdict: 'supports', detail: `exp ${expIso} is before ${now}`, checks }
    : { tier: 'strong', verdict: 'contradicts', detail: `exp ${expIso} is not before ${now} — the token is still within its validity window`, checks };
}

const git = (cwd, args) => {
  // a fleet repo: `log -G` diffs through its textconv under a plain git
  const r = scannedGit(cwd, args, { maxBuffer: 64 * 1024 * 1024 });
  return !r.error && r.status === 0 ? r.stdout : null;
};

// The longest opaque run on the line. It may be an identifier rather than the value; the caveat
// travels in the response instead of being guessed away.
export function traceToken(matchedLine) {
  const toks = String(matchedLine || '').split(/[\s"'`,;(){}[\]<>=]+/).filter((t) => t.length >= MIN_TRACE_TOKEN);
  return toks.sort((a, b) => b.length - a.length)[0] || null;
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Did the value change since the annotation? Two witnesses that fail differently: the file's blob
// as of `at` (does today's value predate the judgment?) and `git log -G` over the interval.
// -G, never -S: -S counts occurrences, so a value that merely MOVED is invisible to it.
export function verifyRolled({ root, file, at, matched, run = git }) {
  const checks = [];
  const token = traceToken(matched);
  if (!token) return { tier: 'weak', verdict: 'none', detail: `no run of ${MIN_TRACE_TOKEN}+ characters on the line to trace through history`, checks: [{ name: 'trace-token', result: 'unavailable', detail: 'nothing long enough to search for' }] };
  checks.push({ name: 'trace-token', result: 'pass', detail: `tracing a ${token.length}-character run from the matched line` });

  if (!root || !run(root, ['rev-parse', '--git-dir'])) {
    checks.push({ name: 'git', result: 'unavailable', detail: 'not a git repository, or git could not run' });
    return { tier: 'weak', verdict: 'none', detail: 'no history to read; the claim could not be checked', checks };
  }
  const when = typeof at === 'string' && at ? at : null;
  if (!when) {
    checks.push({ name: 'annotation-time', result: 'unavailable', detail: 'the annotation carries no `at` timestamp' });
    return { tier: 'weak', verdict: 'none', detail: 'without the annotation time there is no interval to search', checks };
  }
  const shaOut = run(root, ['rev-list', '-1', `--before=${when}`, 'HEAD', '--', file]);
  const sha = (shaOut || '').trim().split('\n').filter(Boolean)[0] || null;
  if (!sha) {
    checks.push({ name: 'blob-at-annotation', result: 'unavailable', detail: `no commit touches ${file} at or before ${when}` });
    return { tier: 'weak', verdict: 'none', detail: 'the file has no committed state as of the annotation', checks };
  }
  const blob = run(root, ['show', `${sha}:${file}`]);
  if (blob === null) {
    checks.push({ name: 'blob-at-annotation', result: 'unavailable', detail: `the blob at ${sha.slice(0, 12)} could not be read` });
    return { tier: 'weak', verdict: 'none', detail: 'the file as of the annotation could not be read', checks };
  }
  const stillThere = blob.includes(token);
  checks.push({ name: 'blob-at-annotation', result: stillThere ? 'fail' : 'pass', detail: stillThere ? `today's value is already present at ${sha.slice(0, 12)}` : `today's value is absent at ${sha.slice(0, 12)}` });

  const log = run(root, ['log', '--format=%H', `-G${reEscape(token)}`, `${sha}..HEAD`, '--', file]);
  const commits = (log || '').split('\n').filter(Boolean);
  checks.push({ name: 'pickaxe-G', result: commits.length ? 'pass' : 'fail', detail: `${commits.length} commit(s) changed this content in ${file} since ${sha.slice(0, 12)} (-G, so a pure move still counts)` });

  if (stillThere) {
    return { tier: 'strong', verdict: 'contradicts', detail: `the value on this line is byte-identical to ${file} as of ${when} — nothing was rolled`, checks };
  }
  if (commits.length) {
    return { tier: 'strong', verdict: 'supports', detail: `the value changed in ${commits.length} commit(s) after ${when}; latest ${commits[0].slice(0, 12)}`, checks };
  }
  return { tier: 'medium', verdict: 'supports', detail: `today's value is absent from ${file} as of ${when}, but no commit in the interval names the change`, checks };
}

// The one place a tier becomes a rendered claim. Weak is terminal in both directions.
export const statusFor = (tier, verdict) => {
  if (tier === 'weak' || verdict === 'none') return 'unverified';
  return verdict === 'supports' ? 'corroborated' : 'refuted';
};

/**
 * Verify one already-annotated row. `line` is evidence only — it addresses the bytes to read and
 * is never part of the row's identity, which is (repo, rule, file).
 */
export function verifyAnnotation({ root, repo, rule, file, line, reason, at, now = nowISO() }) {
  const reasonClass = classifyReason(reason);
  const base = { repo, rule: rule || '', file, reasonClass, reason: typeof reason === 'string' ? reason : '' };

  if (reasonClass === 'unrecognised') {
    return { ...base, status: 'unverified', evidence: { tier: 'weak', detail: 'the stated reason names no claim this route can check' }, checks: [], seenAtLine: line == null ? null : Number(line) };
  }

  let matched = '';
  const wantsValue = reasonClass !== 'test-fixture';
  let readNote = null;
  if (line != null && line !== '') {
    const abs = safeJoin(root, file);
    const r = abs ? readContext(abs, line) : { ok: false, error: 'file escapes its repository root' };
    if (r.ok) matched = r.matched;
    else readNote = r.error;
  } else {
    readNote = 'no line was supplied, so the matched value was never read';
  }

  if (readNote && wantsValue) {
    return { ...base, status: 'unverified',
      evidence: { tier: 'weak', detail: `the value could not be read: ${readNote}` },
      checks: [{ name: 'read-line', result: 'unavailable', detail: readNote }],
      seenAtLine: line == null ? null : Number(line) };
  }

  const out = reasonClass === 'test-fixture' ? verifyTestFixture({ file, matched })
    : reasonClass === 'expired' ? verifyExpired({ matched, now })
      : verifyRolled({ root, file, at, matched });

  const tier = out.verdict === 'none' ? 'weak' : out.tier;
  const checks = readNote ? [{ name: 'read-line', result: 'unavailable', detail: readNote }, ...out.checks] : out.checks;
  return { ...base,
    reason: scrub(base.reason, matched), // caller-authored prose, and it can quote the value
    status: statusFor(tier, out.verdict),
    evidence: { tier, detail: scrub(out.detail, matched) },
    checks: checks.map((c) => ({ ...c, detail: scrub(c.detail, matched) })),
    seenAtLine: line == null ? null : Number(line),
    now };
}

// fail closed: only ENOENT is legitimately absent.
export function loadAnnotations() {
  try {
    const doc = JSON.parse(readFileSync(storePath(), 'utf8'));
    return { ok: true, records: (doc && doc.scannerAnnotations) || [] };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, records: [] };
    return { ok: false, error: `annotations store unreadable (${storePath()}): ${e.message}` };
  }
}

export function findAnnotation(records, { repo, rule, file }, now) {
  const idf = identityFor(CATEGORY);
  const rows = (records || []).filter((a) => a.category === CATEGORY);
  return findActiveScannerAnnotation(rows, { repo, rule: rule || '', file }, now, idf) || null;
}

export const routes = [
  // POST /api/leaks/verify — { repo, rule, file, line?, reason?, at? }
  // reason/at default to the active suppressing annotation for (repo, rule, file).
  { method: 'POST', path: '/api/leaks/verify', handle: (ctx) => {
    const { send, req, readJsonBody } = ctx;
    const s = ctx.adminSession(req);
    if (!s || !s.user) return send(401, { ok: false, error: 'authentication required' });

    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: `bad body: ${err}` });
      const { repo, rule, file, line } = body || {};
      if (!repo || !file) return send(400, { ok: false, error: 'repo and file are required' });

      const root = repoRoot(repo);
      if (!root) return send(404, { ok: false, error: `no resolved repo named '${repo}'` });
      if (!safeJoin(root, file)) return send(400, { ok: false, error: 'file escapes its repository root' });

      const now = nowISO();
      let reason = body.reason, at = body.at, annotation = null;
      if (typeof reason !== 'string' || typeof at !== 'string') {
        const store = loadAnnotations();
        if (!store.ok) return send(503, { ok: false, error: store.error });
        annotation = findAnnotation(store.records, { repo, rule, file }, now);
        if (!annotation) {
          return send(404, { ok: false, error: 'no active false-positive annotation addresses this row — there is no stated reason to verify' });
        }
        reason = annotation.reason;
        at = annotation.at;
      }

      const seenAtLine = (line == null || line === '') ? (annotation && annotation.seenAtLine) : line;
      const result = verifyAnnotation({ root, repo, rule, file, line: seenAtLine, reason, at, now });

      return send(200, { ok: true, ...result,
        annotation: annotation ? { action: annotation.action, who: annotation.who, at: annotation.at, expires: annotation.expires || null } : null,
        vocabulary: TIER_VOCABULARY,
        caveat: 'weak evidence is unverified, never corroborated and never refuted. The rolled check traces the longest opaque run on the line, which may be an identifier.',
        advisory: true });
    });
  } },
];

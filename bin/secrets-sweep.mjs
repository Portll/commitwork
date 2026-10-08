#!/usr/bin/env node
// commitwork secrets-sweep — pattern + entropy + context sweep, the third method beside
// gitleaks/trufflehog (neither carries a DSN/userinfo-URL rule in its default set).
//
// Invariants: explicit uncertainty — an unreadable file is UNSCANNED, never clean, and a run with a
// scan failure can never exit 0; the placeholder test reads the CREDENTIAL substring only, never
// the whole match; bytes are read through Node, never shell grep (a C locale silently suppresses
// matches in UTF-8-dense files).
//
// usage:
//   node bin/secrets-sweep.mjs [--paths <p>[,<p>…]] [--json] [--all] [--fail-on-context]
//                              [--max-bytes <n>]
//
// env (read at CALL time, never at module load):
//   CW_SECRETS_ROOT       root that relative --paths resolve against  (default: repo root)
//   CW_SECRETS_MAX_BYTES  per-file size ceiling; larger files are UNSCANNED, not skipped quietly
//
// exit: 0 clean · 1 findings · 2 scan failure (unreadable input / missing named path / bad usage)
//       A run with any scan failure exits 2 even if it also found secrets, and can never exit 0.
import { looksLikeIdentifier, isPlaceholder, shannon, isRepoDigest } from './lib/secret-heuristics.mjs';

export { looksLikeIdentifier, isPlaceholder, shannon, isRepoDigest };
import { readFileSync, readdirSync, statSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { scannedGitOut } from './lib/git-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

// Env seams are functions — a const at import defeats test overrides.
export const secretsRoot = () => resolve(process.env.CW_SECRETS_ROOT || REPO_ROOT);
export const maxBytes = () => {
  const raw = Number(process.env.CW_SECRETS_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 8 * 1024 * 1024;
};

// ── declared fixture corpora ────────────────────────────────────────────────────────────────
// A file declares itself a synthetic-credential fixture in its first 25 lines — never inferred
// from its path. Declaring files are listed by name in the summary, and --no-fixture-exempt
// ignores declarations entirely (what a pre-publish check runs).
export const FIXTURE_MARKER = 'secrets-sweep-fixture';
const FIXTURE_DECL_LINES = 25;
export const declaresFixture = (lines) =>
  lines.slice(0, FIXTURE_DECL_LINES).some((l) => l.includes(FIXTURE_MARKER));
export const fixtureExempt = () => process.env.CW_SECRETS_NO_FIXTURE_EXEMPT !== '1';

// ── default scope ───────────────────────────────────────────────────────────────────────────
// Every git-tracked file (reports/ is gitignored, so excluded by that). A directory-list fallback
// when git is unavailable would be a false clean — it is a scan failure instead.
export const DEFAULT_PATHS = null;   // null ⇒ tracked-files mode; see resolveTargets()

// ── verdict vocabulary ──────────────────────────────────────────────────────────────────────
// Three words, and the difference between them is who has to act.
export const VERDICT = {
  SECRET: 'REAL-SECRET',            // a credential. Rotate it, then scrub it. In that order.
  CONTEXT: 'SENSITIVE-CONTEXT',     // not a credential; still should not leave the repo.
  PLACEHOLDER: 'FALSE-POSITIVE',    // matched a rule, credential material is demonstrably fake.
};

// ── unscanned reasons ───────────────────────────────────────────────────────────────────────
// Each of these is a state in its own right. None of them is "clean".
export const UNSCANNED = {
  BINARY: 'binary-content',         // a NUL byte in the first 8 KiB
  BINARY_EXT: 'binary-extension',
  TOO_LARGE: 'over-max-bytes',
  VANISHED: 'vanished-mid-walk',    // ENOENT during a walk: it existed when listed, not when read
  NOT_A_FILE: 'not-a-regular-file',
  // Tracked by git, absent from the worktree: deleted-but-not-committed. Not a failure, not
  // clean — --head scans it.
  DELETED: 'deleted-from-worktree',
};

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.pdf', '.zip', '.gz', '.tgz',
  '.bz2', '.xz', '.7z', '.rar', '.jar', '.war', '.class', '.so', '.dylib', '.dll', '.exe', '.bin',
  '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.mov', '.avi', '.webm',
  '.sqlite', '.db', '.pyc', '.o', '.a', '.node',
]);

// Never walked; recorded in the summary — a silently omitted directory is unsupported finding.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.mypy_cache']);


// A UUID is an identifier, not a credential.
export const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// SRI digests (`sha512-<base64>`): public checksums, the base64 half of the hex exclusion —
// package-lock.json alone was 88% of the high-entropy noise without this.
export const isIntegrityDigest = (s) => /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(s);

const ENTROPY_MIN = 3.6;

// Whole-run Shannon entropy cannot tell a key from a slug — delimiters can: a slug/path/UUID is
// short segments joined by -_/. while a credential is one long unbroken run. So the test applies
// to the longest delimiter-free segment.
export const longestSegment = (run) =>
  run.split(/[-_/.+=]+/).reduce((best, seg) => (seg.length > best.length ? seg : best), '');

const SEGMENT_MIN = 20;

export function looksHighEntropy(run) {
  if (run.length < 32) return false;
  if (isRepoDigest(run) || isUuid(run) || isIntegrityDigest(run)) return false;
  const seg = longestSegment(run);
  if (seg.length < SEGMENT_MIN) return false;              // a slug, a path, or a dotted version
  if (isRepoDigest(seg)) return false;
  if (!/[0-9]/.test(seg) || !/[A-Za-z]/.test(seg)) return false; // prose and digit-runs are not keys
  if (looksLikeIdentifier(seg)) return false;              // a camelCase name, not a key
  return shannon(seg) >= ENTROPY_MIN;
}

// ── rules ───────────────────────────────────────────────────────────────────────────────────
// Every rule names the class it belongs to and yields {start, end, secret}. `secret` is the
// credential substring the placeholder test reads; the reported match is the whole span.
//
// Order is precedence order. An earlier rule claims its span, and later rules — high-entropy in
// particular — skip anything already claimed. Without that, one AWS key reports three times.
const RULES = [
  { cls: 'private-key', verdict: VERDICT.SECRET, exempt: true,
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },

  { cls: 'provider-key/aws', verdict: VERDICT.SECRET, re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { cls: 'provider-key/github', verdict: VERDICT.SECRET, re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/g },
  { cls: 'provider-key/github-pat', verdict: VERDICT.SECRET, re: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
  { cls: 'provider-key/stripe', verdict: VERDICT.SECRET, re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { cls: 'provider-key/sk-token', verdict: VERDICT.SECRET, re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9]{1,20}-?[A-Za-z0-9_-]{20,}\b/g },
  { cls: 'provider-key/google', verdict: VERDICT.SECRET, re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { cls: 'provider-key/slack', verdict: VERDICT.SECRET, re: /\bxox[baprse]-[A-Za-z0-9-]{10,}\b/g },
  { cls: 'provider-key/npm', verdict: VERDICT.SECRET, re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { cls: 'provider-key/sendgrid', verdict: VERDICT.SECRET, re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },

  // Families whose credential is an undecorated run (Cloudflare API, Twilio auth) have no shape
  // to key on and are reached via the assignment rule and high-entropy instead.
  { cls: 'provider-key/azure-storage', verdict: VERDICT.SECRET,
    re: /AccountKey=[A-Za-z0-9+/]{80,}={0,2}/g },
  { cls: 'provider-key/azure-sas', verdict: VERDICT.SECRET,
    re: /[?&]sig=[A-Za-z0-9%+/=]{43,}/g },
  { cls: 'provider-key/gcp-service-account', verdict: VERDICT.SECRET, exempt: true,
    re: /"private_key_id"\s*:\s*"[0-9a-f]{40}"|"type"\s*:\s*"service_account"/g },
  { cls: 'provider-key/twilio', verdict: VERDICT.SECRET, re: /\bSK[0-9a-f]{32}\b/g },
  { cls: 'provider-key/cloudflare-origin-ca', verdict: VERDICT.SECRET,
    re: /\bv1\.0-[0-9a-f]{24}-[0-9a-f]{146}\b/g },

  { cls: 'jwt', verdict: VERDICT.SECRET,
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

// Providers whose credential has no distinctive shape, reached through the NAME beside the value.
// `CLOUDFLARE_API_TOKEN=<40 chars of base62>` is identifiable; the 40 chars alone are not.
const NAMED_PROVIDER_RE = [
  { cls: 'provider-key/cloudflare',
    re: /\b(?:CLOUDFLARE|CF)_API_(?:TOKEN|KEY)["']?\s*[:=]\s*["'`]?([A-Za-z0-9_-]{32,})/g },
  { cls: 'provider-key/twilio',
    re: /\bTWILIO_(?:AUTH_TOKEN|API_SECRET)["']?\s*[:=]\s*["'`]?([A-Za-z0-9]{28,})/g },
  { cls: 'provider-key/azure',
    re: /\bAZURE_(?:CLIENT_SECRET|STORAGE_KEY)["']?\s*[:=]\s*["'`]?([A-Za-z0-9~._+/=-]{28,})/g },
  { cls: 'provider-key/gcp',
    re: /\bGOOGLE_(?:APPLICATION_CREDENTIALS_JSON|CLIENT_SECRET)["']?\s*[:=]\s*["'`]?([A-Za-z0-9_.~-]{20,})/g },
];

// ── DSN host naming ─────────────────────────────────────────────────────────────────────────
// Names WHICH service is exposed; an unrecognised host is `unknown-service`, never blank.
const DSN_SERVICES = [
  [/(?:^|\.)glitchtip\.com$/i, 'glitchtip'],
  [/(?:^|\.)sentry\.io$/i, 'sentry'],
  [/(?:^|\.)ingest\.(?:us|de)\.sentry\.io$/i, 'sentry'],
  [/(?:^|\.)datadoghq\.(?:com|eu)$/i, 'datadog'],
  [/(?:^|\.)honeycomb\.io$/i, 'honeycomb'],
  [/(?:^|\.)rollbar\.com$/i, 'rollbar'],
  [/(?:^|\.)bugsnag\.com$/i, 'bugsnag'],
];
const DSN_SCHEMES = {
  postgres: 'postgresql', postgresql: 'postgresql', mysql: 'mysql', mongodb: 'mongodb',
  'mongodb+srv': 'mongodb', redis: 'redis', rediss: 'redis', amqp: 'amqp', amqps: 'amqp',
};
export function dsnService(scheme, host) {
  for (const [re, name] of DSN_SERVICES) if (re.test(host)) return name;
  const byScheme = DSN_SCHEMES[String(scheme).toLowerCase()];
  if (byScheme) return byScheme;
  return 'unknown-service';
}

// A DSN is a URL whose userinfo IS the credential (Sentry/GlitchTip, AMQP, Mongo, Postgres,
// Redis) — the class both off-the-shelf tools miss.
const CREDENTIAL_URL_RE = /\b([a-zA-Z][a-zA-Z0-9+.-]{1,20}):\/\/([^\s/@:"'`<>]{1,256})(?::([^\s/@"'`<>]{0,256}))?@([A-Za-z0-9._-]+)/g;

function credentialUrlHits(line) {
  const out = [];
  CREDENTIAL_URL_RE.lastIndex = 0;
  let m;
  while ((m = CREDENTIAL_URL_RE.exec(line)) !== null) {
    const [full, scheme, user, pass, host] = m;
    if (scheme.toLowerCase() === 'mailto') continue;
    // Two carrying shapes: an explicit password, or a key-shaped "username" (the DSN case).
    const hasPass = pass !== undefined && pass.length > 0;
    const keyShapedUser = user.length >= 16 && /[0-9]/.test(user) && !/^[A-Za-z][A-Za-z._-]*$/.test(user);
    if (!hasPass && !keyShapedUser) continue;
    const secret = hasPass ? pass : user;
    out.push({
      cls: hasPass ? 'credential-url/userinfo-password' : 'credential-url/dsn-userinfo',
      verdict: VERDICT.SECRET,
      start: m.index,
      end: m.index + full.length,
      secret,
      note: `${scheme}://…@${host}`,
      service: dsnService(scheme, host),
    });
  }
  return out;
}

// Assignment/bearer shapes are high-noise: the VALUE must survive the placeholder test and a
// length floor. The quote character is CAPTURED — see isBinding.
const ASSIGNMENT_RE = /\b(api[_-]?key|apikey|secret|secret[_-]?key|token|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|pwd)["']?\s*[:=]\s*(["'`]?)([A-Za-z0-9_$\-./+=]{12,})\2/gi;

// ── literal vs binding ──────────────────────────────────────────────────────────────────────
// An unquoted right-hand side that parses as an identifier, member expression or env name is a
// REFERENCE to a credential, not a secret. A binding is downgraded to FALSE-POSITIVE with
// reason 'binding' — reported, never dropped.
const MEMBER_EXPR_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const BARE_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `quote` is '' when the value was unquoted. A quoted value is a literal by construction. */
export function isBinding(value, quote) {
  if (quote) return false;
  const v = String(value ?? '');
  if (MEMBER_EXPR_RE.test(v)) return true;   // body.password, OAUTH_ENV.GOOGLE_OAUTH_CLIENT_SECRET
  if (ENV_NAME_RE.test(v)) return true;      // CW_TEST_TOKEN, GITHUB_OAUTH_CLIENT_SECRET
  // A bare identifier WITH digits could be either — left to the placeholder/entropy tests.
  if (BARE_IDENT_RE.test(v) && !/[0-9]/.test(v)) return true;
  return false;
}
const BEARER_RE = /\b(?:Authorization|Proxy-Authorization)\s*:\s*(?:Bearer|Token|Basic)\s+([A-Za-z0-9._~+/=-]{16,})/gi;

// ── sensitive context ───────────────────────────────────────────────────────────────────────
// Not credentials; a problem the moment a file leaves the repository.
const CONTEXT_RULES = [
  { cls: 'context/email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    // RFC 2606 reserves example/test/invalid/localhost. An address under them reaches nobody.
    drop: (m) => /@(?:example\.(?:com|org|net)|localhost|test|invalid)$/i.test(m)
              || /\.(?:example|test|invalid|localhost)$/i.test(m)
              || /^(?:noreply|no-reply|users\.noreply)@/i.test(m)
              || /@users\.noreply\.github\.com$/i.test(m) },
  { cls: 'context/home-path', re: /\/(?:Users|home)\/[A-Za-z0-9._-]{2,}/g,
    drop: (m) => /\/(?:runner|user|username|root|ubuntu|node)$/i.test(m) },
  // Loopback excluded; an RFC1918 address with a port is a map of somebody's LAN.
  { cls: 'context/private-ip-port',
    re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d{1,5})\b/g },
  { cls: 'context/keychain-ref',
    re: /security\s+(?:find|add|delete)-generic-password(?:\s+-[a-zA-Z]\s+\S+)+/g },

  // PII rules are ANCHORED on a label or format marker — an unanchored \d{9} matches half of
  // every JSON file in the tree.
  { cls: 'context/phone',
    re: /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g,
    // The label or the leading + is what makes it a phone number rather than a date/version.
    drop: (m, line) => !/^\+/.test(m.trim())
      && !/\b(?:phone|mobile|tel|telephone|fax|contact|call)\b/i.test(line) },
  { cls: 'context/national-id',
    re: /\b(?:ABN|ACN|TFN|SSN|NINO)\b[:\s#]*[\d\s-]{8,15}/gi },
  { cls: 'context/postal-address',
    re: /\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Terrace|Tce|Crescent|Cres|Parade|Pde|Highway|Hwy|Boulevard|Blvd)\b/g },
  // The other half of a targeting package: which door a held key opens.
  { cls: 'context/cloud-account',
    re: /arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:(\d{12}):/g },
  { cls: 'context/cloud-account',
    re: /\b(?:tenant[_-]?id|subscription[_-]?id|TENANT_ID|SUBSCRIPTION_ID)["']?\s*[:=]\s*["']?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi },
];

// ── line scanning ───────────────────────────────────────────────────────────────────────────
const TRUNC = 60;
export const truncate = (s) => {
  const flat = String(s).replace(/\s+/g, ' ');
  return flat.length <= TRUNC ? flat : `${flat.slice(0, TRUNC - 1)}…`;
};

// fact: hashes the full span, not the truncated match (expiry: never, prev: missing)
export const fingerprintOf = (cls, span) => createHash('sha256').update(`${cls}\0${span}`).digest('hex').slice(0, 16);

const overlaps = (claimed, start, end) => claimed.some((c) => start < c.end && end > c.start);

/**
 * @param line     the raw line
 * @param lineNo   1-based
 * @param opts     `fixture` — credential verdicts downgraded with reason 'declared-fixture';
 *                 hits stay visible and counted.
 */
export function scanLine(line, lineNo, { fixture = false } = {}) {
  const hits = [];
  const claimed = [];

  const push = (h) => {
    if (overlaps(claimed, h.start, h.end)) return;
    claimed.push({ start: h.start, end: h.end });

    // Downgrade order = evidence specificity: binding (syntax) beats placeholder (heuristic);
    // declared-fixture ranks last — the only reason a file grants itself.
    let verdict = h.verdict;
    let reason = null;
    if (h.verdict === VERDICT.SECRET && !h.exempt) {
      if (h.binding) { verdict = VERDICT.PLACEHOLDER; reason = 'binding'; }
      else if (isPlaceholder(h.secret)) { verdict = VERDICT.PLACEHOLDER; reason = 'placeholder'; }
      else if (fixture) { verdict = VERDICT.PLACEHOLDER; reason = 'declared-fixture'; }
    } else if (h.verdict === VERDICT.SECRET && h.exempt && fixture) {
      verdict = VERDICT.PLACEHOLDER; reason = 'declared-fixture';
    }

    hits.push({
      line: lineNo,
      col: h.start + 1,
      cls: h.cls,
      verdict,
      ...(reason ? { reason } : {}),
      match: truncate(line.slice(h.start, h.end)),
      fingerprint: fingerprintOf(h.cls, line.slice(h.start, h.end)),
      ...(h.note ? { note: h.note } : {}),
      ...(h.service ? { service: h.service } : {}),
    });
  };

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(line)) !== null) {
      push({ cls: rule.cls, verdict: rule.verdict, start: m.index, end: m.index + m[0].length,
             secret: m[0], exempt: rule.exempt });
    }
  }

  for (const rule of NAMED_PROVIDER_RE) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(line)) !== null) {
      push({ cls: rule.cls, verdict: VERDICT.SECRET, start: m.index, end: m.index + m[0].length,
             secret: m[1] });
    }
  }

  for (const h of credentialUrlHits(line)) push(h);

  BEARER_RE.lastIndex = 0;
  let bm;
  while ((bm = BEARER_RE.exec(line)) !== null) {
    push({ cls: 'bearer-credential', verdict: VERDICT.SECRET, start: bm.index,
           end: bm.index + bm[0].length, secret: bm[1] });
  }

  ASSIGNMENT_RE.lastIndex = 0;
  let am;
  while ((am = ASSIGNMENT_RE.exec(line)) !== null) {
    const quote = am[2];
    const value = am[3];
    if (isRepoDigest(value)) continue;      // `sha: <40 hex>` is not a leaked token
    push({ cls: 'assigned-credential', verdict: VERDICT.SECRET, start: am.index,
           end: am.index + am[0].length, secret: value, binding: isBinding(value, quote) });
  }

  // High-entropy runs last, so a key already named by a provider rule is not counted twice.
  const RUN_RE = /[A-Za-z0-9+/=_-]{32,}/g;
  let rm;
  while ((rm = RUN_RE.exec(line)) !== null) {
    const run = rm[0];
    if (!looksHighEntropy(run)) continue;
    push({ cls: 'high-entropy', verdict: VERDICT.SECRET, start: rm.index,
           end: rm.index + run.length, secret: run });
  }

  for (const rule of CONTEXT_RULES) {
    rule.re.lastIndex = 0;
    let cm;
    while ((cm = rule.re.exec(line)) !== null) {
      if (rule.drop && rule.drop(cm[0], line)) continue;
      push({ cls: rule.cls, verdict: VERDICT.CONTEXT, start: cm.index,
             end: cm.index + cm[0].length, secret: cm[0] });
    }
  }

  // Deterministic within a line: position, then class.
  hits.sort((a, b) => a.col - b.col || a.cls.localeCompare(b.cls));
  return hits;
}

// ── file scanning ───────────────────────────────────────────────────────────────────────────
export function scanFile(absPath, relPath) {
  let buf;
  try {
    const st = statSync(absPath);
    if (!st.isFile()) return { rel: relPath, unscanned: UNSCANNED.NOT_A_FILE, findings: [] };
    if (st.size > maxBytes()) return { rel: relPath, unscanned: UNSCANNED.TOO_LARGE, findings: [] };
  } catch (e) {
    if (e.code === 'ENOENT') return { rel: relPath, unscanned: UNSCANNED.VANISHED, findings: [] };
    return { rel: relPath, failure: `${e.code || 'ERROR'}: ${e.message}`, findings: [] };
  }

  if (BINARY_EXTS.has(extname(relPath).toLowerCase())) {
    return { rel: relPath, unscanned: UNSCANNED.BINARY_EXT, findings: [] };
  }

  try {
    buf = readFileSync(absPath);
  } catch (e) {
    // ENOENT = vanished between stat and read; every other error is a scan FAILURE, never clean.
    if (e.code === 'ENOENT') return { rel: relPath, unscanned: UNSCANNED.VANISHED, findings: [] };
    return { rel: relPath, failure: `${e.code || 'ERROR'}: ${e.message}`, findings: [] };
  }
  return scanBuffer(buf, relPath);
}

/** Scan bytes already in hand (a file's, or a git blob's — bin/hook.mjs reads the index). The
 *  caller owns the size ceiling; the extension and NUL tests are applied here. */
export function scanBuffer(buf, relPath) {
  if (BINARY_EXTS.has(extname(relPath).toLowerCase())) {
    return { rel: relPath, unscanned: UNSCANNED.BINARY_EXT, findings: [] };
  }
  // Binary sniff on bytes: NUL in the first 8 KiB, the same test git uses.
  const probe = buf.subarray(0, 8192);
  if (probe.includes(0)) return { rel: relPath, unscanned: UNSCANNED.BINARY, findings: [] };

  const text = buf.toString('utf8');
  const findings = [];
  const lines = text.split('\n');
  const fixture = fixtureExempt() && declaresFixture(lines);
  for (let i = 0; i < lines.length; i++) {
    for (const hit of scanLine(lines[i], i + 1, { fixture })) findings.push({ file: relPath, ...hit });
  }
  return { rel: relPath, findings, ...(fixture ? { fixture: true } : {}) };
}

// ── walking ─────────────────────────────────────────────────────────────────────────────────
export function walk(absDir, root, acc = { files: [], skippedDirs: [], failures: [] }) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return acc;   // vanished mid-walk; not a clean directory, just gone
    acc.failures.push({ file: relative(root, absDir) || '.', failure: `${e.code || 'ERROR'}: ${e.message}` });
    return acc;
  }
  for (const ent of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(absDir, ent.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (ent.isSymbolicLink()) continue;          // a symlink is scanned via its real path or not at all
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) { acc.skippedDirs.push(rel); continue; }
      walk(abs, root, acc);
    } else if (ent.isFile()) {
      acc.files.push({ abs, rel });
    }
  }
  return acc;
}

// Element-at-a-time: `target.push(...src)` throws RangeError around 125k elements.
export function pushAll(target, src) {
  for (const item of src) target.push(item);
  return target;
}

/** Every git-tracked file relative to `root`. THROWS on any git failure. `-z` because a filename
 *  may contain a newline. */
export function trackedFiles(root) {
  // scannedGit: the root is any repo the sweep is pointed at, and a plain ls-files runs its fsmonitor
  const out = scannedGitOut(root, ['ls-files', '-z'], { maxBuffer: 256 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

/** Materialise a git ref into a scratch directory — the committed tree is not the worktree.
 *  `git archive` needs no lock and cannot disturb concurrent sessions. */
export function materialiseRef(root, ref = 'HEAD') {
  const dir = mkdtempSync(join(tmpdir(), 'cw-secrets-ref-'));
  try {
    // archive applies smudge filters; under scannedGit the repo's own drivers stay inert
    const tar = scannedGitOut(root, ['archive', '--format=tar', ref], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', dir], { input: tar, maxBuffer: 1024 * 1024 * 1024 });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`cannot materialise ${ref}: ${e.message}`);
  }
  return dir;
}

/**
 * @param paths  an array of paths, or `null` for tracked-files mode (the default).
 */
export function sweep(paths = DEFAULT_PATHS) {
  const root = secretsRoot();
  const files = [];
  const skippedDirs = [];
  const failures = [];
  const deletedFromWorktree = [];

  // A git failure here is a SCAN FAILURE — a silently narrowed scope is the shape of a false clean.
  let targets = paths;
  let mode = 'paths';
  if (targets === null) {
    mode = 'tracked';
    try {
      targets = trackedFiles(root);
    } catch (e) {
      return emptyResult(root, ['<git ls-files>'], mode,
        [{ file: '<git ls-files>', failure: `cannot list tracked files: ${e.message}` }]);
    }
    if (targets.length === 0) {
      return emptyResult(root, ['<git ls-files>'], mode,
        [{ file: '<git ls-files>', failure: 'git reported zero tracked files' }]);
    }
  }

  for (const p of targets) {
    const abs = resolve(root, p);
    let st;
    try {
      st = lstatSync(abs);
    } catch (e) {
      // A NAMED path that does not exist is a scan failure, never clean. Tracked mode is the one
      // exception: git lists deleted-but-not-committed files — a known state, reported as its own
      // kind of unscanned.
      if (e.code === 'ENOENT') {
        if (mode === 'tracked') deletedFromWorktree.push(p);
        else failures.push({ file: p, failure: 'ENOENT: named path does not exist' });
      } else failures.push({ file: p, failure: `${e.code || 'ERROR'}: ${e.message}` });
      continue;
    }
    if (st.isDirectory()) {
      const acc = walk(abs, root, { files: [], skippedDirs: [], failures: [] });
      pushAll(files, acc.files);
      pushAll(skippedDirs, acc.skippedDirs);
      pushAll(failures, acc.failures);
    } else {
      files.push({ abs, rel: relative(root, abs).split(sep).join('/') || basename(abs) });
    }
  }

  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const seen = new Set();
  const findings = [];
  const unscanned = [];
  let scanned = 0;

  const fixtureFiles = [];
  for (const f of files) {
    if (seen.has(f.rel)) continue;
    seen.add(f.rel);
    const res = scanFile(f.abs, f.rel);
    if (res.failure) { failures.push({ file: res.rel, failure: res.failure }); continue; }
    if (res.unscanned) { unscanned.push({ file: res.rel, reason: res.unscanned }); continue; }
    scanned++;
    if (res.fixture) fixtureFiles.push(res.rel);
    pushAll(findings, res.findings);
  }
  fixtureFiles.sort();
  for (const f of deletedFromWorktree) unscanned.push({ file: f, reason: UNSCANNED.DELETED });

  findings.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col || a.cls.localeCompare(b.cls));
  unscanned.sort((a, b) => a.file.localeCompare(b.file));
  failures.sort((a, b) => a.file.localeCompare(b.file));
  skippedDirs.sort();

  const by = (v) => findings.filter((f) => f.verdict === v);
  return {
    root,
    mode,
    paths: mode === 'tracked' ? ['<git ls-files>'] : [...targets],
    scannedFiles: scanned,
    findings,
    unscanned,
    failures,
    skippedDirs,
    fixtureFiles,
    summary: {
      [VERDICT.SECRET]: by(VERDICT.SECRET).length,
      [VERDICT.CONTEXT]: by(VERDICT.CONTEXT).length,
      [VERDICT.PLACEHOLDER]: by(VERDICT.PLACEHOLDER).length,
      scannedFiles: scanned,
      unscannedFiles: unscanned.length,
      scanFailures: failures.length,
      declaredFixtures: fixtureFiles.length,
    },
  };
}

/** A result that scanned nothing. Never clean — the caller always supplies the failure that caused it. */
function emptyResult(root, paths, mode, failures) {
  return {
    root, mode, paths, scannedFiles: 0,
    findings: [], unscanned: [], failures, skippedDirs: [], fixtureFiles: [],
    summary: {
      [VERDICT.SECRET]: 0, [VERDICT.CONTEXT]: 0, [VERDICT.PLACEHOLDER]: 0,
      scannedFiles: 0, unscannedFiles: 0, scanFailures: failures.length, declaredFixtures: 0,
    },
  };
}

// ── exit ────────────────────────────────────────────────────────────────────────────────────
// Failure outranks findings: a partial read never reports a verdict on the whole target.
export function exitCode(result, { failOnContext = false } = {}) {
  if (result.failures.length > 0) return 2;
  if (result.summary[VERDICT.SECRET] > 0) return 1;
  if (failOnContext && result.summary[VERDICT.CONTEXT] > 0) return 1;
  return 0;
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────
function render(result, { all = false } = {}) {
  const L = [];
  L.push(`secrets-sweep — ${result.paths.join(', ')}  (root ${result.root})`);
  L.push(`${result.scannedFiles} files scanned · ${result.unscanned.length} UNSCANNED · ${result.failures.length} scan failures`);
  L.push('');

  const secrets = result.findings.filter((f) => f.verdict === VERDICT.SECRET);
  L.push(`${VERDICT.SECRET}  ${secrets.length}`);
  for (const f of secrets) {
    const tag = [f.service, f.note].filter(Boolean).join(' ');
    L.push(`  ${f.file}:${f.line}:${f.col}  ${f.cls}${tag ? `  (${tag})` : ''}`);
    L.push(`      ${f.match}`);
  }
  if (!secrets.length) L.push('  none');
  L.push('');

  const ctx = result.findings.filter((f) => f.verdict === VERDICT.CONTEXT);
  L.push(`${VERDICT.CONTEXT}  ${ctx.length}`);
  const groups = new Map();
  for (const f of ctx) {
    if (!groups.has(f.cls)) groups.set(f.cls, []);
    groups.get(f.cls).push(f);
  }
  for (const cls of [...groups.keys()].sort()) {
    const g = groups.get(cls);
    L.push(`  ${cls}  ${g.length}`);
    // Text view summarises; --json is always complete, --all prints every hit.
    const show = all ? g : g.slice(0, 5);
    for (const f of show) L.push(`    ${f.file}:${f.line}  ${f.match}`);
    if (!all && g.length > show.length) L.push(`    … ${g.length - show.length} more (--all, or --json)`);
  }
  if (!ctx.length) L.push('  none');
  L.push('');

  const ph = result.findings.filter((f) => f.verdict === VERDICT.PLACEHOLDER);
  L.push(`${VERDICT.PLACEHOLDER}  ${ph.length}  (matched a rule; not a credential — reason given per hit)`);
  const byReason = new Map();
  for (const f of ph) byReason.set(f.reason || 'placeholder', (byReason.get(f.reason || 'placeholder') || 0) + 1);
  if (byReason.size) L.push(`  by reason: ${[...byReason.entries()].sort().map(([r, n]) => `${r} ${n}`).join(' · ')}`);
  for (const f of all ? ph : ph.slice(0, 5)) L.push(`  ${f.file}:${f.line}  ${f.cls}  [${f.reason || 'placeholder'}]  ${f.match}`);
  if (!all && ph.length > 5) L.push(`  … ${ph.length - 5} more (--all, or --json)`);
  L.push('');

  // Every declaring file by name — this is the one suppression a file grants itself.
  L.push(`DECLARED FIXTURES  ${result.fixtureFiles.length}  — self-declared synthetic corpora (--no-fixture-exempt ignores them)`);
  for (const f of result.fixtureFiles) L.push(`  ${f}`);
  L.push('');

  L.push(`UNSCANNED  ${result.unscanned.length}  — not scanned is not clean`);
  for (const u of all ? result.unscanned : result.unscanned.slice(0, 20)) {
    L.push(`  ${u.file}  ${u.reason}`);
  }
  if (!all && result.unscanned.length > 20) L.push(`  … ${result.unscanned.length - 20} more (--all)`);
  if (result.skippedDirs.length) {
    L.push(`  skipped by policy: ${result.skippedDirs.join(', ')}`);
  }
  const deleted = result.unscanned.filter((u) => u.reason === UNSCANNED.DELETED).length;
  if (deleted) {
    L.push(`  ${deleted} tracked but deleted from the working copy — their content is still in HEAD.`);
    L.push('  Run again with --head to scan what the repository would actually hand over.');
  }
  L.push('');

  L.push(`SCAN FAILURES  ${result.failures.length}`);
  for (const f of result.failures) L.push(`  ${f.file}  ${f.failure}`);
  return L.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const opts = { paths: null, json: false, all: false, failOnContext: false, head: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--fail-on-context') opts.failOnContext = true;
    else if (a === '--no-fixture-exempt') opts.noFixtureExempt = true;
    else if (a === '--head') {
      // An optional ref may follow. `--head --json` must not eat the flag as a ref.
      const next = argv[i + 1];
      opts.head = next && !next.startsWith('-') ? argv[++i] : 'HEAD';
    } else if (a === '--paths') {
      const v = argv[++i];
      if (!v) return { error: '--paths needs a value' };
      opts.paths = v.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--max-bytes') {
      const v = argv[++i];
      if (!v || !Number.isFinite(Number(v))) return { error: '--max-bytes needs a number' };
      process.env.CW_SECRETS_MAX_BYTES = String(Number(v));
    } else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('-')) return { error: `unknown flag: ${a}` };
    else (opts.paths ||= []).push(a);
  }
  return opts;
}

const HELP = `commitwork secrets-sweep — pattern + entropy + context sweep

  node bin/secrets-sweep.mjs [--paths <p>[,<p>…]] [--head [<ref>]] [--json] [--all]
                             [--fail-on-context] [--no-fixture-exempt] [--max-bytes <n>]

  default scope: every git-tracked file (reports/ is gitignored, so it is excluded by that)
  --head         scan the COMMITTED tree instead of the worktree, including files deleted
                 from the working copy but still present in the ref
  env: CW_SECRETS_ROOT, CW_SECRETS_MAX_BYTES, CW_SECRETS_NO_FIXTURE_EXEMPT
  exit: 0 clean · 1 findings · 2 scan failure`;

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.error) { process.stderr.write(`${opts.error}\n\n${HELP}\n`); return 2; }
  if (opts.help) { process.stdout.write(`${HELP}\n`); return 0; }
  if (opts.noFixtureExempt) process.env.CW_SECRETS_NO_FIXTURE_EXEMPT = '1';

  let result;
  let scratch = null;
  const prevRoot = process.env.CW_SECRETS_ROOT;
  try {
    let scope = opts.paths && opts.paths.length ? opts.paths : DEFAULT_PATHS;
    if (opts.head) {
      scratch = materialiseRef(secretsRoot(), opts.head);
      process.env.CW_SECRETS_ROOT = scratch;
      // The materialised tree is already the tracked set and has no .git — tracked mode would
      // fail closed there, so scan '.' instead.
      if (scope === DEFAULT_PATHS) scope = ['.'];
    }
    result = sweep(scope);
    if (opts.head) result.ref = opts.head;
  } catch (e) {
    // A crash must land on 2 — uncaught, Node exits 1, this tool's code for "findings".
    process.stderr.write(`secrets-sweep: scan aborted: ${e && e.stack ? e.stack : e}\n`);
    return 2;
  } finally {
    if (prevRoot === undefined) delete process.env.CW_SECRETS_ROOT;
    else process.env.CW_SECRETS_ROOT = prevRoot;
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
  process.stdout.write(opts.json
    ? `${JSON.stringify(result, null, 2)}\n`
    : `${render(result, { all: opts.all })}\n`);
  return exitCode(result, { failOnContext: opts.failOnContext });
}

// process.exitCode, never process.exit(): stdout writes are async on a pipe, and process.exit()
// truncates them at one pipe buffer. exitCode lets the loop drain and exit with the same status.
if (isMainModule(import.meta.url)) process.exitCode = main();

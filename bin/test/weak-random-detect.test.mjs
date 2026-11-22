// bin/weak-random-detect.mjs — insufficient randomness in security-sensitive values.
//
// Every test below is a FALSE POSITIVE THIS LANE ACTUALLY PRODUCED during development, or the true
// positive it exists to find. They are kept as tests rather than as comments because each one was
// closed by a rule that a later, reasonable-looking simplification would reopen — and two of them
// were closed by a change that silently un-found the motivating defect, which only the acid test
// caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCANNER = join(dirname(fileURLToPath(import.meta.url)), '..', 'weak-random-detect.mjs');
const T = mkdtempSync(join(tmpdir(), 'cw-weakrand-'));
let n = 0;

/** Write files into a fresh tree and scan it. `files` is {relPath: contents}. */
function scan(files) {
  const root = join(T, `r${n++}`);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  const out = execFileSync('node', [SCANNER, root], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out);
}
const rules = (r) => r.findings.filter((f) => f.context === 'source').map((f) => f.rule).sort();

// ── THE ACID TEST ───────────────────────────────────────────────────────────────────────────────
// shodh-memory's `shodh init`, verbatim in shape. The variable is HONESTLY named a timestamp; what
// makes it a defect is the function it sits in. Any rule that judges the variable name alone
// un-finds this, and one did.
test('a clock inside a credential-generating function is the defect this lane exists for', () => {
  const r = scan({
    'src/cli.rs': `
fn generate_api_key() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("sk-shodh-{:x}", timestamp)
}
`,
  });
  assert.equal(r.summary.findings, 1, 'the motivating defect must be found');
  assert.deepEqual(rules(r), ['rust-systemtime']);
  assert.equal(r.findings[0].fn, 'generate_api_key', 'and the enclosing function is the evidence, so it travels on the row');
});

test('the same function using a CSPRNG is clean — the fix must read as fixed', () => {
  const r = scan({
    'src/cli.rs': `
fn generate_api_key() -> String {
    format!("sk-shodh-{}", uuid::Uuid::new_v4().simple())
}
`,
  });
  assert.equal(r.summary.findings, 0);
});

// ── the false positives, each closed by a named rule ─────────────────────────────────────────────

// Closed by: judge the ASSIGNMENT TARGET, not the whole line. `secret` and `nonce` here are
// PARAMETER names sharing a line with the clock; the clock is assigned to `ts`.
test('a clock assigned to a timestamp is not a finding, even beside credential-named parameters', () => {
  const r = scan({
    'worker/index.js': `
async function signState(secret, p, nonce){ const ts = Date.now();
  return sign(secret, p, nonce, ts);
}
`,
  });
  assert.equal(r.summary.findings, 0);
});

// Closed by: ARITHMETIC anchored on the clock. The other operand's name says nothing.
test('a clock in an interval calculation is a measurement', () => {
  const r = scan({
    'mcp-server/index.ts': `
const sessionDuration = (Date.now() - tokenTracker.getSessionStartTime()) / 1000;
`,
  });
  assert.equal(r.summary.findings, 0);
});

// Closed by: the CSPRNG exclusion. This line got randomness RIGHT; reporting it trains a reader to
// ignore the lane on exactly the code that should reassure them.
test('a line already using a CSPRNG is not a weak-randomness finding', () => {
  const r = scan({
    'monitor/lockfile.mjs': `
const token = { pid: process.pid, nonce: randomBytes(12).toString('hex'), at: Date.now() };
`,
  });
  assert.equal(r.summary.findings, 0);
});

// Closed by: judge the target for RNGs too. `deviceToken` two lines up does not make `handle` one.
test('a display name is not a credential because a credential was minted nearby', () => {
  const r = scan({
    'worker/index.js': `
      deviceToken = randHex(32);
      const id = (crypto.randomUUID && crypto.randomUUID()) || randHex(16);
      const handle = 'Pigeon #' + (1000 + Math.floor(Math.random() * 9000));
`,
  });
  assert.equal(r.summary.findings, 0);
});

// Closed by: language gating. `java-util-random`'s pattern includes `Math.random(` for Java, so it
// fired on a .js file that `js-math-random` had already and correctly declined — two rules, one
// line, opposite verdicts.
test('a Java rule does not run on a JavaScript file', () => {
  const r = scan({
    'worker/index.js': "      const handle = 'x' + Math.floor(Math.random() * 9000);\n",
  });
  assert.equal(r.summary.findings, 0);
  assert.ok(!rules(r).includes('java-util-random'));
});

// Closed by: IS_PROSE. This lane's own explanatory note names Math.random() in a sentence.
test('prose naming an API is not a use of it', () => {
  const r = scan({
    'docs/notes.js': `
const note = 'A finding needs a weak source such as Math.random() and a sensitive sink like a token or secret key';
`,
  });
  assert.equal(r.summary.findings, 0);
});

// ── the true positives from other repositories, kept as regression fixtures ─────────────────────
test('a token built from Math.random() is a finding', () => {
  const r = scan({ 'js/cloud.js': "function getToken(){ if (!token){ token = 'd_' + Math.random().toString(36).slice(2); } return token; }\n" });
  assert.equal(r.summary.findings, 1);
  assert.deepEqual(rules(r), ['js-math-random']);
});

test('a session id built from a clock and Math.random() is a finding', () => {
  const r = scan({ 'src/Bridge.ts': "    this.sessionId = `app_${Date.now()}_${Math.random().toString(36).slice(2)}`;\n" });
  assert.equal(r.summary.findings, 1);
});

// ── TOTP: the clock is the algorithm's public input, not its secret ──────────────────────────────
// closed by reading RFC 6238: the code is HMAC(secret, floor(time / period)), and the time step is public by design
// reason: the secret is the HMAC key, so a clock read in a TOTP function is the specified counter, not a credential
const TOTP_CLEAN = [
  ['python, the RFC 6238 counter', 'app/totp.py', 'def generate_totp(secret, timestamp=None, period=30):\n    if timestamp is None:\n        timestamp = int(time.time())\n    counter = timestamp // period\n'],
  ['python, the counter assigned directly', 'app/mfa.py', 'def compute_totp_code(secret):\n    counter = int(time.time()) // 30\n    return hotp(secret, counter)\n'],
  ['js, a time step', 'src/totp.ts', 'function generateTotp(secret) {\n  const step = Math.floor(Date.now() / 30000);\n  return hotp(secret, step);\n}\n'],
];
for (const [name, rel, body] of TOTP_CLEAN) {
  test(`a clock read as the TOTP time step is clean: ${name}`, () => {
    const r = scan({ [rel]: body });

    assert.deepEqual(rules(r), [], JSON.stringify(r.findings));
  });
}

// guard: the exemption is for the time step only; minting the SECRET from the clock is the defect this lane exists for
const TOTP_STILL_FOUND = [
  ['a TOTP secret minted from the clock', 'app/enrol.py', 'def generate_totp_secret():\n    secret = str(time.time())\n    return secret\n', 'py-time'],
  ['a TOTP seed minted from the clock', 'app/enrol.py', 'def create_totp_seed():\n    value = int(time.time())\n    return value\n', 'py-time'],
  ['a credential-named target inside a TOTP function', 'app/totp.py', 'def generate_totp(user):\n    secret = str(time.time())\n    return secret\n', 'py-time'],
  ['a recovery code minted in a TOTP-named function', 'app/enrol.py', 'def generate_totp_recovery_code():\n    timestamp = int(time.time())\n    return timestamp\n', 'py-time'],
  ['a backup token minted in a TOTP-named function', 'app/enrol.py', 'def create_totp_backup_token():\n    now = int(time.time())\n    return now\n', 'py-time'],
  ['a bland target inside a TOTP function', 'app/totp.py', 'def generate_totp(user):\n    value = int(time.time())\n    return value\n', 'py-time'],
  ['a plain OTP, which is not time-based by definition', 'app/otp.py', 'def generate_otp():\n    value = int(time.time())\n    return value % 1000000\n', 'py-time'],
];
for (const [name, rel, body, rule] of TOTP_STILL_FOUND) {
  test(`the TOTP exemption does not cover ${name}`, () => {
    const r = scan({ [rel]: body });

    assert.deepEqual(rules(r), [rule], JSON.stringify(r.findings));
  });
}

// ── context, not suppression ────────────────────────────────────────────────────────────────────
test('test and bench paths are counted apart, never as findings, and never dropped', () => {
  const r = scan({
    'benches/keygen_bench.rs': `
fn generate_api_key() -> String {
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    format!("sk-{:x}", timestamp)
}
`,
  });
  assert.equal(r.summary.findings, 0, 'a deterministic seed in a benchmark is the correct implementation of a benchmark');
  assert.equal(r.summary.testContext, 1, 'but it is still counted');
  assert.equal(r.findings.length, 1, 'and the row is still published, tagged');
  assert.equal(r.findings[0].context, 'test');
});

// ── the shared exclusion policy, not a private list ─────────────────────────────────────────────
test('build output is not scanned, via the shared policy', () => {
  const r = scan({
    'target/debug/build/dep/out/gen.rs': "fn generate_api_key() -> String { let timestamp = SystemTime::now(); format!(\"sk-{}\", timestamp) }\n",
    'node_modules/pkg/index.js': "const token = 'x' + Math.random();\n",
  });
  assert.equal(r.summary.findings, 0);
  assert.equal(r.findings.length, 0, 'not merely uncounted — never walked');
});

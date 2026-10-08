#!/usr/bin/env node
/*
 * weak-random-detect.mjs — insufficient randomness in security-sensitive values, across languages.
 *
 *   node bin/weak-random-detect.mjs [rootDir]   (default: cwd '.')
 *
 * WHY THIS EXISTS. On 2026-08-28 shodh-memory's `shodh init` was found deriving the API key that
 * authenticates every endpoint from the nanosecond clock:
 *
 *     let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)...as_nanos();
 *     format!("sk-shodh-{:x}", timestamp)
 *
 * An attacker who knows the install date to within a day searches ~10^14 candidates; to within a
 * minute, ~10^11. It was found by DIFFING the repository against its twin, which had always used
 * uuid v4 — not by any of the twenty-odd lanes in the roster. There is no Rust insufficient-
 * randomness query in CodeQL's packs, clippy carries no such lint, semgrep's Rust registry coverage
 * is thin, and the JS rule that exists (bearer's javascript_lang_insufficiently_random_values)
 * covers one language. A defect that only a human diff can find is a coverage hole with a name.
 *
 * THE PRECISION RULE, learned the expensive way from bin/stub-detect.mjs. That lane matched
 * `\btodo\b` on every line and published 1,040 rows on a repository that ships a to-do feature —
 * 98% of them the word, not the marker. `Math.random()` is the same trap: it is correct for a
 * jitter, an animation, a sample, a shuffle, and wrong only for a value an attacker benefits from
 * guessing. So a finding needs BOTH halves:
 *
 *   1. a WEAK SOURCE — a non-cryptographic RNG or a clock, and
 *   2. a SENSITIVE SINK — evidence on the same line or the two before it that the value becomes a
 *      key, token, secret, nonce, salt, password, session id, IV or seed.
 *
 * Neither half alone is published. That is deliberately lossy: a weak source assigned to a bland
 * name and used as a key three functions later is missed. This lane reports what it can defend,
 * and monitor/extractors.mjs is where a wider net would have to justify itself against the false
 * positives it would bring.
 *
 * SUPPRESSION IS CONTEXTUAL, NOT AN ALLOWLIST: a line in test/bench/fixture code is recorded with
 * context 'test' and does not enter the finding count — the same split stub-detect makes, and for
 * the same reason. A deterministic seed in a benchmark is the correct implementation of a
 * benchmark.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirExcluder } from './scan-exclusions.mjs';

const ROOT = resolve(process.argv[2] || '.');
const __dirname = dirname(fileURLToPath(import.meta.url));

// One shared exclusion policy — never a second hand-maintained list. Fails closed: if the policy
// cannot be read this throws and the lane does not run, rather than walking build output.
const skipDir = dirExcluder();

const SCAN_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|java|kt|kts|py|rb|go|rs|php|cs|swift|scala|c|h|cc|cpp)$/i;

// A path that is test, bench, fixture or example code. Deterministic randomness is CORRECT there.
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|benches?|benchmarks?|fixtures?|examples?|testdata|mocks?)\//i
  || null;
const TEST_FILE = /(^|\/)[^/]*(_test|\.test|\.spec|_spec|_bench|_benchmark)\.[a-z]+$/i;

// ── weak sources, per language family ───────────────────────────────────────────────────────────
// Each is a NON-cryptographic generator or a clock. Cryptographic APIs are deliberately absent:
// crypto.randomBytes, crypto.getRandomValues, secrets.*, os.urandom, crypto/rand, SecureRandom,
// OsRng, RandomNumberGenerator and uuid v4 are all correct and must never appear here.
// `ext` gates each rule to the languages it describes. Without it `java-util-random`, whose
// pattern includes `Math.random(` for Java, fired on a .js file that `js-math-random` had already
// and correctly declined — two rules, one line, opposite verdicts. Measured on an internal project.
const SOURCES = [
  { kind: 'rng', id: 'js-math-random', ext: /\.(mjs|cjs|js|jsx|ts|tsx)$/i, re: /\bMath\.random\s*\(/, langs: 'js/ts', why: 'Math.random() is not cryptographically secure — V8 seeds it from a fast PRNG and its output is predictable from a handful of samples' },
  { kind: 'clock', id: 'js-date-now', ext: /\.(mjs|cjs|js|jsx|ts|tsx)$/i, re: /\b(?:Date\.now\s*\(\s*\)|new\s+Date\s*\(\s*\)\.getTime\s*\(\s*\))/, langs: 'js/ts', why: 'a clock reading is guessable to within the window in which it was taken' },
  { kind: 'rng', id: 'py-random', ext: /\.py$/i, re: /\brandom\.(?:random|randint|randrange|choice|choices|shuffle|sample|getrandbits|uniform)\s*\(/, langs: 'python', why: "Python's `random` is a Mersenne Twister and is documented as unsuitable for security; `secrets` is the module for this" },
  { kind: 'clock', id: 'py-time', ext: /\.py$/i, re: /\btime\.(?:time|time_ns|monotonic|monotonic_ns)\s*\(/, langs: 'python', why: 'a clock reading is guessable to within the window in which it was taken' },
  { kind: 'clock', id: 'rust-systemtime', ext: /\.rs$/i, re: /\b(?:SystemTime::now|Instant::now)\s*\(/, langs: 'rust', why: 'a clock reading is guessable to within the window in which it was taken — nanosecond precision narrows it to ~10^9 per second elapsed, not to secrecy' },
  { kind: 'rng', id: 'rust-rand-random', ext: /\.rs$/i, re: /\brand::random\s*(?:::<[^>]*>)?\s*\(/, langs: 'rust', why: '`rand::random` uses the thread RNG, which is not guaranteed to be a CSPRNG across versions; `OsRng` states the guarantee' },
  { kind: 'rng', id: 'go-math-rand', ext: /\.go$/i, re: /\bmath\/rand\b|\brand\.(?:Int|Intn|Int31|Int63|Float64|Perm|Read)\s*\(/, langs: 'go', why: 'math/rand is deterministic given its seed; crypto/rand is the security-grade source' },
  { kind: 'rng', id: 'java-util-random', ext: /\.(java|kt|kts|scala)$/i, re: /\bnew\s+Random\s*\(|\bMath\.random\s*\(/, langs: 'java/kotlin/scala', why: 'java.util.Random is a 48-bit LCG whose internal state recovers from two consecutive outputs; SecureRandom is the security-grade source' },
  { kind: 'rng', id: 'csharp-random', ext: /\.cs$/i, re: /\bnew\s+Random\s*\(/, langs: 'c#', why: 'System.Random is not cryptographically secure; RandomNumberGenerator is' },
  { kind: 'rng', id: 'php-weak-random', ext: /\.php$/i, re: /\b(?:mt_rand|rand|uniqid|lcg_value)\s*\(/, langs: 'php', why: 'mt_rand/rand/uniqid are not cryptographically secure; random_bytes/random_int are' },
  { kind: 'rng', id: 'c-rand', ext: /\.(c|h|cc|cpp)$/i, re: /\b(?:\brand\s*\(\s*\)|srand\s*\(|random\s*\(\s*\))/, langs: 'c/c++', why: 'rand()/random() are not cryptographically secure' },
];

// ── sensitive sinks: what makes a weak source a finding ─────────────────────────────────────────
// Matched on the line and the two lines before it, so an assignment split across lines is caught.
// `key` is NOT here on its own: it matches map keys, sort keys, React keys and keyboard handlers,
// and would reproduce the stub-detect over-report exactly. The compound forms are.
const SINK = new RegExp([
  'api[_-]?key', 'secret', 'token', 'password', 'passwd', 'credential',
  'nonce', '\\bsalt\\b', '\\biv\\b', 'session[_-]?id', 'csrf', 'xsrf',
  'private[_-]?key', 'signing[_-]?key', 'secret[_-]?key', 'auth[_-]?key',
  'access[_-]?key', 'refresh[_-]?token', 'otp\\b', '\\bmfa\\b', 'recovery[_-]?code',
  'reset[_-]?token', 'invite[_-]?code', 'verification[_-]?code', 'seed\\b',
].join('|'), 'i');

// A CLOCK IS ALMOST ALWAYS A CLOCK. Date.now() appears in every codebase that measures anything,
// and the sink words overlap with ordinary timing names — `sessionStartTime` sits beside `session`,
// `tokenExpiry` beside `token`. Measured on shodh-memory at 72d202c^: the first version of this
// lane reported 5, of which ONE was the defect it was built for and four were session timing.
// 20% precision is the stub-detect over-report again, in a lane written to avoid it.
//
// So a clock needs STRONGER evidence than an RNG: the sink must be on the SAME line (a clock two
// lines above a credential name is usually a timestamp field beside it), and the line must not be
// doing arithmetic or naming a duration. An RNG keeps the three-line window, because
// `Math.random()` has no innocent reading once a credential name is nearby.
// `\w*` on each stem rather than `\b`: `createdAt` and `startedAt` have no word boundary after
// the stem, so `\bcreated\b` did not match `createdAt: Date.now()` — measured on commitwork's
// admin/serve.mjs, where an oauth session's timestamp FIELD was reported because `session` is a
// sink word.
const TIMING = /\b(?:ts|tstamp|timestamp\w*|duration|elapsed|start\w*|end(?:ed|s)?\w*|expir\w*|ttl|deadline|since|until|age|created\w*|updated\w*|modified\w*|last_?seen|timeout|latency|uptime|now_?ms|issued\w*|_at\b)/i;
// ARITHMETIC ON THE CLOCK ITSELF. A clock adjacent to `-` or `+` is measuring an interval. The
// first form named the OTHER operand (`- fooTime`), which missed
// `(Date.now() - tokenTracker.getSessionStartTime())` because the operand is a call on an object
// whose name says nothing — measured on memory-layer's mcp-server/index.ts:3121. Anchor on the clock.
const ARITHMETIC = /(?:Date\.now\s*\(\s*\)|\.getTime\s*\(\s*\)|time\.time\w*\s*\(\s*\)|now\s*\(\s*\))\s*[-+]|[-+]\s*(?:Date\.now|time\.time|SystemTime::now|Instant::now)/;

// A LINE THAT DEFINES A PATTERN IS NOT A LINE THAT USES ONE. This file's own rule table matched
// `go-math-rand` when the lane was run over commitwork — a scanner reporting itself. Any rule
// table, test fixture or documentation string that spells an API out is the same shape.
const IS_PATTERN_DEF = /(?:^|[^\w])re\s*:\s*\/|\bnew RegExp\s*\(|^\s*[*/#]|`[^`]*\\b/;

// PROSE THAT NAMES AN API IS NOT A USE OF IT. This file's own `note:` string — a sentence
// explaining that `Math.random()` is fine for jitter — matched js-math-random when the lane was run
// over commitwork. Any documentation string, error message or help text that spells an API out is
// the same shape, and every scanner in this repo eventually meets it: it is stub-detect's
// comment-versus-code split, arriving one lane later.
//
// A quoted run with six or more spaces is a sentence, not an expression.
const IS_PROSE = (line) => {
  for (const m of line.matchAll(/(['"`])((?:[^\\]|\\.)*?)\1/g)) {
    const inner = m[2];
    if ((inner.match(/ /g) || []).length >= 6) return true;
  }
  return false;
};

// A LINE THAT ALREADY USES A CSPRNG IS NOT A WEAK-RANDOMNESS FINDING. monitor/lockfile.mjs builds
// `{ pid, nonce: randomBytes(12), ts: Date.now() }` — the nonce is cryptographic and the clock is a
// timestamp field beside it. Reporting that is the opposite of the lane's purpose: it would train a
// reader to ignore it on exactly the code that got randomness right.
const CRYPTO_OK = /\b(?:randomBytes|randomUUID|getRandomValues|secrets\.[a-z_]+|os\.urandom|crypto\/rand|SecureRandom|OsRng|RandomNumberGenerator|random_bytes|random_int|Uuid::new_v4|uuid4|uuidv4)\b/;

// THE ENCLOSING FUNCTION IS THE EVIDENCE A CLOCK NEEDS. The motivating defect reads:
//
//     fn generate_api_key() -> String {
//         let timestamp = SystemTime::now()          <- the weak source
//             .duration_since(UNIX_EPOCH)
//             ...
//         format!("sk-shodh-{:x}", timestamp)        <- the credential, five lines LATER
//     }
//
// Requiring the sink on the source's own line finds nothing here — `timestamp` is not a credential
// name. Requiring it in a BACKWARD window finds nothing either. Widening to a forward window brings
// back the session-timing noise, because `Date.now()` has a credential name within six lines of it
// in any file that also handles sessions.
//
// The function's NAME is the discriminator that separates them: `generate_api_key` says what the
// value is for, and `handle_request` does not. Measured on shodh-memory at 72d202c^: this rule
// reports the one real defect and none of the four timing lines the first version reported.
const FN_DEF = /(?:\bfn\s+([A-Za-z_]\w*)|\bfunction\s+([A-Za-z_]\w*)|\bdef\s+([A-Za-z_]\w*)|\bfunc\s+([A-Za-z_]\w*)|(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>))/;
const GENERATES = /\b(?:gen(?:erate)?|make|new|create|mint|issue|build|derive|fresh)\w*/i;

/** Name of the nearest function definition at or above `i`, or ''. */
function enclosingFn(lines, i) {
  for (let k = i; k >= 0 && k > i - 60; k--) {
    const m = FN_DEF.exec(lines[k]);
    if (m) return m.slice(1).find(Boolean) || '';
  }
  return '';
}

function isTestPath(rel) {
  return /(^|\/)(tests?|__tests__|spec|benches?|benchmarks?|fixtures?|examples?|samples?|demos?|testdata|mocks?)\//i.test(rel)
    || TEST_FILE.test(rel)
    || /(^|\/)conftest\.py$/i.test(rel);
}

const findings = [];
let filesScanned = 0;

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    if (skipDir(relative(ROOT, p))) continue;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p); continue; }
    if (!SCAN_EXT.test(name)) continue;
    let txt; try { txt = readFileSync(p, 'utf8'); } catch { continue; }
    filesScanned++;
    const rel = relative(ROOT, p).split('\\').join('/');
    const testish = isTestPath(rel);
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (IS_PATTERN_DEF.test(line) || IS_PROSE(line) || CRYPTO_OK.test(line)) continue;
      for (const src of SOURCES) {
        if (!src.ext.test(name)) continue;
        if (!src.re.test(line)) continue;
        if (src.kind === 'clock') {
          if (ARITHMETIC.test(line)) continue;
          // WHAT THE CLOCK IS ASSIGNED TO, not what else is on the line. Testing the whole line
          // reported an internal project's
          //     async function signState(secret, p, nonce){ const ts = Date.now()
          // because `secret` and `nonce` are PARAMETER NAMES sharing the line with the clock. The
          // clock is assigned to `ts`, which is a timestamp, and the parameters have nothing to do
          // with it. Judge the target.
          const assign = new RegExp(`(?:const|let|var|mut)?\\s*([A-Za-z_$][\\w$.]*)\\s*(?::=|=)\\s*[^=]{0,80}?(?:${src.re.source})`).exec(line);
          const target = assign ? assign[1] : '';
          const fn = enclosingFn(lines, i);
          const inGenerator = !!fn && SINK.test(fn) && GENERATES.test(fn);
          const targetIsCredential = !!target && SINK.test(target);
          // ORDER MATTERS, and getting it wrong silently un-found the motivating defect. The
          // shodh-memory case is `let timestamp = SystemTime::now()` inside `fn generate_api_key`:
          // the variable is HONESTLY named a timestamp, and then formatted into the key. Skipping
          // on a timing-shaped target before consulting the enclosing function dropped it — caught
          // only because the acid test at 72d202c^ went from 1 to 0. A credential-generating
          // function outranks the local variable's name; nothing inside it is "just a timestamp".
          if (!inGenerator) {
            if (target && TIMING.test(target)) continue;
            if (!target && TIMING.test(line)) continue;
            if (!targetIsCredential) continue;
          }
        } else {
          // Same rule as the clock: judge what the value is ASSIGNED TO. The window is the
          // fallback, for the case it was written for —
          //     let key =
          //         Math.random()...
          // — where the name is on an earlier line and there is no target on this one.
          //
          // Without this, an internal project's `const handle = 'Pigeon #' + Math.floor(Math.random()*9000)`
          // was reported because `deviceToken = randHex(32)` sits two lines above it. A display
          // name is not a credential because a credential was minted nearby, and the line above was
          // in fact using a CSPRNG correctly.
          const assign = new RegExp(`(?:const|let|var|mut)?\\s*([A-Za-z_$][\\w$.]*)\\s*(?::=|=)\\s*[^=]{0,80}?(?:${src.re.source})`).exec(line);
          const target = assign ? assign[1] : '';
          if (TIMING.test(line)) continue;
          if (target) {
            if (!SINK.test(target)) continue;
          } else {
            const window = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
            if (!SINK.test(window)) continue;
          }
        }
        findings.push({
          type: 'weak-random',
          rule: src.id,
          severity: 'high',
          path: rel,
          line: i + 1,
          context: testish ? 'test' : 'source',
          langs: src.langs,
          fn: enclosingFn(lines, i) || undefined,
          detail: line.trim().slice(0, 200),
          why: src.why,
        });
        break;   // one finding per line: the sources overlap by design (Math.random in java/js)
      }
    }
  }
}

walk(ROOT);

const real = findings.filter((f) => f.context !== 'test');
const inTests = findings.filter((f) => f.context === 'test');
const byRule = {};
for (const f of real) byRule[f.rule] = (byRule[f.rule] || 0) + 1;

const output = {
  tool: 'weak-random-detect',
  summary: {
    findings: real.length,
    byRule,
    filesScanned,
    testContext: inTests.length,
    note: 'A finding needs BOTH a non-cryptographic source (RNG or clock) AND evidence on the same line or the two before it that the value becomes a credential. Neither half alone is published — `Math.random()` is correct for jitter and wrong only for a value an attacker benefits from guessing. Matches in test/bench/fixture paths are counted under testContext, never as findings: a deterministic seed in a benchmark is the correct implementation of a benchmark.',
  },
  findings,
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

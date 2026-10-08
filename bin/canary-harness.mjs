#!/usr/bin/env node
// bin/canary-harness.mjs — plant a known-bad state, run the real gate, score its verdict.
//
// Every scenario plants a state whose truth it constructed, runs the REAL gate through the same
// env seams the hooks use, and scores the verdict against the planted truth. Everything lives
// under a fresh mkdtemp; live baselines, journals and hook state are never touched. Plants are
// synthesized at run time — nothing is committed as a fixture, so the corpus stays out of agents'
// default context.
//
// usage:
//   node bin/canary-harness.mjs                  # run all scenarios, print the scorecard
//   node bin/canary-harness.mjs --only T-REG,R-CORRUPT
//   node bin/canary-harness.mjs --json
//   node bin/canary-harness.mjs --write          # ALSO append canary adjudications to the LIVE
//                                                # ledger (kind:'adjudication', canary:<id>).
//                                                # Dry by default.
//
// exit codes:
//   0  every scored scenario correct
//   1  a false ALARM
//   2  a false CLEAN
//   3  a wrong ATTRIBUTION
//   4  a scenario named by --require could not run
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SESSION_TAG = 'canary-harness';

// A canned node:test-shaped suite, constant per invocation so confirm re-runs see a stable world.
//
// `ℹ tests` is emitted because node:test emits it and gate-tests reads it: coverage is judged on the
// TOTAL, not on `pass`, which moves on flakiness too. A fixture that omits the total makes the
// coverage check unanswerable, and the R-VANISH scenario then scores FALSE-CLEAN — the canary
// reporting that the gate missed a vanished test, when what it actually missed was this line.
// Caught 2026-08-29 by that scenario, an hour after the coverage fix landed.
const cannedSuite = (dir, { fail, pass, names = [], tests = null }) => {
  const p = join(dir, 'suite.mjs');
  const total = tests === null ? Number(pass) + Number(fail) : tests;
  const lines = [...names.map((n) => `✖ ${n} (0.5ms)`), `ℹ tests ${total}`, `ℹ pass ${pass}`, `ℹ fail ${fail}`];
  writeFileSync(p, `${lines.map((l) => `console.log(${JSON.stringify(l)});`).join('\n')}\n`);
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(p)}`;
};
const garbageSuite = (dir) => {
  const p = join(dir, 'garbage.mjs');
  writeFileSync(p, `console.log('Segmentation fault (core dumped)');\n`);
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(p)}`;
};

const writeJSON = (p, obj) => writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);

// The count comes from the tree; only the ownership is planted — what is planted is the EVIDENCE,
// never the alarm. A tree with no drift cannot host these scenarios; that skip is honest and loud.
let REAL_DRIFTED;
function realDriftedOpen() {
  if (REAL_DRIFTED !== undefined) return REAL_DRIFTED;
  try {
    const out = execFileSync(process.execPath, [join(REPO, 'bin', 'anchor-staleness.mjs'), '--json'],
      { cwd: REPO, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const n = JSON.parse(out).driftedOpen;
    REAL_DRIFTED = typeof n === 'number' ? n : null;
  } catch (e) {
    // anchor-staleness exits 1 when there IS drift; its stdout is still the measurement.
    try {
      const n = JSON.parse(String(e.stdout || '')).driftedOpen;
      REAL_DRIFTED = typeof n === 'number' ? n : null;
    } catch { REAL_DRIFTED = null; }
  }
  return REAL_DRIFTED;
}

/** Run one gate script with the scenario's env; capture exit + the scratch journal's records.
 *  `stdinJson` supplies a session id for the claim scenarios; stdin otherwise stays closed. */
function runGate(script, env, { gate }, stdinJson = null) {
  const merged = { ...process.env, ...env };
  // N2, 2026-08-29: a scenario passes `KEY: null` to UNSET an inherited variable. Without this a
  // canary cannot exercise an unseamed path at all, because process.env is spread in above — and a
  // defect that only exists when the seam is unset cannot be caught by a harness whose first act is
  // to set the seam.
  for (const [k, v] of Object.entries(env)) if (v === null) delete merged[k];
  let code = 0;
  let out = '';
  try {
    out = execFileSync(process.execPath, [join(REPO, 'bin', script)], {
      cwd: REPO, encoding: 'utf8', timeout: 300_000,
      ...(stdinJson ? { input: JSON.stringify(stdinJson) } : {}),
      stdio: stdinJson ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], env: merged,
    });
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : 1;
    out = `${String(e.stdout || '')}\n${String(e.stderr || '')}`;
  }
  let records = [];
  try {
    records = readFileSync(join(env.CW_VERDICT_DIR, `${gate}.jsonl`), 'utf8')
      .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { records = []; }
  return { code, out, records, last: records[records.length - 1] || null };
}

// expectation → truth mapping over the OBSERVED shape:
//   alarm  — real defect; must exit 2.       caught → true-alarm, silent → FALSE-CLEAN
//   quiet  — genuinely clean; must exit 0.   quiet → true-clean, noise → FALSE-ALARM
//   refuse — corrupt input; must SPEAK a refusal verdict and bank nothing.
//   claim  — real defect with known owner; must alarm AND state the right attribution claim.
// A refusal is declining to judge because a sensor is blind — never scored as a clean read.
const REFUSALS = new Set(['no-tally', 'baseline-unreadable', 'spine-ledger-unreadable', 'spine-ledger-absent', 'sensor-absent', 'state-unreadable']);
export function score(expect, { code, last }, extra = {}) {
  const verdict = last?.verdict ?? null;
  if (expect === 'claim') {
    const got = last?.attribution?.claim ?? null;
    const alarmed = code === 2;
    return {
      truth: alarmed ? 'true-alarm' : 'false-clean',
      attributionCorrect: alarmed ? got === extra.expectClaim : undefined,
      observed: `exit ${code} · ${verdict} · claim ${got ?? 'NONE'} (expected ${extra.expectClaim})`,
    };
  }
  if (expect === 'alarm') {
    // ledgerAbsent mirrors provenanceMissing below: the gate can exit 2 for the right reason while
    // the sensor the scenario exists to test read nothing. T-UNSEAMED plants a regression to make
    // the gate speak, but what it is actually testing is whether the UNSEAMED reader resolves the
    // ledger the writer writes — and the planted regression alarms either way. Without this branch
    // that assertion would be inert: a canary that cannot fail is the defect it was written to catch.
    if (extra.ledgerAbsent) {
      return { truth: 'false-clean', observed: `exit ${code} · ${verdict} · THE READER FOUND NO LEDGER at the writer's own default — reader and writer disagree on where it lives (N1)` };
    }
    return { truth: code === 2 ? 'true-alarm' : 'false-clean', observed: `exit ${code} · ${verdict}` };
  }
  if (expect === 'quiet') {
    // provenanceMissing: a quiet run hiding a stuck measurement is a FALSE CLEAN, not a pass.
    if (extra.provenanceMissing) {
      return { truth: 'false-clean', observed: `exit ${code} · ${verdict} · NO MEASUREMENT PROVENANCE — the record cannot show whether the source ran` };
    }
    const quiet = code === 0 && verdict !== null && !REFUSALS.has(verdict);
    return { truth: quiet ? 'true-clean' : 'false-alarm', observed: `exit ${code} · ${verdict}` };
  }
  // refuse: spoken refusal verdict, and nothing banked where the scenario forbade it
  const refused = REFUSALS.has(verdict) && (extra.banked !== true);
  return { truth: refused ? 'true-alarm' : 'false-clean', observed: `exit ${code} · ${verdict}${extra.banked ? ' · BANKED A NEW BASELINE OVER CORRUPT INPUT' : ''}` };
}

/** Fold scored rows into the scorecard. Pure, exported for tests. Attribution is counted apart
 *  from detection: detected-but-misnamed is full detection and full misattribution. */
export function summarise(results) {
  const scored = results.filter((r) => !r.skipped);
  const has = (v) => scored.filter((r) => r.attributionCorrect === v).length;
  return {
    scenarios: results.length,
    scored: scored.length,
    correct: scored.filter((r) => r.truth === 'true-alarm' || r.truth === 'true-clean').length,
    falseClean: scored.filter((r) => r.truth === 'false-clean').length,
    falseAlarm: scored.filter((r) => r.truth === 'false-alarm').length,
    skipped: results.filter((r) => r.skipped).length,
    ...(scored.some((r) => typeof r.attributionCorrect === 'boolean') ? {
      attributionScored: scored.filter((r) => typeof r.attributionCorrect === 'boolean').length,
      attributionCorrect: has(true),
      attributionWrong: has(false),
    } : {}),
  };
}

/**
 * Severity order, one code per DISTINCT failure. The exit code is the only thing a scheduled caller
 * can see, so anything that shares a code with something else is invisible to it.
 *   2 false clean · 3 wrong attribution · 4 a required scenario could not run · 1 false alarm · 0 ok
 */
export const exitCodeFor = (summary, { requiredSkipped = 0 } = {}) =>
  (summary.falseClean ? 2
    : summary.attributionWrong ? 3
      : requiredSkipped ? 4
        : summary.falseAlarm ? 1 : 0);

// Declared above SCENARIOS: that array calls claimScenarios() during module init (TDZ).
const CANARY_SESSION = 'canary01-0000-4000-8000-000000000001';
const CLAIM_WORLDS = [
  { id: 'R-CLAIM-MINE', expectClaim: 'mine', who: ['me'], classes: ['P5'],
    what: 'the only live touch on the drifted file is this session\'s' },
  { id: 'R-CLAIM-THEIRS', expectClaim: 'theirs', who: ['them'], classes: ['P1'],
    what: 'the only live touch is another session\'s — the gate must not blame this turn' },
  { id: 'R-CLAIM-SHARED', expectClaim: 'mixed', who: ['me', 'them'], classes: ['P6'],
    what: 'both sessions hold the SAME drifted file — co-ownership, which the pre-b51828c lattice called `theirs`' },
  { id: 'R-CLAIM-STALE', expectClaim: 'unknown', who: ['stale'], classes: ['P9'],
    what: 'the only touch predates the file\'s last commit — real dirt, honestly unattributable' },
];

const SCENARIOS = [
  {
    id: 'T-REG', gate: 'gate-tests', expect: 'alarm', classes: ['C3'],
    what: 'a committed regression: suite reports one MORE failure than the baseline floor',
    run(dir) {
      writeJSON(join(dir, 'baseline.json'), { fail: 1, pass: 100, at: '2026-08-01T00:00:00.000Z' });
      const cmd = cannedSuite(dir, { fail: 2, pass: 100, names: ['planted regression', 'inherited failure'] });
      return runGate('gate-tests.mjs', envFor(dir, { CW_GATE_TESTS_BASELINE: join(dir, 'baseline.json'), CW_GATE_TESTS_CMD: cmd }), this);
    },
  },
  {
    id: 'T-CLEAN', gate: 'gate-tests', expect: 'quiet', classes: [],
    what: 'a genuinely steady suite: same fail count and pass count as the floor',
    run(dir) {
      writeJSON(join(dir, 'baseline.json'), { fail: 1, pass: 100, at: '2026-08-01T00:00:00.000Z' });
      const cmd = cannedSuite(dir, { fail: 1, pass: 100, names: ['inherited failure'] });
      return runGate('gate-tests.mjs', envFor(dir, { CW_GATE_TESTS_BASELINE: join(dir, 'baseline.json'), CW_GATE_TESTS_CMD: cmd }), this);
    },
  },
  {
    id: 'T-VANISH', gate: 'gate-tests', expect: 'alarm', classes: ['C1'],
    what: 'tests VANISH: fail flat at the floor while half the passes disappear (taxonomy C1 — node --test exits 0 on a glob matching nothing)',
    run(dir) {
      // The baseline carries `tests` because coverage is judged on the TOTAL — a floor without one
      // cannot answer the question, and the gate correctly declines rather than alarming. Seeding a
      // totalless floor here made this scenario score FALSE-CLEAN against a gate that was behaving
      // exactly as designed, which is the canary testing its own fixture rather than the gate.
      writeJSON(join(dir, 'baseline.json'), { fail: 1, pass: 100, tests: 101, at: '2026-08-01T00:00:00.000Z' });
      const cmd = cannedSuite(dir, { fail: 1, pass: 50, names: ['inherited failure'] });
      return runGate('gate-tests.mjs', envFor(dir, { CW_GATE_TESTS_BASELINE: join(dir, 'baseline.json'), CW_GATE_TESTS_CMD: cmd }), this);
    },
  },
  {
    id: 'T-GARBAGE', gate: 'gate-tests', expect: 'refuse', classes: ['C11'],
    what: 'an unparseable suite: no tally at all must never read as a pass',
    run(dir) {
      writeJSON(join(dir, 'baseline.json'), { fail: 1, pass: 100, at: '2026-08-01T00:00:00.000Z' });
      const cmd = garbageSuite(dir);
      const r = runGate('gate-tests.mjs', envFor(dir, { CW_GATE_TESTS_BASELINE: join(dir, 'baseline.json'), CW_GATE_TESTS_CMD: cmd }), this);
      const after = JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8'));
      return { ...r, banked: after.fail !== 1 || after.pass !== 100 };
    },
  },
  {
    // N2 — THE ONE UNSEAMED PATH. Every other scenario here seams CW_TOUCH_LEDGER at a synthetic
    // file, so the reader and the writer are made to agree by the harness itself and N1 (the two
    // disagreeing on WHERE the ledger lives, across two different repositories) was invisible to
    // every canary. This one deliberately unsets the seam and asks whether the DEFAULT the reader
    // computes is the file the writer actually produces.
    //
    // It separates the two states that absence collapses, rather than skipping on both: if the
    // writer's own default exists on this box and the gate still reported no ledger, reader and
    // writer disagree and that is a real alarm. If the writer's default does not exist, the
    // producer has simply never run here — a legitimate empty, declared as a skip with its reason,
    // never scored as a pass.
    id: 'T-UNSEAMED', gate: 'gate-tests', expect: 'alarm', classes: ['C3'],
    what: 'with CW_TOUCH_LEDGER UNSET, the reader must resolve the ledger the writer actually writes',
    run(dir) {
      const writerDefault = join(REPO, '.claude', 'store', 'touches.jsonl');
      writeJSON(join(dir, 'baseline.json'), { fail: 1, pass: 100, at: '2026-08-01T00:00:00.000Z' });
      const cmd = cannedSuite(dir, { fail: 2, pass: 100, names: ['planted regression', 'inherited failure'] });
      const r = runGate('gate-tests.mjs', envFor(dir, {
        CW_GATE_TESTS_BASELINE: join(dir, 'baseline.json'),
        CW_GATE_TESTS_CMD: cmd,
        CW_TOUCH_LEDGER: null,          // the point of this scenario — inherit nothing
      }), this, { session_id: CANARY_SESSION });
      const present = r.last?.attribution?.ledgerPresent;
      if (present === undefined) {
        return { skip: 'the gate emitted no attribution block — nothing dirty to attribute in this tree' };
      }
      if (present === false && !existsSync(writerDefault)) {
        return { skip: `no ledger at the writer's own default (${writerDefault}) — the producer has never run on this box` };
      }
      // present === false WITH the writer's file on disk is the N1 shape: the gate alarms for the
      // planted regression either way, so the state is handed to the scorer, which reads
      // ledgerAbsent and downgrades the alarm to a false-clean rather than banking a hollow pass.
      return { ...r, ledgerAbsent: present === false };
    },
  },
  {
    id: 'R-CLEAN', gate: 'gate-ratchet', expect: 'quiet', classes: [],
    what: 'ratchet at its own floor: arm on the real tree, re-run — must stay quiet',
    run(dir) {
      const env = envFor(dir, { CW_RATCHET_BASELINE: join(dir, 'baseline.json') });
      runGate('gate-ratchet.mjs', env, this);              // arms (writes scenario baseline)
      return runGate('gate-ratchet.mjs', env, this);       // steady
    },
  },
  {
    id: 'R-DRIFT', gate: 'gate-ratchet', expect: 'alarm', classes: ['A1'],
    what: 'planted drift: baseline one BELOW what the tree measures — the gate must alarm and must state an attribution claim',
    run(dir) {
      const env = envFor(dir, { CW_RATCHET_BASELINE: join(dir, 'baseline.json') });
      runGate('gate-ratchet.mjs', env, this);              // arm at reality
      const armed = JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8'));
      if (typeof armed.drifted !== 'number' || armed.drifted < 1) {
        return { skip: `tree measures drifted=${armed.drifted} — nothing to plant below (needs ≥1)` };
      }
      writeJSON(join(dir, 'baseline.json'), { ...armed, drifted: armed.drifted - 1 });
      const r = runGate('gate-ratchet.mjs', env, this);
      // the alarm must also CLAIM: an attribution-less worse record is the defect 23.5 closed
      if (r.code === 2 && !r.last?.attribution?.claim) return { ...r, code: 0, noClaim: true };
      return r;
    },
  },
  {
    id: 'R-CORRUPT', gate: 'gate-ratchet', expect: 'refuse', classes: ['C11'],
    what: 'corrupt baseline: garbage bytes must be refused, never silently re-armed over (taxonomy C11 — corrupt read as absent)',
    run(dir) {
      writeFileSync(join(dir, 'baseline.json'), '{"drifted": 5, TRUNCATED');
      const env = envFor(dir, { CW_RATCHET_BASELINE: join(dir, 'baseline.json') });
      const r = runGate('gate-ratchet.mjs', env, this);
      const bytes = readFileSync(join(dir, 'baseline.json'), 'utf8');
      return { ...r, banked: bytes !== '{"drifted": 5, TRUNCATED' };
    },
  },
  {
    // The laundering channel: the gate's ADVICE is a decision too. Real drift, a session id, and
    // a ledger with no entry for the drifted file (claim `unknown`); planted evidence, real alarm.
    id: 'R-ADVICE-UNKNOWN', gate: 'gate-ratchet', expect: 'alarm', classes: ['A2'],
    what: 'unknown-claim world: the gate must alarm, and its advice must carry the co-author guard and NOT offer --baseline',
    run(dir) {
      let dirty = [];
      try {
        dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8', timeout: 30_000 })
          .split('\n').map((l) => l.slice(3).trim()).filter(Boolean).filter((f) => /\.(mjs|js|json|md)$/.test(f));
      } catch { return { skip: 'git status unavailable' }; }
      if (!dirty.length) return { skip: 'no dirty file to carry a planted anchor — no claim to make' };
      const anchors = join(dir, 'anchors.json');
      const realN = realDriftedOpen();
      if (typeof realN !== 'number' || realN < 1) return { skip: `tree measures driftedOpen=${realN} — nothing to plant below (needs >=1)` };
      writeJSON(anchors, { driftedOpen: realN, results: [{ disposition: 'open', state: 'anchor-changed', file: dirty[0] }] });
      // An EMPTY ledger: the file is dirty and drifted, and nothing says whose it is.
      const ledger = join(dir, 'touches.jsonl');
      writeFileSync(ledger, '');
      const env = envFor(dir, {
        CW_RATCHET_BASELINE: join(dir, 'baseline.json'),
        CW_TOUCH_LEDGER: ledger,
        CW_ANCHOR_STALENESS_JSON: anchors,
      });
      const stdin = { session_id: CANARY_SESSION };
      runGate('gate-ratchet.mjs', env, this, stdin);
      const armed = JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8'));
      if (typeof armed.drifted !== 'number' || armed.drifted < 1) {
        return { skip: `tree measures drifted=${armed.drifted} — nothing to plant below (needs ≥1)` };
      }
      writeJSON(join(dir, 'baseline.json'), { ...armed, drifted: armed.drifted - 1 });
      const r = runGate('gate-ratchet.mjs', env, this, stdin);
      if (r.code !== 2) return r;                       // scored as a false clean by `alarm`
      // Score the ADVICE: stdout is the hook JSON; additionalContext is what an agent acts on.
      let advice = '';
      try { advice = JSON.parse(r.out.trim().split('\n').filter(Boolean).pop()).hookSpecificOutput?.additionalContext || ''; }
      catch { return { skip: 'could not parse the hook payload — advice unscoreable, and a guess is not a score' }; }
      const guarded = /Do NOT baseline a co-author's break/.test(advice);
      const offersAccept = /--baseline/.test(advice);
      // Laundering advice reports as a FALSE CLEAN: seen, then told to bury it.
      if (!guarded || offersAccept) {
        return { ...r, code: 0, noClaim: false, adviceFail: guarded ? 'offers --baseline on an unknown claim' : 'no co-author guard' };
      }
      return r;
    },
  },
  ...claimScenarios(),

  // ── gate-spine ────────────────────────────────────────────────────────────────────────────────
  // Both ledgers are seamed (CW_TOUCH_LEDGER / CW_SPINE_LEDGER); worlds are synthetic, nothing
  // reads the live ledger.
  {
    id: 'S-NOSPINE', gate: 'gate-spine', expect: 'alarm',
    what: 'a session with substantive edits and NOTHING filed: the gate must block',
    run(dir) {
      const ledger = join(dir, 'touches.jsonl');
      const spine = join(dir, 'spine.jsonl');
      writeFileSync(ledger, `${Array.from({ length: 9 }, (_, i) => JSON.stringify({ s: CANARY_SESSION, f: `plant${i}.mjs` })).join('\n')}\n`);
      writeFileSync(spine, '');                                   // present, readable, and empty
      const env = envFor(dir, { CW_TOUCH_LEDGER: ledger, CW_SPINE_LEDGER: spine, CW_SPINE_MIN_EDITS: '3' });
      return runGate('gate-spine.mjs', env, this, { session_id: CANARY_SESSION });
    },
  },
  {
    id: 'S-FILED', gate: 'gate-spine', expect: 'quiet',
    what: 'the same edits WITH overwatch-layer records filed: the gate must stay quiet',
    run(dir) {
      const ledger = join(dir, 'touches.jsonl');
      const spine = join(dir, 'spine.jsonl');
      writeFileSync(ledger, `${Array.from({ length: 9 }, (_, i) => JSON.stringify({ s: CANARY_SESSION, f: `plant${i}.mjs` })).join('\n')}\n`);
      writeFileSync(spine, `${JSON.stringify({ s: CANARY_SESSION, task: '1' })}\n`);
      const env = envFor(dir, { CW_TOUCH_LEDGER: ledger, CW_SPINE_LEDGER: spine, CW_SPINE_MIN_EDITS: '3' });
      return runGate('gate-spine.mjs', env, this, { session_id: CANARY_SESSION });
    },
  },
  {
    // A wholly-unparseable spine ledger must answer `spine-ledger-unreadable` (fail open), never
    // accuse the session of filing nothing.
    id: 'S-TORN', gate: 'gate-spine', expect: 'refuse',
    what: 'a CORRUPT spine ledger must refuse to judge, not accuse the session of filing nothing',
    run(dir) {
      const ledger = join(dir, 'touches.jsonl');
      const spine = join(dir, 'spine.jsonl');
      writeFileSync(ledger, `${Array.from({ length: 9 }, (_, i) => JSON.stringify({ s: CANARY_SESSION, f: `plant${i}.mjs` })).join('\n')}\n`);
      writeFileSync(spine, 'not json at all\nnor is this\n');
      const env = envFor(dir, { CW_TOUCH_LEDGER: ledger, CW_SPINE_LEDGER: spine, CW_SPINE_MIN_EDITS: '3' });
      const r = runGate('gate-spine.mjs', env, this, { session_id: CANARY_SESSION });
      // `refuse` is scored on the verdict: this gate fails OPEN by design, so exit 0 is correct.
      return { ...r, refused: r.last?.reason === 'spine-ledger-unreadable' };
    },
  },

  // ── docs-doctor ───────────────────────────────────────────────────────────────────────────────
  // Scored on the --json artifact plus exit code, never printed prose. A --root run does not
  // journal, so `last` is synthesised from the artifact.
  ...[
    {
      id: 'D-GREY', expect: 'alarm',
      what: 'a doc with NO verified-against stamp: unknown freshness must never read as clean (exit 2)',
      docs: { 'docs/good.md': '# good\n<!-- verified-against: 2026-08-19 abc1234 -->\n\nbody\n',
        'docs/unstamped.md': '# unstamped\n\nno stamp at all\n' },
    },
    {
      id: 'D-GREEN', expect: 'quiet',
      what: 'every doc stamped and indexed: the gate must stay quiet',
      docs: { 'docs/good.md': '# good\n<!-- verified-against: 2026-08-19 abc1234 -->\n\nbody\n' },
    },
  ].map((c) => ({
    id: c.id, gate: 'docs-doctor', expect: c.expect, what: c.what,
    run(dir) {
      const root = join(dir, 'tree');
      mkdirSync(join(root, 'docs'), { recursive: true });
      const index = Object.keys(c.docs).map((rel) => `- [${rel}](${rel})`).join('\n');
      // README needs a stamp too, or the quiet scenario is unsatisfiable.
      writeFileSync(join(root, 'README.md'), `# plant\n<!-- verified-against: 2026-08-19 abc1234 -->\n\n## Documentation\n${index}\n`);
      for (const [rel, body] of Object.entries(c.docs)) writeFileSync(join(root, rel), body);
      const env = envFor(dir, { CW_DOCS_CACHE: '0', CW_DOCS_GIT: '0' });
      let code = 0;
      let out = '';
      try {
        out = execFileSync(process.execPath, [join(REPO, 'bin', 'docs-doctor.mjs'), '--root', root, '--json'],
          { cwd: REPO, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
      } catch (e) { code = typeof e.status === 'number' ? e.status : 1; out = String(e.stdout || ''); }
      let art = null;
      try { art = JSON.parse(out); } catch { art = null; }
      // Exit-code mapping carried as the same verdict string the gate journals.
      const verdict = art === null ? null : code === 0 ? 'green' : code === 1 ? 'orange' : 'grey-only';
      return { code, out, records: [], last: verdict === null ? null : { verdict, statuses: (art.docs || []).map((d) => d.status) } };
    },
  })),

  // ── liveness ──────────────────────────────────────────────────────────────────────────────────
  // Spawned directly (lives in monitor/); single-area mode is the seam. Freshness comes from the
  // SLICE ID (sweep-YYYYMMDDHHMMSS), not generatedAt.
  ...[
    { id: 'L-UNJOURNALED', expect: 'alarm', journal: false,
      what: 'a rollup published with NO sweep journal beside it — state whose verdict evaporated' },
    { id: 'L-FRESH', expect: 'quiet', journal: true,
      what: 'a current rollup with its sweep journal: the deadman must stay quiet' },
  ].map((c) => ({
    id: c.id, gate: 'liveness', expect: c.expect, what: c.what,
    run(dir) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const sid = `sweep-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`
        + `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
      const rollup = join(dir, 'rollup.json');
      writeJSON(rollup, { sliceId: sid, generatedAt: now.toISOString(), repos: [] });
      if (c.journal) {
        writeFileSync(join(dir, 'sweep-journal.jsonl'),
          `${JSON.stringify({ v: 1, gate: 'sweep', at: now.toISOString(), sliceId: sid, verdict: 'published', prev: 'genesis' })}\n`);
      }
      const env = envFor(dir, {});
      let code = 0;
      try {
        execFileSync(process.execPath, [join(REPO, 'monitor', 'liveness.mjs'), rollup],
          { cwd: REPO, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
      } catch (e) { code = typeof e.status === 'number' ? e.status : 1; }
      let records = [];
      try {
        records = readFileSync(join(env.CW_VERDICT_DIR, 'liveness.jsonl'), 'utf8')
          .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { records = []; }
      // Signals by RECORD, not exit code: rank-1 alarms exit 0, so map them to code 2 here.
      const last = records[records.length - 1] || null;
      const alarmed = !!last && last.verdict !== 'fresh' && last.verdict !== 'pending' && last.verdict !== 'unscheduled';
      return { code: alarmed ? 2 : code, out: '', records, last };
    },
  })),

  // ── gate-focus ────────────────────────────────────────────────────────────────────────────────
  // `--from-state <path>` is the seam; the state field is `nudgeStreak`. No quiet scenario: below
  // threshold the gate writes NO record, so its clean stratum is unmeasurable
  // (GATE_REGISTRY's cleanStratumImpossible).
  ...[
    { id: 'F-STREAK', expect: 'alarm', state: { nudgeStreak: 4, prompts: 4 }, min: '2',
      what: 'a nudge streak at or over the threshold: the gate must fire' },
    { id: 'F-UNREADABLE', expect: 'refuse', state: 'not json at all', min: '2',
      what: 'an unparseable focus state must refuse, never read as a calm session' },
  ].map((c) => ({
    id: c.id, gate: 'gate-focus', expect: c.expect, what: c.what,
    run(dir) {
      const statePath = join(dir, 'focus-state.json');
      writeFileSync(statePath, typeof c.state === 'string' ? `${c.state}\n` : `${JSON.stringify(c.state)}\n`);
      const env = envFor(dir, { CW_FOCUS_MIN_STREAK: c.min });
      let code = 0;
      try {
        execFileSync(process.execPath, [join(REPO, 'bin', 'focus-journal.mjs'), '--from-state', statePath],
          { cwd: REPO, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
      } catch (e) { code = typeof e.status === 'number' ? e.status : 1; }
      let records = [];
      try {
        records = readFileSync(join(env.CW_VERDICT_DIR, 'gate-focus.jsonl'), 'utf8')
          .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { records = []; }
      // Signals by record, not exit code: map the firing to code 2 here.
      const last = records[records.length - 1] || null;
      const fired = last?.verdict === 'refocus-fired';
      return { code: fired ? 2 : code, out: '', records, last };
    },
  })),

  // ── THE STUCK MEASUREMENT ────────────────────────────────────────────────────────────────────
  // The gate is right to stay quiet; under test is whether the RECORD says the reading came from
  // a pinned artifact rather than a run.
  {
    id: 'R-STUCK', gate: 'gate-ratchet', expect: 'quiet',
    what: 'a measurement PINNED to a fixed artifact: the record must reveal the source was not run',
    run(dir) {
      const anchors = join(dir, 'anchors.json');
      writeJSON(anchors, { driftedOpen: 7, results: [] });
      const env = envFor(dir, {
        CW_RATCHET_BASELINE: join(dir, 'baseline.json'),
        CW_ANCHOR_STALENESS_JSON: anchors,
      });
      const stdin = { session_id: CANARY_SESSION };
      runGate('gate-ratchet.mjs', env, this, stdin);          // arm against the pinned reading
      const r = runGate('gate-ratchet.mjs', env, this, stdin); // re-read: same source, same answer
      const m = r.last?.measured || null;
      // The record must name its source (a file, not a run) and the digest must be stable.
      const pinned = typeof m?.source === 'string' && m.source.startsWith('artifact:');
      const first = r.records[0]?.measured?.digest ?? null;
      const stable = !!m?.digest && m.digest === first;
      return {
        ...r,
        // No provenance = the stuck state is undetectable → false clean, not a passing quiet run.
        provenanceMissing: !(pinned && stable),
      };
    },
  },

];

// ── CLAIM ACCURACY ──────────────────────────────────────────────────────────────────────────────
// A real gate run, a real journal record, and a claim whose correct answer was fixed before the
// gate started. CW_TOUCH_LEDGER says who touched a file; CW_ANCHOR_STALENESS_JSON says which files
// drifted. The `worse` reading is real (armed at the tree, lowered by one); only the evidence is
// planted. The session id is synthetic and obviously so.
function claimScenarios() {
  return CLAIM_WORLDS.map((w) => ({
    id: w.id, gate: 'gate-ratchet', expect: 'claim', expectClaim: w.expectClaim, classes: w.classes || [],
    what: `planted attribution world: ${w.what}; the gate must alarm AND claim ${w.expectClaim}`,
    run(dir) {
      // A REAL dirty file: dirtyHits is porcelain ∩ drifted, and porcelain is not seamed.
      let dirty = [];
      try {
        dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8', timeout: 30_000 })
          .split('\n').map((l) => l.slice(3).trim()).filter(Boolean).filter((f) => /\.(mjs|js|json|md)$/.test(f));
      } catch { return { skip: 'git status unavailable' }; }
      if (!dirty.length) return { skip: 'no dirty file to carry a planted anchor — nothing to attribute' };
      const target = dirty[0];

      const anchors = join(dir, 'anchors.json');
      const realN = realDriftedOpen();
      if (typeof realN !== 'number' || realN < 1) return { skip: `tree measures driftedOpen=${realN} — nothing to plant below (needs >=1)` };
      writeJSON(anchors, { driftedOpen: realN, results: [{ disposition: 'open', state: 'anchor-changed', file: target }] });

      const now = new Date().toISOString();
      const old = '2015-01-01T00:00:00.000Z';   // safely before any commit in this repo
      const rows = [];
      if (w.who.includes('me')) rows.push({ s: 'canary01', f: target, at: now });
      if (w.who.includes('them')) rows.push({ s: 'other999', f: target, at: now });
      if (w.who.includes('stale')) rows.push({ s: 'other999', f: target, at: old });
      const ledger = join(dir, 'touches.jsonl');
      writeFileSync(ledger, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);

      const env = envFor(dir, {
        CW_RATCHET_BASELINE: join(dir, 'baseline.json'),
        CW_TOUCH_LEDGER: ledger,
        CW_ANCHOR_STALENESS_JSON: anchors,
      });
      const stdin = { session_id: CANARY_SESSION };
      runGate('gate-ratchet.mjs', env, this, stdin);            // arm at reality
      const armed = JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8'));
      if (typeof armed.drifted !== 'number' || armed.drifted < 1) {
        return { skip: `tree measures drifted=${armed.drifted} — nothing to plant below (needs ≥1)` };
      }
      writeJSON(join(dir, 'baseline.json'), { ...armed, drifted: armed.drifted - 1 });
      return { ...runGate('gate-ratchet.mjs', env, this, stdin), expectClaim: w.expectClaim, target };
    },
  }));
}

const envFor = (dir, extra) => {
  const verdicts = join(dir, 'verdicts');
  const hook = join(dir, 'hook-emit');
  mkdirSync(verdicts, { recursive: true });
  mkdirSync(hook, { recursive: true });
  return { CW_VERDICT_DIR: verdicts, CW_HOOK_STATE: hook, ...extra };
};

async function main() {
  const args = process.argv.slice(2);
  const listOf = (flag) => {
    const at = args.indexOf(flag);
    return (at >= 0 ? args[at + 1] || '' : '').split(',').filter(Boolean);
  };
  const only = listOf('--only');
  const required = listOf('--require');
  const chosen = only.length ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
  const unknownIds = [...only, ...required].filter((id) => !SCENARIOS.some((s) => s.id === id));
  if (unknownIds.length) { console.error(`unknown scenario id(s): ${unknownIds.join(', ')}`); process.exit(2); }
  if (args.includes('--list')) {
    // So a caller can compute which scenarios exist rather than asserting it in prose.
    console.log(JSON.stringify(SCENARIOS.map((s) => ({ id: s.id, gate: s.gate, expect: s.expect, classes: s.classes || [], what: s.what })), null, 2));
    process.exit(0);
  }

  const results = [];
  for (const s of chosen) {
    const dir = mkdtempSync(join(tmpdir(), `cw-canary-${s.id}-`));
    let row;
    try {
      const r = s.run(dir);
      row = r.skip
        ? { id: s.id, gate: s.gate, expect: s.expect, skipped: r.skip }
        // The scratch journal dies with `dir` in the finally below, so the record is carried OUT
        // here or it is gone. `recordAt` alone is an address into a directory that no longer exists.
        // `gate` is stamped only where the record lacks it — two docs-doctor scenarios synthesise
        // `last` from an artifact and carry just {verdict, statuses}, which renders to a rater as
        // "GATE: undefined". The scenario declares the gate that produced the record, so filling it
        // is transcription, not invention; a record that HAS the field is never overwritten.
        : { id: s.id, gate: s.gate, expect: s.expect, ...score(s.expect, r, r), recordAt: r.last?.at ?? null,
            record: r.last ? { gate: s.gate, ...r.last } : null, what: s.what, ...(r.target ? { target: r.target } : {}), ...(r.noClaim ? { note: 'alarmed but stated NO attribution claim' } : {}), ...(r.adviceFail ? { note: `alarmed, then LAUNDERED: ${r.adviceFail}` } : {}) };
    } catch (e) {
      // a scenario that cannot run is a skip WITH its reason — never a pass, never silently absent
      row = { id: s.id, gate: s.gate, expect: s.expect, skipped: `scenario error: ${e.message}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    results.push(row);
  }

  const summary = summarise(results);
  const scored = results.filter((r) => !r.skipped);

  // ── A SKIP IS NOT A PASS ───────────────────────────────────────────────────────────────────────
  // A clean tree makes the drift and claim worlds unhostable, so an all-skip run must never read
  // green. --require asks one question — "was it SCORED" — covering skipped, errored, and
  // never-selected alike.
  const scoredIds = new Set(results.filter((r) => !r.skipped).map((r) => r.id));
  const requiredSkipped = required.filter((id) => !scoredIds.has(id));
  // A run that scored NOTHING is never a pass, whatever it was asked for.
  const nothingScored = results.length > 0 && scored.length === 0;

  if (args.includes('--write')) {
    // Append to the LIVE ledger; recordAt points at the scratch journal record, and the basis says so.
    const { appendRecord, adjudicationsPath } = await import('./lib/verdict-journal-core.mjs');
    for (const r of scored) {
      const w = appendRecord(adjudicationsPath(), {
        v: 1, kind: 'adjudication', at: new Date().toISOString(),
        gate: r.gate, recordAt: r.recordAt || new Date().toISOString(), truth: r.truth,
        basis: `CANARY ${r.id} (truth by construction): planted ${r.what}; expected ${r.expect}, observed ${r.observed}.`
          + (r.target ? ` Attribution world planted over the live dirty file ${r.target}.` : '')
          + (r.record
            ? ' The judged record is EMBEDDED on this adjudication (`record`), because the scenario journal it came from is deleted when the scenario ends.'
            : ' No record was captured for this scenario, so there is nothing for a rater to judge — `recordAt` addresses a journal that no longer exists.'),
        // Truth by construction is worth nothing to a rater who cannot see what was judged. Banking
        // the record makes the adjudication self-contained: `gate@recordAt` still keys it, but the
        // evidence no longer has to be looked up in a directory that lived for one scenario.
        ...(r.record ? { record: r.record } : {}),
        // Only for claim scenarios where the gate actually alarmed — no invented denominator.
        ...(typeof r.attributionCorrect === 'boolean' ? { attributionCorrect: r.attributionCorrect } : {}),
        adjudicatedBy: SESSION_TAG, canary: r.id,
      });
      if (!w.ok) { console.error(`ledger write FAILED for ${r.id}: ${w.error}`); process.exit(1); }
    }
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify({ summary: { ...summary, required, requiredSkipped, nothingScored }, results }, null, 2));
  } else {
    for (const r of results) {
      // WHO? is its own marker: detected but misnamed is neither MISS nor ok.
      const mark = r.truth === 'false-clean' || r.truth === 'false-alarm' ? 'MISS'
        : r.attributionCorrect === false ? 'WHO?' : ' ok ';
      // A REQUIRED scenario that skipped is not a SKIP notice, it is a failure of the run.
      console.log(r.skipped
        ? `${required.includes(r.id) ? 'GONE' : 'SKIP'} ${r.id.padEnd(10)} ${r.skipped}`
        : `${mark} ${r.id.padEnd(10)} expect ${r.expect.padEnd(6)} → ${r.truth.padEnd(11)} (${r.observed})${r.note ? ` — ${r.note}` : ''}`);
    }
    console.log(`\n${summary.correct}/${summary.scored} correct · ${summary.falseClean} false-clean · ${summary.falseAlarm} false-alarm`
      + `${summary.attributionWrong ? ` · ${summary.attributionWrong} MISATTRIBUTED` : ''} · ${summary.skipped} skipped`
      + `${args.includes('--write') ? ' · adjudications appended to the live ledger' : ' · dry run (no ledger writes; --write to record)'}`);
    if (requiredSkipped.length) {
      console.error(`\nREQUIRED scenario(s) could not run: ${requiredSkipped.join(', ')}.`
        + ' The tree could not host them, so they scored NOTHING — this run proves nothing about them.'
        + ' A clean tree makes the drift and claim worlds unhostable; that is expected, and it is why'
        + ' it must not read as a pass.');
    } else if (nothingScored) {
      console.error('\nNOT ONE scenario scored — every one was skipped. A green here would mean "nothing was tested".');
    }
  }
  process.exit(exitCodeFor(summary, { requiredSkipped: requiredSkipped.length + (nothingScored ? 1 : 0) }));
}

// Run only when invoked as a script — importing for unit tests must not spawn real gates.
if (isMainModule(import.meta.url)) main();

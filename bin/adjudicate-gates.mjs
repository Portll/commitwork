#!/usr/bin/env node
/**
 * bin/adjudicate-gates.mjs — decide which past gate decisions CAN be judged, and judge those.
 *
 * Consistency (re-deriving a verdict from its own record) is reported, never written as truth;
 * truth requires an observation independent of the record (re-run at headSha). The suite runs
 * twice and must agree; verdicts derive from the measurement before the record's verdict is read.
 * No rate may be computed from this output: the quiet stratum is refutation-only for gate-tests.
 *
 * usage:
 *   node bin/adjudicate-gates.mjs                      classify decidability, print the strata
 *   node bin/adjudicate-gates.mjs --json
 *   node bin/adjudicate-gates.mjs --verify [--limit N] re-measure at headSha; produce truth
 *   node bin/adjudicate-gates.mjs --verify --write     ...and append the adjudications
 * env: CW_VERDICT_DIR (journals), CW_ADJ_WORKTREE_ROOT (where detached worktrees are built)
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseSuiteOutput } from './gate-tests-core.mjs';
import { readJournal, appendRecord, adjudicationsPath, retractionsFrom } from './lib/verdict-journal-core.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = 'adjudicate-gates';

// ── STRATA ──────────────────────────────────────────────────────────────────────────────────────
// Each value names WHAT evidence would settle the record.
export const STRATA = {
  VERIFIABLE: 'verifiable-at-sha',        // an immutable commit can settle it; re-run and see
  ATTRIBUTION_ONLY: 'attribution-verifiable-at-sha', // the alarm is gone, the whose-is-it survives
  // Not undecidable: "no procedure in this tool" is a gap in the tool, not in the evidence.
  PROCEDURE_MISSING: 'anchored-but-no-procedure-here',
  CONSISTENCY_ONLY: 'consistency-only',   // re-derivable from its own inputs, which proves little
  UNDECIDABLE: 'undecidable',             // the evidence no longer exists anywhere
};

// Gates this file can re-measure. docs-doctor is symmetric: a pure function of the tree, so
// re-derivation confirms as well as refutes.
const RE_MEASURABLE = new Map([
  ['gate-tests', 'suite'],
  ['docs-doctor', 'docs'],
]);

/** What could settle this record? Pure and pessimistic: only an immutable object makes it VERIFIABLE. */
export function classify(rec) {
  if (!rec || typeof rec !== 'object') return { stratum: STRATA.UNDECIDABLE, why: 'not a record' };

  // Keyed on the record, never on the gate — gate-level assumptions go stale.
  if (!rec.headSha) {
    return {
      stratum: STRATA.UNDECIDABLE,
      why: `no headSha on this ${rec.gate} record — nothing anchors it to an immutable tree (the stamp landed 2026-08-13; records before it are permanently un-re-derivable)`,
    };
  }
  if (!RE_MEASURABLE.has(rec.gate)) {
    return {
      stratum: STRATA.PROCEDURE_MISSING,
      why: `anchored at a commit, but this tool has no re-measurement procedure for ${rec.gate} — a gap in the tool, not in the evidence`,
    };
  }
  if (rec.gate === 'docs-doctor') {
    return { stratum: STRATA.VERIFIABLE, why: 'the verdict is a pure function of the doc tree; re-derivable at headSha in both directions' };
  }
  if (rec.gate === 'gate-tests') {
    if (rec.verdict === 'regression-committed') {
      return { stratum: STRATA.VERIFIABLE, why: 'the failures are claimed to live in committed code; the suite can be re-run at headSha' };
    }
    if (rec.verdict === 'regression-uncommitted') {
      return typeof rec.headFail === 'number'
        ? { stratum: STRATA.ATTRIBUTION_ONLY, why: 'the working tree is gone, but the claim "pristine HEAD is at the floor" is checkable at headSha' }
        : { stratum: STRATA.UNDECIDABLE, why: 'a working-tree failure with no recorded pristine-HEAD measurement — no surviving evidence' };
    }
    if (rec.verdict === 'steady' || rec.verdict === 'coverage-loss' || rec.verdict === 'coverage-transient') {
      // A working-tree claim: headSha can refute it but never confirm it.
      return { stratum: STRATA.ATTRIBUTION_ONLY, why: 'a working-tree claim; headSha can refute it but cannot confirm it' };
    }
    return { stratum: STRATA.CONSISTENCY_ONLY, why: `verdict '${rec.verdict}' has no independent evidence on the record` };
  }
  // Anchored-ness and re-measurability are both decided above; a new gate means teaching
  // measureAt() and judge() a procedure.
  return { stratum: STRATA.CONSISTENCY_ONLY, why: `no classification rule for gate '${rec.gate}'` };
}

/** Every record for a gate, both journal halves, oldest first. */
export function loadGate(gate) {
  try { return readJournal(gate).records.filter((r) => r && r.gate === gate); }
  catch { return []; }
}

// ── RE-MEASUREMENT ──────────────────────────────────────────────────────────────────────────────

/** Re-derive docs-doctor at a commit. Deterministic, so run once. CW_VERDICT_DIR is redirected to
 *  scratch so the measurement never appends to the journal being adjudicated. */
function measureDocsAt(dir, scratch) {
  let code = 0;
  try {
    execFileSync(process.execPath, [join(dir, 'bin', 'docs-doctor.mjs')], {
      cwd: dir, encoding: 'utf8', timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CW_VERDICT_DIR: scratch },
    });
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : -1;
  }
  // The gate's own mapping, and grey is NOT a third flavour of clean.
  const verdict = code === 0 ? 'green' : code === 1 ? 'orange' : code === 2 ? 'grey-only' : null;
  return verdict ? { ok: true, verdict } : { ok: false, why: `docs-doctor exited ${code} — no verdict mapping, so nothing is settled` };
}

/** Run the suite at a commit, twice, in a detached worktree (never stash — co-sessions hold
 *  uncommitted work). Disagreement returns flaky, never a preferred run. */
export function measureAt(sha, { runs = 2, procedures = ['suite'] } = {}) {
  const root = process.env.CW_ADJ_WORKTREE_ROOT || tmpdir();
  const dir = mkdtempSync(join(root, `cw-adj-${sha.slice(0, 8)}-`));
  try {
    try { execFileSync('git', ['worktree', 'add', '--detach', dir, sha], { cwd: REPO, stdio: 'ignore', timeout: 120_000 }); }
    catch (e) { return { ok: false, why: `worktree add failed: ${e.message.slice(0, 120)}` }; }
    // One worktree serves every procedure this commit needs.
    const out = {};
    if (procedures.includes('docs')) out.docs = measureDocsAt(dir, join(dir, '.adj-verdicts'));
    if (!procedures.includes('suite')) return { ok: true, ...out };
    const samples = [];
    for (let i = 0; i < runs; i++) {
      let out = '';
      try {
        out = execFileSync('npm', ['test'], { cwd: dir, encoding: 'utf8', timeout: 1_800_000, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        // Non-zero exit is normal for a failing suite; the tally is still on stdout.
        out = `${String(e.stdout || '')}\n${String(e.stderr || '')}`;
      }
      const parsed = parseSuiteOutput(out);
      if (!parsed || typeof parsed.fail !== 'number' || typeof parsed.pass !== 'number') {
        return { ok: false, why: 'suite produced no parseable tally — unreadable is never zero' };
      }
      samples.push(parsed);
    }
    const [a, ...rest] = samples;
    const agreed = rest.every((s) => s.fail === a.fail && s.pass === a.pass);
    if (!agreed) {
      return { ok: false, flaky: true, why: `runs disagreed (${samples.map((s) => `${s.fail}f/${s.pass}p`).join(' vs ')}) — a flaky population cannot settle a past decision`, samples };
    }
    return { ok: true, fail: a.fail, pass: a.pass, names: a.names || [], samples, ...out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    try { execFileSync('git', ['worktree', 'prune'], { cwd: REPO, stdio: 'ignore', timeout: 30_000 }); } catch { /* best effort */ }
  }
}

/**
 * Judge one record against an independent measurement — without reading the record's own verdict.
 * Returns null when the measurement cannot settle it; null is an outcome, not a failure.
 */
/**
 * R17 · do the two runs correspond BY NAME?
 *
 * Some tests read the LIVE FLEET, so re-running an old sha does not reproduce the gate's run. A
 * truth emitted from two runs that measured different worlds is not a weaker fact — it is a
 * fabricated one, and it lands in the ground-truth store that everything else is scored against.
 *
 * Both empty is agreement: nothing failed then and nothing fails now, so there is nothing to
 * correspond and no disagreement to find. Any other shape requires at least one shared name.
 *
 * Deliberately NOT a ratio or a threshold: one shared failing name is evidence that the same world
 * was measured, and requiring more would reject a real correspondence whenever the record happens
 * to be short.
 */
export function namesCorrespond(recorded, measured) {
  const rec = recorded instanceof Set ? recorded : new Set(recorded || []);
  const mes = measured instanceof Set ? measured : new Set(measured || []);
  if (rec.size === 0 && mes.size === 0) return true;      // both clean: nothing to correspond
  for (const n of mes) if (rec.has(n)) return true;
  return false;
}

export function judge(rec, measured, stratum, { corroborating = [] } = {}) {
  if (!measured?.ok) return null;

  // docs-doctor: agreement confirms (the one channel that can emit true-clean); disagreement is
  // undecidable in both directions.
  if (rec.gate === 'docs-doctor') {
    const now = measured.docs?.verdict;
    if (!now) return null;
    const said = rec.verdict;
    if (said === now) {
      return {
        truth: now === 'green' ? 'true-clean' : 'true-alarm',
        // Measurement first, prose second: `measurement` carries what was OBSERVED; rater-facing
        // text renders from it in code (rate-llm.mjs renderMeasurement).
        measurement: { sha: rec.headSha, docsVerdict: now },
        evidence: `re-derived docs-doctor at ${rec.headSha.slice(0, 8)}: ${now}, matching the recorded verdict — the gate read the tree correctly`,
      };
    }
    // Disagreement is undecidable in BOTH directions: uncommitted work makes the working tree
    // greener or oranger with equal ease, so this channel confirms and never refutes.
    return { undecidable: `the commit re-derives ${now} while the record said ${said}; a doc goes orange for an unlisted `
      + 'or misplaced file as well as a stale stamp, so uncommitted work explains a disagreement in EITHER direction '
      + 'and this cannot distinguish a gate error from a session mid-edit' };
  }

  const floor = rec.baseline?.fail;
  if (typeof floor !== 'number') return null;

  // Validity guard: some tests read the LIVE FLEET, so re-running an old sha does not reproduce the
  // gate's run. No truth is emitted unless the tests failing now correspond to names the record (or
  // a sibling at the same commit) recorded then; otherwise the runs measured different worlds.
  const recorded = new Set([...(rec.committed || []), ...(rec.names || []), ...corroborating]);
  const measuredNames = new Set(measured.names || []);
  const overlap = [...measuredNames].filter((n) => recorded.has(n));
  // R17 · extracted so it can be ASSERTED. It fires 403 times in the live ledger and, until
  // 2026-08-30, forcing it to `true` left every test green — a guard nothing could notice the loss
  // of. Its whole job is refusing to emit a truth when the two runs measured different worlds.
  const namesAgree = namesCorrespond(recorded, measuredNames);
  const nameNote = `failing now: ${[...measuredNames].slice(0, 3).join('; ') || 'none'}${measuredNames.size > 3 ? ` (+${measuredNames.size - 3})` : ''}`;

  if (stratum === STRATA.VERIFIABLE && rec.gate === 'gate-tests') {
    // The claim: committed code is above the floor. Re-measured at that very commit, is it?
    const reallyWorse = measured.fail > floor;
    if (reallyWorse && !namesAgree) {
      return { undecidable: `the suite fails at ${rec.headSha.slice(0, 8)} today, but on different tests than the record named — `
        + `the failures are environment-dependent, not properties of the commit (${nameNote})` };
    }
    if (!reallyWorse && recorded.size) {
      // Non-reproduction is not evidence of a false alarm — fleet-dependence cuts this way too.
      return { undecidable: `the tests the record named do not fail at ${rec.headSha.slice(0, 8)} today `
        + `(${measured.fail} failing against a floor of ${floor}); the commit is pinned but the fleet these tests read is not, so this cannot distinguish a false alarm from a moved environment` };
    }
    return {
      truth: reallyWorse ? 'true-alarm' : 'false-alarm',
      measurement: { sha: rec.headSha, floor, fail: measured.fail, pass: measured.pass, corroboratedTests: overlap },
      evidence: `re-ran the suite at ${rec.headSha.slice(0, 8)} twice: ${measured.fail} failing, ${measured.pass} passing, against the floor of ${floor} the record compared to; `
        + `the failing tests correspond to the ones the record named (${overlap.slice(0, 2).join('; ') || 'both clean'})`,
    };
  }
  if (stratum === STRATA.ATTRIBUTION_ONLY && rec.gate === 'gate-tests') {
    if (rec.verdict === 'regression-uncommitted') {
      // The alarm is unjudgeable (that tree is gone); the attribution is checkable: the gate said
      // pristine HEAD sat at `headFail`. The name-correspondence guard applies here too.
      const headIsClean = measured.fail <= floor;
      const gateSaidClean = rec.headFail <= floor;
      if (!headIsClean && !namesAgree) {
        return { undecidable: `pristine HEAD fails at ${rec.headSha.slice(0, 8)} today on tests no record from that commit named — `
          + `fleet-dependent, so it cannot settle whether the gate was right that HEAD was clean (${nameNote})` };
      }
      return {
        attributionCorrect: headIsClean === gateSaidClean,
        measurement: { sha: rec.headSha, floor, fail: measured.fail, pass: measured.pass, headFail: rec.headFail, corroboratedTests: overlap },
        evidence: `the alarm is unjudgeable (its working tree is gone), but pristine HEAD re-measures ${measured.fail} failing at ${rec.headSha.slice(0, 8)} against a floor of ${floor}; the record claimed HEAD sat at ${rec.headFail}`
          + `${headIsClean ? ' (HEAD clean now, as the record said)' : `; the failures correspond to ones a record from that commit named (${overlap.slice(0, 2).join('; ')})`}`,
      };
    }
    if (rec.verdict === 'steady') {
      // Refutation only, and only on corroborated names: committed HEAD worse than the "steady"
      // floor is a false-clean only if those failures belong to the commit, not today's fleet.
      if (measured.fail > floor) {
        if (!namesAgree) {
          return { undecidable: `committed HEAD fails at ${rec.headSha.slice(0, 8)} today, but no record from that commit named these tests — `
            + `fleet-dependent, so it cannot refute a steady reading taken then (${nameNote})` };
        }
        return {
          truth: 'false-clean',
          measurement: { sha: rec.headSha, floor, fail: measured.fail, pass: measured.pass, corroboratedTests: overlap },
          evidence: `the gate called the tree steady against a floor of ${floor}, but committed HEAD at ${rec.headSha.slice(0, 8)} re-measures ${measured.fail} failing on tests a sibling record from that same commit also named (${overlap.slice(0, 2).join('; ')}) — a committed regression was already present and this run stayed quiet about it`,
        };
      }
      return null;   // consistent with steady, but a working-tree claim cannot be CONFIRMED this way
    }
  }
  return null;
}

/** The exact envelope --write appends for one judgement. Exported so a test can hold the WRITER
 *  to the measurement contract. */
export function adjudicationRecordFor(rec, v, sha) {
  return {
    v: 1, kind: 'adjudication', at: new Date().toISOString(),
    gate: rec.gate, recordAt: rec.at,
    // pid+session identify a record when two sessions journal in the same millisecond.
    ...(rec.pid ? { recordPid: rec.pid } : {}),
    ...(rec.session ? { recordSession: rec.session } : {}),
    ...(v.truth ? { truth: v.truth } : {}),
    ...(typeof v.attributionCorrect === 'boolean' ? { attributionCorrect: v.attributionCorrect } : {}),
    // The measurement is the preferred rater channel; prose narrates a conclusion.
    ...(v.measurement ? { measurement: v.measurement } : {}),
    evidence: v.evidence,
    basis: `RE-MEASURED at ${sha}: ${v.evidence}. Method: bin/adjudicate-gates.mjs --verify (suite re-run twice in a detached worktree, agreement required; verdict derived from the measurement before the record's own verdict was read).`,
    adjudicatedBy: 'adjudicate-gates (re-measurement; the operator of this tool may have authored the gates being judged — see the file header)',
    method: 're-measurement',
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

function report(strata) {
  const rows = Object.values(strata);
  const total = rows.reduce((n, r) => n + r.length, 0);
  console.log(`${TAG}: ${total} gate decisions in the journals\n`);
  for (const [name, list] of Object.entries(strata)) {
    if (!list.length) continue;
    console.log(`  ${String(list.length).padStart(4)}  ${name}`);
    const why = {};
    for (const r of list) (why[r.why] ??= []).push(r);
    for (const [w, group] of Object.entries(why).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`        ${String(group.length).padStart(4)} · ${w}`);
    }
  }
  const judgeable = (strata[STRATA.VERIFIABLE]?.length || 0) + (strata[STRATA.ATTRIBUTION_ONLY]?.length || 0);
  const anchored = strata[STRATA.PROCEDURE_MISSING]?.length || 0;
  const gone = strata[STRATA.UNDECIDABLE]?.length || 0;
  console.log(`\n  ${judgeable}/${total} can be judged by this tool today.`);
  if (anchored) {
    console.log(`  ${anchored} more are ANCHORED and waiting on a procedure this file does not have yet — that is a gap in the`);
    console.log('  tool, not in the evidence, and it closes with work rather than with time.');
  }
  console.log(`  ${gone}/${total} are unjudgeable: the tree they measured was never recorded, and nothing later recovers it.`);
  console.log('  Those are not pending. Recording them as unjudgeable is truer than assigning a truth value that would move a rate.');
}

async function main() {
  const args = process.argv.slice(2);
  const at = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const limit = Number(at('--limit') || 0) || Infinity;
  const onlyGate = at('--gate');

  const gates = ['gate-tests', 'gate-ratchet', 'docs-doctor', 'gate-spine'].filter((g) => !onlyGate || g === onlyGate);
  const strata = { [STRATA.VERIFIABLE]: [], [STRATA.ATTRIBUTION_ONLY]: [], [STRATA.PROCEDURE_MISSING]: [], [STRATA.CONSISTENCY_ONLY]: [], [STRATA.UNDECIDABLE]: [] };
  const already = new Set();
  try {
    // A retracted judgement must be re-judgeable, or a withdrawal becomes a permanent hole.
    const adjRecords = readJournal('adjudications').records || [];
    const retracted = retractionsFrom(adjRecords);
    for (const a of adjRecords) {
      if (a?.kind !== 'adjudication' || !a.recordAt) continue;
      if (retracted.has(a)) continue;
      already.add(`${a.gate}@${a.recordAt}`);
    }
  } catch (e) {
    // Fail loud: only a genuinely absent ledger may proceed — an unreadable ledger would read as
    // empty and re-judge the whole corpus.
    if (e?.code === 'ENOENT') {
      console.log(`${TAG}: no adjudications ledger yet — every decision is unjudged`);
    } else {
      console.error(`${TAG}: FATAL — could not read the adjudications ledger (${e?.message || e}). Refusing to run: an`
        + ' unreadable ledger would look like an empty one and re-judge every decision already judged.');
      process.exit(1);
    }
  }

  // Instants at which this gate journalled twice: `at` is the only handle, so judging one of a
  // colliding pair would name both and identify neither.
  const ambiguousAt = new Set();
  for (const g of gates) {
    const seen = new Map();
    for (const rec of loadGate(g)) if (rec?.at) seen.set(rec.at, (seen.get(rec.at) || 0) + 1);
    for (const [at, n] of seen) if (n > 1) ambiguousAt.add(`${g}@${at}`);
  }

  for (const g of gates) {
    for (const rec of loadGate(g)) {
      if (already.has(`${g}@${rec.at}`)) continue;      // never re-judge what is already judged
      if (ambiguousAt.has(`${g}@${rec.at}`)) {
        strata[STRATA.UNDECIDABLE].push({ rec, stratum: STRATA.UNDECIDABLE,
          why: 'two records share this instant — an adjudication names a decision by `at` alone, so judging one would name both and identify neither' });
        continue;
      }
      const c = classify(rec);
      strata[c.stratum].push({ rec, why: c.why, stratum: c.stratum });
    }
  }

  if (!args.includes('--verify')) {
    if (args.includes('--json')) {
      console.log(JSON.stringify(Object.fromEntries(Object.entries(strata).map(([k, v]) =>
        [k, v.map((x) => ({ gate: x.rec.gate, at: x.rec.at, verdict: x.rec.verdict, headSha: x.rec.headSha, why: x.why }))])), null, 2));
    } else report(strata);
    process.exit(0);
  }

  // Verification pass. Group by commit — one worktree settles every record sharing a sha.
  const candidates = [...strata[STRATA.VERIFIABLE], ...strata[STRATA.ATTRIBUTION_ONLY]].filter((x) => x.rec.headSha);
  const byShaMap = new Map();
  for (const x of candidates) {
    if (!byShaMap.has(x.rec.headSha)) byShaMap.set(x.rec.headSha, []);
    byShaMap.get(x.rec.headSha).push(x);
  }
  const shas = [...byShaMap.keys()].slice(0, limit);
  console.log(`${TAG}: ${candidates.length} judgeable record(s) across ${byShaMap.size} commit(s); verifying ${shas.length}\n`);

  const adjudications = [];
  const abstentions = [];      // declines, kept so coverage is computable — see the write loop
  let flaky = 0;
  let unresolvable = 0;
  for (const sha of shas) {
    const group = byShaMap.get(sha);
    const procedures = [...new Set(group.map(({ rec }) => RE_MEASURABLE.get(rec.gate)).filter(Boolean))];
    const m = measureAt(sha, { procedures });
    if (!m.ok) {
      if (m.flaky) flaky += group.length; else unresolvable += group.length;
      console.log(`  SKIP ${sha.slice(0, 8)} (${group.length} record(s)) — ${m.why}`);
      continue;
    }
    // Any name a record at this commit reported failing is independent corroboration.
    const corroborating = group.flatMap(({ rec }) => [...(rec.committed || []), ...(rec.names || [])]);
    for (const { rec, stratum } of group) {
      const v = judge(rec, m, stratum, { corroborating });
      if (!v) { unresolvable++; continue; }
      if (v.undecidable) {
        unresolvable++;
        console.log(`  ${'undecidable'.padEnd(16)} ${sha.slice(0, 8)} ${rec.at} — ${v.undecidable}`);
        // A decline is data: recorded as its own kind (see JUDGEMENT_KINDS) so coverage is
        // computable and abstentions never enter a truth denominator.
        abstentions.push({ rec, sha, reason: v.undecidable });
        continue;
      }
      adjudications.push({ rec, v, sha });
      console.log(`  ${(v.truth || (v.attributionCorrect ? 'attribution-ok' : 'attribution-WRONG')).padEnd(16)} ${sha.slice(0, 8)} ${rec.at} — gate said ${rec.verdict}`);
    }
  }

  console.log(`\n  ${adjudications.length} adjudication(s) produced · ${flaky} left unjudged (flaky) · ${unresolvable} left unjudged (evidence did not settle it)`);
  // The alarm stratum is symmetric; the quiet stratum is refutation-only — a catch rate across
  // them has a denominator in which the favourable outcome cannot occur.
  const byTruth = adjudications.reduce((a, { v }) => { if (v.truth) a[v.truth] = (a[v.truth] || 0) + 1; return a; }, {});
  const attr = adjudications.filter(({ v }) => typeof v.attributionCorrect === 'boolean');
  console.log(`  detection: ${Object.entries(byTruth).map(([k, n]) => `${n} ${k}`).join(' · ') || 'none'}`);
  // The caveat must describe THIS run: docs-doctor can confirm quiet (true-clean); gate-tests cannot.
  console.log(byTruth['true-clean']
    ? `             NOT a rate in general: only gates whose quiet state can be CONFIRMED from the commit contribute a true-clean`
      + ` (docs-doctor does; gate-tests' quiet stratum is refutation-only, so its denominator cannot contain the favourable outcome).`
    : '             NOT a rate — nothing here confirmed a quiet state, so there is no true-clean to divide by.');
  if (attr.length) {
    const ok = attr.filter(({ v }) => v.attributionCorrect).length;
    console.log(`  attribution: ${ok}/${attr.length} correct — this one IS symmetric (a claim can be right or wrong), so it is a rate,`);
    console.log(`               scoped to the records whose ownership survives re-measurement. Counted apart from detection, as the gates do.`);
  }

  console.log(`  ${abstentions.length} decline(s) will be recorded, so coverage is computable rather than assumed.`);
  if (!args.includes('--write')) {
    console.log('  dry run — nothing written. --write to append.');
    process.exit(0);
  }
  for (const { rec, sha, reason } of abstentions) {
    const w = appendRecord(adjudicationsPath(), {
      v: 1, kind: 'adjudication-abstention', at: new Date().toISOString(),
      gate: rec.gate, recordAt: rec.at,
      ...(rec.pid ? { recordPid: rec.pid } : {}),
      ...(rec.session ? { recordSession: rec.session } : {}),
      reason,
      headSha: sha,
      adjudicatedBy: 'adjudicate-gates (re-measurement; the operator of this tool may have authored the gates being judged — see the file header)',
      method: 're-measurement',
    });
    if (!w.ok) { console.error(`abstention write FAILED for ${rec.gate}@${rec.at}: ${w.error}`); process.exit(1); }
  }
  for (const { rec, v, sha } of adjudications) {
    const w = appendRecord(adjudicationsPath(), adjudicationRecordFor(rec, v, sha));
    if (!w.ok) { console.error(`ledger write FAILED for ${rec.gate}@${rec.at}: ${w.error}`); process.exit(1); }
  }
  console.log(`  ${adjudications.length} appended to the live ledger.`);
}

if (isMainModule(import.meta.url)) main();

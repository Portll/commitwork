#!/usr/bin/env node
// bin/detection-falsifier.mjs — the ONE falsifier the D detection lane must survive.
//
// Runs the D1 reducer (monitor/detection-reducer.mjs) over a LABELLED corpus and checks it reproduces
// the known answer: collapse the known-false findings (primary: TruffleHog Lob; held-out: a DIFFERENT
// defect) WITHOUT being told which detector, while NOT dismissing the real secrets. Below the
// pre-committed thresholds the D lane is declared not-working and D1 is not shipped.
//
// Exit codes:  0 = gates pass (ship)   1 = gates fail (do not ship)   3 = GREY (model unreachable or
// too many unreadable verdicts — UNKNOWN, never a silent pass; fail closed).
//
// Usage:
//   node bin/detection-falsifier.mjs                 # live run over the whole fixture (lmstudio)
//   node bin/detection-falsifier.mjs --sample 7      # live run, N items balanced across sets
//   node bin/detection-falsifier.mjs --engine ollama --model qwen2.5:0.5b
//   node bin/detection-falsifier.mjs --dry           # offline: a transparent STUB heuristic, NOT the
//                                                    # model — proves the harness + gates only
// Env: CW_D1_FIXTURE, CW_D1_MODEL, CW_D1_TIMEOUT_MS, CW_D1_MAX_TOKENS, CW_LMSTUDIO_URL, CW_OLLAMA_URL, CW_NOW.

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFinding, probeModel } from '../monitor/detection-reducer.mjs';
import { scoreRun, evaluateGates, THRESHOLDS } from '../monitor/detection-score.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const a = { engine: 'lmstudio', model: process.env.CW_D1_MODEL || 'qwen/qwen3.8-27b', sample: 0, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry') a.dry = true;
    else if (t === '--engine') a.engine = argv[++i];
    else if (t === '--model') a.model = argv[++i];
    else if (t === '--sample') a.sample = Number(argv[++i]) || 0;
    else if (t === '--help' || t === '-h') a.help = true;
  }
  return a;
}

function loadFixture() {
  const path = process.env.CW_D1_FIXTURE ? resolve(process.env.CW_D1_FIXTURE)
    : join(CW, 'monitor', 'test', 'fixtures', 'detection-lanes', 'labelled-findings.json');
  const j = JSON.parse(readFileSync(path, 'utf8')); // parse failure THROWS — fail closed, never an empty set
  if (!Array.isArray(j.findings) || !j.findings.length) throw new Error(`fixture ${path} has no findings`);
  return { path, findings: j.findings };
}

// Balanced sample: take the first ceil(N * share) of each set so a small live run still exercises
// lob + heldout + positive (a positive control skipped is a green-over-unentered-branch bug).
function balancedSample(findings, n) {
  if (!n || n >= findings.length) return findings;
  const bySet = {};
  for (const f of findings) (bySet[f.set] ||= []).push(f);
  const sets = Object.keys(bySet);
  const per = Math.max(1, Math.floor(n / sets.length));
  let out = [];
  for (const s of sets) out.push(...bySet[s].slice(0, per));
  return out.slice(0, Math.max(n, sets.length)); // never drop a whole set
}

// The --dry STUB: a transparent, declared heuristic — NOT the model. It exists to prove the harness
// and gates run offline and that a competent reducer PASSES; it is loudly labelled as not-a-verdict.
function stubClassify(item) {
  const t = JSON.stringify(item.finding || {}).toLowerCase();
  let classification;
  if (/-----begin[^]*private key|sk_live_|akia[0-9a-z]{16}/.test(t)) classification = 'real';
  else if (/example\.(test|com)|realpassword|leaked-here|s3cr3t|internal\.example/.test(t)) classification = 'false-positive';
  else if (/does not have secret scanning|security_and_analysis/.test(t)) classification = 'needs-human';
  else if (/\btest_[a-z0-9_]+\b|capability-|detects .*(capabilit|network|process|filesystem|downloading)/.test(t)) classification = 'false-positive';
  else classification = 'needs-human';
  return { ok: true, classification, reason: 'stub heuristic (offline, not the model)' };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n')); return 0; }
  const { path, findings: all } = loadFixture();
  const findings = balancedSample(all, args.sample);
  const now = process.env.CW_NOW || new Date().toISOString();

  console.log(`# D1 falsifier — ${now}`);
  console.log(`fixture: ${path}`);
  console.log(`items: ${findings.length}/${all.length}${args.sample ? ` (balanced sample of ${args.sample})` : ''}`);
  console.log(`thresholds: lobStrict≥${THRESHOLDS.lobStrict}  heldoutNonFab≥${THRESHOLDS.heldoutNonFab}  positiveSurvive≥${THRESHOLDS.positiveSurvive}  maxErrorRate≤${THRESHOLDS.maxErrorRate}`);

  if (args.dry) {
    console.log('mode: --dry  (STUB HEURISTIC — NOT the LLM; proves the harness + gates only)\n');
  } else {
    const probe = await probeModel({ engine: args.engine });
    if (!probe.up) {
      // GREY: unknown, never a pass. Fail closed with a distinct exit code.
      console.error(`\nGREY: ${args.engine} model unreachable (${probe.why}). D1 is UNVERIFIED — not pass, not fail.`);
      console.error('The reducer was NOT exercised; no collapse rate can be claimed. Bring the model up or use --dry to test the harness.');
      return 3;
    }
    const hasModel = (probe.models || []).some((m) => m === args.model);
    console.log(`mode: live  engine=${args.engine}  model=${args.model}${hasModel ? '' : '  (WARNING: model not in the engine list — request may 404)'}\n`);
  }

  const results = [];
  let i = 0;
  for (const item of findings) {
    i++;
    const r = args.dry ? stubClassify(item) : await classifyFinding(item, { engine: args.engine, model: args.model });
    results.push({ item, ...r });
    const mark = !r.ok ? 'ERR ' : ({ strict: r.classification === 'false-positive', weak: r.classification !== 'real', survive: r.classification !== 'false-positive' }[item.collapseMode] ? 'ok  ' : 'MISS');
    const cls = r.ok ? r.classification : `error: ${r.error}`;
    console.log(`  [${String(i).padStart(2)}/${findings.length}] ${mark} ${item.set.padEnd(8)} ${item.id.padEnd(34)} gt=${item.groundTruth.padEnd(14)} -> ${cls}`);
  }

  const scored = scoreRun(results);
  const gates = evaluateGates(scored);
  const pct = (r) => r === null ? 'n/a (no items — UNKNOWN)' : `${(r * 100).toFixed(1)}%`;
  console.log('\n## collapse rates');
  console.log(`  Lob strict-collapse (→false-positive):        ${pct(scored.lob.rate)}  over ${scored.lob.n}`);
  console.log(`  held-out reduction (GuardDog FP + Prowler ¬real): ${pct(scored.heldout.rate)}  over ${scored.heldout.n}`);
  console.log(`  positive-control survival (real ¬dismissed):  ${pct(scored.positive.rate)}  over ${scored.positive.n}${scored.positive.dismissed.length ? `  DISMISSED: ${scored.positive.dismissed.join(', ')}` : ''}`);
  console.log(`  model/verdict errors:                          ${scored.errors}/${scored.total}  (${pct(scored.errorRate)})`);

  console.log('\n## gates');
  for (const g of gates.gates) console.log(`  ${g.pass ? 'PASS' : 'FAIL'}  ${g.name.padEnd(28)} actual=${g.actual === null ? 'UNKNOWN' : g.actual.toFixed(3)}`);

  // Too many errors is GREY (fail closed), distinct from a genuine gate failure.
  if (!args.dry && scored.errorRate > THRESHOLDS.maxErrorRate && scored.errors === scored.total) {
    console.error(`\nGREY: every verdict was unreadable (${scored.errors}/${scored.total}). D1 UNVERIFIED.`);
    return 3;
  }
  console.log(`\n${gates.verdict}`);
  return gates.pass ? 0 : 1;
}

run().then((code) => process.exit(code)).catch((e) => { console.error('falsifier failed closed:', e.message); process.exit(3); });

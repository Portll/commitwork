#!/usr/bin/env node
// commitwork — the gate any pass that REWRITES a chained ledger must run.
//
//   node bin/chain-guard.mjs --snapshot <file> <ledger>…   before the rewrite
//   …rewrite…
//   node bin/chain-guard.mjs --check <file> <ledger>…      after; exit 1 if any chain got worse
//   node bin/chain-guard.mjs <ledger>…                     one-shot state, exit 1 if any is broken
//
// WHY THIS AND NOT A LINE COUNT. The 2026-09-02 PII scrub compared this store's line count before
// and after and matched exactly — a content rewrite preserves it — while orphaning 47 successors in
// verdicts/liveness.jsonl. The check could not have moved. Gate on the chain, never on the count.
//
// Exit 0: nothing degraded (or, one-shot: every named ledger verifies / is legitimately absent).
// Exit 1: a chain got worse, or a ledger is broken/torn/unreadable.
import { readFileSync, writeFileSync } from 'node:fs';
import { chainSnapshot, chainDegradation } from './lib/touch-chain.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const snapFile = at('--snapshot');
const checkFile = at('--check');
const paths = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--snapshot' && argv[i - 1] !== '--check');

if (!paths.length) {
  console.error('chain-guard: name at least one ledger. See the header for usage.');
  process.exit(2);
}
if (snapFile && checkFile) {
  console.error('chain-guard: --snapshot and --check are the two halves of one gate, not one call.');
  process.exit(2);
}

const now = chainSnapshot(paths);

if (snapFile) {
  writeFileSync(snapFile, JSON.stringify(now, null, 2) + '\n');
  if (!json) console.log(`chain-guard: baseline for ${paths.length} ledger(s) -> ${snapFile}`);
  else console.log(JSON.stringify(now, null, 2));
  process.exit(0);
}

if (checkFile) {
  let before;
  try { before = JSON.parse(readFileSync(checkFile, 'utf8')); } catch (e) {
    // Fail closed: without the baseline this gate cannot answer, and must not report a pass.
    console.error(`chain-guard: baseline UNREADABLE (${e.code || e.message}) — refusing to report a verdict.`);
    process.exit(1);
  }
  const d = chainDegradation(before, now);
  if (json) console.log(JSON.stringify(d, null, 2));
  else if (d.ok) console.log(`chain-guard: no chain degraded across ${paths.length} ledger(s).`);
  else for (const x of d.degraded) console.error(`chain-guard: DEGRADED ${x.path} — ${x.why}`);
  process.exit(d.ok ? 0 : 1);
}

// One-shot.
const bad = Object.entries(now).filter(([, v]) => v.state === 'chain-broken' || v.state === 'torn' || v.state === 'unreadable');
if (json) console.log(JSON.stringify(now, null, 2));
else for (const [p, v] of Object.entries(now)) {
  console.log(`  ${v.state.padEnd(13)} ${p}  (broken ${v.broken ?? '?'}, torn ${v.torn ?? '?'}, examined ${v.examined})`);
}
process.exit(bad.length ? 1 : 0);

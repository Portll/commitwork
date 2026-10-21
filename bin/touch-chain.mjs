#!/usr/bin/env node
// commitwork — verify the touch ledger's hash chain (bin/lib/touch-chain.mjs writes it).
//
//   node bin/touch-chain.mjs [--json]
//
// Exit 0: chain ok (or ledger legitimately absent — printed as its own state, never as clean).
// Exit 1: chain-broken or torn — an interior edit, deletion, or unparseable line.
// Honours CW_TOUCH_LEDGER.
import { verifyLedgerChain, touchLedgerPath } from './lib/touch-chain.mjs';

const json = process.argv.includes('--json');
const live = touchLedgerPath();

let r;
try {
  r = verifyLedgerChain(live);
} catch (e) {
  // Fail closed: an unreadable ledger is never an empty or clean one.
  if (json) console.log(JSON.stringify({ state: 'unreadable', error: e.code || String(e.message || e) }));
  else console.error(`touch-chain: UNREADABLE — ${e.code || e.message}`);
  process.exit(1);
}

if (json) {
  console.log(JSON.stringify(r, null, 2));
} else {
  console.log(`touch-chain: ${r.state}  (${live})`);
  for (const f of r.files) {
    if (f.absent) { console.log(`  ${f.path}: absent`); continue; }
    const c = f.chain;
    console.log(`  ${f.path}: ${f.lines} line(s) — verified ${c.verified}, raced ${c.raced}, unlinked ${c.unlinked}, unchained ${c.unchained}, broken ${c.broken}, torn ${c.torn}`);
  }
  for (const b of r.breaks) console.log(`  BREAK ${b.path}:${b.line} — ${b.why}`);
}
process.exit(r.state === 'chain-broken' || r.state === 'torn' ? 1 : 0);

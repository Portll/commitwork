#!/usr/bin/env node
// bin/disregard.mjs — the write and read path for the disregarded-warning register (roadmap W2,
// monitor/disregarded-warnings.mjs). Setting a warning aside records it; checking a batch of
// warnings against the register reports each as fresh, RETURNED (set aside before, back again) or
// unidentified.
//
// usage:
//   node bin/disregard.mjs record --source docs-doctor --code orange --subject docs/X.md \
//     --why "why it is safe to set aside" --who "name (basis)" [--message <text>] [--dry]
//   node bin/disregard.mjs check --warnings <file.json> [--json]   file: [{source,code,subject,message}]
//   node bin/disregard.mjs check --from docs-doctor [--root <dir>] [--json]
//   node bin/disregard.mjs list [--json]
//
// A record also appends a suppression-label (target = the warning key, action 'disregard') to the
// fatigue ledger, as bin/exempt.mjs does, so a warning set aside again and again is counted there.
//
// env (read at call time): CW_DISREGARDED_WARNINGS (register), CW_VERDICT_DIR (label), CW_NOW.
// exit: 0 done · 20 register unreadable or write refused · 21 input unreadable · 22 usage
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { disregardedWarningsPathFor } from '../monitor/store-paths.mjs';
import { appendDisregard, classifyWarnings, readRegister, validateDisregard, warningKey } from '../monitor/disregarded-warnings.mjs';
import { buildSuppressionLabel } from '../monitor/annotate-lib.mjs';
import { appendRecord, adjudicationsPath, redactLedgerFields } from './lib/verdict-journal-core.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXIT = { refused: 20, input: 21, usage: 22 };

/** docs-doctor's orange and grey docs and its index findings, as warnings. */
export function docsDoctorWarnings(result) {
  const out = [];
  for (const d of result.docs || []) {
    if (d.status === 'orange' || d.status === 'grey') {
      out.push({ source: 'docs-doctor', code: d.status, subject: d.path, message: (d.reasons || []).join('; ') });
    }
  }
  for (const f of result.indexFindings || []) out.push({ source: 'docs-doctor', code: 'index', subject: f.path, message: f.reason });
  return out;
}

async function loadWarnings(args, flag) {
  const from = flag('--from');
  if (from === 'docs-doctor') {
    const { collectDocs } = await import('./docs-doctor.mjs');
    const root = flag('--root');
    return docsDoctorWarnings(collectDocs(root ? { root: resolve(root) } : {}));
  }
  if (from) throw Object.assign(new Error(`unknown --from '${from}' (known: docs-doctor)`), { exit: EXIT.usage });
  const file = flag('--warnings');
  if (!file) throw Object.assign(new Error('check needs --warnings <file.json> or --from docs-doctor'), { exit: EXIT.usage });
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    throw Object.assign(new Error(`warnings unreadable (${e.code || e.message})`), { exit: EXIT.input });
  }
  const list = Array.isArray(doc) ? doc : doc && doc.warnings;
  if (!Array.isArray(list)) throw Object.assign(new Error('warnings file is neither an array nor {warnings:[...]}'), { exit: EXIT.input });
  return list;
}

function render(res) {
  const lines = [];
  for (const r of res.rows) {
    const msg = r.message ? `  ${r.message}` : '';
    if (r.disposition === 'returned') {
      const d = r.disregarded;
      lines.push(`RETURNED      ${r.key}${msg}`);
      lines.push(`              set aside ${d.at} by ${d.who}: ${d.why}${d.setAsides > 1 ? ` (${d.setAsides} set-asides since ${d.firstAt})` : ''}`);
    } else if (r.disposition === 'fresh') {
      lines.push(`fresh         ${r.key}${msg}`);
    } else {
      lines.push(`unidentified  (needs source, code and subject — not checked against the register)${msg}`);
    }
  }
  const c = res.counts;
  lines.push('', `${c.fresh} fresh, ${c.returned} returned, ${c.unidentified} unidentified`);
  if (res.quiet.length) lines.push(`${res.quiet.length} set-aside warning(s) not seen in this batch (\`list\` names them)`);
  if (res.invalid.length) lines.push(`${res.invalid.length} register record(s) failed validation and were NOT applied: ${res.invalid.map((i) => i.errors[0]).join(' | ')}`);
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...args] = argv;
  const flag = (name) => { const i = args.lastIndexOf(name); return i >= 0 ? args[i + 1] : null; };
  const json = args.includes('--json');
  const path = disregardedWarningsPathFor(REPO);

  if (cmd === 'record') {
    const rec = {
      source: flag('--source'), code: flag('--code'), subject: flag('--subject'),
      why: flag('--why'), who: flag('--who'), at: nowISO(),
      ...(flag('--message') ? { message: flag('--message') } : {}),
    };
    if (args.includes('--dry')) {
      const errs = validateDisregard(rec);
      if (errs.length) { console.error(`disregard: refusing — ${errs.join('; ')}`); return EXIT.refused; }
      console.log(`(dry) would append to ${path}:\n${JSON.stringify({ ...rec, key: warningKey(rec) }, null, 2)}`);
      return 0;
    }
    const res = appendDisregard(path, rec);
    if (!res.ok) { console.error(`disregard: refusing — ${res.error}`); return EXIT.refused; }
    if (!res.appended) { console.log(`already recorded: ${res.key}`); return 0; }
    console.log(`set aside ${res.key} → ${path} (${res.total} record(s))`);
    const label = buildSuppressionLabel({ target: res.key, action: 'disregard', who: rec.who, at: rec.at, noExpires: true });
    const w = appendRecord(adjudicationsPath(), redactLedgerFields(label));
    if (!w.ok) console.error(`warning: suppression-label not recorded (${w.error}) — the set-aside itself was written`);
    return 0;
  }

  if (cmd === 'check' || cmd === 'list') {
    const reg = readRegister(path);
    if (!reg.ok) { console.error(`disregard: ${reg.error} at ${path} — nothing classified`); return EXIT.refused; }
    let warnings = [];
    if (cmd === 'check') {
      try { warnings = await loadWarnings(args, flag); } catch (e) { console.error(`disregard: ${e.message}`); return e.exit || EXIT.input; }
    }
    const res = classifyWarnings(warnings, reg.records, { now: nowISO() });
    if (cmd === 'list') {
      if (json) console.log(JSON.stringify({ register: path, absent: reg.absent, disregarded: res.quiet, invalid: res.invalid }, null, 2));
      else {
        if (reg.absent) console.log(`no register at ${path} — nothing has been set aside`);
        for (const q of res.quiet) console.log(`${q.key}\n  set aside ${q.at} by ${q.who}: ${q.why}`);
        if (res.invalid.length) console.log(`${res.invalid.length} invalid record(s), not applied`);
      }
      return 0;
    }
    console.log(json ? JSON.stringify({ register: path, absent: reg.absent, ...res }, null, 2) : render(res));
    return 0;
  }

  console.error('usage: disregard.mjs record|check|list (see the header of bin/disregard.mjs)');
  return EXIT.usage;
}

if (isMainModule(import.meta.url)) process.exitCode = await main();

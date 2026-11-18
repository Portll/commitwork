#!/usr/bin/env node
// bin/semgrep-rule-modes.mjs — record the mode of every Semgrep registry rule that fired
// (cra/semgrep-rule-modes.mjs), so a Semgrep result without a path can say whether its rule traces.
//
// usage: node bin/semgrep-rule-modes.mjs fetch <reports dir>… [--refresh]
//        node bin/semgrep-rule-modes.mjs status <reports dir>…
// fetch   reads every semgrep*.sarif and opengrep*.sarif under the directories, and fetches the
//         definition of each fired registry rule not yet recorded (all of them with --refresh) from
//         the Semgrep registry. Only public rule ids are sent. Writes the table atomically.
// status  prints, as JSON, each fired rule with its result count, mode and where the mode came from.
//         Reads no network.
// exit: 0 every fired rule has a mode and every artifact was read · 1 a rule is unresolved, an
//       artifact could not be read, or no Semgrep artifact was found (the table still records what
//       did resolve) · 2 usage, or the table exists and cannot be used (it is never overwritten then)
// env, read at call time: CW_SEMGREP_RULE_MODES (the table, default monitor/semgrep-rule-modes.json),
//   CW_SEMGREP_REGISTRY (default https://semgrep.dev/c/r/), CW_NOW (the recorded fetch time)
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readSarif } from '../monitor/sarif-read.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import {
  ruleModesPath, registryBase, readRuleModes, readLocalModes, modeFor, fetchRuleMode, mergeOutcomes, tableText,
} from '../cra/semgrep-rule-modes.mjs';

const ARTIFACT = /^(semgrep|opengrep)[\w.-]*\.sarif$/;

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (cmd !== 'fetch' && cmd !== 'status') return { error: `unknown command ${JSON.stringify(cmd ?? null)}` };
  const dirs = rest.filter((a) => !a.startsWith('--'));
  const unknown = rest.filter((a) => a.startsWith('--') && a !== '--refresh');
  if (unknown.length) return { error: `unknown option ${unknown[0]}` };
  if (!dirs.length) return { error: `${cmd} needs at least one reports directory` };
  return { cmd, dirs, refresh: rest.includes('--refresh') };
}

/** Rule ids fired under the directories → { counts: Map(id → results), artifacts, unreadable[] }. */
export function firedRules(dirs, { maxDepth = 6 } = {}) {
  const counts = new Map();
  const unreadable = [];
  let artifacts = 0;
  const walk = (d, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch (e) {
      unreadable.push(`${d}: ${e.code || e.message}`);
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!ARTIFACT.test(e.name)) continue;
      artifacts++;
      const rec = readSarif(p);
      if (rec.state !== 'ok') { unreadable.push(`${p}: ${rec.state}`); continue; }
      for (const r of rec.results) if (r.ruleId) counts.set(r.ruleId, (counts.get(r.ruleId) || 0) + 1);
    }
  };
  for (const d of dirs) walk(d, 0);
  return { counts, artifacts, unreadable };
}

export function status({ dirs, tablePath = ruleModesPath() }) {
  const t = readRuleModes(tablePath);
  const local = readLocalModes();
  const fired = firedRules(dirs);
  const rules = [...fired.counts.keys()].sort().map((id) => ({ id, results: fired.counts.get(id), ...modeFor(id, { table: t.table, local }) }));
  const byMode = {};
  for (const r of rules) {
    const k = r.mode || r.source;
    byMode[k] = byMode[k] || { rules: 0, results: 0 };
    byMode[k].rules++;
    byMode[k].results += r.results;
  }
  return { table: { state: t.state, reason: t.reason, path: t.path }, artifacts: fired.artifacts, unreadable: fired.unreadable, localErrors: local.errors, byMode, rules };
}

export async function fetchModes({ dirs, refresh = false, tablePath = ruleModesPath(), fetchImpl, base = registryBase(), atIso, log = (s) => console.error(s) }) {
  const t = readRuleModes(tablePath);
  if (t.state !== 'ok' && t.state !== 'absent') {
    log(`semgrep-rule-modes: the table exists and cannot be used (${t.state}: ${t.reason}); refusing to overwrite it`);
    return 2;
  }
  const local = readLocalModes();
  const fired = firedRules(dirs);
  const want = [...fired.counts.keys()].sort().filter((id) => {
    const m = modeFor(id, { table: t.table, local });
    if (m.source === 'local') return false;
    return refresh || m.source !== 'registry';
  });
  const outcomes = [];
  for (const id of want) {
    const o = await fetchRuleMode(id, { base, ...(fetchImpl ? { fetchImpl } : {}) });
    log(`semgrep-rule-modes: ${id} → ${o.ok ? o.mode : `unresolved (${o.reason})`}`);
    outcomes.push([id, o]);
  }
  const at = atIso || process.env.CW_NOW || new Date().toISOString();
  const next = mergeOutcomes(t.table, outcomes, at, base);
  if (outcomes.length || t.state === 'absent') writeAtomic(tablePath, tableText(next), { mkdir: true });
  const after = { table: next, local };
  const open = [...fired.counts.keys()].filter((id) => !modeFor(id, after).mode);
  for (const u of fired.unreadable) log(`semgrep-rule-modes: unreadable ${u}`);
  for (const e of local.errors) log(`semgrep-rule-modes: local rules unreadable ${e}`);
  if (!fired.artifacts) log(`semgrep-rule-modes: no Semgrep or Opengrep SARIF under ${dirs.join(', ')} — nothing was measured`);
  log(`semgrep-rule-modes: ${fired.counts.size} fired rule(s), ${want.length} fetched, ${open.length} without a mode · ${tablePath}`);
  return open.length || fired.unreadable.length || local.errors.length || !fired.artifacts ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  if (a.error) {
    console.error(`semgrep-rule-modes: ${a.error}\nusage: node bin/semgrep-rule-modes.mjs fetch <reports dir>… [--refresh] · status <reports dir>…`);
    process.exit(2);
  }
  if (a.cmd === 'status') {
    process.stdout.write(`${JSON.stringify(status(a), null, 1)}\n`);
    process.exit(0);
  }
  process.exit(await fetchModes(a));
}

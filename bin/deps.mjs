// bin/deps.mjs — `commitwork deps`: npm package version auditing, dependency-update
// proposals, opt-in merges, and the update-lifecycle history.
//
// usage: commitwork deps [dir] [--json] [--audit-gate [level]] [--update [--tui] [--merge] [--dry-run]] [--history [--out <file>]]
//
// Without --update it reports how far each direct dependency is behind and which advisories an
// upgrade clears; --audit-gate turns that into a gate on shipped advisories. --update proposes the
// updates on a branch commitwork/deps-<id>, and --history writes the update-lifecycle page.
//
// What --update may change is the operator's (settings depsProdUpdateTypes, depsDevUpdateTypes,
// depsAutoMergeTypes, depsCooldownDays; or this run's flags), narrowed by the repository's committed
// .github/dependency-updates.json. Every audit and update is recorded in the deps ledger unless the
// run passes the no-record flag.
//
// exit: 0 done (audit printed, gate clear, proposal made or merged, nothing to do) · 2 usage error ·
// 21 --audit-gate: a shipped advisory at the level has an available fix · 22 not measured (no npm
// lockfile, npm could not run, or an advisory's fix is undetermined) · 23 the update was refused or
// failed, or the history could not be read · 24 proposed, but --merge was refused
//
// env, read at call time: CW_NOW, CW_NPM, CW_DEPS_LEDGER, COMMITWORK_TRUST_REPO_MANIFEST, and each setting's own.
import { realpathSync } from 'node:fs';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { getSetting } from '../monitor/settings.mjs';
import { auditProject, renderAuditText, gate, AUDIT_LEVELS, UPDATE_KINDS, UPDATE_TYPES, COOLDOWN_WHY, cooldownOf } from './lib/npm-versions.mjs';
import { operatorPolicy, resolvePolicy, validateKinds, POLICY_FILE } from './lib/update-policy.mjs';
import { proposeUpdates, locate, readRepoPolicy } from './lib/npm-update.mjs';
import { appendEvent, readLedger, ledgerPath, snapshotOf } from './lib/deps-ledger.mjs';
import { buildHistory, renderHistoryHtml } from './lib/deps-history.mjs';
import { initialPicker, runPicker } from './lib/checkbox-tui.mjs';

export const EXIT = { OK: 0, USAGE: 2, ACTIONABLE: 21, UNMEASURED: 22, FAILED: 23, MERGE_REFUSED: 24 };

export const HELP = `commitwork deps — npm package versions, advisories and dependency updates

  commitwork deps [dir]                     how far each direct dependency is behind, and its advisories
  commitwork deps [dir] --audit-gate [lvl]  exit 21 when a shipped advisory at lvl+ (default high) has a fix
  commitwork deps [dir] --update            propose updates on a branch commitwork/deps-<id>
  commitwork deps --history [--out <file>]  write the update-lifecycle history page

  --json                  the audit as JSON
  --include-dev           the gate counts devDependencies, which do not ship
  --patch --minor --major --lockfile --advisories
                          the update kinds this run takes, for production and dev packages alike
  --prod <kinds> --dev <kinds>
                          the kinds per exposure, comma-separated (patch,minor,major,lockfile,advisories)
  --cooldown <days>|patch=N,minor=N,major=N
                          release age required before an update is proposed (advisory fixes are exempt)
  --merge                 merge the proposal when every change is in --automerge (or the depsAutoMergeTypes
                          setting), the repository's own tests pass, and shipped advisories do not rise
  --automerge <kinds>     the kinds this run may merge
  --tui                   choose the types and packages in the terminal
  --dry-run               show what --update would propose, change nothing
  --no-record             write nothing to the deps ledger
  --trust-repo-manifest   obey the repository's .npmrc, and run its tests for --merge
                          (also COMMITWORK_TRUST_REPO_MANIFEST=1)

  Settings: depsProdUpdateTypes, depsDevUpdateTypes, depsAutoMergeTypes, depsCooldownDays (panel → Settings).
  A repository narrows them with ${POLICY_FILE}.
  Cooldown: ${COOLDOWN_WHY}.
`;

function parseKinds(v, flag) {
  const list = String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const err = validateKinds(list, flag);
  if (err) throw new UsageError(err);
  return list;
}

class UsageError extends Error {}

function parseCooldown(v) {
  const s = String(v ?? '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  const out = {};
  for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(patch|minor|major)=(\d+)$/.exec(part);
    if (!m) throw new UsageError(`--cooldown takes a number of days or patch=N,minor=N,major=N (got ${JSON.stringify(s)})`);
    out[m[1]] = Number(m[2]);
  }
  if (!Object.keys(out).length) throw new UsageError('--cooldown needs a value');
  return out;
}

export function parseDepsArgs(argv) {
  const o = { positional: [], kinds: [], json: false, gate: null, includeDev: false, update: false, merge: false, tui: false, dryRun: false,
    record: true, trust: false, history: false, out: null, prod: undefined, dev: undefined, automerge: undefined, cooldown: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`); return argv[++i]; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--audit-gate') { o.gate = 'high'; if (AUDIT_LEVELS.includes(argv[i + 1])) o.gate = argv[++i]; }
    else if (a === '--include-dev') o.includeDev = true;
    else if (a === '--update') o.update = true;
    else if (a === '--merge') o.merge = true;
    else if (a === '--tui') o.tui = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-record') o.record = false;
    else if (a === '--trust-repo-manifest') o.trust = true;
    else if (a === '--history') o.history = true;
    else if (a === '--out') o.out = val();
    else if (a === '--prod') o.prod = parseKinds(val(), '--prod');
    else if (a === '--dev') o.dev = parseKinds(val(), '--dev');
    else if (a === '--automerge') o.automerge = parseKinds(val(), '--automerge');
    else if (a === '--cooldown') o.cooldown = parseCooldown(val());
    else if (/^--(patch|minor|major|lockfile|advisories)$/.test(a)) o.kinds.push(a.slice(2));
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a} (commitwork deps --help)`);
    else o.positional.push(a);
  }
  if (o.kinds.length) { o.prod = o.prod ?? [...o.kinds]; o.dev = o.dev ?? [...o.kinds]; }
  if ((o.merge || o.tui || o.dryRun) && !o.update) throw new UsageError(`${o.merge ? '--merge' : o.tui ? '--tui' : '--dry-run'} applies to --update`);
  if (o.positional.length > 1) throw new UsageError('one project directory at most');
  return o;
}

const settingValues = () => Object.fromEntries(['depsProdUpdateTypes', 'depsDevUpdateTypes', 'depsAutoMergeTypes', 'depsCooldownDays'].map((k) => [k, getSetting(k).value]));

function recorder(enabled, say) {
  if (!enabled) return () => {};
  let off = false;
  return (event) => {
    if (off) return;
    try { appendEvent(event); } catch (e) { off = true; say(`  not recorded in the deps ledger: ${e.message}`); }
  };
}

export async function runDeps(argv, { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s), env = process.env } = {}) {
  let o;
  try { o = parseDepsArgs(argv); } catch (e) {
    if (e instanceof UsageError) { err(`commitwork deps: ${e.message}\n`); return EXIT.USAGE; }
    throw e;
  }
  if (o.help) { out(HELP); return EXIT.OK; }
  const nowMs = env.CW_NOW ? Date.parse(env.CW_NOW) : Date.now();
  if (!Number.isFinite(nowMs)) { err(`commitwork deps: CW_NOW is not a date: ${env.CW_NOW}\n`); return EXIT.USAGE; }
  const trustRepo = o.trust || env.COMMITWORK_TRUST_REPO_MANIFEST === '1';
  const say = (s) => err(`${s}\n`);
  const operator = operatorPolicy({ settings: settingValues(), flags: { prod: o.prod, dev: o.dev, automerge: o.automerge, cooldown: o.cooldown } });

  if (o.history) {
    const l = readLedger();
    if (l.error) { say(`commitwork deps: ${l.error}`); return EXIT.FAILED; }
    if (l.torn) say(`  the ledger's last line is an incomplete append (${l.torn} bytes) and was not read`);
    const cd = cooldownOf(operator.cooldown);
    const firstWindow = Math.max(cd.patch, cd.minor) + 7;
    const h = buildHistory(l.events, { nowMs, within: [...new Set([firstWindow, 30])].sort((a, b) => a - b) });
    const file = o.out ? (isAbsolute(o.out) ? o.out : resolve(process.cwd(), o.out)) : join(dirname(l.path), 'deps-history.html');
    writeAtomic(file, renderHistoryHtml(h, { cooldown: Math.max(cd.patch, cd.minor) }), { mkdir: true });
    const hl = h.headline;
    out(`deps history · ${h.projects.length} project(s) · ${hl.releases} release(s) found · ${hl.applied} applied · ${hl.open} open\n`);
    out(`  median days from release to applied: ${hl.medianApplyDays === null ? '—' : hl.medianApplyDays.toFixed(1)}`
      + ` · patch releases applied within ${h.within.map((n) => `${n} d: ${hl.patchWithin[n].applied} of ${hl.patchWithin[n].of}`).join(' · ')}\n`);
    out(`  backlog at the first audit: ${hl.backlog.releases} release(s), ${hl.backlog.applied} applied since (kept out of the lags)\n`);
    out(`  ${file}\n`);
    return EXIT.OK;
  }

  const dir = resolve(process.cwd(), o.positional[0] || '.');
  let loc = null;
  try { loc = locate(dir); } catch { loc = null; }
  let repoPolicy = null;
  if (loc) {
    const rp = readRepoPolicy(loc.top, loc.base);
    if (rp.error) {
      if (o.update) { say(`commitwork deps: ${rp.error} — refused: an unreadable policy is not "no policy"`); return EXIT.FAILED; }
      say(`  ${rp.error} — this audit uses your settings alone`);
    } else repoPolicy = rp.policy ?? null;
  } else if (o.update) { say(`commitwork deps: ${dir} is not inside a git repository with a commit; --update proposes a branch, so it needs one`); return EXIT.FAILED; }
  const policy = resolvePolicy(operator, repoPolicy);
  const record = recorder(o.record && !o.dryRun, say);

  if (!o.update) {
    const report = await auditProject(dir, { cooldown: policy.cooldown, nowMs, trustRepo });
    if (!report.error) {
      let top = dir;
      try { top = loc?.top ?? realpathSync(dir); } catch { top = dir; }
      record({ at: new Date(nowMs).toISOString(), event: 'audit', repo: top, pkgPath: loc?.pkgPath ?? '.', commit: loc?.base ?? null, ...snapshotOf(report) });
    }
    if (o.json) out(`${JSON.stringify({ ...report, policy }, null, 2)}\n`);
    else out(renderAuditText(report, { types: policy.update.prod.filter((k) => UPDATE_TYPES.includes(k)) }));
    if (report.error) return EXIT.UNMEASURED;
    if (!o.gate) return EXIT.OK;
    const g = gate(report.advisories, { level: o.gate, includeDev: o.includeDev });
    const scope = `${o.includeDev ? '' : 'shipped '}advisories at ${o.gate} or above${o.includeDev ? ' (dev included)' : ''}`;
    if (g.verdict === 'actionable') { out(`  gate: ${g.actionable.length} ${scope} can be fixed now: ${g.actionable.map((r) => `${r.name} (${r.fix.state}${r.fix.to ? ` → ${r.fix.to}` : ''})`).join(', ')}\n`); return EXIT.ACTIONABLE; }
    if (g.verdict === 'unmeasured') { out(`  gate: not measured — ${g.reason || `${g.undetermined.length} ${scope} have an undetermined fix: ${g.undetermined.map((r) => r.name).join(', ')}`}\n`); return EXIT.UNMEASURED; }
    out(`  gate: clear — ${g.inScope} ${scope}${g.unpatched.length ? `, ${g.unpatched.length} with no patched release published (${g.unpatched.map((r) => r.name).join(', ')})` : ''}\n`);
    return EXIT.OK;
  }

  let selection = null;
  let merge = o.merge;
  if (o.tui) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) { say('commitwork deps: --tui needs an interactive terminal'); return EXIT.USAGE; }
    const report = await auditProject(dir, { cooldown: policy.cooldown, nowMs, trustRepo });
    if (report.error) { say(`commitwork deps: ${report.error}`); return EXIT.UNMEASURED; }
    const types = UPDATE_TYPES.filter((t) => operator.prod.includes(t) || operator.dev.includes(t));
    const picked = await runPicker({ report, operator, repoPolicy,
      initial: initialPicker({ types, lockfile: true, advisories: true, merge: o.merge, trustRepo }) });
    if (!picked) { out('  cancelled — nothing proposed\n'); return EXIT.OK; }
    selection = picked;
    merge = picked.merge;
    const withT = (kinds) => [...kinds.filter((k) => !UPDATE_TYPES.includes(k)), ...picked.types];
    Object.assign(operator, { prod: withT(operator.prod), dev: withT(operator.dev) });
  }
  const effective = resolvePolicy(operator, repoPolicy);
  for (const n of effective.narrowed) say(`  ${n}`);
  const r = await proposeUpdates({ dir, policy: effective, selection, merge, trustRepo, dryRun: o.dryRun, nowMs, record });
  out(renderUpdate(r));
  if (r.state === 'refused' || r.state === 'error') return EXIT.FAILED;
  if (merge && r.mergeRefused) return EXIT.MERGE_REFUSED;
  return EXIT.OK;
}

export function renderUpdate(r) {
  const lines = [];
  const head = { planned: 'would propose', nothing: 'nothing to update', exists: 'already proposed', proposed: 'proposed', merged: 'merged', refused: 'refused', error: 'failed' }[r.state] || r.state;
  lines.push(`deps update · ${head}${r.branch ? ` · ${r.branch}` : ''}${r.reason ? ` — ${r.reason}` : ''}`);
  for (const d of r.direct || []) lines.push(`  ${d.name} ${d.from} → ${d.version} (${d.type})`);
  if (r.state === 'planned') {
    if (r.lockfile) lines.push('  and a lockfile refresh within declared ranges');
    if (r.advisories) lines.push('  and npm audit fix');
  }
  if (r.changes) {
    const by = (s) => r.changes.filter((c) => c.step === s).length;
    lines.push(`  ${r.changes.length} package(s) changed: direct ${by('direct')} · lockfile ${by('lockfile')} · advisories ${by('advisories')}`);
  }
  for (const n of r.notes || []) lines.push(`  ${n}`);
  if (r.auditAfter && !r.auditAfter.advisories.error) {
    const b = r.auditBefore.advisories;
    const a = r.auditAfter.advisories;
    if (!b.error) lines.push(`  shipped critical/high advisories: ${b.prod.critical + b.prod.high} → ${a.prod.critical + a.prod.high} · all: ${b.counts.critical + b.counts.high} → ${a.counts.critical + a.counts.high}`);
  }
  if (r.superseded?.length) lines.push(`  superseded: ${r.superseded.map((s) => s.branch).join(', ')}`);
  if (r.gate) lines.push(`  merge gate (${r.gate.rung}): ${r.gate.result} — ${r.gate.detail}`);
  if (r.mergeRefused) lines.push(`  not merged: ${r.mergeRefused}`);
  if (r.state === 'proposed') lines.push(`  review: git -C ${r.top} log -p ${r.baseBranch || 'HEAD'}..${r.branch}`);
  if (r.state === 'exists') lines.push(`  review or merge ${r.branch} yourself, or delete it to propose again`);
  if (r.verified) lines.push(`  verified: ${r.verified.landed && r.verified.pinned ? 'the branch holds every recorded change' : `landed ${r.verified.landed}, lockfile matches ${r.verified.pinned}`}`);
  return `${lines.join('\n')}\n`;
}

export const _test = { parseCooldown, UPDATE_KINDS };

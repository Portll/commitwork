#!/usr/bin/env node
// commitwork races — race-condition / concurrency-defect scanner for a target
// directory, project, repository, or workspace.
//
//   node bin/races.mjs [path] [--project <name>] [--workspace <dir>]
//                      [--services a,b,c] [--engines spotbugs,semgrep,eslint,codeql,infer]
//                      [--deep] [--out <dir>]
//
// Targeting (one of):
//   path                positional — scan that repo/directory
//   --project <name>    entry from monitor/projects.json (path + expand + exclude honored)
//   --workspace <dir>   scan every direct child that looks like a repo/module
//
// Engines (fast set runs by default; --deep adds the expensive ones):
//   spotbugs   Java  MT_CORRECTNESS bug category over compiled classes/jars   [fast]
//   semgrep    Java  embedded heuristic concurrency rules (see RULES below)   [fast]
//   eslint     JS/TS require-atomic-updates via the module's own eslint setup [fast]
//   codeql     Java  "Likely Bugs/Concurrency" query pack, --build-mode=none  [--deep]
//   infer      Java  RacerD interprocedural data-race pilot                   [--deep]
//
// Output layout (per target area, under <reportsRoot>/<the area's report dir>/races/ — resolved by
// monitor/area.mjs, so the fleet's slug `clientA` lands in its declared out dir clientA-monorepo):
//   output/<stamp>/   raw engine artifacts + findings.json + _run logs
//   docs/REPORT.md    regenerated human report with trend table
//   docs/history.jsonl append-only per-run counts (the historic numbers)
//
// Zero deps.

import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandHome } from '../monitor/discover.mjs';
import { outDirFor } from '../monitor/area.mjs'; // THE OUT resolver — slug (clientA) != out (clientA-monorepo)
import { loadRegistry } from '../monitor/registry.mjs';
import { readSarif } from '../monitor/sarif-read.mjs'; // the one SARIF reader

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const tty = process.stdout.isTTY;
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s), dim = (s) => c('2', s), red = (s) => c('31', s), grn = (s) => c('32', s), yel = (s) => c('33', s), cy = (s) => c('36', s);

// ── args ──────────────────────────────────────────────────────────────────
const A = process.argv.slice(2);
const opt = (k) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : undefined; };
const flag = (k) => A.includes(k);
const positional = A.find((a, i) => !a.startsWith('--') && (i === 0 || !A[i - 1].startsWith('--') || A[i - 1] === '--deep'));

// FAIL LOUD: a broken registry used to silently empty EXCLUDE/LIFECYCLE here, which does not
// read as "no data" (this tool's usual silent-green) but as the INVERSE — scan everything,
// including retired/superseded services — so findings on dead code would read as findings on the
// live fleet. Stop rather than scan under a false scope.
const REG = loadRegistry();
const EXCLUDE = new Set(REG.exclude || []);
// lifecycle: superseded repos (rollback standby) leave ACTIVE scan scope — same effectiveFrom/
// effectiveTo 14-digit-stamp gate as monitor/sweep.mjs; recorded distinctly, never silently dropped.
const LIFECYCLE = REG.lifecycle || {};
const lcStamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const lcSuperseded = (n) => { const l = LIFECYCLE[n]; return !!(l && l.state === 'superseded' && !EXCLUDE.has(n) && l.effectiveFrom && lcStamp >= l.effectiveFrom && (!l.effectiveTo || lcStamp < l.effectiveTo)); };

let target, area, expandChildren = false;
if (opt('--project')) {
  const p = (REG.projects || []).find((x) => x.name === opt('--project'));
  if (!p) { console.error(red(`unknown project '${opt('--project')}' — known: ${(REG.projects || []).map((x) => x.name).join(', ')}`)); process.exit(2); }
  target = resolve(expandHome(p.path)); area = p.area || p.name; expandChildren = p.expand === 'children';
} else if (opt('--workspace')) {
  target = resolve(opt('--workspace')); area = basename(target); expandChildren = true;
} else {
  target = resolve(positional || process.cwd()); area = basename(target);
}
if (!existsSync(target)) { console.error(red(`target not found: ${target}`)); process.exit(2); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// OUT-equivalent: this used to be `join(reportsRoot, area, 'races')`, i.e. the area SLUG used as a
// report DIRECTORY. Those are two different identifiers (registry.mjs): when projects[].area became
// the slug `clientA`, this silently moved the fleet's races output from reports/clientA-monorepo/races
// (where sitemap-overlays.mjs:108 reads it) to reports/clientA/races. The resolver maps slug -> out,
// which restores that path and routes a scoped sweep's races into the area the sweep is scanning.
// A --workspace/positional scan passes a plain directory basename, which is not a declared area:
// the resolver returns reports/<that name>/ for it, exactly as this line did before.
const areaRoot = opt('--out') ? resolve(opt('--out')) : join(outDirFor(area, REG), 'races');
const outDir = join(areaRoot, 'output', stamp);
const docsDir = join(areaRoot, 'docs');
mkdirSync(outDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

// ── module discovery ────────────────────────────────────────────────────────
const isJava = (d) => ['build.gradle', 'build.gradle.kts', 'pom.xml'].some((f) => existsSync(join(d, f)));
const isNode = (d) => existsSync(join(d, 'package.json'));
function childModules(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !['node_modules', 'build', 'dist'].includes(e.name))
    .map((e) => join(dir, e.name))
    .filter((p) => isJava(p) || isNode(p));
}
// Monorepo child dir: 'services' is ONE fleet's layout, not a universal one. Repos that group
// modules under modules/ apps/ packages/ used to fall through silently and get scanned as a single
// module — a whole-repo race scan that quietly covered one build file. Configurable
// (--child-dir a,b / CW_MONOREPO_CHILD_DIRS), defaulting to today's 'services', and the fallback
// is ANNOUNCED (below) and recorded in findings.json, never silent.
const CHILD_DIRS = String(opt('--child-dir') || process.env.CW_MONOREPO_CHILD_DIRS || 'services')
  .split(',').map((s) => s.trim()).filter(Boolean);
let childRoot = null;
if (expandChildren) childRoot = target;
else childRoot = CHILD_DIRS.map((d) => join(target, d)).find((p) => existsSync(p)) || null;
if (!expandChildren && !childRoot) {
  console.log(yel(`  no monorepo child dir under ${basename(target)} (looked for: ${CHILD_DIRS.join(', ')}) — scanning it as a SINGLE module`));
  console.log(dim(`  if this repo groups modules elsewhere, pass --child-dir <name[,name]> or set CW_MONOREPO_CHILD_DIRS`));
}
let modules = childRoot ? childModules(childRoot) : [target];
const names = childRoot ? modules.map((m) => basename(m)) : [];
const skipped = names.filter((n) => EXCLUDE.has(n));
const standby = names.filter((n) => lcSuperseded(n));
modules = modules.filter((m) => !EXCLUDE.has(basename(m)) && !lcSuperseded(basename(m)));
const onlyServices = opt('--services') ? new Set(opt('--services').split(',').map((s) => s.trim())) : null;
if (onlyServices) modules = modules.filter((m) => onlyServices.has(basename(m)));
if (!modules.length) { console.error(red('no scannable modules found (need build.gradle/pom.xml/package.json)')); process.exit(2); }

// ── embedded semgrep rules (heuristic tier — review candidates, not verdicts) ──
const RULES = `rules:
  - id: races.simpledateformat-shared-field
    languages: [java]
    severity: ERROR
    message: "SimpleDateFormat held in a field — not thread-safe; Spring singletons share fields across request threads. Use DateTimeFormatter (immutable) or a per-call instance."
    patterns:
      - pattern: SimpleDateFormat $F = new SimpleDateFormat(...);
      - pattern-not-inside: |
          $RT $M(...) { ... }
  - id: races.lazy-init-check-then-act
    languages: [java]
    severity: WARNING
    message: "Unsynchronized check-then-act lazy init — two threads can both observe null and initialize twice (or publish a partially-built object)."
    patterns:
      - pattern: |
          if ($F == null) { ... $F = $INIT; ... }
      - pattern-not-inside: |
          synchronized (...) { ... }
      - pattern-not-inside: |
          synchronized $RT $M(...) { ... }
  - id: races.static-mutable-collection
    languages: [java]
    severity: WARNING
    message: "Static mutable collection — unsynchronized concurrent mutation corrupts HashMap/ArrayList state. Use ConcurrentHashMap / CopyOnWriteArrayList or confine writes."
    patterns:
      - pattern-either:
          - pattern: static Map<$K, $V> $F = new HashMap<>(...);
          - pattern: static List<$T> $F = new ArrayList<>(...);
          - pattern: static Set<$T> $F = new HashSet<>(...);
`;
const rulesPath = join(outDir, '_rules.semgrep.yml');
writeFileSync(rulesPath, RULES);

// ── engine registry ─────────────────────────────────────────────────────────
const sh = (cmd, cwd, timeoutMin = 20) => spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMin * 60 * 1000 });
const have = (tool) => spawnSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' }).status === 0;
const log = (mod, engine, r) => writeFileSync(join(outDir, `_run-${engine}-${basename(mod)}.log`), `$ (${mod})\n[stdout]\n${r.stdout || ''}\n[stderr]\n${r.stderr || ''}`);

const ENGINES = {
  spotbugs: {
    langs: 'java', tier: 'fast', install: 'brew install spotbugs',
    run(mod, findings) {
      const classes = join(mod, 'build/classes/java/main');
      const jars = existsSync(join(mod, 'build/libs')) ? readdirSync(join(mod, 'build/libs')).filter((f) => f.endsWith('.jar')) : [];
      const src = existsSync(classes) ? classes : jars.length ? join(mod, 'build/libs', jars[0]) : null;
      if (!src) return 'skipped:not-built';
      const xml = join(outDir, `spotbugs-${basename(mod)}.xml`);
      const r = sh(`spotbugs -textui -low -bugCategories MT_CORRECTNESS -xml:withMessages -output "${xml}" "${src}"`, mod);
      log(mod, 'spotbugs', r);
      if (!existsSync(xml)) return 'error:no-output';
      const doc = readFileSync(xml, 'utf8');
      for (const m of doc.matchAll(/<BugInstance[^>]*type="([^"]+)"[^>]*priority="(\d)"[^>]*category="MT_CORRECTNESS"[\s\S]*?<\/BugInstance>/g)) {
        const src2 = m[0].match(/<SourceLine[^>]*sourcepath="([^"]+)"[^>]*start="(\d+)"/);
        const msg = m[0].match(/<LongMessage>([\s\S]*?)<\/LongMessage>/);
        findings.push({ engine: 'spotbugs', module: basename(mod), ruleId: m[1], severity: m[2] === '1' ? 'high' : m[2] === '2' ? 'medium' : 'low', file: src2 ? src2[1] : '?', line: src2 ? +src2[2] : 0, message: (msg ? msg[1] : m[1]).trim().slice(0, 300) });
      }
      return 'ran';
    },
  },
  semgrep: {
    langs: 'java', tier: 'fast', install: 'brew install semgrep', batch: true,
    run(mods, findings) {
      const javaMods = mods.filter(isJava);
      if (!javaMods.length) return 'skipped:no-java';
      const sarif = join(outDir, 'semgrep-races.sarif');
      const r = sh(`semgrep --config "${rulesPath}" --sarif --output "${sarif}" --metrics=off ${javaMods.map((m) => `"${m}"`).join(' ')}`, target);
      log(target, 'semgrep', r);
      // Typed read: a husk must never read as 'ran' with zero findings
      const rep = readSarif(sarif);
      if (rep.state === 'absent' || rep.state === 'unreadable' || rep.state === 'empty' || rep.state === 'unparseable') return 'error:no-output';
      if (rep.state === 'never-ran' || rep.state === 'tool-failed') return `error:tool-failed — ${(rep.reason || '').slice(0, 120)}`;
      for (const run of rep.runs) for (const res of run.results) {
        const loc = res.locations?.[0]?.physicalLocation;
        const file = loc?.artifactLocation?.uri || '?';
        const mod = javaMods.map((m) => basename(m)).find((m) => file.includes(`/${m}/`) || file.startsWith(`${m}/`)) || basename(javaMods[0]);
        findings.push({ engine: 'semgrep', module: mod, ruleId: res.ruleId, severity: res.level === 'error' ? 'high' : res.level === 'note' ? 'low' : 'medium', file, line: loc?.region?.startLine || 0, message: (res.message?.text || res.ruleId).slice(0, 300) });
      }
      return 'ran';
    },
  },
  eslint: {
    langs: 'node', tier: 'fast', install: '(the module’s own node_modules/.bin/eslint, else a pinned fetch)',
    run(mod, findings) {
      const hasCfg = readdirSync(mod).some((f) => /^\.eslintrc(\.|$)|^eslint\.config\./.test(f));
      if (!hasCfg) return 'skipped:no-eslint-config';
      const out = join(outDir, `eslint-${basename(mod)}.json`);
      // The header has always claimed this uses "the module's own eslint setup"; `npx --yes eslint`
      // did NOT do that — a bare `npx <name>` only prefers a local binary when no version is asked
      // for, and in a module whose eslint is a transitive/hoisted install it silently fetched the
      // registry's latest instead, which is both an unpinned scan-time fetch and a different
      // linter from the one the module is developed against (eslint 10 does not read .eslintrc at
      // all, so a legacy-config module was being graded by a tool that cannot read its config).
      // So: run the module's own binary when it has one — that is the documented intent, made
      // true — and only otherwise fetch, at an exact pin. eslint@10.8.1 is the registry latest as
      // of 2026-08-20, i.e. the same thing the unpinned form resolved to that day; the fallback
      // therefore changes no result, it only makes the result reproducible tomorrow.
      const localBin = join(mod, 'node_modules', '.bin', 'eslint');
      const bin = existsSync(localBin) ? `"${localBin}"` : 'npx --yes eslint@10.8.1';
      const r = sh(`${bin} . --rule '{"require-atomic-updates":"error"}' -f json -o "${out}" || true`, mod, 10);
      log(mod, 'eslint', r);
      const j = safeJSON(out);
      if (!j) return 'error:no-output';
      for (const f of j) for (const m of f.messages || []) {
        if (m.ruleId !== 'require-atomic-updates') continue;
        findings.push({ engine: 'eslint', module: basename(mod), ruleId: m.ruleId, severity: 'high', file: relative(mod, f.filePath), line: m.line || 0, message: (m.message || '').slice(0, 300) });
      }
      return 'ran';
    },
  },
  codeql: {
    langs: 'java', tier: 'deep', install: 'brew install codeql',
    run(mod, findings) {
      if (!isJava(mod)) return 'skipped:not-java';
      const db = join(outDir, `codeql-db-${basename(mod)}`);
      const sarif = join(outDir, `codeql-${basename(mod)}.sarif`);
      let r = sh(`codeql database create "${db}" --language=java --build-mode=none --source-root "${mod}" --overwrite`, mod, 30);
      log(mod, 'codeql-create', r);
      if (r.status !== 0) return 'error:db-create';
      r = sh(`codeql database analyze "${db}" "codeql/java-queries:Likely Bugs/Concurrency" --format=sarif-latest --output "${sarif}" --download`, mod, 30);
      log(mod, 'codeql-analyze', r);
      // Same typed read as the semgrep engine
      const rep = readSarif(sarif);
      if (rep.state === 'absent' || rep.state === 'unreadable' || rep.state === 'empty' || rep.state === 'unparseable') return 'error:no-output';
      if (rep.state === 'never-ran' || rep.state === 'tool-failed') return `error:tool-failed — ${(rep.reason || '').slice(0, 120)}`;
      for (const run of rep.runs) for (const res of run.results) {
        const loc = res.locations?.[0]?.physicalLocation;
        findings.push({ engine: 'codeql', module: basename(mod), ruleId: res.ruleId, severity: res.level === 'error' ? 'high' : res.level === 'note' ? 'low' : 'medium', file: loc?.artifactLocation?.uri || '?', line: loc?.region?.startLine || 0, message: (res.message?.text || res.ruleId).slice(0, 300) });
      }
      return 'ran';
    },
  },
  infer: {
    langs: 'java', tier: 'deep', install: 'brew install infer  # RacerD pilot — verify javac capture on this JDK first',
    run(mod, findings) {
      if (!isJava(mod) || !existsSync(join(mod, 'gradlew')) && !existsSync(join(target, 'gradlew'))) return 'skipped:no-gradlew';
      const r = sh(`infer run --racerd-only --results-dir "${join(outDir, `infer-${basename(mod)}`)}" -- ./gradlew compileJava --no-daemon`, mod, 30);
      log(mod, 'infer', r);
      const j = safeJSON(join(outDir, `infer-${basename(mod)}`, 'report.json'));
      if (!j) return r.status === 0 ? 'ran' : 'error:capture';
      for (const f of j) findings.push({ engine: 'infer', module: basename(mod), ruleId: f.bug_type, severity: f.severity === 'ERROR' ? 'high' : 'medium', file: f.file, line: f.line, message: (f.qualifier || '').slice(0, 300) });
      return 'ran';
    },
  },
};

const requested = opt('--engines') ? opt('--engines').split(',').map((s) => s.trim())
  : Object.keys(ENGINES).filter((k) => ENGINES[k].tier === 'fast' || flag('--deep'));

// ── run ─────────────────────────────────────────────────────────────────────
function safeJSON(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
console.log(bold('commitwork races') + dim(`  target=${area}  modules=${modules.length}  engines=[${requested.join(',')}]  out=${relative(ROOT, outDir)}`));
if (skipped.length) console.log(dim(`  excluded (projects.json): ${skipped.join(', ')}`));
if (standby.length) console.log(dim(`  superseded (rollback standby, out of active scope): ${standby.join(', ')}`));

const findings = [];
const engineStatus = {};
for (const id of requested) {
  const e = ENGINES[id];
  if (!e) { engineStatus[id] = 'unknown-engine'; console.log(`  ${red('✗')} ${id.padEnd(10)} ${red('unknown engine')}`); continue; }
  if (id !== 'eslint' && !have(id)) { engineStatus[id] = `missing (${e.install})`; console.log(`  ${yel('○')} ${id.padEnd(10)} ${yel('not installed — ' + e.install)}`); continue; }
  process.stdout.write(`  ${cy('▸')} ${id.padEnd(10)} `);
  if (e.batch) {
    const st = e.run(modules, findings);
    engineStatus[id] = st;
    console.log(st === 'ran' ? grn('done') : yel(st));
    continue;
  }
  const per = {};
  for (const mod of modules) {
    if (e.langs === 'java' && !isJava(mod)) { per[basename(mod)] = 'skipped:not-java'; continue; }
    if (e.langs === 'node' && !isNode(mod)) { per[basename(mod)] = 'skipped:not-node'; continue; }
    per[basename(mod)] = e.run(mod, findings);
  }
  const ran = Object.values(per).filter((s) => s === 'ran').length;
  const skip = Object.values(per).filter((s) => s.startsWith('skipped')).length;
  const err = Object.values(per).filter((s) => s.startsWith('error')).length;
  engineStatus[id] = { ran, skipped: skip, errors: err, detail: per };
  console.log(`${grn(`${ran} ran`)}${skip ? dim(` · ${skip} skipped`) : ''}${err ? red(` · ${err} errors`) : ''}`);
}

// ── aggregate + emit ────────────────────────────────────────────────────────
const totals = { high: 0, medium: 0, low: 0 };
const byEngine = {}, byModule = {};
for (const f of findings) {
  totals[f.severity]++;
  (byEngine[f.engine] ??= { high: 0, medium: 0, low: 0 })[f.severity]++;
  (byModule[f.module] ??= { high: 0, medium: 0, low: 0 })[f.severity]++;
}
// childRoot/childDirsTried/singleModuleFallback make the scan's SCOPE machine-readable: a run that
// found no child dir and scanned one module is a narrower scan than it looks, and the report says so.
writeFileSync(join(outDir, 'findings.json'), JSON.stringify({ target, area, stamp,
  childRoot: childRoot ? relative(target, childRoot) || '.' : null, childDirsTried: CHILD_DIRS,
  singleModuleFallback: !expandChildren && !childRoot,
  modules: modules.map((m) => basename(m)), excluded: skipped, superseded: standby, engines: engineStatus, totals, findings }, null, 2));

const histLine = { ts: new Date().toISOString(), stamp, area, target, engines: Object.fromEntries(Object.entries(engineStatus).map(([k, v]) => [k, typeof v === 'string' ? v : `ran:${v.ran}/skip:${v.skipped}/err:${v.errors}`])), totals, byEngine, modulesScanned: modules.length, modulesExcluded: skipped.length, modulesSuperseded: standby.length };
appendFileSync(join(docsDir, 'history.jsonl'), JSON.stringify(histLine) + '\n');

const history = readFileSync(join(docsDir, 'history.jsonl'), 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const prev = history.length > 1 ? history[history.length - 2] : null;
const delta = (k) => prev ? (totals[k] - (prev.totals?.[k] ?? 0)) : null;
const fmtDelta = (k) => { const d = delta(k); return d === null ? '' : d === 0 ? ' (±0)' : d > 0 ? ` (+${d})` : ` (${d})`; };

const md = [];
md.push(`# Race-condition scan — ${area}`, '');
md.push(`Target: \`${target}\` · run \`${stamp}\` · modules scanned: ${modules.length}${skipped.length ? ` · excluded: ${skipped.join(', ')}` : ''}${standby.length ? ` · superseded (rollback standby): ${standby.join(', ')}` : ''}`, '');
// state the scope honestly: a single-module fallback covers far less than a per-module sweep
if (!expandChildren && !childRoot) md.push(`> Scanned as a SINGLE module: no child dir found (looked for \`${CHILD_DIRS.join('`, `')}\`). If this repo groups modules elsewhere, re-run with \`--child-dir <name>\`.`, '');
md.push('## Engines', '', '| Engine | tier | status |', '|---|---|---|');
for (const id of requested) {
  const st = engineStatus[id];
  md.push(`| ${id} | ${ENGINES[id]?.tier || '?'} | ${typeof st === 'string' ? st : `ran ${st.ran} · skipped ${st.skipped} · errors ${st.errors}`} |`);
}
for (const id of Object.keys(ENGINES).filter((k) => !requested.includes(k))) md.push(`| ${id} | ${ENGINES[id].tier} | not requested${ENGINES[id].tier === 'deep' ? ' (use --deep)' : ''} |`);
md.push('', '## Totals', '', `| high | medium | low |`, '|---|---|---|', `| ${totals.high}${fmtDelta('high')} | ${totals.medium}${fmtDelta('medium')} | ${totals.low}${fmtDelta('low')} |`, '');
if (Object.keys(byModule).length) {
  md.push('## By module', '', '| Module | high | medium | low |', '|---|---|---|---|');
  for (const [m, s] of Object.entries(byModule).sort((a, b) => (b[1].high - a[1].high) || (b[1].medium - a[1].medium))) md.push(`| ${m} | ${s.high} | ${s.medium} | ${s.low} |`);
  md.push('');
}
if (findings.length) {
  md.push('## Findings', '');
  const top = [...findings].sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity]).slice(0, 100);
  md.push('| sev | engine | module | rule | location | message |', '|---|---|---|---|---|---|');
  for (const f of top) md.push(`| ${f.severity} | ${f.engine} | ${f.module} | ${f.ruleId} | ${f.file}:${f.line} | ${f.message.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
  if (findings.length > 100) md.push('', `_…and ${findings.length - 100} more — see \`output/${stamp}/findings.json\`._`);
  md.push('');
} else {
  md.push('## Findings', '', '_None from the engines that ran. Note which engines were missing/blocked above before reading this as a clean bill._', '');
}
md.push('## Trend', '', '| run | high | medium | low | engines |', '|---|---|---|---|---|');
for (const h of history.slice(-10)) md.push(`| ${h.stamp} | ${h.totals.high} | ${h.totals.medium} | ${h.totals.low} | ${Object.entries(h.engines).map(([k, v]) => `${k}:${v}`).join(' · ')} |`);
md.push('', `_Raw artifacts: \`${relative(ROOT, outDir)}/\` · heuristic semgrep rules are review candidates, not verdicts; spotbugs/codeql/infer findings are tool-verified patterns._`, '');
writeFileSync(join(docsDir, 'REPORT.md'), md.join('\n'));

console.log('');
console.log(bold('── races scan complete ──'));
console.log(`  findings: ${totals.high ? red(totals.high + ' high') : grn('0 high')} · ${totals.medium} medium · ${totals.low} low`);
console.log(`  report:  ${cy(join(docsDir, 'REPORT.md'))}`);
console.log(`  history: ${cy(join(docsDir, 'history.jsonl'))} (${history.length} runs)`);
console.log(`  raw:     ${cy(outDir)}`);

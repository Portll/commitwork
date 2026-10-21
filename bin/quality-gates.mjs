#!/usr/bin/env node
// commitwork quality-gates — per-service consolidation-bar gates (file-existence / grep only).
// Sibling of build-health.mjs: same CLI shape, same JSON report contract (top-level `status`).
// usage: node quality-gates.mjs <boot-test|contract-tests|openapi|ci|boot-test-pass> [repoPath]
// status vocabulary: present | partial | MISSING | n/a   (bad states UPPERCASE, like RED/MISMATCH)
// boot-test-pass adds RED (executed bootTest failed) and STALE (aged out / sha-mismatched); it is
// the one READER gate — consumes build-health boottest reports, never builds or runs anything.
import fs from 'node:fs';
import path from 'node:path';
import { scannedGitOut } from './lib/git-env.mjs';
import { fileURLToPath } from 'node:url';
import { registersBootTest, conventionFiles } from './lib/gradle-conventions.mjs';

const [, , sub, repoArg] = process.argv;
const repo = path.resolve(repoArg || process.env.COMMITWORK_REPO || '.');
const GATES = ['boot-test', 'contract-tests', 'openapi', 'ci', 'boot-test-pass'];
if (!GATES.includes(sub)) { process.stderr.write(`usage: quality-gates.mjs <${GATES.join('|')}> [repoPath]\n`); process.exit(2); }

const inRepo = (p) => path.join(repo, p);
const exists = (p) => fs.existsSync(inRepo(p));
const read = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return ''; } };
const isJava = () => ['build.gradle', 'build.gradle.kts', 'pom.xml'].some(exists);
const svc = path.basename(repo);
const root = (() => { try { return scannedGitOut(repo, ['rev-parse', '--show-toplevel']).trim(); } catch { return null; } })();

const SKIP = new Set(['node_modules', '.git', 'build', 'dist', 'target', '.gradle', 'out']);
function findFiles(dir, pred, cap = 20000) {
  const out = []; const stack = [dir];
  while (stack.length && out.length < cap) {
    const d = stack.pop();
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) stack.push(fp); }
      else if (pred(e.name)) out.push(fp);
    }
  }
  return out;
}
const emit = (o) => process.stdout.write(JSON.stringify({ tool: 'quality-gates', gate: sub, repo, service: svc, ...o }, null, 2) + '\n');
const na = (note) => emit({ applies: false, status: 'n/a', note });

// A Java tree without the Boot plugin or a @SpringBootApplication class is structural n/a, never MISSING.
// The `id` match is anchored so a spring-boot-dependencies BOM coordinate is not boot-app evidence.
// Judgment-call exemptions live in the private overlay (monitor/private/gate-exemptions.json), not here.
const hasBootApp = () => {
  const g = read(inRepo('build.gradle')) + read(inRepo('build.gradle.kts'));
  if (/^\s*id\s*\(?['"]org\.springframework\.boot['"]/m.test(g)) return true;
  return findFiles(inRepo('src/main'), (n) => n.endsWith('.java'))
    .some((f) => read(f).includes('@SpringBootApplication'));
};

if (sub === 'boot-test') {
  if (!isJava()) { na('not a Java service tree'); process.exit(0); }
  if (!hasBootApp()) { na('Java tree without a Spring Boot application (library/SPI jar) — nothing to boot'); process.exit(0); }
  // Boot-test evidence is the fleet convention (@Tag("boot") + @SpringBootTest), not a filename.
  const files = findFiles(inRepo('src/test'), (n) => n.endsWith('.java'));
  const withAnn = files.filter((f) => {
    const t = read(f);
    return t.includes('@SpringBootTest') && (f.endsWith('BootTest.java') || t.includes('@Tag("boot")'));
  });
  const gradle = read(inRepo('build.gradle')) + read(inRepo('build.gradle.kts'));
  // Task evidence: inline registration OR an applied conventions script; the predicate is shared
  // with build-health via lib/gradle-conventions.mjs so the two cannot drift.
  const boot = registersBootTest(gradle);
  const task = boot.registered;
  const status = withAnn.length && task ? 'present' : (withAnn.length || task) ? 'partial' : 'MISSING';
  emit({ applies: true, status, bootTestFiles: withAnn.map((f) => path.relative(repo, f)),
    gradleBootTestTask: task, bootTestTaskEvidence: boot.how, conventionFiles: conventionFiles() });
} else if (sub === 'contract-tests') {
  if (!isJava()) { na('not a Java service tree'); process.exit(0); }
  const files = findFiles(inRepo('src/test'), (n) => n.endsWith('ContractTest.java'));
  // No @FeignClient consumer edges → nothing to contract-test: n/a, not MISSING.
  if (!files.length) {
    const mains = findFiles(inRepo('src/main'), (n) => n.endsWith('.java'));
    const hasFeign = mains.some((f) => read(f).includes('@FeignClient'));
    if (!hasFeign) { na('no @FeignClient consumer edges in main source'); process.exit(0); }
  }
  emit({ applies: true, status: files.length ? 'present' : 'MISSING', contractTests: files.map((f) => path.relative(repo, f)) });
} else if (sub === 'openapi') {
  if (!isJava()) { na('not a Java service tree'); process.exit(0); }
  if (!hasBootApp()) { na('Java tree without a Spring Boot application — no owned HTTP surface to spec'); process.exit(0); }
  const spec = ['api/openapi.yml', 'api/openapi.yaml', 'api/openapi.json'].find(exists) || null;
  // Drift wiring: a listed script (CW_OPENAPI_DRIFT_SCRIPTS, repo-root-relative) must exist AND
  // name this service, or a workflow must name it with /drift/.
  const DRIFT_SCRIPTS = String(process.env.CW_OPENAPI_DRIFT_SCRIPTS
    || 'buildout/scripts/openapi-drift-check.sh,buildout/scripts/openapi_drift_check.py')
    .split(',').map((s) => s.trim()).filter(Boolean);
  let wired = false, wiredBy = null, driftNote = null;
  if (root) {
    const found = DRIFT_SCRIPTS.filter((p) => fs.existsSync(path.join(root, p)));
    const naming = found.find((p) => read(path.join(root, p)).includes(svc)) || null;
    if (found.length && naming) { wired = true; wiredBy = naming; }
    else { const wf = path.join(root, '.github/workflows'); let names = []; try { names = fs.readdirSync(wf); } catch {}
      for (const n of names) if (read(path.join(wf, n)).includes(svc) && /drift/i.test(read(path.join(wf, n)))) { wired = true; wiredBy = `.github/workflows/${n}`; break; } }
    // Say WHY it is not wired, so 'partial' reads as a fixable layout mismatch.
    if (!wired) driftNote = found.length
      ? `drift script(s) ${found.join(', ')} exist but do not name '${svc}', and no workflow mentions it with /drift/`
      : `none of the drift scripts exist under the repo root (looked for ${DRIFT_SCRIPTS.join(', ')}) and no workflow names '${svc}' with /drift/ — set CW_OPENAPI_DRIFT_SCRIPTS if this repo puts them elsewhere`;
  } else driftNote = 'not a git checkout — could not resolve the repo root to look for drift wiring';
  const status = spec && wired ? 'present' : spec ? 'partial' : 'MISSING';
  emit({ applies: true, status, spec, driftWired: wired, wiredBy, driftScripts: DRIFT_SCRIPTS, driftNote });
} else if (sub === 'ci') {
  if (!isJava() && !exists('package.json')) { na('no recognised build ecosystem'); process.exit(0); }
  let covered = false, coveredBy = null;
  // Anchored: the service must appear as a whole YAML list item (`- <svc>` on its own line) —
  // a bare .includes matched comments and path fragments.
  const svcItem = new RegExp(`^\\s*-\\s+${svc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  if (exists('.github/workflows')) { covered = true; coveredBy = '<service>/.github/workflows'; }
  else if (root) { const wf = path.join(root, '.github/workflows'); let names = []; try { names = fs.readdirSync(wf); } catch {}
    for (const n of names) if (svcItem.test(read(path.join(wf, n)))) { covered = true; coveredBy = `.github/workflows/${n}`; break; } }
  emit({ applies: true, status: covered ? 'present' : 'MISSING', coveredBy });
} else if (sub === 'boot-test-pass') {
  // Reader half of the executing boot gate: no executed batch → MISSING, executed+failed → RED,
  // pass older than CW_BOOTTEST_MAX_AGE_DAYS (default 7) or sha-mismatched → STALE. Never re-greps source.
  if (!isJava()) { na('not a Java service tree'); process.exit(0); }
  if (!hasBootApp()) { na('Java tree without a Spring Boot application (library/SPI jar) — nothing to boot'); process.exit(0); }
  const CW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const reportsRoot = path.join(CW, 'reports');
  const candidates = [];
  let batchDirs = []; try { batchDirs = fs.readdirSync(reportsRoot); } catch { /* no reports tree */ }
  for (const b of batchDirs) {
    const f = path.join(reportsRoot, b, svc, 'build-health-boottest.json');
    if (!fs.existsSync(f)) continue;
    try {
      const j = JSON.parse(read(f));
      const jr = (j.results || []).find((x) => x.lang === 'java' && x.ran && x.executed);
      if (jr) candidates.push({ batch: b, report: path.relative(CW, f), mtime: fs.statSync(f).mtimeMs, ...jr });
    } catch { /* unparseable report = no evidence */ }
  }
  if (!candidates.length) {
    emit({ applies: true, status: 'MISSING', note: 'void — no EXECUTED bootTest report for this service under commitwork reports/*; run ci/run-ci.sh <service-path> (build-health boottest, groups ci|boot)' });
  } else {
    candidates.sort((a, b2) => String(a.executedAt || '').localeCompare(String(b2.executedAt || '')) || a.mtime - b2.mtime);
    const latest = candidates[candidates.length - 1];
    const maxAgeDays = +(process.env.CW_BOOTTEST_MAX_AGE_DAYS || 7);
    const ageHours = latest.executedAt ? Math.round(((Date.now() - Date.parse(latest.executedAt)) / 3.6e6) * 10) / 10 : null;
    let shaNow = null; try { shaNow = scannedGitOut(repo, ['log', '-1', '--format=%H', '--', '.']).trim() || null; } catch { /* not a git tree */ }
    const shaMatch = latest.serviceTreeSha && shaNow ? latest.serviceTreeSha === shaNow : null;
    const fresh = ageHours != null && ageHours <= maxAgeDays * 24;
    const status = !latest.green ? 'RED' : (!fresh || shaMatch === false) ? 'STALE' : 'present';
    emit({ applies: true, status, batch: latest.batch, report: latest.report, executedAt: latest.executedAt || null,
      ageHours, maxAgeDays, serviceTreeShaAtRun: latest.serviceTreeSha || null, serviceTreeShaNow: shaNow,
      shaMatch, treeDirtyAtRun: latest.treeDirtyAtRun ?? null,
      note: status === 'present' ? 'green from an executed, current bootTest batch'
        : status === 'RED' ? 'latest executed bootTest FAILED'
          : 'executed pass exists but is stale (age or service-tree sha) — re-run ci/run-ci.sh' });
  }
}

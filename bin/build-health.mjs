#!/usr/bin/env node
/**
 * commitwork build-health — language-agnostic build-currency / hygiene checks:
 *   deadcode    unused/undeclared deps + dead documentation links
 *   toolchain   does build + test pass on the version the repo DECLARES, in a matching container
 *   provenance  does the shipped artifact's target match the declared toolchain
 *   format      does the tree conform to the formatter the repo DECLARES (never a tool default)
 *   lint        does the tree meet the lint bar the repo DECLARES, at the severity IT declared
 * Languages auto-detected by ecosystem marker; the version is read from the repo, never
 * hardcoded. Unimplemented pairs and missing tools degrade to {ran:false, note} — never pretend.
 *
 *   lang     marker(s)                         declared version source        build/test image
 *   js/ts    package.json (+tsconfig=ts)       engines.node | .nvmrc          node:<v>
 *   java     build.gradle | pom.xml            JavaLanguageVersion.of | <release>  eclipse-temurin:<v>-jdk
 *   go       go.mod                            go.mod `go 1.xx`               golang:<v>
 *   python   pyproject.toml | requirements.txt requires-python | .python-version  python:<v>
 *   ruby     Gemfile | *.gemspec              .ruby-version | Gemfile ruby     ruby:<v>
 *   rust     Cargo.toml                        rust-toolchain(.toml) | rust-version  rust:<v|latest>
 *   c/cpp    CMakeLists.txt | Makefile         C/C++ std (reported, not pinned)   gcc:latest
 *
 * Documentation (.md, .pdf, .html) gets dead-link + inventory checks only.
 *
 * Usage:  node build-health.mjs <deadcode|toolchain|provenance|format|boottest> [repoPath]
 * Emits a JSON report to stdout (the manifest redirects it into $CW_REPORT_DIR).
 *
 * format checks against a formatter the REPO declares — config file, package script, or its own
 * CI. Running a tool's default over a repo that never adopted it fails ~100% of files, which is
 * the defect signature (GuardDog capability-*, prowler security_and_analysis), not a fleet in
 * crisis. No declaration is n/a. Declared-but-tool-absent is `skipped`, never clean.
 *
 * lint follows format's rule one level in: the SEVERITY is the repo's too. memory-layer declares clippy
 * as `-W clippy::all` and prints "Status | Passed" regardless, so a -W repo reports `advisory`
 * with a count and can never report findings. An ABORTED linter is a floor, not a count — one
 * that dies on a target still prints findings for the targets it reached, so a crashing lint
 * would otherwise look cleaner than a finishing one.
 *
 * boottest: the EXECUTING boot gate — ./gradlew bootTest (@Tag("boot") suite). Java/Gradle only;
 * needs the compose-CI env (ci/run-ci.sh).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { scannedGit } from './lib/git-env.mjs';
import { registersBootTest, conventionFiles } from './lib/gradle-conventions.mjs';
import { buildPhaseScript, parsePhases, countTests, foldPhases, workspaceStep, foldFormat, formatDeviations, foldLint, lintFindings, lintComplete, TOOLCHAIN_STATUSES } from './lib/build-health-parse.mjs';

const [, , sub, repoArg] = process.argv;
const repo = path.resolve(repoArg || process.env.COMMITWORK_REPO || '.');
if (!['deadcode', 'toolchain', 'provenance', 'format', 'lint', 'boottest'].includes(sub)) {
  process.stderr.write('usage: build-health.mjs <deadcode|toolchain|provenance|format|lint|boottest> [repoPath]\n');
  process.exit(2);
}

// CI hook: extra docker-run args injected by ci/run-ci.sh so the test stage sees real services.
// fact: BH_DOCKER_ARGS is split on whitespace, never handed to a shell / anything a shell would expand is refused, so no value can turn back into host command text (expiry: never, prev: broken)
function dockerExtra() {
  const raw = process.env.BH_DOCKER_ARGS || '';
  if (/['"`$\\;&|<>(){}*?]/.test(raw.replace(/\\\n/g, ' '))) {
    return { error: 'BH_DOCKER_ARGS holds shell syntax (quotes, $, globs, operators); it is split on whitespace and passed to docker as argv, so it was refused rather than reinterpreted. A property of the runner, not of the repo.' };
  }
  return { args: raw.replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean) };
}
// Printed by the java container once its read-only source copy completed (java has no phase markers).
const WORKSPACE_OK = '__CW_WORKSPACE_READY';
const DOC_EXTS = ['.md', '.pdf', '.html'];
const SKIP = new Set(['node_modules', '.git', 'build', 'dist', '.gradle', 'out', 'target', 'coverage', 'vendor', 'bin', '__pycache__', '.venv', 'venv']);

const sh = (cmd, opts = {}) => {
  try { return { ok: true, out: execSync(cmd, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts }) }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status }; }
};
// fact: docker, unzip and git are spawned from an argv, never through a host shell / the repo path was spliced into `sh -c` and a directory named repo$(…) ran its command on the host, outside the container and the host sandbox (review 2026-10-07 D5) (expiry: never, prev: broken)
// The out shape is sh()'s: stdout on success, stdout+stderr on failure.
const run = (bin, args, opts = {}) => {
  const r = spawnSync(bin, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) return { ok: false, out: String(r.error.message), stdout: '', code: null };
  const ok = r.status === 0;
  return { ok, out: ok ? r.stdout : `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '', code: r.status };
};
// A docker -v spec is colon-separated, so a host path holding one names a different mount.
const mountable = (p) => (/[:,\n]/.test(p) ? null : p);
const docker = (mount, image, script, scriptArgs = []) => {
  const extra = dockerExtra();
  if (extra.error) return { ok: false, refused: extra.error, out: '' };
  if (!mountable(mount)) return { ok: false, refused: `the repository path ${JSON.stringify(mount)} holds a character a docker -v spec cannot carry, so nothing was mounted. A property of the runner, not of the repo.`, out: '' };
  return run('docker', ['run', '--rm', ...extra.args, '-v', `${mount}:/src:ro`, '-w', '/w', image, 'sh', '-c', script, 'sh', ...scriptArgs]);
};
const gitOut = (args) => { const r = scannedGit(repo, args); return !r.error && r.status === 0 ? String(r.stdout || '') : ''; };
const exists = (p) => fs.existsSync(path.join(repo, p));
const read = (p) => { try { return fs.readFileSync(path.join(repo, p), 'utf8'); } catch { return ''; } };
const have = (cmd) => { try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; } };
const tail = (s, n = 25) => String(s).split('\n').slice(-n).join('\n');
const skip = (lang, note) => ({ lang, ran: false, note });

/**
 * Run a repo's declared build/test steps in its declared container, reporting EACH phase (the
 * judging logic lives in bin/lib/build-health-parse.mjs; this is the I/O half).
 * `env-blocked` (no docker) stays distinct from `skipped` (the repo declares nothing) — infra
 * absence must never render as a verdict about the repo. The repo is mounted READ-ONLY and
 * phases run in a container-local copy (workspaceStep); `:ro` makes an adapter that forgets the
 * workspace fail loudly.
 */
function runPhases({ lang, image, steps, declared, extra = {} }) {
  if (!have('docker')) {
    return { lang, ran: false, status: 'env-blocked', declared, image,
      note: 'docker is not available on this machine — the toolchain check runs the declared version in a container, so nothing could be verified. This is a property of the runner, not of the repo.' };
  }
  const phases = [workspaceStep(), ...steps];
  const script = buildPhaseScript(phases, { timeoutSeconds: +(process.env.CW_BH_PHASE_TIMEOUT || 1800) });
  // The script is one argv word to the container's sh, so no host shell sees $cw_rc/$cw_p.
  const r = docker(repo, image, script);
  if (r.refused) return { lang, ran: false, status: 'env-blocked', declared, image, note: r.refused };
  const parsed = parsePhases(r.out);
  const testStep = steps.find((s) => s.name === 'test');
  const testOut = testStep ? r.out : '';
  const folded = foldPhases({
    lang, parsed, testCount: testStep ? countTests(lang, testOut) : null, testPhasePresent: !!testStep,
  });
  // plannedPhases names `materialise` too — a materialise failure is only legible if declared.
  return { lang, ran: true, declared, image, plannedPhases: phases.map((s) => s.name), ...folded, ...extra, tail: tail(r.out) };
}

function listFiles(exts, cap = 40000) {
  const res = [];
  const walk = (dir) => {
    if (res.length >= cap) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(fp); }
      else if (exts.some((x) => e.name.endsWith(x))) res.push(path.relative(repo, fp));
    }
  };
  walk(repo);
  return res;
}
const firstMatch = (text, re) => { const m = text.match(re); return m ? m[1] : null; };

// ---- format: declaration, then conformance -------------------------------

/** Every workflow this repo owns, concatenated. A fmt step in a repo's own CI is a declaration. */
const workflowText = () => {
  try {
    const d = path.join(repo, '.github/workflows');
    return fs.readdirSync(d).filter((f) => /\.ya?ml$/.test(f)).map((f) => read(`.github/workflows/${f}`)).join('\n');
  } catch { return ''; }
};

const pkgScripts = () => { try { return JSON.parse(read('package.json') || '{}').scripts || {}; } catch { return {}; } };

/**
 * Did the repo declare this formatter? Returns the evidence string, or null.
 * Order is specificity: a config file is the strongest claim, a CI step the weakest that still
 * counts. `null` means n/a — NOT a pass and NOT a finding.
 */
function declaredBy({ configs = [], pkgKey = null, scriptRe = null, ciRe = null, fileRe = null }) {
  for (const c of configs) if (exists(c)) return `config ${c}`;
  if (pkgKey) { try { if (JSON.parse(read('package.json') || '{}')[pkgKey]) return `package.json "${pkgKey}"`; } catch { /* */ } }
  if (scriptRe) { const s = pkgScripts(); for (const [k, v] of Object.entries(s)) if (scriptRe.test(`${k} ${v}`)) return `package.json script "${k}"`; }
  if (fileRe && fileRe.test(`${read('Makefile')}\n${read('justfile')}\n${read('build.gradle')}\n${read('build.gradle.kts')}`)) return 'build file target';
  if (ciRe && ciRe.test(workflowText())) return 'its own CI workflow';
  return null;
}

/**
 * Run a declared formatter in --check mode and count deviating FILES.
 *
 * Three outcomes and they are kept apart on purpose: no declaration is n/a, a declared formatter
 * whose binary is absent here is `skipped` (grey — we did not look), and only a formatter that
 * actually ran produces clean/findings. An absent tool reported as clean is the false-clean this
 * whole module is built against.
 */
function formatCheck({ lang, declaration, tool, probe, cmd }) {
  if (!declaration) return skip(lang, 'no formatter declared (no config, script, build target or CI step) — nothing to check conformance against, so this is n/a rather than a pass');
  if (probe && !have(probe)) return { lang, ran: false, status: 'skipped', tool, declaredBy: declaration,
    note: `${tool} is declared by this repo but ${probe} is not on PATH here — NOT checked. Absence of a check is not conformance.` };
  const r = sh(cmd);
  return foldFormat({ lang, tool, declaredBy: declaration, command: cmd, ok: r.ok, code: r.code, files: formatDeviations(tool, r.out) });
}

/**
 * Did the repo declare this linter, and AT WHAT SEVERITY?
 *
 * The severity half is not decoration. memory-layer declares clippy as `-W clippy::all`, counts warnings,
 * and prints "Status | Passed" unconditionally — an advisory count, never a gate. Reporting it as
 * FAILING would assert a bar the repo never set, which is the declared-not-defaulted error of the
 * format lane one level in. `enforced` is true only where the repo itself denies.
 */
function declaredLint({ configs = [], cargoLints = false, ciRe = null, denyRe = /-D\s+warnings|-D\s+clippy::|--max-warnings[= ]0|deny\s*=/ }) {
  const wf = workflowText();
  let where = null;
  for (const c of configs) if (exists(c)) { where = `config ${c}`; break; }
  if (!where && cargoLints && /\[lints\.clippy\]|\[lints\.rust\]/.test(read('Cargo.toml'))) where = 'Cargo.toml [lints]';
  if (!where && ciRe && ciRe.test(wf)) where = 'its own CI workflow';
  if (!where) return null;
  const corpus = `${wf}\n${read('Cargo.toml')}\n${configs.map(read).join('\n')}`;
  return { where, enforced: denyRe.test(corpus) };
}

/** Run a declared linter. Same three-way split as formatCheck: n/a / skipped / a real reading. */
function lintCheck({ lang, declaration, tool, probe, cmd }) {
  if (!declaration) return skip(lang, 'no linter declared (no config, lints table or CI step) — nothing to check against, so this is n/a rather than a pass');
  if (probe && !have(probe)) return { lang, ran: false, status: 'skipped', tool, declaredBy: declaration.where,
    note: `${tool} is declared by this repo but ${probe} is not on PATH here — NOT checked. Absence of a check is not a clean lint.` };
  const r = sh(cmd);
  return foldLint({ lang, tool, declaredBy: declaration.where, command: cmd, enforced: declaration.enforced,
    ok: r.ok, code: r.code, findings: lintFindings(tool, r.out), completeness: lintComplete(tool, r.out) });
}

// ---- version extractors (declared, never hardcoded) ----------------------
const ver = {
  node: () => {
    try { const e = (JSON.parse(read('package.json') || '{}').engines || {}).node; if (e) return firstMatch(String(e), /(\d+)/); } catch { /* */ }
    return firstMatch(read('.nvmrc'), /(\d+)/);
  },
  java: () => firstMatch(`${read('build.gradle')}\n${read('build.gradle.kts')}`, /JavaLanguageVersion\.of\((\d+)\)/)
    || firstMatch(`${read('build.gradle')}\n${read('build.gradle.kts')}`, /sourceCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?['"]?(\d+)/)
    || firstMatch(read('pom.xml'), /<(?:maven\.compiler\.release|java\.version)>(\d+)</),
  go: () => firstMatch(read('go.mod'), /^\s*go\s+(\d+\.\d+)/m),
  python: () => firstMatch(read('.python-version'), /(\d+\.\d+)/)
    || firstMatch(read('pyproject.toml'), /requires-python\s*=\s*["'][^0-9]*(\d+\.\d+)/),
  ruby: () => firstMatch(read('.ruby-version'), /(\d+\.\d+)/)
    || firstMatch(read('Gemfile'), /ruby\s+["'](\d+\.\d+)/),
  rust: () => firstMatch(read('rust-toolchain.toml'), /channel\s*=\s*["'](\d+\.\d+)/)
    || firstMatch(read('rust-toolchain'), /(\d+\.\d+)/)
    || firstMatch(read('Cargo.toml'), /rust-version\s*=\s*["'](\d+\.\d+)/),
  cstd: () => firstMatch(read('CMakeLists.txt'), /CMAKE_C(?:XX)?_STANDARD\s+(\d+)/)
    || firstMatch(read('Makefile'), /-std=\w*?(\d\d)/),
};

// ---- language registry ---------------------------------------------------
const LANGS = [
  {
    id: 'js', markers: ['package.json'],
    label: () => (exists('tsconfig.json') ? 'typescript' : 'javascript'),
    toolchain() {
      const v = ver.node(); if (!v) return skip('js', 'no engines.node/.nvmrc declared');
      // yarn-lockfile repos install with yarn (npm ci demands package-lock.json); the npm-init
      // placeholder test script is not a test.
      let scripts = {}; try { scripts = (JSON.parse(read('package.json') || '{}').scripts) || {}; } catch { /* */ }
      const yarn = exists('yarn.lock') && !exists('package-lock.json'); // node images ship yarn classic
      // A conditional chain of up to three named phases — `install` is neither build nor test.
      const steps = [{ name: 'install', cmd: yarn ? 'yarn install --frozen-lockfile' : 'npm ci --no-audit --no-fund' }];
      if (scripts.build) steps.push({ name: 'build', cmd: yarn ? 'yarn run build' : 'npm run build' });
      if (scripts.test && !/no test (suite|specified)/i.test(scripts.test)) steps.push({ name: 'test', cmd: yarn ? 'yarn run test' : 'npm test' });
      return runPhases({ lang: this.label(), image: `node:${v}`, declared: v, steps, extra: { packageManager: yarn ? 'yarn' : 'npm' } });
    },
    format() {
      const decl = declaredBy({
        configs: ['.prettierrc', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.js', '.prettierrc.cjs', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs'],
        pkgKey: 'prettier', scriptRe: /prettier/, ciRe: /prettier/,
      });
      return formatCheck({ lang: this.label(), tool: 'prettier', probe: 'npx',
        declaration: decl,
        // Pinned, like depcheck above: an unpinned npx runs whatever the registry serves that
        // minute, and a formatter's verdict changes between minor versions. bin/test/
        // no-unpinned-fetch.test.mjs enforces this and caught the bare form here.
        cmd: 'npx --yes prettier@3.9.6 --check . 2>&1' });
    },
    lint() {
      return lintCheck({ lang: this.label(), tool: 'eslint', probe: 'npx',
        declaration: declaredLint({ configs: ['eslint.config.js', 'eslint.config.mjs', '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs'], ciRe: /eslint/ }),
        cmd: 'npx --yes eslint@10.8.1 . --format=unix 2>&1' });
    },
    deadcode() {
      if (!have('npx')) return skip('js', 'npx not on PATH');
      // Pinned: an unpinned npx executes whatever the registry serves, and depcheck's verdict
      // changes between minors. Bump deliberately; bin/test/no-unpinned-fetch.test.mjs gates the pin.
      const r = sh('npx --yes depcheck@1.4.7 --json'); let p = null;
      try { p = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { /* */ }
      if (!p) return skip('js', 'depcheck produced no JSON');
      const unused = [...(p.dependencies || []), ...(p.devDependencies || [])];
      return { lang: this.label(), ran: true, tool: 'depcheck', unusedCount: unused.length, unused, missing: Object.keys(p.missing || {}) };
    },
    provenance() {
      let target = null; try { target = (JSON.parse(read('tsconfig.json') || '{}').compilerOptions || {}).target || null; } catch { /* */ }
      const node = ver.node();
      return { lang: this.label(), ran: !!(target || node), declaredNode: node, tsconfigTarget: target, note: 'advisory: TS target / engines.node, not a hard bytecode check' };
    },
  },
  {
    id: 'java', markers: ['build.gradle', 'build.gradle.kts', 'pom.xml'],
    toolchain() {
      const v = ver.java(); if (!v) return skip('java', 'no declared Java version');
      // Not converted to runPhases: `gradlew clean build` is ONE task graph — only Gradle's log
      // separates build from test, and the reading below discriminates more finely.
      if (!have('docker')) {
        return { lang: 'java', ran: false, status: 'env-blocked', declared: v,
          note: 'docker is not available on this machine — nothing was verified. A property of the runner, not of the repo.' };
      }
      let cmd;
      if (exists('gradlew')) cmd = './gradlew --no-daemon --console=plain clean build';
      else if (exists('pom.xml')) cmd = 'mvn -B -ntp clean verify';
      else return skip('java', 'no gradlew or pom.xml to build with');
      // Mount the git toplevel: monorepo services apply a conventions script from the root, and a
      // service-only mount dies in Gradle's configuration phase.
      const top = gitOut(['rev-parse', '--show-toplevel']).trim();
      const mount = top || repo;
      const wd = top ? path.posix.join('/w', path.relative(top, repo)) : '/w';
      // Read-only mount + container-local copy (as runPhases); the copy carries a line-anchored
      // sentinel because the scanned tree's build log reaches this parser verbatim. wd is $1, not text.
      const ws = workspaceStep();
      const r = docker(mount, `eclipse-temurin:${v}-jdk`, `${ws.cmd} && echo ${WORKSPACE_OK} && cd "$1" && ${cmd}`, [wd]);
      if (r.refused) return { lang: 'java', ran: false, status: 'env-blocked', declared: v, note: r.refused };
      // A copy that never completed means the build was never attempted — env-blocked, not RED.
      if (!r.out.split('\n').some((l) => l.trim() === WORKSPACE_OK)) {
        return { lang: 'java', ran: false, status: 'env-blocked', declared: v, image: `eclipse-temurin:${v}-jdk`,
          note: 'the read-only workspace copy did not complete on this runner (disk, permissions, or a missing tar in the image), so the build was never attempted. A property of the runner, not of the repo.',
          tail: tail(r.out) };
      }
      // Separate the infra-free signal (COMPILES on this JDK) from test execution, which needs
      // services a bare container lacks.
      const failedTask = (r.out.match(/> Task (\S+) FAILED/) || [])[1] || null;
      const compileFailed = /> Task :compile\w+ FAILED/.test(r.out);
      const testFailed = /> Task :test FAILED/.test(r.out) || /tests? completed, \d+ failed/.test(r.out);
      const infraSmell = /Failed to load ApplicationContext|DataSource|\bjdbc\b|Testcontainers|Connection refused|Could not (?:find a valid|connect)/i.test(r.out);
      // Configuration-phase death proves nothing about compilation.
      const configDied = !r.ok && !/> Task :/.test(r.out);
      const compiles = !compileFailed && !configDied;
      const testStatus = r.ok ? 'passed'
        : testFailed && infraSmell ? 'failed — likely environmental (needs DB/Docker/Testcontainers; run in a compose env)'
          : testFailed ? 'failed'
            : compileFailed ? 'compile error'
              : configDied ? 'configuration-phase failure (no task executed)' : 'n/a';
      // green keys on compilation (deterministic, infra-free); `greenMeans` says so out loud.
      return { lang: 'java', ran: true, declared: v, image: `eclipse-temurin:${v}-jdk`,
        green: compiles, status: compiles ? 'green' : 'RED',
        greenMeans: 'compilation on the declared JDK — NOT test execution (see testStatus; executed tests live in the boottest check and ci/run-ci.sh)',
        compiles, configDied, testStatus, failedTask, mount: top ? 'monorepo-root' : 'repo', tail: tail(r.out) };
    },
    boottest() {
      // Executes ./gradlew bootTest; needs the compose-CI env (a bare run false-REDs on
      // Testcontainers). Mounts the monorepo root — see toolchain.
      const v = ver.java(); if (!v) return skip('java', 'no declared Java version');
      if (!exists('gradlew')) return skip('java', 'no gradlew — bootTest is a Gradle-convention task');
      const g = `${read('build.gradle')}\n${read('build.gradle.kts')}`;
      // One predicate shared with quality-gates' qg-boot-test (lib/gradle-conventions.mjs).
      const boot = registersBootTest(g);
      if (!boot.registered) return skip('java', `no bootTest task registered — not a boot-conventions tree (looked for inline tasks.register('bootTest') or apply from: ${conventionFiles().join(' / ')})`);
      const top = gitOut(['rev-parse', '--show-toplevel']).trim();
      const mount = top || repo;
      const wd = top ? path.posix.join('/w', path.relative(top, repo)) : '/w';
      const startedAt = new Date().toISOString();
      // Read-only mount + container-local copy, exactly as toolchain.
      const ws = workspaceStep();
      const r = docker(mount, `eclipse-temurin:${v}-jdk`, `${ws.cmd} && echo ${WORKSPACE_OK} && cd "$1" && ./gradlew --no-daemon --console=plain bootTest`, [wd]);
      if (r.refused) return { lang: 'java', ran: false, executed: false, declared: v, note: r.refused, executedAt: startedAt };
      if (!r.out.split('\n').some((l) => l.trim() === WORKSPACE_OK)) {
        // An executing gate that never got its sources is an ungated repo — `executed: false` says so.
        return { lang: 'java', ran: false, executed: false, declared: v, image: `eclipse-temurin:${v}-jdk`,
          note: 'the read-only workspace copy did not complete on this runner, so bootTest never ran. A property of the runner, not of the repo.',
          executedAt: startedAt, tail: tail(r.out, 40) };
      }
      // Staleness anchors for the qg-boot-test-pass reader.
      const treeSha = gitOut(['log', '-1', '--format=%H', '--', '.']).trim() || null;
      const dirty = !!gitOut(['status', '--porcelain', '--', '.']).trim();
      // green = exit 0 ONLY — an executing boot gate that could not pass is RED, never green.
      return { lang: 'java', ran: true, executed: true, declared: v, image: `eclipse-temurin:${v}-jdk`,
        bootTestTaskEvidence: boot.how,
        green: r.ok, exitCode: r.ok ? 0 : (r.code ?? null), executedAt: startedAt,
        serviceTreeSha: treeSha, treeDirtyAtRun: dirty, mount: top ? 'monorepo-root' : 'repo',
        tail: tail(r.out, 40) };
    },
    deadcode() {
      const g = read('build.gradle') || read('build.gradle.kts');
      const deps = []; const re = /(?:implementation|api|testImplementation|testApi|compileOnly)\s*[("']([\w.\-]+):([\w.\-]+)(?::[^"')]+)?["')]/g;
      // Exclude runtime/config-wired deps (starters, BOMs, processors, drivers) — no import is
      // legitimate there. Driver exclusions are GROUP-anchored so testcontainers modules still flag.
      const RUNTIME_WIRED = /spring-boot-starter|spring-cloud-starter|:platform|-bom|projectlombok|mapstruct-processor|org\.postgresql:|com\.mysql|mysql:mysql-connector|org\.mariadb:|com\.h2database|flyway|liquibase|zipkin|micrometer|logback|logstash|hikari|slf4j|jackson/;
      let m; while ((m = re.exec(g))) { const coord = `${m[1]}:${m[2]}`; if (RUNTIME_WIRED.test(coord)) continue; deps.push({ group: m[1], artifact: m[2] }); }
      // Usage corpus = source AND config resources: a dep consumed only from application.yml has
      // no import but is not dead.
      const src = listFiles(['.java', '.kt', '.yml', '.yaml', '.properties', '.xml', '.conf', '.sql']).map(read).join('\n'); const suspects = [];
      for (const d of deps) {
        const tg = d.group.replace(/^(com|org|io|net)\./, '').split('.')[0]; const ta = d.artifact.split('-')[0];
        const used = src.includes(`import ${d.group}`) || (tg.length > 2 && src.includes(tg)) || (ta.length > 2 && src.includes(ta));
        if (!used) suspects.push(`${d.group}:${d.artifact}`);
      }
      return { lang: 'java', ran: true, method: 'source+resources import/config-reachability heuristic (excludes starters/BOM/processors)', declaredLibDeps: deps.length, suspectUnusedCount: suspects.length, suspectUnused: suspects };
    },
    provenance() {
      const v = ver.java();
      let libs = []; try { libs = fs.readdirSync(path.join(repo, 'build/libs')).filter((f) => f.endsWith('.jar')).sort().map((f) => `build/libs/${f}`); } catch { /* no build dir */ }
      if (!libs.length) return skip('java', 'no build/libs/*.jar — build first');
      const jar = libs[0];
      // The jar's name and its entry names are the repo's text, so each reaches unzip as one argv word.
      const first = (r, keep = () => true) => r.stdout.split('\n').map((l) => l.trim()).find((l) => l && keep(l)) || '';
      const entry = first(run('unzip', ['-Z1', jar, 'BOOT-INF/classes/*.class'])) || first(run('unzip', ['-Z1', jar, '*.class']), (l) => !l.includes('module-info'));
      if (!entry) return skip('java', 'no .class entry in jar');
      let major; try {
        const u = spawnSync('unzip', ['-p', jar, entry], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
        if (u.error || u.status !== 0) throw u.error || new Error(`unzip exited ${u.status}`);
        major = u.stdout.readUInt16BE(6);
      } catch (e) { return skip('java', `unzip failed: ${String(e).slice(0, 100)}`); }
      const actual = major - 44; // 61=17, 65=21, 69=25
      return { lang: 'java', ran: true, jar, entry, declaredToolchain: v == null ? null : +v, actualBytecode: actual, majorVersion: major, match: v == null ? null : actual === +v, verdict: v == null ? 'no declared version' : (actual === +v ? 'MATCH' : `MISMATCH: declared ${v}, jar built to ${actual}`) };
    },
  },
  {
    id: 'go', markers: ['go.mod'],
    format() {
      // gofmt has no config file by design, so a config-file test can never fire — declaration is
      // a CI step or a build target only.
      return formatCheck({ lang: 'go', tool: 'gofmt', probe: 'gofmt',
        declaration: declaredBy({ ciRe: /gofmt|go\s+fmt|goimports/, fileRe: /gofmt|go\s+fmt/ }),
        cmd: 'gofmt -l .' });
    },
    lint() {
      return lintCheck({ lang: 'go', tool: 'golangci-lint', probe: 'golangci-lint',
        declaration: declaredLint({ configs: ['.golangci.yml', '.golangci.yaml', '.golangci.toml'], ciRe: /golangci-lint/ }),
        cmd: 'golangci-lint run --out-format=line-number 2>&1' });
    },
    toolchain() {
      const v = ver.go(); if (!v) return skip('go', 'no go directive in go.mod');
      return runPhases({ lang: 'go', image: `golang:${v}`, declared: v, steps: [
        { name: 'build', cmd: 'go build ./...' },
        { name: 'test', cmd: 'go test -v ./...' },
      ] });
    },
    deadcode() { if (!have('go')) return skip('go', 'go not on PATH (needs `go mod tidy -diff`)'); const r = sh('go mod tidy -diff'); return { lang: 'go', ran: true, tool: 'go mod tidy -diff', tidy: r.ok, note: r.ok ? 'go.mod/go.sum are tidy' : 'go.mod/go.sum NOT tidy (unused or missing requires)', diff: tail(r.out, 40) }; },
    provenance() { return skip('go', 'native binary — target is advisory, no bytecode to read'); },
  },
  {
    id: 'python', markers: ['pyproject.toml', 'requirements.txt', 'setup.py'],
    toolchain() {
      const v = ver.python() || '3'; let inst;
      if (exists('pyproject.toml')) inst = 'pip install -e . || pip install .';
      else if (exists('requirements.txt')) inst = 'pip install -r requirements.txt';
      else inst = 'true';
      return runPhases({ lang: 'python', image: `python:${v}`, declared: v, steps: [
        { name: 'install', cmd: inst },
        { name: 'test', cmd: 'pytest -q || python -m pytest -q' },
      ] });
    },
    format() {
      const py = read('pyproject.toml');
      // ruff wins when both are configured: it is what the repo would run.
      const ruff = /\[tool\.ruff(\.format)?\]/.test(py) ? 'ruff' : null;
      const black = /\[tool\.black\]/.test(py) ? 'black' : null;
      const tool = ruff || black;
      const decl = tool ? `config pyproject.toml [tool.${tool}]`
        : declaredBy({ configs: ['.ruff.toml', 'ruff.toml', 'setup.cfg'], ciRe: /ruff format|black\s/ });
      const chosen = tool || (/ruff/.test(workflowText()) ? 'ruff' : 'black');
      return formatCheck({ lang: 'python', tool: chosen, probe: chosen, declaration: decl,
        cmd: chosen === 'ruff' ? 'ruff format --check . 2>&1' : 'black --check . 2>&1' });
    },
    lint() {
      const py = read('pyproject.toml');
      const decl = /\[tool\.ruff(\.lint)?\]/.test(py) ? { where: 'config pyproject.toml [tool.ruff]', enforced: false }
        : declaredLint({ configs: ['.ruff.toml', 'ruff.toml'], ciRe: /ruff check/ });
      return lintCheck({ lang: 'python', tool: 'ruff', probe: 'ruff', declaration: decl,
        cmd: 'ruff check --output-format=concise . 2>&1' });
    },
    deadcode() { if (!have('deptry')) return skip('python', 'deptry not on PATH (unused/missing import check)'); const r = sh('deptry . --json-output /dev/stdout'); return { lang: 'python', ran: true, tool: 'deptry', clean: r.ok, out: tail(r.out, 40) }; },
    provenance() { return skip('python', 'interpreted — no compiled artifact target to verify'); },
  },
  {
    id: 'ruby', markers: ['Gemfile'],
    toolchain() {
      const v = ver.ruby(); if (!v) return skip('ruby', 'no .ruby-version / Gemfile ruby directive');
      return runPhases({ lang: 'ruby', image: `ruby:${v}`, declared: v, steps: [
        { name: 'install', cmd: 'bundle install' },
        { name: 'test', cmd: 'bundle exec rspec || bundle exec rake test' },
      ] });
    },
    deadcode() { return skip('ruby', 'no reliable unused-gem CLI — bundle audit covers CVEs, not usage'); },
    provenance() { return skip('ruby', 'interpreted — no compiled artifact target to verify'); },
  },
  {
    id: 'rust', markers: ['Cargo.toml'],
    toolchain() {
      const v = ver.rust() || 'latest';
      return runPhases({ lang: 'rust', image: `rust:${v}`, declared: v, steps: [
        { name: 'build', cmd: 'cargo build --all' },
        { name: 'test', cmd: 'cargo test --all' },
      ] });
    },
    deadcode() { if (!have('cargo-machete')) return skip('rust', 'cargo-machete not installed (unused-dep check)'); const r = sh('cargo machete'); return { lang: 'rust', ran: true, tool: 'cargo-machete', clean: r.ok, out: tail(r.out, 40) }; },
    format() {
      // rustfmt ships with the toolchain, so its PRESENCE proves nothing about adoption — the
      // declaration has to come from the repo. memory-layer declares it with a Format Check CI job.
      return formatCheck({ lang: 'rust', tool: 'cargo fmt', probe: 'cargo',
        declaration: declaredBy({ configs: ['rustfmt.toml', '.rustfmt.toml'], ciRe: /cargo\s+fmt|rustfmt/ }),
        cmd: 'cargo fmt --all -- --check 2>&1' });
    },
    lint() {
      return lintCheck({ lang: 'rust', tool: 'clippy', probe: 'cargo',
        declaration: declaredLint({ configs: ['clippy.toml', '.clippy.toml'], cargoLints: true, ciRe: /cargo\s+clippy/ }),
        // --message-format=short is line-parseable; the repo's own flags decide severity, not this.
        cmd: 'cargo clippy --all-targets --message-format=short 2>&1' });
    },
    provenance() { return skip('rust', 'native binary — target triple is advisory, no bytecode'); },
  },
  {
    // fact: sbt/mill is its own entry, not `java` / the marker is build.sbt and the formatter is scalafmt, not spotless (expiry: never, prev: missing)
    id: 'scala', markers: ['build.sbt', 'build.sc'],
    format() {
      // fact: .scalafmt.conf is the declaration and pins the version scalafmt fetches / the binary is standalone, so its presence proves nothing about adoption (expiry: never, prev: not built)
      return formatCheck({ lang: 'scala', tool: 'scalafmt', probe: 'scalafmt',
        declaration: declaredBy({ configs: ['.scalafmt.conf'], ciRe: /scalafmt/ }),
        // fact: 2>&1 is load-bearing / scalafmt's diffs go to stderr, so unmerged every unformatted repo reads unreadable (expiry: never, prev: not built)
        cmd: 'scalafmt --test . 2>&1' });
    },
  },
  {
    id: 'c', markers: ['CMakeLists.txt', 'Makefile'],
    toolchain() {
      // The phase split retires the old `|| true` on the test step: a missing test target is now
      // `no-tests` instead of a suppressed failure.
      const steps = exists('CMakeLists.txt')
        ? [{ name: 'build', cmd: 'cmake -S . -B build && cmake --build build' },
           { name: 'test', cmd: 'ctest --test-dir build --output-on-failure' }]
        : [{ name: 'build', cmd: 'make' },
           { name: 'test', cmd: 'make test || make check' }];
      return runPhases({ lang: 'c/c++', image: 'gcc:latest', declared: ver.cstd(), steps, extra: { declaredStd: ver.cstd() } });
    },
    deadcode() { return skip('c/c++', 'no portable unused-symbol check without full build graph'); },
    provenance() { return skip('c/c++', 'native binary — ABI/std target is advisory'); },
  },
];

// ---- documentation (.md/.pdf/.html): dead links + inventory ---------------
function docsDeadcode(docs) {
  const deadLinks = []; let pdfs = 0, mds = 0, htmls = 0;
  for (const d of docs) {
    if (d.endsWith('.pdf')) { pdfs++; continue; }
    if (d.endsWith('.md')) mds++; else if (d.endsWith('.html')) htmls++;
    const text = read(d);
    const refs = d.endsWith('.md')
      ? [...text.matchAll(/\]\(([^)\s#?]+)\)/g)].map((m) => m[1])
      : [...text.matchAll(/(?:href|src)\s*=\s*["']([^"'#?]+)["']/g)].map((m) => m[1]);
    for (const ref of refs) {
      if (/^(https?:|data:|mailto:|tel:|\/\/|#)/.test(ref)) continue;
      const target = path.normalize(path.join(path.dirname(d), ref));
      if (!/\.\w{1,5}$/.test(ref)) continue; // only file-looking refs
      if (!exists(target)) deadLinks.push({ from: d, ref });
    }
  }
  return { kind: 'documentation', ran: true, docFiles: docs.length, markdown: mds, html: htmls, pdf: pdfs, deadLinkCount: deadLinks.length, deadLinks: deadLinks.slice(0, 100) };
}

// ---- dispatch ------------------------------------------------------------
const present = LANGS.filter((l) => l.markers.some(exists));
const docs = listFiles(DOC_EXTS, 20000);
const results = [];
for (const l of present) {
  const fn = l[sub];
  results.push(fn ? fn.call(l) : skip(l.id, `${sub} not implemented for ${l.id}`));
}
if (sub === 'deadcode' && docs.length) results.push(docsDeadcode(docs));

function deriveStatus() {
  if (!results.length) return 'n/a';
  if (sub === 'boottest') { const ran = results.filter((r) => r.ran); return !ran.length ? 'n/a' : (ran.every((r) => r.green) ? 'green' : 'RED'); }
  if (sub === 'toolchain') {
    // Fold per-language statuses worst-first; green only when every language that ran says green.
    if (results.some((r) => r.status === 'RED')) return 'RED';
    if (results.some((r) => r.status === 'unreadable')) return 'unreadable';
    if (results.some((r) => r.status === 'no-tests')) return 'no-tests';
    const ran = results.filter((r) => r.ran);
    if (!ran.length) return results.some((r) => r.status === 'env-blocked') ? 'env-blocked' : 'skipped';
    return ran.every((r) => r.green) ? 'green' : 'RED';
  }
  if (sub === 'provenance') { const j = results.find((r) => r.lang === 'java' && r.ran); return j ? (j.match === false ? 'MISMATCH' : 'ok') : 'advisory'; }
  if (sub === 'format') {
    // Order is the judgement. A repo where SOME language ran and another was skipped-for-tool is
    // reported as skipped, not clean: a partial look is not a clean bill, and the deviation count
    // from the half that ran would read as the whole tree's.
    const ran = results.filter((r) => r.ran);
    const n = ran.reduce((a, r) => a + (r.deviationCount || 0), 0);
    if (n) return `findings:${n}`;
    // Before `clean`: a language whose formatter could not be read, or was declared but absent
    // here, means part of the tree went unchecked. A partial look is not a clean bill.
    if (results.some((r) => r.status === 'unreadable')) return 'unreadable';
    if (results.some((r) => r.status === 'skipped')) return 'skipped';
    return ran.length ? 'clean' : 'n/a';
  }
  if (sub === 'lint') {
    // findings: only where the REPO denies. An advisory declaration reports `advisory` however
    // many diagnostics it counted — asserting a failure the repo never asked for is the same
    // error as running a linter's defaults over a repo that never adopted it.
    const ran = results.filter((r) => r.ran);
    const enforcedFindings = ran.filter((r) => r.enforced === 'deny').reduce((a, r) => a + (r.findingCount || 0), 0);
    if (enforcedFindings) return `findings:${enforcedFindings}`;
    if (results.some((r) => r.status === 'unreadable')) return 'unreadable';
    if (results.some((r) => r.status === 'skipped')) return 'skipped';
    if (ran.some((r) => r.status === 'advisory')) return 'advisory';
    return ran.length ? 'clean' : 'n/a';
  }
  const n = results.reduce((a, r) => a + (r.unusedCount || 0) + (r.suspectUnusedCount || 0) + (r.deadLinkCount || 0), 0);
  return n ? `findings:${n}` : 'clean';
}

// schemaVersion 2: toolchain gained phases[]/failedPhase + no-tests/unreadable/env-blocked. v1
// reports carry no schemaVersion and a wider `green`; the field lets a future cross-run consumer
// tell the encodings apart.
const status = deriveStatus();
if (sub === 'toolchain' && !TOOLCHAIN_STATUSES.includes(status)) {
  // Fail closed: an unrecognised status must not be emitted for a consumer to score as passing.
  process.stderr.write(`build-health: toolchain produced status ${JSON.stringify(status)}, which is not in the declared vocabulary [${TOOLCHAIN_STATUSES.join(', ')}]\n`);
  process.exit(3);
}
process.stdout.write(`${JSON.stringify({ tool: 'build-health', schemaVersion: 2, sub, repo, languages: present.map((l) => l.id), docFiles: docs.length, status, results }, null, 2)}\n`);

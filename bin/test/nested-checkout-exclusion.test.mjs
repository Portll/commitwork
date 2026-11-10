// Every lane that walks the repository tree must not read nested checkouts of it: agent worktrees
// under .claude/worktrees/ and checkouts parked under .git/. Those are this repository again, so a
// lane that reads them spends its time budget on copies and reports every finding once per copy.
// The extraction-time set-aside (monitor/worktree-paths.mjs) keeps copy rows out of the totals;
// this keeps the scanners from reading them at all.
//
// The roots come from SCAN_EXCLUDE_ROOTS, derived from the classifier's own WORKTREE_ROOTS, so a
// root added there fails every pinned lane below until each one excludes it too.
//
// Every check in the manifest is classified exactly once. A new check fails here until somebody
// decides which class it is in, which is the point: a new lane cannot miss the exclusion silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCAN_EXCLUDE_ROOTS, WORKTREE_ROOTS, classifyWorktreePath } from '../../monitor/worktree-paths.mjs';
import { excludeDirs } from '../scan-exclusions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8'));
const commandOf = (id) => (manifest.checks.find((c) => c.id === id)?.local || []).join('\n');
const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Values of a list-valued flag, comma-split, quotes stripped: `--skip-dirs a,b` and `--ignore=a,b`.
const listFlag = (cmd, flag) => [...cmd.matchAll(new RegExp(`${flag}[ =]('[^']*'|"[^"]*"|[^\\s]+)`, 'g'))]
  .flatMap((m) => m[1].replace(/^['"]|['"]$/g, '').split(','));

// How each tool is told not to read a root. Each spelling was measured on a synthetic repo holding
// a copy under each root; the evidence and scripts live outside the tree (scanner-classes cycle).
const SPELLING = {
  semgrep: (cmd, r) => cmd.includes(`--exclude ${r} `),
  trivy: (cmd, r) => listFlag(cmd, '--skip-dirs').includes(r),
  syft: (cmd, r) => cmd.includes(`--exclude './${r}/**'`),
  osv: (cmd, r) => cmd.includes(`--experimental-exclude 'g:**/${r}/**'`),
  retire: (cmd, r) => listFlag(cmd, '--ignore').includes(r),
  find: (cmd, r) => cmd.includes(`-not -path '*/${r}/*'`),
  cppcheck: (cmd, r) => cmd.includes(` -i${r} `),
  // `=`, not a space: bin/test/repo-trust-gate reads ` ./x` as running a script from the tree
  pmd: (cmd, r) => cmd.includes(`--exclude=./${r} `),
  phpcs: (cmd, r) => listFlag(cmd, '--ignore').includes(`*/${r}/*`),
  bearer: (cmd, r) => listFlag(cmd, '--skip-path').includes(r),
  socket: (cmd, r) => listFlag(cmd, '--exclude-paths').includes(r),
  psalm: (cmd, r) => (/for nc in ([^;]+);/.exec(cmd)?.[1] || '').trim().split(/\s+/).includes(r),
  // CodeQL reads its bound from a file, so the pin is on the file and on the command reading it.
  codeql: (cmd, r) => /codeql-filters\.txt/.test(cmd) && FILTERS.includes(`exclude:${r}`),
  // joern and shell-lint render the shared directory list; the list must hold the root.
  sharedList: (cmd, r) => /bin\/scan-exclusions\.mjs/.test(cmd) && excludeDirs().includes(r),
};
const FILTERS = src('manifests/codeql-filters.txt').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const PINNED = {
  sast: 'semgrep', 'sast-opengrep': 'semgrep', 'sast-auto': 'semgrep',
  'iac-config': 'trivy', 'deps-jvm': 'trivy',
  'sbom-syft': 'syft', 'deps-osv': 'osv', 'deps-retire': 'retire', 'dockerfile-lint': 'find',
  'sast-c-cppcheck': 'cppcheck', 'lint-java-pmd': 'pmd', 'sast-php-phpcs': 'phpcs', 'sast-php-psalm': 'psalm',
  'sast-bearer': 'bearer', 'supply-chain-socket': 'socket',
  'sast-codeql': 'codeql', 'sast-codeql-java': 'codeql', 'sast-codeql-python': 'codeql', 'sast-codeql-ruby': 'codeql',
  'sast-codeql-cpp': 'codeql', 'sast-codeql-csharp': 'codeql', 'sast-codeql-swift': 'codeql', 'sast-codeql-rust': 'codeql',
  'sast-codeql-go': 'codeql',
  'shell-lint': 'sharedList', 'sast-joern': 'sharedList',
};

// The command hands the walk to a helper; the helper must carry a mechanism that covers both roots.
// classifyWorktreePath covers every WORKTREE_ROOTS entry; a dot-directory skip covers both roots.
const CLASSIFIER = [/classifyWorktreePath/];
const DOTDIRS = [/startsWith\('\.'\)/];
const SHARED_LIST = [/excludeDirs|dirExcluder/];
const LITERAL = [/'\.claude\/worktrees'/, /'\.git'/];
const HELPER = {
  'sast-python-bandit': ['bin/python-lane-scan.mjs', [/SCAN_EXCLUDE_ROOTS\.map\(\(d\) => `\*\/\$\{d\}\/\*`\)/, /'-x', `[^`]*\$\{nested\}`/]],
  'lint-python-ruff': ['bin/python-lane-scan.mjs', [/SCAN_EXCLUDE_ROOTS\.flatMap\(\(d\) => \['--extend-exclude', d\]\)/]],
  'deps-ruby-bundler-audit': ['bin/bundler-audit-scan.mjs', CLASSIFIER],
  'jackson-caseinsensitive-guard': ['bin/guard-jackson-caseinsensitive.mjs', CLASSIFIER],
  'eol-runtime': ['bin/eol-scan.mjs', CLASSIFIER],
  'container-base-images': ['bin/base-images.mjs', CLASSIFIER],
  'weak-random': ['bin/weak-random-detect.mjs', SHARED_LIST],
  'minify-detect': ['bin/minify-detect.mjs', SHARED_LIST],
  'node-hazards': ['bin/node-hazards.mjs', SHARED_LIST],
  'agent-instructions': ['bin/agent-instructions.mjs', SHARED_LIST],
  'model-artefacts': ['bin/model-artefacts.mjs', SHARED_LIST],
  'webshell-detect': ['bin/webshell-detect.mjs', LITERAL],
  'log-evidence': ['bin/log-evidence.mjs', LITERAL],
  'yara-witness': ['bin/yara-witness.mjs', LITERAL],
  'tree-integrity': ['bin/tree-integrity.mjs', LITERAL],
  'wp-integrity': ['bin/wp-integrity.mjs', LITERAL],
  'wp-advisories': ['bin/wp-advisories.mjs', [/import \{ skipDirs[^}]*\} from '\.\/wp-integrity\.mjs'/]],
  'stub-detect': ['bin/stub-detect.mjs', [/name === 'worktrees' && /, /'\.git'/]],
  'vendor-scan': ['bin/vendor-scan.mjs', [/e\.name === '\.claude'/, /'\.git'/]],
  'a11y-wcag': ['bin/a11y-scan.mjs', DOTDIRS],
  'mobile-manifest': ['bin/mobile-manifest.mjs', DOTDIRS],
  'deps-gradle-declared': ['bin/gradle-deps-scan.mjs', DOTDIRS],
  'dep-provenance': ['bin/dep-provenance.mjs', DOTDIRS],
  'deno-lint': ['bin/deno-scan.mjs', DOTDIRS],
  'deno-check': ['bin/deno-scan.mjs', DOTDIRS],
  'format-rust-rustfmt': ['bin/rustfmt-lane-scan.mjs', DOTDIRS],
  // module discovery skips dot-directories; inside a module the go tool's `./...` ignores them too
  'sast-go-gosec': ['bin/lib/go-modules.mjs', DOTDIRS],
  'lint-go-golangci': ['bin/lib/go-modules.mjs', DOTDIRS],
  'deps-go-govulncheck': ['bin/lib/go-modules.mjs', DOTDIRS],
};

// The tool skips dot-directories on its own: measured on the synthetic repo, neither copy was read.
const NATIVE = { 'sast-c-flawfinder': 'flawfinder 2.0.20 skips dot-directories without --followdotdir', 'lint-haskell-hlint': 'hlint 3.10 skips dot-directories' };

// Reads named files at the root, a remote, a live URL or git history — there is no tree walk to bound.
const NOT_TREE = [
  'npm-audit', 'yarn-audit', 'sbom', 'supply-chain-guarddog', 'deps-content', 'gradle-wrapper', 'deps-rust-audit',
  'deps-renovate', 'actions-actionlint', 'actions-zizmor', 'actions-gaps', 'actions-health', 'agent-config',
  'commit-provenance', 'commit-velocity', 'cspm-github', 'posture-scorecard', 'dast-nuclei', 'dast-authz-bola',
  'tls-headers', 'api-fuzz', 'authz-test', 'sast-ruby-brakeman', 'sast-elixir-sobelow', 'lint-rust-clippy',
];

// The tool walks the tree and offers no way to bound it. Copy rows still reach extraction, which sets
// them aside, so these cost time but not correctness.
const UNSUPPORTED = {
  'deps-reachability': 'dep-scan 6.3.0 has no exclude option (--help); the container sees the whole mount',
  'sast-cobol-cobolwork': 'cobolwork 0.9.0 has no exclude option; measured: reads .claude/worktrees, skips .git',
  'cobol-inventory': 'cobolwork 0.9.0 has no exclude option; measured: reads .claude/worktrees, skips .git',
  'deps-updates': 'renovate takes ignorePaths from config, and a repository\'s own renovate.json replaces an env default, so a flag here would bound only repos without one; unmeasured',
};

// SECRET LANES ARE EXEMPT, on purpose. A secret that exists only in an agent worktree's uncommitted
// files is still a secret on that disk, so this test never requires a secret lane to stop reading
// copies; the extraction-time set-aside keeps the duplicates out of the totals instead. Whether a
// secret lane reads copies is decided in its own scope file — gitleaks.toml does exclude
// .claude/worktrees/ today and states that cost there.
const SECRET_EXEMPT = ['secrets', 'secrets-gitleaks', 'secrets-betterleaks', 'secrets-cobol-jcl'];

test('the roots are the classifier\'s roots, minimised, and the classifier recognises each', () => {
  assert.deepEqual([...SCAN_EXCLUDE_ROOTS], ['.claude/worktrees', '.git']);
  for (const r of SCAN_EXCLUDE_ROOTS) {
    assert.ok(WORKTREE_ROOTS.some((w) => w.seg === r), `${r} is not a WORKTREE_ROOTS entry`);
    assert.equal(classifyWorktreePath(`${r}/copy/src/a.py`).worktree, true, `the set-aside must cover ${r} too`);
    // the form deps-osv reports from inside its container
    assert.equal(classifyWorktreePath(`file:///src/${r}/copy/package-lock.json`).worktree, true);
  }
});

test('every check is classified exactly once, and every classified id is a real check', () => {
  const classes = { PINNED: Object.keys(PINNED), HELPER: Object.keys(HELPER), NATIVE: Object.keys(NATIVE), NOT_TREE, UNSUPPORTED: Object.keys(UNSUPPORTED), SECRET_EXEMPT };
  const seen = new Map();
  for (const [cls, ids] of Object.entries(classes)) {
    for (const id of ids) {
      assert.ok(!seen.has(id), `${id} is in both ${seen.get(id)} and ${cls}`);
      seen.set(id, cls);
      assert.ok(manifest.checks.some((c) => c.id === id), `${id} (${cls}) is not a check in the manifest`);
    }
  }
  const unclassified = manifest.checks.map((c) => c.id).filter((id) => !seen.has(id));
  assert.deepEqual(unclassified, [], 'classify each new check here: does it walk the tree, and if so how does its tool exclude the nested-checkout roots?');
});

for (const [id, tool] of Object.entries(PINNED)) {
  test(`${id} excludes every nested-checkout root (${tool})`, () => {
    const cmd = commandOf(id);
    for (const r of SCAN_EXCLUDE_ROOTS) assert.ok(SPELLING[tool](cmd, r), `${id} does not exclude ${r} in ${tool}'s syntax`);
  });
}

for (const [id, [file, marks]] of Object.entries(HELPER)) {
  test(`${id} hands its walk to ${file}, which excludes nested checkouts`, () => {
    const body = src(file);
    for (const re of marks) assert.match(body, re, `${file} has lost the mechanism that keeps nested checkouts out`);
  });
}

test('the shared directory list holds every root, for the JS walkers that read it', () => {
  for (const r of SCAN_EXCLUDE_ROOTS) assert.ok(excludeDirs().includes(r), `manifests/scan-exclude-dirs.txt lacks ${r}`);
});

// Negative controls: each spelling must FAIL on the command as it stood before, or it proves nothing.
test('the spellings reject commands that read the copies', () => {
  const before = {
    semgrep: 'semgrep scan --config p/default --sarif --exclude reference --exclude reports --quiet .',
    trivy: 'trivy config --skip-dirs reference,reports,fixtures/scan-canary/dirty --quiet .',
    syft: "syft scan dir:. --exclude './reference/**' --exclude './reports/**' -o x",
    osv: "osv-scanner scan source -r --experimental-exclude 'g:**/.git/**' /src",
    retire: 'npx retire --path . --ignore reference,reports --outputformat json',
    find: "find . -name 'Dockerfile*' -not -path '*/.git/*' -not -path '*/dist/*'",
    cppcheck: 'cppcheck --quiet . 2> x',
    pmd: 'pmd check -d . -R category/java/errorprone.xml',
    phpcs: 'phpcs --report=json --extensions=php . > x',
    bearer: 'bearer scan . --format json',
    socket: 'socket scan create . --json',
    psalm: 'for sub in src app lib source .; do :; done',
  };
  for (const [tool, cmd] of Object.entries(before)) {
    assert.ok(!SCAN_EXCLUDE_ROOTS.every((r) => SPELLING[tool](cmd, r)), `${tool}'s spelling accepts a command that excludes nothing`);
  }
});

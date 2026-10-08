// guard: harness credentials never reach a scanner
export const HARNESS_ENV = /^(CLAUDE_|ANTHROPIC_|VELD_|SUBSTRATE_|SPINE_|MCP_)/;

export function scannerEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !HARNESS_ENV.test(k)));
}

// fact: a lane that runs repo code gets an allowlisted env / the denylist above let GH_TOKEN, AWS_*, NPM_TOKEN, COMMITWORK_TRUST_REPO_MANIFEST and CW_SANDBOX reach build scripts with open egress (review 2026-10-07 D4) (expiry: never, prev: broken)
// What a toolchain needs to find itself, its caches, a proxy and a CA; nothing here carries a credential.
const REPO_CODE_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'TZ', 'TMPDIR', 'LANG', 'LANGUAGE', 'CI',
  'NO_COLOR', 'FORCE_COLOR', 'COLORTERM', '__CF_USER_TEXT_ENCODING',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'JAVA_HOME', 'GOPATH', 'GOROOT', 'GOCACHE', 'GOMODCACHE', 'GOFLAGS', 'GOPROXY', 'GOPRIVATE', 'GONOPROXY', 'GONOSUMDB', 'GOSUMDB', 'GOTOOLCHAIN',
  'CARGO_HOME', 'RUSTUP_HOME', 'RUSTUP_TOOLCHAIN', 'CARGO_TARGET_DIR', 'LIBCLANG_PATH', 'DEVELOPER_DIR', 'SDKROOT',
  'npm_config_cache', 'NPM_CONFIG_CACHE', 'PIP_CACHE_DIR', 'COMPOSER_HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT',
  // Windows: a process without these cannot load its system libraries or find a temp dir
  'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'COMSPEC', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'TEMP', 'TMP', 'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  // commitwork's own wrappers (build-health, hermetic-test, depscan-scan.sh, codeql-*-build); bin/test/scanner-env.test.mjs holds the list against their reads
  'COMMITWORK_REPO', 'BH_DOCKER_ARGS', 'CW_ROOT', 'CW_REPORT_DIR', 'CW_CONTAINER_NAME', 'CW_CONTAINER_OWNER', 'CW_LOCKFILE_DIR', 'CW_NOW',
  'CW_TARGET_URL', 'CW_OPENAPI', 'CW_TLS_URL', 'CW_REGISTRY', 'CW_RUNNER_DISK_GB', 'CW_HERMETIC_TIMEOUT_SEC', 'CW_BH_PHASE_TIMEOUT',
]);
const REPO_CODE_PREFIXES = ['LC_', 'CW_DEPSCAN_', 'CW_DEPTH_', 'CW_INTENSITY_'];
// An analyser lane keeps the denylist, less the two switches no lane may hold.
const OPERATOR_SWITCHES = new Set(['CW_SANDBOX', 'COMMITWORK_TRUST_REPO_MANIFEST']);

// fact: `docker run -e NAME` forwards NAME from the docker client's own env / ci/run-ci.sh passes the CI database passwords that way so they never reach argv, and an allowlist that dropped them would boot the suite with no credentials (expiry: never, prev: missing)
export function dockerPassByName(args = '') {
  const words = String(args).split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const v = w === '-e' || w === '--env' ? words[++i] : w.startsWith('--env=') ? w.slice(6) : null;
    if (v && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) out.push(v);
  }
  return out;
}

/** The base env of a lane's shell: an allowlist where the check executes repo code, the denylist otherwise. */
export function laneEnv(check, env) {
  if (!(check && check.executesRepoCode === true)) {
    return Object.fromEntries(Object.entries(scannerEnv(env)).filter(([k]) => !OPERATOR_SWITCHES.has(k)));
  }
  // A secret the check declares is the one credential it may hold.
  const keep = new Set([...((check.requires && check.requires.secrets) || []), ...dockerPassByName(env.BH_DOCKER_ARGS)]);
  return Object.fromEntries(Object.entries(env).filter(([k]) => REPO_CODE_KEYS.has(k) || keep.has(k)
    || REPO_CODE_PREFIXES.some((p) => k.startsWith(p))));
}

// guard: the gh session reaches only a lane that declares its store and runs no repository code.
// The host sandbox denies the keychain gh keeps its token in, so gh inside it is anonymous (60
// requests an hour, public repositories only); the token is resolved out here instead. Never in CI,
// where a run must be handed a token explicitly, and never over one the operator already set.
export const GH_STORE = '~/.config/gh';

export function laneCredentialEnv(check, env, resolveGhToken) {
  if (!(check.sandboxExtraReads || []).includes(GH_STORE)) return {};
  if (check.executesRepoCode || env.CI || env.GH_TOKEN || env.GITHUB_TOKEN) return {};
  const token = resolveGhToken();
  return token ? { GH_TOKEN: token } : {};
}

// fact: a lane that runs java gets JAVA_HOME resolved outside the sandbox / Apple's /usr/bin/java stub asks java_home, which cannot resolve under the profile even with the JDK registry readable, and the CodeQL Java extractor died at "Unable to locate a Java Runtime", measured 2026-10-04 (expiry: never, prev: broken)
export function laneJavaEnv(check, env, resolveJavaHome) {
  if (!(check.requires?.tools || []).includes('java') || env.JAVA_HOME) return {};
  const home = resolveJavaHome();
  return home ? { JAVA_HOME: home } : {};
}

// guard: a headless model keeps only its own key
export function llmEnv(env) {
  return {
    ...scannerEnv(env),
    ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
    CW_GUARD_UNATTENDED: '1',
  };
}

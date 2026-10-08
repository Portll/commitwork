/**
 * The ONE place isolation is expressed: container postures for the docker lanes, and the host
 * posture (`hostSandboxArgv`) for every other lane. Pure — no I/O, no docker, no process exit —
 * except `probeHostSandbox` and `preflightHostSandbox`, which run the OS sandbox tool once with a
 * command that does nothing, so the runner can tell "confined" from "the wrapper never ran",
 * `symlinkReads`, which resolves the tree's links so the profile can name their targets, and the
 * Linux branch of `hostSandboxArgv`, which stats the credential stores and runtime directories it
 * masks and resolves the resolver config it replaces.
 *
 * WHY THIS EXISTS. On 2026-08-24 five call sites hand-rolled their own isolation and had drifted
 * into four different standards for one problem:
 *
 *   bin/depscan-scan.sh    --network none, src :ro, --user 1000:1000, --cap-drop ALL,
 *                          no-new-privileges, --pids-limit 512, --memory 6g, tmpfs noexec  (strong)
 *   bin/boot-harness.sh    --cap-drop ALL, no-new-privileges, --pids-limit 256, --memory 2g,
 *                          but root, no tmpfs, and internet reachable BY ITS OWN ADMISSION
 *   bin/lockfile-synth.sh  its own subset
 *   deps-osv               -v $PWD:/src:ro and nothing else — default bridge network, root, ALL caps
 *   supply-chain-guarddog  the same
 *
 * The weakest two run on every repo in group `all`, over a corpus holding 26 OSV-confirmed
 * malicious packages. Isolation that is re-derived per lane cannot be reviewed in one place, and
 * the review is the point.
 *
 * A POSTURE IS A DECLARATION, NOT A PRESET. The postures differ because the tensions are real and
 * irreducible: an analyser reading source needs no network at all; a dependency warm-phase needs
 * the network and must therefore mount no repo code; a boot probe must reach the internet because
 * the application does; and a sanitizer must EXECUTE what it just built, so it cannot have the
 * `noexec` scratch that makes the analyse posture safe. Naming them forces the trade to be stated
 * rather than silently inherited from whichever lane was copied.
 *
 * fact: an unknown posture throws — fail closed (expiry: never, prev: broken)
 * fact: a missing container name throws / a check that times out must be able to reap what it started, and `docker run` is a client whose death leaves the container running on the daemon (expiry: never, prev: broken)
 * fact: mounting the docker socket, the filesystem root, or a credential directory throws regardless of posture / those are host-equivalent and no posture may opt into them (expiry: never, prev: broken)
 * fact: weakening egress is possible but never SILENT — it returns a warning the caller prints, as CW_DEPSCAN_ALLOW_NET already does (expiry: never, prev: broken)
 */

import { spawnSync } from 'node:child_process';
import * as fsSync from 'node:fs';

/** Host paths no posture may ever mount. Prefix-matched after normalisation. */
const FORBIDDEN_MOUNTS = [
  '/var/run/docker.sock', '/run/docker.sock',   // root-equivalent on the daemon host
  '/etc', '/dev', '/proc', '/sys',
];
/** Path segments that mark credential material wherever they appear. */
export const FORBIDDEN_SEGMENTS = ['.ssh', '.aws', '.gnupg', '.docker', '.kube', 'Keychains', '.netrc'];
/** Denied by both host sandboxes after every allow; no declaration reaches them. */
const deniedCredentials = (h) => [...FORBIDDEN_SEGMENTS.map((s) => `${h}/${s}`), `${h}/Library/Keychains`, '/Library/Keychains'];
// fact: these hold tokens no FORBIDDEN_SEGMENTS entry names / the macOS allowlist keeps them from any lane whose readable set does not reach them, and bwrap has none, so Linux masks them on that condition (expiry: never, prev: missing)
export const DECLARABLE_CREDENTIALS = ['.config/gh', '.config/gcloud', '.azure', '.git-credentials', '.npmrc', '.pypirc', '.cargo/credentials', '.cargo/credentials.toml'];
const within = (p, root) => p === root || p.startsWith(`${root}/`);
const overlaps = (a, b) => within(a, b) || within(b, a);

/**
 * The declared postures. Each states what it may do and why it differs from the strictest one.
 * `network: 'none'` severs egress; `'bridge'` permits it and is only allowed where the comment
 * explains why the lane cannot function without it.
 */
export const POSTURES = {
  // An analyser READS untrusted source. It never needs egress and never needs to run repo code.
  // This is the strictest posture and the default for anything pointed at a third-party tree.
  analyse: {
    network: 'none', user: '1000:1000', pidsLimit: 512, memory: '6g',
    tmpfs: '/tmp:rw,noexec,nosuid,size=2g', allowSourceMount: true, allowRwSource: false,
    addCaps: [], why: 'reads source; egress and execution are both unnecessary',
  },
  // The warm/fetch phase: it MAY reach the network, and therefore MUST NOT mount repo code.
  // That pairing is the whole point — it is what lets the next phase run offline over a
  // pre-populated volume. depscan measured the alternative: with the network severed at scan time
  // and no warm phase, 0 of 29 repos resolved, ~7 min of retries each (2026-08-23).
  fetch: {
    network: 'bridge', user: '1000:1000', pidsLimit: 256, memory: '4g',
    tmpfs: '/tmp:rw,noexec,nosuid,size=1g', allowSourceMount: false, allowRwSource: false,
    addCaps: [], why: 'network-on, so no repo code may be present to execute',
  },
  // fact: egress is open AND the source is mounted, which `fetch` forbids / `fetch`'s rule conflated PRESENT with EXECUTED — osv-scanner and GuardDog only PARSE lockfiles and package.json, unlike cdxgen, which runs repo-authored build logic and is correctly severed in depscan-scan.sh (expiry: if either tool starts executing manifest hooks, prev: wrong)
  // fact: under --network none osv-scanner cannot reach api.osv.dev and GuardDog cannot reach registry.npmjs.org (measured 2026-08-25 on a one-dependency fixture) / `analyse` here is not stricter, it is wrong (expiry: if either tool gains an offline database, prev: wrong)
  // fact: for osv-scanner the severed run is DANGEROUS, not merely empty / it exits 0 in table mode and writes a SARIF with zero results and an empty invocations[], which commitwork's own parseReport grades `sev: ok` — a clean scan of nothing (expiry: never, prev: broken)
  lookup: {
    network: 'bridge', user: '1000:1000', pidsLimit: 256, memory: '4g',
    tmpfs: '/tmp:rw,noexec,nosuid,size=1g', allowSourceMount: true, allowRwSource: false,
    addCaps: [], why: 'parses untrusted manifests and queries an advisory API; reads repo files, never executes them',
  },
  // Builds and boots the subject's application. Egress is open because the application needs it;
  // that is a real weakness and is why this posture must not be used for deliberately hostile code.
  boot: {
    network: 'bridge', user: null, pidsLimit: 256, memory: '2g',
    tmpfs: null, allowSourceMount: true, allowRwSource: false,
    addCaps: [], why: 'runs the subject application, which needs egress — NOT for hostile code',
  },
  // Resolution: turning an unpinned manifest into a pinned one by talking to a registry. Egress is
  // required because resolution IS the registry conversation. The source is NOT mounted — these
  // lanes copy the single manifest into a scratch dir first, deliberately leaving setup.py and the
  // rest of the tree behind, which is the difference between resolving a manifest and running one.
  //
  // fact: this needs its own posture because it cannot run as a fixed 1000:1000 like `fetch`/`lookup` / its product is a lockfile written into a host-mounted scratch dir the host must READ, copy and delete, so under a fixed uid the files land owned by 1000 and any box whose operator is not uid 1000 gets an artifact the lane cannot pick up — a scan that silently yields nothing (expiry: never, prev: broken)
  // fact: `hostUser` is a declared PROPERTY of the posture, resolved by the sandbox from the invoking process / a caller-supplied --user would be an arbitrary hole in the one place isolation is meant to be reviewable (expiry: never, prev: unknown)
  resolve: {
    network: 'bridge', user: null, hostUser: true, pidsLimit: 512, memory: '2g',
    tmpfs: null, allowSourceMount: false, allowRwSource: false,
    addCaps: [], why: 'resolves a copied manifest against a registry and must hand the result back to the host uid',
  },
  // Resolving a JVM dependency graph, which is the one job that CANNOT be done by reading files.
  // `gradle dependencies` evaluates build.gradle — arbitrary Groovy or Kotlin — and Maven resolves
  // parent POMs and properties through plugins that also run. Both need the network while doing it,
  // because resolution IS the registry conversation. Every other posture refuses that pairing on
  // purpose, and refusing it here would just mean the lane never runs.
  //
  // SO THE CONTROL IS NOT ISOLATION, IT IS EGRESS SCOPE. `analyse` protects by severing the
  // network; this cannot. What it can do is make the reachable set small: `requiresEgressProxy`
  // means buildSandbox REFUSES to emit flags unless the caller names a filtering proxy and a
  // private network, so "arbitrary code with the internet" becomes "arbitrary code that can reach
  // the artifact registries and nothing else". A posture whose only real control is optional is a
  // posture with no control, so it is structural rather than a flag someone remembers.
  //
  // TWO HARDENINGS ARE DELIBERATELY ABSENT AND SAID SO HERE RATHER THAN DISCOVERED LATER.
  // `noexec` scratch is impossible: Gradle extracts and runs native helpers, and the JVM needs an
  // executable temp. And the daemon must be off (`--no-daemon`), because a daemon outlives the
  // container's command and would carry state between repos.
  //
  // This is the weakest posture in this file after `boot`, and unlike `boot` it is pointed at code
  // nobody here has read. It exists because the alternative is a permanent coverage void over 29
  // JVM repos, and that trade should be visible rather than implied.
  'build-resolve': {
    network: 'bridge', user: null, hostUser: true, pidsLimit: 2048, memory: '4g',
    tmpfs: null, allowSourceMount: true, allowRwSource: false,
    requiresEgressProxy: true,
    addCaps: [],
    why: 'evaluates repo build logic while talking to an artifact registry; egress is scoped by a proxy, not severed',
  },
  // Executes instrumented subject code (sanitizers, fuzzers). Egress DENIED, unlike boot: this
  // posture exists precisely for code assumed hostile. Scratch is exec-able because the whole
  // point is to run the binary that was just built — the `noexec` that protects `analyse` would
  // make this posture impossible. Larger pids/memory because a fuzzer fork-bombs and OOMs by
  // design, which is what --pids-limit and --memory are there to bound.
  instrument: {
    network: 'none', user: '1000:1000', pidsLimit: 1024, memory: '8g',
    tmpfs: '/work:rw,exec,nosuid,size=4g', allowSourceMount: true, allowRwSource: false,
    addCaps: [], why: 'executes instrumented code with egress denied',
  },
};

// SEPARATORS ARE NORMALISED FIRST, and this guard FAILED OPEN without it.
//
// Every check below is written against `/` — `p.startsWith(bad + '/')` and `p.split('/')`. A Windows
// path uses `\`, so `'C:\Users\me\.ssh'.split('/')` is a ONE-element array and the credential
// segment is never found. Measured 2026-09-04: assertMountAllowed refused `/home/u/.ssh` and
// ALLOWED `C:\Users\me\.ssh`, `.aws` and `.gnupg`.
//
// That direction matters. Every other separator defect found in this codebase failed CLOSED — a
// gate flagging everything, a lane reading noscan. This one is a refusal that stopped refusing, so
// it is silent by construction: nothing errors, nothing is flagged, the mount is simply permitted
// and the container gets the operator's SSH keys. A guard that fails open is worse than no guard,
// because its presence is the argument for not looking again.
const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '') || '/';

/** Throws if a host path is one no posture may expose. Checked before any posture logic. */
export function assertMountAllowed(hostPath) {
  const p = norm(hostPath);
  if (p === '/') throw new Error('sandbox: refusing to mount the filesystem root');
  for (const bad of FORBIDDEN_MOUNTS) {
    if (p === bad || p.startsWith(bad + '/')) {
      throw new Error(`sandbox: refusing to mount ${p} — ${bad} is host-equivalent and no posture may opt into it`);
    }
  }
  for (const seg of FORBIDDEN_SEGMENTS) {
    if (p.split('/').includes(seg)) {
      throw new Error(`sandbox: refusing to mount ${p} — it contains credential material (${seg})`);
    }
  }
  return true;
}

/**
 * Build the docker argument list for a sandboxed run.
 *
 * @param {object} spec
 * @param {string} spec.posture   one of POSTURES
 * @param {string} spec.name      container name — REQUIRED so a timeout can reap it
 * @param {Array}  [spec.mounts]  [{ host, path, mode:'ro'|'rw', source?:boolean }]
 * @param {object} [spec.env]     environment passed through
 * @param {string} [spec.memory]  override the posture floor
 * @param {number} [spec.pidsLimit]
 * @param {boolean}[spec.allowNetwork] explicit, loud egress escape for a network:'none' posture
 * @param {boolean}[spec.keepContainer] omit --rm; for a lane whose container must outlive the run
 * @param {string} [spec.owner]   <pid>.<start ms> of the CLI run that owns it (monitor/containers.mjs)
 * @returns {{args:string[], warnings:string[], posture:string}}
 */
export function buildSandbox(spec = {}) {
  const {
    posture, name, mounts = [], env = {}, memory, pidsLimit,
    allowNetwork = false, keepContainer = false, egressProxy = null, egressNetwork = null, owner = null,
  } = spec;

  const p = POSTURES[posture];
  if (!p) {
    throw new Error(`sandbox: unknown posture ${JSON.stringify(posture)} — declared: ${Object.keys(POSTURES).join(', ')}. `
      + 'Refusing to guess an isolation level.');
  }
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    throw new Error('sandbox: a container name is REQUIRED and must match docker\'s charset — '
      + '`docker run` is a client, so a killed check leaves an unnamed container running on the daemon with nothing to reap it by');
  }

  const warnings = [];
  // `--rm` is the default because a scanner container is finished when its command is. A lane that
  // must OUTLIVE the script that started it — boot-harness starts a container for the runtime
  // lanes to scan afterwards — asks for `keepContainer` here rather than editing the flag list
  // afterwards. A caller post-processing this output is the same defect as a caller re-deriving
  // it, and the container name is REQUIRED precisely so a kept container is still reapable.
  const args = keepContainer ? ['--name', name] : ['--rm', '--name', name];
  // A malformed owner would read as undetermined to the reaper forever, so it is refused here.
  if (owner) {
    if (!/^[1-9]\d*\.\d+$/.test(String(owner))) {
      throw new Error(`sandbox: owner ${JSON.stringify(owner)} is not <pid>.<start ms> (CW_CONTAINER_OWNER) — `
        + 'a sweep could neither spare this container while its run lives nor reap it after');
    }
    args.push('--label', `cw.owner=${owner}`);
  }

  // Network. Severing is the default wherever the posture says so; opening it is explicit and loud.
  let network = p.network;
  if (p.network === 'none' && allowNetwork) {
    network = 'bridge';
    warnings.push(`sandbox: posture '${posture}' declares network:none and allowNetwork was set — `
      + 'egress is OPEN for this run. This is the un-sandboxed mode; anything executed can exfiltrate.');
  }
  if (network === 'none') args.push('--network', 'none');

  // An egress-proxy posture cannot fall back to open egress. Both the private network and the
  // proxy are required, because either alone is not a control: a private network with no proxy
  // cannot resolve anything, and a proxy on the default bridge is one `curl` away from irrelevant.
  if (p.requiresEgressProxy) {
    if (!egressNetwork || !egressProxy) {
      throw new Error(`sandbox: posture '${posture}' requires BOTH egressNetwork and egressProxy. `
        + 'Its only real control is the size of the reachable set, so emitting flags without one '
        + 'would hand repo-authored build logic the open internet under a name that implies otherwise.');
    }
    if (allowNetwork) {
      throw new Error(`sandbox: allowNetwork is meaningless on '${posture}' and is refused — `
        + 'egress is already open BY DESIGN here and is bounded by the proxy, not by a flag.');
    }
    args.push('--network', egressNetwork);
    // Proxy env in every casing the JVM toolchain reads. Gradle and Maven honour the lowercase
    // pair; some plugins read the uppercase. Setting one and not the other is a silent bypass.
    for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']) args.push('-e', `${k}=${egressProxy}`);
    // No NO_PROXY: an exemption list here is exactly the hole the proxy exists to close.
    args.push('-e', 'no_proxy=', '-e', 'NO_PROXY=');
    warnings.push(`sandbox: posture '${posture}' runs repo-authored build logic. Egress is bounded by ${egressProxy} `
      + `on network ${egressNetwork} — nothing else is reachable, and nothing here has been read by a human.`);
  } else if (egressProxy || egressNetwork) {
    throw new Error(`sandbox: posture '${posture}' does not declare requiresEgressProxy, so an egress proxy would `
      + 'be decoration. Refusing rather than accepting a control the posture does not enforce.');
  }

  // Non-negotiable across every posture.
  args.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges');
  for (const cap of p.addCaps) args.push('--cap-add', cap);
  // `hostUser` is resolved HERE, from the running process, so no caller ever passes a --user.
  if (p.hostUser) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    const gid = typeof process.getgid === 'function' ? process.getgid() : null;
    if (uid === null || gid === null) {
      throw new Error(`sandbox: posture '${posture}' requires the host uid:gid and this platform does not expose one. `
        + 'Running as root instead would hand the container more privilege than the posture declares, so this refuses.');
    }
    if (uid === 0) {
      warnings.push(`sandbox: posture '${posture}' resolves to the host uid and this process is ROOT — `
        + 'the container will run as root. That is a real weakening; run the lane as an ordinary user.');
    }
    args.push('--user', `${uid}:${gid}`);
  } else if (p.user) {
    args.push('--user', p.user);
  }

  args.push('--pids-limit', String(pidsLimit ?? p.pidsLimit));
  args.push('--memory', String(memory ?? p.memory));
  if (p.tmpfs) args.push('--tmpfs', p.tmpfs);

  for (const m of mounts) {
    const host = norm(m.host);
    assertMountAllowed(host);
    const mode = m.mode === 'rw' ? 'rw' : 'ro';
    if (m.source && !p.allowSourceMount) {
      throw new Error(`sandbox: posture '${posture}' forbids mounting repo source (${p.why}). `
        + 'Mounting it here would put executable repo content in a container that can reach the network.');
    }
    if (m.source && mode === 'rw' && !p.allowRwSource) {
      throw new Error(`sandbox: posture '${posture}' refuses a WRITABLE source mount — `
        + 'a scanner that can rewrite the tree it is scanning invalidates its own evidence');
    }
    args.push('-v', `${host}:${m.path}:${mode}`);
  }

  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);

  return { args, warnings, posture };
}

/** POSIX single-quote escaping, so the CLI can hand a flag list to a shell script safely. */
export function shellQuote(args) {
  return args.map((a) => (/^[A-Za-z0-9_.:,=\/@-]+$/.test(a) ? a : `'${String(a).replace(/'/g, `'\\''`)}'`)).join(' ');
}

// ── HOST POSTURE: one lane, one `sh -c`, confined by the OS sandbox ───────────────────────────
// A lane declares its egress CLASS and the wrapper turns it into a network rule; the filesystem
// rule is the same for every class. `none` is the strict posture; the other classes name what the
// lane reaches, so a reader can ask whether it should.
export const EGRESS = Object.freeze({
  none: 'reads the tree only; network denied',
  registry: 'package registries, advisory databases and rule/query packs',
  verifiers: 'the credential-issuing services TruffleHog verifies a candidate against',
  github: 'the GitHub API for the scanned repository',
  target: 'the live URL under test (CW_TARGET_URL); on loopback, only that URL\'s port',
});
export const EGRESS_CLASSES = Object.freeze(Object.keys(EGRESS));

const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\]|\[::ffff:127(?:\.\d{1,3}){3}\])$/i;
// fact: a `target` lane reaches loopback only on the ports its own target URLs name / a local app under test is the one legitimate loopback peer, and any wider allowance hands the lane the runner on :7980 and the panel on :7878 (expiry: never, prev: missing)
/** The loopback ports a `target` lane may connect to: those of CW_TARGET_URL, CW_TLS_URL and an http CW_OPENAPI. */
export function targetLoopbackPorts(env = {}) {
  const ports = new Set();
  for (const k of ['CW_TARGET_URL', 'CW_TLS_URL', 'CW_OPENAPI']) {
    let u; try { u = new URL(String(env[k] || '')); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || !LOOPBACK_HOST.test(u.hostname)) continue;
    ports.add(Number(u.port || (u.protocol === 'https:' ? 443 : 80)));
  }
  return [...ports].sort((a, b) => a - b);
}

// fact: seatbelt matches the RESOLVED path, so a rule for /tmp/x never fires when the kernel sees /private/tmp/x / measured 2026-09-16, every write to a /tmp report dir was EPERM under a profile that named it (expiry: never, prev: broken)
const MAC_ALIASES = [['/tmp', '/private/tmp'], ['/var', '/private/var'], ['/etc', '/private/etc']];
const MAC_SYSTEM_READS = ['/usr', '/bin', '/sbin', '/opt/homebrew', '/System', '/Library', '/private/etc', '/private/var/db', '/private/tmp', '/dev'];
const MAC_RESOLVER_READS = ['/private/var/run/resolv.conf'];
/** An Xcode.app developer dir widens to the bundle's Contents; any other developer dir is itself. */
export const xcodeBundleContents = (dir) => (/\.app\/Contents\/Developer$/.test(dir) ? dir.slice(0, -'/Developer'.length) : dir);

const assertSandboxPath = (p, what) => {
  if (typeof p !== 'string' || !p.startsWith('/')) throw new Error(`sandbox: ${what} must be an absolute path, got ${JSON.stringify(p)}`);
  if (/["\\\n\r\0]/.test(p)) throw new Error(`sandbox: ${what} ${JSON.stringify(p)} contains a character the profile grammar cannot carry; refusing rather than emitting a profile that compiles to something else`);
  return p.replace(/\/+$/, '') || '/';
};

const macForms = (p) => {
  const out = [p];
  for (const [from, to] of MAC_ALIASES) if (p === from || p.startsWith(`${from}/`)) out.push(to + p.slice(from.length));
  return out;
};
const subpaths = (paths) => paths.flatMap(macForms).map((p) => `(subpath "${p}")`).join(' ');
// fact: every ancestor directory of an allowed path is readable as a literal / Java's toRealPath walks /opt itself and CodeQL died at "/opt: Operation not permitted" under a profile that allowed /opt/homebrew (expiry: never, prev: broken)
const ancestors = (paths) => {
  const seen = new Set();
  for (const p of paths.flatMap(macForms)) {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) seen.add(`/${parts.slice(0, i).join('/')}`);
  }
  return [...seen].sort().map((p) => `(literal "${p}")`).join(' ');
};

// fact: an extra path is declared by the lane, so `~/` and `./` are the only two prefixes it may use besides `/` / a bare relative path would resolve against whichever cwd the runner happened to have (expiry: never, prev: not built)
// fact: @usercache/ names the per-user cache dir (getconf DARWIN_USER_CACHE_DIR) / swiftc writes its clang module cache there, a sibling of TMPDIR whose path differs per user and machine, so a manifest cannot spell it (expiry: never, prev: missing)
export function expandSandboxPath(p, { home, repoPath, userCacheDir = null }) {
  if (typeof p !== 'string') throw new Error(`sandbox: extra path must be a string, got ${JSON.stringify(p)}`);
  if (p === '~' || p.startsWith('~/')) return `${home}${p.slice(1)}`;
  if (p === '@usercache' || p.startsWith('@usercache/')) {
    if (!userCacheDir) throw new Error(`sandbox: ${p} names the per-user cache dir, which this host does not report`);
    return `${userCacheDir}${p.slice('@usercache'.length)}`;
  }
  if (p === '.' || p.startsWith('./')) return `${repoPath}${p.slice(1)}`;
  return p;
}

// fact: only a store present on the host is masked / bwrap 0.12 dies at "Can't create file …: Read-only file system" on an absent one, measured 2026-09-27, and a stat error other than ENOENT or ENOTDIR refuses rather than leaving the store readable (expiry: never, prev: missing)
// fact: a store is masked at its resolved path / bwrap 0.12 dies at "Can't mount on symlink destination" on a symlinked ~/.kube, measured 2026-09-27 (expiry: never, prev: broken)
const credentialMasks = (paths, fs) => {
  const masks = new Map();
  for (const p of paths) {
    let real; let st;
    try { real = fs.realpathSync(p); st = fs.statSync(real); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') continue;
      throw new Error(`sandbox: cannot tell whether the credential store ${p} exists (${e.code || e.message}); refusing rather than leaving it readable`);
    }
    masks.set(real, st.isDirectory() ? ['--tmpfs', real] : ['--ro-bind', '/dev/null', real]);
  }
  return [...masks.values()].flat();
};

// fact: /run is a tmpfs in every Linux lane / a read-only bind still lets connect() reach a unix socket, and under egress none a lane connected to a socket in /run, where the docker socket, the session bus and agent sockets live, measured 2026-10-07 in a bookworm container (expiry: never, prev: broken)
const RUNTIME_DIRS = ['/run', '/var/run'];
const runtimeMasks = (fs) => {
  const real = new Set();
  for (const p of RUNTIME_DIRS) {
    let r; let st;
    try { r = fs.realpathSync(p); st = fs.statSync(r); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') continue;
      throw new Error(`sandbox: cannot tell whether ${p} exists (${e.code || e.message}); refusing rather than leaving its sockets reachable`);
    }
    if (st.isDirectory()) real.add(r);
  }
  return [...real].flatMap((r) => ['--tmpfs', r]);
};
// The path the lane's resolv.conf is written over: /etc/resolv.conf resolved, since bwrap cannot mount on a link.
const resolverTarget = (fs) => {
  try { return fs.realpathSync('/etc/resolv.conf'); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw new Error(`sandbox: cannot resolve /etc/resolv.conf (${e.code || e.message}); refusing rather than guessing the lane's resolver`);
  }
};

/**
 * The argv that runs `sh -c cmd` under the host sandbox. Deterministic: every path is an input and
 * nothing is read from the environment. The macOS profile reads nothing from disk; the Linux argv
 * stats each credential store through `fs` to decide whether it exists and how to mask it.
 *
 * @returns {{argv:string[], prefix:string[], isolation:'full'|'fs-only', profile:string|null}}
 */
export function hostSandboxArgv(spec = {}) {
  const {
    cmd, egress, repoPath, reportDir, platform, cwRoot, nodePrefix, tmpDir, home,
    developerDir = null, toolPrefixes = [], extraReads = [], extraWrites = [], userCacheDir = null, fs = fsSync,
    loopbackPorts = [],
  } = spec;
  if (typeof cmd !== 'string' || !cmd.trim()) throw new Error('sandbox: a command is required');
  if (!EGRESS_CLASSES.includes(egress)) {
    throw new Error(`sandbox: egress ${JSON.stringify(egress)} is not one of ${EGRESS_CLASSES.join('|')}. `
      + 'A lane without a declared egress class is not wrapped with a guessed one.');
  }
  if (!Array.isArray(loopbackPorts) || loopbackPorts.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
    throw new Error(`sandbox: loopbackPorts must be ports 1-65535, got ${JSON.stringify(loopbackPorts)}`);
  }
  if (loopbackPorts.length && egress !== 'target') {
    throw new Error(`sandbox: a loopback port is an exception of the target class only; egress ${egress} reaches no local service`);
  }
  const lbPorts = [...new Set(loopbackPorts)].sort((a, b) => a - b);
  const repo = assertSandboxPath(repoPath, 'repoPath');
  const report = assertSandboxPath(reportDir, 'reportDir');
  const tmp = assertSandboxPath(tmpDir, 'tmpDir');
  const isolation = egress === 'none' ? 'full' : 'fs-only';
  const reads = [...toolPrefixes, ...extraReads].map((p, i) => assertSandboxPath(expandSandboxPath(p, { home, repoPath: repo, userCacheDir }), `read path #${i + 1}`));
  const writes = extraWrites.map((p, i) => assertSandboxPath(expandSandboxPath(p, { home, repoPath: repo, userCacheDir }), `write path #${i + 1}`));
  const h = assertSandboxPath(home, 'home');
  const denied = deniedCredentials(h);
  for (const p of [report, tmp, ...writes]) {
    const store = denied.find((c) => within(p, c));
    if (store) throw new Error(`sandbox: ${p} is inside ${store}, which is denied after every allow; a write there could only fail or be shadowed`);
  }

  if (platform === 'darwin') {
    const root = assertSandboxPath(cwRoot, 'cwRoot');
    const node = assertSandboxPath(nodePrefix, 'nodePrefix');
    // fact: an Xcode developer dir is readable together with its bundle's Contents / xcodebuild, which the cc and xcrun shims run to find the toolchain, loads Contents/SharedFrameworks beside Developer: cargo test linked nothing ("cc: unable to locate xcodebuild") and CodeQL's tracer could not find install_name_tool, measured 2026-10-04 (expiry: never, prev: broken)
    const dev = developerDir ? [xcodeBundleContents(assertSandboxPath(developerDir, 'developerDir'))] : [];
    // fact: a declared write path is readable too / semgrep reads ~/.semgrep/settings.yml before it writes it, and a cache nobody can read back is not a cache (expiry: never, prev: broken)
    const readable = [repo, report, root, node, tmp, ...dev, `${h}/.config/git`, ...reads, ...writes];
    const profile = [
      '(version 1)',
      '(deny default)',
      '(allow process-fork)',
      '(allow process-exec*)',
      '(allow file-map-executable)',
      '(allow process-info*)',
      '(allow signal (target same-sandbox))',
      '(allow sysctl-read)',
      '(allow mach-lookup)',
      '(allow ipc-posix-shm*)',
      // fact: named semaphores of both families are allowed / CodeQL's python tracer died in multiprocessing.SemLock (sem_open) and its C++ extractor imports semget/semop and aborted every compilation with "Failed to open LMDB database (1)", measured 2026-09-18 on a one-file repo: sysv-sem alone took it from f=1 to s=1 (expiry: never, prev: broken)
      '(allow ipc-posix-sem*)',
      '(allow ipc-sysv-sem)',
      '(allow file-read-metadata)',
      '(allow file-ioctl (literal "/dev/tty") (literal "/dev/null"))',
      `(allow file-read* (literal "/") ${subpaths(MAC_SYSTEM_READS)})`,
      // fact: git treats EPERM on its global config as fatal where ENOENT is fine / every `git log` under the first profile died at ~/.gitconfig, measured 2026-09-16 (expiry: never, prev: broken)
      // fact: the report dir is in the READ set as well as the write set / a lane parses the report it just wrote, and file-write* does not imply file-read* (expiry: never, prev: broken)
      `(allow file-read* ${subpaths(readable)} (literal "${h}/.gitconfig"))`,
      `(allow file-read* ${ancestors([...MAC_SYSTEM_READS, ...readable, `${h}/.gitconfig`])})`,
      // fact: /tmp is writable for every lane / tools hardcode it (joern-scan writes /tmp/joern-scan-log.txt and died there under a TMPDIR-only profile, 2026-09-16), and it is world-writable to begin with, so this widens nothing the tool could not already reach (expiry: never, prev: broken)
      `(allow file-write* ${subpaths([report, tmp, '/tmp', ...writes])} (literal "/dev/null"))`,
      `(deny file-read* file-write* ${denied.map((p) => `(literal "${p}") (subpath "${p}")`).join(' ')})`,
      ...(egress === 'none' ? ['(deny network*)'] : [
        '(allow network*)',
        // fact: an open lane reaches the internet and no local service / under `(allow network*)` repo code connected to a loopback listener and a unix socket in /tmp, which is the tokenless runner on :7980, the panel on :7878 and /tmp/cc-socks (review 2026-10-07 D1) (expiry: never, prev: broken)
        // fact: loopback is denied as `ip4 localhost` plus ALL of ip6 / `ip "localhost:*"` let ::ffff:127.0.0.1 through, and beside any ip6 rule it stopped matching ipv4 at all; seatbelt's localhost also covers the host's LAN address, measured 2026-10-07 (expiry: never, prev: broken)
        '(deny network-outbound (remote ip4 "localhost:*") (remote ip6 "*:*") (remote unix-socket))',
        // fact: getaddrinfo is a unix-socket call to mDNSResponder / with every unix socket denied, node's dns.lookup and fetch died at ENOTFOUND, measured 2026-10-07 (expiry: never, prev: broken)
        '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))',
        ...lbPorts.map((p) => `(allow network-outbound (remote ip4 "localhost:${p}") (remote ip6 "localhost:${p}"))`),
      ]),
      // fact: a lane that may reach the network may read the resolver config / /etc/resolv.conf links to /private/var/run/resolv.conf, outside /private/etc, and Ruby's Resolv opens it at load: bundle-audit died before it started under the registry profile and the lane wrote nothing, measured 2026-10-04 (expiry: never, prev: broken)
      ...(egress === 'none' ? [] : [`(allow file-read* ${MAC_RESOLVER_READS.map((p) => `(literal "${p}")`).join(' ')})`]),
    ].join('\n');
    const prefix = ['sandbox-exec', '-p', profile];
    return { argv: [...prefix, '/bin/sh', '-c', cmd], prefix, isolation, profile };
  }
  if (platform === 'linux') {
    // fact: --tmpfs /tmp is mounted BEFORE the report dir bind, so a report dir under /tmp stays writable / bwrap applies mounts in argument order and a later tmpfs would shadow the bind (expiry: never, prev: unknown)
    // fact: the runtime-dir tmpfs precedes every bind, so a report dir or declared write under /run stays reachable (expiry: never, prev: missing)
    const bw = ['bwrap', '--ro-bind', '/', '/', '--tmpfs', '/tmp', ...runtimeMasks(fs), '--bind', report, report];
    if (!(tmp === '/tmp' || tmp.startsWith('/tmp/'))) bw.push('--bind', tmp, tmp);
    for (const w of writes) bw.push('--bind', w, w);
    // fact: the credential masks follow every bind / bwrap's later mount wins, as seatbelt's later rule does: a ~/.ssh mask placed before a declared write of ~ read the key back under bwrap 0.12, measured 2026-09-27 (expiry: never, prev: missing)
    // A declaration inside a declarable store unmasks all of it: coarser than seatbelt, which opens only that path.
    const readable = [repo, report, tmp, cwRoot, nodePrefix, developerDir, ...reads, ...writes].filter(Boolean);
    const declarable = DECLARABLE_CREDENTIALS.map((s) => `${h}/${s}`).filter((c) => !readable.some((r) => overlaps(c, r)));
    bw.push(...credentialMasks([...denied, ...declarable], fs));
    if (egress === 'none') {
      bw.push('--unshare-net', '--die-with-parent', '--');
      return { argv: [...bw, 'sh', '-c', cmd], prefix: bw, isolation, profile: null };
    }
    // fact: an open Linux lane gets its own network namespace, connected by pasta through sandbox-net.mjs / in the host namespace repo code reached every loopback port and abstract socket, and bwrap cannot filter destinations there (review 2026-10-07 D1) (expiry: never, prev: broken)
    // The command is held at --block-fd until pasta has configured the namespace; fds 3-5 belong to the helper.
    const resolv = resolverTarget(fs);
    if (resolv) bw.push('--ro-bind-data', '5', resolv);
    bw.push('--unshare-net', '--info-fd', '3', '--block-fd', '4', '--die-with-parent', '--');
    const root = assertSandboxPath(cwRoot, 'cwRoot');
    const node = assertSandboxPath(nodePrefix, 'nodePrefix');
    const prefix = [`${node}/bin/node`, `${root}/bin/lib/sandbox-net.mjs`, ...(lbPorts.length ? ['--loopback', lbPorts.join(',')] : []), '--', ...bw];
    return { argv: [...prefix, 'sh', '-c', cmd], prefix, isolation, profile: null };
  }
  throw new Error(`sandbox: no host sandbox for platform ${JSON.stringify(platform)}`);
}

const forbiddenWhy = (p) => { try { assertMountAllowed(p); return null; } catch (e) { return e.message.replace(/^sandbox: refusing to mount \S+ — /, ''); } };

/**
 * Reads the disk: the symlinks in the top two levels of the tree (and any declared extra read that
 * is itself a link) resolved to the targets the profile must also allow. A target inside the tree
 * needs nothing; one that resolves into a forbidden mount or a credential directory is refused
 * and named, never silently allowed.
 *
 * fact: seatbelt follows the link and judges the TARGET / socket died at "EPERM scandir evaluations" on a tree whose evaluations is a link to a sidecar outside it, measured 2026-09-16 (expiry: never, prev: broken)
 * @returns {{reads:string[], refused:string[]}}
 */
export function symlinkReads(repoPath, extraReads = [], { home = '', fs = fsSync } = {}) {
  const repo = fs.realpathSync(repoPath);
  const inside = (p) => p === repo || p.startsWith(`${repo}/`);
  const reads = new Set(); const refused = [];
  // fact: a target that holds a credential store is refused too / a committed link to the home directory put all of it in the read set, and on Linux it would unmask every declarable store (expiry: never, prev: broken)
  let h = home; try { if (home) h = fs.realpathSync(home); } catch { /* an absent home holds no store */ }
  const stores = h ? [...deniedCredentials(h), ...DECLARABLE_CREDENTIALS.map((s) => `${h}/${s}`)] : [];
  const consider = (link) => {
    let target;
    try { if (!fs.lstatSync(link).isSymbolicLink()) return; target = fs.realpathSync(link); } catch { return; }
    if (inside(target)) return;
    const store = stores.find((c) => overlaps(target, c));
    const why = forbiddenWhy(target) || (store && `it overlaps the credential store ${store}`);
    if (why) { refused.push(`${link} -> ${target}: ${why}`); return; }
    reads.add(target);
  };
  const SKIP = new Set(['.git', 'node_modules', 'reports', 'target', 'vendor', 'dist', 'build', '.gradle']);
  const list = (dir) => { try { return fs.readdirSync(dir).filter((n) => !SKIP.has(n)).map((n) => `${dir}/${n}`); } catch { return []; } };
  // fact: the walk is unbounded / links sat four levels down (map/data/<area>) and every depth cap missed one (expiry: never, prev: broken)
  const walk = (dir) => {
    for (const p of list(dir)) {
      consider(p);
      let st; try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
    }
  };
  walk(repo);
  for (const p of extraReads) consider(expandSandboxPath(p, { home, repoPath: repo }));
  return { reads: [...reads].sort(), refused };
}

let probed = null;
export function resetHostSandboxProbe() { probed = null; }

/** Once per process: can this host confine a command at all, and what does git need to be told? */
export function probeHostSandbox({ platform = process.platform, spawn = spawnSync } = {}) {
  if (probed && probed.platform === platform) return probed;
  const run = (bin, args) => {
    const r = spawn(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 });
    return { ok: !r.error && r.status === 0, why: r.error ? `${bin}: ${r.error.code || r.error.message}` : `${bin} exited ${r.status}: ${String(r.stderr || '').trim().split('\n')[0]}`, stdout: String(r.stdout || '').trim() };
  };
  let out;
  if (platform === 'darwin') {
    const r = run('sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true']);
    const dev = run('xcode-select', ['-p']);
    out = { available: r.ok, why: r.ok ? 'sandbox-exec ran a trivial command' : r.why, tool: 'sandbox-exec', developerDir: dev.ok && dev.stdout.startsWith('/') ? dev.stdout : null };
  } else if (platform === 'linux') {
    const r = run('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--die-with-parent', '--', '/bin/true']);
    out = { available: r.ok, why: r.ok ? 'bwrap ran a trivial command' : r.why, tool: 'bwrap', developerDir: null };
  } else {
    out = { available: false, why: `no host sandbox for platform ${platform}`, tool: null, developerDir: null };
  }
  probed = { ...out, platform };
  return probed;
}

/** Per lane: the generated profile must itself run a no-op before the real command is trusted to it. */
export function preflightHostSandbox(wrap, { spawn = spawnSync } = {}) {
  const [bin, ...args] = wrap.prefix;
  const r = spawn(bin, [...args, '/bin/sh', '-c', 'exit 0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 });
  if (!r.error && r.status === 0) return { ok: true, why: null };
  const why = r.error ? `${bin}: ${r.error.code || r.error.message}` : `${bin} exited ${r.status} before running the command: ${String(r.stderr || '').trim().split('\n')[0] || 'no stderr'}`;
  return { ok: false, why };
}

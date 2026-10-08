#!/usr/bin/env node
// install-agents.mjs — generate + install the launchd agents for THIS machine.
//
// launchd does not expand `~` or inherit a login shell's PATH in ProgramArguments, so a plist cannot
// be written portably and has to be GENERATED per machine. Not theoretical: the committed plists
// named a node binary and a rollup that do not exist on this checkout, so the freshness deadman had
// never run. A safety net nobody notices is off is worse than none.
//
//   node monitor/install-agents.mjs            # print what would be written (default: dry run)
//   node monitor/install-agents.mjs --write    # write plists to ~/Library/LaunchAgents
//   node monitor/install-agents.mjs --write --load    # also bootstrap them into launchd
//   node monitor/install-agents.mjs --uninstall       # bootout + remove
//
// Recomputed from monitor/projects.json on every run, never hand-edited:
//   com.portll.commitwork-monitor-<area>   nightly, ONE PER DECLARED AREA (areas[]), staggered
//   com.portll.commitwork-liveness         hourly freshness deadman, fanning out over every area
//   com.portll.commitwork-cra-watch        CRA Art. 14 exploited-vuln watch, every 30 minutes
//   com.portll.commitwork-cra-refresh      the CRA/SOC2 evidence pack (cra/refresh.mjs), daily at 06:30
//   com.portll.commitwork-docsite-publish  the docsite from committed main (bin/docsite-publish-scheduled.mjs), daily at 07:00
//   com.portll.commitwork-daily            /daily report for each new complete sweep, every 30 minutes

import { esc } from '../lib/html-escape.mjs';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadRegistry } from './registry.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { dockerConfigDir } from '../lib/docker-config.mjs';
import { flagFor, offMessage } from '../lib/feature-flags.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CW = resolve(HERE, '..');
export const AGENT_DIR = join(homedir(), 'Library', 'LaunchAgents');
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const LOAD = args.includes('--load');
const UNINSTALL = args.includes('--uninstall');
// true only when this file is run directly (`node monitor/install-agents.mjs …`), never on import —
// so a test can import the generation logic below (AGENTS, plist(), NODE, …) to check what would be
// produced on this machine without spawning a process, writing a plist, or touching launchd.
const isMain = isMainModule(import.meta.url);

// Resolve the node binary for this machine (fnm/nvm/brew all differ, and launchd gets a bare PATH).
// process.execPath is correct but may be a VERSION-PINNED path (homebrew's Cellar, fnm's per-version
// dir): a routine upgrade would then leave the agent pointing at a deleted binary and the deadman
// would die silently — precisely the failure this script exists to fix. Prefer a stable symlink that
// resolves to the same interpreter, and fall back to execPath only if none does.
function stableNode() {
  const real = realpathSync(process.execPath);
  for (const cand of ['/opt/homebrew/bin/node', '/usr/local/bin/node', join(homedir(), '.local', 'bin', 'node')]) {
    try { if (existsSync(cand) && realpathSync(cand) === real) return cand; } catch { /* not this one */ }
  }
  return process.execPath;
}
export const NODE = stableNode();

// The launcher bundle that gives the agents a TCC identity. stableNode() keeps launchd off a
// version-pinned path, but that does not carry to privacy prompts: TCC attributes a request to the
// responsible process — for a launchd job, its own program — and files the grant against the binary
// it RESOLVES. So these agents were recorded as identifier_type=Path
// /opt/homebrew/Cellar/node/<version>/bin/node: a System Settings row that can only say "node",
// unreachable by `tccutil reset` (which takes bundle ids), and orphaned by the next `brew upgrade
// node`. Measured 2026-09-09: 826 requests in 24h, every one docker-credential-desktop reading
// Docker.app's container, all of them attributed to a bare "node".
//
// Under the bundle the identity becomes com.portll.commitwork-job. It SPAWNS rather than execs —
// exec would replace the image and hand the identity back to node — so it only works as a real app
// bundle; source is tools/fleet/cwjob.c in the sidecar. When it is absent (a fresh box, or one
// where it has not been built) the agents are generated exactly as before, rather than pointing at
// a program that is not there.
const LAUNCHER = join(homedir(), 'Applications', 'Commitwork Job.app', 'Contents', 'MacOS', 'cwjob');
export const LAUNCH_PREFIX = existsSync(LAUNCHER) ? [LAUNCHER] : [];

// A JDK that homebrew installed KEG-ONLY, if there is one.
//
// macOS ships /usr/bin/java as a stub that exists on PATH and exits 1 with "Unable to locate a Java
// Runtime". Homebrew's openjdk is keg-only — it is never linked into /opt/homebrew/bin — so on a
// box with openjdk installed and no system JDK, `java` resolves to the stub and CodeQL's Java
// extractor indexes nothing. Measured on the clientA fleet, 2026-08-02: sast-codeql-java was
// 0 ran / 30 skipped / 3 noscan, a fleet-wide Java taint VOID, on a machine that HAD a working JDK.
//
// Discovered rather than hardcoded, and existence-checked like every other entry: a box with a
// system JDK, a different prefix, or no Java at all is unaffected, and when nothing is found the
// check reports a blocked void naming `tool:java`, which names what to install instead of looking like a crash.
const JDK_DIRS = ['/opt/homebrew/opt/openjdk/bin', '/usr/local/opt/openjdk/bin']
  .filter((d) => existsSync(join(d, 'java')));
// launchd's default PATH is minimal and the scanners live in the user's toolchain dirs. Seed it
// from the node binary's own dir plus the usual homebrew/user locations, deduped and existing-only.
// The JDK goes BEFORE /usr/bin so a real java wins over the stub there.
//
// ~/go/bin BEFORE the Homebrew prefix: Homebrew's govulncheck builds from a source tarball carrying
// no VCS info, so Go stamps `(devel)` and the binary reports v0.0.0. bin/scanner-preflight.mjs
// refuses that — an unidentifiable build produces an unfalsifiable zero. Both orderings find A
// binary; this one finds the one that can name itself.
//
// USER BIN DIRS FIRST, AHEAD OF dirname(NODE), because on this machine dirname(NODE) IS
// /opt/homebrew/bin and Set-dedup keeps the first occurrence — putting it first silently reversed
// the rule above. Safe because PATH IS NOT HOW THE AGENT FINDS NODE: ProgramArguments[0] is the
// absolute path. This entry is for CHILD processes and the scanners, which is the population that
// needs the stamped Go tool to win.
const PATH_DIRS = [...new Set([
  join(homedir(), 'go', 'bin'), join(homedir(), '.local', 'bin'),
  dirname(NODE), '/opt/homebrew/bin', '/usr/local/bin',
  ...JDK_DIRS,
  '/usr/bin', '/bin', '/usr/sbin', '/sbin',
])].filter((d) => existsSync(d));

const strings = (arr) => arr.map((a) => `    <string>${esc(a)}</string>`).join('\n');

export function plist({ label, argv, schedule, stdout, stderr, env, runAtLoad = false }) {
  // Agent-specific vars (if any) first, PATH always last and always present — matches the order
  // the hand-written cra-watch plist used (CRA_FETCH then PATH), so folding it in here changes
  // nothing an operator diffing the two would notice.
  // CW_REGISTRY_REQUIRE_REAL on EVERY agent, before the per-agent vars so an agent could in
  // principle override it. Every launchd agent is by definition a scheduled caller: nobody is
  // watching its stdout, so the registry's "the fleet is the example" warning would land in a log
  // and change nothing. With this set, loadRegistry() throws instead — the agent fails loudly and
  // visibly rather than sweeping a two-repo demonstration fleet to a successful, empty conclusion.
  // See monitor/registry.mjs REQUIRE_REAL_ENV for why this is declared rather than inferred.
  // DOCKER_CONFIG is DECLARED on every agent rather than left to the environment, because launchd
  // inherits no shell — see lib/docker-config.mjs for why it is not ~/.docker.
  const envDict = Object.entries({ CW_REGISTRY_REQUIRE_REAL: '1', DOCKER_CONFIG: dockerConfigDir(), ...env, PATH: PATH_DIRS.join(':') })
    .map(([k, v]) => `    <key>${esc(k)}</key><string>${esc(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by monitor/install-agents.mjs for this machine — do not hand-edit or commit.
     Regenerate after moving the checkout or changing the node install. -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${strings([...LAUNCH_PREFIX, ...argv])}
  </array>
${schedule}
  <key>EnvironmentVariables</key>
  <dict>
${envDict}
  </dict>
  <key>WorkingDirectory</key><string>${esc(CW)}</string>
  <key>StandardOutPath</key><string>${esc(stdout)}</string>
  <key>StandardErrorPath</key><string>${esc(stderr)}</string>
  <key>RunAtLoad</key><${runAtLoad ? 'true' : 'false'}/>
</dict>
</plist>
`;
}

// The registry is the single source of truth for "every area" — loadRegistry() already validates
// it (wrong types die, unknown keys warn), so a bad projects.json fails this generator loudly
// rather than silently producing a schedule that omits an area.
export const REG = loadRegistry({ quiet: true });
if (!(REG.areas || []).length) {
  throw new Error('install-agents: monitor/projects.json declares no areas[] — nothing to schedule. '
    + 'Declare at least one area (primary:true) before generating agents.');
}
// The primary area's slot is first (preserving the historical 02:30 for the fleet's original area);
// the rest keep their declared order after it. Array#sort is stable (Node/V8, ES2019+), so this
// never reorders ties.
// A PAUSED area gets no schedule at all. The agents below invoke `sweep.mjs all <slug>` — an
// EXPLICIT scope, and sweep.mjs runs a paused area you name, on purpose (a pause is a default, not
// a lock). So filtering here is the whole mechanism: without it the declaration would stop `--all`
// and change nothing about the thing that actually sweeps this box every night.
const PAUSED_SLUGS = new Set(REG.areas.filter((a) => a.paused).map((a) => a.slug));
const AREAS = [...REG.areas].filter((a) => !PAUSED_SLUGS.has(a.slug))
  .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
// Not writing a plist does not remove one already loaded, and a stale agent keeps firing forever
// with nothing left in the registry to explain it. Named so they can be booted out below.
const RETIRED_LABELS = [...PAUSED_SLUGS].flatMap((s) =>
  [`com.portll.commitwork-monitor-${s}`, `com.portll.commitwork-deep-${s}`]);

// Stagger start times so N per-area sweeps never fire in the same minute. Every sweep ends with
// compact-reports.mjs taking the ROOT-WIDE reports lock (monitor/lockfile.mjs's `.reports.lock` —
// shared across every area, not per-area; it guards the compactor plus the cross-area epss.json/
// kev.json writes). Verified by reading monitor/compact-reports.mjs: a contended lock makes THAT
// run skip its compaction rather than wait, so N simultaneous sweeps would mean N-1 of them
// silently drop that night's retention pass. Do not touch lockfile.mjs/compact-reports.mjs for this
// (another pass owns the lock itself) — staggering is the fix available at this layer.
const NIGHTLY_BASE_MINUTES = 2 * 60 + 30; // 02:30 — the historical single-agent schedule
const STAGGER_MINUTES = 15;
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

// CADENCE IS DECLARED ONCE, IN `cadenceMs`, AND DRIVES BOTH THINGS THAT DEPEND ON IT.
// The field already existed for the freshness deadman ("expected sweep interval; the per-area
// staleness threshold"), and the schedule is the other half of the same fact. Reading them from one
// declaration is not tidiness — it removes a whole failure mode: an area swept weekly while a
// deadman expects it nightly reports PERMANENT staleness, a red that is not a finding and that
// nobody can clear, which trains readers to ignore the freshness signal everywhere. A second field
// would have made that drift possible; one field cannot disagree with itself.
//
// Threshold is >= 7 days rather than == a magic number, so an area declaring 10 or 14 days still
// lands on a weekly agent (the closest cadence launchd offers here) instead of falling back to
// nightly, which would be the WRONG direction — scanning a repo far more often than declared is
// what the operator excluded it from the nightly to avoid.
const isWeekly = (a) => typeof a.cadenceMs === 'number' && a.cadenceMs >= WEEKLY_MS;

function nightlySchedule(index) {
  const total = NIGHTLY_BASE_MINUTES + index * STAGGER_MINUTES;
  return `  <key>StartCalendarInterval</key>\n  <dict><key>Hour</key><integer>${Math.floor(total / 60) % 24}</integer><key>Minute</key><integer>${total % 60}</integer></dict>`;
}

// Sunday, and deliberately EARLIER than the nightly base rather than staggered after it: a weekly
// area is weekly because it is big, and the 100-repo benchmark corpus takes hours. Starting it at
// 01:00 gives it a run before the nightly fleet begins at 02:30, so the two do not spend the small
// hours contending for CPU — which is exactly what happened on 2026-08-21, when eleven staggered
// nightlies stacked into one morning and a manual sweep's throughput fell from 2.6 to 30 min/repo.
const WEEKLY_BASE_MINUTES = 60; // 01:00
function weeklySchedule(index) {
  const total = WEEKLY_BASE_MINUTES + index * STAGGER_MINUTES;
  return '  <key>StartCalendarInterval</key>\n'
    + `  <dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>${Math.floor(total / 60) % 24}</integer>`
    + `<key>Minute</key><integer>${total % 60}</integer></dict>`;
}

// ── SECOND-DAY COVERAGE ────────────────────────────────────────────────────────────────────────
// fact: deep lanes need a database or build
// fact: weekly on Saturday, on demand too
// fact: StartInterval stampedes at load, calendar does not
const DEEP_DAYS = [6];                     // Saturday; Sunday is the weekly corpus sweep
// fact: 18:00 ladder closes before the nightly
const DEEP_BASE_MINUTES = 18 * 60;
// fact: deadman is worst gap plus slack
export const DEEP_CADENCE_MS = 8 * 24 * 60 * 60 * 1000;

function deepSchedule(index) {
  const total = DEEP_BASE_MINUTES + index * STAGGER_MINUTES;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return '  <key>StartCalendarInterval</key>\n  <array>\n'
    + DEEP_DAYS.map((d) => `    <dict><key>Weekday</key><integer>${d}</integer><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`).join('\n')
    + '\n  </array>';
}

// A weekly area is excluded: it is weekly BECAUSE it is big, and giving the 100-repo corpus a deep
// pass three times a week would run the heaviest lanes over the heaviest target more often than the
// area is swept at all. Scanning something far more often than its declared cadence is the same
// error the weekly branch above exists to avoid, pointed the other way.
const DEEP_AREAS = AREAS.filter((a) => !isWeekly(a));

const DEEP_AGENTS = DEEP_AREAS.map((a, i) => ({
  label: `com.portll.commitwork-deep-${a.slug}`,
  argv: [NODE, join(CW, 'monitor', 'sweep.mjs'), 'deep', a.slug],
  schedule: deepSchedule(i),
  env: process.env.SOCKET_CLI_ORG_SLUG ? { SOCKET_CLI_ORG_SLUG: process.env.SOCKET_CLI_ORG_SLUG } : undefined,
  stdout: `/tmp/commitwork-deep-${a.slug}.log`, stderr: `/tmp/commitwork-deep-${a.slug}.err`,
}));

export const LIVE_LLM_ENV = 'CW_LIVE_LLM';

/** The deploy settings present in the installing shell, or undefined when there are none. */
export function docsiteDeployEnv(env = process.env) {
  const keys = ['CW_WRANGLER', 'CW_DOCSITE_PROJECT', 'CW_CLOUDFLARE_ZONE_ID'].filter((k) => env[k]);
  return keys.length ? Object.fromEntries(keys.map((k) => [k, env[k]])) : undefined;
}

const SWEEP_AGENTS = AREAS.map((a, i) => ({
  label: `com.portll.commitwork-monitor-${a.slug}`,
  // explicit scope, always — never the bare `all` that silently defaults to the primary area only
  argv: [NODE, join(CW, 'monitor', 'sweep.mjs'), 'all', a.slug],
  // Index the two cadences SEPARATELY, so a weekly area does not consume a nightly stagger slot and
  // leave a 15-minute hole in the nightly ladder.
  schedule: isWeekly(a)
    ? weeklySchedule(AREAS.filter(isWeekly).indexOf(a))
    : nightlySchedule(AREAS.filter((x) => !isWeekly(x)).indexOf(a)),
  // A launchd job inherits almost nothing, so any env a CHECK needs must be named here.
  // SOCKET_CLI_ORG_SLUG is the supply-chain scan's org: `socket scan create` refuses without one
  // ("Org name by default setting, --org, or auto-discovered (missing)") and does NOT read the
  // slug `socket config set defaultOrg` writes — verified in both interactive and --no-interactive
  // modes. Baked from the installing shell because these plists are generated per-machine and
  // never committed. An org SLUG is public; the API TOKEN is not, and deliberately does not appear
  // here — it stays in the keychain and lib/secrets.mjs resolves it per check, so a plist on disk
  // never carries a credential.
  // fact: CW_LIVE_LLM opts the sweep's envelope-witness step in to the real model / it is the only reader, the witness lapses after 7 days, and a replay is one per window fleet-wide (operator ruling 2026-10-04; expiry: never, prev: missing)
  env: { [LIVE_LLM_ENV]: '1', ...(process.env.SOCKET_CLI_ORG_SLUG ? { SOCKET_CLI_ORG_SLUG: process.env.SOCKET_CLI_ORG_SLUG } : {}) },
  stdout: `/tmp/commitwork-monitor-${a.slug}.log`, stderr: `/tmp/commitwork-monitor-${a.slug}.err`,
}));

export const AGENTS = [
  ...SWEEP_AGENTS,
  ...DEEP_AGENTS,
  {
    // The panel itself. It used to be started by hand, which is exactly how remote sign-in broke:
    // CW_OAUTH_LIVE_EXCHANGE lived in whichever shell last launched it, so a reboot — or any
    // restart from a different terminal — silently dropped the Google button from the published
    // login page while the store still said external sign-in was allowed. An operator saw a ticked
    // box and no way in. The flag belongs to the SERVICE, not to a shell that happened to start it.
    //
    // Live exchange is not a lax setting: findByEmail() (admin/auth.mjs) still gates SSO to an
    // account already in the store, so completing a Google flow authenticates an EXISTING operator
    // rather than creating one. What the flag turns off is the scaffold that refuses to mint a
    // session at all — without it the callback 503s by design, which is honest but unusable.
    //
    // KeepAlive, not a schedule: this is the one agent here that is a service rather than a job.
    // A panel that dies at 3am and stays dead is a monitoring system nobody can read.
    //
    // CW_PANEL_SUPERVISED TELLS THE PANEL WHO OWNS ITS RELAUNCH. admin/serve.mjs branches on it:
    // supervised, a restart request is served by EXITING, because KeepAlive brings the successor
    // back from the code on disk; unsupervised, the panel must spawn its own successor. Its comment
    // reads "CW_PANEL_SUPERVISED, set by the LaunchAgent plist" — and nothing set it. So under
    // launchd the panel took the UNSUPERVISED branch: it spawned a successor while KeepAlive
    // relaunched one too, and the two raced for :7878/:7879 into EADDRINUSE. The mechanism written
    // to prevent exactly that race was fed by nothing, which is the same shape as the outage this
    // repair follows — a service that is supervised in fact and reports itself unsupervised.
    label: 'com.portll.commitwork-panel',
    argv: [NODE, join(CW, 'admin', 'serve.mjs')],
    schedule: '  <key>KeepAlive</key><true/>',
    // CW_CLOUDFLARE_ZONE_ID: not a secret (a zone identifier, not a credential — the token that
    // actually authorises the purge call stays in the macOS Keychain, resolved by the process
    // itself via lib/secrets.mjs, never written here). Read from THIS process's env at generation
    // time, same pattern as SOCKET_CLI_ORG_SLUG above — never hardcoded into tracked source.
    env: {
      CW_OAUTH_LIVE_EXCHANGE: '1', CW_PANEL_SUPERVISED: '1',
      // fact: deploy --verify reads the attested off-box evidence here
      CW_OFFBOX_EVIDENCE: join(homedir(), '.commitwork', 'offbox', 'probe-results.json'),
      ...(process.env.CW_CLOUDFLARE_ZONE_ID ? { CW_CLOUDFLARE_ZONE_ID: process.env.CW_CLOUDFLARE_ZONE_ID } : {}),
    },
    runAtLoad: true,
    stdout: '/tmp/commitwork-panel.log', stderr: '/tmp/commitwork-panel.err',
  },
  {
    label: 'com.portll.commitwork-liveness',
    // no rollup argument ⇒ fan out over EVERY area, so a quiet area cannot rot unwatched
    argv: [NODE, join(CW, 'monitor', 'liveness.mjs')],
    schedule: '  <key>StartInterval</key><integer>3600</integer>',
    // fact: the deadman reports on load / without it the first report after a boot or reload waits a full interval (expiry: never, prev: broken)
    runAtLoad: true,
    stdout: '/tmp/commitwork-liveness.log', stderr: '/tmp/commitwork-liveness.err',
  },
  {
    label: 'com.portll.commitwork-daily',
    // fact: one /daily report per new complete sweep of each area in monitor/private/daily.json; a run with nothing new exits at once
    argv: [NODE, join(CW, 'bin', 'daily-run.mjs'), '--all'],
    schedule: '  <key>StartInterval</key><integer>1800</integer>',
    stdout: '/tmp/commitwork-daily.log', stderr: '/tmp/commitwork-daily.err',
  },
  {
    label: 'com.portll.commitwork-offbox-fetch',
    // fact: pulls the attested off-box probe result six-hourly
    argv: [NODE, join(CW, 'bin', 'offbox-fetch.mjs')],
    schedule: '  <key>StartInterval</key><integer>21600</integer>',
    // commitwork-remote is private, and GitHub answers 404 to attestation lookups on user-owned
    // private repos. OPTIONAL accepts only "unavailable" (run provenance still checked); a present
    // attestation that fails verification still refuses. Set in the installed plist on 2026-09-19
    // but not here, and the next regeneration dropped it, freezing the evidence for a week.
    env: { CW_OFFBOX_EVIDENCE: join(homedir(), '.commitwork', 'offbox', 'probe-results.json'), CW_OFFBOX_ATTEST_OPTIONAL: '1' },
    stdout: '/tmp/commitwork-offbox-fetch.log', stderr: '/tmp/commitwork-offbox-fetch.err',
  },
  {
    label: 'com.portll.commitwork-offbox-watch',
    // The LOCAL half of the off-box watcher, on its OWN clock rather than the sweep's. The check
    // exists because the off-box half stopped running; hanging it off a runner that can also stop
    // would be the same trap one layer in. Measured 2026-09-24: every commitwork-remote workflow
    // had failed at startup since 2026-09-19, and the newest sweep artefact was itself a day old.
    // --page is a declaration, not a promise: with no CW_OFFBOX_WEBHOOK_URL declared it reports
    // no-url rather than paging, which is visible in the journal row it always writes.
    argv: [NODE, join(CW, 'bin', 'offbox-watch-check.mjs'), '--runs', '--page'],
    schedule: '  <key>StartInterval</key><integer>3600</integer>',
    stdout: '/tmp/commitwork-offbox-watch.log', stderr: '/tmp/commitwork-offbox-watch.err',
  },
  {
    label: 'com.portll.commitwork-cra-watch',
    // Folded in from the now-deleted cra/com.portll.commitwork-cra-watch.plist — same command,
    // schedule and CRA_FETCH env; only the paths and log destination now resolve correctly per
    // machine. Logs go to /tmp like the sibling agents: reports/cra/ is gitignored and launchd does
    // not create missing StandardOutPath directories, so the committed plist's log path there could
    // never actually have been opened, even with correct machine paths.
    argv: [NODE, join(CW, 'cra', 'watch.mjs'), 'watch'],
    schedule: '  <key>StartInterval</key><integer>1800</integer>',
    env: { CRA_FETCH: '1' },
    runAtLoad: true, // preserved from the folded-in plist — worth an immediate status on a 30-min clock
    stdout: '/tmp/commitwork-cra-watch.log', stderr: '/tmp/commitwork-cra-watch.err',
  },
  {
    // The evidence pack, rebuilt daily so it is current without a hand run. 06:30 follows the nightly
    // sweep ladder from 02:30. No RunAtLoad: a reload must not start the whole pipeline.
    // cra/evidence-status.mjs reports the pack stale when this stops firing.
    label: 'com.portll.commitwork-cra-refresh',
    argv: [NODE, join(CW, 'cra', 'refresh.mjs')],
    schedule: '  <key>StartCalendarInterval</key>\n  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>30</integer></dict>',
    stdout: '/tmp/commitwork-cra-refresh.log', stderr: '/tmp/commitwork-cra-refresh.err',
  },
  {
    // Publishes the docsite from main's committed content, so a merged document goes live without a
    // hand run. The script skips a ref already live and refuses on any failed check; its ledger is
    // reports/docsite-publish/attempts.jsonl (--status). 07:00 follows the evidence refresh. No
    // RunAtLoad: loading the job must not deploy. The deploy's wrangler, Pages project and purge
    // zone are taken from the installing shell, because launchd starts the job with none of them.
    label: 'com.portll.commitwork-docsite-publish',
    argv: [NODE, join(CW, 'bin', 'docsite-publish-scheduled.mjs')],
    schedule: '  <key>StartCalendarInterval</key>\n  <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>',
    env: docsiteDeployEnv(),
    stdout: '/tmp/commitwork-docsite-publish.log', stderr: '/tmp/commitwork-docsite-publish.err',
  },
  {
    // The SiteMap tab reads sitemap/data/<slug>.sitemap.json from disk per request, so freshness
    // is entirely this job's doing — regeneration updates the tab with no server restart, and NO
    // schedule meant the tab served whatever three slugs someone once generated by hand while
    // every other project fell back to the labelled fixture (the "sitemap is still not wired up"
    // complaint, 2026-08-21). Daily, not hourly: the harvest is a ctags pass over every checkout
    // in the fleet, and it measures structure, which moves at commit cadence. 05:00 sits clear of
    // the early sweep stagger without waiting for the whole train; the v2 overlays read the latest
    // scan artifacts available, and a day-old overlay is a displayed date, not a wrong claim.
    label: 'com.portll.commitwork-sitemap-data',
    argv: [NODE, join(CW, 'monitor', 'sitemap-data.mjs')],
    schedule: '  <key>StartCalendarInterval</key>\n  <dict><key>Hour</key><integer>5</integer><key>Minute</key><integer>0</integer></dict>',
    stdout: '/tmp/commitwork-sitemap-data.log', stderr: '/tmp/commitwork-sitemap-data.err',
  },
  {
    // The one Docker component with no retention policy. Build cache is GC-capped at 20 GB in
    // ~/.docker/daemon.json and holds to it; unused images had no bound at all and reached 140
    // images / 98 GB (70 GB unreferenced) by 2026-09-24, which took the host volume to 3% free and
    // turned every containerd blob read into an EIO that Docker reported as a corrupt blob.
    // Weekly and 30-day, because the failure took five days to build and an image worth keeping is
    // one that got used inside a month. Prunes images only — never volumes or containers.
    label: 'com.portll.commitwork-docker-gc',
    argv: [NODE, join(CW, 'bin', 'docker-gc.mjs')],
    schedule: '  <key>StartCalendarInterval</key>\n  <dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>4</integer><key>Minute</key><integer>30</integer></dict>',
    stdout: '/tmp/commitwork-docker-gc.log', stderr: '/tmp/commitwork-docker-gc.err',
  },
];

// A job in an experimental group (manifests/feature-charter.json) whose flag is off is not
// installed, and one already installed is listed for retirement. Pure apart from `isInstalled`,
// so a test can ask with a temp agent dir and never reach launchd.
export function agentPlan({ agents = AGENTS, agentDir = AGENT_DIR, isInstalled = (label) => existsSync(join(agentDir, `${label}.plist`)) } = {}) {
  const install = [];
  const retire = [];
  for (const a of agents) {
    const f = flagFor('job', a.label);
    if (f && !f.on) {
      if (isInstalled(a.label)) retire.push({ label: a.label, flag: f.id, why: offMessage(f) });
      continue;
    }
    install.push({ agent: a, flag: f ? f.id : null });
  }
  return { install, retire };
}

// Everything below only runs when this file is executed directly (see `isMain` above) — importing
// it (as the tests do, to check what would be generated) must never touch launchd, the filesystem
// outside a read, or process.exit.
if (isMain) {
  if (platform() !== 'darwin') {
    console.error('install-agents: launchd is macOS-only; on Linux use systemd timers or cron with the same two commands.');
    process.exit(2);
  }

  // Returns { ok, err } — never a bare boolean. `catch { return false }` discarded launchd's own
  // message, so "load FAILED" was the entire diagnosis available for a service that had just been
  // stopped. The message is the difference between a five-minute fix and a five-hour outage.
  const launchctl = (...a) => {
    try { execFileSync('launchctl', a, { stdio: 'pipe' }); return { ok: true, err: '' }; }
    catch (e) {
      const err = [e.stderr, e.stdout].map((b) => (b ? String(b) : '')).join(' ').trim() || e.message || 'unknown launchctl failure';
      return { ok: false, err: err.split('\n')[0].slice(0, 200) };
    }
  };
  const uid = process.getuid();
  const isLoaded = (label) => launchctl('print', `gui/${uid}/${label}`).ok;

  // ── RESTORE OR REFUSE ──────────────────────────────────────────────────────────────────────────
  // `bootout` always succeeded and `bootstrap` was allowed to fail, which left the tool having
  // STOPPED a service and not restarted it. That is how commitwork.online served 502 for five and a
  // half hours on 2026-08-22: the panel — the only long-lived job here, and so the only one whose
  // teardown is slow enough to lose the race — was booted out and never came back, and the failure
  // was one line on the stdout of a run nobody kept.
  //
  // Reproduced deliberately while writing this: bootout rc=0, then `Bootstrap failed: 5:
  // Input/output error`, job gone, panel down. The immediate retry succeeded. So the race is real,
  // it is transient, and a single attempt is not enough.
  const reload = (label, target) => {
    const wasLoaded = isLoaded(label);
    launchctl('bootout', `gui/${uid}/${label}`);   // "not loaded" is not an error here
    let last = '';
    for (let attempt = 1; attempt <= 5; attempt++) {
      const r = launchctl('bootstrap', `gui/${uid}`, target);
      if (r.ok && isLoaded(label)) return { ok: true, attempts: attempt };
      last = r.err || 'bootstrap reported success but the job is not loaded';
      // launchd needs a moment to finish tearing the old job down; spin briefly rather than sleep.
      const until = Date.now() + 400 * attempt;
      while (Date.now() < until) { /* deliberate: no async in this script */ }
    }
    return { ok: false, attempts: 5, err: last, wasLoaded };
  };

  if (UNINSTALL) {
    for (const a of AGENTS) {
      const target = join(AGENT_DIR, `${a.label}.plist`);
      launchctl('bootout', `gui/${uid}/${a.label}`);
      if (existsSync(target)) { unlinkSync(target); console.log(`removed ${target}`); }
      else console.log(`not installed: ${target}`);
    }
    process.exit(0);
  }

  // Retire a paused area's agents before writing the rest, so the box never holds both states.
  for (const label of RETIRED_LABELS) {
    const target = join(AGENT_DIR, `${label}.plist`);
    const loaded = isLoaded(label);
    if (!loaded && !existsSync(target)) continue;
    if (!WRITE) { console.log(`--- would RETIRE ${label} (area paused)`); continue; }
    if (loaded) launchctl('bootout', `gui/${uid}/${label}`);
    if (existsSync(target)) unlinkSync(target);
    console.log(`retired ${label} — its area is paused`);
  }

  const plan = agentPlan({ isInstalled: (label) => existsSync(join(AGENT_DIR, `${label}.plist`)) || isLoaded(label) });
  for (const r of plan.retire) {
    const target = join(AGENT_DIR, `${r.label}.plist`);
    if (!WRITE) { console.log(`--- would RETIRE ${r.label} (${r.why})`); continue; }
    if (isLoaded(r.label)) launchctl('bootout', `gui/${uid}/${r.label}`);
    if (existsSync(target)) unlinkSync(target);
    console.log(`retired ${r.label} — experimental flag ${r.flag} is off`);
  }
  const INSTALL = plan.install.map((p) => p.agent);

  const failed = [];
  for (const { agent: a, flag } of plan.install) {
    const body = plist(a);
    const target = join(AGENT_DIR, `${a.label}.plist`);
    if (!WRITE) {
      console.log(`--- would write ${target}${flag ? ` [experimental: ${flag}]` : ''}\n${body}`);
      continue;
    }
    mkdirSync(AGENT_DIR, { recursive: true });
    writeFileSync(target, body);
    console.log(`wrote ${target}`);
    if (LOAD) {
      const r = reload(a.label, target);
      if (r.ok) console.log(`  loaded${r.attempts > 1 ? ` (after ${r.attempts} attempts)` : ''}`);
      else {
        failed.push({ label: a.label, target, err: r.err, wasLoaded: r.wasLoaded });
        console.error(`  LOAD FAILED after ${r.attempts} attempts: ${r.err}`);
        if (r.wasLoaded) console.error(`  *** ${a.label} WAS RUNNING AND IS NOW STOPPED ***`);
      }
    }
  }

  // ── VERIFY AFTER ACTING ────────────────────────────────────────────────────────────────────────
  // Reconcile the declared set against what launchd actually holds. Without this, "one job did not
  // load" is a line of scrollback in a run nobody kept — which is precisely how a stopped panel went
  // unnoticed. This also catches jobs that were never loaded by this run at all: the plists were
  // rewritten on 2026-08-22 WITHOUT --load, so the panel's file was current while its job was
  // absent, and nothing said so.
  if (WRITE) {
    const missing = INSTALL.filter((a) => !isLoaded(a.label));
    if (missing.length) {
      console.error(`\n${missing.length} of ${INSTALL.length} agent(s) are NOT loaded:`);
      for (const a of missing) console.error(`  ${a.label}  —  launchctl bootstrap gui/${uid} ${join(AGENT_DIR, `${a.label}.plist`)}`);
      console.error(LOAD
        ? 'A declared agent that is not loaded does nothing, and says nothing about doing nothing.'
        : 'Plists were written but not loaded (no --load). A current plist with no loaded job is the\n'
          + 'shape that took the panel down: the file looks right and the service is absent.');
      process.exit(1);
    }
    console.log(`\nall ${INSTALL.length} agent(s) loaded`);
  }
  if (!WRITE) console.log('\n(dry run — pass --write to install, --write --load to also start them)');
}

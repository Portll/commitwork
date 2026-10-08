<!-- verified-against: 2026-10-04 -->
# SPEC: scan a path from the panel, operator port only

> **Status: built 2026-09-28; the operator's seven rulings of 2026-09-29 are applied** (see
> [Operator rulings](#operator-rulings-2026-09-29)). **2026-10-04: a scan writes the remediation
> brief, the section shows it, and the operator port can scan every repository on this machine**
> (R12, R13). Operator ruling 2026-09-28: "Bring it back as
> a local-only feature." Route `admin/routes/scan-path.mjs`, client section in
> `admin/static/perf-console.js` (the Scanners view, `/perf/`), job kind `scan-path` in
> `admin/lib/jobs.mjs`, stop and job visibility in `admin/routes/jobs.mjs`, container ownership in
> `monitor/containers.mjs`. Tests: `admin/test/scan-path-route.test.mjs`,
> `admin/test/scan-path-panel.test.mjs`, `admin/test/job-visibility.test.mjs`,
> `admin/test/job-argv.test.mjs`, `bin/test/brief.test.mjs`, `monitor/test/container-owner.test.mjs`.

**History.** a commit (2026-09-02) added `POST /api/scan-path` in a `tools.mjs` module under
`admin/routes/` (operator port only) and a scan-a-path form in the "Scanner tools" card of
`admin/config.html`.
a commit and a commit (2026-09-06) removed the card and deleted the route as part of an
unattributed staged set. That removal was never an operator decision. The job kind's argv survived
in `jobArgv('scan-path', …)` with no route calling it.

**Scope.** Scanning only. Installing tools is not part of this feature: per-tool install is
`POST /api/scanners/action` (`admin/routes/scanners.mjs`), and the `install-tools` job kind in
`admin/lib/jobs.mjs` is left as it is, with no route.

## R: Requirements

The operator port defaults to 7879 (`CW_ADMIN_LOCAL_PORT`, else `CW_ADMIN_PORT` + 1); the published
port defaults to 7878 and is the one the tunnel serves.

**R1. The operator port starts a scan.**
Given a signed-in operator on `http://127.0.0.1:7879`, `<home>/Repositories/acme` is a
directory and the output directory exists (R8),
when the Scanners view posts `{"path": "<home>/Repositories/acme"}` to `POST /api/scan-path`
with the `x-cw-csrf` header,
then the panel answers `202 {ok: true, started: true, path: "<home>/Repositories/acme", job}`
and spawns `['node', '<checkout>/bin/commitwork.mjs', 'brief', '--root', '<home>/Repositories/acme',
'--out', '<output dir>/<YYYY-MM-DDTHH-MM-SS>']` as the `scan-path` job, argv only, with no shell.
`commitwork brief` runs the same scan as `commitwork scan`, then writes `brief.json`, `brief.md` and
`brief.html` into the run directory (R13).

**R2. The published port has no control and refuses.**
Given a signed-in session on the published port,
when the Scanners view loads,
then `GET /api/scan-path` answers `200 {ok: true, canAct: false, job: null}` and the page holds no
scan-a-path section, input or button. Nothing is rendered disabled.
When anything posts to `POST /api/scan-path` there,
then it answers `403` with an error naming `http://127.0.0.1:7879`, and nothing is spawned.
When anything posts to `POST /api/sweep/stop?kind=scan-path` there, then it answers `403 {stopped:
false, reason: "a scan-path run is stopped only from the operator port"}` and nothing is signalled.

**R3. Signed out is 401.**
Given no session on the published port, when `GET` or `POST /api/scan-path` arrives, then `401
{error: "authentication required"}` and nothing is spawned. serve.mjs's login gate answers first on
both ports; the route checks again.

**R4. The path is validated before anything spawns.**
Given a `POST` on the operator port, each of these answers `400` with the reason and spawns nothing:

| Body | Error begins |
|---|---|
| `{}`, `{"path": ""}`, `{"path": ["/tmp"]}`, no body | `body must be {"path": "<absolute path to a directory>"}` |
| `{"path": "repos/acme"}` | `not an absolute path: repos/acme` |
| `{"path": "<home>/nope"}` | `no such path: <home>/nope` |
| `{"path": "<home>/Repositories/acme/package.json"}` | `not a directory:` |
| `{"path": "/"}` | `refusing to scan /: the filesystem root` |
| `{"path": "/etc"}` | `refusing to scan /etc: /etc is host-equivalent` |
| `{"path": "/private/etc"}` | `refusing to scan /private/etc: it is inside the system directory /private` |
| `{"path": "/usr/local"}` | `refusing to scan /usr/local: it is inside the system directory /usr` |
| `{"path": "/usr"}` | `refusing to scan /usr: it is the system directory /usr` |
| `{"path": "/System/Library/CoreServices"}` | `refusing to scan /System/Library/CoreServices: it is inside the system directory /System` |
| `{"path": "<home>/.ssh/keys"}` | `refusing to scan <home>/.ssh/keys: it contains credential material (.ssh)` |
| `{"path": "<home>"}` | `refusing to scan <home>: it overlaps the credential store <home>/.ssh` |
| `{"path": "<parent of home>"}` | `refusing to scan <parent of home>: it overlaps the credential store <home>/.ssh` |
| `{"path": "<checkout>"}`, `{"path": "<checkout>/admin"}` | `refusing to scan <checkout>: it is the commitwork checkout the panel runs from` |
| `{"path": "<a directory containing the checkout>"}` | `refusing to scan <dir>: it contains the commitwork checkout <checkout>` |
| `{"path": "<the destination root (R8), inside it, or containing it>"}` | `refusing to scan <path>: it overlaps <destination root>, where scan output goes` |

The typed spelling is checked against the system directories and the sandbox list first, before
anything on disk is read; the realpath is then checked again. A link is resolved first:
`<home>/acme-link` pointing at `<home>/Repositories/acme` spawns the scan with
`--root <home>/Repositories/acme`, a link pointing into `~/.ssh` is refused as `~/.ssh`, and a
link to `/etc` is refused as `/private/etc` on macOS.

Temporary directories are scannable: `/tmp/clone`, `/private/tmp/clone`, `/var/tmp/clone` and the
macOS per-user `/var/folders/…` (realpath `/private/var/folders/…`) start a scan, and so does
anything under `/Volumes/`.

**R5. One at a time.**
Given a `scan-path` job is running, when another `POST` arrives, then `409 {ok: false, started:
false, error: "a scan-path job is already running; one at a time", job}`.

**R6. Progress is visible where the scan was started.**
Given a job has started, the Scanners view shows its state (`running`, `complete`, `stopped` or
`exited <code or signal>`), its label `scan: <realpath>` and its log. Lines stream from
`/api/status/events?kind=scan-path&from=<seq>`; when EventSource is unavailable or closes, the view
polls `GET /api/scan-path` every 1200 ms. The whole run is also in
`<output dir>/scan-path-latest.log`, truncated at the next start (`CW_JOB_LOG_DIR`, when set, holds
it instead).

**R7. Shell metacharacters are data.**
Given a directory named ``we ird;$(touch PWNED)&&|'"*`touch PWNED2`>x``, when it is scanned, then
argv carries its realpath as one element, the stand-in CLI receives
`["brief", "--root", "<that path>", "--out", "<output dir>/<stamp>"]`, and no file `PWNED`, `PWNED2`
or `x` appears.

**R8. Scan output is private and goes outside the checkout.**
The output directory is `CW_SCAN_PATH_OUT` when set; otherwise `<sidecar>/reports/scan-path`, where
the sidecar is `CW_SIDECAR` or `commitwork-sidecar` next to the checkout. Both variables are read at
call time. The destination root, the directory that must already exist, is `CW_SCAN_PATH_OUT`
itself or the sidecar; `reports/scan-path` under the sidecar is created on the first run. A public
install has no sidecar, and `CW_SCAN_PATH_OUT` is how it names a private directory.
Given the destination root is not an absolute path, is not an existing directory, or resolves
inside the checkout, when a scan is posted, then the panel answers
`503 {ok: false, started: false, error}` and spawns nothing. The error reads
`refusing to start a scan: <why>. Scan output is private and is never written into the checkout's
reports/; set CW_SCAN_PATH_OUT to an existing private directory`, followed, when the variable is
unset, by `or create the sidecar at <sidecar> (CW_SIDECAR)`. There is no fallback to `reports/`:
`trigger()` refuses the same way for any caller, and `jobArgv('scan-path')` returns no argv without
an `--out`.

**R9. A running scan can be stopped from the operator port.**
Given a `scan-path` job is running, when the Scanners view's stop button posts
`POST /api/sweep/stop?kind=scan-path` on the operator port, then it answers `200 {stopped: true}`,
the scan's process group gets SIGTERM (SIGKILL after 5 s), and once the scan process has exited the
containers whose owner label names it are removed. The log then reads
`[serve] removed <n> container(s) the scan started: <names>`, or says why none could be matched,
and the state reads `stopped`. A terminal scan's containers, a recycled pid's and unlabelled
`cw-*` containers are left alone. Anything left is the next sweep's to reap once its owner is gone
(R10).

**R10. A sweep started during a scan leaves the scan's containers alone.**
Every lane `bin/commitwork.mjs` runs carries `CW_CONTAINER_OWNER=<pid>.<start ms>` for its own
process, and `bin/sandbox.mjs` labels each container with `cw.owner=<that value>`
(`bin/egress-proxy.sh` labels the proxy it starts). A sweep's preamble (`reapOrphans()`) spares a
container outside a live sweep slice when its owner is the same live process: `kill(pid, 0)`
succeeds and `ps` gives a start within one second of the label's. It reaps one whose owner is dead
(ESRCH) or recycled (another start), or that carries no label. An owner it cannot check (no `ps`, a
malformed label) is left alone and logged as undetermined. This holds for every CLI run, from the
panel or a terminal.

**R11. Job status is scoped to the viewer's selection.**
`GET /api/status` and `GET /api/status/events` take the client's selection as `project` (label or
slug). A fleet run (no project, or an STPA or install-tools run, whose subject is not an area) is
shown only in the fleet view: no project, which the panel sends on every fleet page. Any other run
is shown only when the selection names its area, or the repo a narrowed run was limited to.
A run the selection may not see is `null` in `/api/status`, absent from its `running` map, and a
`status: null` frame on the stream, which then delivers none of its lines, lane news or status.
A `scan-path` run is shown in every view. Off the operator port its path and output directory are
replaced by `[redacted: shown on the operator port]` in the label, the lines and the status
fields. The panel re-reads the status and reopens its streams when the picker or the page scope
changes, and the BOLA console asks for the area it started.

**R12. The operator port can scan every repository on this machine.**
Given the operator port and an output directory (R8), when the Scanners view's **scan this machine**
button is pressed twice within six seconds (the first press arms it), it posts `{"pc": true}` and
the panel answers `202 {ok: true, started: true, pc: true, job}` and spawns `['node',
'<checkout>/bin/commitwork.mjs', 'brief', '--pc', '--out', '<output dir>/<stamp>']`. Only the
boolean `true` selects this; any other `pc` is a path request and is refused as one. The request
does no discovery: the CLI walks the home directory (`discoverPcRepos()` in
`bin/lib/scan-target.mjs`), scans each repository on its own, sets aside a directory holding 100 or
more repositories (`CW_PC_COLLECTION_MIN`), and excludes, with the reason in the log, a repository
that overlaps a credential store, a commitwork checkout or its main worktree, the sidecar, the
`--out` directory or a system directory. The sidecar is excluded even though the panel passes
`--out`. The published port gets `403`. Off the operator port the home directory is redacted from
the job's label, lines and status, as a path is (R11).

**R13. The brief of a finished scan is shown where the scan was started.**
When a `scan-path` job ends `complete`, and whenever the section loads, the Scanners view reads
`GET /api/scan-path/briefs` and shows the newest brief: dependency fixes with KEV advisories first,
the other lanes with open findings, and the lanes that did not measure, ten rows of each, with a
link to the full brief and a picker for the twenty most recent. The list holds every run directory
under the output directory that has a `brief.json`, newest file first, so a brief the terminal
wrote with `commitwork brief` is listed too. A `brief.json` that cannot be read or parsed is listed
with its error, never dropped; an absent output directory is an empty list; any other read failure
is a `500`. `GET /api/scan-path/brief?id=<run>` serves the JSON, and `&format=html` the
self-contained page under `default-src 'none'` with its own inline scripts allowed by hash. `id`
must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (`400` otherwise), and a run without a brief is `404`.
Both routes are operator-only: `401` signed out, `403` on the published port, because a brief names
local paths and the findings of private directories.

## E: Entities

- **Scan request**: JSON `{path: string}`. Nothing else in the body is read.
- **Resolved path**: `realpathSync(path)`. The only request-derived value that reaches argv.
- **The `scan-path` job**: one slot in `admin/lib/jobs.mjs`. `{running, startedAt, finishedAt,
  exitCode, signal, phase, seq, lines (last 400), label: "scan: <realpath>", project: null, repo:
  null, fleet: false}`, plus two fields that never reach a status payload: `secrets` (the path and
  the output directory, for redaction) and, once stopped, `owner` (`{pid, startSec}`, read with
  `ps` before signalling). `project` is null because a scanned path belongs to no area.
- **Owner label**: `cw.owner=<pid>.<start epoch ms>` on every container a CLI run starts. The start
  comes from the process's own clock (`Date.now() - process.uptime()`); liveness checks it against
  `ps -o lstart=` with one second of tolerance, the rule `bin/lib/single-flight.mjs` measured.
- **Credential stores**: built from `bin/lib/sandbox.mjs`'s exports under the real home
  (`os.homedir()`, so `HOME` at call time): `~/<s>` for each `FORBIDDEN_SEGMENTS` entry (`.ssh`,
  `.aws`, `.gnupg`, `.docker`, `.kube`, `Keychains`, `.netrc`), `~/Library/Keychains`,
  `/Library/Keychains`, and `~/<s>` for each `DECLARABLE_CREDENTIALS` entry (`.config/gh`,
  `.config/gcloud`, `.azure`, `.git-credentials`, `.npmrc`, `.pypirc`, `.cargo/credentials`,
  `.cargo/credentials.toml`), each also at its own realpath when it is a link.
- **System directories**: `SYSTEM_PATHS` in `admin/routes/scan-path.mjs`, one list for both
  platforms. Roots: `/System`, `/Library`, `/usr`, `/bin`, `/sbin`, `/etc`, `/var`, `/private`,
  `/dev`, `/cores`, `/opt`, `/Applications`, `/proc`, `/sys`, `/boot`, `/lib`, `/lib64`, `/run`,
  `/root`, `/snap`, `/srv`. Temp exceptions: `/tmp`, `/private/tmp`, `/var/tmp`, `/private/var/tmp`,
  `/var/folders`, `/private/var/folders`.
- **Checkout**: the realpath of the directory the panel runs from.
- **Scan output**: `<output dir>/<YYYY-MM-DDTHH-MM-SS>/` (R8), with `index.md` and a `summary.md`
  per repository. The log's last lines name the index.

## A: Approach

Reuse the pieces that survived. The route validates the path and the destination root and calls
`ctx.trigger('scan-path', null, {path, label})`, so the scan shares the job runner's slot, argv
builder, SSE fan-out and per-kind post-mortem log. `trigger()` resolves the output directory itself
and stamps the run's `--out`. The client adds one section to the Scanners view and reads progress
from the existing job feed. The gate is the one `admin/routes/scanners.mjs` uses: a request on the
operator port is the operator; elsewhere a session grants reading only.

## S: Structure

| File | Change |
|---|---|
| `admin/routes/scan-path.mjs` | `GET` and `POST /api/scan-path`, `GET /api/scan-path/briefs` and `/api/scan-path/brief`; exports `listBriefs()`, and re-exports `resolveScanPath()`, `SYSTEM_PATHS` and `systemRoot()` from `bin/lib/scan-target.mjs` |
| `bin/lib/scan-target.mjs` | the path guards, `scanOutDir()` and `discoverPcRepos()`, shared with `commitwork brief` |
| `bin/lib/brief.mjs`, `bin/commitwork.mjs` | `buildBrief()` and its renderers; `cmdBrief()` scans, then writes the brief |
| `admin/serve.mjs` | one import and one `MODULAR_ROUTES` entry (2026-09-28); nothing since |
| `admin/lib/jobs.mjs` | `trigger()` resolves no project for `scan-path`, and resolves its output with `scanOutDir()`; `jobScope()`, `jobVisible()`, `jobStatusFor()`, `redactorFor()`; `stopJob()` records the owner and the exit removes its containers |
| `admin/routes/jobs.mjs` | `scan-path` in `STOPPABLE`, operator port only; `/api/status` and `/api/status/events` scoped |
| `admin/static/perf-console.js` | the section: `pcScanPathHtml()` renders it, `pcScanPathMount()` creates it only when `canAct` is true, `pcScanPathStop()` stops a run, `pcScanPathArmPc()` arms the whole-machine scan, `pcScanPathBriefs()` and `pcBriefHtml()` show the brief |
| `admin/static/panel-core.js`, `panel-posture.js`, `panel-boot.js`, `panel-router.js`, `bola.js` | `jobSel()`/`jobQ()` send the selection; `attachJobs()`/`rescopeJobs()` re-attach on a change |
| `monitor/containers.mjs` | owner tokens, `ownerState()`, `killOwned()`; `reapOrphans()` spares live owners |
| `bin/commitwork.mjs`, `bin/sandbox.mjs`, `bin/lib/sandbox.mjs`, `bin/egress-proxy.sh` | the owner reaches every lane and becomes a container label |
| `monitor/sweep.mjs` | the reap logs spared and undetermined containers |
| `admin/test/scan-path-route.test.mjs`, `admin/test/scan-path-panel.test.mjs`, `admin/test/job-visibility.test.mjs`, `monitor/test/container-owner.test.mjs` | the tests |
| `admin/test/route-inventory.test.mjs` | floors 145 + 44 = 189 raised to 147 + 44 = 191 (2026-09-28) |

`admin/panel.html`, `admin/menus/*` and the generated `admin/index.html` are unchanged: the
section is created by script, so the served markup carries no control to hide.

## O: Operations

| Method | Path | Caller | Answers |
|---|---|---|---|
| `GET` | `/api/scan-path` | a session, or the operator port | `200 {ok, canAct, job}` (`job` only when `canAct`), `401` |
| `POST` | `/api/scan-path` | the operator port | `202 {ok, started, path, job}`, `400`, `401`, `403`, `409`, `503` |
| `POST` | `/api/sweep/stop?kind=scan-path` | the operator port | `200 {stopped, signalled, kind}`, `403` off the operator port |
| `GET` | `/api/scan-path/briefs` | the operator port | `200 {ok, briefs, total}`, `401`, `403`, `500`, `503` |
| `GET` | `/api/scan-path/brief?id=<run>[&format=html]` | the operator port | the brief as JSON or HTML, `400`, `401`, `403`, `404`, `503` |
| `GET` | `/api/status?project=<selection>` | a session, or the operator port | the jobs that selection may see (R11) |

- **Live tail**: `GET /api/status/events?kind=scan-path&from=<seq>`, the existing SSE route, scoped
  and redacted as R11 says.
- **Post-mortem**: `<output dir>/scan-path-latest.log`.
- **Terminal equivalent**: `node bin/commitwork.mjs brief <path>` (or `--pc`), which writes to
  `<output dir>/brief-<stamp>` unless `--out` names a directory.
- **Exit codes**: `commitwork brief` exits 0 when it finishes, whatever it found, so `complete` means
  the scan ran, not that the tree is clean. It exits 2 when discovery finds no git repository under
  the path (a git worktree's `.git` is a file and is not counted by `lib/repo-walk.mjs`), which the
  view shows as `exited 2` with the CLI's message in the log.

## N: Norms

- argv is an array, never a shell string, and the resolved path is its only request-derived element.
- Fail closed: a path that cannot be resolved or read is refused with the error code, and the typed
  path is never used as a fallback. A destination root that does not resolve refuses the scan, and
  `reports/` is never the fallback. A container whose owner cannot be checked is left alone, never
  removed.
- Paths and ports are read at call time (`HOME`, `CW_ADMIN_PORT`, `CW_ADMIN_LOCAL_PORT`,
  `CW_JOB_LOG_DIR`, `CW_SCAN_PATH_OUT`, `CW_SIDECAR`, `CW_DOCKER`, `CW_PS`), so the tests run on
  fixtures.
- Every server string reaching markup is escaped: `pcEsc()` for the label and state, `ansiHtml()`
  (which escapes before it colours) for log lines.
- On the published port the controls are absent, not disabled.
- The scan installs nothing. A lane whose tool is missing reports not scanned, and the section says
  where to install it.

## S: Safeguards

- **Port.** `POST /api/scan-path` and a `scan-path` stop refuse off the operator port with `403`.
  The operator port is a socket property the caller cannot assert, and serve.mjs verifies at boot
  that the tunnel does not route it.
- **CSRF and login.** serve.mjs's CSRF gate rejects a state-changing request without `x-cw-csrf`
  before any modular route runs, and its login gate runs before modular dispatch. The client posts
  through `cwPost()`, which sends the header.
- **Credential stores, both directions.** A path inside a store is refused because the scan would
  read it. A path that contains one (`~`, `/Users`, `/`) is refused because discovery would walk it,
  and when that directory is itself a git repository (a home directory under version control) the
  lanes run over the whole home directory: a docker lane mounts the repository root, keys
  included. This is the rule `symlinkReads()` in `bin/lib/sandbox.mjs` already applies to link
  targets. The rule is lexical, so a store that does not exist still guards its parent.
- **The checkout, both directions.** Refused, with everything inside it and every directory that
  contains it. It holds git-excluded material a scan would read and copy into a new report tree:
  CRA attestation keys (`cra/.keys/`), the private fleet registry (`monitor/projects.json`) and
  every earlier report under `reports/`. The scheduled sweep already scans the checkout under its
  declared area.
- **The destination root, both directions.** A scan of the sidecar (or of `CW_SCAN_PATH_OUT`), or
  of a directory holding it, would read earlier scans' reports and the sidecar's private records,
  and write into the tree it is reading.
- **System directories.** Refused on the typed spelling and on the realpath, because macOS resolves
  `/etc` to `/private/etc` and `/tmp` to `/private/tmp`. The temp exceptions are carved out of the
  roots they sit under, because scanning a throwaway clone is the normal use.
- **Containers.** Removal is by owner label, never by a `cw-cli-*` prefix, which would take a
  terminal scan's containers with it.
- **Visibility.** A session sees only the runs its selection names, and a scan's local paths only on
  the operator port.

## Operator rulings (2026-09-29)

Seven questions were open on 2026-09-28; the operator ruled on all seven on 2026-09-29.

1. **A sweep started during a scan: fixed.** Ruled a defect, not a decision ("there's not a
   decision point here"). The sweep's reaper removed every `cw-*` container outside a live sweep
   slice, which killed a running CLI scan's docker lanes, from the panel or a terminal. CLI runs now
   label their containers with their owner, and the reaper spares a live owner's (R10).
2. **Job visibility: fixed.** Fleet runs appear only in the fleet view; any other run only for the
   repo or area selected in the picker; scan paths are redacted for sessions off the operator port
   (R11).
3. **Where the output goes: fixed.** The private sidecar, never the checkout's `reports/`, with
   `CW_SCAN_PATH_OUT` for installs that have no sidecar, and a refusal when neither resolves (R8).
4. **Stopping a scan: fixed.** `scan-path` is in `STOPPABLE` for the operator port, and a stop
   removes only that scan's containers (R9).
5. **A directory that contains the checkout: fixed.** Refused (R4).
6. **Before the first account exists: accepted as it is.** The operator port needing no session
   while no account exists "is fine"; this route inherits serve.mjs's behaviour, as
   `POST /api/scanners/action` does.
7. **Other spellings of system paths: fixed.** `SYSTEM_PATHS` refuses the macOS and Linux system
   directories on both spellings, with temp directories and `/Volumes` left scannable (R4).

<!-- verified-against: 2026-10-24 2bc3c0ef -->
# The commitwork runner slot

A slot runs GitHub Actions jobs for a declared repository on the commitwork image. Jobs reach it
through `runs-on: [self-hosted, commitwork]`. Each slot is a container built from
`container/runner/Dockerfile`, which adds actions/runner 2.338.0 to the commitwork image
([container/README.md](../README.md)). A dispatcher (`runner/`) decides which queued jobs are
admitted and mints a runner for each one. This page covers the slot: what one lifetime does, the
flags it runs with, the hook, the network, what is refused, and the waiver that lets a repository's
launch checklist accept a self-hosted job.

## One job per container lifetime

The container's process is `container/runner/supervisor.mjs`, run as root under `--init`. It does
the following once, then exits:

1. Empties `/work`, the slot's work volume, without removing the mount point.
2. Copies the runner from `/opt/actions-runner` (read-only in the image) into `/work/runner`, and
   gives the copy and `/home/node` to uid 1000.
3. Asks the dispatcher for a job over the slot's own network, with the slot's secret. The answer is
   a single-use JIT config, the repository it was minted for, and a job id.
4. Runs the runner as uid 1000 with a new environment: `HOME`, `PATH`, the proxy variables, the
   job-started hook and the expected repository. The slot secret is not in it; the supervisor
   deletes it from its own environment when it reads it.
5. When the runner exits, kills every process uid 1000 still owns, reads its own cgroup (CPU
   seconds, peak memory, I/O) and reports those figures to the dispatcher.
6. Exits: 0 the runner exited 0, 1 the runner failed, 3 the claim was refused, 4 `/work` is missing.

The restart policy (`always`) starts the next lifetime. A restart gives the container fresh tmpfs
mounts and a new cgroup, so the totals in step 5 belong to one job. A JIT runner is ephemeral:
GitHub deregisters it after its one job.

## Run flags, and what happens without each

The stack generates one compose service per slot. The same settings as `docker run` flags:

```sh
docker run --init --read-only --restart always \
  --security-opt seccomp=container/runner/seccomp.json --device /dev/net/tun \
  --tmpfs /tmp:size=2g --tmpfs /home/node:size=2g,uid=1000,gid=1000 \
  --cpus 4 --memory 6g --pids-limit 4096 \
  -v slot-1-work:/work --network jobs-slot-1 \
  -e CW_SLOT_ID=slot-1 -e CW_SLOT_SECRET -e CW_SLOT_CLAIM_URL=http://dispatcher:7090 \
  -e HTTPS_PROXY=http://egress:3128 -e NO_PROXY=dispatcher \
  commitwork-runner:<sha>
```

| Flag | Why | Without it |
|---|---|---|
| `--read-only` | Nothing outside the tmpfs mounts and `/work` is writable, so a job cannot leave a file for the next one | A restart keeps the container's writable layer, so anything uid 1000 wrote to a writable path such as `/var/tmp` or `/out` (owned by uid 1000 in the commitwork image) would be there for the next job. Not measured |
| `--tmpfs /tmp`, `--tmpfs /home/node` (uid 1000) | The writable places a job needs under a read-only root, emptied by every restart | Under `--read-only` the job has no writable `/tmp` or `$HOME`. Not measured |
| `-v <slot>-work:/work` | The runner writes `_diag`, `_work` and its JIT files beside its binaries, and checkouts need room. A volume survives a restart, so the supervisor empties it first | Without the volume the supervisor exits 4 and claims nothing. Without the wipe, the next job would find the last one's files |
| `--security-opt seccomp=container/runner/seccomp.json` | bwrap creates user, mount, network and UTS namespaces for each scanner lane. The profile is Docker's default from moby/profiles commit `4b8214fc` with one rule added: an unconditional allow of `clone`, `unshare`, `setns`, `mount`, `umount2`, `pivot_root` and `sethostname` | With Docker's default profile, doctor finds no host sandbox and every host lane is refused as `noscan`, because the image sets `CW_SANDBOX=require`. The profile takes the place of `seccomp=unconfined`, which the commitwork image needs when run on its own. The slot sets no AppArmor option (see *Not measured*) |
| `--device /dev/net/tun` | pasta gives a lane with network egress its own namespace through a tap device | Every lane with network egress is refused as `noscan` ([container/README.md](../README.md)) |
| `--init` | The supervisor is not PID 1, so processes it does not wait for are still reaped | Not measured |
| `--cpus`, `--memory`, `--pids-limit` | Per-slot limits, so one job cannot take the whole Docker VM | A job can use every CPU, all memory and any number of processes. Not measured |
| No Docker socket, ever | A container that holds the socket is root on the Docker host | The job could start a privileged container. No slot, and no other service in the stack, mounts it |
| `CW_SLOT_SECRET` as an environment variable, not a bind-mounted file | On Docker Desktop a bind-mounted host file of mode 0600 reads as owned by whichever uid opens it, so uid 1000 could read it | The job could read the secret and claim another job's JIT config |

## The job-started hook

GitHub assigns a queued job to any online runner whose labels match, in that repository. It does
not assign by job id. A runner the dispatcher minted for an admitted job can therefore take a
different queued job from the same repository, including one admission refused or never saw.

The supervisor sets `ACTIONS_RUNNER_HOOK_JOB_STARTED` to `container/runner/job-started.sh`. That
file is root-owned and read-only in the image, and runs `job-started.mjs` before the job's first
step. The hook reads `GITHUB_EVENT_PATH` and applies the dispatcher's event rules again
(`eventVerdict` in `runner/admission.mjs`) to the job that actually arrived. It also checks that the
job's repository is the one the runner was minted for. A refusal exits 1, which fails the job before
any step runs.

The hook re-checks event facts only. A job that arrives this way and needs docker (`container:`,
`services:`, a docker action) fails when it tries, because the slot has no daemon. That costs the
job, not isolation.

## Networks

Each slot has its own `internal: true` network. The only other services on it are the dispatcher,
which answers claims on port 7090, and the egress proxy, on port 3128. Two slots never share a
network: two containers on one internal network can connect to each other, and one job could then
reach another.

The egress proxy (`bin/egress-proxy.mjs`) is the slot's only route out. The runner and the job get
it through `HTTPS_PROXY`, and the proxy is run with an allowlist in enforce mode. The runner's own
destinations, recorded through the proxy in observe mode, were `github.com`, `api.github.com`,
`codeload.github.com`, `pkg.github.com`, the `broker`, `pipelines`, `results-receiver`, `run` and
`token` hosts under `actions.githubusercontent.com`, `copilot-proxy.githubusercontent.com`, and
`productionresultssa*.blob.core.windows.net`.

The internal network does not stop the proxy from relaying to a private address. The proxy has to
refuse those destinations itself, with `--deny-private`: RFC 1918 (which covers Docker networks and
Docker Desktop's `192.168.65.0/24`), CGNAT, the benchmark range, ULA, multicast and broadcast. That
is in addition to loopback and link-local, which it always refuses.

## What admission refuses

The dispatcher reads each queued job before minting (`runner/admission.mjs`,
`runner/repo-gate.mjs`). A refused run is recorded with its reason and cancelled before any new
runner exists, so it does not sit queued.

| Refused | Why |
|---|---|
| A repository not in the declared list | Only declared repositories are served |
| A public repository whose fork pull request approval is not `all_external_contributors` | Every job in that repository is refused. A fork's run must wait for a person's approval |
| `pull_request_target` and `workflow_run` | They run with the base repository's secrets and a write token |
| A head repository other than the repository itself, on any event | That is code from a fork |
| An actor or triggering actor not in the repository's `actors` (default: the repository's owner) | A write collaborator pushes branches into the repository itself, so a same-repository head does not show whose code it is. A re-run executes the original actor's code, so both are checked. The job-started hook checks `GITHUB_ACTOR` and `GITHUB_TRIGGERING_ACTOR` again |
| `runs-on` labels outside the declared set | The job asked for a different machine |
| `container:`, `services:`, `docker://` steps, and docker actions visible at the head commit | Slots have no Docker. A remote docker action is not visible, and fails when it runs |
| A local action whose `action.yml` is not visible at the head commit, and a call to a reusable workflow | Their docker needs cannot be read, and the called workflow is not inspected |

## The `self-hosted-runner` waiver

`bin/actions-gaps.mjs` reports every job whose `runs-on` names `self-hosted` as `self-hosted-runner`,
high, and keeps it high for a repository on this runner too: a label proves nothing about the
machine. Opting a repository in records an `accept` annotation on that finding. The launch checklist
(`bin/launchlist.mjs`) honours that annotation for this rule only.

**How it is keyed.** The annotation is a `scannerAnnotations` record in the operator's annotation
store (`monitor/private/annotations.json`, or `CW_ANNOTATIONS`), never in the scanned repository.
It uses the rollup's identity for the `actionsGaps` category: `rule`, `file` and `job` (the key
under `jobs:`), plus `repo`. It has no line number. That is one record per self-hosted job, and a
job added later is not covered by an earlier record. A fleet-scoped record is never a waiver.

**The basis is checked.** An annotation's `reason` is free text, and the store's structured fields
cannot carry this: `claim` accepts only `remediated`, and `defect` only `incorrect-scan-result`.
Adding a field would change the store's contract for the panel, the CLI and the rollup. So the
basis is plain text with a fixed form that the checklist reads. It must start with
`commitwork-runner:` and name each of these control ids:

| Id | Control |
|---|---|
| `no-docker-socket` | No container in the stack mounts the Docker socket |
| `slot-network` | Each slot is alone on an internal network, and the egress proxy is its only route out |
| `jit-only` | The access token stays in the dispatcher. A slot receives one single-use JIT config |
| `one-job-per-slot` | One job per container lifetime: root empties `/work`, and the job runs as uid 1000 |
| `admission` | The refusals in the table above |
| `job-started-hook` | The event rules applied again to the job that arrived |

The checklist checks that the basis names the controls. It does not check that they hold.

**Recording it.** List the self-hosted jobs, then record one annotation for each:

```sh
node bin/actions-gaps.mjs <checkout>     # self-hosted-runner findings give `path` and `job`
node bin/annotate.mjs add --category actionsGaps --repo <name in the fleet registry> \
  --rule self-hosted-runner --file .github/workflows/<workflow>.yml --job <job id> \
  --action accept --expires <ISO date> \
  --reason "commitwork-runner: no-docker-socket slot-network jit-only one-job-per-slot admission job-started-hook" \
  --check-rollup reports/<area>/rollup.json
```

`--repo` is the name the rollup writes on each row, which is also the launchlist's project name.
It is not the GitHub `owner/name`. `bin/annotate.mjs` refuses a suppression without `--expires`.

**What the checklist reports.** In `pub.gh.workflows`, a waived job is a warn row of the form
`<file>: self-hosted runner, job <job> waived: accepted <date> by <who>: <basis>`. The job stays a
hard failure when:

- no `accept` for that repository, file and job is in force (absent, expired, not yet in effect, or
  another action);
- the basis does not start with `commitwork-runner:` or leaves out a control id;
- the job's `runs-on` does not name `commitwork` literally (a matrix expression does not count);
- the workflow does not parse, or the checklist's own `runs-on: … self-hosted` match has no job to
  attach a waiver to;
- the annotation store cannot be read.

`pull_request_target` anywhere in a workflow fails the check whatever the annotations say.

## As measured, 2026-10-22

On Docker Desktop 29.6.2 for arm64, with the commitwork image built from `2bc3c0ef` with
`SCANNERS=gitleaks`, the runner files from this directory, and a private probe repository:

- **Seccomp.** `container/smoke.sh --min 5`: unconfined, 19 lanes ran (15 with no network, 4
  behind pasta). With Docker's default profile, smoke exited 23 (doctor: no host sandbox). With
  `seccomp.json`, the same 19 lanes ran with the same isolation. Without `setns` and
  `sethostname`, 15 ran and the 4 lanes behind pasta were lost.
- **Inside a job:** uid 1000, no effective capabilities, seccomp in filter mode, root filesystem
  read-only.
- **The hook.** A runner minted for a `push` job took a queued `workflow_run` job instead. The hook
  failed it in "Set up runner", and the workflow's step was skipped.
- **One job per lifetime.** One job planted files in `$HOME` and `/work/runner` and left a
  background process. The next job on the same slot found an empty home, an empty work directory and
  no such process. Each ephemeral runner deregistered itself.
- **Network.** From an internal network, `host.docker.internal` did not resolve, and Docker
  Desktop's host gateway (`192.168.65.254`), LAN addresses, public addresses and the control network
  were unreachable. A second container on the same internal network could connect, which is why
  each slot has its own. Through the proxy in observe mode, before `--deny-private` existed, a
  container reached the host gateway and the LAN.

## Not measured

- **AppArmor.** The Docker Desktop VM has none. On a Linux host, Docker applies its default
  AppArmor profile, which denies the mounts bwrap makes. Expect every host lane to be refused as
  `noscan` there; the slot sets no AppArmor option.
- **The proxy with `--deny-private`, from a slot.** The refusal of private destinations has not been
  run against the probe list from inside a job.
- **Reading the slot secret from a job.** uid 1000 reading `/proc/<pid>/environ` of the root
  supervisor or of `--init` has not been tried.
- **The isolation probes from inside a job**: the host's services, the stack's other services,
  another slot, the LAN, the access token, and claiming a second JIT config.
- amd64, rootless Docker and Podman.

## Known cost

Every lifetime copies the runner (458 MB, of which 371 MB is the bundled node20 and node24) from the
image into `/work`. In the measured jobs that copy accounted for about 600 MB of page cache in a
reported memory peak of 637 MB. Page cache counts toward the slot's memory limit and its reported
peak, so a job's own memory use is lower than its peak by about that much. A trivial job took about
4 CPU-seconds and 17 to 20 seconds of wall time. The runner image measured 1.83 GB, against 1.21 GB
for the commitwork image it was built on.

The image bundles third-party works that travel under their own terms:
[docs/THIRD-PARTY-NOTICES.md](../../docs/THIRD-PARTY-NOTICES.md#6-the-container-images). The
Dockerfile's last step rebuilds the commitwork image's licence directory,
`/usr/share/licenses/commitwork`, to include actions/runner, its .NET runtime (with the runtime's
`THIRD-PARTY-NOTICES.TXT`), the bundled node20 and node24, and libatomic1. It takes the same
`--build-arg SOURCES_AT=<SOURCE-BUNDLE-LOCATION>`. Build the source bundle from the runner image
itself, with `node container/sources.mjs --image commitwork-runner:<sha> --out <dir>`, and publish
it beside the runner image ([container/README.md](../README.md#licences-and-source)).

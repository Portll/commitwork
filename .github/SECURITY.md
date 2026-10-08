# Security Policy

<!-- verified-against: 2026-10-07 -->

commitwork is a repository security scanner, local CI runner and scheduled monitoring system with
remediation and compliance-evidence tooling. This document says where to send a vulnerability, what
we will do with it, and — the part most policies leave out — which of this system's defaults are
load-bearing, so an operator can tell a deliberate posture from an accident.

It lives in `.github/` rather than the repository root because
[CLAUDE.md](../CLAUDE.md) reserves the root for `README.md`, `CLAUDE.md` and `LICENSING.md`, and
`bin/docs-doctor.mjs` enforces that.
GitHub reads `.github/SECURITY.md` for the Security tab and the "Report a vulnerability" flow, so
nothing is lost by it.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x (unpublished) | Best-effort. Evaluation-only; the licence is not in force — see [LICENSING.md](../LICENSING.md). |
| anything earlier | :x: |

There has been no public release. Every version of this repository to date is a working line, not a
security-hardened release, and it should be treated that way.

## Reporting a vulnerability

Report privately. Do not open a public issue.

1. **Email** — john@portll.net
2. **GitHub** — [private Security Advisory](https://github.com/Portll/commitwork/security/advisories/new)

This is the single disclosure contact for the whole four-part distribution — commitwork,
overwatch-layer, spine and memory-layer — so a reporter never has to work out which component owns a
bug that crosses a wire between them. See [docs/stack/README.md](../docs/stack/README.md), which is
the operator-ruled component list of 2026-09-09; only commitwork has a repository today.

**Include:** what the defect is, how to reproduce it, what an attacker gets, and any fix you have in
mind. A reproduction we can run is worth more than a description of one.

**Our response:**

- initial reply within 48 hours
- status update within 7 days
- fix timeline set by severity, and stated to you rather than left open

**Please don't** open a public issue, or disclose before a fix exists. If we go quiet past the
windows above, chase us — silence is a failure on our side, not a request for yours.

## Scope

**In scope** — defects in this repository: the `bin/` CLIs, the admin panel on :7878, the MCP server
under `mcp/`, the scheduled monitor under `monitor/`, the CRA/SOC2 evidence tooling under `cra/`, and
the viewers under `map/` and `sitemap/`.

**Out of scope, and worth stating because this tool's output looks like findings:**

- Vulnerabilities in *third-party repositories that commitwork scans*. Those belong to the projects
  that own them; report them there.
- The contents of `reports/**` and `evaluations/**`. Those are generated evidence about other
  people's code, not code we ship. `evaluations/` is a symlink to a private sidecar and is not in a
  clone at all.
- Findings that a scanner emitted and nobody has adjudicated. An unreviewed scanner result is an
  input to a judgment, not a vulnerability report.

A **false clean** — commitwork reporting that something passed when it did not, or reporting an
unmeasured check as a pass — **is in scope and is the most serious class of defect this project
has.** The whole system is an argument that unenforced claims are defects, so a check that lies is
worse here than a crash. `monitor/FALSE-CLEAN-TAXONOMY.md` is the running record of every way this
system has said "fine" while wrong; adding to it is a legitimate report.

## Deliberately malicious test fixtures

`fixtures/scan-canary/` is a pair of synthetic repositories — `clean/` and `dirty/` — that exist so
a clean scan means something. The canary tests point the scanners at both, across the eleven lanes
the fixtures plant: `dirty/` must produce the findings `fixtures/scan-canary/EXPECTED.json` names, and
`clean/` must produce none. A detector
that has gone silent is otherwise indistinguishable from a tidy tree.

**`dirty/` is hostile by design, and a scanner or antivirus hit on it is the correct result, not a
finding against us.** Do not report these as vulnerabilities, and do not execute or load them.
Eighteen of the files are model artifacts, nine in each tree:

| Fixture | What is in it |
| --- | --- |
| `dirty/model.pkl` | A 33-byte pickle whose opcodes are `GLOBAL 'os system'` + `REDUCE` — it calls `os.system` on unpickling. The argument is the string `true`, so the command it runs is a no-op. |
| `dirty/real/real.keras`, `dirty/real/real_legacy.h5` | Genuine Keras v3 and legacy HDF5 archives carrying a `Lambda` layer whose `function.config.code` is base64 marshalled Python bytecode. Loading the model executes it. The bytecode decodes to `lambda x: x * 1.0`. |
| `dirty/real/real_savedmodel/` | A TensorFlow SavedModel protobuf graph containing `ReadFile` and `EagerPyFunc` ops — a file read and an arbitrary-Python callback inside the graph. |
| `dirty/model.keras`, `dirty/saved_model.pb` | Minimal hand-built stand-ins for the same two formats, for the parsers that only read headers. |
| `clean/` equivalents | The negative controls. `clean/model.pkl` is a plain dict with no `GLOBAL` or `REDUCE` opcode; the `clean/real/` models carry no `Lambda` layer and no `PyFunc` or `EagerPyFunc` op. |

The pattern throughout is **real malicious structure with a deliberately inert payload**: the
opcode chain, the embedded bytecode and the graph ops are exactly what a real attack uses, so a
detector that matches on structure fires correctly, while the effect of actually running one is
nothing. That is a choice, not an accident — a fixture whose payload did something would make the
test suite itself the hazard.

`dirty/` also carries non-model canaries that will trip secret scanners and SAST: a fake
GitHub-shaped token in `dirty/.claude/settings.json`, fetch-and-execute pipelines in
`dirty/.claude/`, `dirty/Dockerfile` and the `dirty/.github/workflows/`, an install hook under
`dirty/node_modules/`, and injection and hardcoded-credential patterns in `dirty/src/`. Every host a
payload contacts is under the reserved `.invalid` TLD, so nothing resolves even if something runs;
the lockfile's `resolved` entries are ordinary integrity-pinned registry.npmjs.org URLs. The tokens are synthetic and match no real credential.

If you vendor or mirror this repository into a scanned environment, exclude
`fixtures/scan-canary/dirty/` or expect the alerts.

## Posture: the defaults that are load-bearing

What each command executes, reads and reaches when pointed at a repository you do not own, the
controls between that repository and the host, and the residual risks are stated per command in
[docs/THREAT-MODEL.md](../docs/THREAT-MODEL.md).

Behaviour-changing security controls ship closed. Restoring the looser behaviour is an explicit
opt-in, and each one below prints what it did rather than doing it quietly.

| Switch | Default | Effect when changed |
| --- | --- | --- |
| `--trust-repo-manifest` / `COMMITWORK_TRUST_REPO_MANIFEST=1` | off | A repo-local `commitwork.json` is **never executed** without this. A manifest can mint credentials and POST seed objects, so a checked-out repository that ships one would otherwise be running its own code against your session. Only bundled manifests run via the MCP server. |
| `CW_ALLOW_UNSIGNED=1` | unset | `bin/commit-phase.mjs` signs every commit it lands and refuses to land one it could not sign. Setting this lands unsigned and warns on stderr. Unsigned is permanent: a signature is part of the commit object, so repairing one rewrites every sha below it. |
| `CW_OAUTH_LIVE_EXCHANGE=1` | unset | The panel's Google SSO performs a real token exchange only when this is set. Unset, the exchange is not live. |

Two structural rules matter more than any single flag:

- **Declaration is split from authority.** The tools that describe deployments, DNS and tunnels hold
  no credentials and apply no changes. Applying stays a human act. A tool that can only *describe* a
  production change cannot be turned into one that makes it.
- **Fail closed.** A parse failure or a permission error is never an empty result. Only `ENOENT`
  means "legitimately absent". This is a security property, not a tidiness one: an empty store that
  reads as "nothing found" is the false-clean class above.

## The panel's exposure boundary

The admin panel binds an operator port and, separately, a published port. The published port must
answer `401` to an unauthenticated request; the operator port serves the panel. This is asserted on
every CI run by `bin/smoke.mjs` rather than documented and hoped for — a smoke test that only checks
"something responded" passes just as happily when auth has been switched off. The auth model and
the exposure view are described in [admin/README.md](../admin/README.md).

## What we run against ourselves

- **CodeQL** on every push and pull request, plus weekly — [`codeql.yml`](workflows/codeql.yml).
  It uses the same exclusions as the local lane, for the reasons recorded in
  `manifests/codeql-filters.txt`.
- **The full test suite, `node --check` over every module, a boot smoke test and a documentation
  freshness gate** — [`ci.yml`](workflows/ci.yml).
- **Dependency and action updates** — [`dependabot.yml`](dependabot.yml). commitwork declares zero
  runtime dependencies and intends to keep them at zero, so the surface that actually moves is the
  set of GitHub Actions in these workflows.
- **A secrets sweep** before publication — `docs/SECRETS-SWEEP.md` states the method and why it is
  deliberately not a pre-commit hook.

## Regulatory

The EU Cyber Resilience Act's Article 14 reporting duties come into force on **2026-09-11**. The
contact above is the one those duties point at. The CRA readiness tooling — cases, SBOM/VEX, POA&M,
SOC 2 and attestation — is documented in [cra/README.md](../cra/README.md).

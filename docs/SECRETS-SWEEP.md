# Secrets sweep — the belt-and-braces method

<!-- verified-against: 2026-10-05 -->

How this repository checks whether it is leaking a credential, why it runs three scanners instead
of one, and what each of them is blind to. The method is `bin/secrets-sweep.mjs` plus two
off-the-shelf tools, wired to a canary that measures the scanner and a gate that runs before
anything is handed over.

## The worked example: 2026-08-20

A sweep of `evaluations/` ran three ways on the same tree, on the same afternoon.

| Method | Result | Verdict on the result |
| --- | --- | --- |
| gitleaks (dir mode, cwd-relative, default rules) | 0 findings | **wrong, confidently** |
| trufflehog | 2 findings | both placeholders — right that they were findings, wrong that they mattered |
| pattern/entropy/context pass (now `bin/secrets-sweep.mjs`) | 1 real secret | the only method that saw it |

The real secret was a **live GlitchTip DSN** — `https://<32-hex-key>@app.glitchtip.com/…` — quoted
as audit evidence in three `evaluations/audit-2026-07-29/` files. Neither gitleaks nor trufflehog
carries a DSN / userinfo-URL rule in its default set, so both agreed with each other and both were
wrong. Two independent tools returning "clean" is not two votes for clean; if they share a blind
spot, it is one vote counted twice.

That is the whole argument for belt-and-braces. It is not that any of these tools is bad. It is
that scanner agreement is only evidence when the scanners are actually independent, and rule sets
drawn from the same public corpora are not.

**The corollary cuts the other way too.** The third method finding what two others missed is not a
reason to trust it instead of them. It is a reason to keep all three — and the fourth location
below is what that reasoning bought.

### The fourth location, which only history had

Once the DSN rule was ported into `.gitleaks.toml` and run against git history, it returned 11
matches, every one of them `@app.glitchtip.com`. Three are the known files. The fourth is
**`sitemap/data/fixture.sitemap.json`**, which does not contain the DSN today and did in commits
a commit and a commit.

No worktree scan can see that, and `bin/secrets-sweep.mjs` never will — it reads a tree, not a
history. This is the concrete argument for keeping the layers split rather than merging them:
each covers a dimension the others do not, and the DSN was in three files, four files, or one
file depending on which dimension you asked about.

## The three layers

Run all three. They are ordered cheapest-first, but none of them is the one that decides.

### 1. gitleaks — history, with this repository's own rules

```sh
gitleaks git . -c .gitleaks.toml --no-banner        # history — the layer nothing else covers
gitleaks dir . -c .gitleaks.toml --no-banner        # working tree
```

**Always pass `-c .gitleaks.toml`.** [`.gitleaks.toml`](../.gitleaks.toml) extends the default rule
set (`useDefault = true` — it adds, it never narrows) with the two rules the defaults lack:
`commitwork-dsn-userinfo` and `commitwork-userinfo-password`. Without the config this layer is the
one that returned 0 on a tree containing a live key.

**Run it cwd-relative.** An absolute `--source` yields absolute paths in every fingerprint, and a
fingerprint reading `/Users/<name>/Repositories/Portll/commitwork/evaluations/x.md:rule:41` matches
no citation anyone will ever write and rots the moment the repo is cloned elsewhere. They still rot
on line drift — a fingerprint is line-keyed, the identity defect this repository has a house rule
about — so treat them as a run-local handle, never as a durable finding identity.

Two things worth knowing about the config:

- **gitleaks is Go, so the regexes are RE2 — no lookahead, no lookbehind.** The first draft of the
  DSN rule panicked the binary outright (`invalid or unsupported Perl syntax: (?!`). Both
  constraints the lookaheads expressed are recoverable: "no password component" is just excluding
  `:` from the userinfo character class, and "is key-shaped rather than a username" becomes an
  entropy floor on the captured group, which is the RE2-native way to say it and a better test
  besides. *A config change is not verified until it is run* — this one proved it twice.
- **`gitleaks dir` walks the disk, not the index, so it does not honour `.gitignore`.** Pointed at
  this repository without an allowlist it goes through `reports/` — 421,797 files, 28 GB — and does
  not finish. The config excludes it by path.

Strength: git history, which `bin/secrets-sweep.mjs` deliberately does not read.

### 2. trufflehog — verification against live providers

```sh
trufflehog filesystem evaluations/ --json
```

Strength: it will attempt to *verify* a candidate against the provider, turning "this looks like an
AWS key" into "this key is live". Nothing else here can do that.
Blind spot: userinfo URLs / DSNs; and its unverified findings are mostly placeholders.

### 3. bin/secrets-sweep.mjs — the third method

```sh
node bin/secrets-sweep.mjs                          # every git-tracked file
node bin/secrets-sweep.mjs --head                   # the COMMITTED tree, incl. worktree-deleted
node bin/secrets-sweep.mjs --paths evaluations --all --json
```

| Flag | Effect |
| --- | --- |
| `--paths <p>[,<p>…]` | directories or files to scan; overrides tracked-file mode |
| `--head [<ref>]` | scan the committed tree at `<ref>` (default `HEAD`) instead of the worktree |
| `--json` | complete machine-readable result; the text view summarises, the JSON never does |
| `--all` | print every hit in the text view rather than the first few per class |
| `--fail-on-context` | make `SENSITIVE-CONTEXT` findings exit 1 as well |
| `--no-fixture-exempt` | ignore every self-declared fixture exemption |
| `--max-bytes <n>` | per-file size ceiling; larger files are UNSCANNED, not skipped |

Env seams — `CW_SECRETS_ROOT`, `CW_SECRETS_MAX_BYTES`, `CW_SECRETS_NO_FIXTURE_EXEMPT` — are read at
CALL time, never at module load, so a test can set them after importing.

**Exit codes: `0` clean · `1` findings · `2` scan failure.** Failure outranks findings. A sweep that
could not read part of its target does not get to report a verdict on the whole target, so a run
with any scan failure exits 2 even when it also found secrets, and can never exit 0. An internal
crash lands on 2 for the same reason: left uncaught, Node exits 1, which is this tool's word for
"findings", and a sweep that never ran would be indistinguishable from one that found something.

> **The truncated-pipe defect, for anyone writing a consumer.** A write to stdout is *asynchronous*
> when stdout is a pipe, and `process.exit()` discards whatever has not flushed. All three CLIs here
> therefore set `process.exitCode` and let the event loop drain. Before that fix the same command
> produced **339,371 bytes redirected to a file and 65,536 bytes — one pipe buffer — through a
> pipe**, and the truncated half was still valid-looking JSON right up to the cut. Redirection being
> synchronous is exactly why it hid: every manual check passed. `bin/pre-publish.mjs` found it by
> never once parsing a real result, and it surfaced as `cannot-check` rather than as a clean bill of
> health only because that gate fails closed. If you add a CLI here, do not call `process.exit()`.

#### Scope

**The default is every git-tracked file.** A hand-kept directory list rots the first time somebody
adds a directory — this repository has a memory of exactly that failure — and `git ls-files` cannot
go stale. If git is unavailable that is a scan failure, never a quieter clean.

**`reports/` is excluded, and by the right mechanism.** It is gitignored, so tracked-file mode never
reaches it; no name is hardcoded. It is also 421,797 files across 28 GB, a naive sweep did not
finish in 500 seconds, and nothing in it is published by a push. If it ever needs covering, cover it
incrementally by sweep directory, not as one pass. (This is where the walker's `push(...acc.files)`
spread crashed with a `RangeError` before reading a byte — the V8 argument ceiling is around 125k.
Now `pushAll`, with a regression test against an array rather than 125,000 real files.)

**`--head` exists because the worktree is not what ships.** 15 files were deleted from this working
copy on 2026-08-20 and every one was still in HEAD, one `git checkout` from returning. A tracked
file missing from the worktree is reported as its own unscanned state — `deleted-from-worktree` —
which points at `--head` rather than being mistaken for a scan failure or for silence.

#### Classes

| Class | What it catches |
| --- | --- |
| `private-key` | `-----BEGIN … PRIVATE KEY-----` blocks |
| `provider-key/aws` | `AKIA`/`ASIA`/`ABIA`/`ACCA` + 16 |
| `provider-key/github`, `/github-pat` | `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`, `github_pat_` |
| `provider-key/google` | `AIza` + 35 |
| `provider-key/slack` | `xox[baprse]-…` |
| `provider-key/npm`, `/stripe`, `/sendgrid`, `/sk-token` | per-provider prefixes |
| `provider-key/azure-storage`, `/azure-sas` | `AccountKey=…`, SAS `sig=…` |
| `provider-key/gcp-service-account` | `"type": "service_account"`, `"private_key_id"` |
| `provider-key/twilio` | `SK` + 32 hex |
| `provider-key/cloudflare-origin-ca` | `v1.0-<24 hex>-<146 hex>` |
| `provider-key/cloudflare`, `/twilio`, `/azure`, `/gcp` | name-anchored — see below |
| `jwt` | three base64url segments beginning `eyJ` |
| **`credential-url/dsn-userinfo`** | **the class both other tools missed** |
| `credential-url/userinfo-password` | classic `scheme://user:pass@host` connection strings |
| `bearer-credential` | `Authorization: Bearer/Token/Basic <token>` |
| `assigned-credential` | `api_key`/`secret`/`token`/`password` = a credential-shaped **literal** |
| `high-entropy` | unbroken runs ≥ 32 chars that survive the exclusions below |
| `context/*` | reported separately — see *Sensitive context* |

Some providers are reached by NAME rather than by shape. A Cloudflare API token is 40 characters of
base62 and a Twilio auth token is 32 hex, with nothing to key on; a rule for those is a rule for
every identifier of that length. `CLOUDFLARE_API_TOKEN=<40 chars>` is identifiable, so those
families key on the variable name beside the value.

#### Why the DSN class needs its own rule

A DSN is a URL whose **userinfo is the credential**. Sentry and GlitchTip use the shape; so do AMQP,
Mongo, Postgres and Redis. A conventional rule keys on `user:pass@host`, because that is where a
password obviously lives — and a DSN has no password component at all. The secret sits in the
position a parser expects a *username* in, so it reads as a URL to a human and as a URL to a tool.

The rule fires on two conditions: an explicit password component, or **no password and a key-shaped
username** (≥ 16 chars, contains a digit, not a plain identifier). The GlitchTip key was 32 hex
characters, which is why the second condition is the one that mattered.

Findings name the service — `glitchtip`, `sentry`, `postgresql` — because which service is exposed
is what decides how fast the key has to be rotated. An unrecognised host is named `unknown-service`
rather than left blank; a missing service is not a harmless one.

#### Literal versus binding

**The rule was flagging good practice.** Over 524 files of this repository's own source, the
assignment rule produced 22 findings that were correct code flagged for containing the word:
`password: body.password`, `clientSecret: OAUTH_ENV.GOOGLE_OAUTH_CLIENT_SECRET`,
`secret: r.data.totpSecret`, `apiKey = Object.values(x)[0]`. Every one is a *reference* to a
credential, which is exactly what code that does not hardcode its secrets looks like.

In a document, the right-hand side of an assignment is a value. In source, it is usually a binding.
The difference is visible without parsing: **a literal is quoted**, and an unquoted right-hand side
that parses as an identifier, a member expression or an environment-variable name is a name. So the
quote is captured and the unquoted case is tested. A quoted literal still alarms.

This is a downgrade, never a drop — reported as `FALSE-POSITIVE` with `reason: binding`, so the
suppression is on the page and can be argued with.

#### The exclusions this repository lives or dies by

A 40-hex run is a commit SHA and a 64-hex run is a sha256, and this tree is made almost entirely of
both. UUIDs are excluded for the same reason. Beyond those:

**Entropy is measured on the longest delimiter-free segment, not the whole run.** The first version
of the rule reported 320 secrets in `evaluations/` and meant none of them: Shannon entropy cannot
tell a key from a slug, because `adjudication-integrity-2026-08-13` scores as high as a token does.
What separates them is the delimiters — the longest unbroken run in
`HANDOFF-verdict-journals-2026-08-10` is eight characters, while an AWS key is 20 and a DSN key 32.
That change took `evaluations/` from 320 to 3 with no loss of true positives.

**Integrity digests.** `sha512-<base64>`, as every npm lockfile is made of. This is the hex
exclusion's missing half, and widening the scope to tracked files is what exposed it:
`package-lock.json` alone produced 160 of 174 high-entropy findings — one file generating 88% of the
tool's total noise, the 320 failure returning by a different door. An SRI hash is a *public*
checksum, published in the registry and meant to be shared.

**Long camelCase identifiers.** `methodArgumentNotValidReturns422WithFieldErrors` is a JUnit test
method in generated sitemap data; `Uint8ClampedBufferAttribute` is a class in vendored
`three.min.js`. Both are 32+ unbroken characters of mixed case and digits — every signal a key has
except randomness, and words are how that shows. A key's case transitions land on 2-3 character
fragments; a name's land on words, so three word-shaped fragments means prose. Applied to the
longest segment, not the run: `sk-ant-api03-<key>` contains `ant` and `api`, and judging the run
would have called a real Anthropic key a variable name — a false clean produced by a
false-positive fix.

**Alphabet constants.** The RFC 4648 base32/base64 alphabets and base36. Every character distinct
is the highest entropy a string can have, which is exactly why a naive rule loves them.

#### Declared fixture corpora

A scanner that alarms at its own test fixtures teaches everyone to ignore it — this tool's test file
contributed 26 of the source-tree findings, every one a synthetic key that exists so the scanner can
find it. A file may therefore declare itself a synthetic corpus by carrying `secrets-sweep-fixture`
in its first 25 lines.

**The exemption is declared in the file, not inferred from its path.** A path rule (`**/test/**`)
exempts every test file in the tree on the strength of a naming convention nobody signed, and files
move. A declaration is a specific human saying a specific thing about a specific file, and it shows
up in a diff.

**The obvious abuse is real** — any file can declare itself a fixture and hide a live key behind the
claim. Three things hold it: the declaration must sit where a reviewer sees it, every declaring file
is **listed by name** in the report rather than silently dropped, and `--no-fixture-exempt` ignores
declarations entirely, which is what the pre-publish gate runs.

The declaration covers **credentials only**. A synthetic key is still synthetic, but a real home
path in a test file is still a real home path, so `SENSITIVE-CONTEXT` is never exempted.

## Verdict vocabulary

Three words. The difference between them is who has to act.

- **REAL-SECRET** — a credential. Rotate it, then scrub it, in that order. Scrubbing first leaves a
  live key in a tool's cache and no record of what to rotate.
- **SENSITIVE-CONTEXT** — not a credential; nothing to rotate. Still should not leave the
  repository. Personal emails, `/Users/<name>` home paths, RFC1918 addresses with ports (a map of
  somebody's LAN), `security find-generic-password` service and account names, and the PII classes:
  phone numbers, national identifiers, postal addresses, and cloud account/tenant identifiers.
  Each PII rule is anchored on a label or a format marker, because an unanchored digit run matches
  half of every JSON file here.
- **FALSE-POSITIVE** — matched a rule and is not a credential. Always carries a `reason`:
  `binding` (syntax says it is a reference), `placeholder` (the credential material is
  demonstrably fake), or `declared-fixture`. Reported, never silently dropped, because a
  suppression nobody can see is a suppression nobody can review.

**Placeholder is a judgement about the credential, not about the host.**
`https://<key>@example.com/…` has a fake hostname and may still carry a live key; the 2026-08-20 DSN
had a real host *and* a real key. So the placeholder test reads the credential substring only.
Reading the whole match would let any secret hide behind a demo hostname.

**Binding outranks placeholder**, and `token: CW_TEST_TOKEN` is why: that value is an environment
variable name — letters joined by underscores — so it satisfies the word-join placeholder heuristic
too. Both downgrades are correct, but if a value is syntactically a reference then it is not
credential material at all, and asking whether it looks fake is a category error.

## Two traps this method was built around

**The C-locale grep trap.** Under a C locale, `grep` silently suppresses matches in UTF-8-dense
files. It does not warn; it reports no match, and a session relays that as fact. This repository has
already paid for it once in `bin/bola-run.mjs` — see [TRAPS.md](TRAPS.md). If you grep by hand
during triage, use `grep -a` or set a UTF-8 locale. `bin/secrets-sweep.mjs` reads bytes through Node
and never shells out to grep, precisely so the tool does not inherit the failure it documents.

**Audit documents quote what they audit.** This is the structural finding, and it is bigger than one
DSN. `evaluations/` is where this repository writes down what it found — and evidence means quoting.
A finding about a leaked credential contains the credential. Every audit artefact is therefore a
leak channel *by construction*, and it is the one directory whose whole purpose is to be read by
someone outside the work. The DSN was not committed by a careless engineer; it was committed by a
diligent one, as proof.

## The instrument: measuring the scanner

```sh
node bin/secrets-canary.mjs            # 5 scenarios, truth by construction
node bin/secrets-canary.mjs --json --write
```

`bin/test/secrets-sweep.test.mjs` proves each rule fires on a line. That is not the same as proving
the tool still finds a planted corpus in a tree, and the difference is not theoretical: the 320
false-positive first draft would have passed any "does it exit non-zero" check while being useless.
A scanner that has never been observed to fail is not a scanner known to work.

**The assertion is class AND count, never "nonzero".** Each scenario states exactly how many
findings of exactly which classes must come back. Reporting 6 of 7 is a false clean about one
specific rule, and an exit-code check cannot see it — the run still exits 1 and still looks like a
success.

That is not a hypothetical either. Both halves were proven RED on 2026-08-20 against a deliberately
broken scanner, in a detached worktree so the shared tree was untouched:

| Injected defect | S-EACH (class present?) | S-DUP (count right?) | canary exit |
| --- | --- | --- | --- |
| DSN rule disabled | ✖ miss: planted 1, reported 0 | ✖ miss: planted 3, reported 0 | 2 |
| findings de-duplicated **by class** | ✔ every class still present | ✖ miss: planted 3, reported 1 | 2 |

The second row is the point. A class-only assertion scored that scanner healthy while it silently
dropped two of three real leaks.

Exit codes are `0` correct · `1` false alarm · `2` **false clean** · `3` instrument broken. A miss
and an extra are kept apart deliberately: one ships credentials, the other annoys people, and
averaging them into an "accuracy" number hides the only one that matters.

Per the standing validity constraint, every plant is synthesized at run time under `mkdtemp` and
**nothing is committed as a fixture file**. Every credential in the corpus is fabricated.

## The gate: pre-publish, deliberately not pre-commit

```sh
node bin/pre-publish.mjs                       # the committed tree (HEAD)
node bin/pre-publish.mjs --paths dist/packet
node bin/pre-publish.mjs --ref v1.2.0 --json
```

**The leak channel is publication, not committing.** The DSN sat in this repository for weeks doing
no harm, because the repository is private. It became a problem the moment the question was "can
this be shown to someone". `evaluations/` is *meant* to be committed — that is the entire point of
the cycle-artifact tier.

A pre-commit gate on sensitive context would fire on 973 findings in the tracked tree, 894 of them
`/Users/<name>` paths, and be disabled inside a day. This repository has a taxonomy family for that
outcome: **gate theatre**, a gate that exists to be bypassed. A gate nobody can pass is worth less
than no gate, because it also costs you the belief that gates mean anything.

This one runs on a packet — the thing actually being handed over — and it runs rarely, so it can
afford to be strict:

- **`SENSITIVE-CONTEXT` is fatal here**, where it is advisory everywhere else. A personal email is
  nothing inside the repo and is somebody's name in a funder's inbox.
- **Fixture self-declarations are ignored.** A file may exempt itself from the daily sweep; it does
  not get to exempt itself from the thing that ships.
- **The committed tree is scanned by default**, not the working copy.

Verdicts: `clean` · `clean-reviewed` · `blocked-secret` · `blocked-context` · `unreviewed-unscanned`
· `cannot-check`. Exit `0` / `1` / `2`. Older journal records also carry `clean-with-unscanned`, which
is no longer emitted.

**Reviewed dispositions.** A finding or an unscanned file is settled only by a reviewed row in the
private sidecar's `release/reviews.json` (schema `schema/release-reviews.schema.json`). The row is read
from the sidecar's `HEAD` commit, so an uncommitted review cannot settle anything. `CW_RELEASE_REVIEWS`
reads a file instead.

- A finding row is keyed by file, class and `fingerprint`, a hash of the full matched span. The key
  never includes the line, so moving a finding within its file keeps its review. The row's `count`
  bounds how many occurrences it covers, so a second identical match in the same file stays open.
- An unscanned file is keyed by its git blob hash. Changing its bytes reopens it, and an unscanned
  file with no accepting row gives `unreviewed-unscanned` (exit `2`): the check is incomplete.
- Accepting dispositions are `synthetic-fixture`, `public-by-design`, `upstream-content` and
  `not-a-credential` for findings, and `publish` for files. Each needs a reason, a reviewer and a date.
  `pending`, `redact`, `move-to-sidecar`, `rotate` and `withhold` record a decision that keeps the row
  blocking.
- `--draft-reviews` prints `pending` rows for everything open. The rows carry no matched text.

`node bin/release-candidate.mjs` runs this gate on the fresh-root candidate, together with the tree
witness, the private-name scan, docs-doctor and the test suite. See
[the publication boundary](PUBLIC-REPOSITORY-BOUNDARY.md).

**Every verdict is journalled** to `pre-publish.jsonl`, pass or fail. A gate that only records its
refusals cannot tell you it was ever run, and "clean" is the reading that most needs a timestamp
beside it — six months later the question is never "did it fail", it is "when did anyone last
check". If the ledger refuses the write, a passing run is **downgraded to `cannot-check`**: a pass
nobody can later point at is not a pass.

## Measured results

All figures 2026-08-20, a commit.

| Scope | Files | REAL-SECRET | SENSITIVE-CONTEXT | Notes |
| --- | --- | --- | --- | --- |
| source dirs, tool as first committed | 524 | 75 | 711 | the baseline |
| source dirs, tool today | 524 | **19** | 718 | 22 bindings + 26 declared fixtures + 8 other, downgraded |
| whole tracked tree, before SRI fix | 737 | 182 | 973 | 160 were lockfile integrity hashes |
| whole tracked tree, today | 737 | **22** | 973 | see residuals below |
| `evaluations/` only | 184 | 3 | 153 | the three known DSN occurrences |
| git history (gitleaks + this config) | — | 11 DSN + 6 conn-string | — | including the fourth file |

The 22 residuals on the tracked tree are honest and worth knowing:

- **14 in `monitor/data/kev.json`** — 32-hex `cHash=` URL parameters and mailing-list thread tokens
  in *fetched* vendor threat-intel data. They are key-shaped by every measure this tool has, and
  suppressing 32-hex-in-a-URL would suppress the exact class the tool exists for. Correct on shape,
  wrong on semantics, and left reported.
- **4 `assigned-credential`** in test files and one self-inflicted hit in `bin/secrets-sweep.mjs`,
  whose own source contains the string `password' : 'credential-url/dsn-userinfo'`.
- **3 `credential-url/dsn-userinfo`** — the real GlitchTip DSN, still present, still unrotated.
  *(Half of this is no longer true — see the 2026-09-06 re-measurement below. It left the tracked
  tree on 2026-08-26 when `evaluations/` became a symlink to the sidecar, which is where all three
  occurrences lived. It is still in history and still unrotated.)*
- **1 `credential-url/userinfo-password`** in `bin/test/tls-proxy.test.mjs`, a synthetic fixture in
  a file this lane does not own.
- **2 in this document.** The class table quotes `"type": "service_account"` and a rule name that
  happens to read as an assignment. `bin/secrets-canary.mjs` and `bin/test/secrets-sweep.test.mjs`
  carry the fixture declaration and this file deliberately does **not** — it is the file most
  likely to acquire a genuinely quoted example one day, since quoting credentials is its entire
  subject. That is the *audit documents quote what they audit* principle turned on itself, and two
  standing findings is the price of keeping it watched.

### Re-measured 2026-09-06 at a commit — every row dispositioned

`node bin/pre-publish.mjs --no-journal --json`, which is the publication posture: HEAD not the
worktree, context fatal, fixture self-declarations ignored.

| | |
| --- | --- |
| verdict | `blocked-secret`, publish false |
| REAL-SECRET | 76 |
| SENSITIVE-CONTEXT | 129 |
| FALSE-POSITIVE | 90 |
| scanned / unscanned / failures | 1391 / 25 / 0 |

**All 76 were read. None is a leaked credential.** 63 sit in test files, the `fixtures/scan-canary`
corpus and `monitor/test/fixtures/detection-lanes` — synthetic by construction, and counted here
only because this posture ignores the fixture declaration on purpose. The 13 outside those paths
resolve as: 4 npm tarball sha512 provenance hashes in `admin/static/fonts/SOURCE.txt`; 3 in this
document, which is the standing pair above plus one more; 3 `examples` values in the vendored
CycloneDX and CSAF JSON schemas, which are upstream spec text; the detector's own `BEGIN … PRIVATE
KEY` patterns in `monitor/secret-verify.mjs`; the scanner's own `password' : 'credential-url/…'`
source string in `bin/secrets-sweep.mjs`; and the throwaway bootstrap password in
`lib/panel-session.mjs`, which boots the panel on a random port against a temporary auth store and
is reached only from `bin/panel-smoke.mjs` and `bin/theme-matrix.mjs`.

The SENSITIVE-CONTEXT classes that read worst are the same story. Every `context/national-id`,
`context/postal-address`, `context/phone` and `context/cloud-account` row is inside
`bin/test/secrets-sweep.test.mjs` — a synthetic ABN, a fake street, a fake mobile, an example ARN.
The 88 `context/email` rows are dominated by `john@portll.net`, which is the deliberate contact
address in `README.md`, `LICENSING.md` and `docs/AGPL-SCOPE.md`, plus 37 author fields in the
annotation store, which left the tree for `monitor/private/` on 2026-09-30.

**So the gate is not reporting a leak. It is being pointed at the wrong surface.** This posture has
no allowlist and ignores fixture declarations by design, and this repository's product is a secrets
scanner that ships detection rules, a deliberate canary corpus and fixtures asserting on synthetic
credentials. On the whole source tree it therefore cannot reach zero, and a gate that cannot go
green is one readers learn to skip — the failure mode `monitor/release-redactions.json` already
names for the redaction gate. Its designed surface is the other invocation in its own usage line,
`--paths <packet>`: run it on the export that ships, not on the tree that builds it. Reading a red
run here as "the release is blocked on secrets" is a category error, and it has been made at least
twice by review passes over this repository.

Two things are real and neither is in the tracked tree:

- **The GlitchTip DSN is still in history and still unrotated.** Rotate it before any scrub — a
  history rewrite destroys the evidence of what needs rotating, and rotation is a human act this
  tooling deliberately does not hold credentials to perform.
- **The annotation store and the CRA product registry were tracked private registers**, carrying
  client names and a contact address into anything that packed the tree. That was a disclosure
  question for the release boundary, not a secrets question. Both left the tree on 2026-09-30 and
  are private records in `monitor/private/` (`monitor/store-paths.mjs`).

## What is deliberately not done

- **A history walker in Node.** gitleaks already reads history and now carries the DSN rule.
  Re-implementing pack traversal would add no coverage.
- **A pre-commit hook.** See above — that is the gate-theatre argument, and it is a decision, not
  an omission.
- **`reports/` coverage.** Gitignored, never pushed, 28 GB.
- **A `GATE_ROSTER` entry for `secrets-sweep`.** Resolved differently for each half since this was
  first written: `pre-publish` joined the roster at a commit (with a registry mapping, so
  `journalHealth` reports it and the sampler classifies its verdicts), while `secrets-sweep`
  deliberately never journals — it is a scanner a caller may run ad hoc, and the ledger hears about
  secrets only through `pre-publish`'s verdicts. The roster comment at the `pre-publish` entry
  records that decision, and `bin/test/gate-roster-registry.test.mjs` binds roster and registry so
  neither can drift alone.
- **Vendored/generated-data exclusion.** The `kev.json` residue argues for a class of "not authored
  here" files. Deferred rather than guessed at, because the same exclusion would have hidden a
  pasted key.

## Triage procedure

1. Run all three layers, and the history layer specifically. Do not stop at the first "clean".
2. For each candidate, classify REAL-SECRET / SENSITIVE-CONTEXT / FALSE-POSITIVE — judging the
   **credential material**, never the hostname or the filename.
3. For a REAL-SECRET: **rotate first**, scrub second. A scrubbed-but-unrotated key is a live key
   plus a lost record of which key to rotate.
4. Scrubbing an audit artefact means replacing the quoted evidence with a description of it. The
   finding survives; the credential does not. Scrubbing the worktree leaves history intact — see
   the rewrite precedent in `evaluations/DECISIONS.md` and the [TRAPS.md](TRAPS.md) entry on GitHub
   orphans surviving a force-push.
5. Record the sweep — what was scanned, what was NOT scanned, and the verdict per finding.
   **A list of findings without a list of what went unscanned is not a result.**

# Secrets sweep — the belt-and-braces method

<!-- verified-against: 2026-10-13 5e582892 -->

How this repository checks whether it is leaking a credential, why it runs three scanners instead
of one, and what each of them is blind to. The method is `bin/secrets-sweep.mjs` plus two
off-the-shelf tools, wired to a canary that measures the scanner and a gate that runs before
anything is handed over.

## Why three scanners

Two independent tools returning "clean" is not two votes for clean; if they share a blind spot, it
is one vote counted twice. As of 2026-08-20, neither gitleaks' nor trufflehog's default rule set
carries a DSN / userinfo-URL rule, so a live Sentry or GlitchTip DSN
(`https://<32-hex-key>@app.glitchtip.com/…`) passes both, and they agree with each other. Only the
pattern/entropy/context pass in `bin/secrets-sweep.mjs` sees it.

That is the whole argument for belt-and-braces. It is not that any of these tools is bad. It is
that scanner agreement is only evidence when the scanners are actually independent, and rule sets
drawn from the same public corpora are not.

**The corollary cuts the other way too.** The third method finding what two others missed is not a
reason to trust it instead of them. `bin/secrets-sweep.mjs` reads a tree, not a history, so a
credential that was removed from the tree but is still in an earlier commit is visible only to the
history layer. Each layer covers a dimension the others do not, which is why they stay split rather
than merged.

## The three layers

Run all three. They are ordered cheapest-first, but none of them is the one that decides.

### 1. gitleaks — history, with this repository's own rules

```sh
gitleaks git . -c .gitleaks.toml --no-banner        # history — the layer nothing else covers
gitleaks dir . -c .gitleaks.toml --no-banner        # working tree
```

**Always pass `-c .gitleaks.toml`.** [`.gitleaks.toml`](../.gitleaks.toml) extends the default rule
set (`useDefault = true` — it adds, it never narrows) with the two rules the defaults lack:
`commitwork-dsn-userinfo` and `commitwork-userinfo-password`. Without the config this layer misses
DSNs and userinfo-URL credentials.

**Run it cwd-relative.** An absolute `--source` yields absolute paths in every fingerprint, and a
fingerprint reading `/Users/<name>/src/commitwork/docs/x.md:rule:41` matches no citation anyone
will ever write and rots the moment the repo is cloned elsewhere. They still rot
on line drift — a fingerprint is line-keyed, the identity defect this repository has a house rule
about — so treat them as a run-local handle, never as a durable finding identity.

Two things worth knowing about the config:

- **gitleaks is Go, so the regexes are RE2 — no lookahead, no lookbehind.** A lookahead panics the
  binary outright (`invalid or unsupported Perl syntax: (?!`). The DSN rule states its two
  constraints without one: "no password component" excludes `:` from the userinfo character class,
  and "is key-shaped rather than a username" is an entropy floor on the captured group, which is the
  RE2-native way to say it and a better test besides. *A config change is not verified until it is
  run.*
- **`gitleaks dir` walks the disk, not the index, so it does not honour `.gitignore`.** Pointed at
  a checkout without an allowlist it goes through `reports/`, which can hold hundreds of thousands
  of files, and does not finish. The config excludes it by path.

Strength: git history, which `bin/secrets-sweep.mjs` deliberately does not read.

### 2. trufflehog — verification against live providers

```sh
trufflehog filesystem <dir> --json
```

Strength: it will attempt to *verify* a candidate against the provider, turning "this looks like an
AWS key" into "this key is live". Nothing else here can do that.
Blind spot: userinfo URLs / DSNs; and its unverified findings are mostly placeholders.

### 3. bin/secrets-sweep.mjs — the third method

```sh
node bin/secrets-sweep.mjs                          # every git-tracked file
node bin/secrets-sweep.mjs --head                   # the COMMITTED tree, incl. worktree-deleted
node bin/secrets-sweep.mjs --paths <dir> --all --json
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

> **For anyone writing a consumer: the CLIs never call `process.exit()`.** A write to stdout is
> *asynchronous* when stdout is a pipe, and `process.exit()` discards whatever has not flushed. A
> large result then arrives cut at one pipe buffer (65,536 bytes) through a pipe while a redirect to
> a file gets all of it, and the truncated half is still valid-looking JSON right up to the cut.
> Redirection being synchronous is why a manual check does not show it. All three CLIs here set
> `process.exitCode` and let the event loop drain. If you add a CLI here, do the same.

#### Scope

**The default is every git-tracked file.** A hand-kept directory list rots the first time somebody
adds a directory, and `git ls-files` cannot go stale. If git is unavailable that is a scan failure, never a quieter clean.

**`reports/` is excluded, and by the right mechanism.** It is gitignored, so tracked-file mode never
reaches it; no name is hardcoded. It can hold hundreds of thousands of files, a naive sweep does
not finish, and nothing in it is published by a push. If it ever needs covering, cover it
incrementally by sweep directory, not as one pass. The walker appends with `pushAll` rather than a
`push(...files)` spread, because the V8 argument ceiling is around 125k and a spread over a list
that long throws `RangeError` before reading a byte.

**`--head` exists because the worktree is not what ships.** A file deleted from the working copy is
still in HEAD, one `git checkout` from returning. A tracked
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
| **`credential-url/dsn-userinfo`** | **the class neither default gitleaks nor trufflehog rule set has** |
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
username** (≥ 16 chars, contains a digit, not a plain identifier). A Sentry or GlitchTip key is 32
hex characters with no password component, so the second condition is the one that catches it.

Findings name the service — `glitchtip`, `sentry`, `postgresql` — because which service is exposed
is what decides how fast the key has to be rotated. An unrecognised host is named `unknown-service`
rather than left blank; a missing service is not a harmless one.

#### Literal versus binding

**A naive assignment rule flags good practice.** `password: body.password`,
`clientSecret: OAUTH_ENV.GOOGLE_OAUTH_CLIENT_SECRET`, `secret: r.data.totpSecret` and
`apiKey = Object.values(x)[0]` are correct code that contains the word. Every one is a *reference* to a
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

**Entropy is measured on the longest delimiter-free segment, not the whole run.** Shannon entropy
cannot tell a key from a slug: a file name like `quarterly-access-review-2026-08-13` scores as high
as a token does. What separates them is the delimiters. The longest unbroken run in that slug is
nine characters, while an AWS key is 20 and a DSN key 32.

**Integrity digests.** `sha512-<base64>`, as every npm lockfile is made of. This is the hex
exclusion's missing half: without it, one lockfile produces most of a tree's high-entropy findings.
An SRI hash is a *public* checksum, published in the registry and meant to be shared.

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

A scanner that alarms at its own test fixtures teaches everyone to ignore it, and a scanner's test
file is full of synthetic keys that exist so the scanner can find them. A file may therefore declare itself a synthetic corpus by carrying `secrets-sweep-fixture`
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

`bin/secrets-canary.mjs` and `bin/test/secrets-sweep.test.mjs` carry the declaration. This document
deliberately does **not**: quoting credentials is its subject, so it is the file most likely to
acquire a genuinely quoted example one day, and its standing findings keep it watched.

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
`https://<key>@example.com/…` has a fake hostname and may still carry a live key. So the placeholder
test reads the credential substring only.
Reading the whole match would let any secret hide behind a demo hostname.

**Binding outranks placeholder**, and `token: CW_TEST_TOKEN` is why: that value is an environment
variable name — letters joined by underscores — so it satisfies the word-join placeholder heuristic
too. Both downgrades are correct, but if a value is syntactically a reference then it is not
credential material at all, and asking whether it looks fake is a category error.

## Two traps this method was built around

**The C-locale grep trap.** Under a C locale, `grep` silently suppresses matches in UTF-8-dense
files. It does not warn; it reports no match, and whoever ran it relays that as fact. If you grep by
hand during triage, use `grep -a` or set a UTF-8 locale. `bin/secrets-sweep.mjs` reads bytes through Node
and never shells out to grep, precisely so the tool does not inherit the failure it documents.

**Audit documents quote what they audit.** Evidence means quoting, and a finding about a leaked
credential contains the credential. Every audit artefact is therefore a leak channel *by
construction*, and an audit record exists to be read by someone outside the work. A credential
reaches one through a diligent reviewer quoting it as proof.

## The instrument: measuring the scanner

```sh
node bin/secrets-canary.mjs            # 5 scenarios, truth by construction
node bin/secrets-canary.mjs --json --write
```

`bin/test/secrets-sweep.test.mjs` proves each rule fires on a line. That is not the same as proving
the tool still finds a planted corpus in a tree: a rule set that reports hundreds of false positives
passes any "does it exit non-zero" check while being useless.
A scanner that has never been observed to fail is not a scanner known to work.

**The assertion is class AND count, never "nonzero".** Each scenario states exactly how many
findings of exactly which classes must come back. Reporting 6 of 7 is a false clean about one
specific rule, and an exit-code check cannot see it — the run still exits 1 and still looks like a
success.

Both halves go red against a deliberately broken scanner:

| Injected defect | S-EACH (class present?) | S-DUP (count right?) | canary exit |
| --- | --- | --- | --- |
| DSN rule disabled | ✖ miss: planted 1, reported 0 | ✖ miss: planted 3, reported 0 | 2 |
| findings de-duplicated **by class** | ✔ every class still present | ✖ miss: planted 3, reported 1 | 2 |

In the second row, a class-only assertion scores the scanner healthy while it silently drops two of
three real leaks.

Exit codes are `0` correct · `1` false alarm · `2` **false clean** · `3` instrument broken. A miss
and an extra are kept apart deliberately: one ships credentials, the other annoys people, and
averaging them into an "accuracy" number hides the only one that matters.

Every plant is synthesized at run time under `mkdtemp` and **nothing is committed as a fixture
file**. Every credential in the corpus is fabricated.

## The gate: pre-publish, deliberately not pre-commit

```sh
node bin/pre-publish.mjs                       # the committed tree (HEAD)
node bin/pre-publish.mjs --paths dist/packet
node bin/pre-publish.mjs --ref v1.2.0 --json
```

**The leak channel is publication, not committing.** A quoted credential in a private repository
does no harm until the question becomes "can this be shown to someone", and audit records are meant
to be committed.

A pre-commit gate on sensitive context would fire on every home path and personal email in a working
tree and be disabled inside a day. That outcome is **gate theatre**: a gate that exists to be
bypassed. A gate nobody can pass is worth less than no gate, because it also costs you the belief
that gates mean anything.

This one runs on a packet — the thing actually being handed over — and it runs rarely, so it can
afford to be strict:

- **`SENSITIVE-CONTEXT` is fatal here**, where it is advisory everywhere else. A personal email is
  nothing inside the repo and is somebody's name in a funder's inbox.
- **Fixture self-declarations are ignored.** A file may exempt itself from the daily sweep; it does
  not get to exempt itself from the thing that ships.
- **The committed tree is scanned by default**, not the working copy.

**Run it on the packet, not on the source tree.** This posture has no allowlist and ignores fixture
declarations by design, and commitwork ships detection rules, a canary corpus and fixtures that
assert on synthetic credentials. Over the whole source tree it therefore cannot reach zero without
reviewed dispositions, and a gate that cannot go green is one readers learn to skip. Its designed
surface is `--paths <packet>`: the export that ships, not the tree that builds it. A red run over
the source tree is not, by itself, a release blocked on secrets.

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

## What is deliberately not done

- **A history walker in Node.** gitleaks already reads history and carries the DSN rule.
  Re-implementing pack traversal would add no coverage.
- **A pre-commit hook.** See above — that is the gate-theatre argument, and it is a decision, not
  an omission.
- **`reports/` coverage.** Gitignored, never pushed, and large.
- **A `GATE_ROSTER` entry for `secrets-sweep`.** `pre-publish` is on the roster, with a registry
  mapping, so `journalHealth` reports it and the sampler classifies its verdicts. `secrets-sweep`
  deliberately never journals: it is a scanner a caller may run ad hoc, and the ledger hears about
  secrets only through `pre-publish`'s verdicts. `bin/test/gate-roster-registry.test.mjs` binds
  roster and registry so neither can drift alone.
- **Vendored/generated-data exclusion.** Fetched threat-intel data such as `monitor/data/kev.json`
  carries key-shaped values (32-hex `cHash=` URL parameters, mailing-list thread tokens), which
  argues for a class of "not authored here" files. Deferred rather than guessed at, because the
  same exclusion would have hidden a pasted key.

## Triage procedure

1. Run all three layers, and the history layer specifically. Do not stop at the first "clean".
2. For each candidate, classify REAL-SECRET / SENSITIVE-CONTEXT / FALSE-POSITIVE — judging the
   **credential material**, never the hostname or the filename.
3. For a REAL-SECRET: **rotate first**, scrub second. A scrubbed-but-unrotated key is a live key
   plus a lost record of which key to rotate.
4. Scrubbing an audit artefact means replacing the quoted evidence with a description of it. The
   finding survives; the credential does not. Scrubbing the worktree leaves history intact, and on GitHub a
   force-push leaves the old commits reachable by their SHA.
5. Record the sweep — what was scanned, what was NOT scanned, and the verdict per finding.
   **A list of findings without a list of what went unscanned is not a result.**

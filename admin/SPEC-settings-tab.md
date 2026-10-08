<!-- verified-against: 2026-10-06 -->
# SPEC — Settings tab (global settings) for the admin panel

> **Status: PARTLY BUILT, AND NOT AS SPECIFIED — re-scoped 2026-08-29.** The original header said
> "nothing in this document exists yet — no route, no view, no store", and that has been false for
> some time. Measured against the tree:
>
> - **§2 (the settings store and tab) IS BUILT**, with a COMPLETELY DIFFERENT key set. Route
>   `admin/routes/settings.mjs` (`GET /api/settings`, `POST /api/settings`, `POST /api/settings/rules`),
>   store `monitor/settings.mjs`, view `settings:'view-settings'` in `admin/static/panel-router.js`,
>   tests `monitor/test/settings.test.mjs` + `admin/test/settings-route.test.mjs`. Not one of the three
>   keys specified below was implemented; the twelve that exist (re-checked 2026-10-06) are
>   sweep/perf/scan/tuning/learning/report/docker settings. The shipped tab's subject is sweep thresholds, cadence and per-area override rules —
>   not documentation health.
> - **§1 (Documentation & status) is NOT BUILT.** `GET /api/docs-health` and `POST /api/status/generate`
>   appear nowhere in the panel; the only file in `admin/` naming them is this spec. The CLIs
>   (`bin/docs-doctor.mjs`, `bin/projectstatus.mjs`) exist and are what to use.
> - **§3 (Remediation sharing) is NOT BUILT.** Zero occurrences repo-wide of `/api/share`,
>   `/share/<token>`, `CW_SHARE_STORE` or `shares.json`, and the auth-gate exemption it calls the
>   most security-sensitive edit was never made.
>
> Read the sections below as the ORIGINAL PROPOSAL, not as a description of the panel. Where a
> section is marked built above, `monitor/settings.mjs` and `admin/routes/settings.mjs` are the
> authority and this text is not.
>
> Adversarially reviewed before build: a bifocal pass on 2026-07-30 (13 findings folded in; the
> review record is held privately), then an overloop
> cycle (11 ranked improvements folded in, including the 5 rated material). Build in the order the
> sections appear; the auth-gate exemption section is the most security-sensitive edit.

## Why

`admin/config.html` is deliberately **read-only** — it displays configuration owned elsewhere
(registry, retention, manifests). But three operator-facing capabilities now have no UI surface:
the documentation/status system (`bin/docs-doctor.mjs`, `bin/projectstatus.mjs`) and its one knob
(`CW_DOCS_MAX_AGE_DAYS`); a small set of genuinely global runtime toggles that today live only in
env vars; and sharing a remediation artifact outside the authenticated panel. This tab is the
place for the settings that are *operator state*, while everything owned by git-tracked config
stays read-only where it is.

## The tab

As built it is reached from the section rail's **Check schedules** link
(`data-route="settings"` in `admin/menus/section-rail.html`), filed under the fleet section by
`admin/menus/navigation.js`, and renders `#view-settings`. Loopback
remains ungated per the house rule; via the tunnel it requires a session like every other view.
(For HTML clients an unauthenticated request receives the noindex login page with 200; 401 JSON
is for non-HTML clients — tests must encode that, not a blanket 401.)

### 1 · Documentation & status

- Live doc-health table from `docs-doctor` (JSON): status dot per doc — 🟢 `#5fd08a` fresh,
  🟠 `#e8730c` needs updating, ⚪ grey unknown — path, stamp date, reasons. The same three-state
  vocabulary as the rest of the panel: explicit uncertainty.
- **[Generate status]** button → runs `bin/projectstatus.mjs` via the existing job-runner pattern,
  with running/ok/fail state inline. Refused (or queued) with 409 while a sweep job is running —
  a status generated mid-sweep bakes a torn fleet picture that is then honestly linkable later.
  Build prerequisite, met: job logs are per kind (`admin/lib/jobs.mjs` `jobLogPath()`). The sweep
  keeps `reports/sweep-latest.log`; every other kind writes `reports/<kind>-latest.log`
  (`CW_JOB_LOG_DIR`), so a status job cannot clobber a running sweep's log.
- Link to `reports/projectstatus.html` (which carries its own one-click **Download PDF**).

### 2 · Global settings

**One reader, every process.** A shared module (`monitor/settings.mjs`) resolves each key as
`env > store > default` *at call time* and returns `{value, source}`. The panel, `docs-doctor`,
`projectstatus`, `sweep` and the launchd jobs all import it — the store is never injected into
child env (that would make env and store indistinguishable downstream), and no consumer reads
`process.env` directly for these keys. This is what makes the tab's "effective value + source"
display true in the nightly launchd run too, not just in the panel's own process.

**Corruption posture (differs from auth.mjs, deliberately):** a corrupt settings store must not
kill the nightly sweep — read-side consumers **fall back to `env > default`**, warn loudly, and
report `source: "corrupt-store-fallback"` so the panel surfaces it; the write path (`POST
/api/settings`) answers 503 until the store is repaired. (auth fails closed because "no users"
would reopen the bootstrap window; settings has no such stake, so availability wins on reads.)

**The key contract as PROPOSED.** None of these three shipped. The twelve keys that exist are
`sweepHangMs`, `sweepKillMs`, `perfProfile`, `scanDepth`, `scanIntensity`, `repoTuning`, `scannerOverrides`,
`learningMode`, `learningDismissed`, `sweepCadenceMs`, `reportFormats` and `dockerRestartOnDown`
(a single-choice key: what a sweep does when the docker daemon is down — the panel renders it as
a dropdown from the key's declared options) — see `SETTING_KEYS` in
`monitor/settings.mjs`, which is the whitelist that is actually enforced:

| key | env var | type / range | default | consumers |
|---|---|---|---|---|
| `docsMaxAgeDays` | `CW_DOCS_MAX_AGE_DAYS` | integer 1–365 | 30 | docs-doctor, projectstatus |
| `overwatchExport` | `SUBSTRATE_EXPORT` | boolean | true | sweep → export-overwatch |
| `mapRefresh` | `MAP_REFRESH` | boolean | false | sweep → modernization/map render |

A write to a key currently shadowed by an env var is refused with **409 "shadowed by `CW_…`"**
naming the variable — a 200 that changes nothing observable is the tab lying. Unknown key or
out-of-range value → 400.

Read-only display (owned by git-tracked files; a web edit would fork the truth): registry/areas,
retention, manifests, scanner roster, launchd schedule. The existing "Allow external sign-in"
toggle stays in the auth menu; the tab links to it rather than adding a second write path to the
auth store.

### 3 · Remediation sharing — [copy link]

The **[copy link]** / **[publish snapshot…]** affordances live on the artifact rows in the
**Remediation** tab (where the artifacts render); the Settings tab hosts the management view — an
**Active shares** table: artifact, project, mint date, indexable badge, revoke button (addressed
by record hash, see below).

- **[copy link]** — copies the *authenticated* panel URL. Useful to another operator; an
  unauthenticated visitor gets the login page (HTML) or 401 (JSON), never the content. Default
  affordance, no confirmation.
- **[publish snapshot…]** — publishing security findings is a deliberate act, so it is
  **server-enforced step-up**, not a client-side dialog: `POST /api/share/confirm` with a fresh
  TOTP code → one-time confirm-nonce → `POST /api/share` consumes the nonce. (The panel renders
  scanner-derived content under a CSP that is report-only with `unsafe-inline`, so a client-side
  confirmation alone would let any panel XSS mint a public capability URL and exfiltrate
  findings. The same step-up applies to flipping indexability and to revocation-free re-mints.)
  It mints a **static point-in-time snapshot** rendered via `bin/render-report.mjs` at a
  capability URL `/share/<token>`, served unauthenticated.

**Step-up identity.** The confirm verifies the TOTP code against **the session's account**, and
the code is **single-use — burned through the existing `verifyTotp` + `lastTotpStep` guard under
the auth-store lock** (a sanctioned reuse of auth.mjs's existing write path, not a new one; an
unburned code would let one shoulder-surfed code serve both a login and a publish). SSO-only
accounts (no `totpSecret` by design) step up by **re-completing the provider flow**; if the
provider is unavailable, publish is refused with a message saying exactly that. On loopback there
may be no session: publish from loopback still requires step-up against the sole enrolled
account; if the store has zero users, **publish is refused** — a box that has never enrolled an
operator has no one to attribute a publication to. Failed confirms are throttled: 5 failures →
60 s lockout per session/source (the confirm endpoint must not be a TOTP oracle; auth.mjs has no
rate limiting elsewhere, so this route brings its own).

**The confirm-nonce.** Bound to `{action, artifact-or-tokenHash}` at mint — a nonce issued for
"publish client-a remediation" is refused on `/indexable` (an unbound nonce would move the
escalation one step sideways). TTL ≤ 5 minutes, single-use enforced at consume, held **in
memory** (a panel restart voids pending nonces — fail-safe, and said out loud so a builder
doesn't persist them).

**The token.** ≥128 bits from `crypto.randomBytes`, URL-safe encoding; the store keys records by
**SHA-256 of the token**. `GET /share/<token>` validates format (length/charset) *before*
hashing and answers 404 on malformed input. Management routes are addressed by **record hash**
(`POST /api/share/by-hash/<tokenHash>/indexable`, `DELETE /api/share/by-hash/<tokenHash>`) —
they sit behind auth + CSRF, and the hash is not a capability, so this closes the contradiction
between hash-only storage and token-addressed management. The plaintext token is retained in the
record **only while `indexable: true`** (those URLs are public by deliberate choice and the
sitemap must be able to emit them); for non-indexable records the token is unrecoverable from
the store.

**Mint-side validation.** `artifact` is an enum (`remediation` | `projectstatus`), `project` is
validated against known area slugs (same rule as the sweep trigger); anything else 400 — the
artifact name must never reach the renderer as a path.

**Snapshot honesty over time**: the snapshot bakes its slice id and **mint date**, and computes
its own age client-side (inline JS, self-contained) — a baked "2 days old" banner would itself go
stale. explicit uncertainty footer carries over.

**Snapshot response contract.** The blob is fully **self-contained** (inline CSS/JS, no
subresource requests — a panel-relative asset fetched unauthenticated would get the login page)
and served with `Content-Type: text/html; charset=utf-8`, `X-Content-Type-Options: nosniff`, and
a strict CSP (`default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'` — the
minimum its inline age script needs; it renders scanner-derived content, the same
attacker-influenced text that justified step-up).

**Indexability**: `noindex` by default via `X-Robots-Tag` **at serve time from the token record**
— the blob is never rewritten, so snapshot immutability holds. Ticking **"allow search engines to
index"** (step-up confirmed, exposure named in plain words) flips the record; `/share/sitemap.xml`
is derived live from `indexable && !revoked` tokens only, so un-flipping or revoking removes the
entry automatically.

**Revocation**: tombstones, not deletion. The token hash stays in the index with
`state: revoked` → `GET` answers **410**; an unknown token answers **404** (the two must be
distinguishable, which deletion cannot provide). The **blob is deleted on revoke** (the tombstone
+ log keep the 410 truthful), and the **active-mint cap counts `state: active` records only** —
tombstones kept forever must not wedge minting. Revocations are *also* appended to an append-only
`share-revocations.log` consulted at serve time, so restoring the share index from a backup
cannot silently resurrect a revoked link.

## Storage

Two stores, separated on purpose (blast-radius isolation — a corrupt settings file must not take
down already-published public links, and a share mint must not rewrite the settings file):

- `~/.commitwork/settings.json` — the editable globals. As built the primary env override is
  `CW_SETTINGS`, with `CW_SETTINGS_STORE` (this spec's name) accepted as a secondary; the code
  says so at `monitor/settings.mjs:32-35`.
- `~/.commitwork/shares.json` (`CW_SHARE_STORE`) — token records: token **hash** (plaintext
  retained only while indexable), artifact, project, slice id, mint date, `indexable`, `state`.
  Snapshot blobs live beside it as `~/.commitwork/shares/<tokenHash>.html` — keyed by hash so a
  directory listing never leaks a usable token. Active-mint cap: 50 active records (409 beyond
  it; a runaway minter must hit a wall).

Both follow `admin/auth.mjs` mechanics: atomic tmp+rename writes (0600), `mkdir`-lock
serialisation. Load posture differs by stake: **shares fail closed** (parse/permission error ⇒
`/share/*` answers 503 until repaired, never "open"); **settings fall back on reads** (see §2)
and refuse writes.

## API surface (non-GET covered by the blanket CSRF deny)

| Route | Purpose |
|---|---|
| `GET /api/settings` | Effective settings + per-key source provenance (via `monitor/settings.mjs`). |
| `POST /api/settings` | PROPOSED `{key, value}`; **as built the body is `{settings: {key: value}}`** (`admin/routes/settings.mjs:175`). Whitelist enforced; unknown/invalid 400; env-shadowed 409 naming the variable; corrupt store 503. The built route also has an undocumented sibling, `POST /api/settings/rules`, which has no section in this spec, and the same route file serves `GET/POST /api/integrations` and `POST /api/integrations/remove`. |
| `GET /api/docs-health` | `docs-doctor` JSON — 30 s cache + single-flight (it walks the repo; a polled endpoint must not spawn per poll). |
| `POST /api/status/generate` | Job-runner: regenerate PROJECTSTATUS; 409 while a sweep runs. |
| `GET /api/share` | Active-shares list for the management table (hashes, no plaintext tokens for non-indexable records). |
| `POST /api/share/confirm` | Fresh TOTP (or SSO re-auth) → one-time bound confirm-nonce; throttled. |
| `POST /api/share` | `{artifact, project, nonce}` → `{token, url}`; renders + stores the snapshot at mint time. **409 while a sweep/health/status job is running** — a mid-sweep mint freezes a torn artifact forever. |
| `POST /api/share/by-hash/<tokenHash>/indexable` | `{indexable, nonce}` — flips the token record only. |
| `DELETE /api/share/by-hash/<tokenHash>` | Tombstone + revocation-log append + blob delete → subsequent `GET` 410. |
| `GET /share/<token>` | Unauthenticated static blob; format-validated then hashed; `X-Robots-Tag` from record; 404 unknown/malformed / 410 revoked / 503 unreadable index. |
| `GET /share/sitemap.xml` | Derived live from `indexable && !revoked`. |

## The auth-gate exemption — the most security-sensitive edit of the build

The dispatcher is default-deny for non-loopback: both the zero-user gate and the login gate
exempt only `/auth/*` and the `PUBLIC_ASSETS` set today (the five brand files the unauthenticated
login page references — an exact-path allowlist, not a prefix). The build adds exactly one new unauthenticated prefix:
**`/share/`**, matched on the **normalized** pathname (decoded, `.`/`..` collapsed) by exact
segment — `/share/<token>` and `/share/sitemap.xml`, nothing else; query strings are ignored,
never honoured. Decision: published links **stay live when the auth store is empty or damaged** —
a capability URL to a static snapshot was published deliberately, and an auth-store reset must not
be a silent mass-unpublish (revocation is the unpublish mechanism, and the share store fails
closed independently). An acceptance test must assert `/share/` is the *only* route reachable
unauthenticated beyond today's exemptions.

## Acceptance tests that must exist before a build ships

1. Settings store: atomic write, cross-process lock (mirror `auth-lock.test.mjs`); corrupt store ⇒
   reads fall back with `source: "corrupt-store-fallback"`, writes 503.
2. `POST /api/settings`: rejects non-whitelisted keys, wrong types/ranges, and env-shadowed keys
   (409 naming the variable).
3. Effective-value parity: a child process (spawned like launchd would) resolves the same
   `{value, source}` the panel displays, for env-set, store-set, default and corrupt-store keys.
4. Share lifecycle: mint without nonce → 403; nonce minted for publish refused on `/indexable`
   (binding); confirm guess-storm throttled; TOTP code burned (replay refused); mint → fetch
   (200, noindex header, strict CSP, nosniff) → flip indexable (header changes, blob
   byte-identical, plaintext token appears in record) → revoke (410; sitemap entry gone; blob
   gone; unknown token still 404). Token unrecoverable from store for non-indexable records.
   `artifact` outside the enum / unknown `project` → 400.
5. Snapshot immutability: regenerating the underlying REMEDIATION does not change a published
   snapshot; mint during a running sweep is refused; status-generate during a sweep is refused.
6. Restore-resistance: share index restored from backup + revocation log replay ⇒ revoked stays 410.
7. Gate audit: `/share/` is the only new unauthenticated prefix; traversal/encoded-slash probes
   under `/share/` cannot escape the blob dir; snapshot subresource requests do not exist (the
   blob is self-contained).
8. CSRF: every new POST/DELETE refused without the header (the blanket deny already does this —
   the test proves nobody exempted a route).
9. SSO-only operator: publish reachable via provider re-auth; refused with the stated message
   when the provider is down. Zero-user loopback: publish refused.

## Open decisions (blocking build, not blocking spec)

- Snapshot retention: keep-forever vs auto-expire (e.g. 90 days) with the expiry printed on the
  snapshot itself. (Active-mint cap bounds growth either way.)
- Whether `PROJECTSTATUS` snapshots should ever be indexable, or only per-area remediation plans.
- Whether `/share` should be rate-limited per-IP at the panel (cloudflared already fronts it).

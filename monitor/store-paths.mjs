// Where the two private stores live. A LEAF module — it imports nothing from this repo on purpose,
// so bin/verdict-journal.mjs can ask for a path without pulling monitor/issue-store.mjs (which
// references verdict-journal, closing a cycle) and its eight transitive imports.
//
// Why this file exists at all: on 2026-08-27 the issue store had FOUR resolvers reading THREE env
// names — CW_ISSUES (issue-store, projectstatus, accept-mediator, timeline), CW_ISSUES_JSON
// (pattern-scan), CW_ISSUE_STORE (coincidence, forensics x2, store-consistency) — and one site
// with no override at all (verdict-journal). Setting CW_ISSUES to redirect the store moved four
// readers and left five reading production. They also disagreed on whether to resolve() a relative
// override, so the same value meant different files depending on cwd. One definition, or the
// divergence grows back.
//
// private/ is a DIRECTORY this operator symlinks to a private git repo (see the sidecar README).
// Both stores must survive and must not ship: issues.json is hash-chained lifecycle — regenerating
// it loses every open/close transition — and names client repositories in 415 rows; projects.json
// is the hand-maintained fleet registry with client paths and deploy scoping.
//
// A directory, never a file symlink. Both stores are written atomically (tmp+rename), and rename()
// onto a file symlink replaces the link with a regular file and orphans the target — writes keep
// succeeding into a file nobody reads. bin/test/sidecar-paths.test.mjs enforces this.

import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

// ── THE CREDENTIAL STORES ───────────────────────────────────────────────────────────────────────
// These two are NOT root-relative — they live under the operator's home, not in a repo — so they
// take no `root` and, deliberately, no `{ ambient }`. That option exists on the three below because
// a caller there names a root and an ambient env var must not outrank it; here there is no explicit
// argument for an env var to outrank, and a parameter with no meaning is worse than none.
//
// WHY THEY ARE FUNCTIONS. admin/auth.mjs and admin/integrations.mjs each held
// `export const STORE_PATH = process.env.CW_* || <home>` — resolved once at MODULE LOAD. The repo's
// own rule is that every input path is env-overridable and read at CALL time, because a load-time
// const silently defeats any test that sets the variable afterwards: the test passes while
// operating on the operator's REAL credential store. That is not hypothetical. On 2026-09-01 an
// integrations test wrote a live third-party key into the operator's actual
// ~/.commitwork/integrations.json and it sat there for about three minutes, and four separate auth
// test files carry comments explaining the workaround — a subprocess, or a dynamic import after
// setting the env — rather than the defect being fixed. An invariant documented in four places and
// enforced in none is held by convention.

/** The panel's credential store. `CW_AUTH_STORE` overrides, read at CALL time. */
export const authStorePath = () => (process.env.CW_AUTH_STORE
  ? resolve(process.env.CW_AUTH_STORE)
  : join(homedir(), '.commitwork', 'users.json'));

/** Third-party integration credentials. `CW_INTEGRATIONS_STORE` overrides, read at CALL time. */
export const integrationsStorePath = () => (process.env.CW_INTEGRATIONS_STORE
  ? resolve(process.env.CW_INTEGRATIONS_STORE)
  : join(homedir(), '.commitwork', 'integrations.json'));

/**
 * The reports tree: per-area output dirs, sweep verdict journals, in-flight markers. Gitignored, not
 * private. CW_REPORTS_ROOT overrides, read at call time. A registry may name another root
 * (monitor/area.mjs reportsRootDir); a reader with no registry takes this.
 */
export const reportsRootFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_REPORTS_ROOT) ? resolve(process.env.CW_REPORTS_ROOT) : join(root, 'reports'));

/** The private-store directory for a given repo root. */
export const privateDir = (root) => join(root, 'monitor', 'private');

/**
 * The issue store for a given repo root. Parameterised because bin/projectstatus.mjs takes --root
 * and may be aimed at another repository: it needs this subpath and this env precedence, not this
 * absolute answer.
 *
 * CW_ISSUES is canonical. CW_ISSUES_JSON and CW_ISSUE_STORE are the legacy names each of the
 * divergent resolvers used; they still work so anything outside this repo keeps running, and
 * CW_ISSUES wins when more than one is set. Read at CALL time — a module-load read silently
 * defeats the override for any test that sets it afterwards.
 */
export const issuesPathFor = (root, { ambient = true } = {}) => {
  const override = ambient
    ? (process.env.CW_ISSUES || process.env.CW_ISSUES_JSON || process.env.CW_ISSUE_STORE)
    : null;
  return override ? resolve(override) : join(privateDir(root), 'issues.json');
};

/**
 * The refutation store — contests filed against a closure, a classification, a band or a detector.
 * CW_REFUTATIONS overrides, read at call time.
 *
 * Private for the same reason issues.json is: a refutation names the finding it contests, and the
 * findings name client repositories. The contest surface opening to upstream maintainers is the
 * intended end state and will need a published projection; the store itself is not it.
 */
export const refutationsPathFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_REFUTATIONS) ? resolve(process.env.CW_REFUTATIONS) : join(privateDir(root), 'refutations.json'));

/**
 * The fleet/client registry for a given repo root. CW_REGISTRY overrides, read at call time.
 *
 * `{ ambient: false }` REFUSES the env override and answers for the root it was handed. Pass it
 * from any caller that nominated a root of its own — a test sandbox, a --root aimed elsewhere —
 * because the env override is a statement about THIS process's ambient repo, and a caller that
 * named a different root has made the more specific statement.
 *
 * Why this exists (2026-09-01): the override applied unconditionally, so `registryPathFor('/tmp/
 * sandbox')` returned the LIVE registry whenever CW_REGISTRY was set. Any session that exported
 * CW_REGISTRY to aim a tool at the real registry — an entirely reasonable thing to do — and then
 * ran the suite had its sandboxed tests WRITE into the live path. The fleet registry was
 * overwritten by a test fixture repeatedly; an operator restore survived about eighteen minutes.
 *
 * The default stays `true` deliberately. The live registry is the default path,
 * monitor/private/projects.json, and CW_REGISTRY is how an operator aims a tool that names no root
 * at a different one; refusing it there would silently read the wrong fleet. The escape closes at
 * the call sites that nominate their own root, not here.
 */
export const registryPathFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_REGISTRY) ? resolve(process.env.CW_REGISTRY) : join(privateDir(root), 'projects.json'));

/**
 * All three stores now take `{ ambient: false }`, so the class is closed rather than one member of
 * it. The registry was the LIVE case — sandboxed tests were overwriting the fleet registry through
 * it. The other two were LATENT when fixed: no test calls them with a sandbox root (verified by
 * grep across *.test.mjs), so nothing was corrupting issues.json or refutations.json.
 *
 * Fixed anyway, and not for symmetry's sake. `bin/projectstatus.mjs` takes `--root` and its own
 * comment says it "may be aimed at another repository" — so an operator running it against a second
 * checkout with CW_ISSUES exported in their shell reads and reports the FIRST repo's issue store
 * while naming the second. That is the same defect with a human in the loop instead of a test, and
 * issues.json is hash-chained lifecycle: a write there destroys open/close transitions that cannot
 * be regenerated. A latent defect in a store with no undo is worth closing before it is live.
 */

/**
 * THE REDACTION MAP, and why it belongs with the private stores rather than beside the code.
 *
 * The map pairs every real client name with its pseudonym. That is not a redaction aid, it is the
 * REVERSAL TABLE: anyone holding it can undo every substitution in every published artifact. The
 * publication boundary in CLAUDE.md names "identity/redaction maps" as permanently private and bars
 * "a map that reverses their anonymisation" — and until 2026-09-09 this file was tracked in the
 * public repository, which is that rule broken by the file most responsible for keeping it.
 *
 * Same directory as the other two private stores, so one symlink covers all three and the existing
 * `/monitor/private` ignore rule needs no companion.
 *
 * FAILS CLOSED IS THE CALLER'S JOB, and it matters more here than for the other stores. A missing
 * issue store is legitimately "no issues yet". A missing redaction map is NOT "nothing to redact" —
 * it is a publisher that cannot tell whether it is about to disclose a client, and it must refuse
 * rather than emit. `loadRedactionMap` below is the only reader that should exist; it throws on
 * absence deliberately.
 */
export const redactionMapPathFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_REDACTION_MAP)
    ? resolve(process.env.CW_REDACTION_MAP)
    : join(privateDir(root), 'release-redactions.json'));

/**
 * The project status document. It tabulates the fleet's areas and finding counts, so it is an
 * operational record and lives beside the stores it summarises. CW_PROJECTSTATUS_OUT overrides.
 */
export const projectStatusPathFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_PROJECTSTATUS_OUT)
    ? resolve(process.env.CW_PROJECTSTATUS_OUT)
    : join(privateDir(root), 'PROJECTSTATUS.md'));

/**
 * The audit corpus: findings passes, queue.json, dispositions, the anchor-staleness report and the
 * `baseline` commit the audit read. Audit output quotes the repositories it audits, so it is
 * private; the operator's private dir links `audit` to the current cycle. CW_AUDIT_DIR overrides.
 */
export const auditDirFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_AUDIT_DIR) ? resolve(process.env.CW_AUDIT_DIR) : join(privateDir(root), 'audit'));

/**
 * The pre-rewrite to rewritten commit map read by bin/resolve-sha.mjs. It indexes private history,
 * so it is private too. CW_COMMIT_MAP overrides.
 */
export const commitMapPathFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_COMMIT_MAP)
    ? resolve(process.env.CW_COMMIT_MAP)
    : join(privateDir(root), 'commit-map-2026-08.txt'));

/**
 * The map read by lib/external-write.mjs. Projected from the sidecar ledger's `external` boundary;
 * a reversal table, so it lives with the private stores and never in the public tree.
 */
export const externalMapPathFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_EXTERNAL_REDACTIONS)
    ? resolve(process.env.CW_EXTERNAL_REDACTIONS)
    : join(privateDir(root), 'external-redactions.json'));

// ── CUSTOMER AND FLEET RECORDS ───────────────────────────────────────────────────────────────────
// Each names customer repositories, images, products or the operator's own estate, so each lives in
// the private dir (publication boundary, 2026-09-07). One env override per record, read at CALL
// time; `{ ambient: false }` refuses it, as above. A public checkout has no private dir: every
// reader treats ENOENT as the record's documented absent state and anything else as a failure.
const privateRecord = (envName, name) => (root, { ambient = true } = {}) =>
  ((ambient && process.env[envName]) ? resolve(process.env[envName]) : join(privateDir(root), name));

/** Finding annotations: dependency waivers and scanner adjudications. CW_ANNOTATIONS. Absent = none. */
export const annotationsPathFor = privateRecord('CW_ANNOTATIONS', 'annotations.json');

/** Where per-area editorial sidecars (security-annotations.<area>.json) live. CW_SECURITY_ANNOTATIONS_DIR. */
export const areaAnnotationsDirFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_SECURITY_ANNOTATIONS_DIR) ? resolve(process.env.CW_SECURITY_ANNOTATIONS_DIR) : privateDir(root));

/** Gate exemptions overlay. CW_GATE_EXEMPTIONS. Absent = no exemption in force. */
export const gateExemptionsPathFor = privateRecord('CW_GATE_EXEMPTIONS', 'gate-exemptions.json');

/** Intentional-stub allowlist for bin/stub-detect.mjs. CW_STUB_ALLOWLIST. Absent = nothing allowed. */
export const stubAllowlistPathFor = privateRecord('CW_STUB_ALLOWLIST', 'stub-allowlist.json');

/** Accepted infra-image CVEs. CW_IMAGE_ACCEPTANCE. Absent = nothing accepted. */
export const imageAcceptancePathFor = privateRecord('CW_IMAGE_ACCEPTANCE', 'image-acceptance.json');

/** The config-correctness ledger. CW_CONFIG_CORRECTNESS_LEDGER. No runtime reader. */
export const configCorrectnessLedgerPathFor = privateRecord('CW_CONFIG_CORRECTNESS_LEDGER', 'config-correctness-ledger.json');

/** Per-repo owner defaults for the rollup. CW_OWNER_MAP. Absent = no owner overlay. */
export const ownerMapPathFor = privateRecord('CW_OWNER_MAP', 'owner-map.json');

/** The modernization programme worklist. CW_PROGRAM_WORKLIST. Absent = no programmes. */
export const programWorklistPathFor = privateRecord('CW_PROGRAM_WORKLIST', 'program-worklist.json');

/** Operator-held BOLA manifests, one <name>.json each. CW_BOLA_MANIFEST_DIR. */
export const bolaManifestDirFor = privateRecord('CW_BOLA_MANIFEST_DIR', 'bola');

/** The CRA product registry. CW_PRODUCTS. Absent = CRA tools refuse with "not configured". */
export const craProductsPathFor = privateRecord('CW_PRODUCTS', 'cra-products.json');

/** Blast radius of the credentials this operator holds. CW_CRED_SCOPE. Absent = lens reports unknown. */
export const credentialScopePathFor = privateRecord('CW_CRED_SCOPE', 'credential-scope.json');

/** Full EPSS triples for the fleet's CVEs; its keys are the fleet's CVE set. CW_EPSS_DETAIL. */
export const epssDetailPathFor = privateRecord('CW_EPSS_DETAIL', 'epss-detail.json');

/** Draft and hidden docsite documents: manifest.json + content/ + imported/ + pages/. CW_DOCSITE_PRIVATE. */
export const privateDocsiteDirFor = privateRecord('CW_DOCSITE_PRIVATE', 'docsite');

/** Warnings an operator saw and set aside (monitor/disregarded-warnings.mjs). CW_DISREGARDED_WARNINGS. Absent = none set aside. */
export const disregardedWarningsPathFor = privateRecord('CW_DISREGARDED_WARNINGS', 'disregarded-warnings.json');

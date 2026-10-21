// Where the two private stores live. A LEAF module — it imports nothing from this repo on purpose,
// so bin/verdict-journal.mjs can ask for a path without pulling monitor/issue-store.mjs (which
// references verdict-journal, closing a cycle) and its eight transitive imports.
//
// One definition per store: resolvers that read different env names, or resolve a relative
// override differently, let one override move some readers and leave the rest reading production.
//
// private/ is a DIRECTORY the operator can symlink to a private git repo. Both stores must survive
// and must not ship: issues.json is hash-chained lifecycle — regenerating it loses every open/close
// transition — and names scanned repositories; projects.json is the hand-maintained fleet registry
// with paths and deploy scoping.
//
// A directory, never a file symlink. Both stores are written atomically (tmp+rename), and rename()
// onto a file symlink replaces the link with a regular file and orphans the target — writes keep
// succeeding into a file nobody reads. bin/test/sidecar-paths.test.mjs enforces this.
//
// env, read at call time: CW_STATE_DIR (the state root for this tree: its operator records live at
// <state root>/monitor/private, <state root>/reports and <state root>/.claude/store),
// XDG_DATA_HOME (an installed tree's state root is $XDG_DATA_HOME/commitwork when
// ~/.commitwork/state does not exist)

import { lstatSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ── WHERE OPERATOR STATE LIVES ─────────────────────────────────────────────────────────────────────
// An installed tree is replaceable, so its operator records live outside it. The state root mirrors
// the tree's paths (STATE_PATHS): every default below is join(stateBaseFor(root), <its old path>),
// and bin/install.sh moves an old install's records by relative path.
//
//   1. CW_STATE_DIR, only for the tree this module was loaded from. A root a caller names (a test
//      sandbox, a --root elsewhere) answers for itself, so an exported CW_STATE_DIR cannot pull a
//      sandboxed test into live state.
//   2. A tree holding INSTALL_MARKER: ~/.commitwork/state, or $XDG_DATA_HOME/commitwork when
//      XDG_DATA_HOME is absolute and ~/.commitwork/state does not exist. Keyed on the state dir, not
//      ~/.commitwork, which init creates for the credential stores. Both present is refused.
//   3. Otherwise a development checkout: the tree itself, with monitor/private as it is there.

/** The file bin/install.sh writes at the root of every tree it installs. */
export const INSTALL_MARKER = '.commitwork-install';

/** The in-tree paths of operator state, relative to the tree and to the state root alike. */
export const STATE_PATHS = Object.freeze(['monitor/private', 'reports', '.claude/store']);

const OWN_TREE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ENOTDIR as well as ENOENT: a root that is not a directory cannot hold the marker.
const statOrNull = (fn, p) => {
  try { return fn(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
};

/** True when bin/install.sh wrote `root`. Any read failure but absence throws. */
export const isInstalledTree = (root) => {
  const marker = join(root, INSTALL_MARKER);
  const st = statOrNull(statSync, marker);
  if (!st) return false;
  if (!st.isFile()) throw new Error(`${marker} exists and is not a file, so whether ${root} is an installed tree is unknown`);
  return true;
};

/** The default state root of an installed tree (rule 2 above). */
export const installedStateRoot = () => {
  const dot = join(homedir(), '.commitwork', 'state');
  const xdg = process.env.XDG_DATA_HOME;
  if (!xdg || !isAbsolute(xdg)) return dot;
  const alt = join(xdg, 'commitwork');
  if (alt === dot) return dot;
  const hasDot = statOrNull(lstatSync, dot) !== null;
  if (hasDot && statOrNull(lstatSync, alt) !== null) {
    throw new Error(`two state roots exist, ${dot} and ${alt} (XDG_DATA_HOME); set CW_STATE_DIR to the one holding this install's records`);
  }
  return hasDot ? dot : alt;
};

/** The state root for `root`, or null for a development checkout that keeps its records in the tree. */
export const stateRootFor = (root) => {
  if (process.env.CW_STATE_DIR && resolve(root) === OWN_TREE) return resolve(process.env.CW_STATE_DIR);
  return isInstalledTree(root) ? installedStateRoot() : null;
};

/** The directory every operator-record default joins its in-tree path onto. */
export const stateBaseFor = (root) => stateRootFor(root) ?? root;

// ── THE CREDENTIAL STORES ───────────────────────────────────────────────────────────────────────
// These two are NOT root-relative — they live under the operator's home, not in a repo — so they
// take no `root` and, deliberately, no `{ ambient }`. That option exists on the three below because
// a caller there names a root and an ambient env var must not outrank it; here there is no explicit
// argument for an env var to outrank, and a parameter with no meaning is worse than none.
//
// WHY THEY ARE FUNCTIONS. Every input path is env-overridable and read at CALL time: a load-time
// const silently defeats any test that sets the variable afterwards, and the test then operates on
// the operator's REAL credential store.

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
  ((ambient && process.env.CW_REPORTS_ROOT) ? resolve(process.env.CW_REPORTS_ROOT) : join(stateBaseFor(root), 'reports'));

/** The private-store directory for a given repo root. */
export const privateDir = (root) => join(stateBaseFor(root), 'monitor', 'private');

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
 * findings name scanned repositories. The contest surface opening to upstream maintainers is the
 * intended end state and will need a published projection; the store itself is not it.
 */
export const refutationsPathFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_REFUTATIONS) ? resolve(process.env.CW_REFUTATIONS) : join(privateDir(root), 'refutations.json'));

/**
 * The fleet registry for a given repo root. CW_REGISTRY overrides, read at call time.
 *
 * `{ ambient: false }` REFUSES the env override and answers for the root it was handed. Pass it
 * from any caller that nominated a root of its own — a test sandbox, a --root aimed elsewhere —
 * because the env override is a statement about THIS process's ambient repo, and a caller that
 * named a different root has made the more specific statement.
 *
 * Why: an unconditional override makes `registryPathFor('/tmp/sandbox')` return the LIVE registry
 * whenever CW_REGISTRY is set, so a suite run from a shell that exported CW_REGISTRY to aim a tool
 * at the real registry has its sandboxed tests WRITE into the live path.
 *
 * The default stays `true` deliberately. The live registry is the default path,
 * monitor/private/projects.json, and CW_REGISTRY is how an operator aims a tool that names no root
 * at a different one; refusing it there would silently read the wrong fleet. The escape closes at
 * the call sites that nominate their own root, not here.
 */
export const registryPathFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_REGISTRY) ? resolve(process.env.CW_REGISTRY) : join(privateDir(root), 'projects.json'));

/**
 * All three stores take `{ ambient: false }`. `bin/projectstatus.mjs` takes `--root` and may be
 * aimed at another repository, so an operator running it against a second checkout with CW_ISSUES
 * exported would otherwise read and report the FIRST repo's issue store while naming the second.
 * issues.json is hash-chained lifecycle: a write there destroys open/close transitions that cannot
 * be regenerated.
 */

/**
 * THE REDACTION MAP, and why it belongs with the private stores rather than beside the code.
 *
 * The map pairs every real name with its pseudonym. That is not a redaction aid, it is the
 * REVERSAL TABLE: anyone holding it can undo every substitution in every published artifact, so it
 * is permanently private and never tracked.
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
 * The failure taxonomy's mitigation layers for products that are NOT this one.
 *
 * The register records classes observed across the maintainer's own tooling, and naming those tools
 * is what makes a record auditable — but the tool list is configuration about a private fleet, so
 * the tracked registry carries only commitwork's layer and the rest live here. An ABSENT overlay is
 * the public shape, where the page shows commitwork's records as the sample.
 * CW_TAXONOMY_MITIGATIONS overrides.
 */
export const taxonomyMitigationsPathFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_TAXONOMY_MITIGATIONS)
    ? resolve(process.env.CW_TAXONOMY_MITIGATIONS)
    : join(privateDir(root), 'taxonomy-mitigations.json'));

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
// the private dir (publication boundary). One env override per record, read at CALL
// time; `{ ambient: false }` refuses it, as above. A public checkout has no private dir: every
// reader treats ENOENT as the record's documented absent state and anything else as a failure.
const privateRecord = (envName, name) => (root, { ambient = true } = {}) =>
  ((ambient && process.env[envName]) ? resolve(process.env[envName]) : join(privateDir(root), name));

/** The branch-protection expected set (repos, required checks, requireSigned). CW_BRANCH_PROTECTION. Absent = not applicable. */
export const branchProtectionPathFor = privateRecord('CW_BRANCH_PROTECTION', 'branch-protection.json');

/** WCAG attestations a person signed (monitor/a11y-attestations.mjs, append-only). CW_A11Y_ATTESTATIONS. Absent = none. */
export const a11yAttestationsPathFor = privateRecord('CW_A11Y_ATTESTATIONS', 'a11y-attestations.json');

/** Finding annotations: dependency waivers and scanner adjudications. CW_ANNOTATIONS. Absent = none. */
export const annotationsPathFor = privateRecord('CW_ANNOTATIONS', 'annotations.json');

/** Where per-area editorial sidecars (security-annotations.<area>.json) live. CW_SECURITY_ANNOTATIONS_DIR. */
export const areaAnnotationsDirFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_SECURITY_ANNOTATIONS_DIR) ? resolve(process.env.CW_SECURITY_ANNOTATIONS_DIR) : privateDir(root));

/** Per-repository CodeQL data extensions, <dir>/<repo>/*.yml (bin/codeql-model-pack.mjs). CW_CODEQL_MODELS.
 *  Absent = no repository declares its own sources or sinks. */
export const codeqlModelsDirFor = privateRecord('CW_CODEQL_MODELS', 'codeql-models');

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

/** The CRA Article 14 case log, hash-chained (cra/lib.mjs updateCases). CW_CASES. Absent = no case opened. */
export const craCasesPathFor = privateRecord('CW_CASES', 'cra-cases.json');

/** Which LLM hosts are on, their models and role assignments (monitor/llm-runtime.mjs). CW_LLM_RUNTIME. Absent = every host off. */
export const llmRuntimePathFor = privateRecord('CW_LLM_RUNTIME', 'llm-runtime.json');

/** Blast radius of the credentials this operator holds. CW_CRED_SCOPE. Absent = lens reports unknown. */
export const credentialScopePathFor = privateRecord('CW_CRED_SCOPE', 'credential-scope.json');

/** Full EPSS triples for the fleet's CVEs; its keys are the fleet's CVE set. CW_EPSS_DETAIL. */
export const epssDetailPathFor = privateRecord('CW_EPSS_DETAIL', 'epss-detail.json');

/** Draft and hidden docsite documents: manifest.json + content/ + imported/ + pages/. CW_DOCSITE_PRIVATE. */
export const privateDocsiteDirFor = privateRecord('CW_DOCSITE_PRIVATE', 'docsite');

/** Warnings an operator saw and set aside (monitor/disregarded-warnings.mjs). CW_DISREGARDED_WARNINGS. Absent = none set aside. */
export const disregardedWarningsPathFor = privateRecord('CW_DISREGARDED_WARNINGS', 'disregarded-warnings.json');


/** Actions refused under unattended posture C, one JSON line each (lib/security-posture.mjs). CW_APPROVAL_QUEUE. Absent = nothing refused yet. */
export const approvalQueuePathFor = privateRecord('CW_APPROVAL_QUEUE', 'approval-queue.jsonl');

/** Dependency-update lifecycle events, one JSON line each (bin/lib/deps-ledger.mjs). CW_DEPS_LEDGER. Absent = nothing recorded yet. */
export const depsLedgerPathFor = privateRecord('CW_DEPS_LEDGER', 'deps-ledger.jsonl');

/**
 * The nondeterministic store (monitor/nondeterministic-store.mjs). Its divergence subjects name a
 * fleet repository and file, and it must stay outside the reports root the rollup enumerates.
 * CW_NONDET_STORE. Absent = nothing recorded.
 */
export const nondetStoreDirFor = privateRecord('CW_NONDET_STORE', 'nondeterministic');

/**
 * The relation store bin/graph.mjs builds. A projection of the issue store, registry and rollups, so
 * it holds fleet data and lives under the reports root, never in the tree. CW_GRAPH_DB overrides.
 */
export const graphDbPathFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_GRAPH_DB)
    ? resolve(process.env.CW_GRAPH_DB)
    : join(reportsRootFor(root, { ambient }), 'graph', 'graph.db'));

/**
 * Injection-shaped text the MCP job tools saw (mcp/emission-ledger.mjs): hash-chained JSONL, one row
 * per signal, carrying a hash of the matched text and never the text. CW_MCP_EMISSIONS. Absent =
 * nothing recorded yet.
 */
export const mcpEmissionsPathFor = privateRecord('CW_MCP_EMISSIONS', 'mcp-emissions.jsonl');

/**
 * Where MCP job records outlive the server process that ran them (mcp/jobs.mjs), one file per
 * process. A record names the repository a client asked to scan, so it lives under the reports root,
 * never in the tree. CW_MCP_JOB_STORE overrides.
 */
export const mcpJobStoreDirFor = (root, { ambient = true } = {}) =>
  ((ambient && process.env.CW_MCP_JOB_STORE)
    ? resolve(process.env.CW_MCP_JOB_STORE)
    : join(reportsRootFor(root, { ambient }), 'mcp-jobs'));

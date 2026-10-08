// Issue identity: ISS-<ORG>-<CLASS>-<SUFFIX>, e.g. ISS-PORTLL-S-000000.
// Readers must accept BOTH this and the legacy flat ISS-000000; only MINTING is new-format-only.

import { ordinalToSuffix } from './cwx-registry.mjs';

/** The historical flat format. Still valid — 14 issues and 20 chained events carry it. */
export const ISS_RE_LEGACY = /^ISS-[0-9A-Z]{6}$/;
/** The org-scoped format. */
export const ISS_RE_SCOPED = /^ISS-[A-Z0-9]{1,12}-[SFUDC]-[0-9A-Z]{6}$/;
/** Either. Use this anywhere that reads — validation of history must not reject history. */
export const ISS_RE_ANY = new RegExp(`(?:${ISS_RE_LEGACY.source})|(?:${ISS_RE_SCOPED.source})`);

// One character is a valid org — a solo developer is an organisation of one
export const ORG_RE = /^[A-Z0-9]{1,12}$/;

// Tenant for an undeclared store. The org inside a minted id is permanent — declaring a real org
// later is a migration (`bin/issue-rekey.mjs --org <SLUG> --write`).
export const DEFAULT_ORG = 'PERSONAL';

/** Issue classes. `C` is provisional by design — a customer-raised report is re-classed at triage. */
export const CLASS = Object.freeze({
  S: 'security',
  F: 'functionality',
  U: 'user-experience',
  D: 'data',
  C: 'customer-raised',
});

/** Scanner category -> class. Explicit, deliberately not defaulted — an undeclared category throws. */
export const CLASS_FOR_CATEGORY = Object.freeze({
  // Two vocabularies land in `source.tool` and both must be covered: rollup categories
  // (kind:'scanner-row') and dependency tool names (kind:'finding').
  osv: 'S',
  npm: 'S',
  sast: 'S',
  deps: 'S',

  depsJvm: 'S',
  depsGo: 'S',
  depsRetire: 'S',
  sastSemgrep: 'S',
  sastCodeql: 'S',
  sastCodeqlJava: 'S',
  sastGo: 'S',
  iac: 'S',
  supplyChain: 'S',
  supplyChainHeuristic: 'S',
  maliciousPackages: 'S',
  secrets: 'S',
  secretsBetterleaks: 'S',
  secretsHistory: 'S',
  dast: 'S',
  bola: 'S',
  dockerfile: 'S',
  tlsHeaders: 'S',
  apiFuzz: 'S',
  cspm: 'S',
  // Added 2026-08-22 with the lanes themselves. Omitting them was a live break, not a cosmetic gap:
  // classFor() THROWS on an undeclared category, so issue ingest failed outright with "no class
  // declared for scanner category 'supplyChainPosture'" until a co-session surfaced it. Every new
  // rollup category must land here in the same commit as the category.
  supplyChainPosture: 'S',
  depsReachability: 'S',
  gradleWrapper: 'S',
  sastCodeqlPython: 'S',
  sastCodeqlRuby: 'S',
  actionsPosture: 'S',

  accessibility: 'U',   // WCAG conformance is a user-experience determination, not a security one.

  // Lint/type gates are about whether the code WORKS, not whether it is attackable.
  denoLint: 'F',
  denoTypes: 'F',
  stubs: 'F',           // an unimplemented path is a functionality gap that masquerades as done
  weakRandom: 'S',      // a guessable credential is a security finding. Not 'F': the algorithm works exactly as written, and that is the problem
  minifiedCode: 'S',    // unreadable code capable of hidden execution is a security surface
  mainframeSecrets: 'S',
  cobolCoverage: 'U',   // what a scan did not read is a coverage determination, not a security one

  // Added 2026-08-25, and the note four blocks up did not hold: THIRTEEN categories had reached the
  // registry without a class, so issue ingest threw for every finding in any of them
  // (monitor/issue-store.mjs:395 mints every id through classForIssue). The same break as
  // 2026-08-22, four times the size, and again found by measuring rather than by anything failing
  // loudly. monitor/test/category-class-completeness.test.mjs now pins it, which is the part that
  // was missing both times — the rule was written down and nothing enforced it.
  sastCodeqlCpp: 'S',
  sastCCppcheck: 'S',
  sastCFlawfinder: 'S',
  sastCodeqlSwift: 'S',
  sastCodeqlCsharp: 'S',
  sastCodeqlRust: 'S',
  sastCodeqlGo: 'S',
  depsRustAudit: 'S',
  lintHaskell: 'S',
  sastAuto: 'S',
  sastJoern: 'S',         // code-property-graph engine; same axis as the other SAST lanes
  sastBearer: 'S',
  sastElixir: 'S',        // Sobelow — a security scanner for Phoenix
  vendorAssets: 'S',      // a vendored vulnerable library is depsRetire's problem by another route
  depsGradleDeclared: 'S',

  // Lint gates, by this file's own rule above: about whether the code WORKS, not whether it is
  // attackable. shellcheck and actionlint both find real bugs and neither is a security determination
  // — zizmor is, and it is actionsPosture:'S'. If a lane author disagrees for their own lane, this is
  // the line to change, and the class is a judgement I made for them rather than one they declared.
  lintRust: 'F',          // clippy
  formatRust: 'F',        // rustfmt
  lintGo: 'F',            // golangci-lint — gosec holds the Go SECURITY axis, this one does not
  lintHaskell: 'F',       // hlint
  actionsLint: 'F',
  shellLint: 'F',
  // The Python/Ruby/PHP lanes reached SCANNER_SPECS without a class and classForCategory THROWS,
  // so issue ingest has been broken at HEAD for any finding in these five. Their own commits were
  // not closed over this file. Landed here because nobody was holding the repair — see the message.
  sastPython: 'S',
  lintPython: 'F',
  sastBrakeman: 'S',
  depsBundlerAudit: 'S',
  sastPhp: 'S',
  sastPhpPsalm: 'S',
  lintJava: 'F',          // PMD — sastCodeqlJava holds the Java SECURITY axis, this one does not

  // An exported component reachable by any app on the device, a debuggable build, cleartext
  // permitted: attack surface, so 'S' rather than the 'F' the lint lanes above carry.
  mobileManifest: 'S',

  // TLS verification off, a cipher with no IV, a template bypassing its own escaping: all
  // attack surface, so 'S'. The lint lanes above are 'F' because they ask whether code WORKS.
  nodeHazards: 'S',
  sastCobol: 'S',

  // An install hook that fetches and executes, a registry package with no integrity hash, an
  // installed tree that disagrees with its lockfile: the dependency content is the attack surface.
  depsContent: 'S',

  // A directive hidden in the file an agent obeys is the agentic attack surface itself.
  agentInstructions: 'S',
  // An undeclared machine author or an unsigned commit where signing is expected is a trust
  // question about the history itself, not about whether the code works: 'S'.
  commitProvenance: 'S',
  // A remote MCP server, a hook that shells out, an unbounded tool grant, a credential in an env
  // block: the surface an agent acts through, so 'S'.
  agentConfig: 'S',
  commitVelocity: 'S',  // machine-speed commit/CI/secret activity is an intrusion signal
  // A pickle that names os.system, a loader config carrying a template the loader renders, a hub
  // call that trusts remote code: each is an execution path into the machine that loads it.
  modelArtefacts: 'S',
  // The CI configuration is the surface that runs holding repository credentials — the same
  // reason actionsPosture is 'S'.
  actionsGaps: 'S',
  actionsHealth: 'F',
  testHermetic: 'F',
  // a toggle that makes a known CVE reachable is attack surface
  jacksonCaseInsensitive: 'S',
});

/** Class for a scanner category — throws on an undeclared one rather than guessing. */
export function classForCategory(category) {
  const c = CLASS_FOR_CATEGORY[String(category || '')];
  if (!c) {
    throw new Error(
      `issue-key: no class declared for scanner category '${category}'. Add it to CLASS_FOR_CATEGORY — ` +
      'a guessed class files the finding into a count nobody can act on.',
    );
  }
  return c;
}

/**
 * Audit-queue `kind` -> class, for the entries bin/reconcile-findings.mjs writes. Each kind names a
 * way code fails to do what it declares, so each is 'F'. `other` names nothing and is absent on
 * purpose, as is a missing kind: those entries are refused until they declare a `class`. The kind
 * says nothing about attack surface, so a security finding must carry `class: 'S'` itself.
 */
export const CLASS_FOR_QUEUE_KIND = Object.freeze({
  'missing-feature': 'F',
  erroring: 'F',
  hardcoded: 'F',
  invalid: 'F',
  incomplete: 'F',
  dead: 'F',
  stub: 'F',
});

/**
 * Class for an audit-queue entry: its own `class` when it declares one, else its `kind` through
 * CLASS_FOR_QUEUE_KIND. `{ cls: null, why }` when neither resolves; a declared class outside
 * CLASS is refused rather than overridden by the kind.
 */
export function classForQueueEntry(entry) {
  const declared = entry?.class;
  if (declared != null) {
    return Object.hasOwn(CLASS, declared)
      ? { cls: declared, why: null }
      : { cls: null, why: `class '${declared}' is not one of ${Object.keys(CLASS).join('/')}` };
  }
  const kind = entry?.kind;
  if (typeof kind === 'string' && Object.hasOwn(CLASS_FOR_QUEUE_KIND, kind)) return { cls: CLASS_FOR_QUEUE_KIND[kind], why: null };
  return { cls: null, why: `kind '${kind ?? '(none)'}' maps to no class and the entry declares none` };
}

/** Class for a whole issue. A manual/queue issue must carry its own `class` — throws, never defaults. */
export function classForIssue(issue) {
  if (!issue || typeof issue !== 'object') throw new Error('issue-key: classForIssue needs an issue');
  if (issue.class && Object.hasOwn(CLASS, issue.class)) return issue.class;
  const src = issue.source || {};
  if (src.kind === 'manual' || src.kind === 'queue') {
    throw new Error(
      `issue-key: issue ${issue.id || '(unminted)'} is ${src.kind}-sourced and carries no \`class\` — ` +
      'a non-scanner issue must declare its own class.',
    );
  }
  return classForCategory(src.tool);
}

/**
 * Build an id. `org` must already be declared — no default: an org baked into an id is permanent.
 * `suffix` (re-keying only) is carried VERBATIM — the ordinal ladder is not invertible from the
 * digits, so decode-and-re-encode silently renumbers issues.
 */
export function formatIssueId({ org, cls, ordinal, suffix }) {
  const o = String(org || '').toUpperCase();
  if (!ORG_RE.test(o)) {
    throw new Error(
      `issue-key: organisation '${org}' is not a valid slug (${ORG_RE}). Declare \`organisation\` in ` +
      'monitor/projects.json — an issue cannot be minted into an unnamed tenant.',
    );
  }
  if (!Object.hasOwn(CLASS, cls)) throw new Error(`issue-key: unknown class '${cls}' (expected one of ${Object.keys(CLASS).join('/')})`);
  if (suffix != null) {
    const s = String(suffix).toUpperCase();
    if (!/^[0-9A-Z]{6}$/.test(s)) throw new Error(`issue-key: suffix '${suffix}' is not 6 chars of [0-9A-Z]`);
    return `ISS-${o}-${cls}-${s}`;
  }
  return `ISS-${o}-${cls}-${ordinalToSuffix(ordinal)}`;
}

/** Split an id back into its parts. Returns null for the legacy flat format (it has no org/class). */
export function parseIssueId(id) {
  const m = String(id || '').match(/^ISS-([A-Z0-9]{1,12})-([SFUDC])-([0-9A-Z]{6})$/);
  return m ? { org: m[1], cls: m[2], suffix: m[3] } : null;
}

export const isLegacyId = (id) => ISS_RE_LEGACY.test(String(id || ''));
export const isScopedId = (id) => ISS_RE_SCOPED.test(String(id || ''));

// SPDX-License-Identifier: Apache-2.0
// mcp/tools.mjs — the MCP tool descriptors: name, description, input schema.
// fact: Apache-2.0 wire layer, LICENSING.md
// fact: no import from any AGPL module
// fact: server refuses on descriptor/handler mismatch

/**
 * @param {object} opts
 * @param {string[]} [opts.bundledManifests] names of the bundled manifests run_checks may run
 * @param {string[]} [opts.closedAs] the issue-close vocabulary (issue_close `as`)
 * @param {string[]} [opts.dispositions] the judgement vocabulary (issue_judge `disposition`)
 * @param {string} [opts.rescanNone] the literal that means "no re-scan" for issue_judge
 * @returns {Record<string, {name: string, description: string, inputSchema: object}>} keyed by tool name
 */
export function toolDescriptors({ bundledManifests = [], closedAs = [], dispositions = [], rescanNone = 'none' } = {}) {
  const list = [
    {
      name: 'list_products',
      description: 'List the products in the CRA registry (id, name, version, EU-market flag, mapped repos).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'coverage',
      description: 'Control-coverage for a product across CRA / SOC 2 / NIST 800-53. Returns per-control evidenced-vs-mapped status with the framework catalogue denominator (the numbers are the TECHNICAL subset commitwork maps, not full-framework coverage).',
      inputSchema: { type: 'object', properties: { product: { type: 'string' }, framework: { type: 'string', enum: ['cra', 'soc2', 'nist80053'] } }, required: ['product'], additionalProperties: false },
    },
    {
      name: 'open_cases',
      description: 'Open EU CRA Art. 14 cases (exploited-vulnerability + severe-incident) with their 24h/72h/final clocks and which clocks are overdue now.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'poam',
      description: 'FedRAMP-style POA&M summary for a product: open items (with past-due count and deviations), verified-closed count, and the top open items with their discovery-date SLA.',
      inputSchema: { type: 'object', properties: { product: { type: 'string' } }, required: ['product'], additionalProperties: false },
    },
    {
      name: 'findings',
      description: 'Open findings from the latest slice, optionally filtered by repo, minimum severity, or KEV-listed only.',
      inputSchema: { type: 'object', properties: { repo: { type: 'string' }, minSeverity: { type: 'string', enum: ['low', 'med', 'high', 'crit'] }, kevOnly: { type: 'boolean' } }, additionalProperties: false },
    },
    {
      name: 'readiness',
      description: 'High-level CRA readiness: config preflight (ready + gaps), evidence-pack freshness (current / stale / never-generated / failed / unknown) and, per product (or one via `product`), coverage evidenced/mapped per framework and open Art.14 case count.',
      inputSchema: { type: 'object', properties: { product: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'run_checks',
      description: 'PRE-FLIGHT: run a check group from a BUNDLED manifest against a repo and return structured pass/fail/skip — so an agent can gate its own commit before shipping. Only bundled manifests run (untrusted repo-local commitwork.json is refused).',
      inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'absolute path to the repo to check' }, group: { type: 'string', description: 'quick | standard | all | fast | … (default quick)' }, manifest: { type: 'string', description: `bundled manifest name (default security-baseline). One of: ${bundledManifests.join(', ')}` } }, required: ['repo'], additionalProperties: false },
    },
    {
      name: 'run_checks_start',
      description: 'run_checks without blocking: validates exactly as run_checks does, then queues the run and returns a `jobId` at once. Collect it with run_checks_result. The queue is bounded (concurrency CW_MCP_JOB_CONCURRENCY, default 1; waiting jobs CW_MCP_JOB_QUEUE, default 8); a full queue REFUSES with the reason and never drops a job. Jobs live in this server process only.',
      inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'absolute path to the repo to check' }, group: { type: 'string', description: 'quick | standard | all | fast | … (default quick)' }, manifest: { type: 'string', description: `bundled manifest name (default security-baseline). One of: ${bundledManifests.join(', ')}` } }, required: ['repo'], additionalProperties: false },
    },
    {
      name: 'run_checks_result',
      description: 'Collect a run_checks_start job: `state` is queued | running | done | failed. `done` carries a run_checks result whose gate is PASS or FAIL; `failed` carries `reason` (and `result` with gate ERROR, plus the runner log tail, when the runner got that far) — treat anything but a done PASS as not-safe. `injection` records prompt-injection-shaped text seen in the inputs and the run output: descriptive, never a severity. Finished jobs are kept for CW_MCP_JOB_RETAIN_MS (default 1 h) and at most CW_MCP_JOB_RETAIN (default 50); an expired id says so.',
      inputSchema: { type: 'object', properties: { jobId: { type: 'string', description: 'the jobId run_checks_start returned' } }, required: ['jobId'], additionalProperties: false },
    },
    {
      name: 'issues_ready',
      description: 'Ready remediation work from the issue tracker: open, unblocked, unclaimed, unwaived, no human authority required — severity-ranked, top 50. Optionally filtered to one area slug. Read-only.',
      inputSchema: { type: 'object', properties: { area: { type: 'string', description: 'area slug (e.g. commitwork)' } }, additionalProperties: false },
    },
    {
      name: 'issue_claim',
      description: 'Atomically claim an issue before working on it (TTL-bounded; an unexpired claim by another session refuses with the holder named). Pass your sessionId so your own re-claims and closes are recognised.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'ISS-XXXXXX' }, by: { type: 'string', description: 'who is doing the work' }, sessionId: { type: 'string' } }, required: ['id', 'by'], additionalProperties: false },
    },
    {
      name: 'issue_close',
      description: 'Close an issue with evidence. `fixed` is REFUSED for auto-sourced issues (finding / scanner-row) — those close on scan evidence at ingest (`node bin/issue.mjs ingest`), never by assertion; agents may close refuted/superseded with evidence. `accepted` is refused: accepting a risk is a human act. The close is recorded as a machine close on the mcp channel.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'ISS-XXXXXX' }, as: { type: 'string', enum: [...closedAs] }, evidence: { type: 'string', description: 'what you verified — a close without evidence is an assertion' }, sessionId: { type: 'string' } }, required: ['id', 'as', 'evidence'], additionalProperties: false },
    },
    {
      name: 'issue_dispositions',
      description: 'Read an issue\'s judgement state before judging it: its current subjectDigest (pin this in issue_judge), every disposition ever filed against it with who/when/why and whether each is still in force, and its greenKind — which distinguishes `scanner-clean` (a scanner proved it) from `human-green` (a person ruled on it) from `claimed-fixed` (a person says they fixed it; unproven). Read-only.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'ISS-…' } }, required: ['id'], additionalProperties: false },
    },
    {
      name: 'issue_judge',
      description: 'THE RETURN PATH: push a human judgement back at a finding — false-positive, remediated, or not-applicable — and name the re-scan that should verify it. The finding is NEVER deleted and never closed as `fixed`: the ruling is appended with who/when/why and the issue stays visible as human-greened. Suppressing rulings (false-positive / not-applicable) EXPIRE, and every ruling is invalidated automatically once the thing it judged changes (a version bump, an anchored line edit, a re-score). `remediated` does NOT suppress — it is a claim awaiting scan evidence. Identity is MANDATORY: pass `by` (you) and `authorizedBy` (the person who asked for this). An MCP ingest is recorded as MACHINE-attributed by construction, whatever names it supplies.',
      inputSchema: { type: 'object', properties: {
        id: { type: 'string', description: 'ISS-… (from issues_ready / issue_dispositions)' },
        disposition: { type: 'string', enum: [...dispositions] },
        reason: { type: 'string', description: 'why — 8..2000 printable chars; this is the evidence a person will read later' },
        rescan: { type: 'string', description: `re-scan depth — REQUIRED, no default is picked for you. A sweep group (all | fast | supply-chain | deep), a single check id, or '${rescanNone}'.` },
        expires: { type: 'string', description: 'ISO-8601 UTC. Optional; suppressing rulings get a default TTL rather than living forever.' },
        subjectDigest: { type: 'string', description: 'the digest you read from issue_dispositions — pins what you judged, so a subject that moved underneath you is refused rather than mis-filed' },
        by: { type: 'string', description: 'your agent identity (e.g. claude-code)' },
        authorizedBy: { type: 'string', description: 'the person who authorized this judgement' },
      }, required: ['id', 'disposition', 'reason', 'rescan', 'by', 'authorizedBy'], additionalProperties: false },
    },
    {
      name: 'turn_efficiency',
      description: 'Token efficiency and behavioural-gate outcome per agent session, derived from the harness transcript '
        + '(bin/lib/turn-recorder-core.mjs + turn-gate-core.mjs). Returns AGGREGATES ONLY — turn counts, token totals, '
        + 'ratios and rule verdicts. Never the session text. Every ratio is null rather than 0 when its denominator is '
        + 'absent, and a transcript with unparseable lines reports outcome "unknown" rather than a rate computed over a '
        + 'denominator nobody knows. `session` takes a transcript id; omit it for the most recently modified sessions.',
      inputSchema: {
        type: 'object',
        properties: { session: { type: 'string' }, limit: { type: 'number' } },
        additionalProperties: false,
      },
    },
    {
      name: 'code_about',
      description: 'What one module is: its export surface, what it imports, who imports it (statically and dynamically), and every symbol it defines with the witness that found each. Reads the codegraph store; does not build it.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'repo-relative POSIX path, e.g. flow/lexer.mjs' } }, required: ['path'], additionalProperties: false },
    },
    {
      name: 'code_blast_radius',
      description: 'Every module that transitively imports this one — what a change here can reach. Carries `lowerBound` and `unknownFrom`: while any file could not be analysed, the set is a floor and says so.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, maxDepth: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false },
    },
    {
      name: 'code_dead_exports',
      description: 'Exported symbols no other module binds. Returns `dead` and `undetermined` SEPARATELY — a symbol behind a dynamic import, a namespace binding or an `export *` is undetermined, not dead, and `dead` is empty whenever any file in the population could not be read.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];
  const out = {};
  for (const d of list) {
    if (out[d.name]) throw new Error(`mcp/tools.mjs: duplicate descriptor '${d.name}'`);
    out[d.name] = Object.freeze({ name: d.name, description: d.description, inputSchema: d.inputSchema });
  }
  return Object.freeze(out);
}

/** The tool names, in publication order — the integrity check in mcp/server.mjs reads this. */
export const TOOL_NAMES = Object.freeze(Object.keys(toolDescriptors()));

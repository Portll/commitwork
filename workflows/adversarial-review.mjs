export const meta = {
  name: 'adversarial-review',
  description: 'Adversarially review a commitwork audit packet into a coherent, dependency-ordered remediation plan (bifocal + foureyes + breakers + overloop, <=4 rounds).',
  whenToUse: 'After `commitwork audit` emits audit-packet.json + remediation-draft.md, to harden the remediation plan and close coverage voids.',
  phases: [
    { title: 'Dimension', detail: 'bifocal edge-walk/fractal + foureyes void analysis pin open dimensionality' },
    { title: 'Adversarial', detail: 'breakers stress the plan across security/perf/correctness layers' },
    { title: 'Overloop', detail: 'iterate critique->revise up to 4 rounds to coherence' },
    { title: 'Synthesize', detail: 'emit the final ordered, void-closed remediation plan' },
  ],
};

// args: { packet: "<abs path to audit-packet.json>", draft: "<abs path to remediation-draft.md>",
//         project: "<name>", reviewCommands: "<abs path to the review service's .claude/commands>" (optional),
//         effort: "<level>" | { dimension, adversarial, overloop, critic, synthesize } (optional) }
const A = typeof args === 'string' ? JSON.parse(args) : (args || {});
const packet = A.packet;
const draft = A.draft;
const project = A.project || 'project';
if (!packet) throw new Error('args.packet (path to audit-packet.json) is required');

// EFFORT IS THE COST LEVER OF THIS WORKFLOW, AND IT USED TO BE UNREACHABLE. Every agent call below
// was hardcoded `effort: 'high'`, and two of them fan out: 2 dimension lenses + 4 breaker layers +
// up to 4 overloop rounds x 2 calls + 1 synthesize = up to 15 high-effort agents per run. Costing a
// run down meant editing this file, so nobody did.
//
// DEFAULTS ARE UNCHANGED (`high` everywhere) ON PURPOSE. Which phases can afford less is a question
// about review QUALITY, and this repository's own rule is that such a claim is measured, not
// asserted — no one has run the comparison yet, so nothing here pretends to know the answer.
//
// What to try first, and the reasoning (a hypothesis, NOT a measurement): `dimension` and
// `synthesize` are the likeliest to hold at 'medium' — the first enumerates gaps against
// methodology files it is told to read, the second is a formatting pass over an already-decided
// plan. `adversarial` and `critic` are the falsifiers: they exist to find what the other phases
// missed, which is the work that least tolerates a shallower pass. Run it both ways on the same
// packet and compare the plans before adopting a lower profile as standard.
//
//   effort: 'medium'                                  — every phase
//   effort: { dimension: 'medium', synthesize: 'medium' }  — the suggested starting profile
const EFFORT_DEFAULT = 'high';
const effortFor = (phaseKey) => {
  const e = A.effort;
  if (!e) return EFFORT_DEFAULT;
  if (typeof e === 'string') return e;
  return e[phaseKey] || EFFORT_DEFAULT;
};

// Single source of truth for methodology: internal-d's canonical command files +
// MCP tools. The prompt text below only ORIENTS each agent; the method itself
// is read from CMDS (or executed via mcp__sleight__* tools), so this script
// can no longer drift from internal-d's implementations.
// Workflow scripts have no fs access, so agents resolve the path themselves: ~ default with a
// second candidate for the other machine layout (READ carries the fallback instruction).
const CMDS = A.reviewCommands || '~/Repositories/Portll/sleight/.claude/commands';
const CMDS_ALT = '~/Repositories/External/Portll/sleight/.claude/commands';
const TOOLFIRST = `TOOL-FIRST: if the internal-d MCP server is connected, load its tools via ToolSearch ` +
  `("select:mcp__sleight__bifocal_plan,mcp__sleight__overloop") and prefer them; fall back to the manual ` +
  `methodology files only if the server is unavailable. `;

const READ = `Read the audit packet JSON at ${packet} and the draft remediation at ${draft}. ` +
  `The packet lists security tools that ran/were blocked/missing, their findings by severity, the ` +
  `dependency (dependsOn) edges, and detected coverage voids for project "${project}". ` +
  `Methodology files referenced below live at ${CMDS} (expand ~ against the home directory; ` +
  `if that directory is absent on this machine, use ${CMDS_ALT} instead).`;

const DIM_SCHEMA = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: {
  type: 'object', required: ['dimension', 'gap', 'severity'], properties: {
    dimension: { type: 'string' }, gap: { type: 'string' },
    severity: { enum: ['critical', 'high', 'medium', 'low'] },
    evidence: { type: 'string' }, closesWith: { type: 'string', description: 'what would close this gap' } } } } } };

const BREAK_SCHEMA = { type: 'object', required: ['breaks'], properties: { breaks: { type: 'array', items: {
  type: 'object', required: ['target', 'layer', 'failureMode', 'fix'], properties: {
    target: { type: 'string', description: 'which remediation step / ordering assumption' },
    layer: { enum: ['security', 'performance', 'correctness', 'sequencing'] },
    failureMode: { type: 'string' }, fix: { type: 'string' },
    severity: { enum: ['critical', 'high', 'medium', 'low'] } } } } } };

const PLAN_SCHEMA = { type: 'object', required: ['steps', 'voids', 'coherent'], properties: {
  steps: { type: 'array', items: { type: 'object', required: ['order', 'action', 'why'], properties: {
    order: { type: 'number' }, action: { type: 'string' }, why: { type: 'string' },
    dependsOn: { type: 'array', items: { type: 'string' } }, gate: { type: 'string' },
    severity: { enum: ['critical', 'high', 'medium', 'low', 'na'] } } } },
  voids: { type: 'array', items: { type: 'object', required: ['dimension', 'closure'], properties: {
    dimension: { type: 'string' }, closure: { type: 'string' } } } },
  coherent: { type: 'boolean', description: 'true if no new material issue remained this round' },
  changeLog: { type: 'string', description: 'what changed vs the input plan' } } };

// ── Phase 1: pin dimensionality (bifocal + foureyes, independent) ────────────
phase('Dimension');
const dimAgents = [
  { lens: 'bifocal', prompt: `${READ}\n\n${TOOLFIRST}Call mcp__sleight__bifocal_plan with the draft remediation text and use its 12-dimension dual-lens report as your base. Then read ${CMDS}/bifocal-plan.md (the canonical bifocal methodology) and extend the tool's output with what it cannot see from here: EDGE-WALK the tool-coverage boundaries in the packet (gate limits, findings just under a severity threshold, the seam between two tools' coverage) and FRACTAL-ANALYZE for the same weakness recurring at multiple scales (per-file, per-service, per-fleet). Report dimensional gaps the plan does not yet address.` },
  { lens: 'foureyes', prompt: `${READ}\n\nRead ${CMDS}/eye-foureyes.md — the canonical FourEyes methodology (there is no foureyes MCP tool; it runs inline) — and apply its offset-agent void analysis to the packet: from four independent vantage points (attacker, operator, auditor, developer) find the COORDINATED blind spots — dimensions that NO tool in the packet covers and that the draft plan is silent on (e.g. runtime, identity/authz, data-at-rest, supply-chain provenance, test coverage). Report each void and what closes it.` },
];
const dims = (await parallel(dimAgents.map((a) => () =>
  agent(a.prompt, { label: `dim:${a.lens}`, phase: 'Dimension', schema: DIM_SCHEMA, effort: effortFor('dimension') })
))).filter(Boolean).flatMap((r) => r.findings || []);
log(`Dimension: ${dims.length} dimensional gaps pinned`);

// ── Phase 2: adversarially stress the plan (breakers) ────────────────────────
phase('Adversarial');
const breakLayers = ['security', 'performance', 'correctness', 'sequencing'];
const breaks = (await parallel(breakLayers.map((layer) => () =>
  agent(`${READ}\n\nRead ${CMDS}/fang-breakers.md — the canonical Breakers methodology (no MCP tool; manual by design) — and apply its ${layer.toUpperCase()} dimension to the draft remediation plan: try to make it FAIL. Attack the dependency ordering (does a step depend on an unmet prereq? is a "quick win" actually blocked? does fixing X reopen Y?), the completeness (what finding has no step?), and the assumptions. Honor the canonical blind-spot gate: mark each checked class [CHECKED] or with findings. Return concrete break scenarios with fixes.`,
    { label: `break:${layer}`, phase: 'Adversarial', schema: BREAK_SCHEMA, effort: effortFor('adversarial') })
))).filter(Boolean).flatMap((r) => r.breaks || []);
log(`Adversarial: ${breaks.length} break scenarios found`);

// ── Phase 3: overloop — iterate critique->revise to coherence (<=4 rounds) ────
phase('Overloop');
let plan = null;
let priorChange = '';
const dimsText = JSON.stringify(dims);
const breaksText = JSON.stringify(breaks);
for (let round = 1; round <= 4; round++) {
  const basis = plan
    ? `Current plan JSON:\n${JSON.stringify(plan)}\n\nPrior round changelog: ${priorChange}`
    : `${READ}\n\nDimensional gaps:\n${dimsText}\n\nBreak scenarios:\n${breaksText}`;
  const revised = await agent(
    `${plan ? '' : READ + '\n\n'}You are running OVERLOOP round ${round}/4. ${basis}\n\n` +
    `${TOOLFIRST}Call mcp__sleight__overloop with the current plan as the target and fold its ranked improvement list into your revision (the canonical manual methodology is ${CMDS}/hand-overloop.md if the server is down). ` +
    `Produce a REVISED remediation plan that: (1) integrates every unaddressed dimensional gap and break-scenario fix, ` +
    `(2) is a strict dependency-ordered sequence (a step never precedes its dependsOn/gate prereq), ` +
    `(3) marks each void with a concrete closure, (4) sets coherent=true ONLY if this round surfaced no new material issue vs the input. Keep the changeLog specific.`,
    { label: `overloop:r${round}`, phase: 'Overloop', schema: PLAN_SCHEMA, effort: effortFor('overloop') });
  if (!revised) break;
  // independent critic: is it actually coherent, or is the reviser over-claiming?
  const critique = await agent(
    `Independently audit this remediation plan for project "${project}" against the audit packet at ${packet}. ` +
    `Plan:\n${JSON.stringify(revised)}\n\n` +
    `Is it truly dependency-coherent (no step before its prereq), complete (every packet finding + void has a step), ` +
    `and non-redundant? Return {materialIssues: number, notes: string}. materialIssues=0 means ship it.`,
    { label: `critic:r${round}`, phase: 'Overloop', effort: effortFor('critic'),
      schema: { type: 'object', required: ['materialIssues', 'notes'], properties: { materialIssues: { type: 'number' }, notes: { type: 'string' } } } });
  plan = revised; priorChange = revised.changeLog || '';
  const issues = critique?.materialIssues ?? 0;
  log(`Overloop r${round}: coherent=${revised.coherent} criticIssues=${issues} — ${(revised.changeLog || '').slice(0, 80)}`);
  if (revised.coherent && issues === 0) { log(`Converged at round ${round}`); break; }
  priorChange += ` | critic: ${critique?.notes || ''}`;
}

// ── Phase 4: synthesize the final artifact ───────────────────────────────────
phase('Synthesize');
const final = await agent(
  `Write the FINAL adversarially-reviewed remediation plan for project "${project}" as GitHub-flavored Markdown. ` +
  `Base it on this reviewed plan JSON:\n${JSON.stringify(plan)}\n\n` +
  `Structure: a one-paragraph posture summary; a numbered dependency-ordered remediation table ` +
  `(order | action | severity | depends-on/gate | why); a "Coverage voids & closures" section; and a "Adversarial review notes" ` +
  `section citing the top break scenarios that reshaped the order. Be concrete and terse. Return ONLY the markdown.`,
  { label: 'synthesize', phase: 'Synthesize', effort: effortFor('synthesize') });

return { project, dimensionalGaps: dims.length, breakScenarios: breaks.length, finalPlan: final };

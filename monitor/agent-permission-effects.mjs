// What an agent's resolved configuration declares, beside what the host sandbox would enforce if the agent ran under it.
//
// The declarations come from lib/security-agent-effective-config.mjs (grants, denies, hooks, MCP servers),
// reduced here to classes; no rule text, path or command leaves this module. The one enforcement adapter
// commitwork can exercise without running an agent is its host sandbox (bin/lib/sandbox.mjs), probed by the
// isolation harness (bin/lib/isolation.mjs) on synthetic fixtures. No agent a repository configures runs
// under it, so its results are conditional and the agents' own enforcement stays unmeasured. The agent's
// permission checks, MCP tool grants and hook dispatch run inside the agent process and are declared only.
import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_PROBES, BOUNDARY_PROBES, PROBE_OUTCOMES, measureHostEffects } from '../bin/lib/isolation.mjs';
import { probeHostSandbox } from '../bin/lib/sandbox.mjs';

export const SCHEMA_VERSION = 1;
export const ADAPTERS = Object.freeze(['host-sandbox', 'agent-runtime']);
// A model-backed agent must reach its provider, so it is measured under a networked posture only.
export const NETWORKS = Object.freeze(['open']);
export const CONTROLS = Object.freeze(['permitted-read', 'credential-read', 'forbidden-read', 'write-escape', 'hook-exec',
  'hook-script-outside', 'hook-binary-outside', 'egress', 'loopback']);
export const CONTROL_STATUS = Object.freeze(['contained', 'permitted', 'not-contained', 'unmeasured']);
// The agents' enforcement: never measured, a finding only when the host sandbox itself was measured breached.
export const STATES = Object.freeze(['not-run', 'unmeasured', 'finding']);
// How much of the host sandbox was measured; every posture leaves hook-binary-outside unmeasured.
export const MEASUREMENT_STATES = Object.freeze(['unmeasured', 'partial']);
export const DECLARATION_KINDS = Object.freeze(['grant', 'deny', 'hook', 'server']);
export const CLASSES = Object.freeze([
  'repo-read', 'credential-read', 'outside-read', 'any-read',
  'repo-write', 'outside-write', 'tmp-write', 'any-write',
  'egress', 'command-exec', 'tool', 'mcp-tool',
  'hook-command', 'hook-other', 'stdio-server', 'remote-server',
  'unresolved', 'unrecognised',
]);
export const RUNTIME_REASON = 'permission checks, MCP tool grants and hook dispatch run inside the agent process; measuring them needs the agent to run, which this probe never does';
export const HOST_SCOPE = 'contains a process started under it; an agent run outside it gets none of its containment';

const ALL_PROBES = [...BOUNDARY_PROBES, ...AGENT_PROBES];
const TOKEN = /^[a-z][a-z0-9-]{0,47}$/;
const AGENT_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const isRecord = (v) => v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
const order = (list) => (a, b) => list.indexOf(a) - list.indexOf(b);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Own data properties only: an inherited value or a getter is not evidence, and a getter is never invoked.
function own(obj, key) {
  let d;
  try { d = Object.getOwnPropertyDescriptor(obj, key); } catch { return { status: 'malformed' }; }
  if (!d) return { status: 'missing' };
  if (!('value' in d)) return { status: 'malformed' };
  if (d.value === undefined || d.value === null) return { status: 'missing' };
  return { status: 'ok', value: d.value };
}

// -- declarations: a rule's class, from its text, which never leaves this function ---------------------
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const NET_TOOLS = new Set(['WebFetch', 'WebSearch']);
const RULE = /^\s*([A-Za-z_][\w-]*)\s*(?:\(([\s\S]*)\))?\s*$/;
const VARIABLE = /\$\{?[A-Za-z_]|%[A-Za-z_]\w*%/;
const WILDCARDS = /^\*+(?:\/\*+)*\/?$/;
// The stores the fixture plants a synthetic credential in (FORBIDDEN_SEGMENTS in bin/lib/sandbox.mjs), under home.
const STORE = /^(?:\.ssh|\.aws|\.gnupg|\.docker|\.kube|\.netrc|Library\/Keychains)(?:\/|$)/;
const HOME_STORE = /(?:~|\$HOME|\$\{HOME\})\/(?:\.ssh|\.aws|\.gnupg|\.docker|\.kube|\.netrc|Library\/Keychains)(?:\/|\b|$)/;
const TMP_ROOT = /^\/(?:private\/)?(?:tmp|var\/folders)(?:\/|$)/;
const NET_COMMAND = /^(?:sudo\s+)?(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet|ftp|http|https|xh)\b|^(?:sudo\s+)?git\s+(?:push|pull|fetch|clone|ls-remote)\b|^(?:sudo\s+)?(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci|update|publish)\b|^(?:sudo\s+)?pip3?\s+install\b/;

function pathClass(inner, mode) {
  const p = inner === undefined ? '' : inner.trim();
  if (p === '' || WILDCARDS.test(p)) return `any-${mode}`;
  if (VARIABLE.test(p) || /^[A-Za-z]:[\\/]/.test(p) || p.includes('\\') || p.split('/').includes('..')) return 'unresolved';
  if (p === '~' || p.startsWith('~/')) {
    if (mode === 'read' && STORE.test(p.slice(2))) return 'credential-read';
    return `outside-${mode}`;
  }
  // Claude Code: `//` is absolute, a single `/` is relative to the settings file, so inside the project
  if (p.startsWith('//')) return mode === 'write' && TMP_ROOT.test(p.slice(1)) ? 'tmp-write' : `outside-${mode}`;
  return `repo-${mode}`;
}

function commandClass(inner) {
  const c = inner === undefined ? '' : inner.trim();
  if (HOME_STORE.test(c)) return 'credential-read';
  if (NET_COMMAND.test(c)) return 'egress';
  return 'command-exec';
}

/** The class of one permission rule, e.g. 'Read(~/.ssh/**)' -> 'credential-read'. Never echoes the rule. */
export function classifyRule(text) {
  if (typeof text !== 'string') return 'unrecognised';
  const m = RULE.exec(text);
  if (!m) return 'unrecognised';
  const [, tool, inner] = m;
  if (tool.startsWith('mcp__')) return 'mcp-tool';
  if (READ_TOOLS.has(tool)) return pathClass(inner, 'read');
  if (WRITE_TOOLS.has(tool)) return pathClass(inner, 'write');
  if (NET_TOOLS.has(tool)) return 'egress';
  if (tool === 'Bash') return commandClass(inner);
  return 'tool';
}

/** resolveAgentConfig's result -> [{kind, class}], in its order. Rule text is read to classify and dropped. */
export function agentDeclarations(resolved) {
  if (!isRecord(resolved)) throw new TypeError('agentDeclarations: expected the result of resolveAgentConfig');
  const list = (k) => (Array.isArray(resolved[k]) ? resolved[k] : []);
  return [
    ...list('grants').map((g) => ({ kind: 'grant', class: classifyRule(isRecord(g) ? g.value : undefined) })),
    ...list('denies').map((d) => ({ kind: 'deny', class: classifyRule(isRecord(d) ? d.value : undefined) })),
    ...list('hooks').map((h) => ({ kind: 'hook', class: isRecord(h) && h.type === 'command' ? 'hook-command' : isRecord(h) ? 'hook-other' : 'unrecognised' })),
    ...list('servers').map((s) => ({ kind: 'server', class: isRecord(s) && s.transport === 'remote' ? 'remote-server' : isRecord(s) && s.transport === 'stdio' ? 'stdio-server' : 'unrecognised' })),
  ];
}

// -- evidence: probe records from the host-sandbox adapter, one set per posture --------------------------
function readProbes(raw) {
  const len = Array.isArray(raw) ? own(raw, 'length') : { status: 'malformed' };
  if (len.status !== 'ok' || !Number.isInteger(len.value) || len.value > 256) return null;
  const seen = new Map();
  for (let i = 0; i < len.value; i++) {
    const e = own(raw, String(i));
    if (e.status !== 'ok' || !isRecord(e.value)) continue;
    const name = own(e.value, 'probe');
    if (name.status !== 'ok' || !ALL_PROBES.includes(name.value)) continue;
    const outcome = own(e.value, 'outcome');
    const reason = own(e.value, 'reason');
    const rec = outcome.status === 'ok' && PROBE_OUTCOMES.includes(outcome.value) && (reason.status === 'missing' || (reason.status === 'ok' && typeof reason.value === 'string'))
      ? { outcome: outcome.value, reason: reason.status === 'ok' && TOKEN.test(reason.value) ? reason.value : reason.status === 'ok' ? 'unrecognised' : null }
      : { malformed: true };
    const prev = seen.get(name.value);
    if (!prev) seen.set(name.value, rec);
    else if (prev.conflict || prev.malformed || rec.malformed || prev.outcome !== rec.outcome) seen.set(name.value, { conflict: true });
    else if ((rec.reason ?? '') < (prev.reason ?? '')) seen.set(name.value, rec);
  }
  return seen;
}

function readEvidence(evidence) {
  if (evidence === undefined || evidence === null) return { reason: 'no-evidence', platform: null, postures: new Map() };
  if (!isRecord(evidence)) return { reason: 'malformed-evidence', platform: null, postures: new Map() };
  const field = (k) => own(evidence, k);
  const sv = field('schemaVersion');
  const ad = field('adapter');
  if (sv.status !== 'ok' || sv.value !== SCHEMA_VERSION || ad.status !== 'ok' || ad.value !== 'host-sandbox') return { reason: 'malformed-evidence', platform: null, postures: new Map() };
  const pf = field('platform');
  const platform = pf.status === 'ok' && (pf.value === 'darwin' || pf.value === 'linux') ? pf.value : null;
  const rs = field('reason');
  const stated = rs.status === 'missing' ? null : rs.status === 'ok' && typeof rs.value === 'string' && TOKEN.test(rs.value) ? rs.value : 'malformed-evidence';
  if (!platform) return { reason: stated ?? (pf.status === 'ok' && typeof pf.value === 'string' ? 'unsupported-platform' : 'malformed-evidence'), platform: null, postures: new Map() };
  // a run that says why it measured nothing is read as having measured nothing, whatever probes it carries
  if (stated !== null) return { reason: stated, platform, postures: new Map() };
  const bp = field('byPosture');
  if (bp.status !== 'ok' || !isRecord(bp.value)) return { reason: 'malformed-evidence', platform, postures: new Map() };
  const postures = new Map();
  for (const n of NETWORKS) {
    const p = own(bp.value, n);
    if (p.status === 'missing') continue;
    if (p.status !== 'ok' || !isRecord(p.value)) { postures.set(n, { reason: 'malformed-evidence' }); continue; }
    const probes = readProbes(own(p.value, 'probes').value);
    postures.set(n, probes ? { probes } : { reason: 'malformed-evidence' });
  }
  return { reason: null, platform, postures };
}

// What the adapter declares for each control. macOS confines reads to granted roots and bwrap binds /
// read-only; both let a compiled binary run from any path (process-exec* on macOS); the agent reaches its
// provider, so egress is open, while loopback is denied in every networked posture.
function expected(control, platform) {
  if (control === 'permitted-read' || control === 'hook-exec' || control === 'hook-binary-outside' || control === 'egress') return 'allowed';
  if (control === 'forbidden-read' || control === 'hook-script-outside') return platform === 'linux' ? 'allowed' : 'denied';
  return 'denied';
}

const unmeasured = (control, exp, measured, reason) => ({ control, expected: exp, measured, status: 'unmeasured', reason });
// A denial counts only beside a control that shows the same harness could reach the effect.
const REACH_CONTROL = Object.freeze({ egress: 'network-control', loopback: 'loopback-control', 'hook-script-outside': 'hook-exec' });

function controlOf(control, probes, platform) {
  const exp = expected(control, platform);
  // The stand-ins are scripts an interpreter must read; no harness stand-in is a compiled binary.
  if (control === 'hook-binary-outside') return unmeasured(control, exp, 'unknown', 'binary-exec-not-enforced');
  const at = (n) => probes.get(n);
  const p = at(control);
  if (!p) return unmeasured(control, exp, 'unknown', 'probe-missing');
  if (p.conflict || p.malformed) return unmeasured(control, exp, 'unknown', p.conflict ? 'probe-conflict' : 'malformed-evidence');
  if (p.outcome === 'error' || p.outcome === 'not-run') return unmeasured(control, exp, p.outcome, `${p.outcome}-${p.reason ?? 'unstated'}`.slice(0, 48));
  const positive = control === 'permitted-read' || control === 'hook-exec';
  const read = at('permitted-read');
  if (control !== 'permitted-read' && !(read && read.outcome === 'allowed')) return unmeasured(control, exp, p.outcome, 'run-unevidenced');
  if (positive) {
    return p.outcome === 'allowed' ? { control, expected: exp, measured: 'allowed', status: 'permitted', reason: 'positive-control' }
      : unmeasured(control, exp, 'denied', 'positive-control-failed');
  }
  if (p.outcome === 'denied') {
    const reach = REACH_CONTROL[control];
    if (reach && at(reach)?.outcome !== 'allowed') return unmeasured(control, exp, 'denied', `${reach}-unreached`);
    return { control, expected: exp, measured: 'denied', status: 'contained', reason: null };
  }
  if (exp === 'denied') return { control, expected: exp, measured: 'allowed', status: 'not-contained', reason: 'measured-breach' };
  return { control, expected: exp, measured: 'allowed', status: 'permitted', reason: control === 'egress' ? 'provider-egress-required' : 'not-enforced-on-platform' };
}

function postureRecord(network, ev) {
  const got = ev.postures.get(network);
  if (!ev.platform || !got || !got.probes) {
    const reason = got?.reason ?? ev.reason ?? 'no-evidence';
    return { network, state: 'unmeasured', reason, probes: [], controls: CONTROLS.map((c) => unmeasured(c, expected(c, ev.platform), 'unknown', reason)) };
  }
  const controls = CONTROLS.map((c) => controlOf(c, got.probes, ev.platform));
  const measured = controls.some((c) => c.status !== 'unmeasured');
  const probes = ALL_PROBES.filter((n) => got.probes.has(n)).map((n) => {
    const p = got.probes.get(n);
    return p.conflict || p.malformed ? { probe: n, outcome: 'error', reason: p.conflict ? 'probe-conflict' : 'malformed-evidence' } : { probe: n, outcome: p.outcome, reason: p.reason };
  });
  return { network, state: measured ? 'partial' : 'unmeasured', reason: measured ? 'controls-unmeasured' : 'evidence-incomplete', probes, controls };
}

// The host-sandbox controls that decide a class, and whether they could contain a deny of it. Every other
// class is enforced, if at all, by the agent runtime. outside-read is not here: a declared path outside the
// repository may still overlap the toolchain and system reads the profile grants. Network denies need
// loopback contained as well, since a local service is reached the same way an internet host is.
const BINDING = Object.freeze({
  'repo-read': { controls: ['permitted-read'], deny: false },
  'credential-read': { controls: ['credential-read'], deny: true },
  'outside-write': { controls: ['write-escape'], deny: true },
  egress: { controls: ['egress', 'loopback'], deny: true },
  'remote-server': { controls: ['egress'], deny: false },
});
const STATUS_ORDER = ['not-contained', 'unmeasured', 'permitted', 'contained'];
const combined = (statuses) => STATUS_ORDER.find((s) => statuses.includes(s));

function readAgent(raw, issues) {
  if (!isRecord(raw)) { issues.push('malformed-agent'); return null; }
  const name = own(raw, 'agent');
  const conf = own(raw, 'configuration');
  const decl = own(raw, 'declarations');
  if (name.status !== 'ok' || typeof name.value !== 'string' || !AGENT_NAME.test(name.value)) { issues.push('malformed-agent'); return null; }
  const configuration = conf.status === 'ok' && (conf.value === 'complete' || conf.value === 'incomplete') ? conf.value : null;
  const declarations = [];
  let malformed = decl.status === 'ok' && Array.isArray(decl.value) ? 0 : 1;
  for (const d of malformed ? [] : decl.value) {
    const kind = isRecord(d) ? own(d, 'kind') : { status: 'malformed' };
    const cls = isRecord(d) ? own(d, 'class') : { status: 'malformed' };
    if (kind.status === 'ok' && DECLARATION_KINDS.includes(kind.value) && cls.status === 'ok' && CLASSES.includes(cls.value)) declarations.push({ kind: kind.value, class: cls.value });
    else malformed += 1;
  }
  return { agent: name.value, configuration, declarations, malformed };
}

const KIND_FIELD = Object.freeze({ grant: 'grants', deny: 'denies', hook: 'hooks', server: 'servers' });

function agentRecord(a, posture) {
  const statusOf = (c) => posture.controls.find((x) => x.control === c);
  const gaps = [];
  const gap = (adapter, scope, subject, reason, declarations = null) => gaps.push({ agent: a.agent, adapter, scope, subject, reason, declarations });
  if (a.configuration !== 'complete') gap(null, 'configuration', 'configuration', a.configuration === null ? 'configuration-state-unknown' : 'configuration-incomplete');
  if (a.malformed) gap(null, 'declarations', 'malformed', 'malformed-declaration', a.malformed);
  for (const c of posture.controls) {
    if (c.status === 'unmeasured' || (c.status === 'permitted' && c.reason !== 'positive-control')) gap('host-sandbox', 'control', c.control, c.reason);
  }
  const byClass = new Map();
  for (const d of a.declarations) {
    const row = byClass.get(d.class) ?? { class: d.class, grants: 0, denies: 0, hooks: 0, servers: 0 };
    row[KIND_FIELD[d.kind]] += 1;
    byClass.set(d.class, row);
  }
  let contained = 0;
  const declared = [...byClass.values()].sort((x, y) => order(CLASSES)(x.class, y.class)).map((row) => {
    const bind = BINDING[row.class];
    const controls = bind ? bind.controls.map(statusOf) : [];
    const status = bind ? combined(controls.map((c) => c.status)) : null;
    const would = bind && bind.deny && status === 'contained' ? row.denies : 0;
    contained += would;
    const total = row.grants + row.denies + row.hooks + row.servers;
    if (!bind) gap('agent-runtime', 'declarations', row.class, 'agent-runtime-unmeasured', total);
    else if (status === 'unmeasured') gap('host-sandbox', 'declarations', row.class, controls.find((c) => c.status === 'unmeasured').reason, total);
    else if (would) gap('host-sandbox', 'declarations', row.class, 'contained-only-if-run-under-host-sandbox', would);
    else if (row.denies) gap('agent-runtime', 'declarations', row.class, 'deny-not-enforced-by-adapter', row.denies);
    return { ...row, checkedBy: bind ? 'host-sandbox' : 'agent-runtime', controls: bind ? [...bind.controls] : [], hostSandbox: status, containedIfRunUnderHostSandbox: would };
  });
  const denies = a.declarations.filter((d) => d.kind === 'deny').length;
  return {
    record: {
      agent: a.agent,
      configuration: a.configuration ?? 'unknown',
      posture: posture.network,
      state: posture.controls.some((c) => c.status === 'not-contained') ? 'finding' : 'unmeasured',
      declared,
      denies: { declared: denies, containedIfRunUnderHostSandbox: contained },
      controls: posture.controls.map((c) => ({ control: c.control, status: c.status, reason: c.reason })),
    },
    gaps,
  };
}

const AGENT_RUNTIME = Object.freeze({ adapter: 'agent-runtime', kind: 'agent-process', state: 'unmeasured', reason: RUNTIME_REASON });

/**
 * Declared permissions beside what the host sandbox would enforce. Pure: the same agents and evidence give
 * the same record. `state` is the agents' own enforcement, which no adapter measures; the host sandbox's
 * measurement is in `adapters` and `postures`, and per agent as `containedIfRunUnderHostSandbox`.
 *
 * @param {{agents: {agent:string, configuration:'complete'|'incomplete', declarations:{kind:string, class:string}[]}[],
 *   evidence?: {schemaVersion:1, adapter:'host-sandbox', platform:string, reason?:string|null,
 *   byPosture: {open?: {probes:object[]}}}}} input
 */
export function permissionEffects(input) {
  const arg = isRecord(input) ? input : {};
  const evField = own(arg, 'evidence');
  const ev = evField.status === 'malformed' ? { reason: 'malformed-evidence', platform: null, postures: new Map() } : readEvidence(evField.value);
  const agentsField = own(arg, 'agents');
  const head = { schemaVersion: SCHEMA_VERSION };
  const hostAdapter = (state) => ({ adapter: 'host-sandbox', kind: 'os-sandbox', state, platform: ev.platform, reason: ev.reason, scope: HOST_SCOPE });
  if (agentsField.status !== 'ok' || !Array.isArray(agentsField.value)) {
    return { ...head, state: 'unmeasured', reason: 'malformed-input', findingSource: null, adapters: [hostAdapter('unmeasured'), { ...AGENT_RUNTIME }], postures: [], agents: [], gaps: [{ agent: null, adapter: null, scope: 'input', subject: 'input', reason: 'malformed-input', declarations: null }], breaches: [] };
  }
  const issues = [];
  const read = agentsField.value.map((r) => readAgent(r, issues)).filter(Boolean);
  // an agent named twice has no single set of declarations, so neither entry is attributed
  const seen = new Map();
  for (const a of read) seen.set(a.agent, (seen.get(a.agent) ?? 0) + 1);
  const agents = read.filter((a) => seen.get(a.agent) === 1);
  const gaps = issues.map((reason) => ({ agent: null, adapter: null, scope: 'input', subject: 'input', reason, declarations: null }));
  for (const [name, n] of seen) {
    if (n > 1) { issues.push('duplicate-agent'); gaps.push({ agent: name, adapter: null, scope: 'input', subject: 'input', reason: 'duplicate-agent', declarations: null }); }
  }
  const postures = agents.length ? NETWORKS.map((n) => postureRecord(n, ev)) : [];
  const records = [];
  for (const a of [...agents].sort((x, y) => cmp(x.agent, y.agent))) {
    const { record, gaps: g } = agentRecord(a, postures[0]);
    records.push(record);
    gaps.push(...g);
  }
  gaps.sort((x, y) => cmp(x.agent ?? '', y.agent ?? '') || cmp(x.adapter ?? '', y.adapter ?? '') || cmp(x.scope, y.scope) || cmp(x.subject, y.subject) || cmp(x.reason, y.reason));
  const breaches = postures.flatMap((p) => p.controls.filter((c) => c.status === 'not-contained').map((c) => ({ network: p.network, control: c.control })));
  const state = !records.length && !issues.length ? 'not-run' : breaches.length ? 'finding' : 'unmeasured';
  const hostState = postures.some((p) => p.state === 'partial') ? 'partial' : 'unmeasured';
  const measured = postures.some((p) => p.state !== 'unmeasured');
  return {
    ...head,
    state,
    reason: state === 'not-run' ? 'no-agent-configuration' : state === 'finding' ? 'measured-breach'
      : !records.length ? 'malformed-input' : measured ? 'no-adapter-applies-to-the-agents' : postures[0].reason,
    findingSource: state === 'finding' ? 'measured' : null,
    adapters: [hostAdapter(hostState), { ...AGENT_RUNTIME }],
    postures,
    agents: records,
    gaps,
    breaches,
  };
}

// -- the adapter: the host sandbox commitwork would start an agent under, probed on synthetic fixtures --
const CW_ROOT = () => dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The host-sandbox spec for an agent: reads the granted roots, writes only its temp dir (where commitwork
 * starts an agent's scratch cwd), and the network every networked class compiles to, measured as `registry`.
 */
export function agentProbeSpec({ platform, cwRoot, nodePrefix, tmpDir, home, developerDir = null }) {
  for (const [k, v] of Object.entries({ cwRoot, nodePrefix, tmpDir, home })) {
    if (typeof v !== 'string' || !v.startsWith('/')) throw new TypeError(`agentProbeSpec: ${k} must be an absolute path`);
  }
  return {
    egress: 'registry', platform, cwRoot, nodePrefix, developerDir, userCacheDir: null,
    repoPath: tmpDir, reportDir: tmpDir, tmpDir, home, extraReads: [], extraWrites: [],
  };
}

// The probes are synchronous, so a handled SIGTERM or SIGINT lands after the scratch is removed and then
// exits through the harness's exit hook; an unhandled one would kill the process with the scratch in place.
function exitOnSignal() {
  const added = [['SIGTERM', 143], ['SIGINT', 130]].filter(([s]) => process.listenerCount(s) === 0).map(([s, code]) => {
    const h = () => process.exit(code);
    process.on(s, h);
    return [s, h];
  });
  // removed one loop turn later, after the poll phase has delivered a signal that arrived while probing
  return () => setImmediate(() => { for (const [s, h] of added) process.removeListener(s, h); });
}

/**
 * Runs the host-sandbox probes, agent probes included, under the agent's posture. Never throws; an
 * unsupported platform or a sandbox that cannot start is stated in `reason` and measures nothing.
 * Host paths are read at call time and never appear in the result.
 */
export function measureAgentPermissionEffects({
  platform = process.platform, sandboxProbe = probeHostSandbox, measure = measureHostEffects,
  cwRoot, nodePrefix, tmpDir, home, ...harness
} = {}) {
  const evidence = { schemaVersion: SCHEMA_VERSION, adapter: 'host-sandbox', platform, reason: null, byPosture: {} };
  if (platform !== 'darwin' && platform !== 'linux') return { ...evidence, reason: 'unsupported-platform' };
  let sb = null;
  try { sb = sandboxProbe({ platform }); } catch { sb = null; }
  if (!sb || sb.available !== true) return { ...evidence, reason: 'adapter-unavailable' };
  let paths;
  try {
    paths = {
      platform,
      cwRoot: cwRoot ?? CW_ROOT(),
      nodePrefix: nodePrefix ?? dirname(dirname(realpathSync(process.execPath))),
      tmpDir: tmpDir ?? realpathSync(tmpdir()),
      home: home ?? homedir(),
      developerDir: typeof sb.developerDir === 'string' ? sb.developerDir : null,
    };
  } catch { return { ...evidence, reason: 'host-paths-unreadable' }; }
  const release = exitOnSignal();
  try {
    for (const n of NETWORKS) {
      let r = null;
      try { r = measure(agentProbeSpec(paths), { ...harness, agentProbes: true }); } catch { r = null; }
      evidence.byPosture[n] = isRecord(r) && Array.isArray(r.probes)
        ? { probes: r.probes.map((p) => (isRecord(p) ? { probe: p.probe, outcome: p.outcome, reason: p.reason ?? null } : p)) }
        : { probes: ALL_PROBES.map((probe) => ({ probe, outcome: 'error', reason: 'harness-error' })) };
    }
  } finally { release(); }
  return evidence;
}

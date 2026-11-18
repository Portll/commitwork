// cra/semgrep-rule-modes.mjs — which Semgrep rules trace data, so a result without a path can say why.
//
// A Semgrep result in SARIF does not record its rule's mode, and as of semgrep 1.182.0 OSS no taint
// match exports its trace (cra/dataflow-evidence.mjs). So "no path" covers two different things:
//   a pattern rule ('search', the default) matched a shape and never looked for a flow, and
//   a taint rule matched, which means Semgrep DID trace a source to the sink, and kept the trace.
// Only the rule's own definition tells them apart. Registry rules are defined on semgrep.dev, so
// bin/semgrep-rule-modes.mjs fetches the definitions of the rules that fired and records each rule's
// MODE here, with a hash of the definition it read and when. The rule text itself is not kept: the
// registry rules carry their own licence (Semgrep Rules License v1.0), and the mode is all we need.
// commitwork's own rules (manifests/semgrep-*) are read from the checkout, never fetched.
//
// A rule the fetch could not resolve is recorded as unresolved, with its reason, and reads as an
// unknown mode — never as 'search'. Defaulting a failed fetch to "pattern rule" would put the
// stronger claim ("this rule never traces") on a rule nobody read.
//
// Zero deps: the YAML is read line by line, only as far as a rule's own top-level keys.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TABLE_VERSION = 1;
export const GENERATED_BY = 'bin/semgrep-rule-modes.mjs fetch';
export const DEFAULT_REGISTRY = 'https://semgrep.dev/c/r/';
/** The modes Semgrep defines. 'search' is what a rule with no `mode` key runs as. */
export const MODES = Object.freeze(['search', 'taint', 'join', 'extract']);

// Read at CALL time, so a test that sets the variable after import is honoured.
export const ruleModesPath = () => process.env.CW_SEMGREP_RULE_MODES || join(CW, 'monitor', 'semgrep-rule-modes.json');
export const registryBase = () => process.env.CW_SEMGREP_REGISTRY || DEFAULT_REGISTRY;
export const localRuleDirs = () => ['semgrep-taint', 'semgrep-classes', 'semgrep-workflows'].map((d) => join(CW, 'manifests', d));

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Every rule in one Semgrep YAML document → [{ id, mode }]. A rule is a `- id:` list item; its own
 * keys sit two columns right of the dash, and anything deeper (metadata, patterns, a folded message)
 * is not read. `mode` wins when present; a rule-level `taint:` block is the newer spelling of a taint
 * rule, and `join:` of a join rule; otherwise the rule runs in search mode.
 */
export function parseRuleModes(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\s*)- id:\s*['"]?([^'"\s#]+)['"]?\s*(#.*)?$/.exec(lines[i]);
    if (!head) continue;
    const indent = head[1].length;
    const keyIndent = indent + 2;
    const keys = new Map();
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      const lead = l.length - l.trimStart().length;
      if (lead < keyIndent) break;            // the next item, or the end of the list
      if (lead !== keyIndent) continue;       // deeper: a value of some key, not a rule key
      const k = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(l);
      if (k) keys.set(k[1], k[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '').trim());
    }
    const mode = keys.has('mode') ? keys.get('mode') : keys.has('taint') ? 'taint' : keys.has('join') ? 'join' : 'search';
    out.push({ id: head[2], mode });
    i = j - 1;
  }
  return out;
}

/**
 * The recorded table. States: 'absent' (ENOENT: nothing fetched yet), 'unreadable', 'unparseable',
 * 'invalid' (not this table's shape), 'ok'. Only 'ok' carries rules.
 */
export function readRuleModes(path = ruleModesPath()) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    return { state: e.code === 'ENOENT' ? 'absent' : 'unreadable', reason: `${path}: ${e.code || e.message}`, path, table: null };
  }
  let t;
  try { t = JSON.parse(text); } catch (e) {
    return { state: 'unparseable', reason: `${path}: ${e.message}`, path, table: null };
  }
  if (!t || t.v !== TABLE_VERSION || typeof t.rules !== 'object' || !t.rules || typeof t.unresolved !== 'object' || !t.unresolved) {
    return { state: 'invalid', reason: `${path}: not a v${TABLE_VERSION} rule-mode table`, path, table: null };
  }
  return { state: 'ok', reason: null, path, table: t };
}

/**
 * commitwork's own rules, from the checkout: id → { mode, file }. A directory that is absent is
 * skipped (ENOENT); one that cannot be listed or a file that cannot be read is named in `errors`.
 */
export function readLocalModes(dirs = localRuleDirs()) {
  const rules = new Map();
  const errors = [];
  for (const d of dirs) {
    let names;
    try { names = readdirSync(d); } catch (e) {
      if (e.code !== 'ENOENT') errors.push(`${d}: ${e.code || e.message}`);
      continue;
    }
    for (const n of names.filter((x) => /\.ya?ml$/.test(x)).sort()) {
      const f = join(d, n);
      let text;
      try { text = readFileSync(f, 'utf8'); } catch (e) { errors.push(`${f}: ${e.code || e.message}`); continue; }
      for (const r of parseRuleModes(text)) rules.set(r.id, { mode: r.mode, file: f });
    }
  }
  return { rules, errors };
}

/**
 * The mode of one fired rule, and where that answer came from:
 *   { mode, source: 'registry' }    the recorded registry definition
 *   { mode, source: 'local' }       commitwork's own rule. Semgrep prefixes a local rule's id with its
 *                                   config path, so the id's last dotted segment is matched
 *   { mode: null, source: 'unresolved', why }  a fetch was tried and failed
 *   { mode: null, source: 'unrecorded' }       nobody fetched this rule
 */
export function modeFor(ruleId, { table = null, local = null } = {}) {
  const id = String(ruleId || '');
  const rec = table && table.rules[id];
  if (rec) return { mode: rec.mode, source: 'registry' };
  if (local) {
    const last = id.split('.').pop();
    const hit = local.rules.get(id) || local.rules.get(last);
    if (hit) return { mode: hit.mode, source: 'local' };
  }
  const un = table && table.unresolved[id];
  if (un) return { mode: null, source: 'unresolved', why: un.reason };
  return { mode: null, source: 'unrecorded' };
}

/**
 * Fetch one registry rule's definition and read its mode. Never throws: every failure is a reason.
 * `fetchImpl` is injectable for tests; the default is the global fetch.
 */
export async function fetchRuleMode(id, { base = registryBase(), fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no fetch available in this runtime' };
  const url = `${base}${encodeURIComponent(id)}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'user-agent': 'commitwork-rule-modes/1', accept: 'text/yaml, text/plain, */*' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { ok: false, url, reason: `fetch failed: ${e.cause?.code || e.name || e.message}` };
  }
  if (res.status !== 200) return { ok: false, url, reason: `HTTP ${res.status}` };
  let text;
  try { text = await res.text(); } catch (e) { return { ok: false, url, reason: `body unreadable: ${e.message}` }; }
  const rules = parseRuleModes(text);
  const hit = rules.find((r) => r.id === id);
  if (!hit) return { ok: false, url, reason: rules.length ? `definition names ${rules.map((r) => r.id).slice(0, 3).join(', ')}, not ${id}` : 'no rule in the response' };
  if (!MODES.includes(hit.mode)) return { ok: false, url, reason: `mode ${JSON.stringify(hit.mode)} is not one Semgrep defines` };
  return { ok: true, url, mode: hit.mode, sha256: sha256(text) };
}

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (o) => Object.fromEntries(Object.keys(o).sort(byName).map((k) => [k, o[k]]));

/**
 * Merge fetch outcomes into a table. A resolved rule replaces its record; a failed fetch records the
 * reason under `unresolved` and leaves an earlier resolved record standing (it was read once and the
 * registry going away does not unread it). Keys are sorted so the file is byte-stable.
 */
export function mergeOutcomes(prev, outcomes, atIso, base = registryBase()) {
  const rules = { ...(prev?.rules || {}) };
  const unresolved = { ...(prev?.unresolved || {}) };
  for (const [id, o] of outcomes) {
    if (o.ok) {
      rules[id] = { mode: o.mode, sha256: o.sha256, fetchedAt: atIso };
      delete unresolved[id];
    } else if (!rules[id]) {
      unresolved[id] = { reason: o.reason, at: atIso };
    }
  }
  return { v: TABLE_VERSION, generatedBy: GENERATED_BY, registry: base, rules: sorted(rules), unresolved: sorted(unresolved) };
}

export const tableText = (t) => `${JSON.stringify(t, null, 2)}\n`;

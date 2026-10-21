// Rules model for per-area/per-repo sweep overrides. Pure: no fs, no clock, no I/O.
// One table shape — INCLUDE | DIRECTORY | Name | <value> — reused for thresholds AND cadence, so
// `value` is opaque here. The caller validates it; this file never inspects it.
//
// RESOLUTION SEMANTICS — decided here so nobody has to infer them from the code:
//
//   1. LAST MATCH WINS. Rules are an ordered list and the last matching row decides. The panel
//      appends new rows at the bottom via "+", so the row the operator just wrote is the row that
//      takes effect — any other choice makes a fresh override silently inert under an older broad
//      one. Authoring order is therefore broad-first, narrow-last.
//
//   2. SPECIFICITY DOES NOT PARTICIPATE. A `*` rule does NOT lose to an exact rule placed above it.
//      Order is the ONLY thing that decides. Stated loudly because an operator will otherwise
//      assume the exact row wins wherever they put it — it does not; move it down.
//
//   3. EXCLUDE IS A STATE, NOT AN ABSENCE. A matching exclude row yields {value:null,
//      source:'excluded'}. That is a different answer from "no rule mentioned this target"
//      ({value:fallback, source:'fallback'}) and the two never collapse into each other.
//
//   4. NO WILDCARD-BY-OMISSION. A missing/empty directory or name is an ERROR, never an implicit
//      `*`. monitor/annotate-lib.mjs shipped the opposite and one omitted field reached the whole
//      fleet. Enforced at parse time AND again at match time, so a hand-built rule that skipped
//      parseRules cannot match either.
//
//   5. `*` MATCHES AN ABSENT TARGET FIELD; AN EXACT LITERAL NEVER DOES. A malformed target does not
//      quietly inherit an exact row.
//
// Matching is case-insensitive and exact. `*` is the only wildcard — there is no globbing, no
// prefix, no substring. Half-implemented globbing is worse than none: it matches the wrong repo
// while looking like it worked.

const ANY = '*';

const norm = (s) => String(s).trim().toLowerCase();
const isAny = (s) => typeof s === 'string' && s.trim() === ANY;

// The four columns, in panel order. Single source of truth for the store<->UI representation.
const COLUMNS = ['include', 'directory', 'name', 'value'];

// why: reused by parseRule and by the match path, so an unparsed rule is refused for the same
// reasons and in the same words as a parsed one.
function ruleErrors(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return [`row must be an object, got ${row === null ? 'null' : Array.isArray(row) ? 'array' : typeof row}`];
  }
  const errs = [];
  if (typeof row.include !== 'boolean') {
    errs.push(`include must be a boolean (include-or-exclude), got ${row.include === undefined ? 'undefined' : typeof row.include}`);
  }
  for (const field of ['directory', 'name']) {
    const v = row[field];
    if (typeof v !== 'string') {
      errs.push(`${field} must be a string, got ${v === undefined ? 'undefined' : typeof v} (no wildcard-by-omission — write '*' if you mean any)`);
    } else if (v.trim() === '') {
      errs.push(`${field} must not be empty (no wildcard-by-omission — write '*' if you mean any)`);
    }
  }
  return errs;
}

export function parseRule(row) {
  const errors = ruleErrors(row);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    rule: {
      include: row.include,
      directory: row.directory.trim(),
      name: row.name.trim(),
      value: row.value,
    },
  };
}

// Bad rows keep their slot as `null` rather than being dropped. Compacting would shift every later
// index — and silently deleting a malformed EXCLUDE row turns "never sweep this" into "sweep it".
export function parseRules(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const rules = [];
  const errors = [];
  list.forEach((row, index) => {
    const r = parseRule(row);
    if (r.ok) {
      rules.push(r.rule);
    } else {
      rules.push(null);
      errors.push({ index, errors: r.errors.map((e) => `row ${index}: ${e}`) });
    }
  });
  return { ok: errors.length === 0 && Array.isArray(rows), rules, errors };
}

function fieldMatch(rulePart, targetPart) {
  if (isAny(rulePart)) return { ok: true, how: ANY };
  if (typeof targetPart !== 'string' || targetPart.trim() === '') return { ok: false, how: 'exact' };
  return { ok: norm(rulePart) === norm(targetPart), how: 'exact' };
}

// One rule vs one target. Returns the reason either way — explain() and resolveFor read the same
// verdict, so the panel cannot show a rationale that disagrees with the value in effect.
function evaluate(rule, target) {
  const errs = ruleErrors(rule);
  if (errs.length) return { matched: false, why: `skipped — invalid rule: ${errs.join('; ')}` };
  const t = target && typeof target === 'object' ? target : {};
  const d = fieldMatch(rule.directory, t.directory);
  if (!d.ok) {
    return { matched: false, why: `no match — directory '${rule.directory}' != ${t.directory === undefined ? '(target has no directory)' : `'${t.directory}'`}` };
  }
  const n = fieldMatch(rule.name, t.name);
  if (!n.ok) {
    return { matched: false, why: `no match — name '${rule.name}' != ${t.name === undefined ? '(target has no name)' : `'${t.name}'`}` };
  }
  const matchedBy = `directory=${d.how},name=${n.how}`;
  return { matched: true, matchedBy, why: `matched (${matchedBy})` };
}

function targetErrors(target) {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return [`target must be an object, got ${target === null ? 'null' : Array.isArray(target) ? 'array' : typeof target}`];
  }
  return [];
}

// explicit uncertainty and not red: an unusable target reports itself as such rather than quietly
// taking the fallback (which reads as "the global default applies") or as excluded.
export function resolveFor(target, { rules = [], fallback = undefined } = {}) {
  if (targetErrors(target).length) {
    return { value: null, source: 'invalid-target', ruleIndex: null, matchedBy: null };
  }
  const list = Array.isArray(rules) ? rules : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const v = evaluate(list[i], target);
    if (!v.matched) continue;
    return list[i].include
      ? { value: list[i].value, source: 'rule', ruleIndex: i, matchedBy: v.matchedBy }
      : { value: null, source: 'excluded', ruleIndex: i, matchedBy: v.matchedBy };
  }
  return { value: fallback, source: 'fallback', ruleIndex: null, matchedBy: null };
}

// Every rule, in table order, with a truthful verdict for each — including the ones the winner
// shadows. A settings screen that cannot show why a value is in effect teaches the operator to
// believe a value that is not.
export function explain(target, { rules = [], fallback = undefined } = {}) {
  const list = Array.isArray(rules) ? rules : [];
  const bad = targetErrors(target);
  if (bad.length) {
    return list.map((rule, index) => ({ index, rule, matched: false, winner: false, why: `not evaluated — ${bad[0]}` }));
  }
  const decided = resolveFor(target, { rules: list, fallback });
  return list.map((rule, index) => {
    const v = evaluate(rule, target);
    const winner = index === decided.ruleIndex;
    let why = v.why;
    if (v.matched && !winner) why = `${v.why} — overridden by rule #${decided.ruleIndex} (last match wins)`;
    else if (winner) why = `${v.why} — WINS (last match); ${rule.include ? `value applied` : 'target is EXCLUDED'}`;
    return { index, rule, matched: v.matched, winner, why };
  });
}

// One representation for the store and the panel. Both directions emit exactly the four columns
// and always set every key, so undefined values survive a deepStrictEqual round-trip.
const toColumns = (o) => {
  const src = o && typeof o === 'object' ? o : {};
  const out = {};
  for (const k of COLUMNS) out[k] = src[k];
  return out;
};

export function rulesToRows(rules) {
  return (Array.isArray(rules) ? rules : []).map(toColumns);
}

export function rowsToRules(rows) {
  return (Array.isArray(rows) ? rows : []).map(toColumns);
}

export const SWEEP_RULE_COLUMNS = COLUMNS;

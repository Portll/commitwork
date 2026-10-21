// Reads a GitHub Actions workflow file into tokens validated against the workflow schema, then
// into the model the runner needs: events, jobs, steps, conditions and matrix expansion. The rules
// follow GitHub's own reader and converter; lib/test/actions-oracle.test.mjs grades the result.

import { parseYaml, YamlError } from './actions-yaml.mjs';
import { definitions as schemaDefinitions } from './actions-schema.mjs';
import { parseExpression, splitAllowedContext, templateExpression, containsStatusFunction, ExpressionError } from './actions-expressions.mjs';

export const WORKFLOW_ROOT = 'workflow-root-strict';
const INSERT = 'insert';
const BACKGROUND_STEP_PROPERTIES = new Set(['background', 'wait', 'wait-all', 'cancel']);
const BACKGROUND_STEP_ONLY_PROPERTIES = new Set(['wait', 'wait-all', 'cancel']);
const ID_MAX_LENGTH = 100;

const BUILTIN = {
  null: { null: {} },
  boolean: { boolean: {} },
  number: { number: {} },
  string: { string: {} },
  sequence: { sequence: { 'item-type': 'any' } },
  mapping: { mapping: { 'loose-key-type': 'string', 'loose-value-type': 'any' } },
  any: { 'one-of': ['null', 'boolean', 'number', 'string', 'sequence', 'mapping'] },
};

// ── schema ───────────────────────────────────────────────────────────────────────────────────────
const definitionCache = new Map();

function definition(name) {
  if (definitionCache.has(name)) return definitionCache.get(name);
  const raw = BUILTIN[name] || schemaDefinitions[name];
  if (!raw) throw new Error(`Schema definition '${name}' not found`);
  let kind; let oneOf;
  if (raw.mapping) kind = 'mapping';
  else if (raw.sequence) kind = 'sequence';
  else if (raw['one-of']) { kind = 'one-of'; oneOf = raw['one-of']; }
  else if (raw['allowed-values']) {
    kind = 'one-of';
    oneOf = raw['allowed-values'].map((v) => {
      const constantName = `${name}-${v}`;
      definitionCache.set(constantName, { name: constantName, kind: 'string', constant: v, ignoreCase: false, requireNonEmpty: false, context: [] });
      return constantName;
    });
  } else if (raw.string) kind = 'string';
  else if (raw.number) kind = 'number';
  else if (raw.boolean) kind = 'boolean';
  else if (raw.null) kind = 'null';
  else throw new Error(`Schema definition '${name}' has no type`);
  const d = { name, kind, context: raw.context || [], oneOf };
  if (kind === 'mapping') {
    d.properties = {};
    for (const [prop, spec] of Object.entries(raw.mapping.properties || {})) d.properties[prop] = typeof spec === 'string' ? { type: spec, required: false } : { type: spec.type, required: !!spec.required };
    d.looseKeyType = raw.mapping['loose-key-type'];
    d.looseValueType = raw.mapping['loose-value-type'];
  }
  if (kind === 'sequence') d.itemType = raw.sequence['item-type'];
  if (kind === 'string') {
    d.constant = raw.string.constant || '';
    d.ignoreCase = !!raw.string['ignore-case'];
    d.requireNonEmpty = !!raw.string['require-non-empty'];
  }
  definitionCache.set(name, d);
  return d;
}

function definitionsOfType(def, kind) {
  if (def.kind === kind) return [def];
  if (def.kind === 'one-of') return def.oneOf.map(definition).filter((d) => d.kind === kind);
  return [];
}

function scalarDefinitions(def) {
  if (def.kind === 'one-of') return def.oneOf.flatMap((n) => scalarDefinitions(definition(n)));
  return ['null', 'boolean', 'number', 'string'].includes(def.kind) ? [def] : [];
}

// Allowed contexts flow down the tree; a definition that names its own adds them.
function info(parent, nameOrDef) {
  const def = typeof nameOrDef === 'string' ? definition(nameOrDef) : nameOrDef;
  const inherited = parent ? parent.allowedContext : [];
  if (def.context.length === 0) return { def, allowedContext: inherited };
  const seen = new Set(inherited.map((c) => c.toUpperCase()));
  const allowedContext = [...inherited];
  for (const c of def.context) if (!seen.has(c.toUpperCase())) { seen.add(c.toUpperCase()); allowedContext.push(c); }
  return { def, allowedContext };
}

// ── tokens ───────────────────────────────────────────────────────────────────────────────────────
const scalarToken = (node, type, value) => ({ t: type, value, line: node.line, col: node.col, source: node.source, style: node.style });
const asString = (tok) => (tok.t === 'string' ? tok : { ...tok, t: 'string', value: tokenText(tok) });

function tokenText(tok) {
  switch (tok.t) {
    case 'string': return tok.value;
    case 'number': return `${tok.value}`;
    case 'boolean': return tok.value ? 'true' : 'false';
    case 'null': return '';
    case 'expr': return `\${{ ${tok.expression} }}`;
    case 'insert': return '${{ insert }}';
    default: return '';
  }
}

export function serializeToken(tok) {
  switch (tok.t) {
    case 'map': return { type: 2, map: tok.entries.map((e) => ({ Key: serializeToken(e.key), Value: serializeToken(e.value) })) };
    case 'seq': return { type: 1, seq: tok.items.map(serializeToken) };
    case 'expr': return { type: 3, expr: tok.expression };
    case 'insert': return { type: 4, expr: 'insert' };
    default: return tok.value;
  }
}

export function tokenToPlain(tok) {
  switch (tok.t) {
    case 'map': { const o = {}; for (const e of tok.entries) o[tokenText(e.key)] = tokenToPlain(e.value); return o; }
    case 'seq': return tok.items.map(tokenToPlain);
    case 'expr': return { $expr: tok.expression };
    case 'insert': return { $expr: 'insert' };
    default: return tok.value;
  }
}

const isScalarToken = (tok) => tok.t !== 'map' && tok.t !== 'seq';
const isExpressionToken = (tok) => tok.t === 'expr' || tok.t === 'insert';

// ── the template reader ──────────────────────────────────────────────────────────────────────────
class Reader {
  constructor() { this.errors = []; this.expressions = []; }

  error(at, message) { this.errors.push({ message, line: at?.line ?? 0, col: at?.col ?? 0 }); }

  readValue(node, defInfo) {
    if (node.type === 'scalar') return this.validate(this.parseScalar(node, defInfo), defInfo);
    if (node.type === 'seq') {
      const tok = { t: 'seq', line: node.line, col: node.col, items: [] };
      const seqDef = definitionsOfType(defInfo.def, 'sequence')[0];
      if (seqDef) {
        const itemInfo = info(defInfo, seqDef.itemType);
        for (const item of node.items) tok.items.push(this.readValue(item, itemInfo));
      } else this.error(node, 'A sequence was not expected');
      tok.def = defInfo;
      return tok;
    }
    const tok = { t: 'map', line: node.line, col: node.col, entries: [] };
    const mappingDefs = definitionsOfType(defInfo.def, 'mapping');
    if (mappingDefs.length === 0) this.error(node, 'A mapping was not expected');
    else if (mappingDefs.length > 1 || Object.keys(mappingDefs[0].properties).length > 0 || !mappingDefs[0].looseKeyType) this.readKnownMapping(node, defInfo, [...mappingDefs], tok);
    else this.readLooseMapping(node, defInfo, mappingDefs[0], tok);
    if (!tok.def) tok.def = defInfo;
    return tok;
  }

  readKnownMapping(node, defInfo, mappingDefs, tok) {
    const looseKeyType = mappingDefs[0].looseKeyType;
    const looseValueType = mappingDefs[0].looseValueType;
    const upperKeys = new Set();
    let hasExpressionKey = false;
    for (const entry of node.entries) {
      const keyScalar = this.parseScalar(entry.key, defInfo);
      if (isExpressionToken(keyScalar)) {
        hasExpressionKey = true;
        if (defInfo.allowedContext.length > 0) tok.entries.push({ key: keyScalar, value: this.readValue(entry.value, info(defInfo, 'any')) });
        else this.error(entry.key, 'A template expression is not allowed in this context');
        continue;
      }
      const key = asString(keyScalar);
      if (key.value) {
        const upper = key.value.toUpperCase();
        if (upperKeys.has(upper)) { this.error(entry.key, `'${key.value}' is already defined`); continue; }
        upperKeys.add(upper);
      }
      const propertyDef = matchPropertyAndFilter(mappingDefs, key.value);
      if (propertyDef) {
        if (BACKGROUND_STEP_PROPERTIES.has(key.value)) { this.error(entry.key, `Unexpected value '${key.value}'`); continue; }
        const valueInfo = info(defInfo, propertyDef.type);
        key.def = valueInfo;
        tok.entries.push({ key, value: this.readValue(entry.value, valueInfo) });
        continue;
      }
      if (looseKeyType) {
        this.validate(key, info(defInfo, looseKeyType));
        const valueInfo = info(defInfo, looseValueType);
        key.def = valueInfo;
        tok.entries.push({ key, value: this.readValue(entry.value, valueInfo) });
        continue;
      }
      this.error(entry.key, `Unexpected value '${key.value}'`);
    }
    if (mappingDefs.length === 1) tok.def = info(defInfo, mappingDefs[0]);
    if (mappingDefs.length > 1) {
      const hits = new Map();
      for (const d of mappingDefs) for (const k of Object.keys(d.properties)) hits.set(k, (hits.get(k) || 0) + 1);
      const candidates = [...hits].filter(([k, n]) => n === 1 && !BACKGROUND_STEP_ONLY_PROPERTIES.has(k)).map(([k]) => k).sort();
      this.error(node, `There's not enough info to determine what you meant. Add one of these properties: ${candidates.join(', ')}`);
    } else if (mappingDefs.length === 1 && !hasExpressionKey) {
      for (const [prop, spec] of Object.entries(mappingDefs[0].properties)) {
        if (spec.required && !upperKeys.has(prop.toUpperCase())) this.error(node, `Required property is missing: ${prop}`);
      }
    }
  }

  readLooseMapping(node, defInfo, mappingDef, tok) {
    const keyInfo = info(defInfo, mappingDef.looseKeyType);
    const valueInfo = info(defInfo, mappingDef.looseValueType);
    const upperKeys = new Set();
    for (const entry of node.entries) {
      const keyScalar = this.parseScalar(entry.key, defInfo);
      keyScalar.def = keyInfo;
      if (isExpressionToken(keyScalar)) {
        if (defInfo.allowedContext.length > 0) tok.entries.push({ key: keyScalar, value: this.readValue(entry.value, valueInfo) });
        else this.error(entry.key, 'A template expression is not allowed in this context');
        continue;
      }
      const key = asString(keyScalar);
      if (key.value) {
        const upper = key.value.toUpperCase();
        if (upperKeys.has(upper)) { this.error(entry.key, `'${key.value}' is already defined`); continue; }
        upperKeys.add(upper);
      }
      this.validate(key, keyInfo);
      key.def = valueInfo;
      tok.entries.push({ key, value: this.readValue(entry.value, valueInfo) });
    }
  }

  parseScalar(node, defInfo) {
    const v = node.value;
    if (v === null) return scalarToken(node, 'null', null);
    if (typeof v === 'number') return scalarToken(node, 'number', v);
    if (typeof v === 'boolean') return scalarToken(node, 'boolean', v);
    const tok = scalarToken(node, 'string', v);
    if (!v.includes('${{')) return tok;
    const found = templateExpression(v);
    if (!found) return tok;
    if (found.error) { this.error(node, found.error); return tok; }
    let failed = false; let directive;
    for (const seg of found.segments || []) {
      if (seg.expression === undefined) continue;
      const check = this.checkExpression(seg.expression, defInfo.allowedContext);
      if (check.error) { this.error(node, check.error); failed = true; }
      else if (check.directive) directive = check.directive;
    }
    if (failed) return tok;
    if (directive) {
      if (found.segments.length !== 1) { this.error(node, `The directive '${directive}' is not allowed in this context. Directives are not supported for expressions that are embedded within a string. Directives are only supported when the entire value is an expression.`); return tok; }
      return { t: 'insert', line: node.line, col: node.col, source: node.source, def: defInfo };
    }
    if (found.literal !== undefined) return scalarToken(node, 'string', found.literal);
    const expr = { t: 'expr', expression: found.expression, line: node.line, col: node.col, source: node.source, style: node.style, def: defInfo, parts: found.segments.filter((s) => s.expression !== undefined).map((s) => s.expression) };
    this.expressions.push(expr);
    return expr;
  }

  checkExpression(expression, allowedContext) {
    if (!expression) return { error: 'An expression was expected' };
    if (expression === INSERT || /^insert\s/.test(expression)) {
      return expression === INSERT ? { directive: INSERT } : { error: `Exactly 0 parameter(s) were expected following the directive '${INSERT}'. Actual parameter count: ${expression.slice(INSERT.length).trim().split(/\s+/).length}` };
    }
    try { parseExpression(expression, splitAllowedContext(allowedContext)); return {}; } catch (e) { return { error: e.message }; }
  }

  validate(tok, defInfo) {
    if (isExpressionToken(tok)) {
      if (defInfo.allowedContext.length === 0) this.error(tok, 'A template expression is not allowed in this context');
      return tok;
    }
    if (!isScalarToken(tok)) { this.error(tok, `Unexpected value '${tokenText(tok)}'`); return tok; }
    const scalars = scalarDefinitions(defInfo.def);
    let match = scalars.find((d) => scalarMatches(d, tok));
    if (match) { tok.def = info(defInfo, match); return tok; }
    if (tok.t !== 'string') {
      const str = asString(tok);
      match = scalars.find((d) => scalarMatches(d, str));
      if (match) { str.def = info(defInfo, match); return str; }
    }
    this.error(tok, `Unexpected value '${tokenText(tok)}'`);
    return tok;
  }
}

function scalarMatches(def, tok) {
  switch (def.kind) {
    case 'string':
      if (tok.t !== 'string') return false;
      if (def.constant) return def.ignoreCase ? def.constant.toUpperCase() === tok.value.toUpperCase() : def.constant === tok.value;
      return def.requireNonEmpty ? !!tok.value : true;
    case 'number': return tok.t === 'number';
    case 'boolean': return tok.t === 'boolean';
    case 'null': return tok.t === 'null';
    default: return false;
  }
}

function matchPropertyAndFilter(mappingDefs, name) {
  let result; let missingInSome = false;
  for (const d of mappingDefs) { if (d.properties[name]) result = d.properties[name]; else missingInSome = true; }
  if (result && missingInSome) for (let i = 0; i < mappingDefs.length;) { if (mappingDefs[i].properties[name]) i++; else mappingDefs.splice(i, 1); }
  return result;
}

export function readWorkflowTokens(text, { root = WORKFLOW_ROOT } = {}) {
  const reader = new Reader();
  let tree;
  try { tree = parseYaml(text); } catch (e) {
    if (!(e instanceof YamlError)) throw e;
    return { tokens: undefined, errors: [{ message: e.message, line: e.line || 0, col: e.col || 0 }], expressions: [] };
  }
  if (tree.type === 'scalar' && tree.line === 0) return { tokens: undefined, errors: [{ message: 'Expected a scalar value, a sequence, or a mapping', line: 0, col: 0 }], expressions: [] };
  const tokens = reader.readValue(tree, info(undefined, root));
  return { tokens, errors: reader.errors, expressions: reader.expressions };
}

// ── the converter: tokens to the model ───────────────────────────────────────────────────────────
const mapGet = (tok, key) => tok.entries.find((e) => e.key.t === 'string' && e.key.value === key)?.value;
const keyText = (e) => (e.key.t === 'string' ? e.key.value : tokenText(e.key));

class Converter {
  constructor(errors) { this.errors = errors; }
  error(at, message) { this.errors.push({ message, line: at?.line ?? 0, col: at?.col ?? 0 }); }

  assert(tok, kinds, what) {
    if (!kinds.includes(tok.t)) throw new ConvertError(`Unexpected type '${tok.t}' encountered while reading '${what}'. The type '${kinds.join("' or '")}' was expected.`, tok);
    return tok;
  }

  guarded(at, fallback, fn) {
    try { return fn(); } catch (e) {
      if (e instanceof ConvertError) { this.error(e.token || at, e.message); return fallback; }
      throw e;
    }
  }

  convert(root) {
    const model = { events: {}, jobs: [] };
    if (root.t !== 'map') { this.error(root, "Unexpected type 'root'"); return model; }
    for (const e of root.entries) {
      switch (keyText(e)) {
        case 'on': model.events = this.guarded(root, {}, () => this.convertOn(e.value)); break;
        case 'jobs': model.jobs = this.guarded(root, [], () => this.convertJobs(e.value)); break;
        case 'concurrency': this.guarded(root, {}, () => this.convertConcurrency(e.value)); model.concurrency = serializeToken(e.value); break;
        case 'env': model.env = serializeToken(e.value); break;
        case 'name': model.name = serializeToken(e.value); break;
        case 'run-name': model.runName = serializeToken(e.value); break;
        case 'permissions': model.permissions = serializeToken(e.value); break;
        case 'defaults': model.defaults = serializeToken(e.value); break;
        default: break;
      }
    }
    return model;
  }

  convertOn(tok) {
    if (isScalarToken(tok)) return { [this.assert(tok, ['string'], 'on').value]: {} };
    if (tok.t === 'seq') { const out = {}; for (const i of tok.items) out[this.assert(i, ['string'], 'on').value] = {}; return out; }
    const out = {};
    for (const e of tok.entries) {
      const name = this.assert(e.key, ['string'], 'event name').value;
      if (e.value.t === 'null') { out[name] = {}; continue; }
      if (name === 'schedule') { out.schedule = this.convertSchedule(this.assert(e.value, ['seq'], 'event schedule')); continue; }
      const m = this.assert(e.value, ['map'], `event ${name}`);
      if (name === 'workflow_call') { out.workflow_call = this.convertWorkflowCall(m); continue; }
      if (name === 'workflow_dispatch') { out.workflow_dispatch = this.convertWorkflowDispatch(m); continue; }
      out[name] = { ...this.patternFilter('branches', m), ...this.patternFilter('tags', m), ...this.patternFilter('paths', m), ...this.listFilter('types', m), ...this.listFilter('versions', m), ...this.listFilter('names', m), ...this.listFilter('workflows', m) };
    }
    return out;
  }

  stringList(name, tok) { return tok.items.map((i) => this.assert(i, ['string'], `${name} item`).value); }

  patternFilter(name, m) {
    const out = {};
    for (const e of m.entries) {
      const k = this.assert(e.key, ['string'], `${name} filter key`).value;
      if (k === name || k === `${name}-ignore`) out[k] = e.value.t === 'string' ? [e.value.value] : this.stringList(k, this.assert(e.value, ['seq'], `${k} list`));
    }
    return out;
  }

  listFilter(name, m) {
    const out = {};
    for (const e of m.entries) {
      const k = this.assert(e.key, ['string'], `${name} filter key`).value;
      if (k === name) out[k] = e.value.t === 'string' ? [e.value.value] : this.stringList(k, this.assert(e.value, ['seq'], `${k} list`));
    }
    return out;
  }

  convertSchedule(seq) {
    const out = [];
    for (const item of seq.items) {
      const m = this.assert(item, ['map'], 'event schedule');
      const config = { cron: '' }; let valid = true;
      for (const e of m.entries) {
        const k = this.assert(e.key, ['string'], 'schedule key').value;
        if (k === 'cron') {
          const cron = this.assert(e.value, ['string'], 'schedule cron');
          if (!isValidCron(cron.value)) this.error(cron, "Invalid cron expression. Expected format: '* * * * *' (minute hour day month weekday)");
          config.cron = cron.value;
        } else if (k === 'timezone') config.timezone = this.assert(e.value, ['string'], 'schedule timezone').value;
        else { this.error(e.key, 'Invalid schedule key'); valid = false; }
      }
      if (valid && config.cron) out.push(config);
      else if (valid) this.error(m, "Missing required key 'cron' in schedule entry");
    }
    return out;
  }

  convertInputs(m, allowExpressionDefault) {
    const out = {};
    for (const e of m.entries) {
      const name = this.assert(e.key, ['string'], 'input name').value;
      const cfg = this.assert(e.value, ['map'], 'input configuration');
      const input = { type: 'string' }; let def;
      for (const p of cfg.entries) {
        const k = this.assert(p.key, ['string'], 'workflow dispatch input key').value;
        switch (k) {
          case 'description': input.description = this.assert(p.value, ['string'], 'input description').value; break;
          case 'required': input.required = this.assert(p.value, ['boolean'], 'input required').value; break;
          case 'default': def = this.assert(p.value, ['string', 'number', 'boolean', 'null', 'expr'], 'input default'); break;
          case 'type': input.type = this.assert(p.value, ['string'], 'input type').value; break;
          case 'options': input.options = this.stringList('input options', this.assert(p.value, ['seq'], 'input options')); break;
          default: this.error(p.key, `Invalid key '${k}'`);
        }
      }
      if (def !== undefined && !(allowExpressionDefault && def.t === 'expr')) {
        try {
          if (input.type === 'boolean') input.default = this.assert(def, ['boolean'], 'input default').value;
          else if (['string', 'choice', 'environment'].includes(input.type)) input.default = this.assert(def, ['string'], 'input default').value;
        } catch (err) { if (err instanceof ConvertError) this.error(def, err.message); else throw err; }
      }
      if (input.type === 'choice') { if (!input.options || input.options.length === 0) this.error(cfg, "Missing 'options' for choice input"); }
      else if (input.options !== undefined) this.error(cfg, "Input type is not 'choice', but 'options' is defined");
      out[name] = input;
    }
    return out;
  }

  convertWorkflowDispatch(m) {
    const out = {};
    for (const e of m.entries) if (this.assert(e.key, ['string'], 'workflow dispatch input key').value === 'inputs') out.inputs = this.convertInputs(this.assert(e.value, ['map'], 'workflow dispatch inputs'), false);
    return out;
  }

  convertWorkflowCall(m) {
    const out = {};
    for (const e of m.entries) {
      const k = this.assert(e.key, ['string'], 'workflow dispatch input key').value;
      if (k === 'inputs') out.inputs = this.convertInputs(this.assert(e.value, ['map'], 'workflow dispatch inputs'), true);
      else if (k === 'secrets') {
        out.secrets = {};
        for (const s of this.assert(e.value, ['map'], 'workflow dispatch inputs').entries) {
          const name = this.assert(s.key, ['string'], 'secret name').value;
          const secret = {};
          if (s.value.t === 'map') for (const p of s.value.entries) {
            const pk = this.assert(p.key, ['string'], 'workflow call secret key').value;
            if (pk === 'description') secret.description = this.assert(p.value, ['string'], 'secret description').value;
            else if (pk === 'required') secret.required = this.assert(p.value, ['boolean'], 'secret required').value;
          }
          out.secrets[name] = secret;
        }
      }
    }
    return out;
  }

  convertConcurrency(tok) {
    if (isExpressionToken(tok) || tok.t === 'string') return;
    const m = this.assert(tok, ['map'], 'concurrency group');
    for (const e of m.entries) {
      const name = this.assert(e.key, ['string'], 'concurrency group key').value;
      if (isExpressionToken(e.value)) continue;
      if (name === 'group') this.assert(e.value, ['string'], 'concurrency group');
      else if (name === 'cancel-in-progress') this.assert(e.value, ['boolean'], 'cancel-in-progress');
      else if (name === 'queue') this.assert(e.value, ['string'], 'queue');
      else this.error(e.key, `Invalid property name: ${name}`);
    }
  }

  convertJobs(tok) {
    if (tok.t !== 'map') { this.error(tok, 'Invalid format for jobs'); return []; }
    const jobs = [];
    const satisfied = []; const unsatisfied = [];
    for (const e of tok.entries) {
      const key = this.assert(e.key, ['string'], 'job name');
      const job = this.guarded(tok, undefined, () => this.convertJob(key, this.assert(e.value, ['map'], `job ${key.value}`)));
      if (!job) continue;
      jobs.push(job);
      const node = { name: job.id, needs: [...(job.needs || [])] };
      (node.needs.length ? unsatisfied : satisfied).push(node);
    }
    if (satisfied.length === 0) { this.error(tok, 'The workflow must contain at least one job with no dependencies.'); return jobs; }
    while (satisfied.length) {
      const current = satisfied.shift();
      for (let i = unsatisfied.length - 1; i >= 0; i--) {
        const u = unsatisfied[i];
        for (let j = u.needs.length - 1; j >= 0; j--) {
          if (u.needs[j] === current.name) { u.needs.splice(j, 1); if (u.needs.length === 0) { satisfied.push(u); unsatisfied.splice(i, 1); } }
        }
      }
    }
    const names = jobs.map((j) => j.id);
    for (const u of unsatisfied) for (const need of u.needs) {
      const at = jobs.find((j) => j.id === u.name)?.needsAt?.[need];
      this.error(at, names.includes(need) ? `Job '${u.name}' depends on job '${need}' which creates a cycle in the dependency graph.` : `Job '${u.name}' depends on unknown job '${need}'.`);
    }
    return jobs;
  }

  convertJob(key, m) {
    const idError = checkId(new Set(), key.value);
    if (idError) this.error(key, idError);
    const job = { id: key.value, line: key.line };
    let name; let needs; let steps = []; let uses; let withValues; let secrets; let inherit = false;
    const needsAt = {};
    for (const e of m.entries) {
      const prop = this.assert(e.key, ['string'], 'job property name').value;
      const v = e.value;
      switch (prop) {
        case 'concurrency': this.guarded(v, undefined, () => this.convertConcurrency(v)); job.concurrency = serializeToken(v); break;
        case 'container': this.convertContainer(v, false); job.container = serializeToken(v); break;
        case 'env': this.guarded(v, undefined, () => { job.env = serializeToken(this.assert(v, ['map'], 'job env')); }); break;
        case 'environment': this.guarded(v, undefined, () => this.convertEnvironment(v)); job.environment = serializeToken(v); break;
        case 'if': job.if = this.convertIf(v); break;
        case 'name': name = this.assert(v, ['string', 'number', 'boolean', 'null', 'expr'], 'job name'); break;
        case 'needs':
          needs = [];
          if (v.t === 'string') needs.push(v);
          if (v.t === 'seq') for (const i of v.items) needs.push(this.assert(i, ['string'], 'job needs id'));
          break;
        case 'outputs': this.guarded(v, undefined, () => { job.outputs = serializeToken(this.assert(v, ['map'], 'job outputs')); }); break;
        case 'runs-on': this.guarded(v, undefined, () => this.convertRunsOn(v)); job.runsOn = serializeToken(v); break;
        case 'services': this.convertServices(v); job.services = serializeToken(v); break;
        case 'snapshot': job.snapshot = serializeToken(v); break;
        case 'steps': steps = this.convertSteps(v); break;
        case 'strategy': job.strategy = serializeToken(v); break;
        case 'uses': uses = this.assert(v, ['string'], 'job uses value'); break;
        case 'with': this.guarded(v, undefined, () => { withValues = serializeToken(this.assert(v, ['map'], 'uses-with value')); }); break;
        case 'secrets':
          if (v.t === 'string' && v.value === 'inherit') inherit = true;
          else this.guarded(v, undefined, () => { secrets = serializeToken(this.assert(v, ['map'], 'uses-secrets value')); });
          break;
        case 'permissions': job.permissions = serializeToken(v); break;
        case 'defaults': job.defaults = serializeToken(v); break;
        case 'timeout-minutes': job.timeoutMinutes = serializeToken(v); break;
        case 'cancel-timeout-minutes': job.cancelTimeoutMinutes = serializeToken(v); break;
        case 'continue-on-error': job.continueOnError = serializeToken(v); break;
        default: break;
      }
    }
    for (const n of needs || []) needsAt[n.value] = n;
    job.needsAt = needsAt;
    job.name = name === undefined || (name.t === 'string' && name.value === '') ? key.value : serializeToken(name);
    job.if = job.if || 'success()';
    if (uses !== undefined) {
      job.type = 'reusableWorkflowJob';
      job.needs = (needs || []).map((n) => n.value);
      job.ref = uses.value;
      if (withValues !== undefined) job.inputValues = withValues;
      if (secrets !== undefined) job.secretValues = secrets;
      if (inherit) job.inheritSecrets = true;
    } else {
      job.type = 'job';
      if (needs !== undefined) job.needs = needs.map((n) => n.value);
      job.steps = steps;
    }
    return job;
  }

  convertIf(tok) {
    const scalar = this.assert(tok, ['string', 'number', 'boolean', 'null', 'expr'], 'if condition');
    const allowed = tok.def?.allowedContext || [];
    let condition;
    if (scalar.t === 'expr') condition = scalar.expression;
    else condition = this.assert(scalar, ['string'], 'if condition').value.trim();
    let final = condition ? ensureStatusFunction(condition, allowed) : 'success()';
    try { parseExpression(final, splitAllowedContext(allowed)); } catch (e) { this.error(tok, e.message); return undefined; }
    return final;
  }

  convertRunsOn(tok) {
    if (tok.t !== 'map') { if (tok.t === 'seq') for (const i of tok.items) if (!isExpressionToken(i)) this.assert(i, ['string'], 'job runs-on label sequence item'); return; }
    for (const e of tok.entries) {
      const k = this.assert(e.key, ['string'], 'job runs-on property name').value;
      if (k === 'group') {
        if (isExpressionToken(e.value)) continue;
        const group = this.assert(e.value, ['string'], 'job runs-on group name').value;
        const names = group.split('/');
        if (names.length === 2) {
          if (!['org', 'organization', 'ent', 'enterprise'].includes(names[0])) this.error(e.value, `Invalid runs-on group name '${group}. Please use 'organization/' or 'enterprise/' prefix to target a single runner group.'`);
          else if (!names[1]) this.error(e.value, `Invalid runs-on group name '${group}'.`);
        } else if (names.length > 2) this.error(e.value, `Invalid runs-on group name '${group}. Please use 'organization/' or 'enterprise/' prefix to target a single runner group.'`);
      } else if (k === 'labels' && !isExpressionToken(e.value) && e.value.t === 'seq') {
        for (const i of e.value.items) if (!isExpressionToken(i)) this.assert(i, ['string'], 'job runs-on label sequence item');
      }
    }
  }

  convertContainer(tok, isService) {
    if (hasExpression(tok)) return;
    if (tok.t === 'string') return;
    this.guarded(tok, undefined, () => {
      const m = this.assert(tok, ['map'], 'container item');
      let image;
      for (const e of m.entries) {
        const k = this.assert(e.key, ['string'], 'container item key').value;
        switch (k) {
          case 'image': image = this.assert(e.value, ['string'], 'container image'); break;
          case 'credentials': this.convertCredentials(e.value); break;
          case 'env': for (const x of this.assert(e.value, ['map'], 'container env').entries) this.assert(x.key, ['string'], 'container env value'); break;
          case 'ports': for (const p of this.assert(e.value, ['seq'], 'container ports').items) this.assert(p, ['string'], 'container port'); break;
          case 'volumes': for (const p of this.assert(e.value, ['seq'], 'container volumes').items) this.assert(p, ['string'], 'container volume'); break;
          case 'options': this.assert(e.value, ['string'], 'container options'); break;
          case 'entrypoint': if (isService) { this.assert(e.value, ['string'], 'container entrypoint'); break; } this.error(e.key, `Unexpected container item key: ${k}`); break;
          case 'command': if (isService) { this.assert(e.value, ['string'], 'container command'); break; } this.error(e.key, `Unexpected container item key: ${k}`); break;
          default: this.error(e.key, `Unexpected container item key: ${k}`);
        }
      }
      if (!image) this.error(tok, 'Container image cannot be empty');
    });
  }

  convertCredentials(tok) {
    const m = this.assert(tok, ['map'], 'container credentials');
    for (const e of m.entries) {
      const k = this.assert(e.key, ['string'], 'container credentials key').value;
      if (k === 'username' || k === 'password') { if (!isExpressionToken(e.value)) this.assert(e.value, ['string'], `container credentials ${k}`); }
      else this.error(e.key, `Unexpected container credentials key: ${k}`);
    }
  }

  convertServices(tok) {
    if (hasExpression(tok)) return;
    this.guarded(tok, undefined, () => {
      const m = this.assert(tok, ['map'], 'services');
      for (const e of m.entries) { this.assert(e.key, ['string'], 'service name'); this.convertContainer(e.value, true); }
    });
  }

  convertEnvironment(tok) {
    if (isExpressionToken(tok) || isScalarToken(tok)) return;
    const m = this.assert(tok, ['map'], 'job environment');
    for (const e of m.entries) {
      const k = this.assert(e.key, ['string'], 'job environment key').value;
      if (isExpressionToken(e.value)) continue;
      if (k === 'name') this.assert(e.value, ['string', 'number', 'boolean', 'null'], 'job environment name key');
      else if (k === 'deployment') this.assert(e.value, ['boolean'], 'job environment deployment');
    }
  }

  convertSteps(tok) {
    if (tok.t !== 'seq') { this.error(tok, 'Invalid format for steps'); return []; }
    const known = new Set();
    const steps = [];
    for (const item of tok.items) {
      const step = this.guarded(tok, undefined, () => this.convertStep(known, item));
      if (step) steps.push(step);
    }
    const ids = new IdBuilder(known);
    for (const s of steps) {
      if (s.id) continue;
      s.id = ids.build(`__${s.parallel ? 'parallel' : s.uses !== undefined ? actionStepId(s.uses) || 'run' : 'run'}`);
    }
    return steps;
  }

  convertStep(known, item) {
    const m = this.assert(item, ['map'], 'steps item');
    const step = { line: m.line };
    let id; let run; let uses; let parallel;
    for (const e of m.entries) {
      const k = this.assert(e.key, ['string'], 'steps item key').value;
      const v = e.value;
      switch (k) {
        case 'id': {
          id = this.assert(v, ['string'], 'steps item id');
          const err = checkId(known, id.value);
          if (err) this.error(id, err);
          break;
        }
        case 'name': step.name = serializeToken(this.assert(v, ['string', 'number', 'boolean', 'null', 'expr'], 'steps item name')); break;
        case 'run': run = this.assert(v, ['string', 'number', 'boolean', 'null', 'expr'], 'steps item run'); break;
        case 'uses': uses = this.assert(v, ['string'], 'steps item uses'); break;
        case 'env': step.env = serializeToken(this.assert(v, ['map'], 'step env')); break;
        case 'if': step.if = this.convertIf(v); break;
        case 'with': step.with = serializeToken(v); break;
        case 'shell': step.shell = serializeToken(v); break;
        case 'working-directory': step.workingDirectory = serializeToken(v); break;
        case 'timeout-minutes': step.timeoutMinutes = serializeToken(v); break;
        case 'continue-on-error': step.continueOnError = isExpressionToken(v) ? serializeToken(v) : this.assert(v, ['boolean'], 'steps item continue-on-error').value; break;
        case 'parallel': parallel = v; break;
        default: break;
      }
    }
    step.id = id ? id.value : '';
    if (parallel !== undefined) {
      const inner = this.convertSteps(parallel);
      for (const p of inner) if (p.parallel) this.error(item, "Nested 'parallel' blocks are not allowed.");
      return { id: step.id, line: step.line, name: step.name === undefined ? 'Parallel group' : step.name, continueOnError: step.continueOnError, parallel: inner };
    }
    step.if = step.if || 'success()';
    if (run !== undefined) { step.run = serializeToken(run); return step; }
    if (uses !== undefined) { step.uses = uses.value; return step; }
    this.error(item, 'Expected one of uses or run to be defined');
    return undefined;
  }
}

class ConvertError extends Error { constructor(message, token) { super(message); this.token = token; } }

function hasExpression(tok) {
  if (isExpressionToken(tok)) return true;
  if (tok.t === 'map') return tok.entries.some((e) => hasExpression(e.key) || hasExpression(e.value));
  if (tok.t === 'seq') return tok.items.some(hasExpression);
  return false;
}

export function ensureStatusFunction(condition, allowedContext) {
  try {
    const ast = parseExpression(condition, splitAllowedContext(allowedContext));
    return containsStatusFunction(ast) ? condition : `success() && (${condition})`;
  } catch (e) {
    if (e instanceof ExpressionError) return condition;
    throw e;
  }
}

const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isNum = (c) => c >= '0' && c <= '9';

function checkId(known, value) {
  const valid = value && (isAlpha(value[0]) || value[0] === '_') && [...value.slice(1)].every((c) => isAlpha(c) || isNum(c) || c === '_' || c === '-');
  if (!valid || value.length >= ID_MAX_LENGTH) return `The identifier '${value}' is invalid. IDs may only contain alphanumeric characters, '_', and '-'. IDs must start with a letter or '_' and and must be less than ${ID_MAX_LENGTH} characters.`;
  if (value.startsWith('__')) return `The identifier '${value}' is invalid. IDs starting with '__' are reserved.`;
  if (known.has(value)) return `The identifier '${value}' may not be used more than once within the same scope.`;
  known.add(value);
  return undefined;
}

class IdBuilder {
  constructor(known) { this.known = known; }
  build(segment) {
    const chars = [];
    const first = segment[0];
    if (isNum(first) || first === '-') chars.push('_');
    for (const c of segment) chars.push(isAlpha(c) || isNum(c) || c === '_' || c === '-' ? c : '_');
    const base = chars.length ? chars.join('') : 'job';
    for (let attempt = 1; attempt < 1000; attempt++) {
      const suffix = attempt === 1 ? '' : `_${attempt}`;
      const candidate = base.slice(0, Math.min(base.length, ID_MAX_LENGTH - suffix.length)) + suffix;
      if (!this.known.has(candidate)) { this.known.add(candidate); return candidate; }
    }
    throw new Error('Unable to create a unique name');
  }
}

export function actionStepId(uses) {
  if (uses.startsWith('docker://')) return uses.slice('docker://'.length);
  if (uses.startsWith('./') || uses.startsWith('.\\') || uses.startsWith('$/')) return 'self';
  const parts = uses.split('@');
  if (parts.length !== 2) return '';
  const path = parts[0].split(/[\\/]/).filter((s) => s.length > 0);
  return path.length >= 2 && path[0] && path[1] && parts[1] ? `${path[0]}/${path[1]}` : '';
}

// ── cron ─────────────────────────────────────────────────────────────────────────────────────────
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const RANGES = [{ min: 0, max: 59 }, { min: 0, max: 23 }, { min: 1, max: 31 }, { min: 1, max: 12, names: MONTHS }, { min: 0, max: 6, names: DAYS }];

export function isValidCron(cron) {
  const parts = cron.split(/ +/);
  return parts.length === 5 && parts.every((p, i) => validCronPart(p, RANGES[i]));
}

function validCronPart(value, range, allowSeparators = true) {
  if (range.names && range.names[value.toLowerCase()] !== undefined) return true;
  if (value === '*') return true;
  if (value.includes(',')) return allowSeparators && value.split(',').every((v) => v && validCronPart(v, range));
  if (value.includes('/')) {
    if (!allowSeparators) return false;
    const [start, step, ...rest] = value.split('/');
    const n = +step;
    if (rest.length > 0 || Number.isNaN(n) || n <= 0 || !start || !step) return false;
    return validCronPart(start, range) && validCronPart(step, range, false);
  }
  if (value.includes('-')) {
    if (!allowSeparators) return false;
    const [start, end, ...rest] = value.split('-');
    if (rest.length > 0 || !start || !end) return false;
    return validCronPart(start, range, false) && validCronPart(end, range, false);
  }
  if (!/^\d+$/.test(value)) return false;
  const n = +value;
  return n >= range.min && n <= range.max;
}

// ── matrix expansion ─────────────────────────────────────────────────────────────────────────────
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// GitHub's rule: an include object joins every combination it does not contradict on an original
// key, adding only new keys; one that fits nowhere becomes a combination of its own.
export function expandMatrix(matrix) {
  if (!matrix || typeof matrix !== 'object') return [];
  const keys = Object.keys(matrix).filter((k) => k !== 'include' && k !== 'exclude');
  let combos = [{}];
  for (const k of keys) {
    const values = Array.isArray(matrix[k]) ? matrix[k] : [matrix[k]];
    combos = combos.flatMap((c) => values.map((v) => ({ ...c, [k]: v })));
  }
  if (keys.length === 0) combos = [];
  const exclude = Array.isArray(matrix.exclude) ? matrix.exclude : [];
  combos = combos.filter((c) => !exclude.some((ex) => Object.keys(ex).every((k) => k in c && same(c[k], ex[k]))));
  const original = combos.map((c) => ({ ...c }));
  const extra = [];
  for (const inc of Array.isArray(matrix.include) ? matrix.include : []) {
    const fits = combos.map((c, i) => [c, i]).filter(([, i]) => keys.every((k) => !(k in inc) || same(original[i][k], inc[k])));
    if (fits.length === 0 || keys.length === 0) { extra.push({ ...inc }); continue; }
    for (const [c] of fits) for (const [k, v] of Object.entries(inc)) if (!keys.includes(k)) c[k] = v;
  }
  return [...combos, ...extra];
}

// ── entry ────────────────────────────────────────────────────────────────────────────────────────
export function parseWorkflow(text, { name = 'workflow.yml' } = {}) {
  const read = readWorkflowTokens(text);
  const result = { name, tokens: read.tokens, errors: [...read.errors], expressions: read.expressions, model: undefined };
  if (!read.tokens) return result;
  if (read.errors.length === 0) result.model = new Converter(result.errors).convert(read.tokens);
  return result;
}

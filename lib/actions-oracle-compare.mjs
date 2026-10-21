// Compares the in-tree workflow reader with GitHub's @actions/workflow-parser on one file: first
// the validated token trees, then the converted jobs and steps. Used by tests and bin/actions-grade.

import { parseWorkflow, serializeToken } from './actions-workflow.mjs';

// GitHub's parser builds a multi-line scalar's expression from the raw source lines; the model
// builds it from the decoded value. Indentation, folding, line endings and a whitespace-only
// format() wrapper around one expression are therefore set aside before comparing.
function dedent(s) {
  if (s === undefined) return undefined;
  const unwrap = (text) => text
    .replace(/^format\('["'\s]*\{0\}["'\s]*', ([\s\S]*)\)$/, '$1')
    .replace(/^format\('"([\s\S]*)"'/, "format('$1'")
    .replace(/^format\('''([\s\S]*)'''/, "format('$1'");
  let text = unwrap(s);
  const guarded = /^(success|always|failure|cancelled)\(\) && \(([\s\S]*)\)$/.exec(text);
  if (guarded) text = `${guarded[1]}() && (${unwrap(guarded[2])})`;
  return text.replace(/\s+/g, ' ').replace(/' /g, "'").replace(/ '/g, "'").trim();
}

function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    if (v.type === 3 && typeof v.expr === 'string') return { type: 3, expr: dedent(v.expr) };
    const out = {};
    for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = normalize(v[k]);
    return out;
  }
  return v;
}

const show = (v) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 80 ? `${s.slice(0, 77)}...` : s; };

export function firstDifference(a, b, path = '$') {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: ${show(a)} vs ${show(b)}`;
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDifference(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return undefined;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) { const d = firstDifference(a[k], b[k], `${path}.${k}`); if (d) return d; }
    return undefined;
  }
  if (Number.isNaN(a) && Number.isNaN(b)) return undefined;
  return a === b ? undefined : `${path}: ${show(a)} vs ${show(b)}`;
}

const tokenJson = (t) => (t === undefined ? undefined : JSON.parse(JSON.stringify(t)));
const exprOf = (t) => (t === undefined ? undefined : t.toJSON().expr);

const oracleStep = (s) => ({
  id: s.id,
  name: tokenJson(s.name),
  if: dedent(exprOf(s.if)),
  run: tokenJson(s.run),
  uses: s.uses === undefined ? undefined : s.uses.value,
  env: tokenJson(s.env),
  continueOnError: typeof s['continue-on-error'] === 'object' ? tokenJson(s['continue-on-error']) : s['continue-on-error'],
  parallel: s.parallel === undefined ? undefined : s.parallel.map(oracleStep),
});

const mineStep = (s) => ({
  id: s.id,
  name: s.name,
  if: dedent(s.if),
  run: s.run,
  uses: s.uses,
  env: s.env,
  continueOnError: s.continueOnError,
  parallel: s.parallel === undefined ? undefined : s.parallel.map(mineStep),
});

function projectOracle(template) {
  return {
    events: template.events,
    jobs: (template.jobs || []).map((j) => ({
      id: j.id.value,
      type: j.type,
      name: tokenJson(j.name),
      needs: j.needs === undefined ? undefined : j.needs.map((n) => n.value),
      if: dedent(exprOf(j.if)),
      env: tokenJson(j.env),
      concurrency: tokenJson(j.concurrency),
      environment: tokenJson(j.environment),
      strategy: tokenJson(j.strategy),
      runsOn: tokenJson(j['runs-on']),
      container: tokenJson(j.container),
      services: tokenJson(j.services),
      outputs: tokenJson(j.outputs),
      ref: j.ref === undefined ? undefined : j.ref.value,
      inputValues: tokenJson(j['input-values']),
      secretValues: tokenJson(j['secret-values']),
      inheritSecrets: j['inherit-secrets'],
      steps: j.steps === undefined ? undefined : j.steps.map(oracleStep),
    })),
  };
}

// GitHub's parser has no `number` in its input-type enum and drops the type; the model keeps it.
function eventsForComparison(events) {
  const out = JSON.parse(JSON.stringify(events));
  for (const ev of ['workflow_call', 'workflow_dispatch']) for (const input of Object.values(out[ev]?.inputs || {})) if (input.type === 'number') delete input.type;
  return out;
}

function projectMine(model) {
  return {
    events: eventsForComparison(model.events),
    jobs: model.jobs.map((j) => ({
      id: j.id,
      type: j.type,
      name: j.name,
      needs: j.needs,
      if: dedent(j.if),
      env: j.env,
      concurrency: j.concurrency,
      environment: j.environment,
      strategy: j.strategy,
      runsOn: j.runsOn,
      container: j.container,
      services: j.services,
      outputs: j.outputs,
      ref: j.ref,
      inputValues: j.inputValues,
      secretValues: j.secretValues,
      inheritSecrets: j.inheritSecrets,
      steps: j.steps === undefined ? undefined : j.steps.map(mineStep),
    })),
  };
}

export async function compareWorkflow(text, name, oracle) {
  const mine = parseWorkflow(text, { name });
  const { parseWorkflow: oracleParse, convertWorkflowTemplate, NoOperationTraceWriter } = oracle.workflowParser;
  const read = oracleParse({ name, content: text }, new NoOperationTraceWriter());
  let template;
  if (read.value && read.context.errors.getErrors().length === 0) {
    try { template = await convertWorkflowTemplate(read.context, read.value); } catch (e) { read.context.error(read.value, e); }
  }
  const oracleErrors = read.context.errors.getErrors().map((e) => e.message);
  const mineErrors = mine.errors.map((e) => `line ${e.line}: ${e.message}`);
  if (mineErrors.length && oracleErrors.length) return { status: 'both-refused', detail: `${mineErrors[0]} | ${oracleErrors[0]}` };
  if (mineErrors.length) return { status: 'mine-refused', detail: mineErrors[0] };
  if (oracleErrors.length) return { status: 'oracle-refused', detail: oracleErrors[0] };
  const tokenDiff = firstDifference(normalize(serializeToken(mine.tokens)), normalize(tokenJson(read.value)));
  if (tokenDiff) return { status: 'disagree', detail: `tokens ${tokenDiff}` };
  const modelDiff = firstDifference(normalize(projectMine(mine.model)), normalize(projectOracle(template)));
  if (modelDiff) return { status: 'disagree', detail: `model ${modelDiff}` };
  return { status: 'agree', detail: '' };
}

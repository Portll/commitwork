// monitor/malicious-content-evidence.mjs — the deps-content, vendor-scan and model-artefacts reports
// read as contentEvidence subjects. A static capability stays a candidate; a surface its producer never
// inspected is not-examined; what a producer counted but did not list is stated as a bound.

import { contentEvidence } from '../lib/security-malicious-content-evidence.mjs';

const DEP_CAPABILITY = Object.freeze({ 'dep-install-exec': 'install-hook', 'dep-install-script': 'install-hook' });
const DEP_INTEGRITY = new Set(['dep-missing-integrity', 'dep-weak-integrity', 'dep-version-drift']);
// pickle-dangerous-global is an opcode walk that found a dangerous import the loader will perform, so it
// is demonstrated; every other model rule reads a capability that needs context to judge.
const MODEL_RULE = Object.freeze({
  'pickle-dangerous-global': { observed: 'dangerous-opcode-demonstrated' },
  'keras-lambda-layer': { capability: 'unsafe-deserializer-reference' },
  'tf-graph-python-op': { capability: 'dynamic-eval' },
  'dataset-config-template': { capability: 'dynamic-eval' },
  'dataset-config-remote-scheme': { capability: 'remote-data-path' },
  'hf-trust-remote-code': { capability: 'dynamic-eval' },
  'hf-unpinned-revision': { integrity: true },
});
const MODEL_FILE = /\.(pkl|pickle|pt|pth|bin|ckpt|joblib|safetensors|keras|h5|hdf5|pb|pbtxt)$/i;

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byRow = (a, b) => byCodePoint(a.producer, b.producer) || byCodePoint(a.path, b.path) || byCodePoint(a.rule, b.rule) || byCodePoint(a.detail, b.detail);

function report(value, tool, name) {
  if (value == null) return null;
  if (typeof value !== 'object' || value.tool !== tool) throw new TypeError(`${name} must be a ${tool} report`);
  if (!value.summary || typeof value.summary !== 'object') throw new TypeError(`${name}.summary must be an object`);
  if (!Array.isArray(value.findings)) throw new TypeError(`${name}.findings must be an array`);
  for (const [i, f] of value.findings.entries()) {
    const path = tool === 'vendor-scan' ? f?.file : f?.path;
    if (typeof path !== 'string' || path === '') throw new TypeError(`${name}.findings[${i}] has no path`);
  }
  return value;
}

function subjectFor(subjects, id, type, scannerOutcome) {
  if (!subjects.has(id)) subjects.set(id, { id, type, scannerOutcome, advisoryIds: [], evidence: { observed: [], static: [], unreadable: [] } });
  return subjects.get(id);
}

function readDependencies(rep, out) {
  if (!rep) return { state: 'not-run' };
  const s = rep.summary;
  if (s.couldNotRun) return { state: 'could-not-run', reason: String(s.couldNotRun) };
  if (s.noLockfile) return { state: 'void', reason: 'no lockfile' };
  for (const f of rep.findings) {
    if (DEP_CAPABILITY[f.rule]) {
      subjectFor(out.subjects, `dependency:${f.path}`, 'installed-dependency', 'completed')
        .evidence.static.push({ capability: DEP_CAPABILITY[f.rule], detail: `${f.rule}: ${f.detail ?? ''}` });
    } else if (DEP_INTEGRITY.has(f.rule)) {
      out.integrity.push({ producer: 'deps-content', path: f.path, rule: f.rule, detail: String(f.detail ?? '') });
    } else {
      out.unmapped.push({ producer: 'deps-content', path: f.path, rule: String(f.rule), detail: String(f.detail ?? '') });
    }
  }
  return { state: 'ran', examined: s.packagesChecked ?? null, scope: 'install hooks and integrity of lockfile packages; other package content not read' };
}

function readVendored(rep, out) {
  if (!rep) return { state: 'not-run' };
  const advisories = new Map();
  for (const f of rep.findings) {
    if (typeof f.id === 'string' && f.id) (advisories.get(f.file) ?? advisories.set(f.file, new Set()).get(f.file)).add(f.id);
  }
  for (const list of ['identified', 'unidentified']) {
    if (!Array.isArray(rep[list])) throw new TypeError(`vendorReport.${list} must be an array`);
    for (const v of rep[list]) {
      if (typeof v?.file !== 'string' || v.file === '') throw new TypeError(`vendorReport.${list} entry has no file`);
      const subject = subjectFor(out.subjects, `vendored:${v.file}`, 'vendored-javascript', 'unavailable');
      subject.advisoryIds = [...(advisories.get(v.file) ?? [])].sort(byCodePoint);
    }
  }
  return {
    state: rep.ran ? 'ran' : 'advisories-incomplete',
    ...(rep.ran ? {} : { reason: String(rep.reason ?? 'advisory lookup did not run') }),
    examined: rep.summary.scanned ?? null,
    scope: 'version identity and advisory lookup only; vendored content not inspected',
  };
}

function readModels(rep, out) {
  if (!rep) return { state: 'not-run' };
  const s = rep.summary;
  const typeOf = (path) => (MODEL_FILE.test(path) ? 'model-serialization' : 'dataset-loader');
  for (const f of rep.findings) {
    const m = MODEL_RULE[f.rule];
    const detail = `${f.rule}: ${f.detail ?? ''}`;
    if (m?.integrity) { out.integrity.push({ producer: 'model-artefacts', path: f.path, rule: f.rule, detail: String(f.detail ?? '') }); continue; }
    if (!m) { out.unmapped.push({ producer: 'model-artefacts', path: f.path, rule: String(f.rule), detail: String(f.detail ?? '') }); continue; }
    const subject = subjectFor(out.subjects, `model:${f.path}`, typeOf(f.path), 'completed');
    if (m.observed) subject.evidence.observed.push({ behaviour: m.observed, detail });
    else subject.evidence.static.push({ capability: m.capability, detail });
  }
  const gap = (path, reason, detail) => {
    subjectFor(out.subjects, `model:${path}`, typeOf(path), 'completed');
    out.gaps.push({ subject: `model:${path}`, reason, detail });
  };
  for (const u of s.unreadableFiles ?? []) gap(u.path, 'unreadable', String(u.why ?? 'unreadable'));
  for (const o of s.oversizeFiles ?? []) gap(o.path, 'oversize', `over the read cap (${o.bytes} bytes)`);
  for (const p of s.kerasWithoutConfigFiles ?? []) gap(p, 'unreadable', 'keras artefact with no model config located');
  for (const p of s.tfGraphsWithoutNodesFiles ?? []) gap(p, 'unreadable', 'tensorflow graph with no op-shaped node read');
  for (const p of s.skippedPaths ?? []) gap(p, 'excluded', 'skipped by CW_MODEL_SKIP_PATHS');
  const listed = (count, list) => Math.max(0, (count ?? 0) - (list ?? []).length);
  return {
    state: s.voidReason ? 'void' : 'ran',
    ...(s.voidReason ? { reason: 'no model surface' } : {}),
    examined: s.filesScanned ?? null,
    scope: 'pickle opcodes, keras configs, tensorflow graph ops, safetensors headers, dataset loader configs and hub-loading source',
    unlisted: {
      unreadable: listed(s.unreadable, s.unreadableFiles),
      oversize: listed(s.skippedOversize, s.oversizeFiles),
      kerasWithoutConfig: listed(s.kerasWithoutConfig, s.kerasWithoutConfigFiles),
      tfGraphsWithoutNodes: listed(s.tfGraphsWithoutNodes, s.tfGraphsWithoutNodesFiles),
    },
    ...(s.secondWitness ? { secondWitness: s.secondWitness } : {}),
  };
}

export function maliciousContentEvidence({ dependencyReport, vendorReport, modelReport } = {}) {
  const deps = report(dependencyReport, 'deps-content', 'dependencyReport');
  const vendored = report(vendorReport, 'vendor-scan', 'vendorReport');
  const models = report(modelReport, 'model-artefacts', 'modelReport');
  const out = { subjects: new Map(), gaps: [], integrity: [], unmapped: [] };
  const producers = {
    'deps-content': readDependencies(deps, out),
    'vendor-scan': readVendored(vendored, out),
    'model-artefacts': readModels(models, out),
  };
  const { observations, gaps } = contentEvidence({ subjects: [...out.subjects.values()], coverage: { gaps: out.gaps } });
  return { observations, gaps, integrity: out.integrity.sort(byRow), unmapped: out.unmapped.sort(byRow), producers };
}

// commitwork — shared parser for RUNTIME (DAST / BOLA) reports; one source of truth for the
// rollup and runtime.html. Reads nuclei.jsonl / nuclei.json / authz-bola.json / authz.json into
// normalised findings + probes, each carrying a stable category.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// severity model — 'info' is a first-class tier below 'low' (Nuclei emits it heavily)
export const RT_SEVRANK = { critical: 5, crit: 5, high: 4, medium: 3, med: 3, low: 2, info: 1, unknown: 0, none: 0 };
const normSev = (s) => ({ critical: 'crit', crit: 'crit', high: 'high', medium: 'med', med: 'med', low: 'low', info: 'info' }[(s || '').toLowerCase()] || 'info');
export const rtWorst = (fs) => fs.reduce((w, f) => (RT_SEVRANK[f.severity] > RT_SEVRANK[w] ? f.severity : w), 'none');

// ---- category taxonomy (deterministic; the ONE place categories are defined) ----
// order = tab order; every category always exists (renders grey when it has 0 findings).
export const RT_CATEGORIES = [
  { id: 'credentials', label: 'Default Credentials', hint: 'weak/guessable/default logins on reachable services' },
  { id: 'actuator',    label: 'Actuator Exposure',   hint: 'Spring Boot management endpoints reachable without auth' },
  { id: 'tenant',      label: 'Tenant Isolation (BOLA)', hint: 'object-level authz / cross-tenant leakage on the gateway' },
  { id: 'services',    label: 'Exposed Services',     hint: 'network services detectable/enumerable from the probe host' },
  { id: 'disclosure',  label: 'Info Disclosure',      hint: 'headers, error pages, API specs that leak implementation detail' },
  { id: 'tls',         label: 'TLS / Transport',      hint: 'protocol/cipher/cert posture and transport-security headers' },
  { id: 'other',       label: 'Other',                hint: 'runtime findings not matching a known category' },
];
const CAT_IDS = new Set(RT_CATEGORIES.map((c) => c.id));

function categorize({ templateId = '', tags = [], type = '', tool = '' }) {
  const t = new Set(tags.map((x) => String(x).toLowerCase()));
  const id = templateId.toLowerCase();
  if (tool === 'authz-bola' || tool === 'authz') return 'tenant';
  if (t.has('default-login') || id.includes('default-login') || id.includes('default-password')) return 'credentials';
  if (id.startsWith('springboot') || id.startsWith('spring-boot') || id.includes('actuator')) return 'actuator';
  if (t.has('tls') || t.has('ssl') || id.includes('testssl') || id.includes('tls-') || id.includes('ssl-')) return 'tls';
  if (id.includes('missing-security-headers') || id.includes('swagger') || id.includes('whitelabel') ||
      t.has('exposure') || t.has('disclosure') || t.has('api')) return 'disclosure';
  if (t.has('network') || t.has('enum') || t.has('service') || /-(detect|enum|fingerprint)$/.test(id) ||
      type === 'network' || type === 'dns' || type === 'tcp') return 'services';
  return 'other';
}

// Both spellings must be read: sweeps write nuclei.jsonl, the catalogue's -je writes nuclei.json.
export const NUCLEI_ARTIFACTS = Object.freeze(['nuclei.jsonl', 'nuclei.json']);
export const nucleiArtifact = (dir) => NUCLEI_ARTIFACTS.map((f) => join(dir, f)).find((p) => existsSync(p)) || null;

// Shape decided by content, not filename; a parse failure yields [], never a thrown sweep.
function nucleiRecords(raw) {
  const t = raw.trim(); if (!t) return [];
  if (t[0] === '[') { try { const a = JSON.parse(t); return Array.isArray(a) ? a : []; } catch { return []; } }
  const out = [];
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip non-json line */ }
  }
  return out;
}

function parseNuclei(dir) {
  const p = nucleiArtifact(dir); if (!p) return [];
  const out = [];
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return []; }
  for (const d of nucleiRecords(raw)) {
    const info = d.info || {};
    const cls = info.classification || {};
    const severity = normSev(info.severity);
    const location = d['matched-at'] || d.matched_at || d.host || '';
    const id = d['template-id'] || d.templateID || info.name || 'nuclei';
    // Liveness: a template can match a 404 error page; 4xx/5xx = reported-but-unconfirmed.
    const resp = d.response || '';
    const sm = resp.match(/^HTTP\/[\d.]+\s+(\d{3})\s*([^\r\n]*)/);
    const httpStatus = sm ? parseInt(sm[1], 10) : null;
    const httpReason = sm ? (sm[2] || '').trim() : '';
    const bodyLine = (resp.split(/\r?\n\r?\n/)[1] || '').trim().split(/\r?\n/).find((l) => /^[\[{]/.test(l.trim())) || '';
    const bodySnippet = bodyLine.slice(0, 160);
    const isHttp = /^https?:\/\//i.test(location) || d.type === 'http';
    const confirmed = httpStatus === null ? (isHttp ? null : true) : httpStatus < 400; // network detects have no HTTP status → treated as live
    out.push({
      tool: 'nuclei', class: 'dast', id, severity,
      category: categorize({ templateId: id, tags: info.tags || [], type: d.type, tool: 'nuclei' }),
      name: info.name || id, location, httpStatus, httpReason, bodySnippet, confirmed,
      description: (info.description || '').trim(),
      impact: (info.impact || '').trim(),
      remediation: (info.remediation || '').trim(),
      tags: info.tags || [],
      reference: [].concat(info.reference || []).filter(Boolean),
      cwe: [].concat(cls['cwe-id'] || []).filter(Boolean),
      cve: cls['cve-id'] || null,
      cvss: parseFloat((cls['cvss-metrics'] || '').match(/\/([\d.]+)\/?$/)?.[1]) || null,
    });
  }
  return out;
}

function parseAuthz(dir) {
  const out = [];
  for (const [file, tool] of [['authz-bola.json', 'authz-bola'], ['authz.json', 'authz']]) {
    const p = join(dir, file); if (!existsSync(p)) continue;
    let d; try { d = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    for (const f of d.findings || []) {
      out.push({
        tool, class: 'bola', id: `${f.type || 'bola'}:${f.path || ''}`, severity: normSev(f.severity),
        category: 'tenant', name: `${f.type || 'authz issue'} — ${f.path || ''}`.trim(), location: f.path || '',
        description: f.detail || '', impact: '', remediation: '', tags: ['bola', f.type].filter(Boolean),
        reference: [], cwe: ['cwe-639'], cve: null, cvss: null,
        probe: { noAuth: f.noAuth, tenantA: f.tenantA, tenantB: f.tenantB },
      });
    }
  }
  return out;
}

// Probes: what was tested + the tool's verdict, so a clean tab reads "ran, found 0".
function parseProbes(dir) {
  const probes = [];
  const bolaP = join(dir, 'authz-bola.json');
  if (existsSync(bolaP)) {
    try {
      const d = JSON.parse(readFileSync(bolaP, 'utf8'));
      probes.push({ category: 'tenant', tool: 'authz-bola', ran: true,
        summary: d.summary || {}, verdict: (d.summary && d.summary.verdict) || '',
        tested: (d.tested || []).map((t) => ({ path: t.path, noAuth: t.noAuth, tenantA: t.tenantA, tenantB: t.tenantB, lenA: t.lenA, lenB: t.lenB })) });
    } catch {}
  }
  return probes;
}

// returns { findings, probes, categories: <id -> {worst, count, findings, blocker}>, blockers, ran }
export function parseRuntime(dir) {
  if (!dir || !existsSync(dir)) return { findings: [], probes: [], categories: {}, blockers: [], ran: false };
  // `ran` must agree with what parseNuclei actually reads
  const ran = !!nucleiArtifact(dir) || ['authz-bola.json', 'authz.json'].some((f) => existsSync(join(dir, f)));
  const findings = [...parseNuclei(dir), ...parseAuthz(dir)];
  // stable dedupe (nuclei repeats e.g. missing-security-headers per header) key = tool|id|location|severity
  const seen = new Set();
  const deduped = findings.filter((f) => { const k = `${f.tool}|${f.id}|${f.location}|${f.severity}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const probes = parseProbes(dir);
  // Secret leaks: actuator dumps (env/configprops/heap/thread) or secret-tagged templates.
  const SECRET_LEAK = /(^|[-/])(env|configprops|heapdump|threaddump|heap-dump|thread-dump)($|[-/])/i;
  const leaksSecrets = (f) => SECRET_LEAK.test(f.id) || SECRET_LEAK.test(f.location || '') ||
    (f.tags || []).some((t) => /secret|credential|password/i.test(String(t)));
  // Blocker: high/crit, tenant (BOLA), or secret leak — only if confirmed live.
  const isBlocker = (f) => f.confirmed !== false &&
    (RT_SEVRANK[f.severity] >= RT_SEVRANK.high || f.category === 'tenant' || leaksSecrets(f));
  const categories = {};
  for (const c of RT_CATEGORIES) categories[c.id] = { worst: 'none', count: 0, confirmed: 0, unconfirmed: 0, findings: [], blocker: false };
  for (const f of deduped) {
    const cid = CAT_IDS.has(f.category) ? f.category : 'other';
    const g = categories[cid];
    g.findings.push(f); g.count++;
    if (f.confirmed === false) g.unconfirmed++; else g.confirmed++;
    // Tab colour counts confirmed-live findings only
    if (f.confirmed !== false && RT_SEVRANK[f.severity] > RT_SEVRANK[g.worst]) g.worst = f.severity;
    if (leaksSecrets(f) && f.confirmed !== false) f.leaksSecrets = true;
    if (isBlocker(f)) {
      g.blocker = true; f.blocker = true;
      f.blockerReason = f.category === 'tenant' ? 'cross-tenant / object-level authz'
        : f.leaksSecrets ? 'leaks secrets (env / config / memory)'
        : `${f.severity}-severity runtime exposure`;
    }
  }
  const blockers = deduped.filter((f) => f.blocker)
    .sort((a, b) => RT_SEVRANK[b.severity] - RT_SEVRANK[a.severity]);
  return { findings: deduped, probes, categories, blockers, ran };
}

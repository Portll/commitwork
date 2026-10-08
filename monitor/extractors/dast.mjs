// monitor/extractors/dast.mjs — the lanes that probe a RUNNING target rather than read the tree.
//
// Lifted unchanged from monitor/extractors.mjs on 2026-09-23: nuclei (dast), Schemathesis (apiFuzz)
// and the object-level authorization probe bin/authz-bola.mjs (bola). All three are
// kind `vulnerability` in LANE_KINDS. A lane that tests a live surface has a void a source scanner
// does not — nothing to probe — and two of these readers keep it apart from a clean result:
// Schemathesis (a spec that would not load) and BOLA (`ran:false`) both return `nosrc`.
// NUCLEI DOES NOT, and that is recorded here rather than smoothed over: an empty artifact reads as
// `ran:true` with zeroes, and a non-JSON line is skipped. Whether that can publish a probe that
// never happened as clean depends on the runner's contract, which this lift did not change or check.
//
// monitor/extractors.mjs re-exports every public name here, so its importers see no change.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _zero, _emptyArtifact, _detailFor } from './core.mjs';

// nuclei rows: template / sev / path / name. `matched-at` names a LIVE HOST, and the panel's
// existing rule is that nuclei hostnames never render (admin/index.html strips them client-side)
// — so the host is dropped HERE, at the extractor, rather than trusted to every consumer
// downstream: everything up to the first path slash (scheme + host + port) goes, whether or not
// the value carried a scheme. Counting behaviour is unchanged from the counts-only extractor:
// info-severity results are neither counted nor rowed.
//
// CONTENT WITH NO RECORD IN IT IS A VOID, NOT A CLEAN RUN, and this lane used to publish it as
// clean. The check's own formatNotes (manifests/security-baseline.json, dast-nuclei) states the
// contract: "An empty file is clean; content with only non-findings is a void (tool failure or
// misconfiguration)." bin/commitwork.mjs's parseReport has implemented it since 2026-08-07 and
// returns `noscan`; this reader skipped those lines and returned ran:true with zeroes. So the
// runner recorded a void for a file the rollup recorded as proof — the same two-layers-disagree
// defect as Socket's {ok:false} husk, which reached cra/controls.mjs as evidence for a control.
//
// The discriminator is the TEMPLATE, not the severity. An info-severity result is a real record
// that this lane deliberately does not count; an error object or another tool's output carries no
// template at all. Same guard, same three field spellings, as bin/commitwork.mjs:1349.
export function _nucleiCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  const c = { ..._zero(), ran: true }, map = { critical: 'crit', high: 'high', medium: 'med', low: 'low' };
  const rows = [];
  let records = 0, nonFindings = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { nonFindings++; continue; }
    if (!(o['template-id'] || o.templateID || o.template)) { nonFindings++; continue; }
    records++;
    const b = map[(((o.info && o.info.severity) || o.severity) || '').toLowerCase()];
    if (!b) continue;   // an info record: counted as a record above, not as a finding
    c[b]++; c.total++;
    const at = String(o['matched-at'] || o.matched || '');
    const pm = at.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/]*(\/.*)?$/i);
    // The record carries `port` and `type` as their own fields — the host:port in `matched-at` is
    // not the only source, and parsing it back out would re-derive what is already structured.
    // Falling back to the port inside matched-at covers older artifacts that predate those fields.
    const portFromAt = at.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/:]+:(\d+)/i);
    rows.push({ rule: String(o['template-id'] || o.templateID || ''), sev: b,
      path: (pm && pm[1]) || '/',
      port: String(o.port ?? (portFromAt ? portFromAt[1] : '')),
      proto: String(o.type || ''),
      name: String((o.info && o.info.name) || '').slice(0, 120) });
  }
  // An EMPTY artifact stays clean: a nuclei run that found nothing writes no lines, and the
  // formatNotes say so. It is content-without-records that is the void.
  if (!records && nonFindings) {
    return { ..._zero(), ran: true, toolfailed: true,
      reason: `no nuclei records — ${nonFindings} non-finding line(s)` };
  }
  return { ...c, ..._detailFor('dast', rows) };
}
// Schemathesis 4.x NDJSON event stream. Each line is a single-key object naming the event.
//
// THIS ONE REPLACES A SILENT GREEN. The check declared report.format 'generic', which is a
// pass-through — the report scored ok as long as the file existed. Measured on this fleet
// (2026-08-01, a client API gateway): the stream's only substantive event was
// `FatalError: Failed to load schema … HTTP 401 Unauthorized`, the fuzzer never sent one request,
// and the sweep recorded `api-fuzz: pass`. A run that could not load the spec is a coverage VOID,
// and `nosrc` is how this file says so.
//
// A failing scenario is `high`: schemathesis only fails an operation when the app 500s or breaks
// its own declared contract, both of which are defects rather than style.
export function _schemathesisCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  const c = { ..._zero(), ran: true };
  let fatal = false, scenarios = 0;
  const rows = [];
  for (const line of raw.split('\n')) {
    const t = line.trim(); if (!t) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.FatalError) { fatal = true; continue; }
    const s = o.ScenarioFinished;
    if (!s) continue;
    scenarios++;
    const st = String(s.status || '').toLowerCase();
    let b = null;
    if (st === 'failure') b = 'high';
    else if (st === 'error') b = 'med';
    if (!b) continue;
    c[b]++; c.total++;
    rows.push({ operation: s.label || s.name || s.operation || '', sev: b,
      message: b === 'high' ? 'the operation failed its own declared contract or returned 5xx' : 'the scenario errored before it could reach a verdict' });
  }
  // Loaded nothing and ran nothing: the fuzzer never got to make a statement about the API.
  if (fatal && !scenarios) return { ..._zero(), ran: true, nosrc: true };
  return { ...c, ..._detailFor('apiFuzz', rows) };
}

// bin/authz-bola.mjs writes {ran, skipped, reason, summary, findings:[{type, severity, path,
// detail}], tested}. `ran:false` is its own honest void — the probe found no object-level endpoint
// to test — and must not read as "tested, nothing found", which is what _countArray's `total:0` said.
export function _bolaCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object') return { ..._zero(), ran: true, unparseable: true };
  if (j.ran === false) return { ..._zero(), ran: true, nosrc: true }; // nothing probed — a void, not a clean result
  const arr = Array.isArray(j.findings) ? j.findings : [];
  const map = { critical: 'crit', high: 'high', medium: 'med', med: 'med', low: 'low' };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const f of arr) {
    const b = map[String((f && f.severity) || '').toLowerCase()] || 'high';
    c[b]++; c.total++;
    rows.push({ probe: f && f.type, path: f && f.path, sev: b,
      message: [f && f.detail, f && f.direction ? `(${f.direction})` : ''].filter(Boolean).join(' ') });
  }
  return { ...c, ..._detailFor('bola', rows) };
}

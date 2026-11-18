#!/usr/bin/env node
// bin/codeql-frontier.mjs — where untrusted data leaves the code CodeQL can follow.
//
// usage: node bin/codeql-frontier.mjs <language> <database>    (run by a CodeQL lane, after analyze)
// Runs CodeQL's own `<lang>/untrusted-data-to-external-api` query over the lane's database and writes
// $CW_REPORT_DIR/codeql-frontier-<language>.sarif, plus a record of what it did to
// $CW_REPORT_DIR/codeql-frontier-<language>.json. cra/taint-frontier.mjs reads both.
// exit: 0 always. This is a side measurement: the lane's verdict is its own analyze, and a frontier
//       that could not run is recorded as such (state failed / unsupported / no-database), never as
//       an empty frontier.
// env, read at call time: CW_REPORT_DIR. `codeql` comes from PATH, as the lane's own `codeql database create` does —
// a binary override would be one more name the repo-code allowlist (bin/lib/scanner-env.mjs) must carry.
//
// WHY. CodeQL models a fixed set of libraries. A taint query reports a flow only into a sink it
// knows, so untrusted data handed to a library nobody modelled produces NOTHING — and that nothing
// reads exactly like a clean scan. Measured 2026-11-18 (CodeQL 2.27.3, javascript-queries 2.4.8) on
// an express handler passing req.query.id to `require('weird-db-client').raw()`: the code-scanning
// suite reported only the child_process injection beside it; this query reported
// "Call to weird-db-client.raw() [param 0] with untrusted data from req.query.id". After that sink
// was declared in a model pack the suite reported js/sql-injection — and this query STILL listed the
// call. So the frontier is "untrusted data enters an external call", modelled or not; what makes a
// call worth reading is that no taint route in the same scan ends there (cra/taint-frontier.mjs).
//
// The query is selected by its @id from the language's own pack (a generated .qls), never by a path
// inside the pack: the path differs per language (`Security Features/CWE-020/` in C#,
// `CWE-020-ExternalAPIs/` in Python) and moves between pack versions; the id has not. Measured: each
// of the six ids resolves to exactly one query in the bundle above. Ruby, Rust and Swift ship no
// such query, and their record says so.
//
// The repository's own model pack (bin/codeql-model-pack.mjs) is loaded when the lane loaded one:
// a source the repository declared is a source here too.

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isMainModule } from '../lib/is-main.mjs';

/** The lane's --language value -> [query pack language, query id prefix]. */
export const FRONTIER_QUERY = Object.freeze({
  'javascript-typescript': Object.freeze(['javascript', 'js']),
  javascript: Object.freeze(['javascript', 'js']),
  java: Object.freeze(['java', 'java']),
  python: Object.freeze(['python', 'py']),
  go: Object.freeze(['go', 'go']),
  csharp: Object.freeze(['csharp', 'cs']),
  cpp: Object.freeze(['cpp', 'cpp']),
});
/** Lane languages CodeQL ships no frontier query for: recorded, not run. */
export const NO_FRONTIER_QUERY = Object.freeze(['ruby', 'rust', 'swift']);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
export const frontierArtifact = (language) => `codeql-frontier-${slug(language)}.sarif`;
export const frontierRecord = (language) => `codeql-frontier-${slug(language)}.json`;

/** The query suite selecting the frontier query by id, or null when the language has none. */
export function frontierSuite(language) {
  const q = FRONTIER_QUERY[language];
  if (!q) return null;
  return [`- queries: .`, `  from: codeql/${q[0]}-queries`, `- include:`, `    id: ${q[1]}/untrusted-data-to-external-api`, ''].join('\n');
}

/**
 * The model-pack arguments the lane used, read from codeql-model-pack.mjs's record for this
 * language. -> { args, state }: state 'applied' | 'none' (no record or nothing applied) | 'unreadable'.
 */
export function modelArgs(reportDir, language, read = (p) => readFileSync(p, 'utf8')) {
  let rec;
  try { rec = JSON.parse(read(join(reportDir, `codeql-${slug(language)}-models.json`))); } catch (e) {
    if (e && e.code === 'ENOENT') return { args: [], state: 'none' };
    return { args: [], state: 'unreadable', reason: String(e && e.message || e) };
  }
  if (!rec || rec.applied !== true || typeof rec.pack !== 'string') return { args: [], state: 'none' };
  return { args: ['--additional-packs', join(reportDir, 'codeql-models'), '--model-packs', rec.pack], state: 'applied', pack: rec.pack };
}

/**
 * Run the frontier for one lane. Returns the record it wrote. `run` and `exists` are injectable so
 * the decision logic is testable without CodeQL.
 */
export function runFrontier(language, database, {
  reportDir = process.env.CW_REPORT_DIR || '.',
  bin = 'codeql',
  run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
  exists = (p) => { try { return statSync(p).isDirectory(); } catch (e) { if (e && e.code === 'ENOENT') return false; throw e; } },
  write = (p, text) => writeFileSync(p, text),
} = {}) {
  const q = FRONTIER_QUERY[language];
  const record = {
    language: language || null,
    query: q ? `${q[1]}/untrusted-data-to-external-api` : null,
    sarif: frontierArtifact(language || 'unknown'),
    state: null, reason: null, exit: null, models: null,
  };
  const finish = () => {
    try { write(join(reportDir, frontierRecord(language || 'unknown')), `${JSON.stringify(record, null, 1)}\n`); } catch { /* the report dir is the lane's; its absence is the lane's failure */ }
    return record;
  };
  if (!q) {
    record.state = 'unsupported';
    record.reason = NO_FRONTIER_QUERY.includes(language)
      ? `CodeQL ships no untrusted-data-to-external-api query for ${language}`
      : `unknown CodeQL language ${language}`;
    return finish();
  }
  let present;
  try { present = exists(database); } catch (e) {
    record.state = 'failed';
    record.reason = `database ${database} could not be read: ${e.code || e.message}`;
    return finish();
  }
  if (!present) {
    record.state = 'no-database';
    record.reason = `no database at ${database}: the lane's create step did not produce one`;
    return finish();
  }
  const models = modelArgs(reportDir, language);
  record.models = models.state === 'applied' ? { state: 'applied', pack: models.pack } : { state: models.state, ...(models.reason ? { reason: models.reason } : {}) };
  const suite = join(reportDir, `codeql-frontier-${slug(language)}.qls`);
  write(suite, frontierSuite(language));
  const out = join(reportDir, record.sarif);
  const res = run(bin, ['database', 'analyze', database, suite, '--format=sarif-latest', `--output=${out}`, ...models.args]);
  try { write(join(reportDir, `codeql-frontier-${slug(language)}.log`), `${res.stdout || ''}${res.stderr || ''}`); } catch { /* the record carries the outcome */ }
  record.exit = Number.isInteger(res.status) ? res.status : null;
  if (res.error) {
    record.state = 'failed';
    record.reason = `${bin} could not be started: ${res.error.code || res.error.message}`;
  } else if (res.status !== 0) {
    record.state = 'failed';
    const last = String(res.stderr || res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
    record.reason = `codeql database analyze exited ${res.status}${last ? `: ${last.slice(0, 400)}` : ''}`;
  } else {
    record.state = 'ran';
  }
  return finish();
}

if (isMainModule(import.meta.url)) {
  runFrontier(process.argv[2], process.argv[3]);
}

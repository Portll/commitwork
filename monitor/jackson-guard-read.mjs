// monitor/jackson-guard-read.mjs — the one reader of bin/guard-jackson-caseinsensitive.mjs's report.
//
// The runner (bin/lib/report-parsers/posture.mjs) and the rollup (monitor/extractors/posture.mjs)
// map these states into their own vocabularies and never parse the text themselves, so one artifact
// cannot read as a finding in one layer and a void in the other.
//
// The exit sidecar decides and the text must agree with it. Node exits 1 on an uncaught exception as
// well as on a violation, so exit 1 without a GUARD FAILED line naming a path:line is a crash. A pass
// needs the OK line and a scanned count above zero; SKIPPED means nothing to guard, never a pass.
//
// States: absent · artifact-unreadable · empty · no-exit · ok · skipped · violation ·
// unreadable-paths · not-run · unrecognised. Every state but absent/ok/skipped/violation carries `why`.

import { readFileSync } from 'node:fs';

const PREFIX = 'guard-jackson-caseinsensitive: ';
const FAILED = 'GUARD FAILED — ';
const HEAD = /^(OK|SKIPPED|UNREADABLE|NOT RUN) — /;
// `  <path>:<line>: <text>` under GUARD FAILED, `  <path>: <code>` under UNREADABLE
const HIT = /^ {2}(\S.*?):(\d+): /;
const UNREAD = /^ {2}(\S.*?): (.+)$/;

const byPlace = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function scan(text) {
  const out = { failed: false, hits: [], unreadable: [], heads: {} };
  let section = null;
  for (const raw of text.split('\n')) {
    const l = raw.trimEnd();
    if (l.startsWith(FAILED)) { out.failed = true; section = 'hit'; continue; }
    const h = l.startsWith(PREFIX) ? HEAD.exec(l.slice(PREFIX.length)) : null;
    if (h) {
      out.heads[h[1]] = l.slice(PREFIX.length);
      section = h[1] === 'UNREADABLE' ? 'unread' : null;
      continue;
    }
    const m = section === 'hit' ? HIT.exec(l) : section === 'unread' ? UNREAD.exec(l) : null;
    if (m && section === 'hit') out.hits.push({ file: m[1], line: Number(m[2]) });
    else if (m) out.unreadable.push({ path: m[1], code: m[2] });
  }
  // the walk's order is the filesystem's; sorted so the same tree reads the same everywhere
  out.hits.sort(byPlace);
  out.unreadable.sort(byPath);
  return out;
}

const count = (re, s) => { const m = re.exec(s || ''); return m ? Number(m[1]) : null; };

/** The guard's verdict, from `<path>` and its `<path>.exit` sidecar. Never throws. */
export function readJacksonGuard(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { state: 'absent' };
    return { state: 'artifact-unreadable', why: `the report could not be read (${(e && (e.code || e.message)) || e})` };
  }
  if (!text.trim()) return { state: 'empty', why: 'the guard wrote nothing, so there is no verdict to read' };
  let raw;
  try { raw = readFileSync(`${path}.exit`, 'utf8').trim(); } catch (e) {
    return { state: 'no-exit', why: e && e.code === 'ENOENT'
      ? 'no exit code was recorded beside the report, so nothing witnessed the verdict'
      : `the exit sidecar could not be read (${(e && (e.code || e.message)) || e})` };
  }
  if (!/^\d+$/.test(raw)) return { state: 'no-exit', why: `the exit sidecar holds ${JSON.stringify(raw.slice(0, 20))}, not an exit code` };
  const exit = Number(raw);
  const { failed, hits, unreadable, heads } = scan(text);
  const unrecognised = (why) => ({ state: 'unrecognised', exit, why });

  if (exit === 0) {
    if (failed || hits.length || heads.UNREADABLE || heads['NOT RUN']) return unrecognised('the guard exited 0 beside a failure line');
    if (heads.OK && !heads.SKIPPED) {
      const scanned = count(/not enabled in (\d+) scanned file/, heads.OK);
      return scanned > 0 ? { state: 'ok', exit, scanned } : unrecognised('the OK line names no scanned file');
    }
    if (heads.SKIPPED && !heads.OK) return { state: 'skipped', exit };
    return unrecognised('the guard exited 0 with no OK or SKIPPED line');
  }
  if (exit === 1) {
    if (failed && hits.length) return { state: 'violation', exit, violations: hits, unreadable };
    return unrecognised('the guard exited 1 without a GUARD FAILED line naming a path:line; a crash exits 1 as well');
  }
  if (exit === 2 && !failed) {
    if (heads['NOT RUN']) return { state: 'not-run', exit, why: 'the guard could not read its root, so nothing was scanned' };
    if (heads.UNREADABLE && unreadable.length) {
      return { state: 'unreadable-paths', exit, unreadable, scanned: count(/\((\d+) file\(s\) scanned/, heads.UNREADABLE),
        why: `${unreadable.length} path(s) could not be read, and any of them may enable the toggle` };
    }
    return unrecognised('the guard exited 2 with neither an UNREADABLE nor a NOT RUN line');
  }
  return unrecognised(`the guard exited ${exit}`);
}

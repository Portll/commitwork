// bin/lib/github-action.mjs — the decisions action.yml delegates, kept here so a test can run them.
// fact: `commitwork run` exits 0 over high-severity findings / its status says whether lanes executed, so the step is judged from the SARIF (expiry: never, prev: missing)

// usage: node bin/lib/github-action.mjs tools <check|group>
//        node bin/lib/github-action.mjs report <sarif> <run exit> <export exit> <fail-on> <fail-on-unmeasured>
// env, read at call time: GITHUB_OUTPUT, GITHUB_STEP_SUMMARY (appended to when set)
// exit: 0 done, and for report the step's verdict is the `failed` output · 2 usage
import { readFileSync, appendFileSync } from 'node:fs';
import { isMainModule } from '../../lib/is-main.mjs';

export const FAIL_ON = Object.freeze(['error', 'warning', 'note', 'none']);
const RANK = { error: 3, warning: 2, note: 1 };

/** Catalogued scanners the selected lanes require, sorted. `missing` names required tools the catalogue cannot install. */
export async function laneTools(target) {
  const { selectChecks } = await import('../commitwork.mjs');
  const { loadCatalog } = await import('../setup.mjs');
  const manifest = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
  const catalog = loadCatalog().tools || {};
  const wanted = new Set(selectChecks(manifest, target).flatMap((c) => c.requires?.tools || []));
  const sorted = [...wanted].sort();
  return { tools: sorted.filter((t) => catalog[t]), missing: sorted.filter((t) => !catalog[t]) };
}

/** What a commitwork SARIF log says. `state` is ok, absent (ENOENT) or unreadable; only ok carries counts. */
export function readSarifSummary(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) { return { state: e.code === 'ENOENT' ? 'absent' : 'unreadable', why: e.code || e.message }; }
  let run;
  try { run = JSON.parse(raw).runs[0]; } catch (e) { return { state: 'unreadable', why: e.message }; }
  if (!run || !Array.isArray(run.results)) return { state: 'unreadable', why: 'runs[0].results is not an array' };
  const levels = { error: 0, warning: 0, note: 0 };
  for (const r of run.results) if (r.level in levels) levels[r.level]++;
  const notes = (run.invocations?.[0]?.toolExecutionNotifications || [])
    .map((n) => ({ lane: String(n.descriptor?.id || ''), level: n.level, text: String(n.message?.text || '') }));
  return {
    state: 'ok', results: run.results.length, levels,
    unmeasured: notes.filter((n) => n.level === 'warning'),
    reduced: notes.filter((n) => n.level !== 'warning'),
    undetermined: (run.properties?.commitwork?.undetermined || []).length,
  };
}

/** Whether the step fails, and why. Exit 1 and 2 of `commitwork run` always fail it: neither is a finding. */
export function decide({ runExit, exportExit, sarif, failOn, failOnUnmeasured }) {
  const reasons = [];
  const warnings = [];
  if (runExit === 1) reasons.push('commitwork run exited 1: a lane failed to execute (its line in the run log names it)');
  else if (runExit === 2) reasons.push('commitwork run exited 2: it could not run (the error is in the run log)');
  else if (runExit !== 0) reasons.push(`commitwork run exited ${runExit}`);
  if (exportExit !== 0) reasons.push(`commitwork sarif exited ${exportExit}: the SARIF export failed`);
  if (sarif.state !== 'ok') {
    reasons.push(`no SARIF to judge (${sarif.state}${sarif.why ? `: ${sarif.why}` : ''})`);
    return { failed: true, reasons, warnings };
  }
  if (failOn !== 'none') {
    const n = Object.entries(sarif.levels).filter(([l]) => RANK[l] >= RANK[failOn]).reduce((s, [, c]) => s + c, 0);
    if (n) reasons.push(`${n} result(s) at level ${failOn} or above`);
  }
  if (sarif.unmeasured.length && failOnUnmeasured) reasons.push(`${sarif.unmeasured.length} lane(s) did not measure`);
  else for (const u of sarif.unmeasured) warnings.push(u.text);
  return { failed: reasons.length > 0, reasons, warnings };
}

// fact: a workflow command ends at a newline / escaping %, CR and LF keeps scanner text from opening a second command (expiry: never, prev: missing)
export const annotation = (kind, text) => `::${kind}::${String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`;
const mdLine = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function renderSummary({ sarif, decision, runExit, failOn }) {
  const lines = ['### commitwork', ''];
  if (sarif.state === 'ok') {
    const { error, warning, note } = sarif.levels;
    lines.push('| | |', '|---|---|',
      `| Results | ${sarif.results} (${error} error, ${warning} warning, ${note} note) |`,
      `| Lanes that did not measure | ${sarif.unmeasured.length} |`,
      `| Lanes with reduced coverage | ${sarif.reduced.length} |`,
      `| Undetermined, not counted as results | ${sarif.undetermined} |`,
      `| \`commitwork run\` exit | ${runExit} |`, '');
    if (sarif.unmeasured.length) lines.push('Did not measure, so neither clean nor a finding:', '', ...sarif.unmeasured.map((u) => `- ${mdLine(u.text)}`), '');
  } else lines.push(`No SARIF to report (${sarif.state}). \`commitwork run\` exited ${runExit}.`, '');
  lines.push(decision.failed ? `The step fails (fail-on: ${failOn}):` : `The step does not fail (fail-on: ${failOn}).`);
  if (decision.failed) lines.push('', ...decision.reasons.map((r) => `- ${mdLine(r)}`));
  return `${lines.join('\n')}\n`;
}

/** The `report` mode: outputs, summary and annotations, from the files and statuses the run left. */
export function report({ sarifPath, runExit, exportExit, failOn, failOnUnmeasured, env = process.env, log = console.log }) {
  const sarif = readSarifSummary(sarifPath);
  const decision = decide({ runExit, exportExit, sarif, failOn, failOnUnmeasured });
  const ok = sarif.state === 'ok';
  const outputs = {
    sarif: ok ? sarifPath : '',
    results: ok ? sarif.results : '',
    unmeasured: ok ? sarif.unmeasured.length : '',
    failed: decision.failed ? 'true' : 'false',
  };
  for (const w of decision.warnings) log(annotation('warning', `commitwork: ${w}`));
  for (const r of decision.reasons) log(annotation('error', `commitwork: ${r}`));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary({ sarif, decision, runExit, failOn }));
  return { sarif, decision, outputs };
}

const usage = (msg) => { console.error(`github-action: ${msg}`); process.exit(2); };
const exitStatus = (s) => (/^\d{1,3}$/.test(s || '') ? Number(s) : usage(`an exit status must be a number, got ${JSON.stringify(s)}`));

if (isMainModule(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'tools') {
    if (args.length !== 1) usage('tools takes one check or group');
    const { tools, missing } = await laneTools(args[0]);
    if (missing.length) console.error(`github-action: not in the install catalogue, so not installed here: ${missing.join(', ')}`);
    console.log(tools.join(','));
  } else if (mode === 'report') {
    if (args.length !== 5) usage('report takes <sarif> <run exit> <export exit> <fail-on> <fail-on-unmeasured>');
    const [sarifPath, runExit, exportExit, failOn, unmeasured] = args;
    if (!FAIL_ON.includes(failOn)) usage(`fail-on must be one of ${FAIL_ON.join(', ')}`);
    if (unmeasured !== 'true' && unmeasured !== 'false') usage('fail-on-unmeasured must be true or false');
    report({ sarifPath, runExit: exitStatus(runExit), exportExit: exitStatus(exportExit), failOn, failOnUnmeasured: unmeasured === 'true' });
  } else usage(`unknown mode ${JSON.stringify(mode)} (tools, report)`);
}

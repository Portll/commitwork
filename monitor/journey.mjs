// monitor/journey.mjs — the self-guided setup journey: nine steps whose state is DERIVED from the
// records each one is about (users store, registry, PATH, credential refs, rollups, launchd plists,
// the daily config), never from a stored "done" flag. The store holds only what cannot be measured:
// which optional steps the operator acknowledged or skipped, and whether the checklist is dismissed.
// Pure: the route gathers the inputs; this module turns them into steps and never reads a file.

export const JOURNEY_STEPS = Object.freeze([
  { id: 'account', title: 'Create the operator account', optional: false, operatorOnly: true, cli: null },
  { id: 'personalise', title: 'Make it yours', optional: true, operatorOnly: false, cli: null },
  { id: 'palette', title: 'Learn the command palette', optional: true, operatorOnly: false, cli: null },
  { id: 'project', title: 'Add your first project', optional: false, operatorOnly: false, cli: 'node bin/commitwork.mjs init --root ~/Repositories' },
  { id: 'scanners', title: 'Scanner readiness', optional: false, operatorOnly: true, cli: 'node bin/commitwork.mjs setup' },
  { id: 'credentials', title: 'Credentials', optional: true, operatorOnly: true, cli: 'node bin/secrets.mjs set <NAME> keychain:<service>/<account>' },
  { id: 'firstrun', title: 'First run', optional: false, operatorOnly: false, cli: 'CW_REPORT_DIR=~/.commitwork/reports node bin/commitwork.mjs run fast --manifest security-baseline' },
  { id: 'schedule', title: 'Schedule the sweeps', optional: false, operatorOnly: true, cli: 'node monitor/install-agents.mjs --write --load' },
  { id: 'notifications', title: 'Daily report and digest', optional: true, operatorOnly: false, cli: 'edit monitor/private/daily.json (schema/daily-config.schema.json)' },
]);
export const JOURNEY_STEP_IDS = Object.freeze(JOURNEY_STEPS.map((s) => s.id));

// A tool whose binary is not enough carries `requiresAccount` in manifests/install-catalog.json
// (setup prints "installing this is NOT enough" for it). Such a tool is a credential, not a
// missing scanner: step 6 lists it and step 5 does not count it as missing.
const accountGated = (t) => !!(t && t.requiresAccount && typeof t.requiresAccount === 'object');

/** Validate the stored record. Returns null when valid, else the reason. */
export function validSetupJourney(v) {
  if (v === null || v === undefined) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'must be an object { dismissed?: boolean, acknowledged?: string[] }';
  for (const k of Object.keys(v)) if (!['dismissed', 'acknowledged'].includes(k)) return `unknown key '${k}'`;
  if (v.dismissed !== undefined && typeof v.dismissed !== 'boolean') return 'dismissed must be true or false';
  if (v.acknowledged !== undefined) {
    if (!Array.isArray(v.acknowledged)) return 'acknowledged must be an array of step ids';
    for (const id of v.acknowledged) if (!JOURNEY_STEP_IDS.includes(id)) return `acknowledged names an unknown step '${id}'`;
  }
  return null;
}

const n = (x) => (Array.isArray(x) ? x.length : Number(x) || 0);

/**
 * inputs — every field measured by the caller; `null` for a field means it could not be read:
 *   users: number|null
 *   registry: { example: boolean, unreadable: string|null, areas: number, projects: number, repos: number }
 *   scanners: { unreadable?: string, tools: [{ name, state: 'present'|'missing'|'installed-not-on-path', at?: string, blocks: string[], requiresAccount?: { vendor, needs } }] }
 *   credentials: { unreadable?: string, rows: [{ name, resolvable: boolean, blocks: string[] }] }
 *   firstRun: { areasWithRollup: number, areas: number, sweepRunning: boolean, reportDirSet: boolean }
 *   schedule: { perArea: [{ slug, state: 'scheduled'|'absent'|'disabled'|'unscheduled', paused: boolean }] }
 *   notifications: { dailyPresent: boolean|null }
 *   store: { value: {dismissed?, acknowledged?}|null, error: string|null }
 *   flags: { palette: boolean }
 *   operator: boolean  — whether the caller is on the operator port
 */
export function deriveJourney(inputs) {
  const store = inputs.store || { value: null, error: null };
  const ack = new Set((store.value && Array.isArray(store.value.acknowledged)) ? store.value.acknowledged : []);
  const steps = JOURNEY_STEPS.map((s) => ({ ...s, state: 'todo', detail: '', counts: {} }));
  const by = Object.fromEntries(steps.map((s) => [s.id, s]));
  const unreadable = (step, why) => { step.state = 'unreadable'; step.detail = why; };

  // 1 account
  if (inputs.users === null || inputs.users === undefined) unreadable(by.account, 'the users store could not be read');
  else if (inputs.users > 0) { by.account.state = 'done'; by.account.detail = `${inputs.users} account${inputs.users === 1 ? '' : 's'}`; }
  else by.account.detail = 'no account yet; the first one is created on the operator port';

  // 2 personalise, 3 palette — acknowledgements, with the palette flag as a precondition
  by.personalise.state = ack.has('personalise') ? 'done' : 'todo';
  by.personalise.detail = 'theme, colour-vision palette and Learning mode live in the account menu';
  if (inputs.flags && inputs.flags.palette === false) { by.palette.state = 'unavailable'; by.palette.detail = 'the palette flag is off (CW_FEATURE_PALETTE or Settings → Experimental features)'; }
  else { by.palette.state = ack.has('palette') ? 'done' : 'todo'; by.palette.detail = 'press Cmd+K or Ctrl+K and open any view; this step completes on the first navigation'; }

  // 4 project — the registry must be real and hold something
  const r = inputs.registry;
  if (!r || r.unreadable) unreadable(by.project, `the registry could not be read${r && r.unreadable ? ` (${r.unreadable})` : ''}`);
  else if (r.example) { by.project.detail = 'the panel is reading the EXAMPLE registry; run init to create the private store (safe to re-run)'; by.project.counts = { areas: 0, projects: 0 }; }
  else if (n(r.areas) + n(r.projects) === 0) by.project.detail = 'the registry has no project or area yet';
  else { by.project.state = 'done'; by.project.counts = { areas: n(r.areas), projects: n(r.projects), repos: n(r.repos) }; by.project.detail = `${n(r.repos)} repositor${n(r.repos) === 1 ? 'y' : 'ies'} across ${n(r.areas)} area${n(r.areas) === 1 ? '' : 's'}`; }

  // 5 scanners — three states plus one outcome; account-gated tools are not "missing" here
  const sc = inputs.scanners;
  if (!sc || sc.unreadable) unreadable(by.scanners, `the lane manifest could not be read${sc && sc.unreadable ? ` (${sc.unreadable})` : ''}`);
  else {
    const tools = (sc.tools || []).filter((t) => !accountGated(t));
    const present = tools.filter((t) => t.state === 'present'), missing = tools.filter((t) => t.state === 'missing'), offPath = tools.filter((t) => t.state === 'installed-not-on-path');
    by.scanners.counts = { present: present.length, missing: missing.length, installedNotOnPath: offPath.length, accountGated: (sc.tools || []).filter(accountGated).length };
    by.scanners.missing = missing.map((t) => ({ name: t.name, blocks: t.blocks || [] }));
    by.scanners.installedNotOnPath = offPath.map((t) => ({ name: t.name, at: t.at || null, blocks: t.blocks || [] }));
    if (!missing.length && !offPath.length) { by.scanners.state = 'done'; by.scanners.detail = `${present.length} tools on PATH`; }
    else if (ack.has('scanners')) { by.scanners.state = 'skipped'; by.scanners.detail = `running with what is installed: ${missing.length} missing, ${offPath.length} installed but not on PATH; their lanes will report not scanned`; }
    else by.scanners.detail = `${present.length} on PATH · ${missing.length} missing · ${offPath.length} installed but not on PATH; setup takes minutes, not seconds`;
  }

  // 6 credentials — optional; account-gated tools are listed here
  const cr = inputs.credentials;
  if (!cr || cr.unreadable) unreadable(by.credentials, `the credential refs could not be read${cr && cr.unreadable ? ` (${cr.unreadable})` : ''}`);
  else {
    const rows = cr.rows || [];
    const missing = rows.filter((x) => x.resolvable === false);
    by.credentials.counts = { declared: rows.length, resolvable: rows.length - missing.length, missing: missing.length };
    by.credentials.missing = missing.map((x) => ({ name: x.name, blocks: x.blocks || [] }));
    by.credentials.accountGated = ((inputs.scanners && inputs.scanners.tools) || []).filter(accountGated).map((t) => ({ tool: t.name, vendor: t.requiresAccount.vendor || null, needs: Array.isArray(t.requiresAccount.needs) ? t.requiresAccount.needs : [], state: t.state }));
    if (ack.has('credentials')) { by.credentials.state = 'skipped'; by.credentials.detail = 'skipped; checks that need a credential report not scanned'; }
    else if (rows.length && !missing.length) { by.credentials.state = 'done'; by.credentials.detail = `${rows.length} credential ref${rows.length === 1 ? '' : 's'} resolve`; }
    else by.credentials.detail = rows.length ? `${missing.length} of ${rows.length} refs do not resolve` : 'no credential refs recorded; presence only is ever shown here';
  }

  // 7 first run — a rollup on disk is the only proof; lane status is not the result
  const fr = inputs.firstRun || {};
  by.firstrun.counts = { areasWithRollup: n(fr.areasWithRollup), areas: n(fr.areas) };
  if (fr.sweepRunning) { by.firstrun.state = 'running'; by.firstrun.detail = 'a sweep is running now; the feed shows its findings when it lands'; }
  else if (n(fr.areasWithRollup) > 0) { by.firstrun.state = 'done'; by.firstrun.detail = `${n(fr.areasWithRollup)} of ${n(fr.areas)} areas have a rollup; read the feed's counts, not a lane's pass`; }
  else by.firstrun.detail = `no area has a rollup yet${fr.reportDirSet === false ? '; CW_REPORT_DIR is unset, so every CLI run warns and writes to a temp dir' : ''}`;
  by.firstrun.reportDirSet = fr.reportDirSet !== false;

  // 8 schedule — every unpaused area scheduled; applying stays a human act
  const sch = inputs.schedule;
  if (!sch || !Array.isArray(sch.perArea)) unreadable(by.schedule, 'the launch agents could not be read');
  else {
    const live = sch.perArea.filter((a) => !a.paused);
    const byState = {};
    for (const a of live) byState[a.state] = (byState[a.state] || 0) + 1;
    by.schedule.counts = byState;
    by.schedule.perArea = sch.perArea.map((a) => ({ slug: a.slug, state: a.state, paused: !!a.paused }));
    if (!live.length) by.schedule.detail = 'no unpaused area to schedule';
    else if (live.every((a) => a.state === 'scheduled')) { by.schedule.state = 'done'; by.schedule.detail = `${live.length} area${live.length === 1 ? '' : 's'} scheduled`; }
    else by.schedule.detail = `${byState.scheduled || 0} of ${live.length} areas scheduled; the plan is generated here, loading it into launchd is yours to run`;
  }

  // 9 notifications — optional
  const nt = inputs.notifications || {};
  if (nt.dailyPresent === null || nt.dailyPresent === undefined) unreadable(by.notifications, 'the daily config could not be read');
  else if (ack.has('notifications')) { by.notifications.state = 'skipped'; by.notifications.detail = 'skipped'; }
  else if (nt.dailyPresent) { by.notifications.state = 'done'; by.notifications.detail = 'daily.json present'; }
  else by.notifications.detail = 'no daily.json; the daily report and digest have nowhere to go';

  // operator-only steps render as such off the operator port — the control is shown, not offered
  for (const s of steps) if (s.operatorOnly && inputs.operator === false && s.state === 'todo') s.offPort = true;

  const counted = steps.filter((s) => s.state !== 'unavailable');
  const done = counted.filter((s) => s.state === 'done' || s.state === 'skipped').length;
  const unreadableSteps = steps.filter((s) => s.state === 'unreadable').map((s) => s.id);
  return {
    steps,
    progress: { done, total: counted.length, unreadable: unreadableSteps },
    dismissed: !!(store.value && store.value.dismissed),
    storeState: store.error ? 'unreadable' : (store.value ? 'present' : 'absent'),
    storeError: store.error || null,
    complete: done === counted.length && unreadableSteps.length === 0,
  };
}

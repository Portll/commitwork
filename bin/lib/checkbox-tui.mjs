// bin/lib/checkbox-tui.mjs — the terminal picker for `commitwork deps --update --tui`: which update
// types this run may take, which packages, and whether to merge. The model and the screen are pure
// over (state, audit, policy, size); runPicker is the only part that touches the terminal.
import { chooseUpdate, UPDATE_TYPES } from './npm-versions.mjs';
import { exposureOfKind, resolvePolicy } from './update-policy.mjs';

// Code points, not UTF-16 units; control characters a registry or scanner returned are drawn as spaces.
const fit = (s, w) => {
  const cps = [...String(s ?? '').replace(/[\x00-\x1f\x7f]/g, ' ')];
  if (w <= 0) return '';
  return cps.length > w ? `${cps.slice(0, w - 1).join('')}…` : cps.join('') + ' '.repeat(w - cps.length);
};

/** The rows the picker offers: every measured dependency with an update or a held release, then the run-wide switches. */
export function pickerModel(report, operator, repoPolicy, state) {
  const policy = resolvePolicy({ ...operator, prod: withTypes(operator.prod, state.types), dev: withTypes(operator.dev, state.types) }, repoPolicy);
  const deps = report.deps.filter((d) => !d.skipped && (d.updates.length || d.held.length)).map((d) => {
    const exposure = exposureOfKind(d.kind);
    const pick = chooseUpdate(d, policy.update[exposure].filter((k) => UPDATE_TYPES.includes(k)));
    return { id: `dep:${d.name}`, name: d.name, exposure, locked: d.locked, pick, held: d.held.length, checked: !!pick && !state.unchecked.has(d.name) };
  });
  const either = (k) => policy.update.prod.includes(k) || policy.update.dev.includes(k);
  const sw = [
    { id: 'lockfile', label: 'refresh transitive packages within their ranges (lockfile)', available: either('lockfile'), checked: either('lockfile') && state.lockfile },
    { id: 'advisories', label: 'apply advisory fixes (npm audit fix; exempt from the cooldown)', available: either('advisories'), checked: either('advisories') && state.advisories },
    { id: 'merge', label: `merge when the repository's own tests pass${state.trustRepo ? '' : ' (needs --trust-repo-manifest)'}`, available: state.trustRepo, checked: state.trustRepo && state.merge },
  ];
  return { policy, rows: [...deps, ...sw] };
}

const withTypes = (kinds, types) => [...kinds.filter((k) => !UPDATE_TYPES.includes(k)), ...UPDATE_TYPES.filter((t) => types.includes(t))];

export function initialPicker({ types = ['patch', 'minor'], lockfile = true, advisories = true, merge = false, trustRepo = false } = {}) {
  return { cursor: 0, types: [...types], unchecked: new Set(), lockfile, advisories, merge, trustRepo };
}

/** One key; returns the next state, { done: selection }, or { cancel: true }. */
export function pickerReduce(state, key, model) {
  const s = { ...state, types: [...state.types], unchecked: new Set(state.unchecked) };
  const n = model.rows.length;
  if (key === 'quit') return { cancel: true };
  if (key === 'up') s.cursor = Math.max(0, s.cursor - 1);
  else if (key === 'down') s.cursor = Math.min(n - 1, s.cursor + 1);
  else if (/^type:/.test(key)) {
    const t = key.slice(5);
    s.types = s.types.includes(t) ? s.types.filter((x) => x !== t) : [...s.types, t];
  } else if (key === 'toggle') {
    const row = model.rows[s.cursor];
    if (!row) return s;
    if (row.id.startsWith('dep:')) {
      if (!row.pick) return s;
      if (s.unchecked.has(row.name)) s.unchecked.delete(row.name); else s.unchecked.add(row.name);
    } else if (row.available) s[row.id] = !s[row.id];
  } else if (key === 'enter') {
    const direct = model.rows.filter((r) => r.id.startsWith('dep:') && r.checked).map((r) => ({ name: r.name, version: r.pick.version }));
    const sw = Object.fromEntries(model.rows.filter((r) => !r.id.startsWith('dep:')).map((r) => [r.id, r.checked]));
    return { done: { direct, lockfile: sw.lockfile, advisories: sw.advisories, merge: sw.merge, types: s.types } };
  }
  return s;
}

export function pickerKeys(chunk) {
  const keys = [];
  const SEQ = [['\x1b[A', 'up'], ['\x1bOA', 'up'], ['\x1b[B', 'down'], ['\x1bOB', 'down']];
  const CH = { k: 'up', j: 'down', ' ': 'toggle', '\r': 'enter', '\n': 'enter', q: 'quit', '\x03': 'quit', '\x04': 'quit', 1: 'type:patch', 2: 'type:minor', 3: 'type:major' };
  let i = 0;
  while (i < chunk.length) {
    const seq = SEQ.find(([x]) => chunk.startsWith(x, i));
    if (seq) { keys.push(seq[1]); i += seq[0].length; continue; }
    if (chunk[i] === '\x1b') {
      const rest = chunk.slice(i + 1).match(/^(\[[0-9;]*[~A-Za-z]|O[A-Za-z])/);
      if (rest) { i += 1 + rest[0].length; continue; }
      keys.push('quit'); i += 1; continue;
    }
    if (CH[chunk[i]]) keys.push(CH[chunk[i]]);
    i += 1;
  }
  return keys;
}

export function pickerScreen(state, model, report, { cols = 80, rows = 24 } = {}) {
  const lines = [];
  lines.push(fit(`Dependency updates · ${report.name || report.dir}`, cols));
  lines.push(fit(`types: ${UPDATE_TYPES.map((t, i) => `[${state.types.includes(t) ? 'x' : ' '}] ${i + 1} ${t}`).join('  ')}   cooldown ${model.policy.cooldown.patch}/${model.policy.cooldown.minor}/${model.policy.cooldown.major} d`, cols));
  lines.push(fit(model.policy.narrowed.length ? `repository policy: ${model.policy.narrowed.join('; ')}` : '', cols));
  const body = Math.max(1, rows - 5);
  const top = Math.max(0, Math.min(state.cursor - Math.floor(body / 2), model.rows.length - body));
  for (let r = 0; r < body; r++) {
    const row = model.rows[top + r];
    if (!row) { lines.push(fit('', cols)); continue; }
    const mark = row.id.startsWith('dep:') ? (row.pick ? (row.checked ? '[x]' : '[ ]') : ' - ') : row.available ? (row.checked ? '[x]' : '[ ]') : ' - ';
    const text = row.id.startsWith('dep:')
      ? `${row.name} ${row.locked} → ${row.pick ? `${row.pick.version} (${row.pick.type})` : 'no update of the chosen types'}  ${row.exposure}${row.held ? `  · ${row.held} held by cooldown` : ''}`
      : row.label;
    lines.push(fit(`${top + r === state.cursor ? '›' : ' '} ${mark} ${text}`, cols));
  }
  const n = model.rows.filter((r) => r.id.startsWith('dep:') && r.checked).length;
  lines.push(fit('', cols));
  lines.push(fit(` ${n} package${n === 1 ? '' : 's'} selected · space toggle · 1 2 3 types · Enter propose · q cancel`, cols));
  return lines.slice(0, rows);
}

/** Resolves the selection, or null when the reader cancels. */
export function runPicker({ report, operator, repoPolicy, initial, stdin = process.stdin, stdout = process.stdout }) {
  if (!stdin.isTTY || !stdout.isTTY) return Promise.reject(new Error('the update picker needs an interactive terminal'));
  return new Promise((resolve) => {
    let state = initial;
    const wasRaw = stdin.isRaw;
    const size = () => ({ cols: Math.max(40, stdout.columns || 80), rows: Math.max(10, stdout.rows || 24) });
    const draw = () => {
      const model = pickerModel(report, operator, repoPolicy, state);
      stdout.write(`\x1b[H${pickerScreen(state, model, report, size()).map((l) => `${l}\x1b[K`).join('\r\n')}\x1b[J`);
    };
    const restore = () => {
      stdin.removeListener('data', onData); stdout.removeListener('resize', draw);
      process.removeListener('exit', onExit);
      stdin.setRawMode(!!wasRaw); stdin.pause(); stdout.write('\x1b[?25h\x1b[?1049l');
    };
    function onExit() { stdout.write('\x1b[?25h\x1b[?1049l'); }
    function onData(chunk) {
      for (const key of pickerKeys(String(chunk))) {
        const next = pickerReduce(state, key, pickerModel(report, operator, repoPolicy, state));
        if (next.cancel) { restore(); resolve(null); return; }
        if (next.done) { restore(); resolve(next.done); return; }
        state = next;
      }
      draw();
    }
    stdout.write('\x1b[?1049h\x1b[?25l');
    stdin.setRawMode(true); stdin.setEncoding('utf8'); stdin.resume();
    stdin.on('data', onData); stdout.on('resize', draw); process.on('exit', onExit);
    draw();
  });
}

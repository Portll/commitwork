// bin/lib/brief-tui.mjs — an interactive terminal view of one remediation brief (bin/lib/brief.mjs).
// Rendering and key handling are pure over (state, brief, size); runBriefTui is the only part that
// touches the terminal.
import { DARK, DARK_SEMANTIC } from '../../lib/brand-tokens.mjs';

const SEV_HEX = { crit: DARK.crit, high: DARK_SEMANTIC.high, med: DARK_SEMANTIC.med, low: DARK_SEMANTIC.low,
  undetermined: DARK.mut, unknown: DARK.mut };
const COUNT_ORDER = ['crit', 'high', 'med', 'low', 'undetermined'];

const fgOpen = (hex) => `38;2;${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(';')}`;
const paint = (color) => (open, s) => (color && s ? `\x1b[${open}m${s}\x1b[0m` : s);

// Code points, not UTF-16 units, so a truncation never splits a surrogate pair.
const fit = (s, w) => {
  const cps = [...String(s ?? '').replace(/[\x00-\x1f\x7f]/g, ' ')];
  if (w <= 0) return '';
  return cps.length > w ? `${cps.slice(0, w - 1).join('')}…` : cps.join('') + ' '.repeat(w - cps.length);
};
const wrap = (s, w) => {
  const out = [];
  for (const para of String(s ?? '').split(/\r?\n/)) {
    let cps = [...para];
    if (!cps.length) { out.push(''); continue; }
    while (cps.length > w) {
      const head = cps.slice(0, w);
      const cut = head.lastIndexOf(' ');
      const at = cut > w / 3 ? cut : w;
      out.push(cps.slice(0, at).join('').trimEnd());
      cps = [...cps.slice(at).join('').trimStart()];
    }
    out.push(cps.join(''));
  }
  return out;
};
const loc = (t) => (t.file ? `${t.file}${t.line ? `:${t.line}` : ''}` : '');
const pkgAt = (p, v) => `${p}${v ? `@${v}` : ''}`;

export const SECTIONS = [
  { key: 'fixes', title: 'Fixes' },
  { key: 'findings', title: 'Findings' },
  { key: 'undetermined', title: 'Undetermined' },
  { key: 'unmeasured', title: 'Not measured' },
];

/** Each section as rows: { sev, kev, text, detail: [{ text, sev? }] }. */
export function sectionItems(b, key) {
  if (key === 'fixes') return b.actions.map((a) => ({
    sev: a.worst, kev: a.kev > 0,
    text: `${a.kev ? `KEV×${a.kev}` : '     '} ${a.worst.padEnd(5)} ${a.epss !== null ? `EPSS ${a.epss.toFixed(2)}` : '         '}  ${a.repo}  ${pkgAt(a.package, a.version)} → ${a.fix || 'no fixed version published'}`,
    detail: [
      { text: `${a.repo}: upgrade ${pkgAt(a.package, a.version)} → ${a.fix || 'no fixed version published'}` },
      { text: `declared in ${a.path || '(no manifest path reported)'}` },
      { text: '' },
      ...a.findings.flatMap((f) => [
        { sev: f.severity, text: `${f.id}  ${f.severity}${f.cvss ? ` · CVSS ${f.cvss}` : ''}${f.kev === true ? ' · KEV' : f.kev === null ? ' · KEV not consulted' : ''}${typeof f.epss === 'number' ? ` · EPSS ${f.epss.toFixed(2)}` : ''}${f.malicious ? ' · MALICIOUS' : ''}` },
        ...(f.title ? [{ text: `  ${f.title}` }] : []),
        ...(f.advisory ? [{ text: `  ${f.advisory}` }] : []),
        { text: `  ${f.fixed ? `fixed in ${f.fixed}` : 'no fixed version'} · reported by ${f.tool || 'unknown tool'}` },
      ]),
    ],
  }));
  if (key === 'findings') return b.issues.map((s) => {
    const counts = COUNT_ORDER.filter((k) => s.counts[k]).map((k) => `${k} ${s.counts[k]}`).join(' · ');
    return {
      sev: s.worst, kev: false,
      text: `${s.worst.padEnd(12)} ${s.repo}: ${s.label}  [${counts}]`,
      detail: [
        { text: `${s.repo}: ${s.label} (${s.check}, ${s.kind})` },
        { text: `${s.open} open${s.suppressed ? ` · ${s.suppressed} suppressed in source, not listed` : ''}${s.truncated ? ` · report truncated, ${s.truncated} more` : ''}` },
        { text: '' },
        ...s.top.flatMap((t) => [
          { sev: t.sev, text: `${t.sev.padEnd(12)} ${t.rule}${t.file ? `  ${loc(t)}` : ''}` },
          ...(t.message ? [{ text: `  ${t.message}` }] : []),
        ]),
        ...(s.open > s.top.length ? [{ text: '' }, { text: `${s.open - s.top.length} more in the lane's report.` }] : []),
      ],
    };
  });
  if (key === 'undetermined') return b.undetermined.map((u) => ({
    sev: 'undetermined', kev: false,
    text: `${u.repo}  ${u.id}  ${pkgAt(u.package, u.version)}${u.claimed ? `  (claimed ${u.claimed})` : ''}`,
    detail: [
      { text: `${u.repo}: ${u.id} on ${pkgAt(u.package, u.version)}` },
      { text: `the scanner claimed ${u.claimed || 'no severity'}; not counted in any severity` },
      { text: '' },
      { text: u.reason || 'no reason recorded' },
    ],
  }));
  if (key === 'unmeasured') return b.notMeasured.map((n) => ({
    sev: 'undetermined', kev: false,
    text: `${n.kind.padEnd(8)} ${n.repo}: ${n.check}`,
    detail: [
      { text: `${n.repo}: ${n.check} — ${n.kind === 'void' ? 'did not run' : 'ran without seeing everything'}` },
      { text: 'A lane that did not run, or ran without seeing everything, is not a pass.' },
      { text: '' },
      { text: n.reason || 'no reason recorded' },
    ],
  }));
  throw new Error(`unknown brief section: ${key}`);
}

export const initialState = () => ({ section: 0, cursor: SECTIONS.map(() => 0), top: SECTIONS.map(() => 0), expanded: false, help: false });

const HEADER_ROWS = 3;
const FOOTER_ROWS = 1;
function layout(rows, expanded) {
  const body = Math.max(1, rows - HEADER_ROWS - FOOTER_ROWS);
  if (expanded) return { list: 0, detail: body };
  const detail = body >= 12 ? Math.floor(body * 0.45) : 0;
  return { list: body - (detail ? detail + 1 : 0), detail };
}
const scrollTop = (top, cur, list) => (cur < top ? cur : list && cur >= top + list ? cur - list + 1 : top);

/** One keypress; returns the next state, or null to quit. */
export function reduce(state, key, b, { rows = 24 } = {}) {
  const s = { ...state, cursor: [...state.cursor], top: [...state.top] };
  if (key === 'quit') return null;
  if (s.help) { s.help = false; return s; }
  const n = sectionItems(b, SECTIONS[s.section].key).length;
  const page = Math.max(1, layout(rows, false).list - 1);
  const move = (d) => { s.cursor[s.section] = Math.max(0, Math.min(n - 1, s.cursor[s.section] + d)); };
  switch (key) {
    case 'up': move(-1); break;
    case 'down': move(1); break;
    case 'pgup': move(-page); break;
    case 'pgdn': move(page); break;
    case 'home': s.cursor[s.section] = 0; break;
    case 'end': s.cursor[s.section] = Math.max(0, n - 1); break;
    case 'next': s.section = (s.section + 1) % SECTIONS.length; break;
    case 'prev': s.section = (s.section + SECTIONS.length - 1) % SECTIONS.length; break;
    case 'enter': s.expanded = !s.expanded; break;
    case 'help': s.help = true; break;
    default:
      if (/^section[1-9]$/.test(key) && Number(key.slice(7)) <= SECTIONS.length) s.section = Number(key.slice(7)) - 1;
  }
  s.top[s.section] = scrollTop(s.top[s.section], s.cursor[s.section], layout(rows, s.expanded).list);
  return s;
}

/** Raw stdin bytes → key names. Unknown input is dropped, not guessed at. */
export function parseKeys(chunk) {
  const keys = [];
  const SEQ = [['\x1b[A', 'up'], ['\x1bOA', 'up'], ['\x1b[B', 'down'], ['\x1bOB', 'down'], ['\x1b[C', 'next'], ['\x1bOC', 'next'],
    ['\x1b[D', 'prev'], ['\x1bOD', 'prev'], ['\x1b[5~', 'pgup'], ['\x1b[6~', 'pgdn'], ['\x1b[H', 'home'], ['\x1b[1~', 'home'],
    ['\x1b[F', 'end'], ['\x1b[4~', 'end'], ['\x1b[Z', 'prev']];
  const CH = { k: 'up', j: 'down', g: 'home', G: 'end', ' ': 'pgdn', b: 'pgup', '\t': 'next', l: 'next', h: 'prev',
    '\r': 'enter', '\n': 'enter', q: 'quit', '\x03': 'quit', '\x04': 'quit', '?': 'help' };
  let i = 0;
  while (i < chunk.length) {
    const seq = SEQ.find(([s]) => chunk.startsWith(s, i));
    if (seq) { keys.push(seq[1]); i += seq[0].length; continue; }
    const c = chunk[i];
    if (c === '\x1b') {
      const rest = chunk.slice(i + 1).match(/^(\[[0-9;]*[~A-Za-z]|O[A-Za-z])/);
      if (rest) { i += 1 + rest[0].length; continue; }
      keys.push('quit'); i += 1; continue;
    }
    if (c >= '1' && c <= '9') keys.push(`section${c}`);
    else if (CH[c]) keys.push(CH[c]);
    i += 1;
  }
  return keys;
}

const HELP = [
  '↑ ↓  j k         move',
  'PgUp PgDn  b ␠   page',
  'g G  Home End    first / last',
  '← →  h l  Tab    previous / next section',
  '1–4              jump to a section',
  'Enter            detail full screen / back',
  'q  Esc  Ctrl-C   quit',
  '',
  'Any key closes this help.',
];

/** The whole screen as `rows` lines, each exactly `cols` columns wide before colour. */
export function renderScreen(state, b, { cols = 80, rows = 24, color = false } = {}) {
  const p = paint(color);
  const sevPaint = (sev, s) => (SEV_HEX[sev] ? p(fgOpen(SEV_HEX[sev]), s) : s);
  const lines = [];
  const kev = b.enrichment.kev.consulted ? `KEV ${b.enrichment.kev.catalogVersion} (${b.enrichment.kev.freshness})` : 'KEV not consulted';
  lines.push(p(`1;${fgOpen(DARK.acc)}`, fit(`Remediation brief · ${b.counts.repos} repo${b.counts.repos === 1 ? '' : 's'} · ${b.generatedAt}`, cols)));
  lines.push(p(fgOpen(DARK.mut), fit(`${kev} · EPSS for ${b.enrichment.epss.scored} of ${b.enrichment.epss.of} advisories${b.counts.suppressed ? ` · ${b.counts.suppressed} suppressed in source` : ''}`, cols)));
  const counts = SECTIONS.map((sec) => sectionItems(b, sec.key).length);
  let tabs = '';
  let tabsPlain = '';
  SECTIONS.forEach((sec, i) => {
    const t = ` ${i + 1} ${sec.title} (${counts[i]}) `;
    if ([...tabsPlain].length + t.length > cols) return;
    tabsPlain += t;
    tabs += i === state.section ? p('7;1', t) : p(fgOpen(DARK.mut), t);
  });
  lines.push(tabs + ' '.repeat(Math.max(0, cols - [...tabsPlain].length)));

  if (state.help) {
    const body = rows - HEADER_ROWS - FOOTER_ROWS;
    for (let r = 0; r < body; r++) lines.push(fit(HELP[r] !== undefined ? `  ${HELP[r]}` : '', cols));
    lines.push(p(fgOpen(DARK.mut), fit(' ? help', cols)));
    return lines.slice(0, rows);
  }

  const items = sectionItems(b, SECTIONS[state.section].key);
  const cur = Math.min(state.cursor[state.section], Math.max(0, items.length - 1));
  const { list, detail } = layout(rows, state.expanded);
  if (list) {
    const top = scrollTop(state.top[state.section], cur, list);
    for (let r = 0; r < list; r++) {
      const it = items[top + r];
      if (!it) {
        lines.push(fit(r === 0 && !items.length ? emptyText(SECTIONS[state.section].key, b) : '', cols));
        continue;
      }
      const marker = top + r === cur ? '›' : ' ';
      const text = fit(`${marker} ${it.text}`, cols);
      lines.push(top + r === cur ? p('7', text) : it.kev && color ? p(fgOpen(DARK.sev), text) : sevPaint(it.sev, text));
    }
  }
  if (detail) {
    if (list) lines.push(p(fgOpen(DARK.mut), '─'.repeat(cols)));
    const sel = items[cur];
    const dl = sel ? sel.detail.flatMap((d) => wrap(d.text, cols - 2).map((t) => ({ ...d, text: t }))) : [];
    const shown = dl.length > detail ? dl.slice(0, detail - 1) : dl;
    for (const d of shown) lines.push(sevPaint(d.sev, fit(` ${d.text}`, cols)));
    if (dl.length > detail) lines.push(p(fgOpen(DARK.mut), fit(` … ${dl.length - shown.length} more lines (brief.md has them all)`, cols)));
    for (let r = Math.min(dl.length, detail); r < detail; r++) lines.push(fit('', cols));
  }
  const pos = items.length ? `${cur + 1}/${items.length}` : '0/0';
  lines.push(p(fgOpen(DARK.mut), fit(` ${pos} · ↑↓ move · ←→ section · Enter ${state.expanded ? 'list' : 'detail'} · ? help · q quit`, cols)));
  return lines.slice(0, rows);
}

function emptyText(key, b) {
  if (key === 'fixes') return b.repos.some((r) => !r.depsMeasured) ? '  none found where dependency advisories were measured; see Not measured' : '  none found';
  if (key === 'findings') return '  none open';
  if (key === 'undetermined') return '  none';
  return '  every in-scope lane ran';
}

/** Run the viewer until the user quits. Resolves when the terminal is restored. */
export function runBriefTui(b, { stdin = process.stdin, stdout = process.stdout, color = true } = {}) {
  if (!stdin.isTTY || !stdout.isTTY) return Promise.reject(new Error('the brief viewer needs an interactive terminal'));
  return new Promise((resolve) => {
    let state = initialState();
    const wasRaw = stdin.isRaw;
    const size = () => ({ cols: Math.max(20, stdout.columns || 80), rows: Math.max(8, stdout.rows || 24) });
    const draw = () => {
      const { cols, rows } = size();
      stdout.write(`\x1b[H${renderScreen(state, b, { cols, rows, color }).map((l) => `${l}\x1b[K`).join('\r\n')}\x1b[J`);
    };
    const restore = () => {
      stdin.removeListener('data', onData);
      stdout.removeListener('resize', draw);
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('exit', onExit);
      stdin.setRawMode(!!wasRaw);
      stdin.pause();
      stdout.write('\x1b[?25h\x1b[?1049l');
    };
    function onData(chunk) {
      for (const key of parseKeys(String(chunk))) {
        const next = reduce(state, key, b, size());
        if (!next) { restore(); resolve(); return; }
        state = next;
      }
      draw();
    }
    // The alternate screen and the hidden cursor outlive the process unless they are put back.
    function onExit() { stdout.write('\x1b[?25h\x1b[?1049l'); }
    function onSignal() { restore(); process.exit(143); }
    stdout.write('\x1b[?1049h\x1b[?25l');
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
    stdout.on('resize', draw);
    process.on('SIGTERM', onSignal);
    process.on('exit', onExit);
    draw();
  });
}

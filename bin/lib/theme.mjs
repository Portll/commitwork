// ── commitwork terminal theme ────────────────────────────────────────────────────────────────
// One palette for every CLI surface: the panel's dark palette. Every token except `blocked` is the
// same-named token in admin/static/panel.css :root. `blocked` has no panel token.
// The panel's live console renders these RGB values as given (ansiHtml,
// admin/static/panel-console.js), so a run reads the same there as in a terminal.
//
// `crit` and `high` share a name with the panel's severity ramp, not a meaning: here they are
// the fail and noscan statuses.
//
// Colour precedence:
//   NO_COLOR / CW_NO_COLOR set   → never colour (https://no-color.org)
//   FORCE_COLOR set (not '0')    → always colour, even piped
//   otherwise                    → colour only on a TTY
// Truecolor only — terminals that cannot do it degrade to their nearest colour on their own.

import { DARK, DARK_SEMANTIC } from '../../lib/brand-tokens.mjs';

const env = process.env;
const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0';
const disabled = env.NO_COLOR !== undefined || env.CW_NO_COLOR !== undefined;

export const colorEnabled = !disabled && (forced || Boolean(process.stdout.isTTY));

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// bin/test/theme-palette.test.mjs holds every value to admin/static/panel.css :root.
export const PALETTE = {
  acc: rgb(DARK.acc),     // headings, the [tag] phase banner
  acc2: rgb(DARK.acc2),   // rules and underlines
  ink: rgb(DARK.ink),     // body text
  mut: rgb(DARK.mut),     // labels, secondary text
  dim: rgb(DARK.dim),     // echoed commands, paths, timings
  live: rgb(DARK.ok),     // pass
  part: rgb(DARK_SEMANTIC.part),  // skipped on purpose
  plan: rgb(DARK_SEMANTIC.plan),  // not applicable
  crit: rgb(DARK.crit),   // fail
  high: rgb(DARK_SEMANTIC.high),  // noscan — ran but produced nothing trustworthy
  // #f2448c  BLOCKED — a void a HUMAN can clear. Raspberry, so it stays apart from `crit` (the scan
  // ran and found a real problem) and from `noscan` (the scan ran and produced nothing, which may
  // be a genuine absence nobody can fix): dE76 30 from crit and 58 from high, 5.06:1 on --bg. A
  // missing credential or an absent tool is neither: it is a lane that COULD report and is not
  // being allowed to, and the only thing standing between it and coverage is an action somebody
  // can take. Rendering that the same grey as an unfixable void is what lets it sit for months —
  // the operator reads grey as "nothing to do here", which for every other grey is true.
  blocked: rgb('#f2448c'),
};

const sgr = (open, s) => (colorEnabled ? `\x1b[${open}m${s}\x1b[0m` : String(s));
const fg = (rgb) => (s) => sgr(`38;2;${rgb[0]};${rgb[1]};${rgb[2]}`, s);

export const bold = (s) => sgr('1', s);
export const acc = fg(PALETTE.acc);
export const acc2 = fg(PALETTE.acc2);
export const ink = fg(PALETTE.ink);
export const mut = fg(PALETTE.mut);
export const dim = fg(PALETTE.dim);
export const live = fg(PALETTE.live);
export const part = fg(PALETTE.part);
export const plan = fg(PALETTE.plan);
export const crit = fg(PALETTE.crit);
export const high = fg(PALETTE.high);

// Semantic aliases — call sites say what a thing MEANS, not what colour it is.
export const ok = live;          // a check passed
export const fail = crit;        // a check failed
export const noscan = high;      // ran, produced nothing trustworthy — NOT a pass and NOT a skip
export const blocked = fg(PALETTE.blocked); // a void with an OWNER — a human can clear it, unlike noscan
export const skipped = part;     // deliberately not run (no URL, n/a for this repo)
export const na = plan;          // inapplicable to this repo
export const cmd = dim;          // an echoed shell command
export const label = mut;        // field names / column headers
export const heading = (s) => bold(acc(s));

// One themed status token per state — noscan and skipped stay visually distinct from pass and from each other.
export const STATUS = {
  pass: () => ok('✓ pass'),
  fail: (why) => fail(`✗ fail${why ? ` (${why})` : ''}`),
  noscan: (why) => noscan(`▚ noscan${why ? ` — ${why}` : ''}`),
  // ■ not ▚: a blocked lane is solid, not hatched. The hatch says "we looked and saw through it";
  // the solid block says "we were stopped". The word BLOCKED is capitalised for the same reason the
  // colour stands apart from every other red — this is the one void with an owner, and it should
  // be the one that most obviously wants reading.
  blocked: (why) => blocked(`■ BLOCKED${why ? ` — ${why}` : ''}`),
  skipped: (why) => skipped(`⊘ skipped${why ? ` — ${why}` : ''}`),
  na: (why) => na(`· n/a${why ? ` — ${why}` : ''}`),
};

// Phase banner — the bracketed [tag] is the grep handle operators rely on in logs; keep it verbatim.
export const phase = (tag, msg) => `${acc(`[${tag}]`)} ${msg}`;

// Strip every SGR sequence. Used by tests and by anything that has to measure printed width.
export const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

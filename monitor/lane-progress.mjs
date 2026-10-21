// monitor/lane-progress.mjs — the runner tells the panel which LANE it is on, not just which repo.
//
// The sweep's stdout already carries progress, and the panel already parses it — but only at repo
// granularity (`(3/100) scan foo`). A lane running for the first time, or a lane that has just
// finished, was not observable at all: the panel could say a sweep was running and could say which
// repository it had reached, and nothing between those two facts. Everything per-lane on the page
// had to wait for the rollup, which lands after the whole sweep.
//
// So there is a line for it. One grammar, written here and parsed here, because the alternative —
// a regex in admin/serve.mjs matched against a format nothing declares — is how a display silently
// stops updating when someone reformats a console.log. The emitter and the parser are the same
// module and share a test.
//
// OFF BY DEFAULT. These lines are for a machine; a human watching a terminal should see exactly
// what they saw before. serve.mjs sets CW_LANE_PROGRESS=1 when IT spawns the run, which is the only
// context where anything reads them.
//
// The env is read at CALL time. A `const ON = process.env...` at module load would pin the answer
// before any test could set it, and the test would pass while proving nothing.

/** The marker. Deliberately unlike the human `[sweep]`/`▸` prefixes so neither can match the other. */
export const LANE_TAG = '[lane]';

const enabled = () => process.env.CW_LANE_PROGRESS === '1';

/**
 * One line, tab-separated, no colour. Tabs because every other field here is free text from a
 * manifest and a space-separated grammar would break on the first check id containing one.
 * @param {'start'|'end'} event
 * @param {{repo?:string, check:string, status?:string, ms?:number|null}} f
 */
export function laneProgress(event, f) {
  if (!enabled()) return null;
  const clean = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
  const line = [LANE_TAG, event, clean(f.repo), clean(f.check), clean(f.status),
    // A missing duration is empty, never 0. Zero milliseconds is a claim ("it ran, instantly");
    // absence is a different one ("nobody timed it"), and skipped lanes are the second.
    (typeof f.ms === 'number' ? String(f.ms) : '')].join('\t');
  console.log(line);
  return line;
}

/**
 * Parse one line. Returns null for anything that is not a lane line — which is almost every line
 * on the stream, so this must be cheap and must never throw on arbitrary console output.
 * @returns {{event:string, repo:string|null, check:string, status:string|null, ms:number|null}|null}
 */
export function parseLaneProgress(line) {
  if (typeof line !== 'string') return null;
  // The stream is colourised (FORCE_COLOR is set for the child so the panel console renders a
  // themed run), so a lane line can arrive wrapped in SGR codes even though the emitter writes
  // none — a reset sequence from the preceding line lands on this one. Strip before matching.
  const bare = line.replace(/\[[0-9;]*m/g, '').trim();
  if (!bare.startsWith(LANE_TAG)) return null;
  const [, event, repo, check, status, ms] = bare.split('\t');
  if (event !== 'start' && event !== 'end') return null;
  if (!check) return null;
  return {
    event,
    repo: repo || null,
    check,
    status: status || null,
    // '' means unrecorded and stays null. Number('') is 0, which would publish "nobody timed it"
    // as "it took no time" — the same unsupported-pass swap this repo refuses everywhere else.
    ms: ms === '' || ms == null ? null : (Number.isFinite(Number(ms)) ? Number(ms) : null),
  };
}

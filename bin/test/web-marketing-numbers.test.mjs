// Every capability number on the PUBLIC marketing pages, checked against the manifest that
// produces it. www.commitwork.online is served from cobolwork-web/public/commitwork/, hand-written,
// and nothing derived its figures from anything.
//
// Measured drift, and it is not slow: on 2026-10-18 a review fixed "80 Checks" to 82, "four checks
// sit outside all" to six, and "Node 18 or later" to 22.18. By 2026-10-19 the manifest had moved to
// 90 checks and 84 in `all`, so three of those numbers were stale again inside a day. Each one is a
// figure a reader can check against a tracked file in one command, which is the kind this
// repository treats as costing most.
//
// Group membership is resolved through groupMembers, the same union of the top-level `groups` map
// and each check's own `groups` tag that `run` resolves, because counting the map alone understates
// `all` by 36 and has already been published as a finding against a page that was correct.
//
// THE PAGE'S COMMITTED main IS READ, never cobolwork-web's working tree: a peer mid-edit there must
// not turn this red, and a page is only published once it is committed.
//
// releases/index.html IS DELIBERATELY OUT OF SCOPE and must stay that way. Its figures are dated
// history — "2026-10-08 · 0.5.0 · 82" is the count measured AT that commit — and its "to N checks"
// heading is written to agree with the last row of the generated table beneath it. Raising that
// heading to today's count would make the page contradict its own table; the way to move it is to
// add a milestone row to data/releases/commitwork-milestones.json and regenerate.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupMembers } from '../commitwork.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = process.env.CW_COBOLWORK_WEB || join(REPO, '..', 'cobolwork-web');
const manifest = () => JSON.parse(readFileSync(join(REPO, 'manifests', 'security-baseline.json'), 'utf8'));
const pkg = () => JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** "Six" or "6" → 6, so a page may spell a small number either way. */
const asNumber = (text) => {
  const t = String(text).trim().toLowerCase().replace(/,/g, '');
  const i = WORDS.indexOf(t);
  return i !== -1 ? i : Number(t);
};

/** A page as committed on cobolwork-web's main, or null when the checkout is absent. */
function committedPage(rel) {
  const r = spawnSync('git', ['-C', SITE, 'show', `main:public/commitwork/${rel}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

// Each claim: the page it is on, a regex with ONE capture group holding the stated figure, and what
// the tracked files say it should be. A claim whose regex stops matching is a FAILURE, never a
// skip — the page rewording its way out of a check is the quiet half of this defect.
const CLAIMS = [
  { page: 'index.html', what: 'the tally\'s check count',
    re: /<span class="n">([\d,]+)<\/span><span class="who">Checks<\/span>/,
    expected: (m) => m.checks.length },
  { page: 'index.html', what: 'the tally\'s `all` count',
    re: /<span class="n">([\d,]+)<\/span><span class="who">In <code>all<\/code><\/span>/,
    expected: (m) => groupMembers(m, 'all').length },
  { page: 'index.html', what: 'the tally\'s group count',
    re: /<span class="n">([\d,]+)<\/span><span class="who">Groups<\/span>/,
    expected: (m) => Object.keys(m.groups).length },
  { page: 'index.html', what: 'the tally\'s cobolwork lane count',
    re: /<span class="n">([\d,]+)<\/span><span class="who">cobolwork lanes<\/span>/,
    expected: (m) => groupMembers(m, 'cobol').length },
  { page: 'index.html', what: 'the count of checks outside `all`',
    re: /([A-Za-z\d,]+) checks? sit outside <code>all<\/code>/,
    expected: (m) => m.checks.length - groupMembers(m, 'all').length },
  { page: 'features/index.html', what: 'the manifest\'s check count in the heading',
    re: /<h2>([\d,]+) checks in one manifest/,
    expected: (m) => m.checks.length },
  { page: 'features/index.html', what: 'the triage-prompt numerator',
    re: /([\d,]+) of the [\d,]+ checks carry a triage prompt/,
    expected: (m) => m.checks.filter((c) => typeof c.remediationPrompt === 'string' && c.remediationPrompt.trim()).length },
  { page: 'features/index.html', what: 'the triage-prompt denominator',
    re: /[\d,]+ of the ([\d,]+) checks carry a triage prompt/,
    expected: (m) => m.checks.length },
  // The meta descriptions carry the same figure and are what a search result shows, so they drift
  // unseen — all three said 82 while the visible tally had already been corrected.
  { page: 'index.html', what: 'the page description\'s check count',
    re: /<meta name="description" content="commitwork runs ([\d,]+) security checks/,
    expected: (m) => m.checks.length },
  { page: 'index.html', what: 'the og:description check count',
    re: /<meta property="og:description" content="([\d,]+) security checks/,
    expected: (m) => m.checks.length },
  { page: 'features/index.html', what: 'the page description\'s check count',
    re: /<meta name="description" content="What commitwork does: ([\d,]+) security checks/,
    expected: (m) => m.checks.length },
];

describe('the public marketing pages', () => {
  const absent = existsSync(join(SITE, '.git')) ? null
    : `missing input: no cobolwork-web checkout at ${SITE}; set CW_COBOLWORK_WEB to one`;

  test('every stated figure matches the manifest it is drawn from', (t) => {
    if (absent) return t.skip(`${absent} -- the published figures were NOT checked`);
    const m = manifest();
    const pages = new Map();
    const wrong = [];
    for (const c of CLAIMS) {
      if (!pages.has(c.page)) pages.set(c.page, committedPage(c.page));
      const html = pages.get(c.page);
      assert.ok(html !== null, `cannot read main:public/commitwork/${c.page} from ${SITE}`);
      const hit = c.re.exec(html);
      assert.ok(hit, `${c.page}: the page no longer states ${c.what} in a form this guard reads (${c.re}). Re-anchor the claim rather than deleting it, or the figure goes unchecked.`);
      const stated = asNumber(hit[1]);
      const want = c.expected(m);
      if (stated !== want) wrong.push(`${c.page}: ${c.what} says ${hit[1]}, the manifest says ${want}`);
    }
    assert.deepEqual(wrong, [], `the published pages state figures the manifest contradicts:\n  ${wrong.join('\n  ')}`);
  });

  test('the Node floor on the pages is the one package.json declares', (t) => {
    if (absent) return t.skip(`${absent} -- the published Node floor was NOT checked`);
    const range = pkg().engines.node;
    const floor = /^>=\s*(\d+)\.(\d+)/.exec(range);
    assert.ok(floor, `package.json engines.node is ${JSON.stringify(range)}; this guard reads ">=X.Y"`);
    const want = `${floor[1]}.${floor[2]}`;
    for (const page of ['index.html', 'features/index.html', 'download/index.html', 'docs/index.html']) {
      const html = committedPage(page);
      assert.ok(html !== null, `cannot read main:public/commitwork/${page}`);
      const stated = [...html.matchAll(/Node(?:\.js)?<\/dt><dd>([\d.]+) or later|Node(?:\.js)? ([\d.]+) or later/g)]
        .map((x) => x[1] || x[2]);
      for (const s of stated) {
        assert.equal(s, want, `${page}: states Node ${s} or later; package.json engines.node is ${range}`);
      }
    }
  });

  // The other direction, asserted separately because only this one lies quietly: a regex that stops
  // matching makes the check above vacuous, and a vacuous check reads exactly like a passing one.
  test('no claim is silently unchecked — every regex still finds its figure', (t) => {
    if (absent) return t.skip(`${absent} -- the guard's own coverage was NOT checked`);
    const unmatched = [];
    const pages = new Map();
    for (const c of CLAIMS) {
      if (!pages.has(c.page)) pages.set(c.page, committedPage(c.page));
      if (!c.re.test(pages.get(c.page) || '')) unmatched.push(`${c.page}: ${c.what}`);
    }
    assert.deepEqual(unmatched, [], `these claims are no longer found on the page, so nothing checks them:\n  ${unmatched.join('\n  ')}`);
  });
});

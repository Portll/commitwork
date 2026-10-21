import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRoadmap, pillClass, renderItem, renderPage, dataPath, pagePath, tally, workText, deriveWork } from '../web-roadmap.mjs';
import { missingWebRoot } from '../../lib/web-root.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO, 'bin', 'web-roadmap.mjs');
// The served page and its data live in the commitwork-web repository, read where it is checked out.
const SITE_ABSENT = missingWebRoot();
const DATA = dataPath();
const PAGE = pagePath();

const temps = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'web-roadmap-')); temps.push(d); return d; };
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

const run = (args, env) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const SHELL = '<ul><li><b>Current:</b> old</li></ul>\n  <!-- roadmap: roadmap.json -->\n  <!-- /roadmap -->\n';
const DOC = { current: 'now', cards: [{ title: '0.2.0', status: 'planned', sub: 's', items: [{ name: 'A', ben: 'b.', pill: 'planned' }] }] };

describe('the served page', () => {
  test('is current against commitwork-web/roadmap.json', (t) => {
    if (SITE_ABSENT) return t.skip(`${SITE_ABSENT} -- the page was NOT checked against its data`);
    const page = readFileSync(PAGE, 'utf8');
    assert.equal(renderPage(page, validateRoadmap(JSON.parse(readFileSync(DATA, 'utf8')), DATA)), page,
      'run node bin/web-roadmap.mjs --write');
  });

  // cobolwork-web renders the same file on its own commitwork page; a second copy that drifts would
  // publish two roadmaps. Its committed main is read, never its working tree.
  test('equals the copy cobolwork-web renders, byte for byte', (t) => {
    const site = process.env.CW_COBOLWORK_WEB || join(REPO, '..', 'cobolwork-web');
    if (!existsSync(join(site, '.git'))) { t.skip(`no cobolwork-web checkout at ${site}`); return; }
    if (SITE_ABSENT) return t.skip(`${SITE_ABSENT} -- the two roadmap copies were NOT compared`);
    const r = spawnSync('git', ['-C', site, 'show', 'main:data/roadmap/commitwork.json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `git show failed: ${r.stderr}`);
    assert.equal(r.stdout, readFileSync(DATA, 'utf8'), 'copy commitwork-web/roadmap.json to cobolwork-web data/roadmap/commitwork.json, or back');
  });
});

describe('validateRoadmap', () => {
  const bad = (mutate) => { const d = structuredClone(DOC); mutate(d); return () => validateRoadmap(d, 'x.json'); };
  test('refuses a misspelt key, which would drop its text from the page', () => {
    assert.throws(bad((d) => { d.cards[0].items[0].limt = 'x'; }), /item 1: unknown key "limt"/);
    assert.throws(bad((d) => { d.cards[0].subtitle = 'x'; }), /unknown key "subtitle"/);
  });
  test('refuses an item with neither or both of name and lead, a fact with no benefit, and a malformed spine id', () => {
    assert.throws(bad((d) => { delete d.cards[0].items[0].name; }), /exactly one of "name" and "lead"/);
    assert.throws(bad((d) => { d.cards[0].items[0] = { name: 'A', fact: 'f' }; }), /"fact" needs "ben"/);
    assert.throws(bad((d) => { d.cards[0].items[0].spine = 'commitwork-roadmap'; }), /"spine" is not/);
    assert.throws(bad((d) => { d.cards[0].items[0].added = 'yes'; }), /"added" is not true or false/);
  });
  test('refuses a work list that does not match its commits one for one, or an entry of the wrong shape', () => {
    const item = { name: 'A', ben: 'b.', commits: ['abc1234'], work: [{ date: '2026-10-07', what: 'W' }] };
    assert.doesNotThrow(bad((d) => { d.cards[0].items[0] = structuredClone(item); }));
    assert.throws(bad((d) => { d.cards[0].items[0] = { ...structuredClone(item), commits: undefined }; }), /"work" needs one entry per commit/);
    assert.throws(bad((d) => { d.cards[0].items[0] = { ...structuredClone(item), commits: ['abc1234', 'def5678'] }; }), /"work" needs one entry per commit/);
    assert.throws(bad((d) => { d.cards[0].items[0] = { ...structuredClone(item), work: [{ date: '07/10/2026', what: 'W' }] }; }), /entry 1 is not/);
    assert.throws(bad((d) => { d.cards[0].items[0] = { ...structuredClone(item), work: [{ date: '2026-10-07', what: 'W', sha: 'x' }] }; }), /entry 1 is not/);
  });
  test('refuses a document with no current line or no cards', () => {
    assert.throws(() => validateRoadmap({ cards: [] }, 'x.json'), /current: missing/);
    assert.throws(() => validateRoadmap(null, 'x.json'), /current: missing/);
  });
});

describe('rendering', () => {
  test('a pill takes the house class its text names, and an unknown text refuses', () => {
    assert.equal(pillClass('in 0.2.0'), 'pill live');
    assert.equal(pillClass('on main'), 'pill live');
    assert.equal(pillClass('started'), 'pill part');
    assert.equal(pillClass('planned'), 'pill plan');
    assert.throws(() => pillClass('soon'), /no pill class for "soon"/);
  });
  test('an item reads benefit, fact, sub-items, limit, then its pills', () => {
    assert.equal(renderItem({ name: 'N', ben: 'b.', fact: 'f.', sub: ['s'], limit: 'l.', pill: 'started', added: true }),
      '<li><b>N</b>: <span class="ben">b.</span> f.<ul class="sub"><li>s</li></ul><span class="limit"><b>Limit:</b> l.</span>'
      + '<span class="pill part">started</span><span class="pill add">additional</span></li>');
  });
  test('an item with work lists each change under it, dated, behind a count', () => {
    const html = renderItem({ name: 'N', ben: 'b.', pill: 'on main', commits: ['a'.repeat(7), 'b'.repeat(7)],
      work: [{ date: '2026-10-06', what: 'First' }, { date: '2026-10-07', what: 'Second' }] });
    assert.match(html, /<span class="pill live">on main<\/span><details class="work"><summary>2 changes<\/summary><ul>/);
    assert.match(html, /<li><time datetime="2026-10-06">2026-10-06<\/time> First<\/li><li><time datetime="2026-10-07">2026-10-07<\/time> Second<\/li>/);
    assert.match(renderItem({ name: 'N', commits: ['a'.repeat(7)], work: [{ date: '2026-10-06', what: 'Only' }] }), /<summary>1 change<\/summary>/);
  });
  test('a release tallies its finished features and the changes under them', () => {
    const card = { items: [{ pill: 'on main', work: [{}, {}] }, { pill: 'in 0.5.0', work: [{}] }, { pill: 'planned' }] };
    assert.equal(tally(card), '2 of 3 features done · 3 changes');
    assert.equal(tally({ items: [{ pill: 'started' }] }), '0 of 1 feature done');
  });
  test('a commit subject becomes a sentence without its type and scope, escaped for the page', () => {
    assert.equal(workText("feat(bin): export a run's findings as SARIF 2.1.0"), "Export a run's findings as SARIF 2.1.0");
    assert.equal(workText('fix!: the POA&M covers <every> finding'), 'The POA&amp;M covers &lt;every&gt; finding');
    assert.equal(workText('docs: re-verify'), 'Re-verify');
    assert.equal(workText('No prefix here'), 'No prefix here');
  });
  test('the cards replace what lies between the markers, and the Current line follows the data', () => {
    const out = renderPage(SHELL, DOC);
    assert.match(out, /<li><b>Current:<\/b> now<\/li>/);
    assert.match(out, /<!-- roadmap: roadmap\.json -->\n  <div class="card">\n    <h3>0\.2\.0<span class="pill plan">planned<\/span><\/h3>/);
    assert.equal(renderPage(out, DOC), out, 'rendering is idempotent');
  });
  test('a page without its markers refuses rather than passing as current', () => {
    assert.throws(() => renderPage('<p>no markers</p>', DOC), /no <!-- roadmap: … --> marker/);
    assert.throws(() => renderPage('  <!-- roadmap: roadmap.json -->\n', DOC), /no <!-- \/roadmap -->/);
  });
});

describe('the CLI', () => {
  const fixture = (doc = DOC) => {
    const root = temp();
    mkdirSync(join(root, 'roadmap'));
    writeFileSync(join(root, 'roadmap', 'index.html'), SHELL);
    const data = join(root, 'roadmap.json');
    writeFileSync(data, typeof doc === 'string' ? doc : JSON.stringify(doc));
    return { root, data, env: { CW_WEB_ROOT: root, CW_WEB_ROADMAP: data } };
  };
  test('reports a stale page with exit 1 and writes nothing', () => {
    const f = fixture();
    const r = run([], f.env);
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(readFileSync(join(f.root, 'roadmap', 'index.html'), 'utf8'), SHELL);
  });
  test('--write renders the page, after which it is current', () => {
    const f = fixture();
    assert.equal(run(['--write'], f.env).code, 0);
    assert.match(readFileSync(join(f.root, 'roadmap', 'index.html'), 'utf8'), /<b>A<\/b>: <span class="ben">b\.<\/span>/);
    assert.equal(run([], f.env).code, 0);
  });
  test("--work writes each item's work from its commits in the source repository, and refuses a commit it lacks", () => {
    const repo = temp();
    const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: '2026-10-07T12:00:00Z', GIT_AUTHOR_DATE: '2026-10-07T12:00:00Z' } });
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'feat(bin): export findings as SARIF');
    const sha = git('rev-parse', 'HEAD').stdout.trim();
    const doc = structuredClone(DOC);
    doc.cards[0].items[0].commits = [sha.slice(0, 8)];
    const f = fixture(doc);
    assert.equal(run(['--work', '--write'], { ...f.env, CW_RELEASE_SOURCE: repo }).code, 0);
    assert.deepEqual(JSON.parse(readFileSync(f.data, 'utf8')).cards[0].items[0].work, [{ date: '2026-10-07', what: 'Export findings as SARIF' }]);
    assert.match(readFileSync(join(f.root, 'roadmap', 'index.html'), 'utf8'), /<summary>1 change<\/summary>/);
    const before = readFileSync(f.data, 'utf8');
    assert.deepEqual(deriveWork(JSON.parse(before), repo), JSON.parse(before), 're-deriving is idempotent');
    doc.cards[0].items[0].commits = ['f'.repeat(40)];
    const g = fixture(doc);
    const r = run(['--work', '--write'], { ...g.env, CW_RELEASE_SOURCE: repo });
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /commit f{40} is not in/);
    assert.equal(readFileSync(g.data, 'utf8'), JSON.stringify(doc), 'the data is left as it was');
  });
  test('malformed data exits 2 and leaves the page alone, never an empty roadmap', () => {
    const f = fixture('{"current":');
    const r = run(['--write'], f.env);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /nothing written/);
    assert.equal(readFileSync(join(f.root, 'roadmap', 'index.html'), 'utf8'), SHELL);
  });
});

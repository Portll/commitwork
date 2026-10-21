// bin/release-names-reseed.mjs end to end. Its scan reads the HEAD of the repository the script sits
// in (REPO is derived from the module's own path, with no override), so the script and its two leaf
// imports are copied verbatim into a scratch git repo whose HEAD carries known offenders. The scope
// documents and the baseline are CW_* overrides in tmp. The name in scope is synthetic.
// Pins: MONOTONE — a HEAD offender the baseline lacks is refused (exit 2) and nothing is written;
// a floor already at reality is a no-op; the dry run lists removals and writes nothing; --write
// removes exactly those entries, matching \u-escaped keys by their parsed value and leaving every
// other escape in the raw text; a baseline it cannot read line-by-line is refused (exit 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COPIED = ['bin/release-names-reseed.mjs', 'bin/lib/release-names-head-scan.mjs', 'bin/lib/release-scope.mjs'];
// Spelled out of parts, so this file carries no contiguous form of the name it puts in scope.
const NAME = ['zorble', 'flux'].join('');

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'cw-reseed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const files = {
    [`docs/${NAME}-notes.md`]: 'meeting notes\n',          // offends by PATH
    'src/app.txt': `client: ${NAME.slice(0, 6)}_${NAME.slice(6)}\n`, // offends by CONTENT (separator form)
    'src/clean.txt': 'nothing to see\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), body);
  }
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test');
  git('add', '-A'); git('commit', '-q', '-m', 'fixture');
  // copied AFTER the commit: untracked, so the scan of HEAD never sees the tool itself
  for (const rel of COPIED) { mkdirSync(dirname(join(repo, rel)), { recursive: true }); copyFileSync(join(CW, rel), join(repo, rel)); }
  const scope = join(root, 'scope'); mkdirSync(scope);
  writeFileSync(join(scope, 'release.json'), JSON.stringify({ names: [{ name: NAME }] }));
  writeFileSync(join(scope, 'publish.json'), JSON.stringify({ map: {} }));
  writeFileSync(join(scope, 'identities.json'), JSON.stringify({ identities: [] }));
  return { root, repo, scope, baseline: join(root, 'baseline.json') };
}

const esc = (s) => s.replace(NAME[0], '\\u007a');            // the house form: first letter \u-escaped
const key = (k) => `"${esc(k)}"`;
function baselineText({ paths, content }) {
  const block = (ks) => ks.map((k, i) => `    ${key(k)}: 1${i < ks.length - 1 ? ',' : ''}`).join('\n');
  return ['{', '  "_comment": "fixture floor; escapes such as \\u0073 stay escaped",', '  "version": 1,',
    '  "paths": {', block(paths), '  },', '  "content": {', block(content), '  }', '}', ''].join('\n');
}

function reseed(s, args = []) {
  const env = { ...process.env, CW_RELEASE_REDACTIONS: join(s.scope, 'release.json'),
    CW_PUBLISH_REDACTIONS: join(s.scope, 'publish.json'), CW_REPO_IDENTITIES: join(s.scope, 'identities.json'),
    CW_RELEASE_NAMES_HEAD_BASELINE: s.baseline };
  delete env.CW_RELEASE_NAMES_HEAD_REF;
  const r = spawnSync(process.execPath, [join(s.repo, 'bin', 'release-names-reseed.mjs'), ...args], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const PATH_HIT = `docs/${NAME}-notes.md`;

test('an offender at HEAD that the baseline does not carry is REFUSED, and the floor is not touched', (t) => {
  const s = sandbox(t);
  const text = baselineText({ paths: [], content: [] });
  writeFileSync(s.baseline, text);
  const r = reseed(s, ['--write']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /^REFUSING: these are offenders at HEAD that the baseline does not carry\./);
  assert.match(r.err, new RegExp(`  path::${PATH_HIT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n`));
  assert.match(r.err, /  content::src\/app\.txt\n/);
  assert.match(r.err, /A reseed may only lower the floor/);
  assert.equal(readFileSync(s.baseline, 'utf8'), text);
});

test('a floor already at reality is a no-op', (t) => {
  const s = sandbox(t);
  writeFileSync(s.baseline, baselineText({ paths: [PATH_HIT], content: ['src/app.txt'] }));
  const r = reseed(s, ['--write']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), 'floor is already at reality — nothing to remove');
});

test('the dry run names what is clean at HEAD and writes nothing', (t) => {
  const s = sandbox(t);
  const text = baselineText({ paths: [`old/${NAME}-gone.md`, PATH_HIT], content: ['src/app.txt', 'src/retired.txt'] });
  writeFileSync(s.baseline, text);
  const r = reseed(s);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /clean at HEAD and removable: 1 path\(s\), 1 content file\(s\)/);
  assert.match(r.out, new RegExp(`  - paths::old/${NAME}-gone\\.md\n`));
  assert.match(r.out, /  - content::src\/retired\.txt\n/);
  assert.match(r.out, /dry run — pass --write to apply/);
  assert.equal(readFileSync(s.baseline, 'utf8'), text);
});

test('--write removes exactly the clean entries by parsed key and keeps every other escape raw', (t) => {
  const s = sandbox(t);
  writeFileSync(s.baseline, baselineText({ paths: [PATH_HIT, `old/${NAME}-gone.md`], content: ['src/app.txt', 'src/retired.txt'] }));
  const before = readFileSync(s.baseline, 'utf8');
  const escapes = (x) => (x.match(/\\u00[0-9a-f]{2}/g) || []).length;
  const r = reseed(s, ['--write']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /floor lowered by 2 entr\(ies\), 2 escapes preserved/);
  const after = readFileSync(s.baseline, 'utf8');
  const doc = JSON.parse(after);
  assert.deepEqual(Object.keys(doc.paths), [PATH_HIT]);
  assert.deepEqual(Object.keys(doc.content), ['src/app.txt']);
  assert.equal(escapes(before), 3, 'fixture: the comment, the kept key, the removed key');
  assert.equal(escapes(after), 2, 'only the escape carried out by its removed entry is gone');
  assert.ok(after.includes(key(PATH_HIT)), 'the kept key is still \\u-escaped in the raw text');
  assert.equal(after.includes(NAME), false, 'the rewrite resolved an escape into the literal name');
});

test('a baseline it cannot read line-by-line is refused (exit 3), never half-edited', (t) => {
  const s = sandbox(t);
  // one line per section: the entry matcher cannot locate the keys to remove
  const text = `{"version":1,"paths":{${key(PATH_HIT)}:1,${key(`old/${NAME}-gone.md`)}:1},"content":{"src/app.txt":1}}\n`;
  writeFileSync(s.baseline, text);
  const r = reseed(s, ['--write']);
  assert.equal(r.code, 3, r.out + r.err);
  assert.match(r.err, /REFUSING: asked to remove 1 entr\(ies\) and matched 0\. Not editing a file it cannot read exactly\./);
  assert.equal(readFileSync(s.baseline, 'utf8'), text);
});

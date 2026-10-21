import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTerms, loadTerms, scanTree, summarise, termsGate, maskPath } from '../lib/release-terms.mjs';
import { main, parseArgs, EXIT } from '../release-terms.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLE = join(REPO, 'monitor', 'release-terms.example.json');
const example = () => JSON.parse(readFileSync(EXAMPLE, 'utf8'));
const dir = () => mkdtempSync(join(tmpdir(), 'cw-release-terms-test-'));
const LIST = () => ({ fingerprint: 'test', ...compileTerms(example(), 'example') });

function plantedTree() {
  const root = dir();
  writeFileSync(join(root, 'a.md'), 'Uses Example-Internal-Tool here.\nexample-internal-toolkit is another word.\n');
  mkdirSync(join(root, 'example-sibling-service'));
  writeFileSync(join(root, 'example-sibling-service', 'readme.txt'), 'nothing denied in the text\n');
  writeFileSync(join(root, 'bin.dat'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('example-internal-tool')]));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'CHANGELOG.md'), 'example-incident 2026-01-01 on a box\n');
  writeFileSync(join(root, 'notes.txt'), 'example-customer-b asked; an example-ruling followed.\n');
  return root;
}

function cleanTree() {
  const root = dir();
  writeFileSync(join(root, 'README.md'), 'A product readme with nothing private in it.\n');
  return root;
}

describe('compileTerms', () => {
  test('the shipped example compiles against its schema', () => {
    const { rules } = compileTerms(example(), 'example');
    assert.deepEqual(rules.map((r) => r.id), ['internal-tool', 'customer-pseudonym', 'maintainer-history']);
  });

  test('a duplicate id, a bad pattern, an empty-matching pattern and an unknown key each refuse, naming the rule', () => {
    const doc = example();
    assert.throws(() => compileTerms({ rules: [doc.rules[0], doc.rules[0]] }), /'internal-tool' is declared twice/);
    assert.throws(() => compileTerms({ rules: [{ id: 'bad', why: 'bad pattern', patterns: ['(unclosed'] }] }), /'bad' term 1 is not a valid pattern/);
    assert.throws(() => compileTerms({ rules: [{ id: 'empty', why: 'matches nothing', patterns: ['x*'] }] }), /'empty' term 1 matches the empty string/);
    assert.throws(() => compileTerms({ rules: [{ id: 'extra', why: 'unknown key', words: ['ab'], typo: true }] }));
    assert.throws(() => compileTerms({ rules: [{ id: 'none', why: 'no terms at all' }] }), /'none' has no words and no patterns/);
  });
});

describe('scanTree', () => {
  test('finds a word in content and in a path, case-insensitively, and only as a whole word', () => {
    const root = plantedTree();
    const s = scanTree(root, LIST());
    const at = (path, rule, where) => s.hits.filter((h) => h.path === path && h.rule === rule && h.where === where).reduce((n, h) => n + h.count, 0);
    assert.equal(at('a.md', 'internal-tool', 'content'), 1, 'Example-Internal-Tool counts once; toolkit is another word');
    assert.equal(at('example-sibling-service/readme.txt', 'internal-tool', 'path'), 1);
    assert.equal(at('notes.txt', 'customer-pseudonym', 'content'), 1);
    assert.equal(at('notes.txt', 'maintainer-history', 'content'), 1);
    rmSync(root, { recursive: true, force: true });
  });

  test('a binary is read by path only, and an excepted path is not searched', () => {
    const root = plantedTree();
    const s = scanTree(root, LIST());
    assert.equal(s.skipped.binary, 1);
    assert.deepEqual(s.hits.filter((h) => h.path === 'bin.dat'), []);
    assert.deepEqual(s.hits.filter((h) => h.path === 'docs/CHANGELOG.md'), []);
    assert.equal(s.examined, 4);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('summarise and termsGate', () => {
  test('a planted tree fails, and nothing a denied term matched appears in the detail', () => {
    const root = plantedTree();
    const g = termsGate(root, { load: LIST });
    assert.equal(g.status, 'fail');
    assert.deepEqual(Object.keys(g.detail.byRule), ['customer-pseudonym', 'internal-tool', 'maintainer-history']);
    assert.equal(g.detail.offendingFiles, 3);
    const text = JSON.stringify(g).toLowerCase();
    for (const t of ['example-internal-tool', 'example-sibling-service', 'example-customer-b', 'example-ruling']) assert.ok(!text.includes(t), `${t} leaked into the gate detail`);
    assert.ok(g.detail.files.some((f) => f.path === '***/readme.txt'), 'a denied directory name is masked');
    rmSync(root, { recursive: true, force: true });
  });

  test('a clean tree passes', () => {
    const root = cleanTree();
    assert.equal(termsGate(root, { load: LIST }).status, 'pass');
    rmSync(root, { recursive: true, force: true });
  });

  test('no list, an unreadable list and an empty tree are cannot-check, never pass', () => {
    const root = cleanTree();
    assert.equal(termsGate(root, { load: () => null }).status, 'cannot-check');
    assert.match(termsGate(root, { load: () => { throw new Error('boom'); } }).detail.error, /cannot be read \(boom\)/);
    const empty = dir();
    assert.equal(termsGate(empty, { load: LIST }).status, 'cannot-check');
    rmSync(root, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  });

  test('maskPath hides every denied term in a path', () => {
    assert.equal(maskPath('lib/example-internal-tool/example-customer-a.mjs', LIST()), 'lib/***/***.mjs');
  });
});

describe('loadTerms', () => {
  test('CW_RELEASE_TERMS is read at call time, and a named list that is missing throws', () => {
    const d = dir();
    const p = join(d, 'terms.json');
    writeFileSync(p, JSON.stringify(example()));
    const list = loadTerms({ env: { CW_RELEASE_TERMS: p } });
    assert.equal(list.source, p);
    assert.equal(list.rules.length, 3);
    assert.throws(() => loadTerms({ env: { CW_RELEASE_TERMS: join(d, 'absent.json') } }), /ENOENT/);
    writeFileSync(p, '{ not json');
    assert.throws(() => loadTerms({ env: { CW_RELEASE_TERMS: p } }), /not JSON/);
    rmSync(d, { recursive: true, force: true });
  });

  test('no sidecar, or a sidecar without the list, is null; a committed list loads', () => {
    const d = dir();
    assert.equal(loadTerms({ env: { CW_SIDECAR: join(d, 'absent') } }), null);
    const side = join(d, 'sidecar');
    mkdirSync(join(side, 'monitor'), { recursive: true });
    const git = (...a) => execFileSync('git', ['-C', side, ...a], { stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(side, 'README.md'), 'sidecar\n');
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'one');
    assert.equal(loadTerms({ env: { CW_SIDECAR: side } }), null);
    writeFileSync(join(side, 'monitor', 'release-terms.json'), JSON.stringify(example()));
    assert.equal(loadTerms({ env: { CW_SIDECAR: side } }), null, 'an uncommitted list is not the reviewed one');
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'two');
    const list = loadTerms({ env: { CW_SIDECAR: side } });
    assert.match(list.source, /^sidecar HEAD:monitor\/release-terms\.json$/);
    assert.equal(list.rules.length, 3);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('the CLI', () => {
  const quiet = () => { const lines = []; return { lines, out: (l) => lines.push(l), err: (l) => lines.push(l) }; };

  test('usage errors exit 22', () => {
    assert.equal(main(['--bogus'], quiet()), EXIT.USAGE);
    assert.equal(main(['--root'], quiet()), EXIT.USAGE);
    assert.ok(parseArgs(['--ref', 'HEAD', '--root', '.']).error);
  });

  test('no list exits 21; a planted tree exits 20; a clean tree exits 0', () => {
    const planted = plantedTree(), clean = cleanTree();
    assert.equal(main(['--root', clean], { ...quiet(), load: () => null }), EXIT.CANNOT_CHECK);
    assert.equal(main(['--root', planted], { ...quiet(), load: LIST }), EXIT.FOUND);
    assert.equal(main(['--root', clean], { ...quiet(), load: LIST }), EXIT.CLEAN);
    rmSync(planted, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  });

  test('--json masks paths unless --show-paths is given', () => {
    const planted = plantedTree();
    const a = quiet();
    main(['--root', planted, '--json'], { ...a, load: LIST });
    const masked = JSON.parse(a.lines.join('\n'));
    assert.ok(masked.files.some((f) => f.path === '***/readme.txt'));
    const b = quiet();
    main(['--root', planted, '--json', '--show-paths'], { ...b, load: LIST });
    assert.ok(JSON.parse(b.lines.join('\n')).files.some((f) => f.path === 'example-sibling-service/readme.txt'));
    rmSync(planted, { recursive: true, force: true });
  });
});

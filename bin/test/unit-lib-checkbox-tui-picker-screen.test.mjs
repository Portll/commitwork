// Renders the dependency update picker as fixed-width screen lines (bin/lib/checkbox-tui.mjs pickerScreen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerScreen } from '../lib/checkbox-tui.mjs';

const D = '\u00b7';
const CUR = '\u203a';
const TO = '\u2192';
const ELL = '\u2026';
const pad = (s, w = 80) => s + ' '.repeat(w - [...s].length);
const blank = pad('');
const policy = (narrowed = []) => ({ cooldown: { patch: 1, minor: 2, major: 3 }, narrowed });
const dep = (name, more = {}) => ({ id: `dep:${name}`, name, locked: '1.0.0', pick: null, checked: false, exposure: 'public', held: 0, ...more });
const none = (name, cur = ' ') => pad(`${cur}  -  ${name} 1.0.0 ${TO} no update of the chosen types  public`);
const typesLine = (m, cd = '1/2/3') => pad(`types: [${m[0]}] 1 patch  [${m[1]}] 2 minor  [${m[2]}] 3 major   cooldown ${cd} d`);
const footer = (count) => pad(` ${count} selected ${D} space toggle ${D} 1 2 3 types ${D} Enter propose ${D} q cancel`);
const head = [pad(`Dependency updates ${D} r`), typesLine('x  '), blank];
const frame = (body, count = '0 packages') => [...head, ...body, blank, footer(count)];
const patchOnly = (cursor = 0) => ({ types: ['patch'], cursor });
const named = { name: 'r', dir: 'd' };
const ten = Array.from({ length: 10 }, (_, i) => dep(`p${i}`));
const scrolled = (cursor) => pickerScreen(patchOnly(cursor), { policy: policy(), rows: ten }, named, { cols: 80, rows: 9 });

test('an empty model without a name shows the directory, fills the default 24 rows and counts 0 packages', () => {
  const r = pickerScreen(patchOnly(), { policy: policy(), rows: [] }, { name: '', dir: '/srv/app' });
  assert.deepEqual(r, [
    pad(`Dependency updates ${D} /srv/app`),
    typesLine('x  '),
    blank,
    ...Array.from({ length: 19 }, () => blank),
    blank,
    footer('0 packages'),
  ]);
});

test('rows are marked by pick, checked and available state, the cursor row gets the arrow and one package is singular', () => {
  const model = {
    policy: { cooldown: { patch: 0, minor: 7, major: 30 }, narrowed: ['minor capped', 'major off'] },
    rows: [
      dep('a', { pick: { version: '1.0.1', type: 'patch' }, checked: true, held: 2 }),
      dep('b', { locked: '2.0.0', pick: { version: '2.1.0', type: 'minor' }, exposure: 'dev' }),
      { id: 'group:tools', label: 'tools', available: true, checked: true },
      { id: 'group:x', label: 'x', available: false, checked: true },
    ],
  };
  const r = pickerScreen({ types: ['patch', 'major'], cursor: 1 }, model, { name: 'shop', dir: '/srv/shop' }, { cols: 80, rows: 10 });
  assert.deepEqual(r, [
    pad(`Dependency updates ${D} shop`),
    typesLine('x x', '0/7/30'),
    pad('repository policy: minor capped; major off'),
    pad(`  [x] a 1.0.0 ${TO} 1.0.1 (patch)  public  ${D} 2 held by cooldown`),
    pad(`${CUR} [ ] b 2.0.0 ${TO} 2.1.0 (minor)  dev`),
    pad('  [x] tools'),
    pad('   -  x'),
    blank,
    blank,
    footer('1 package'),
  ]);
});

test('five rows keep a one-line body and cut the footer off', () => {
  const r = pickerScreen(patchOnly(), { policy: policy(), rows: [dep('a'), dep('b')] }, named, { cols: 80, rows: 5 });
  assert.deepEqual(r, [...head, none('a', CUR), blank]);
});

test('six rows give a one-line body and a checked package with no eligible update is a dash but still counted', () => {
  const r = pickerScreen(patchOnly(), { policy: policy(), rows: [dep('a', { checked: true })] }, named, { cols: 80, rows: 6 });
  assert.deepEqual(r, frame([none('a', CUR)], '1 package'));
});

test('seven rows give a two-line body and two checked packages are plural', () => {
  const rows = [
    dep('a', { pick: { version: '1.1.0', type: 'minor' }, checked: true }),
    dep('b', { pick: { version: '1.2.0', type: 'minor' }, checked: true }),
  ];
  const r = pickerScreen(patchOnly(1), { policy: policy(), rows }, named, { cols: 80, rows: 7 });
  assert.deepEqual(r, frame([
    pad(`  [x] a 1.0.0 ${TO} 1.1.0 (minor)  public`),
    pad(`${CUR} [x] b 1.0.0 ${TO} 1.2.0 (minor)  public`),
  ], '2 packages'));
});

test('the window centres the cursor in the body when the list is longer than the screen', () => {
  assert.deepEqual(scrolled(5), frame([none('p3'), none('p4'), none('p5', CUR), none('p6')]));
  assert.deepEqual(scrolled(2), frame([none('p0'), none('p1'), none('p2', CUR), none('p3')]));
});

test('the window stops scrolling once the last row is visible', () => {
  assert.deepEqual(scrolled(7), frame([none('p5'), none('p6'), none('p7', CUR), none('p8')]));
  assert.deepEqual(scrolled(8), frame([none('p6'), none('p7'), none('p8', CUR), none('p9')]));
  assert.deepEqual(scrolled(9), frame([none('p6'), none('p7'), none('p8'), none('p9', CUR)]));
});

test('long lines end in an ellipsis, exact fits are kept and control characters become spaces', () => {
  const model = { policy: policy(), rows: [{ id: 'opt:x', label: 'a\tb\x7fc', available: true, checked: false }] };
  const r = pickerScreen(patchOnly(), model, { name: 'ab', dir: 'd' }, { cols: 23, rows: 6 });
  assert.deepEqual(r, [
    `Dependency updates ${D} ab`,
    `types: [x] 1 patch  [ ${ELL}`,
    ' '.repeat(23),
    pad(`${CUR} [ ] a b c`, 23),
    ' '.repeat(23),
    ` 0 packages selected ${D}${ELL}`,
  ]);
});

test('zero columns blank every line and one column leaves only an ellipsis or a space', () => {
  const model = { policy: policy(), rows: [] };
  assert.deepEqual(pickerScreen(patchOnly(), model, named, { cols: 0, rows: 5 }), ['', '', '', '', '']);
  assert.deepEqual(pickerScreen(patchOnly(), model, named, { cols: 1, rows: 5 }), [ELL, ELL, ' ', ' ', ' ']);
});

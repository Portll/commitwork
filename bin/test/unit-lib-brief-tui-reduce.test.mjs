// Next brief TUI state for a key press, or null on quit (bin/lib/brief-tui.mjs reduce).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce } from '../lib/brief-tui.mjs';

const items = (n, f) => Array.from({ length: n }, f);
const b = {
  actions: items(30, () => ({ worst: 'high', epss: null, findings: [] })),
  issues: items(5, () => ({ worst: 'med', counts: {}, top: [] })),
  undetermined: items(2, () => ({})),
  notMeasured: [],
};
const st = (o = {}) => ({ section: 0, cursor: [0, 0, 0, 0], top: [0, 0, 0, 0], expanded: false, help: false, ...o });

test('quit returns null, help opens a help screen, and the next key only closes it', () => {
  assert.equal(reduce(st(), 'quit', b), null);
  assert.equal(reduce(st({ help: true }), 'quit', b), null);
  assert.deepEqual(reduce(st(), 'help', b), st({ help: true }));
  assert.deepEqual(reduce(st({ help: true, cursor: [3, 0, 0, 0] }), 'down', b), st({ cursor: [3, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ help: true, section: 4 }), 'next', b), st({ section: 4 }));
});

test('up and down move one row and stop at the first and last item', () => {
  const before = st({ cursor: [5, 0, 0, 0] });
  assert.deepEqual(reduce(before, 'up', b), st({ cursor: [4, 0, 0, 0] }));
  assert.deepEqual(before, st({ cursor: [5, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ cursor: [1, 0, 0, 0] }), 'up', b), st());
  assert.deepEqual(reduce(st(), 'up', b), st());
  assert.deepEqual(reduce(st(), 'down', b), st({ cursor: [1, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ cursor: [29, 0, 0, 0], top: [20, 0, 0, 0] }), 'down', b), st({ cursor: [29, 0, 0, 0], top: [20, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ section: 1, cursor: [7, 4, 0, 0] }), 'down', b), st({ section: 1, cursor: [7, 4, 0, 0] }));
  assert.deepEqual(reduce(st({ section: 3 }), 'down', b), st({ section: 3 }));
});

test('the top row follows the cursor so it stays inside the ten-row list', () => {
  assert.deepEqual(reduce(st({ cursor: [8, 0, 0, 0] }), 'down', b), st({ cursor: [9, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ cursor: [9, 0, 0, 0] }), 'down', b), st({ cursor: [10, 0, 0, 0], top: [1, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ cursor: [6, 0, 0, 0], top: [5, 0, 0, 0] }), 'up', b), st({ cursor: [5, 0, 0, 0], top: [5, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ cursor: [5, 0, 0, 0], top: [5, 0, 0, 0] }), 'up', b), st({ cursor: [4, 0, 0, 0], top: [4, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ cursor: [15, 0, 0, 0] }), 'x', b), st({ cursor: [15, 0, 0, 0], top: [6, 0, 0, 0] }));
});

test('pgdn and pgup move nine rows at the default 24 rows and stop at the ends', () => {
  assert.deepEqual(reduce(st(), 'pgdn', b), st({ cursor: [9, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ cursor: [9, 0, 0, 0] }), 'pgdn', b), st({ cursor: [18, 0, 0, 0], top: [9, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ cursor: [25, 0, 0, 0], top: [20, 0, 0, 0] }), 'pgdn', b), st({ cursor: [29, 0, 0, 0], top: [20, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ cursor: [20, 0, 0, 0], top: [15, 0, 0, 0] }), 'pgup', b), st({ cursor: [11, 0, 0, 0], top: [11, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ cursor: [4, 0, 0, 0] }), 'pgup', b), st());
});

test('the page size follows the terminal height and never drops below one row', () => {
  assert.deepEqual(reduce(st(), 'pgdn', b, { rows: 16 }), st({ cursor: [5, 0, 0, 0] }));
  assert.deepEqual(reduce(st(), 'pgdn', b, { rows: 15 }), st({ cursor: [10, 0, 0, 0] }));
  assert.deepEqual(reduce(st(), 'pgdn', b, { rows: 6 }), st({ cursor: [1, 0, 0, 0] }));
  assert.deepEqual(reduce(st(), 'pgdn', b, { rows: 5 }), st({ cursor: [1, 0, 0, 0], top: [1, 0, 0, 0] }));
  assert.deepEqual(reduce(st(), 'pgdn', b, { rows: 1 }), st({ cursor: [1, 0, 0, 0], top: [1, 0, 0, 0] }));
});

test('home and end jump to the first and last item of the current section', () => {
  assert.deepEqual(reduce(st({ cursor: [7, 0, 0, 0], top: [3, 0, 0, 0] }), 'home', b), st());
  assert.deepEqual(reduce(st(), 'end', b), st({ cursor: [29, 0, 0, 0], top: [20, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ section: 1 }), 'end', b), st({ section: 1, cursor: [0, 4, 0, 0] }));
  assert.deepEqual(reduce(st({ section: 2 }), 'end', b), st({ section: 2, cursor: [0, 0, 1, 0] }));
  assert.deepEqual(reduce(st({ section: 3, cursor: [0, 0, 0, 2] }), 'end', b), st({ section: 3 }));
});

test('next and prev step through the four sections and wrap around', () => {
  assert.deepEqual(reduce(st(), 'next', b), st({ section: 1 }));
  assert.deepEqual(reduce(st({ section: 3 }), 'next', b), st());
  assert.deepEqual(reduce(st(), 'prev', b), st({ section: 3 }));
  assert.deepEqual(reduce(st({ section: 2 }), 'prev', b), st({ section: 1 }));
  assert.deepEqual(reduce(st({ cursor: [0, 4, 0, 0], top: [0, 6, 0, 0] }), 'next', b), st({ section: 1, cursor: [0, 4, 0, 0], top: [0, 4, 0, 0] }));
});

test('section keys pick sections one to four and ignore other numbers', () => {
  assert.deepEqual(reduce(st({ section: 2 }), 'section1', b), st());
  assert.deepEqual(reduce(st(), 'section4', b), st({ section: 3 }));
  assert.deepEqual(reduce(st({ section: 1 }), 'section5', b), st({ section: 1 }));
  assert.deepEqual(reduce(st({ section: 1 }), 'section0', b), st({ section: 1 }));
  assert.deepEqual(reduce(st({ section: 1 }), 'section10', b), st({ section: 1 }));
});

test('enter toggles the expanded view, where the list does not scroll down', () => {
  assert.deepEqual(reduce(st(), 'enter', b), st({ expanded: true }));
  assert.deepEqual(reduce(st({ expanded: true, cursor: [4, 0, 0, 0], top: [2, 0, 0, 0] }), 'enter', b), st({ cursor: [4, 0, 0, 0], top: [2, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ expanded: true, cursor: [9, 0, 0, 0] }), 'down', b), st({ expanded: true, cursor: [10, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ expanded: true, top: [3, 0, 0, 0] }), 'pgdn', b), st({ expanded: true, cursor: [9, 0, 0, 0], top: [3, 0, 0, 0] }));
  assert.deepEqual(reduce(st({ expanded: true, cursor: [2, 0, 0, 0], top: [5, 0, 0, 0] }), 'up', b), st({ expanded: true, cursor: [1, 0, 0, 0], top: [1, 0, 0, 0] }));
});

test('a section index past the last section throws for keys other than quit', () => {
  assert.throws(() => reduce(st({ section: 4 }), 'down', b), { name: 'TypeError', message: "Cannot read properties of undefined (reading 'key')" });
});

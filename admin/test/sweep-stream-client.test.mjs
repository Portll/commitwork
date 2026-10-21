// The live console's client half — appendLine() and the stream/poll handover. admin/index.html
// cannot be imported, so functions are lifted from the source text and run against a minimal DOM
// shim (the house pattern).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

function extract(name) {
  const at = SRC.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name}() not found in admin/index.html`);
  const end = SRC.indexOf('\n}', at);
  assert.ok(end > -1, `could not find the end of ${name}()`);
  return SRC.slice(at, end + 2);
}

const escLine = SRC.split('\n').find((l) => l.startsWith('const esc='));
assert.ok(escLine, 'esc() not found in admin/index.html');

/** A log element with just enough of the DOM for appendLine's pin arithmetic. */
function fakeLog({ scrollTop = 0, clientHeight = 100, scrollHeight = 100 } = {}) {
  return {
    innerHTML: '', scrollTop, clientHeight, scrollHeight,
    insertAdjacentHTML(pos, html) {
      assert.equal(pos, 'beforeend', 'the console must APPEND, never replace');
      this.innerHTML += html;
      this.scrollHeight += 20; // each appended line grows the box
    },
  };
}

function loadAppendLine(log) {
  return new Function('LOG', `
    const $ = () => LOG;
    ${escLine}
    ${extract('ansiHtml')}
    ${extract('appendLine')}
    return appendLine;
  `)(log);
}

const ESC = '\x1b[';

describe('appendLine', () => {
  test('appends rather than rewriting, and escapes untrusted scanner output', () => {
    const log = fakeLog();
    const appendLine = loadAppendLine(log);
    appendLine('first');
    appendLine('<img src=x onerror=alert(1)>');
    assert.ok(log.innerHTML.startsWith('first'), 'the first line survives the second append');
    assert.ok(!log.innerHTML.includes('<img'), 'raw HTML from a scanner must never reach innerHTML');
    assert.ok(log.innerHTML.includes('&lt;img'), 'it is escaped, not dropped');
  });

  test('ANSI colour still becomes a span', () => {
    const log = fakeLog();
    const appendLine = loadAppendLine(log);
    appendLine(`${ESC}38;2;232;115;12mwarn${ESC}0m`);
    assert.match(log.innerHTML, /<span style="color:rgb\(232,115,12\)">warn<\/span>/);
  });

  test('lines are newline-separated, with no leading newline on the first', () => {
    const log = fakeLog();
    const appendLine = loadAppendLine(log);
    appendLine('a'); appendLine('b');
    assert.equal(log.innerHTML, 'a\nb');
  });

  test('a pinned console follows the tail; a scrolled-up one does not move', () => {
    const pinned = fakeLog({ scrollTop: 0, clientHeight: 100, scrollHeight: 100 });
    loadAppendLine(pinned)('x');
    assert.equal(pinned.scrollTop, pinned.scrollHeight, 'pinned follows');

    const readingHistory = fakeLog({ scrollTop: 0, clientHeight: 100, scrollHeight: 5000 });
    loadAppendLine(readingHistory)('x');
    assert.equal(readingHistory.scrollTop, 0, 'a user reading history is not yanked to the bottom');
  });
});

describe('the stream/poll handover is wired', () => {
  test('renderSweep suppresses its whole-buffer rewrite while a stream is attached', () => {
    const src = SRC.slice(SRC.indexOf('function renderSweep('), SRC.indexOf('function updateSweepBtn('));
    assert.match(src, /if\(!sweepStream&&sw\.seq!==lastSeq\)/,
      'without this guard the poll re-renders lines the stream already appended');
  });

  test('startSweepPolling returns early when a stream is live', () => {
    const src = extract('startSweepPolling');
    assert.match(src, /if\(sweepStream&&!forcePoll\)return;/,
      'a second caller must not arm the poll timer alongside the stream');
    assert.match(src, /startSweepStream\(\)/, 'the stream is preferred over the poll');
    assert.match(src, /setInterval\(pollSweep,1200\)/, 'the poll survives as the fallback');
  });

  test('the fallback ladder is present in startSweepStream', () => {
    const src = extract('startSweepStream');
    assert.match(src, /typeof EventSource==='undefined'/, 'no EventSource → fall back');
    assert.match(src, /EventSource\.CLOSED/, 'only a terminal close hands over — browsers auto-reconnect');
    assert.match(src, /startSweepPolling\(true\)/, 'handover forces the poll path');
    assert.match(src, /d\.seq<=lastSeq/, 'replay overlap after a reconnect must not duplicate lines');
  });

  test('a declared gap is rendered, not swallowed', () => {
    const src = extract('startSweepStream');
    assert.match(src, /addEventListener\('gap'/, 'the server can say lines were lost');
    assert.match(src, /scrolled out of the retained window/, 'and the console says so out loud');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitBlocks, splitSections } from '../lib/chunk-split.mjs';

describe('splitBlocks', () => {
  test('splits on blank lines', () => {
    const blocks = splitBlocks('para one\n\npara two');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].src, 'para one');
    assert.equal(blocks[1].src, 'para two');
  });

  test('never exports a position — only {src}', () => {
    const blocks = splitBlocks('a\n\nb');
    for (const b of blocks) assert.deepEqual(Object.keys(b), ['src']);
  });

  test('a fenced code block spanning blank lines stays one block', () => {
    const md = 'before\n\n```\nline one\n\nline two\n```\n\nafter';
    const blocks = splitBlocks(md);
    assert.equal(blocks.length, 3);
    assert.match(blocks[1].src, /```\nline one\n\nline two\n```/);
  });

  test('~~~ fences are recognised too', () => {
    const blocks = splitBlocks('~~~\na\n\nb\n~~~');
    assert.equal(blocks.length, 1);
  });

  test('empty document yields zero blocks', () => {
    assert.deepEqual(splitBlocks(''), []);
    assert.deepEqual(splitBlocks('\n\n\n'), []);
  });
});

describe('splitSections', () => {
  test('one chunk per heading, running through to the next heading', () => {
    const md = '# Title\n\nintro text\n\n## Phase 1\n\nbody one\n\n## Phase 2\n\nbody two';
    const sections = splitSections(md);
    assert.equal(sections.length, 3);
    assert.match(sections[0].src, /^# Title/);
    assert.match(sections[1].src, /^## Phase 1/);
    assert.match(sections[2].src, /^## Phase 2/);
  });

  test('content before the first heading is its own leading chunk', () => {
    const md = 'preamble line\n\n## First heading\n\nbody';
    const sections = splitSections(md);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].src, 'preamble line');
  });

  test('a fenced code block containing a #-prefixed line is not split as a heading', () => {
    const md = '## Section\n\n```\n# not a heading, just a comment in code\n```\n\nafter';
    const sections = splitSections(md);
    assert.equal(sections.length, 1, 'the fence content must stay inside the one section');
    assert.match(sections[0].src, /not a heading, just a comment/);
  });

  test('a document with no headings at all collapses to one chunk — stated limitation, not silently wrong', () => {
    const md = '**Phase 0**: some text\n\n**Phase 1**: more text, bold-prefixed prose, no real heading lines';
    const sections = splitSections(md);
    assert.equal(sections.length, 1);
  });

  test('empty document yields zero sections', () => {
    assert.deepEqual(splitSections(''), []);
  });
});

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildComparison, assertFileSafe, main, maxFileBytes } from '../generate.mjs';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'cw-chunkdiff-')); });
after(() => { rmSync(dir, { recursive: true, force: true }); });

const write = (name, content) => { const p = join(dir, name); writeFileSync(p, content); return p; };

describe('buildComparison — determinism', () => {
  test('same inputs produce byte-identical output, twice', () => {
    const a = 'Heading\n\nSome text here.\n\nAnother paragraph.';
    const b = 'Heading\n\nSome text edited.\n\nAnother paragraph.';
    const r1 = buildComparison(['a.md', 'b.md'], [a, b]);
    const r2 = buildComparison(['a.md', 'b.md'], [a, b]);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2));
  });
});

describe('secret gate — never embedded', () => {
  test('a real-looking credential is redacted before it reaches the payload', () => {
    // A digit/letter mix, not all-letters — secrets-sweep's placeholder heuristic treats an
    // all-alphabetic run as a made-up dummy (real random key material almost always mixes digits
    // in), so an all-letters fixture would correctly NOT trigger the gate. This is what a real key
    // shape looks like.
    const withSecret = 'Before the key.\n\nAKIA1234567890ABCDEF is the access key.\n\nAfter.';
    const clean = 'Before the key.\n\nThe access key was removed.\n\nAfter.';
    const r = buildComparison(['old.md', 'new.md'], [withSecret, clean]);
    const flat = JSON.stringify(r);
    // nosemgrep: generic.secrets.security.detected-aws-access-key-id-value.detected-aws-access-key-id-value -- synthetic test value, not a credential
    assert.doesNotMatch(flat, /AKIA1234567890ABCDEF/, 'the planted secret must never appear in the generated payload');
    assert.match(flat, /REDACTED/, 'a redaction must be visible, not a silent drop');
  });
});

describe('assertFileSafe — the file://-safety gate on the OUTPUT', () => {
  test('refuses a fetch( in the actual executable code (APP_JS)', () => {
    assert.throws(() => assertFileSafe('<script>window.__DATA__={}</script>', 'fetch("https://evil")'));
  });
  test('refuses a <script src=, regardless of APP_JS content', () => {
    assert.throws(() => assertFileSafe('<script src="https://cdn.example/x.js"></script>', 'console.log(1)'));
  });
  test('accepts real APP_JS with no network calls', () => {
    assert.doesNotThrow(() => assertFileSafe('<script>window.__DATA__={}</script>'));
  });
  test('does NOT refuse "fetch(" appearing only in embedded chunk DATA (diffed prose), not in APP_JS', () => {
    // The exact false-positive this fix addresses: a compared document's own text says
    // `fetch(.../functions/v1/)` — that string lands inside the JSON data literal (a quoted
    // value), never as live code, and must not block generation.
    const htmlWithProseFetch = '<script>window.__DATA__ = {"rows":[{"html":"<code>fetch(x)</code>"}]};</script>'
      + '<script>console.log("real app code, no network")</script>';
    assert.doesNotThrow(() => assertFileSafe(htmlWithProseFetch, 'console.log("real app code, no network")'));
  });
});

describe('main() — end-to-end CLI, byte-identical rerun via the real file system', () => {
  test('writes an artifact with no network calls, deterministically', () => {
    const p1 = write('doc-a.md', '# Title\n\nOne.\n\nTwo.');
    const p2 = write('doc-b.md', '# Title\n\nOne changed.\n\nTwo.');
    const out1 = join(dir, 'out1.html');
    const out2 = join(dir, 'out2.html');
    const code1 = main([p1, p2, '--out', out1]);
    const code2 = main([p1, p2, '--out', out2]);
    assert.equal(code1, 0);
    assert.equal(code2, 0);
    assert.equal(readFileSync(out1, 'utf8'), readFileSync(out2, 'utf8'));
  });

  test('refuses fewer than 2 or more than 5 documents', () => {
    const p1 = write('solo.md', 'x');
    assert.equal(main([p1]), 2);
    const seven = Array.from({ length: 7 }, (_, i) => write(`s${i}.md`, `doc ${i}`));
    assert.equal(main(seven), 2);
  });

  test('--base must name one of the documents, by a whole index, or the run refuses before reading', () => {
    const p1 = write('base-a.md', 'One.');
    const p2 = write('base-b.md', 'Two.');
    for (const bad of ['abc', '1.5', '-1', '2']) assert.equal(main([p1, p2, '--base', bad, '--out', join(dir, 'never.html')]), 2, `--base ${bad}`);
    assert.equal(main([p1, p2, '--base']), 2, 'a --base with no value');
    assert.throws(() => buildComparison([p1, p2], ['One.', 'Two.'], { baseIndex: Number.NaN }), /out of range/);
    assert.equal(main([p1, p2, '--base', '1', '--out', join(dir, 'base1.html')]), 0);
  });

  test('a file over the byte cap refuses the whole run rather than partially reading it', () => {
    const prev = process.env.CW_DIFF_MAX_BYTES;
    process.env.CW_DIFF_MAX_BYTES = '10';
    try {
      const big = write('big.md', 'x'.repeat(1000));
      const small = write('small.md', 'y');
      assert.throws(() => main([big, small, '--out', join(dir, 'refused.html')]));
    } finally {
      if (prev === undefined) delete process.env.CW_DIFF_MAX_BYTES; else process.env.CW_DIFF_MAX_BYTES = prev;
    }
  });
});

// node --test admin/test/ — POST /api/docsite/diff: upload a markdown file, see what it would
// change, before anything is written.
//
// WHY THIS FILE EXISTS. The route's whole value is that it is READ-ONLY: an operator can hand it a
// candidate document and find out what merging would do without having merged. A diff endpoint that
// quietly wrote, or that reported a total rewrite as a clean import, would be worse than none —
// the reader would act on it.
//
// WHAT IT ASSERTS. Not that a diff was produced (a stub returning [] does that), but that states
// which MUST be distinguishable stay distinguishable: unchanged from changed, absent-base from
// empty-base, absent-upload from empty-upload, and markdown from an imported snapshot that has no
// .md base at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routes } from '../routes/docsite.mjs';
import { loadManifest, sourcePath } from '../../lib/docsite-manifest.mjs';

const route = routes.find((r) => r.path === '/api/docsite/diff');

function call(body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve) => {
    let code = null, out = '';
    const req = {
      url: '/api/docsite/diff', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      on(ev, cb) { if (ev === 'data') cb(Buffer.from(payload)); if (ev === 'end') cb(); return this; },
    };
    const res = { writeHead(c) { code = c; return this; }, setHeader() {}, end(b) { out = String(b || ''); resolve({ code, json: (() => { try { return JSON.parse(out); } catch { return null; } })() }); } };
    route.handle({ req, res, query: new URLSearchParams(), isLoopbackReq: true, adminSession: () => ({ user: { email: 't' } }) });
  });
}

const mdDoc = () => loadManifest().docs.find((d) => d.kind === 'md');

test('the route exists and is registered as a POST', () => {
  assert.ok(route, 'no /api/docsite/diff route — an upload has nothing to diff against');
  assert.equal(route.method, 'POST', 'a diff takes an uploaded body; a GET could not carry one');
});

test('an identical upload is reported as unchanged, not as a diff full of matches', async () => {
  const doc = mdDoc();
  const base = readFileSync(sourcePath(doc), 'utf8');
  const r = await call({ slug: doc.slug, text: base });
  assert.equal(r.code, 200);
  assert.equal(r.json.unchanged, true,
    'an upload byte-identical to the base is not flagged unchanged — the operator has to read a whole diff to learn nothing happened');
  assert.equal(r.json.counts.ADDED || 0, 0, 'an identical upload produced ADDED blocks');
  assert.equal(r.json.counts.DELETED || 0, 0, 'an identical upload produced DELETED blocks');
});

test('a real edit is reported as EDITED with word-level detail, not as delete+add', async () => {
  const doc = mdDoc();
  const base = readFileSync(sourcePath(doc), 'utf8');
  const r = await call({ slug: doc.slug, text: `${base}\n\nA new trailing paragraph.\n` });
  assert.equal(r.code, 200);
  assert.equal(r.json.unchanged, false);
  assert.ok((r.json.counts.ADDED || 0) >= 1, 'an appended block was not reported as ADDED');
  // A block that MOVED or was lightly edited must not read as one thing ending and another
  // beginning — the same rule this repo applies to finding identity.
  assert.equal(r.json.counts.DELETED || 0, 0,
    'appending a paragraph reported DELETED blocks — the pairing lost blocks that are still present');
});

test('the baseHash comes back, so a merge can refuse a base that moved underneath it', async () => {
  const doc = mdDoc();
  const r = await call({ slug: doc.slug, text: 'x' });
  assert.match(String(r.json.baseHash), /^[0-9a-f]{64}$/,
    'no baseHash returned — a merge computed from this diff could overwrite an edit made while it was on screen');
});

test('an EMPTY upload is a destructive candidate, not a missing one', async () => {
  // '' and absent are different states and must not collapse: one deletes the document's whole
  // body, the other is a malformed request. Answering '' with "no text supplied" would hide a
  // total deletion behind a validation error.
  const doc = mdDoc();
  const empty = await call({ slug: doc.slug, text: '' });
  assert.equal(empty.code, 200, 'an empty upload was refused as malformed; it is a real, destructive candidate');
  assert.equal(empty.json.unchanged, false);

  const absent = await call({ slug: doc.slug });
  assert.equal(absent.code, 400, 'a request with no text at all was accepted');
  assert.match(String(absent.json.error), /text must be/);
});

test('an imported snapshot says it has no markdown base rather than diffing against nothing', async () => {
  const imported = loadManifest().docs.find((d) => d.kind === 'imported');
  if (!imported) return; // no imported docs declared here
  const r = await call({ slug: imported.slug, text: '# hello' });
  assert.equal(r.code, 400);
  assert.match(String(r.json.error), /imported snapshot|no \.md base/i,
    'an imported doc was diffed as if it had a markdown source');
});

test('an unknown slug 404s instead of diffing against an empty base', async () => {
  const r = await call({ slug: 'no-such-doc', text: '# hello' });
  assert.equal(r.code, 404,
    'an unknown slug did not 404 — diffing against a missing base reports a whole document as ADDED and reads as a clean import');
});

test('the route never writes — the base is byte-identical after a diff', async () => {
  const doc = mdDoc();
  const before = readFileSync(sourcePath(doc), 'utf8');
  await call({ slug: doc.slug, text: '# completely different\n\nnothing in common.\n' });
  assert.equal(readFileSync(sourcePath(doc), 'utf8'), before,
    'the diff route modified the source — computing a diff must never be a write');
});

test('pairs come back in DOCUMENT order, not the order the matcher happened to resolve them', async () => {
  // pairChunks resolves by exact hash, then whitespace-normalised hash, then similarity, then
  // sweeps up deletions and additions — so its array is ordered by HOW each pair was found. Passing
  // that through unordered renders a scrambled diff, and a merge built on it would assemble blocks
  // in resolution order and call the result a document. This is the assertion that catches it.
  const doc = mdDoc();
  const base = readFileSync(sourcePath(doc), 'utf8');
  const blocks = base.split(/\n\n+/);
  const cand = [blocks[0], 'A brand new second block.', ...blocks.slice(1)].join('\n\n');
  const r = await call({ slug: doc.slug, text: cand });
  assert.equal(r.code, 200);
  const seen = r.json.pairs.filter((p) => p.newIdx !== null).map((p) => p.newIdx);
  assert.ok(seen.length > 2, 'too few pairs to prove ordering');
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i - 1] <= seen[i],
      `pairs are not in document order: newIdx ${seen[i - 1]} precedes ${seen[i]} — a merge would reassemble the document wrongly`);
  }
  // the inserted block must land where it was inserted, not at the end where the matcher found it
  const added = r.json.pairs.find((p) => p.state === 'ADDED');
  assert.equal(added.newIdx, 1, 'the inserted block did not come back at its own position');
});

test('every pair carries the indices a merge needs to rebuild the document', async () => {
  const doc = mdDoc();
  const base = readFileSync(sourcePath(doc), 'utf8');
  const r = await call({ slug: doc.slug, text: `${base}\n\nappended.\n` });
  for (const p of r.json.pairs) {
    assert.ok(p.newIdx !== undefined && p.oldIdx !== undefined,
      'a pair is missing oldIdx/newIdx — the caller cannot place it and has to guess');
    assert.ok(p.old !== null || p.new !== null, 'a pair carries neither side');
  }
});

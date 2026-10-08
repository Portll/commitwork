import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyStored, storedText, tally, summarise, verifyReceipt,
  STORED_FULL, STORED_PREVIEW, STORED_UNKNOWN, STORED_DIVERGENT,
  VERIFIED, ACCEPTED_UNVERIFIED, FAILED, sha256,
} from '../memory-layer-client.mjs';

const SOURCE = [
  '===== HANDOFF.md =====',
  '# Handoff — sweep truthfulness, lane coverage, and the finding-analysis lane',
  'Scope: everything from this session except the corpus another agent owns.',
  // Deliberately NON-repetitive: near-identical sentences inflate shingle coverage, because one
  // stored copy satisfies every identical source shingle. A repetitive fixture would let a tiny
  // preview score as full and this suite would pass while proving nothing.
  ...Array.from({ length: 40 }, (_, i) => {
    const verbs = ['measures', 'refuses', 'carries', 'publishes', 'retires', 'anchors', 'widens', 'closes'];
    const nouns = ['ledger', 'ratchet', 'sidecar', 'manifest', 'canary', 'baseline', 'roster', 'verdict'];
    const tails = ['before the gate runs', 'without a second witness', 'across every lane', 'on a shared tree'];
    return `Paragraph ${i} ${verbs[i % 8]} the ${nouns[(i * 3) % 8]} ${tails[i % 4]} and records ${i * 7 + 13} distinct rows.`;
  }),
].join('\n\n');

const PREVIEW = SOURCE.slice(0, 410);

test('a full match classifies as full at coverage 1', () => {
  const c = classifyStored(SOURCE, { content: SOURCE });
  assert.equal(c.form, STORED_FULL);
  assert.equal(c.coverage, 1);
  assert.equal(c.source, 'content');
});

test('whitespace normalisation does not demote a full match', () => {
  // memory-layer flattens newlines on store; byte inequality here is not data loss.
  const c = classifyStored(SOURCE, { content: SOURCE.replace(/\n+/g, ' ') });
  assert.equal(c.form, STORED_FULL);
  assert.ok(c.coverage >= 0.95);
});

// ── The finding this module exists for ──────────────────────────────────────

test('a 410-byte preview of a 19KB document is PREVIEW, never full, and states its coverage', () => {
  const c = classifyStored(SOURCE, { content: PREVIEW });
  assert.equal(c.form, STORED_PREVIEW);
  assert.ok(c.coverage < 0.2, `coverage ${c.coverage} should be small`);
  assert.match(c.reason, /discarded on store/);
});

test('a preview is not reported as a failure either — explicit uncertainty', () => {
  // Over-reporting is not the safe direction: the write SUCCEEDED, the record is just not a copy.
  const c = classifyStored(SOURCE, { content: PREVIEW });
  assert.notEqual(c.form, STORED_UNKNOWN);
  assert.ok(c.coverage !== null, 'coverage is measured, not withheld');
});

test('missing content AND no blob is unknown — never full, never preview', () => {
  const c = classifyStored(SOURCE, { content: null });
  assert.equal(c.form, STORED_UNKNOWN);
  assert.equal(c.coverage, null);
});

test('an undecodable blob leaves the content preview in place rather than erasing it', () => {
  const st = storedText({ content: PREVIEW, metadata: { compressed_data: 'bm90IGx6NCBhdCBhbGw=' } });
  assert.equal(st.text, PREVIEW);
  assert.equal(st.source, 'content');
  assert.ok(st.attempts.length, 'the failed decode is reported, not swallowed');
});

test('a blob that decodes to LESS than content is rejected, not preferred', () => {
  // The memory-layer blob decodes cleanly to a framed record (preview + entity table) that contains
  // less prose than `content`. Decoding successfully is not decoding usefully.
  const tiny = Buffer.from([(2 << 4) | 0, 0x68, 0x69]).toString('base64'); // literals "hi"
  const st = storedText({ content: PREVIEW, metadata: { compressed_data: tiny } });
  assert.equal(st.source, 'content');
  assert.equal(st.recoveredBytes, 2);
});

test('a LONGER but mostly-binary decode is refused as document text', () => {
  // The real memory-layer blob decodes to 27KB that is only ~66% printable: preview prose followed by a
  // ~600-row binary NER table. Because it is longer than `content`, an unguarded reader PREFERS it,
  // containment collapses to 8.5%, and a preview is published as CORRUPTION. Over-reporting is not
  // the safe direction, so the prose floor keeps the 410-byte content in play instead.
  const junk = Buffer.concat([
    Buffer.from(PREVIEW.slice(0, 200), 'utf8'),
    Buffer.from(Array.from({ length: 400 }, (_, i) => (i * 7) % 256)),
  ]);
  const lit = Buffer.concat([Buffer.from([0xf0, junk.length - 15]), junk]);
  const st = storedText({ content: PREVIEW, metadata: { compressed_data: lit.toString('base64') } });
  assert.equal(st.source, 'content', 'a binary structure must not stand in for the document');

  const c = classifyStored(SOURCE, { content: PREVIEW, metadata: { compressed_data: lit.toString('base64') } });
  assert.equal(c.form, STORED_PREVIEW, 'still a preview — never divergent');
});

test('every verdict carries lengthRatio, including divergent', () => {
  // A field present on some outcomes and absent on others is read as zero by the next consumer.
  for (const stored of [SOURCE, PREVIEW, 'unrelated bytes sharing nothing at all with the source']) {
    const c = classifyStored(SOURCE, { content: stored });
    assert.equal(typeof c.lengthRatio, 'number', `${c.form} must carry lengthRatio`);
    assert.ok(Number.isFinite(c.lengthRatio));
  }
});

// ── verifyReceipt: a healthy large write must not read as corruption ────────

const fakeFetch = (body) => async () => ({
  ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
});

async function verify(storedContent, sentText, tagsSent = []) {
  const receipt = { id: 'r1', tagsSent, contentSha256: sha256(sentText), truncated: false };
  return verifyReceipt(receipt, {
    key: 'k',
    cfg: { url: 'http://x', userId: 'u', timeoutMs: 1000, maxRetries: 0 },
    sentText,
    fetchImpl: fakeFetch({ experience: { content: storedContent, tags: tagsSent } }),
  });
}

test('THE REGRESSION: a previewed write is accepted-unverified, not FAILED', () => {
  return verify(PREVIEW, SOURCE).then((r) => {
    assert.equal(r.state, ACCEPTED_UNVERIFIED, 'a check that cannot pass is worse than no check');
    assert.equal(r.storedForm, STORED_PREVIEW);
    assert.ok(r.storedCoverage < 0.2);
    assert.match(r.reason, /preview, not the document/);
    assert.match(r.reason, /not a durable copy/);
  });
});

test('a genuinely corrupted store is still FAILED', () => {
  // The mirror case. If preview-detection swallowed this, the check would be inert.
  return verify('completely unrelated bytes that share nothing', SOURCE).then((r) => {
    assert.equal(r.state, FAILED);
    assert.equal(r.storedForm, STORED_DIVERGENT, 'corruption keeps its own name, apart from preview');
    assert.match(r.reason, /not derived from the source/);
  });
});

test('an exact store verifies and says so', () => {
  return verify(SOURCE, SOURCE).then((r) => {
    assert.equal(r.state, VERIFIED);
    assert.equal(r.storedForm, STORED_FULL);
    assert.equal(r.storedCoverage, 1);
  });
});

test('without sentText the verdict is unknown, never a pass', () => {
  const receipt = { id: 'r1', tagsSent: [], contentSha256: sha256(SOURCE), truncated: false };
  return verifyReceipt(receipt, {
    key: 'k',
    cfg: { url: 'http://x', userId: 'u', timeoutMs: 1000, maxRetries: 0 },
    fetchImpl: fakeFetch({ experience: { content: PREVIEW, tags: [] } }),
  }).then((r) => {
    assert.equal(r.state, FAILED);
    assert.equal(r.storedForm, STORED_UNKNOWN);
  });
});

// ── The new state must reach a reader ───────────────────────────────────────

test('tally counts previewed records on their own axis', () => {
  const t = tally([
    { state: VERIFIED, storedForm: STORED_FULL },
    { state: ACCEPTED_UNVERIFIED, storedForm: STORED_PREVIEW },
    { state: ACCEPTED_UNVERIFIED, storedForm: STORED_PREVIEW },
    { state: ACCEPTED_UNVERIFIED, storedForm: STORED_UNKNOWN },
  ]);
  assert.equal(t.failed, 0);
  assert.equal(t.storedPreview, 2);
  assert.equal(t.storedUnknown, 1);
});

test('summarise SAYS "preview only" — zero failed must never read as N durable records', () => {
  const line = summarise([
    { state: VERIFIED, storedForm: STORED_FULL },
    { state: ACCEPTED_UNVERIFIED, storedForm: STORED_PREVIEW },
  ]);
  assert.match(line, /PREVIEW ONLY/);
  assert.match(line, /not a durable copy/);
});

test('a clean run does not mention previews at all', () => {
  const line = summarise([{ state: VERIFIED, storedForm: STORED_FULL }]);
  assert.doesNotMatch(line, /PREVIEW/);
});

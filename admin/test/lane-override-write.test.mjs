// The Lanes checkbox writes. POST /api/perf is a WHOLE-STATE write — profileId, depth, intensity
// and the entire override map — so a map assembled at render time would drop any lane another
// operator changed since. Thirteen sessions share this checkout; that is not hypothetical.
//
// setLaneOverride is inline in admin/index.html, lifted and run against injected globals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

const cycleAt = SRC.indexOf('const LANE_CYCLE=');
assert.ok(cycleAt > -1, 'LANE_CYCLE not found — the extraction anchor moved');
const fnAt = SRC.indexOf('async function setLaneOverride(');
const fnEnd = SRC.indexOf('\n}', fnAt);
const BLOCK = SRC.slice(cycleAt, fnEnd + 2);

function build({ fresh, postResult = { ok: true }, onPost }) {
  const calls = { gets: 0, posts: [] };
  const el = { textContent: '', className: '' };
  const fn = new Function(
    'fetch', 'cwPost', '$', 'curProj', 'loadLanes', 'encodeURIComponent', 'calls',
    `${BLOCK}; return setLaneOverride;`,
  )(
    async () => { calls.gets++; return { json: async () => fresh }; },
    async (url, opts) => { const body = JSON.parse(opts.body); calls.posts.push(body); if (onPost) onPost(body); return { status: 200, json: async () => postResult }; },
    (id) => (id === 'ln-msg' ? el : null),
    'proj', () => {}, encodeURIComponent, calls,
  );
  return { fn, calls, el };
}

const state = (over = {}) => ({ ok: true, profileId: 'm5-pro', depth: 3, intensity: 3, overrides: { other: 'off' }, ...over });

test('the harness is live — a write reaches cwPost with the fleet settings intact', async () => {
  const { fn, calls } = build({ fresh: state() });
  await fn('sast', '');
  assert.equal(calls.posts.length, 1, 'nothing was posted — the harness proves nothing');
  assert.equal(calls.posts[0].profileId, 'm5-pro');
  assert.equal(calls.posts[0].depth, 3);
});

test('the cycle is inherit -> on -> off -> inherit', async () => {
  for (const [cur, expect] of [['', 'on'], ['on', 'off'], ['off', undefined]]) {
    const { fn, calls } = build({ fresh: state() });
    await fn('sast', cur);
    assert.equal(calls.posts[0].overrides.sast, expect, `${cur || 'inherit'} must advance to ${expect || 'inherit'}`);
  }
});

test('returning to inherited DELETES the key rather than writing a third word', async () => {
  const { fn, calls } = build({ fresh: state({ overrides: { sast: 'off' } }) });
  await fn('sast', 'off');
  assert.equal('sast' in calls.posts[0].overrides, false,
    'an override map with a falsy third value is a state no consumer knows how to render');
});

// The property that makes a whole-state write safe on a shared panel.
test('THE READ IS LATE: a peer lane changed since render survives the write', async () => {
  // Rendered when only `other` was set; by the time of the click a peer has forced `iac` on.
  const { fn, calls } = build({ fresh: state({ overrides: { other: 'off', iac: 'on' } }) });
  await fn('sast', '');
  assert.equal(calls.gets, 1, 'the state must be refetched immediately before the write');
  assert.equal(calls.posts[0].overrides.iac, 'on', "a peer's override was dropped — this is the clobber");
  assert.equal(calls.posts[0].overrides.other, 'off');
  assert.equal(calls.posts[0].overrides.sast, 'on');
});

test('a refetch that fails writes NOTHING', async () => {
  const { fn, calls, el } = build({ fresh: { ok: false, error: 'perf model unreadable' } });
  await fn('sast', '');
  assert.equal(calls.posts.length, 0, 'a write built on a failed read is a write built on nothing');
  assert.match(el.textContent, /nothing was written/);
});

test('a refused write says so, and does not claim success', async () => {
  const { fn, el } = build({ fresh: state(), postResult: { ok: false, error: 'depth must be 1-5' } });
  await fn('sast', '');
  assert.match(el.textContent, /depth must be 1-5/);
  assert.match(el.textContent, /nothing was written/);
  assert.equal(el.className.includes('bad'), true);
});

test('profileId null is preserved as null — auto-detect is a value, not an absence', async () => {
  const { fn, calls } = build({ fresh: state({ profileId: null }) });
  await fn('sast', '');
  assert.equal(calls.posts[0].profileId, null,
    'coercing null to a profile id would pin the machine to a guess the operator never chose');
});

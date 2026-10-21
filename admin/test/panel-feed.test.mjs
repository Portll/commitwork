// The feed view says which of three things it is showing: no rollup, an error, or groups with
// their whole counts. Focus never hides a number, a selection dies with the view it was made in,
// and a bulk fix is reported row by row with nothing assumed recorded on failure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'static', 'panel-feed.js'), 'utf8');

const GROUPS = [
  { key: 'k1', repo: 'acme/widgets', lane: 'depsGo', subject: 'left-pad', worst: 'crit', kev: true, members: 2, distinct: 2, undetermined: 0, suppressed: 0, states: { open: 2 }, inFocus: true },
  { key: 'k2', repo: 'acme/widgets', lane: 'sastSemgrep', subject: 'js/sql-injection', worst: 'high', kev: false, members: 3, distinct: 2, undetermined: 1, suppressed: 1, states: { open: 2, suppressed: 1 }, inFocus: true },
  { key: 'k3', repo: 'acme/widgets', lane: 'sastSemgrep', subject: 'js/xss', worst: 'unknown', kev: false, members: 1, distinct: 1, undetermined: 1, suppressed: 0, states: { open: 1 }, inFocus: false },
];
const FEED = { ok: true, project: 'acme', state: 'swept', generated: '2026-10-07T00:00:00.000Z', mode: 'focus', totals: { rows: 6, groups: 3, focus: 2, suppressed: 1, undetermined: 2, graded: 4, kev: 2 }, hidden: 1, undeclaredLanes: [], groupCount: 2, offset: 0, groups: GROUPS.slice(0, 2) };
const MEMBERS = { k1: [
  { lane: 'depsGo', subRowKey: 'sc:a|depsGo|id=GHSA-1|package=left-pad', suppressed: false, sev: 'crit', row: { repo: 'acme/widgets', id: 'GHSA-1', package: 'left-pad', kev: true, message: 'advisory' }, issue: { id: 'ISS-000001', state: 'open', closedAs: null, updatedAt: 'T1', snoozedUntil: null, subjectDigest: 'sha256:aaa' } },
  { lane: 'depsGo', subRowKey: 'sc:a|depsGo|id=GHSA-2|package=left-pad', suppressed: false, sev: 'high', row: { repo: 'acme/widgets', id: 'GHSA-2', package: 'left-pad', message: 'advisory 2' }, issue: null },
], k2: [
  { lane: 'sastSemgrep', subRowKey: 'sc:a|sastSemgrep|js/sql-injection|src/db.js', suppressed: false, sev: 'high', row: { repo: 'acme/widgets', rule: 'js/sql-injection', file: 'src/db.js', line: 10, message: 'tainted' }, issue: { id: 'ISS-000002', state: 'claimed', closedAs: null, updatedAt: 'T2', snoozedUntil: null, subjectDigest: 'sha256:bbb' } },
] };

function realm({ feed = FEED, members = MEMBERS, project = 'acme', fail = {} } = {}) {
  const container = { id: 'view-feed', hidden: false, style: { display: '' }, classList: { contains: () => false }, _html: '', set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; } };
  const fields = { 'feed-fix-type': { value: 'dep-upgrade' }, 'feed-fix-notes': { value: 'bumped left-pad to 2.0.0 and ran the suite' },
    'feed-form-disposition': { value: 'false-positive' }, 'feed-form-reason': { value: '', focused: 0, focus() { this.focused++; } }, 'feed-form-target': { value: '', focused: 0, focus() { this.focused++; } } };
  const calls = { fetch: [], post: [], tabN: [], triage: [] };
  const timers = [];
  const winListeners = {};
  const document = {
    listeners: {},
    getElementById: (i) => (i === 'view-feed' ? container : fields[i] || null),
    addEventListener(t, f) { (document.listeners[t] ||= []).push(f); },
    dispatchEvent(ev) { (document.listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
  };
  const sandbox = {
    document, console, Date, Math, JSON, Object, Array, Set, Map, Promise, Number, String, encodeURIComponent, setTimeout, Error,
    curProj: project,
    fetch: async (url) => {
      const u = String(url); calls.fetch.push(u);
      if (u.startsWith('/api/feed/group')) {
        const key = decodeURIComponent(u.match(/key=([^&]+)/)[1]);
        if (fail.group) return { ok: false, status: 500, json: async () => ({ ok: false, error: 'rollup unreadable at x' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, key, members: members[key] || [] }) };
      }
      if (fail.feed) return { ok: false, status: 500, json: async () => ({ ok: false, error: 'rollup at r.json is not JSON' }) };
      const mode = (u.match(/mode=(\w+)/) || [])[1];
      const body = typeof feed === 'function' ? feed(mode) : feed;
      return { ok: true, status: 200, json: async () => body };
    },
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: (id) => { timers[id - 1] = null; },
    window: { addEventListener: (t, f) => { winListeners[t] = f; } },
    cwPost: async (url, opts) => {
      calls.post.push([url, JSON.parse(opts.body)]);
      if (url === '/api/issue/triage') {
        const body = JSON.parse(opts.body); calls.triage.push(body);
        if (fail.triage) return { ok: false, status: 409, json: async () => ({ ok: false, error: 'the issue changed since this row was read' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, id: body.id, action: body.action, stillOpen: true }) };
      }
      if (url === '/api/issue/pr') {
        if (fail.pr) return { ok: false, status: 403, json: async () => ({ ok: false, error: 'this action is available only on the operator port (…)', localOnly: true }) };
        return { ok: true, status: 202, json: async () => ({ ok: true, repo: 'acme/widgets', branch: 'commitwork/k1-0123abcd', identity: 'the declared GH_TOKEN' }) };
      }
      if (fail.post) return { ok: false, status: 503, json: async () => ({ ok: false, error: 'store locked' }) };
      const items = JSON.parse(opts.body).items;
      return { ok: true, status: 200, json: async () => ({ ok: true, applied: items.length - 1, unchanged: 0, refused: 1, results: items.map((it, i) => ({ id: it.id, ok: i > 0, status: i ? 200 : 409 })) }) };
    },
    setTabN: (...a) => calls.tabN.push(a),
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  new vm.Script(SRC, { filename: 'panel-feed.js' }).runInContext(ctx);
  const key = (k, over = {}) => { const ev = { type: 'keydown', key: k, target: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...over }; document.dispatchEvent(ev); return ev; };
  const runTimers = async () => { const due = timers.splice(0).filter(Boolean); for (const f of due) await f(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
  const click = (target) => document.dispatchEvent({ type: 'click', target });
  return { ctx, sandbox, calls, container, key, feedApi: sandbox.cwFeed, runTimers, timers, click, fields, winListeners };
}

test('no project is said as such; a missing rollup is never swept; an unreadable one is an error', async () => {
  const none = realm({ project: '' });
  await none.feedApi.loadFeed();
  assert.match(none.container.innerHTML, /choose a project/);
  assert.equal(none.calls.fetch.length, 0);
  const never = realm({ feed: { ok: true, state: 'never-swept', groups: [], totals: null } });
  await never.feedApi.loadFeed();
  assert.match(never.container.innerHTML, /never swept/);
  assert.doesNotMatch(never.container.innerHTML, /feed-fix-go/, 'no bulk bar without rows');
  assert.deepEqual(never.calls.tabN[0].slice(0, 2), ['feed', null], 'the badge is cleared, not zeroed');
  const bad = realm({ fail: { feed: true } });
  await bad.feedApi.loadFeed();
  assert.match(bad.container.innerHTML, /pill high">error<\/span> rollup at r\.json is not JSON/);
  assert.match(bad.container.innerHTML, /never an empty feed/);
});

test('groups render with whole counts, the hidden count, Focus/All buttons, and honest pills', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  const h = r.container.innerHTML;
  assert.match(r.calls.fetch[0], /^\/api\/feed\?project=acme&mode=focus&limit=200&offset=0$/);
  assert.match(h, /Focus <span class="tnum">2<\/span>/);
  assert.match(h, /All <span class="tnum">3<\/span>/);
  assert.match(h, /1 group hidden by Focus/);
  assert.match(h, /6 rows · 4 graded · 2 not graded · 1 suppressed · 2 exploited/);
  assert.match(h, /pill crit"[^>]*>crit<\/span> <span class="pill exploited"/);
  assert.match(h, /1 not graded<\/span>/);
  assert.match(h, /2 open · 1 suppressed/);
  assert.match(h, /0 selected/);
  assert.deepEqual(r.calls.tabN[0].slice(0, 2), ['feed', 2]);
  assert.doesNotMatch(h, /feed-more/, 'no more-button when the page is the whole view');
});

test('switching to All refetches and clears the selection made in Focus', async () => {
  const r = realm({ feed: (mode) => ({ ...FEED, mode, hidden: mode === 'all' ? 0 : 1, groupCount: mode === 'all' ? 3 : 2, groups: mode === 'all' ? GROUPS : GROUPS.slice(0, 2) }) });
  await r.feedApi.loadFeed();
  r.feedApi.toggleSelect('k1');
  assert.equal(r.feedApi.state.selected.size, 1);
  assert.match(r.container.innerHTML, /1 selected/);
  await r.feedApi.setMode('all');
  assert.match(r.calls.fetch[1], /mode=all/);
  assert.equal(r.feedApi.state.selected.size, 0, 'a selection does not survive a view change');
  assert.match(r.container.innerHTML, /nothing hidden/);
  assert.match(r.container.innerHTML, /not graded<\/span>/);
  assert.equal(r.feedApi.state.groups.length, 3);
  await r.feedApi.setMode('all');
  assert.equal(r.calls.fetch.length, 2, 'the same mode again does not refetch');
});

test('expanding a group fetches its members and shows issue ids and states; an error shows as one', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  await r.feedApi.toggleExpand('k1');
  assert.match(r.calls.fetch[1], /^\/api\/feed\/group\?project=acme&key=k1$/);
  const h = r.container.innerHTML;
  assert.match(h, /ISS-000001<\/code> · open/);
  assert.match(h, /open · not in the tracker/);
  assert.match(h, /aria-expanded="true"/);
  await r.feedApi.toggleExpand('k1');
  assert.doesNotMatch(r.container.innerHTML, /feed-members/);
  const bad = realm({ fail: { group: true } });
  await bad.feedApi.loadFeed();
  await bad.feedApi.toggleExpand('k2');
  assert.match(bad.container.innerHTML, /pill high">error<\/span> rollup unreadable at x/);
});

test('shift selects a range; the bulk fix collects issue ids with their stamps, pages, and reports per row', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  r.feedApi.toggleSelect('k1');
  r.feedApi.toggleSelect('k2', { range: true });
  assert.equal(r.feedApi.state.selected.size, 2);
  assert.match(r.container.innerHTML, /Record fix for 2 groups/);
  const out = await r.feedApi.bulkFix({ fixType: 'dep-upgrade', notes: 'bumped left-pad to 2.0.0 and ran the suite' });
  assert.equal(r.calls.post.length, 1);
  const items = r.calls.post[0][1].items;
  assert.deepEqual(items.map((i) => [i.id, i.expectUpdatedAt]), [['ISS-000001', 'T1'], ['ISS-000002', 'T2']]);
  assert.equal(items[0].fixType, 'dep-upgrade');
  assert.equal(out.applied, 1);
  assert.equal(out.refused, 1);
  assert.match(r.container.innerHTML, /1 recorded · 0 unchanged · 1 refused · 1 rows have no issue record · all still open/);
  assert.equal(r.feedApi.state.expanded.size, 0, 'members are re-read after a write');
});

test('a failed bulk post assumes nothing recorded, and no issue records means no post at all', async () => {
  const r = realm({ fail: { post: true } });
  await r.feedApi.loadFeed();
  r.feedApi.toggleSelect('k1');
  await r.feedApi.bulkFix({ fixType: 'dep-upgrade', notes: 'x'.repeat(10) });
  assert.match(r.container.innerHTML, /bulk fix failed: store locked · nothing was assumed recorded/);
  const none = realm({ members: { k1: [{ ...MEMBERS.k1[1] }] } });
  await none.feedApi.loadFeed();
  none.feedApi.toggleSelect('k1');
  const out = await none.feedApi.bulkFix({ fixType: 'dep-upgrade', notes: 'x'.repeat(10) });
  assert.equal(out, null);
  assert.equal(none.calls.post.length, 0);
  assert.match(none.container.innerHTML, /no issue records behind the selection — ingest the tracker first/);
});

test('J/K move, X selects, Enter expands; nothing fires while typing or when the view is hidden', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  r.key('j');
  assert.equal(r.feedApi.state.active, 1);
  r.key('k');
  assert.equal(r.feedApi.state.active, 0);
  r.key('x');
  assert.deepEqual([...r.feedApi.state.selected], ['k1']);
  r.key('Enter');
  await new Promise((res) => setImmediate(res));
  assert.ok(r.feedApi.state.expanded.has('k1'));
  r.key('j', { target: { tagName: 'INPUT' } });
  assert.equal(r.feedApi.state.active, 0, 'typing in a field is not navigation');
  r.container.style.display = 'none';
  r.key('j');
  assert.equal(r.feedApi.state.active, 0, 'a hidden view takes no keys');
});

test('changing project clears the selection and the expansions', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  r.feedApi.toggleSelect('k1');
  await r.feedApi.toggleExpand('k2');
  r.sandbox.curProj = 'other';
  await r.feedApi.loadFeed();
  assert.equal(r.feedApi.state.selected.size, 0);
  assert.equal(r.feedApi.state.expanded.size, 0);
  assert.match(r.calls.fetch.at(-1), /project=other/);
});

test('1 queues an accept behind the undo window; nothing is written until it lapses, then one post per issue record', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  const t = () => new Promise((res) => setImmediate(res));
  r.key('1'); await t(); await t();
  assert.ok(r.feedApi.state.pending, 'queued');
  assert.equal(r.calls.triage.length, 0, 'the keypress writes nothing');
  assert.match(r.container.innerHTML, /pill part">Accepting<\/span> 1 issue in left-pad · writes in 5 s · <button type="button" id="feed-undo">Undo/);
  await r.runTimers();
  assert.deepEqual(r.calls.triage, [{ id: 'ISS-000001', action: 'accept', expectUpdatedAt: 'T1' }]);
  assert.equal(r.feedApi.state.pending, null);
  assert.match(r.container.innerHTML, /Accepting: 1 written · 0 refused/);
  assert.ok(r.calls.fetch.length >= 2, 'the feed is re-read after the write');
});

test('Undo inside the window cancels and writes nothing; a second key first writes what is pending', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  const t = () => new Promise((res) => setImmediate(res));
  r.key('1'); await t(); await t();
  r.click({ id: 'feed-undo' });
  assert.equal(r.feedApi.state.pending, null);
  assert.equal(r.calls.triage.length, 0);
  assert.match(r.container.innerHTML, /undone · nothing was written/);
  r.key('h'); await t(); await t();
  assert.equal(r.feedApi.state.pending.action, 'snooze');
  r.key('1'); await t(); await t(); await t(); await t();
  assert.deepEqual(r.calls.triage.map((x) => x.action), ['snooze'], 'the pending snooze was written before the accept queued');
  assert.deepEqual(r.calls.triage[0], { id: 'ISS-000001', action: 'snooze', expectUpdatedAt: 'T1', days: 7 });
  assert.equal(r.feedApi.state.pending && r.feedApi.state.pending.action, 'accept');
});

test('u on a group with nothing snoozed queues nothing and says so; a refused write is reported, not assumed', async () => {
  const r = realm({ fail: { triage: true } });
  await r.feedApi.loadFeed();
  const t = () => new Promise((res) => setImmediate(res));
  r.key('u'); await t(); await t();
  assert.equal(r.feedApi.state.pending, null);
  assert.match(r.container.innerHTML, /nothing in left-pad this applies to/);
  r.key('1'); await t(); await t();
  await r.runTimers();
  assert.match(r.container.innerHTML, /Accepting: 0 written · 1 refused · ISS-000001: the issue changed/);
});

test('2 opens the decline form; a short reason is refused; Enter files a named ruling with the subject pinned', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  const t = () => new Promise((res) => setImmediate(res));
  r.key('2');
  assert.equal(r.feedApi.state.form.kind, 'decline');
  assert.match(r.container.innerHTML, /feed-form-disposition/);
  assert.equal(r.fields['feed-form-reason'].focused, 1, 'the reason field takes focus');
  r.fields['feed-form-reason'].value = 'short';
  r.key('Enter', { target: { tagName: 'INPUT' } }); await t();
  assert.match(r.container.innerHTML, /at least 8 characters/);
  assert.equal(r.feedApi.state.pending, null);
  r.key('j', { target: { tagName: 'INPUT' } });
  assert.equal(r.feedApi.state.active, 0, 'typing in the form never moves the row');
  r.fields['feed-form-reason'].value = 'documented placeholder value';
  r.fields['feed-form-disposition'].value = 'not-applicable';
  r.key('Enter', { target: { tagName: 'INPUT' } }); await t(); await t();
  assert.equal(r.feedApi.state.form, null);
  assert.equal(r.feedApi.state.pending.action, 'decline');
  await r.runTimers();
  assert.deepEqual(r.calls.triage, [{ id: 'ISS-000001', action: 'decline', expectUpdatedAt: 'T1', disposition: 'not-applicable', reason: 'documented placeholder value', subjectDigest: 'sha256:aaa' }]);
  assert.match(r.container.innerHTML, /rulings filed, rows still open until scan evidence/);
});

test('3 opens the duplicate form; Escape closes it; a bad target is refused; a good one queues', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  const t = () => new Promise((res) => setImmediate(res));
  r.key('3');
  assert.equal(r.feedApi.state.form.kind, 'duplicate');
  r.key('Escape', { target: { tagName: 'INPUT' } });
  assert.equal(r.feedApi.state.form, null);
  r.key('3');
  r.fields['feed-form-target'].value = 'not an id';
  r.click({ classList: { contains: (c) => c === 'feed-form-submit' } }); await t();
  assert.match(r.container.innerHTML, /name the issue id/);
  r.fields['feed-form-target'].value = 'ISS-FIXTURE-S-000009';
  r.click({ classList: { contains: (c) => c === 'feed-form-submit' } }); await t(); await t();
  await r.runTimers();
  assert.deepEqual(r.calls.triage, [{ id: 'ISS-000001', action: 'duplicate', expectUpdatedAt: 'T1', duplicateOf: 'ISS-FIXTURE-S-000009' }]);
});

test('leaving the page writes what is pending rather than dropping it', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  const t = () => new Promise((res) => setImmediate(res));
  r.key('1'); await t(); await t();
  assert.ok(r.winListeners.pagehide, 'pagehide is listened for');
  r.winListeners.pagehide();
  await t(); await t(); await t();
  assert.deepEqual(r.calls.triage.map((x) => x.action), ['accept']);
});

test('an expanded group carries "How do I fix it?" with one line per row and a Create PR button that posts the group key; a refusal is shown as one', async () => {
  const r = realm();
  await r.feedApi.loadFeed();
  await r.feedApi.toggleExpand('k1');
  const h = r.container.innerHTML;
  assert.match(h, /How do I fix it\?/);
  assert.match(h, /left-pad → no fixed version published/);
  assert.match(h, /class="feed-pr" data-key="k1"/);
  assert.match(h, /merging stays human/);
  r.click({ classList: { contains: (c) => c === 'feed-pr' }, dataset: { key: 'k1' } });
  await new Promise((res) => setImmediate(res)); await new Promise((res) => setImmediate(res));
  assert.deepEqual(r.calls.post.at(-1), ['/api/issue/pr', { project: 'acme', key: 'k1' }]);
  assert.match(r.container.innerHTML, /pill plan">started<\/span> create-pr job started for acme\/widgets on commitwork\/k1-0123abcd, as the declared GH_TOKEN/);
  const refused = realm({ fail: { pr: true } });
  await refused.feedApi.loadFeed();
  await refused.feedApi.toggleExpand('k1');
  refused.click({ classList: { contains: (c) => c === 'feed-pr' }, dataset: { key: 'k1' } });
  await new Promise((res) => setImmediate(res)); await new Promise((res) => setImmediate(res));
  assert.match(refused.container.innerHTML, /pill high">refused<\/span> this action is available only on the operator port/);
});

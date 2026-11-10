// Suggested egress allowlist entries with human-readable reasons (monitor/egress-suggest.mjs suggestion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestion } from '../egress-suggest.mjs';

test('computes suggestion for a lane with only non-local hosts', () => {
  const agg = { lanes: [{ check: 'c1', egress: 'e1', runs: 10, hosts: [{ host: 'h1', port: 80, local: false, allowed: 5, denied: 3, runs: 8, firstSeen: 'f', lastSeen: 'l' }] }] };
  const r = suggestion(agg, 'now');
  assert.deepEqual(r, { generated: "now", note: "Written by monitor/egress-suggest.mjs from reports/**/egress-observed.json. Coverage is proxy-honouring clients only. Nothing applies this file: copy an entry into manifests/egress-allowlist.json by hand, with its reason rewritten.", coverage: "proxy-honouring clients only", lanes: { c1: { egress: "e1", runs: 10, allow: [{ host: "h1", port: 80, why: "SUGGESTED, not reviewed: c1 (egress e1) asked for h1:80 8 time(s) in 8 of 10 observed run(s) between f and l. Rewrite this reason in your own words before copying the entry." }] } } });
});

test('computes suggestion for a lane with only local hosts', () => {
  const agg = { lanes: [{ check: 'c1', egress: 'e1', runs: 10, hosts: [{ host: '127.0.0.1', port: 80, local: true, allowed: 5, denied: 3, runs: 8, firstSeen: 'f', lastSeen: 'l' }] }] };
  const r = suggestion(agg, 'now');
  assert.deepEqual(r, { generated: "now", note: "Written by monitor/egress-suggest.mjs from reports/**/egress-observed.json. Coverage is proxy-honouring clients only. Nothing applies this file: copy an entry into manifests/egress-allowlist.json by hand, with its reason rewritten.", coverage: "proxy-honouring clients only", lanes: { c1: { egress: "e1", runs: 10, allow: [], refusedLocal: ["127.0.0.1:80"] } } });
});

test('computes suggestion for a lane with mixed local and non-local hosts', () => {
  const agg = { lanes: [{ check: 'c1', egress: 'e1', runs: 10, hosts: [{ host: 'h1', port: 80, local: false, allowed: 5, denied: 3, runs: 8, firstSeen: 'f', lastSeen: 'l' }, { host: '127.0.0.1', port: 80, local: true, allowed: 2, denied: 1, runs: 4, firstSeen: 'f2', lastSeen: 'l2' }] }] };
  const r = suggestion(agg, 'now');
  assert.deepEqual(r, { generated: "now", note: "Written by monitor/egress-suggest.mjs from reports/**/egress-observed.json. Coverage is proxy-honouring clients only. Nothing applies this file: copy an entry into manifests/egress-allowlist.json by hand, with its reason rewritten.", coverage: "proxy-honouring clients only", lanes: { c1: { egress: "e1", runs: 10, allow: [{ host: "h1", port: 80, why: "SUGGESTED, not reviewed: c1 (egress e1) asked for h1:80 8 time(s) in 8 of 10 observed run(s) between f and l. Rewrite this reason in your own words before copying the entry." }], refusedLocal: ["127.0.0.1:80"] } } });
});

test('computes suggestion when egress is undefined', () => {
  const agg = { lanes: [{ check: 'c1', runs: 10, hosts: [{ host: 'h1', port: 80, local: false, allowed: 5, denied: 3, runs: 8, firstSeen: 'f', lastSeen: 'l' }] }] };
  const r = suggestion(agg, 'now');
  assert.deepEqual(r, { generated: "now", note: "Written by monitor/egress-suggest.mjs from reports/**/egress-observed.json. Coverage is proxy-honouring clients only. Nothing applies this file: copy an entry into manifests/egress-allowlist.json by hand, with its reason rewritten.", coverage: "proxy-honouring clients only", lanes: { c1: { egress: undefined, runs: 10, allow: [{ host: "h1", port: 80, why: "SUGGESTED, not reviewed: c1 (egress undeclared) asked for h1:80 8 time(s) in 8 of 10 observed run(s) between f and l. Rewrite this reason in your own words before copying the entry." }] } } });
});

test('computes suggestion when firstSeen is missing', () => {
  const agg = { lanes: [{ check: 'c1', egress: 'e1', runs: 10, hosts: [{ host: 'h1', port: 80, local: false, allowed: 5, denied: 3, runs: 8, lastSeen: 'l' }] }] };
  const r = suggestion(agg, 'now');
  assert.deepEqual(r, { generated: "now", note: "Written by monitor/egress-suggest.mjs from reports/**/egress-observed.json. Coverage is proxy-honouring clients only. Nothing applies this file: copy an entry into manifests/egress-allowlist.json by hand, with its reason rewritten.", coverage: "proxy-honouring clients only", lanes: { c1: { egress: "e1", runs: 10, allow: [{ host: "h1", port: 80, why: "SUGGESTED, not reviewed: c1 (egress e1) asked for h1:80 8 time(s) in 8 of 10 observed run(s). Rewrite this reason in your own words before copying the entry." }] } } });
});

test('computes suggestion with zero allowed and zero denied', () => {
  const agg = { lanes: [{ check: 'c1', egress: 'e1', runs: 10, hosts: [{ host: 'h1', port: 80, local: false, allowed: 0, denied: 0, runs: 0, firstSeen: 'f', lastSeen: 'l' }] }] };
  const r = suggestion(agg, 'now');
  assert.deepEqual(r, { generated: "now", note: "Written by monitor/egress-suggest.mjs from reports/**/egress-observed.json. Coverage is proxy-honouring clients only. Nothing applies this file: copy an entry into manifests/egress-allowlist.json by hand, with its reason rewritten.", coverage: "proxy-honouring clients only", lanes: { c1: { egress: "e1", runs: 10, allow: [{ host: "h1", port: 80, why: "SUGGESTED, not reviewed: c1 (egress e1) asked for h1:80 0 time(s) in 0 of 10 observed run(s) between f and l. Rewrite this reason in your own words before copying the entry." }] } } });
});

test('computes suggestion with multiple lanes', () => {
  const agg = { lanes: [
    { check: 'c1', egress: 'e1', runs: 10, hosts: [{ host: 'h1', port: 80, local: false, allowed: 5, denied: 3, runs: 8, firstSeen: 'f', lastSeen: 'l' }] },
    { check: 'c2', egress: 'e2', runs: 20, hosts: [{ host: 'h2', port: 443, local: false, allowed: 10, denied: 2, runs: 15, firstSeen: 'f2', lastSeen: 'l2' }] }
  ] };
  const r = suggestion(agg, 'now');
  assert.deepEqual(r, { generated: "now", note: "Written by monitor/egress-suggest.mjs from reports/**/egress-observed.json. Coverage is proxy-honouring clients only. Nothing applies this file: copy an entry into manifests/egress-allowlist.json by hand, with its reason rewritten.", coverage: "proxy-honouring clients only", lanes: { c1: { egress: "e1", runs: 10, allow: [{ host: "h1", port: 80, why: "SUGGESTED, not reviewed: c1 (egress e1) asked for h1:80 8 time(s) in 8 of 10 observed run(s) between f and l. Rewrite this reason in your own words before copying the entry." }] }, c2: { egress: "e2", runs: 20, allow: [{ host: "h2", port: 443, why: "SUGGESTED, not reviewed: c2 (egress e2) asked for h2:443 12 time(s) in 15 of 20 observed run(s) between f2 and l2. Rewrite this reason in your own words before copying the entry." }] } } });
});

test('computes suggestion with empty hosts array', () => {
  const agg = { lanes: [{ check: 'c1', egress: 'e1', runs: 10, hosts: [] }] };
  const r = suggestion(agg, 'now');
  assert.deepEqual(r, { generated: "now", note: "Written by monitor/egress-suggest.mjs from reports/**/egress-observed.json. Coverage is proxy-honouring clients only. Nothing applies this file: copy an entry into manifests/egress-allowlist.json by hand, with its reason rewritten.", coverage: "proxy-honouring clients only", lanes: { c1: { egress: "e1", runs: 10, allow: [] } } });
});

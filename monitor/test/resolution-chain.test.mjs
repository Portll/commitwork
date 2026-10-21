// node --test monitor/test/ — resolution-chain.mjs. The point of a ledger over a log is answering
// "has this changed", so the assertions are about CHANGE detection, about a first sighting not
// being a change, and about the chain identity not moving when only our own policy moves.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseChain, chainId, readChains, verifyChain, recordRun, summarise } from '../resolution-chain.mjs';
import { isUnknown } from '../unknown.mjs';

const withTmp = (fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-chain-'));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};

/** Squid native format, as bin/egress-proxy.sh writes it. */
const line = (action, host) => `1787746872.382    232 172.21.0.3 ${action} 138479 CONNECT ${host}:443 - HIER_DIRECT/1.2.3.4 -`;
const LOG = [
  line('TCP_TUNNEL/200', 'services.gradle.org'),
  line('TCP_TUNNEL/200', 'github.com'),
  line('TCP_TUNNEL/200', 'release-assets.githubusercontent.com'),
  line('TCP_DENIED/403', 'api.foojay.io'),
].join('\n');

describe('parseChain — order is what makes a chain a chain', () => {
  test('reached hosts come back in the order first seen', () => {
    const { reached } = parseChain(LOG);
    assert.deepEqual(reached, ['services.gradle.org', 'github.com', 'release-assets.githubusercontent.com'],
      'an unordered set cannot show that one host redirects to the next');
  });

  test('denials are separated, not mixed into the reached path', () => {
    const { refused } = parseChain(LOG);
    assert.deepEqual(refused, ['api.foojay.io']);
  });

  test('a repeated host appears once — a retry is not a longer chain', () => {
    const doubled = [LOG, LOG].join('\n');
    assert.deepEqual(parseChain(doubled).reached, parseChain(LOG).reached);
  });

  test('an empty log is an empty chain and says how many lines it read', () => {
    const r = parseChain('');
    assert.deepEqual(r.reached, []);
    assert.equal(r.logLines, 0);
  });
});

describe('chain identity excludes our own policy', () => {
  test('the id is over hosts REACHED — adding a denial does not move it', () => {
    const a = parseChain(LOG);
    const b = parseChain(`${LOG}\n${line('TCP_DENIED/403', 'somewhere.else')}`);
    assert.equal(chainId(a.reached), chainId(b.reached),
      'fold refusals into the identity and every allowlist edit looks like the upstream moved');
  });

  test('but a new REACHED host does move it', () => {
    const a = parseChain(LOG);
    const b = parseChain(`${LOG}\n${line('TCP_TUNNEL/200', 'new-cdn.example')}`);
    assert.notEqual(chainId(a.reached), chainId(b.reached));
  });

  test('order is part of identity — the same hosts in a different order is a different chain', () => {
    assert.notEqual(chainId(['a.test', 'b.test']), chainId(['b.test', 'a.test']));
  });
});

describe('recordRun — a first sighting is not a change', () => {
  test('the first record for a repo reports firstSighting and NOT changed', () => withTmp((d) => {
    const p = join(d, 'chains.jsonl');
    const r = recordRun({ repo: 'x', reached: ['a.test'], refused: [], path: p });
    assert.equal(r.firstSighting, true);
    assert.equal(r.changed, false, 'reporting a new repo as changed would make every onboarding an event');
    assert.equal(r.runOrdinal, 1);
  }));

  test('an identical second run is unchanged', () => withTmp((d) => {
    const p = join(d, 'chains.jsonl');
    recordRun({ repo: 'x', reached: ['a.test', 'b.test'], refused: [], path: p });
    const r = recordRun({ repo: 'x', reached: ['a.test', 'b.test'], refused: [], path: p });
    assert.equal(r.changed, false);
    assert.equal(r.runOrdinal, 2);
  }));

  test('a NEW host is detected and named', () => withTmp((d) => {
    const p = join(d, 'chains.jsonl');
    recordRun({ repo: 'x', reached: ['a.test'], refused: [], path: p });
    const r = recordRun({ repo: 'x', reached: ['a.test', 'cdn.test'], refused: [], path: p });
    assert.equal(r.changed, true);
    assert.deepEqual(r.newHosts, ['cdn.test']);
    assert.deepEqual(r.goneHosts, []);
  }));

  test('a host that DISAPPEARS is detected too — a chain shortening is also a change', () => withTmp((d) => {
    const p = join(d, 'chains.jsonl');
    recordRun({ repo: 'x', reached: ['a.test', 'cdn.test'], refused: [], path: p });
    const r = recordRun({ repo: 'x', reached: ['a.test'], refused: [], path: p });
    assert.equal(r.changed, true);
    assert.deepEqual(r.goneHosts, ['cdn.test']);
  }));

  test('repos do not contaminate each other', () => withTmp((d) => {
    const p = join(d, 'chains.jsonl');
    recordRun({ repo: 'x', reached: ['a.test'], refused: [], path: p });
    const r = recordRun({ repo: 'y', reached: ['b.test'], refused: [], path: p });
    assert.equal(r.firstSighting, true, 'y has never been seen, whatever x did');
    assert.equal(r.runOrdinal, 1);
  }));
});

describe('the hash chain', () => {
  test('an untouched ledger verifies', () => withTmp((d) => {
    const p = join(d, 'chains.jsonl');
    for (let i = 0; i < 4; i += 1) recordRun({ repo: 'x', reached: [`h${i}.test`], refused: [], path: p });
    assert.equal(verifyChain(readChains(p).records).intact, true);
  }));

  test('an INTERIOR edit breaks it and names where', () => withTmp((d) => {
    const p = join(d, 'chains.jsonl');
    for (let i = 0; i < 4; i += 1) recordRun({ repo: 'x', reached: [`h${i}.test`], refused: [], path: p });
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const tampered = JSON.parse(lines[1]);
    tampered.reached = ['attacker.test'];
    lines[1] = JSON.stringify(tampered);
    writeFileSync(p, `${lines.join('\n')}\n`);

    const v = verifyChain(readChains(p).records);
    assert.equal(v.intact, false);
    assert.equal(v.brokeAt, 2, 'the break shows at the record AFTER the edited one, whose prev no longer matches');
  }));

  test('TRUNCATION is not caught, and that is the documented limit', () => withTmp((d) => {
    // A hash chain proves nobody edited what is there. It cannot prove a record was ever written,
    // and dropping trailing lines leaves a shorter but internally consistent ledger.
    const p = join(d, 'chains.jsonl');
    for (let i = 0; i < 4; i += 1) recordRun({ repo: 'x', reached: [`h${i}.test`], refused: [], path: p });
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    writeFileSync(p, `${lines.slice(0, 2).join('\n')}\n`);
    assert.equal(verifyChain(readChains(p).records).intact, true,
      'runOrdinal per repo is what makes a stalled ledger visible, not the chain');
  }));
});

describe('reading fails closed', () => {
  test('an absent ledger is fresh and empty — never an error', () => {
    const r = readChains(join(tmpdir(), 'cw-chain-nope', 'x.jsonl'));
    assert.equal(r.ok, true);
    assert.equal(r.fresh, true);
    assert.deepEqual(r.records, []);
  });

  test('a malformed line is COUNTED, not silently skipped', () => withTmp((d) => {
    const p = join(d, 'chains.jsonl');
    recordRun({ repo: 'x', reached: ['a.test'], refused: [], path: p });
    writeFileSync(p, `${readFileSync(p, 'utf8')}{not json\n`);
    const r = readChains(p);
    assert.equal(r.records.length, 1);
    assert.equal(r.malformed, 1, 'a partly unreadable ledger must not read as a shorter intact one');
  }));
});

describe('summarise', () => {
  test('counts runs and changes per repo, most-changed first', () => withTmp((d) => {
    const p = join(d, 'chains.jsonl');
    recordRun({ repo: 'quiet', reached: ['a.test'], refused: [], path: p });
    recordRun({ repo: 'quiet', reached: ['a.test'], refused: [], path: p });
    recordRun({ repo: 'noisy', reached: ['a.test'], refused: [], path: p });
    recordRun({ repo: 'noisy', reached: ['b.test'], refused: [], path: p });

    const rows = summarise(readChains(p).records);
    assert.equal(rows[0].repo, 'noisy');
    assert.equal(rows[0].changes, 1);
    assert.equal(rows[0].distinctChains, 2);
    assert.equal(rows.find((r) => r.repo === 'quiet').changes, 0);
  }));
});

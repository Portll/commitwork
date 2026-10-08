// The chains below are MITRE's, not this parser's output. Roll-up is only worth having if the
// hierarchy it walks is the real one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadGraph, ancestors, rollup, parseCatalogue, unzip, graphPath, NATURES } from '../cwe-graph.mjs';

const G = existsSync(graphPath()) ? loadGraph() : null;
const built = (name, fn) => test(name, { skip: G ? false : 'graph not built' }, fn);

// id → the CWE-1000 ChildOf chain MITRE publishes
const CHAINS = [
  ['79', ['74', '707']],            // XSS → Injection → Improper Neutralization
  ['94', ['74', '707']],            // Code Injection, same parent as XSS
  ['22', ['706', '664']],           // Path Traversal
  ['918', ['441', '610', '664']],   // SSRF
  ['862', ['285', '284']],          // Missing Authorization → Improper Access Control
  ['200', ['668', '664']],
];

// The ten pillars of view 1000. A parser that loses one has lost a whole branch.
const PILLARS = ['284', '435', '664', '682', '691', '693', '697', '703', '707', '710'];

describe('the parsed hierarchy is MITRE\'s', () => {
  for (const [id, chain] of CHAINS) {
    built(`CWE-${id} → ${chain.join(' → ')}`, () => assert.deepEqual(ancestors(G, id), chain));
  }
  built('every pillar is present and is the top of its own chain', () => {
    for (const p of PILLARS) {
      assert.ok(G.cwes[p], `CWE-${p} missing`);
      assert.equal(G.cwes[p].abstraction, 'Pillar', `CWE-${p} is not a Pillar`);
      assert.deepEqual(ancestors(G, p), [], `CWE-${p} has a parent`);
    }
  });
  built('there are exactly ten pillars', () => {
    const found = Object.entries(G.cwes).filter(([, c]) => c.abstraction === 'Pillar').map(([k]) => k);
    assert.deepEqual(found.sort(), [...PILLARS].sort());
  });
});

describe('rollup', () => {
  built('lands on the pillar from any depth', () => {
    assert.equal(rollup(G, '79', 'Pillar'), '707');
    assert.equal(rollup(G, '918', 'Pillar'), '664');
  });
  built('a pillar rolls up to itself', () => assert.equal(rollup(G, '707', 'Pillar'), '707'));
  built('accepts the CWE- prefix and the bare id alike', () => {
    assert.equal(rollup(G, 'CWE-79', 'Pillar'), rollup(G, '79', 'Pillar'));
  });
  built('an unknown id rolls up to nothing rather than guessing', () => {
    assert.equal(rollup(G, '999999', 'Pillar'), '');
    assert.deepEqual(ancestors(G, '999999'), []);
  });
  built('Class is reachable as its own level', () => {
    assert.equal(G.cwes[rollup(G, '79', 'Class')].abstraction, 'Class');
  });
});

describe('graph integrity', () => {
  built('every ChildOf target exists — a dangling parent breaks every roll-up through it', () => {
    const missing = [];
    for (const [id, c] of Object.entries(G.cwes)) {
      for (const p of c.ChildOf || []) if (!G.cwes[p]) missing.push(`${id}→${p}`);
    }
    assert.deepEqual(missing, []);
  });
  built('no ChildOf cycles', () => {
    for (const id of Object.keys(G.cwes)) {
      const chain = ancestors(G, id);
      assert.equal(new Set(chain).size, chain.length, `cycle through CWE-${id}: ${chain}`);
    }
  });
  built('every non-pillar reaches a pillar, or is declared parentless', () => {
    let stranded = 0;
    for (const [id, c] of Object.entries(G.cwes)) {
      if (c.abstraction === 'Pillar' || !c.ChildOf) continue;
      if (!rollup(G, id, 'Pillar')) stranded += 1;
    }
    assert.equal(stranded, 0, `${stranded} weaknesses have a parent chain that reaches no pillar`);
  });
  built('lateral edges are kept but never walked as hierarchy', () => {
    // PeerOf/CanPrecede are real relationships and genuinely cyclic; ancestors() must ignore them.
    const peers = Object.entries(G.cwes).filter(([, c]) => c.PeerOf);
    assert.ok(peers.length > 0, 'no PeerOf edges were parsed at all');
    const [id] = peers[0];
    assert.equal(ancestors(G, id).some((a) => G.cwes[id].PeerOf.includes(a)), false);
  });
  built('declared natures are the only ones stored', () => {
    const allowed = new Set([...NATURES, 'name', 'abstraction', 'status']);
    for (const [id, c] of Object.entries(G.cwes)) {
      for (const k of Object.keys(c)) assert.ok(allowed.has(k), `CWE-${id} carries undeclared key ${k}`);
    }
  });
});

describe('parser and container', () => {
  test('unzip reads via the central directory', () => {
    const body = Buffer.from('<Weakness_Catalog></Weakness_Catalog>');
    const comp = deflateRawSync(body);
    const name = Buffer.from('a.xml');
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(body.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
    name.copy(cd, 46);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(local.length + comp.length, 16);
    const zip = Buffer.concat([local, comp, cd, eocd]);
    const out = unzip(zip);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'a.xml');
    assert.equal(out[0].data.toString('utf8'), body.toString('utf8'));
  });

  test('a non-zip is refused, not read as empty', () => {
    assert.throws(() => unzip(Buffer.from('not a zip at all')), /no end-of-central-directory/);
  });

  test('ChildOf edges from another VIEW are not mixed into the hierarchy', () => {
    // view 699 is a different tree; folding it into 1000 is how a DAG acquires cycles
    const xml = `<Weakness ID="1" Name="A" Abstraction="Base">
      <Related_Weaknesses>
        <Related_Weakness Nature="ChildOf" CWE_ID="2" View_ID="1000"/>
        <Related_Weakness Nature="ChildOf" CWE_ID="3" View_ID="699"/>
        <Related_Weakness Nature="PeerOf" CWE_ID="4" View_ID="1000"/>
      </Related_Weaknesses></Weakness>`;
    const g = parseCatalogue(xml, '1000');
    assert.deepEqual(g.cwes['1'].ChildOf, ['2']);
    assert.deepEqual(g.cwes['1'].PeerOf, ['4']);
  });

  test('attributes are read off the element head, not the body', () => {
    const g = parseCatalogue('<Weakness ID="7" Name="Seven" Abstraction="Class" Status="Stable"></Weakness>');
    assert.equal(g.cwes['7'].name, 'Seven');
    assert.equal(g.cwes['7'].abstraction, 'Class');
  });
});

built('the checked-in graph is self-consistent', () => {
  assert.equal(G.count, Object.keys(G.cwes).length);
  assert.equal(G.view, '1000');
  assert.ok(Object.keys(G.cwes).length > 900, `only ${Object.keys(G.cwes).length} weaknesses parsed`);
});

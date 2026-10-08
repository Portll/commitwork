import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyWho, annotationView, sessionWho } from '../attribution.mjs';
import { annotationsPathFor } from '../store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MONITOR = join(HERE, '..');

describe('classifyWho — a person and an agent are not equal evidence', () => {
  it('a bare name is human', () => {
    assert.equal(classifyWho('portll'), 'human');
    assert.equal(classifyWho('Jane Doe'), 'human');
  });

  it('blank is unknown, NOT human — an unsigned acceptance must never read as attested', () => {
    assert.equal(classifyWho(''), 'unknown');
    assert.equal(classifyWho(null), 'unknown');
    assert.equal(classifyWho(undefined), 'unknown');
    assert.equal(classifyWho('   '), 'unknown');
  });

  it('agent and automation signatures are machine', () => {
    for (const w of ['claude-code', 'renovate[bot]', 'dependabot', 'github-actions', 'CI sweep']) {
      assert.equal(classifyWho(w), 'machine', `${w} should classify as machine`);
    }
  });

  // The load-bearing case. Four of the six live ledger entries are worded exactly like this.
  it('"authorized by <person>" stays MACHINE — an agent citing a human is not a human signature', () => {
    assert.equal(
      classifyWho('claude-code (authorized by portll, session 2026-07-09)'),
      'machine',
      'an agent must not be able to promote its own entry to human attribution by wording it well',
    );
  });

  it('is case-insensitive — the ledger is free text', () => {
    assert.equal(classifyWho('Claude-Code (…)'), 'machine');
    assert.equal(classifyWho('RENOVATE'), 'machine');
  });

  // Regression: `ci` and `bot` were matched as bare substrings, which called Lucia, Marcia, anyone
  // at cisco.com and anyone at robot.com a machine. Short markers must match a WHOLE token.
  it('does not call people machines because their name contains "ci" or "bot"', () => {
    for (const w of ['lucia@example.test', 'marcia.jones@example.test', 'dev@cisco.example.test', 'pat@specialist.example.test', 'rob@robot.example.test', 'sam@agency.example.test']) {
      assert.equal(classifyWho(w), 'human', `${w} is a person, not automation`);
    }
  });

  it('still catches those markers as whole tokens', () => {
    for (const w of ['CI sweep', 'ci-runner', 'renovate[bot]', 'nightly cron']) {
      assert.equal(classifyWho(w), 'machine', `${w} should classify as machine`);
    }
  });
});

describe('sessionWho — the identity stamped on what a logged-in person does', () => {
  it('round-trips to human through classifyWho — the property that makes attestation work', () => {
    const w = sessionWho({ provider: 'password', user: 'john@portll.net' });
    assert.equal(w, 'john@portll.net (password)');
    assert.equal(classifyWho(w), 'human');
  });

  it('carries the provider — who they are and how they proved it are different facts', () => {
    assert.equal(sessionWho({ provider: 'google', user: 'a@b.com' }), 'a@b.com (google)');
    assert.equal(sessionWho({ user: 'c@d.com' }), 'c@d.com');
  });

  it('no session yields empty, which classifies unknown — never an anonymous human signature', () => {
    for (const s of [null, undefined, {}, { provider: 'password' }, { provider: 'password', user: '   ' }]) {
      const w = sessionWho(s);
      assert.equal(w, '', 'a sessionless caller must not be given a signature');
      assert.equal(classifyWho(w), 'unknown');
    }
  });
});

describe('annotationView — the projection that reaches the panel', () => {
  const a = { action: 'accept', at: '2026-07-20T00:00:00.000Z', reason: 'not reachable', who: 'portll', extra: 'dropped' };

  it('carries who through verbatim, plus its class', () => {
    const v = annotationView(a);
    assert.equal(v.who, 'portll');
    assert.equal(v.whoKind, 'human');
    assert.equal(v.action, 'accept');
    assert.equal(v.reason, 'not reachable');
    assert.equal(v.at, '2026-07-20T00:00:00.000Z');
  });

  it('is a projection, not a passthrough — unknown fields do not leak to the panel', () => {
    assert.equal(annotationView(a).extra, undefined);
  });

  it('an unsigned annotation reports whoKind unknown rather than omitting it', () => {
    const v = annotationView({ action: 'accept', at: 'x', reason: 'y' });
    assert.equal(v.who, '');
    assert.equal(v.whoKind, 'unknown', 'explicit uncertainty: absence of a signature is its own state');
  });

  it('null in, null out', () => assert.equal(annotationView(null), null));
});

describe('rollup lockstep — the regression guard', () => {
  // `who` was silently dropped here once already: both call sites hand-built
  // `{action, at, reason}` and discarded the signature the ledger had recorded. A hand-built
  // literal is the shape of that bug, so assert the shared projection is what rollup calls.
  const src = readFileSync(join(MONITOR, 'rollup.mjs'), 'utf8');

  it('rollup imports the shared projection', () => {
    assert.match(src, /import\s*\{[^}]*annotationView[^}]*\}\s*from\s*'\.\/attribution\.mjs'/);
  });

  it('every annotation assignment in rollup goes through annotationView', () => {
    const assigns = [...src.matchAll(/\.annotation\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(assigns.length >= 2, `expected the two annotation assignments, found ${assigns.length}`);
    for (const rhs of assigns) {
      assert.match(rhs, /annotationView\(/, `annotation assigned from a hand-built literal (${rhs}) — this is how \`who\` got dropped before`);
    }
  });
});

// The live ledger is a private record (monitor/store-paths.mjs). The shipped example always runs; the
// private record runs when it is present, and its absence (ENOENT, no CW_ANNOTATIONS) is a stated skip.
describe('the ledger classifies as expected', () => {
  const ledgers = [['the shipped example', join(MONITOR, 'annotations.example.json')], ['the private ledger', annotationsPathFor(join(MONITOR, '..'))]];
  for (const [label, path] of ledgers) {
    it(`every record in ${label} carries a signature and classifies`, (t) => {
      let doc;
      try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
        if (e.code === 'ENOENT' && label !== 'the shipped example' && !process.env.CW_ANNOTATIONS) return t.skip(`${path} absent (ENOENT): private record`);
        throw e;
      }
      const anns = doc.annotations || [];
      assert.ok(anns.length > 0, `${path} carries no \`annotations\` array — the \`|| []\` above turns a shape change into a silent pass over zero records`);
      for (const a of anns) {
        assert.ok(a.who, `annotation ${a.id} has no \`who\` — an unsigned acceptance`);
        assert.ok(['human', 'machine'].includes(classifyWho(a.who)), `${a.who} classified as unknown`);
      }
    });
  }
});

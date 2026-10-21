// bin/test/node-hazards.test.mjs — every rule with its negative control.
//
// The positive cases are the cheap half. The load-bearing half is below them: for each rule, the
// SAFE form of the same construct must produce nothing. A scanner of constructs-by-presence is one
// bad regex away from measuring the ecosystem instead of the application, and the two rules this
// tool re-derived rather than ported are both cases where its predecessor got exactly that wrong —
// nodejsscan flags Pug's `#{}` (the ESCAPED form) and matches `httpOnly` as a substring, so
// `httpOnly: false` reads as present.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { scanFile, scan, toSarif } from '../node-hazards.mjs';

const ids = (src, ext = '.js') => scanFile('f' + ext, src, ext).map((f) => f.ruleId);
const hits = (src, ext = '.js') => scanFile('f' + ext, src, ext).length;

// The fixture strings below ARE the constructs, so this file scans dirty against its own tool.
// Annotated with the tool's own marker rather than excluded by path: a scanner whose suppression
// mechanism its own tests do not exercise is a mechanism nobody has run.
// cw-hazards-ignore-file: every construct below is a fixture string for the rule under test
describe('each rule fires on the construct it names', () => {
  const cases = [
    ['node/tls-verification-disabled', "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';"],
    ['node/reject-unauthorized-false', 'new https.Agent({ rejectUnauthorized: false });'],
    ['node/deprecated-cipher-no-iv', "crypto.createCipher('aes-192-cbc', pw);"],
    ['node/yaml-unsafe-schema', 'yaml.load(raw, { schema: yaml.DEFAULT_FULL_SCHEMA });'],
    ['node/cookie-flag-downgrade', "res.cookie('s', v, { httpOnly: false });"],
    ['node/weak-hash', "crypto.createHash('md5').update(b);"],
    ['node/xss-protection-disabled', 'lusca.xssProtection(false);'],
  ];
  for (const [id, src] of cases) {
    test(id, () => assert.ok(ids(src).includes(id), `${id} did not fire on: ${src}`));
  }

  test('node/cors-wildcard-with-credentials needs BOTH halves', () => {
    const both = "cors({ origin: '*', credentials: true })";
    assert.ok(ids(both).includes('node/cors-wildcard-with-credentials'));
    // Either alone is defensible and must NOT fire — that is the whole point of the pair rule.
    assert.equal(ids("cors({ origin: '*' })").includes('node/cors-wildcard-with-credentials'), false);
    assert.equal(ids('cors({ credentials: true })').includes('node/cors-wildcard-with-credentials'), false);
  });
});

describe('THE NEGATIVE CONTROLS — the safe form of each construct yields nothing', () => {
  const safe = [
    ['TLS left on', 'new https.Agent({ rejectUnauthorized: true });'],
    ['createCipheriv is the correct API', "crypto.createCipheriv('aes-256-gcm', key, iv);"],
    ['bare yaml.load is safe in js-yaml v4', 'const doc = yaml.load(raw);'],
    ['a real origin with credentials', "cors({ origin: 'https://app.example.com', credentials: true });"],
    ['hardened cookie flags', "res.cookie('s', v, { httpOnly: true, secure: true, sameSite: 'strict' });"],
    ['sha256 is not a weak hash', "crypto.createHash('sha256').update(b);"],
  ];
  for (const [label, src] of safe) {
    test(label, () => assert.equal(hits(src), 0, `false positive on: ${src}`));
  }

  test('a commented-out hazard is not a finding', () => {
    assert.equal(hits("// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';"), 0);
  });
});

describe('template escaping — and the inversion its predecessor got backwards', () => {
  test('EJS <%- is unescaped, <%= is not', () => {
    assert.equal(hits('<div><%- raw %></div>', '.ejs'), 1);
    assert.equal(hits('<div><%= escaped %></div>', '.ejs'), 0);
  });

  test('Handlebars {{{ }}} is unescaped, {{ }} is not', () => {
    assert.equal(hits('<p>{{{ raw }}}</p>', '.hbs'), 1);
    assert.equal(hits('<p>{{ escaped }}</p>', '.hbs'), 0);
  });

  test('PUG: !{} is unescaped and #{} is ESCAPED — nodejsscan flags the safe one', () => {
    assert.equal(hits('p !{raw}', '.pug'), 1);
    // The control that matters. nodejsscan's signature is `#{...}`, which fires here and would
    // therefore fire on nearly every Pug template in existence, reporting the defence as the defect.
    assert.equal(hits('p #{escapedInterpolation}', '.pug'), 0,
      'flagging Pug #{} would report the ESCAPED form — the GuardDog capability-* shape');
  });

  test('template rules do not fire on .js, and code rules do not fire on templates', () => {
    assert.equal(hits('<div><%- raw %></div>', '.js'), 0);
    assert.equal(hits("process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';", '.hbs'), 0);
  });
});

describe('suppression — an adjudicated finding must not come back as new', () => {
  const hazard = "const a = new https.Agent({ rejectUnauthorized: false });";

  test('an own-line marker suppresses, and the finding is kept rather than dropped', () => {
    const out = scanFile('f.js', `${hazard} // cw-hazards-ignore: scoped probe`, '.js');
    assert.equal(out.length, 0, 'must not appear as a live finding');
    assert.equal(out.suppressed.length, 1, 'but must still be reported as suppressed');
    assert.equal(out.suppressed[0].suppression.justification, 'scoped probe');
  });

  test('another tool\'s marker counts as prior adjudication of the same construct', () => {
    for (const marker of ['// nosemgrep', '// codeql[js/disabling-certificate-validation]']) {
      const out = scanFile('f.js', `${marker}\n${hazard}`, '.js');
      assert.equal(out.length, 0, `${marker} should suppress`);
      assert.equal(out.suppressed.length, 1);
    }
  });

  test('THE REAL CASE: a marker at the top of a multi-line comment block still reaches the code', () => {
    // monitor/deploy-state.mjs opens a five-line justification with codeql[] and puts the construct
    // after it. A one-line lookback found nothing and re-reported an adjudicated finding as new.
    const src = [
      '// codeql[js/disabling-certificate-validation] — deliberate, scoped to',
      '// THIS request object only, not the process-global env var.',
      '// The real handshake is verified elsewhere; see the doc comment above.',
      '// Callers must not reach this probe on a row whose handshake failed.',
      hazard,
    ].join('\n');
    const out = scanFile('f.js', src, '.js');
    assert.equal(out.length, 0, 'the block marker must reach the construct below it');
    assert.equal(out.suppressed[0].suppression.marker, 'codeql[js/disabling-certificate-validation]');
  });

  test('a marker cannot reach across non-comment code', () => {
    const src = `// codeql[x] adjudicated\nconst unrelated = 1;\n${hazard}`;
    assert.equal(scanFile('f.js', src, '.js').length, 1, 'the block ends at the first non-comment line');
  });

  test('the file-level marker is a broader claim and has its own spelling', () => {
    const src = `// cw-hazards-ignore-file: fixtures\n${hazard}\n${hazard}`;
    const out = scanFile('f.js', src, '.js');
    assert.equal(out.length, 0);
    assert.equal(out.suppressed.length, 2, 'it covers the whole file, not one line');
    // Bounded to the head, so it must be declared where a reader sees it.
    const buried = `${'\n'.repeat(60)}// cw-hazards-ignore-file: too late\n${hazard}`;
    assert.equal(scanFile('f.js', buried, '.js').length, 1, 'a marker past the head does not apply');
  });

  test('suppressed items stay OUT of SARIF results but are counted', () => {
    const res = { findings: [], suppressed: [{ ruleId: 'x' }, { ruleId: 'y' }] };
    const s = toSarif(res);
    assert.equal(s.runs[0].results.length, 0, 'this fleet\'s parseReport reads results and ignores SARIF suppressions');
    assert.equal(s.runs[0].properties.suppressedCount, 2, 'so the count is how the fact survives');
  });
});

describe('the template cluster, per engine, each with its escaped counterpart', () => {
  const cases = [
    ['.ejs', '<div><%- raw %></div>', '<div><%= esc %></div>', 'template/ejs-unescaped'],
    ['.ect', '<div><%- @raw %></div>', '<div><%= @esc %></div>', 'template/ect-unescaped'],
    ['.hbs', '<p>{{{ raw }}}</p>', '<p>{{ esc }}</p>', 'template/handlebars-unescaped'],
    ['.mustache', '<p>{{& raw }}</p>', '<p>{{ esc }}</p>', 'template/handlebars-unescaped'],
    ['.pug', 'p !{raw}', 'p #{esc}', 'template/pug-unescaped'],
    ['.dust', '<p>{raw|s}</p>', '<p>{esc}</p>', 'template/dust-unescaped'],
  ];
  for (const [ext, bad, good, id] of cases) {
    test(`${ext}: flags the unescaped form only`, () => {
      assert.deepEqual(ids(bad, ext), [id], `${ext} unescaped form should yield ${id}`);
      assert.deepEqual(ids(good, ext), [], `${ext} ESCAPED form must stay silent: ${good}`);
    });
  }

  test('pug != is unescaped but = is not', () => {
    assert.deepEqual(ids('p!= raw', '.pug'), ['template/pug-unescaped']);
    assert.deepEqual(ids('p= escaped', '.pug'), []);
  });

  test('framework sinks live in CODE files, not templates', () => {
    assert.deepEqual(ids('<div dangerouslySetInnerHTML={{__html: x}} />', '.jsx'), ['node/react-dangerously-set-inner-html']);
    assert.deepEqual(ids('<div v-html="raw"></div>', '.vue'), ['node/vue-v-html']);
    assert.deepEqual(ids('this.s.bypassSecurityTrustHtml(x);', '.ts'), ['node/angular-bypass-security-trust']);
  });
});

describe('the whole-tree contract', () => {
  test('SARIF shape carries driver, rules and located results', () => {
    const s = toSarif({ findings: scanFile('a.js', "rejectUnauthorized: false", '.js') });
    assert.equal(s.runs[0].tool.driver.name, 'commitwork-node-hazards');
    assert.equal(s.version, '2.1.0');
    const r = s.runs[0].results[0];
    assert.equal(r.locations[0].physicalLocation.artifactLocation.uri, 'a.js');
    assert.ok(r.level && r.message.text);
  });

  test('a tree with no JS or templates reports scanned:0 — the caller turns that into not-scanned', () => {
    // Never an empty SARIF: a clean scan of nothing must not read as a clean scan.
    const res = scan('/nonexistent-path-for-this-test');
    assert.equal(res.scanned, 0);
    assert.equal(res.findings.length, 0);
  });
});

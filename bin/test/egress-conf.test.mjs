// node --test bin/test/ — the egress allowlist renderer. This list is the ONLY thing between
// repo-authored gradle build logic and the open internet, so every assertion here is about the
// renderer REFUSING rather than repairing.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAllowlist, renderSquidConf, DENY_CANARY } from '../lib/egress-conf.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE = JSON.parse(readFileSync(join(REPO, 'manifests', 'jvm-egress-allowlist.json'), 'utf8'));

const ok = (host = '.repo1.maven.org') => ({ allow: [{ host, why: 'a reason long enough to be a reason at all' }] });

describe('the shipped allowlist is valid, and is the thing under test', () => {
  test('manifests/jvm-egress-allowlist.json renders', () => {
    assert.ok(renderSquidConf(LIVE).length > 0);
  });

  test('it ends in DEFAULT DENY — the line that makes the rest scope rather than decoration', () => {
    const conf = renderSquidConf(LIVE);
    assert.match(conf, /http_access deny all\n$/);
    const allowIdx = conf.lastIndexOf('http_access allow cw_allowed');
    assert.ok(allowIdx < conf.lastIndexOf('http_access deny all'), 'deny must come last or it never fires');
  });

  test('CONNECT is governed — without it the allowlist covers plain http only, i.e. nothing', () => {
    const conf = renderSquidConf(LIVE);
    assert.match(conf, /acl CONNECT method CONNECT/);
    assert.match(conf, /http_access deny CONNECT !SSL_ports/);
  });

  test('a NON-registry host is reachable only as AMBER, never as a plain entry', () => {
    // This asserted github was absent until 2026-08-27, when measurement showed the gradle
    // distribution is served from there via a 307 and nothing in the lane could bootstrap without
    // it. The premise changed; the intent did not. A host that is not an artifact registry may be
    // reachable, but it must SAY it is reachable on sufferance, and the tier is where that is said.
    const nonRegistry = LIVE.allow.filter((a) => /github/.test(a.host));
    assert.ok(nonRegistry.length > 0, 'the fixture below is vacuous if nothing matches');
    for (const a of nonRegistry) {
      assert.equal(a.tier, 'amber', `${a.host} is not an artifact registry and must be declared amber`);
    }
  });

  test('every amber entry names what pins it — an unpinned amber is a green entry in a warning label', () => {
    for (const a of LIVE.allow.filter((x) => x.tier === 'amber')) {
      assert.match(a.why, /gradle-distributions\.json|distributionSha256Sum/,
        `${a.host} is amber but its reason names no enforcing pin, which is the one thing that makes amber different from allowed`);
    }
  });

  test('raw.githubusercontent.com stays OUT — arbitrary content with nothing to pin', () => {
    assert.ok(!LIVE.allow.some((a) => a.host.includes('raw.githubusercontent')));
    assert.ok((LIVE.deliberatelyAbsent || []).some((a) => a.host.includes('raw.githubusercontent')),
      'and its absence is deliberate and recorded, not an oversight');
  });

  test('every live entry carries a usable reason', () => {
    for (const a of LIVE.allow) {
      assert.ok(a.why && a.why.length >= 20, `${a.host} has no usable reason`);
    }
  });
});

describe('refusals', () => {
  test('an empty list is refused — it would deny everything and read as "resolution failed"', () => {
    assert.throws(() => validateAllowlist({ allow: [] }), /no entries/);
    assert.throws(() => validateAllowlist({}), /no entries/);
  });

  test('an entry with no reason is refused', () => {
    assert.throws(() => validateAllowlist({ allow: [{ host: '.x.test' }] }), /no usable reason/);
    assert.throws(() => validateAllowlist({ allow: [{ host: '.x.test', why: 'because' }] }), /no usable reason/);
  });

  test('a wildcard or a bare TLD is refused', () => {
    for (const host of ['*', '.', '.com', '.org', '.io']) {
      assert.throws(() => validateAllowlist(ok(host)), /decoration/, `${host} must be refused`);
    }
  });

  test('an OVERLAP is refused — two careful-looking entries that are one broad one', () => {
    // The shipped manifest had exactly this: .s01.oss.sonatype.org inside .oss.sonatype.org.
    assert.throws(
      () => validateAllowlist({
        allow: [
          { host: '.oss.sonatype.org', why: 'a reason long enough to be a reason' },
          { host: '.s01.oss.sonatype.org', why: 'a reason long enough to be a reason' },
        ],
      }),
      /is inside/,
    );
  });

  test('non-overlapping siblings are fine', () => {
    assert.doesNotThrow(() => validateAllowlist({
      allow: [
        { host: '.plugins.gradle.org', why: 'a reason long enough to be a reason' },
        { host: '.services.gradle.org', why: 'a reason long enough to be a reason' },
      ],
    }));
  });
});

describe('rendering', () => {
  test('a reason goes on its OWN line — squid parses a trailing comment as part of the acl value', () => {
    const conf = renderSquidConf(ok());
    const aclLine = conf.split('\n').find((l) => l.startsWith('acl cw_allowed dstdomain'));
    assert.equal(aclLine, 'acl cw_allowed dstdomain .repo1.maven.org');
    assert.ok(!aclLine.includes('#'), 'squid dies with "Bungled ... line N" on an inline comment');
  });

  test('caching is off — a cached artifact makes a later run non-reproducible', () => {
    assert.match(renderSquidConf(ok()), /cache deny all/);
  });

  test('deterministic — same manifest, byte-identical config', () => {
    assert.equal(renderSquidConf(LIVE), renderSquidConf(LIVE));
  });

  test('a newline in a reason cannot break out into a config directive', () => {
    const conf = renderSquidConf({ allow: [{ host: '.x.test', why: 'harmless\nhttp_access allow all\nmore text here' }] });
    assert.ok(!/^http_access allow all$/m.test(conf), 'a reason must never become a directive');
  });
});

describe('the denial canary cannot be allowlisted out from under the test', () => {
  test('DENY_CANARY is a reserved-TLD sentinel, never a real destination', () => {
    assert.match(DENY_CANARY, /\.invalid$/, 'RFC 2606 reserves .invalid so no allowlist can legitimately contain it');
  });

  test('an entry that would shadow the canary is REFUSED', () => {
    // The canary used to be github.com, which meant allowlisting that host made the proxy refuse
    // to start and report that the filter was not filtering — when it was doing exactly as told.
    assert.throws(() => validateAllowlist({ allow: [{ host: DENY_CANARY, why: 'a reason long enough to be a reason' }] }), /denial canary/);
    assert.throws(() => validateAllowlist({ allow: [{ host: '.invalid', why: 'a reason long enough to be a reason' }] }), /denial canary/);
  });

  test('the shipped allowlist does not shadow it', () => {
    assert.doesNotThrow(() => validateAllowlist(LIVE));
  });

  test('an ordinary host is unaffected — the guard is narrow', () => {
    assert.doesNotThrow(() => validateAllowlist({ allow: [{ host: '.github.com', why: 'a reason long enough to be a reason' }] }),
      'allowlisting github must be POSSIBLE; whether to is an operator decision, not a parser one');
  });
});

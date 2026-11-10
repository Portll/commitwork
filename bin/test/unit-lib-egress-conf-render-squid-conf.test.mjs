// Renders the squid.conf text that enforces a validated egress allowlist (bin/lib/egress-conf.mjs renderSquidConf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSquidConf } from '../lib/egress-conf.mjs';

const WHY = 'Resolves JVM dependencies for the build';

const conf = (port, body) => `${[
  '# GENERATED from manifests/jvm-egress-allowlist.json by bin/lib/egress-conf.mjs \u2014 do not edit.',
  `http_port ${port}`,
  '',
  '# No caching. A cached artifact makes a later run non-reproducible for reasons nothing records.',
  'cache deny all',
  'access_log stdio:/cw-logs/access.log',
  'cache_log /cw-logs/cache.log',
  '',
  '# CONNECT is how https reaches a proxy at all. Without these three lines the allowlist governs',
  '# plain http only, which in 2026 is to say it governs nothing.',
  'acl SSL_ports port 443',
  'acl CONNECT method CONNECT',
  'http_access deny CONNECT !SSL_ports',
  '',
  ...body,
  '',
  'http_access allow cw_allowed',
  '# DEFAULT DENY. This line is the control; everything above it is scope.',
  'http_access deny all',
].join('\n')}\n`;

const entry = (host, line = WHY) => [`# ${line}`, `acl cw_allowed dstdomain ${host}`];

test('a reason longer than 140 characters is cut to its first 140', () => {
  const why = `M${'x'.repeat(199)}`;
  assert.equal(
    renderSquidConf({ allow: [{ host: 'repo.maven.apache.org', why }] }),
    conf(3128, entry('repo.maven.apache.org', `M${'x'.repeat(139)}`)),
  );
});

test('a reason of 139 or 140 characters is kept whole and one of 141 loses its last character', () => {
  for (const [n, kept] of [[139, 139], [140, 140], [141, 140]]) {
    assert.equal(
      renderSquidConf({ allow: [{ host: 'plugins.gradle.org', why: 'y'.repeat(n) }] }),
      conf(3128, entry('plugins.gradle.org', 'y'.repeat(kept))),
    );
  }
});

test('whitespace runs in a reason collapse to one space before the cut', () => {
  const allow = [
    { host: 'a.example.org', why: `${'b'.repeat(70)} \n\t ${'c'.repeat(70)}` },
    { host: 'b.example.org', why: '\n  Maven Central release artifacts  ' },
  ];
  assert.equal(renderSquidConf({ allow }), conf(3128, [
    ...entry('a.example.org', `${'b'.repeat(70)} ${'c'.repeat(69)}`),
    ...entry('b.example.org', ' Maven Central release artifacts '),
  ]));
});

test('entries render in input order on the given port, and an undotted parent beside its child is allowed', () => {
  const allow = [
    { host: 'services.gradle.org', why: 'Gradle wrapper distributions download' },
    { host: 'gradle.org', why: WHY },
    { host: '.maven.org', why: WHY },
  ];
  assert.equal(renderSquidConf({ allow }, { port: 8080 }), conf(8080, [
    ...entry('services.gradle.org', 'Gradle wrapper distributions download'),
    ...entry('gradle.org'),
    ...entry('.maven.org'),
  ]));
});

test('a missing, empty or non-array allowlist is refused', () => {
  const message = 'egress: the allowlist has no entries. An empty list would start a proxy that permits nothing, '
    + 'which reads as "resolution failed" for every repo rather than as a misconfiguration.';
  for (const m of [undefined, null, {}, { allow: [] }, { allow: 'gradle.org' }]) {
    assert.throws(() => renderSquidConf(m), { name: 'Error', message });
  }
});

test('an entry without a non-blank string host is refused, naming the entry', () => {
  const cases = [
    [null, 'egress: entry null has no host'],
    [{ why: 'ok' }, 'egress: entry {"why":"ok"} has no host'],
    [{ host: '   ', why: 'ok' }, 'egress: entry {"host":"   ","why":"ok"} has no host'],
    [{ host: 7 }, 'egress: entry {"host":7} has no host'],
  ];
  for (const [a, message] of cases) {
    assert.throws(() => renderSquidConf({ allow: [{ host: 'ok.example.org', why: WHY }, a] }), { name: 'Error', message });
  }
});

test('a reason must be a string of at least 20 characters once trimmed', () => {
  const message = 'egress: gradle.org has no usable reason. Widening what repo build logic can reach is the '
    + 'one decision this file exists to make reviewable, and an entry nobody justified is not reviewable.';
  for (const why of ['a'.repeat(19), `  ${'a'.repeat(19)}  `, undefined, 42]) {
    assert.throws(() => renderSquidConf({ allow: [{ host: 'gradle.org', why }] }), { name: 'Error', message });
  }
  assert.equal(
    renderSquidConf({ allow: [{ host: 'gradle.org', why: 'a'.repeat(20) }] }),
    conf(3128, entry('gradle.org', 'a'.repeat(20))),
  );
});

test('a catch-all host or one that covers the denial canary is refused', () => {
  for (const host of ['*', '.com', ' .IO ']) {
    assert.throws(() => renderSquidConf({ allow: [{ host, why: WHY }] }), {
      name: 'Error',
      message: `egress: '${host}' would make every other entry decoration`,
    });
  }
  for (const host of ['cw-egress-canary.invalid', '.INVALID', 'invalid']) {
    assert.throws(() => renderSquidConf({ allow: [{ host, why: WHY }] }), {
      name: 'Error',
      message: `egress: '${host}' would allow the denial canary cw-egress-canary.invalid, which is what proves the `
        + 'filter refuses anything at all. Reserved by RFC 2606 and never a real destination.',
    });
  }
  assert.equal(renderSquidConf({ allow: [{ host: 'canary.invalid', why: WHY }] }), conf(3128, entry('canary.invalid')));
});

test('a dotted entry with a narrower entry inside it is refused in either order, but an exact repeat is not', () => {
  const message = 'egress: .services.gradle.org is inside .gradle.org \u2014 the narrower entry is decoration and the list is '
    + 'wider than it reads. Remove one.';
  const wide = { host: '.gradle.org', why: WHY };
  const narrow = { host: '.services.gradle.org', why: WHY };
  assert.throws(() => renderSquidConf({ allow: [wide, narrow] }), { name: 'Error', message });
  assert.throws(() => renderSquidConf({ allow: [narrow, wide] }), { name: 'Error', message });
  assert.equal(
    renderSquidConf({ allow: [wide, { ...wide }] }),
    conf(3128, [...entry('.gradle.org'), ...entry('.gradle.org')]),
  );
});

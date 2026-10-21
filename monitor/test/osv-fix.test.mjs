// The remediation target osv-scanner already wrote into the artifact, which rollup threw away.
//
// rollup.mjs carried `fixed: ''` as a literal on the osv lane. Downstream that is not merely a
// blank column: lifecycle's patchAvailability axis reads `open`, so a finding with a shipped fix
// presents as one with no known fix. Both findings this was found through — CVE-2023-44487
// against ffuf and CVE-2025-31125 against satori — have published fixes and rendered as if they
// did not.
//
// The fixtures below are the real table shapes, lifted from reports/**/osv.sarif verbatim rather
// than invented, because a parser tested against prose I wrote myself proves only that I am
// self-consistent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixFromOsvHelp, fixReason } from '../osv-fix.mjs';

const help = (rows) => `**Your dependency is vulnerable to something**.

## Details

blah blah

## Remediation

To fix these vulnerabilities, update the vulnerabilities past the listed fixed versions below.

### Fixed Versions

| Vulnerability ID | Package Name | Fixed Version |
| --- | --- | --- |
${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}

If you believe these vulnerabilities do not affect your code, add them to the ignore list.
`;

test('the ffuf finding that started this: CVE-2023-44487 / golang.org/x/net', () => {
  const h = help([['GHSA-qppj-fm5r-hxr3', 'golang.org/x/net', '0.17.0']]);
  assert.equal(
    fixFromOsvHelp(h, { id: 'CVE-2023-44487', aliases: ['GHSA-qppj-fm5r-hxr3'], pkg: 'golang.org/x/net' }),
    '0.17.0');
});

test('the satori finding: CVE-2025-31125 / vite', () => {
  const h = help([['GHSA-4r4m-qw57-chr8', 'vite', '4.5.11, 5.4.16, 6.0.13, 6.1.3, 6.2.4']]);
  assert.equal(
    fixFromOsvHelp(h, { id: 'CVE-2025-31125', aliases: ['GHSA-4r4m-qw57-chr8'], pkg: 'vite' }),
    '4.5.11, 5.4.16, 6.0.13, 6.1.3, 6.2.4',
    'several fix lines are the advisory OWN statement — reducing to one picks a major branch for the reader');
});

test('package is the disambiguating key: one advisory, two packages, two targets', () => {
  // real shape: GHSA-x744-4wpc-v9h2 lists moby AND docker
  const h = help([
    ['GHSA-x744-4wpc-v9h2', 'github.com/moby/moby', '29.3.1'],
    ['GHSA-x744-4wpc-v9h2', 'github.com/docker/docker', '28.1.0'],
  ]);
  const want = { id: 'CVE-X', aliases: ['GHSA-x744-4wpc-v9h2'] };
  assert.equal(fixFromOsvHelp(h, { ...want, pkg: 'github.com/moby/moby' }), '29.3.1');
  assert.equal(fixFromOsvHelp(h, { ...want, pkg: 'github.com/docker/docker' }), '28.1.0');
});

test('a row is matched through aliases, since the table often keys on the GHSA not the CVE', () => {
  const h = help([['GO-2026-5028', 'golang.org/x/net', '0.55.0']]);
  assert.equal(fixFromOsvHelp(h, { id: 'CVE-2026-25680', aliases: ['GO-2026-5028'], pkg: 'golang.org/x/net' }), '0.55.0');
});

// --- the abstentions. Each must return '', and for the stated reason. ---

test('no Fixed Versions table means the advisory ships no fix', () => {
  assert.equal(fixFromOsvHelp('**vulnerable**\n\nno remediation section here', { id: 'X', pkg: 'p' }), '');
  assert.equal(fixReason('**vulnerable**', { id: 'X', pkg: 'p' }), 'no-table');
});

test('a package with no row gets nothing, never another package row', () => {
  const h = help([['GHSA-a', 'left-pad', '1.0.0']]);
  assert.equal(fixFromOsvHelp(h, { id: 'GHSA-a', pkg: 'right-pad' }), '');
  assert.equal(fixReason(h, { id: 'GHSA-a', pkg: 'right-pad' }), 'package-unmatched');
});

test('without a package there is nothing to disambiguate on, so abstain', () => {
  const h = help([['GHSA-a', 'left-pad', '1.0.0']]);
  assert.equal(fixFromOsvHelp(h, { id: 'GHSA-a' }), '');
  assert.equal(fixReason(h, { id: 'GHSA-a' }), 'no-package');
});

test('databases disagreeing about the same package abstains, not averages', () => {
  // real shape: pillow, GHSA says 10.0.0 and PYSEC says 10.0.0 + a git sha. rule.id is the CVE,
  // which has no row of its own, so the primary-id tie-break cannot fire either.
  const h = help([
    ['GHSA-8ghj-p4vj-mr35', 'pillow', '10.0.0'],
    ['PYSEC-2023-227', 'pillow', '10.0.0, 1fe1bb49c452b0318cad12ea9d97c3bef188e9a7'],
  ]);
  const want = { id: 'CVE-2023-44271', aliases: ['GHSA-8ghj-p4vj-mr35', 'PYSEC-2023-227'], pkg: 'pillow' };
  assert.equal(fixFromOsvHelp(h, want), '');
  assert.equal(fixReason(h, want), 'ambiguous');
});

test('the primary-id tie-break is a citation, and only an EXACT rule.id qualifies', () => {
  // real shape: rustls-webpki. Both rows are aliases of this finding; rule.id IS one of them.
  const rows = [
    ['GHSA-pwjx-qhcg-rvj4', 'rustls-webpki', '0.103.10, 0.104.0-alpha.5'],
    ['RUSTSEC-2026-0049', 'rustls-webpki', '0.103.10'],
  ];
  const aliases = ['RUSTSEC-2026-0049', 'GHSA-pwjx-qhcg-rvj4'];
  assert.equal(
    fixFromOsvHelp(help(rows), { id: 'RUSTSEC-2026-0049', aliases, pkg: 'rustls-webpki' }),
    '0.103.10', 'the scanner keyed the finding on RUSTSEC, so that row is the citation');
  // ...but an id that is merely an alias must NOT inherit the tie-break, or the rule degenerates
  // into "pick whichever row sorts first", which is a guess wearing a citation's clothes.
  assert.equal(
    fixFromOsvHelp(help(rows), { id: 'CVE-9999-0001', aliases, pkg: 'rustls-webpki' }),
    '', 'no exact rule.id row => still ambiguous');
});

test('malformed input never throws and never invents', () => {
  for (const bad of [undefined, null, 42, '', {}, []]) {
    assert.equal(fixFromOsvHelp(bad, { id: 'X', pkg: 'p' }), '');
  }
  const empty = help([]);
  assert.equal(fixFromOsvHelp(empty, { id: 'X', pkg: 'p' }), '');
  assert.equal(fixFromOsvHelp(help([['GHSA-a', 'p', '-']]), { id: 'GHSA-a', pkg: 'p' }), '',
    'a dash cell is osv saying "none", not a version');
});

test('rollup wires it: the osv lane no longer hardcodes an empty fix', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../dep-findings.mjs', import.meta.url)), 'utf8');
  const rollup = await readFile(fileURLToPath(new URL('../rollup.mjs', import.meta.url)), 'utf8');
  // Assert the effect on the source rather than a comment marker: the literal is gone and the
  // extractor is called. A test that only checked the import would pass with the literal intact.
  assert.ok(!/\bfixed: '',\s*title,\s*advisory:/.test(src),
    "dep-findings.mjs still pushes a hardcoded `fixed: ''` on the osv lane");
  assert.match(src, /fixFromOsvHelp\(\s*\(rule\.help/, 'the osv lane must read the rule help text');
  assert.match(rollup, /import \{[^}]*\bparseOsv\b[^}]*\} from '\.\/dep-findings\.mjs'/, 'rollup.mjs must take its osv lane from dep-findings.mjs');
});

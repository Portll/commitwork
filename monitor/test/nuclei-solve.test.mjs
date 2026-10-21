// node --test monitor/test/  — the Nuclei+ solver. Templates are PINNED FIXTURES, not the live
// store — nuclei refreshes ~/nuclei-templates from the internet. CW_NUCLEI_TEMPLATES points the
// solver at faithful reductions of the real templates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  solveDir, writeSolved, classify, deriveRule, ruleLoader, templateFileFor,
  CONFIRMATION, SIGNAL, disposition, DISPOSITION,
} from '../nuclei-solve.mjs';

// ── pinned template fixtures ────────────────────────────────────────────────────────────────
const TPL = mkdtempSync(join(tmpdir(), 'cw-tpl-'));
const tpl = (rel, body) => { const p = join(TPL, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); return rel; };

// snmpv3-detect: bare `success == true` matcher, `(.*)` extractor, UDP gate, declares 161.
// This template CANNOT FAIL — that is the whole point of the fixture.
const T_SNMP = tpl('javascript/udp/detection/snmpv3-detect.yaml', `id: snmpv3-detect

info:
  name: SNMPv3 Fingerprint - Detect
  severity: info
  tags: js,udp,network,snmp

javascript:
  - pre-condition: |
      isUDPPortOpen(Host, Port);
    code: |
      const conn = c.Open('udp', \`\${Host}:\${Port}\`);
      return "Enterprise: " + (m ? m[0] : "unknown");
    args:
      Host: "{{Host}}"
      Port: 161
      Timeout: 2
    matchers:
      - type: dsl
        dsl:
          - "success == true"
    extractors:
      - type: regex
        group: 1
        regex:
          - "(.*)"
# digest: 4b0a0048304602210094aea547:922c64590222798bb761d5b6d8e72950
`);

// dameng-detect: HAS a content predicate (version != null), so it is not tautological. Declares
// port 5236 and opens a raw tcp socket — refuted only when the response contradicts it.
const T_DAMENG = tpl('javascript/detection/dameng-detect.yaml', `id: dameng-detect

info:
  name: Dameng Database - Detect
  severity: info
  tags: network,dameng,detection,protocol

javascript:
  - pre-condition: |
      isPortOpen(Host,Port);
  - code: |
      let conn = c.Open('tcp', \`\${Host}:\${Port}\`);
    args:
      Host: "{{Host}}"
      Port: 5236
    matchers:
      - type: dsl
        dsl:
          - "success == true"
          - "version != null"
    extractors:
      - type: regex
        regex:
          - (\\d+\\.\\d+\\.\\d+\\.\\d+)
# digest: 4a0a00473045022042dcafe9:922c64590222798bb761d5b6d8e72950
`);

// mDNS-enum: bare matcher like snmpv3 BUT a discriminating word-list extractor — the guard
// against over-refuting every UDP template
const T_MDNS = tpl('javascript/udp/misconfiguration/mdns-enum.yaml', `id: mDNS-enum

info:
  name: mDNS Enumeration
  severity: low
  tags: dns,udp,mdns,enum,js
  metadata:
    shodan-query: port:5353

javascript:
  - pre-condition: |
      isUDPPortOpen(Host,Port);
    code: |
      let conn = c.Open('udp', \`\${Host}:\${Port}\`);
    args:
      Host: "{{Host}}"
      Port: 5353
    matchers:
      - type: dsl
        dsl:
          - "success == true"
    extractors:
      - type: regex
        regex:
          - "airplay"
          - "ssh"
          - "smb"
# digest: 4c0a0048304602210099887766:922c64590222798bb761d5b6d8e72950
`);

// springboot-actuator: a `word` matcher over the body — an ordinary, well-formed HTTP template.
const T_SPRING = tpl('http/technologies/springboot-actuator.yaml', `id: springboot-actuator

info:
  name: Spring Boot Actuator
  severity: info
  tags: springboot,exposure

http:
  - method: GET
    matchers:
      - type: word
        part: body
        words:
          - '"_links":'
          - '"health"'
        condition: and
# digest: 4b0a00483046022100e91077a4:922c64590222798bb761d5b6d8e72950
`);

// ── record builders, shaped like the real artifacts ─────────────────────────────────────────
const rec = (o) => ({ host: '127.0.0.1', 'matcher-status': true, ...o });
const snmpAt = (port) => rec({
  template: T_SNMP, 'template-id': 'snmpv3-detect', info: { severity: 'info', name: 'SNMPv3' },
  type: 'javascript', port: String(port), 'extracted-results': ['Enterprise: unknown'], response: 'Enterprise: unknown',
});
const damengAt = (port, response) => rec({
  template: T_DAMENG, 'template-id': 'dameng-detect', info: { severity: 'info', name: 'Dameng' },
  type: 'javascript', port: String(port), response,
});
const mdns = () => rec({
  template: T_MDNS, 'template-id': 'mDNS-enum', info: { severity: 'low', name: 'mDNS Enumeration' },
  type: 'javascript', port: '5353', 'extracted-results': ['airplay'],
  response: '\x00\x03_services\x07_dns-sd\x04_udp\x05local\x00\x08_airplay\x04_tcp',
});
const spring = () => rec({
  template: T_SPRING, 'template-id': 'springboot-actuator', info: { severity: 'info', name: 'Actuator' },
  type: 'http', port: '8095', response: 'HTTP/1.1 200 OK\r\n\r\n{"_links":{"health":{}}}',
});

const dir = (records, name = 'nuclei.jsonl') => {
  const d = mkdtempSync(join(tmpdir(), 'cw-solve-'));
  writeFileSync(join(d, name), records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n'));
  return d;
};
const solve = (d) => solveDir(d, { root: TPL });
const one = (r) => { const s = solve(dir([r])); assert.equal(s.ok, true); return s.records[0]; };

// ── the four measured cases ─────────────────────────────────────────────────────────────────
test('snmpv3-detect at a port with NOTHING bound is refuted — a matcher that cannot fail is not a finding', () => {
  const v = one(snmpAt(161));
  assert.equal(v.confirmation, CONFIRMATION.REFUTED);
  assert.ok(v.signals.includes(SIGNAL.TAUTOLOGICAL), 'bare success==true matcher + (.*) extractor');
  assert.ok(v.signals.includes(SIGNAL.SELF_REFERENTIAL), 'the "extraction" is the template\'s own fallback string');
  assert.ok(v.signals.includes(SIGNAL.TRANSPORT_UNVERIFIABLE), 'isUDPPortOpen cannot fail — UDP has no handshake');
  assert.equal(v.ruleId, 'snmpv3-detect');
  assert.ok(v.ruleDigest, 'a refutation must name the template digest it was derived from');
});

test('snmpv3-detect at a LIVE project port is refuted too — being in scope does not make it true', () => {
  const v = one(snmpAt(8095));
  assert.equal(v.confirmation, CONFIRMATION.REFUTED);
  assert.ok(v.signals.includes(SIGNAL.PORT_DISPLACED), 'the template declares 161 and fired at 8095');
});

test('dameng-detect answered by an HTTP status line is refuted as contradicted', () => {
  const v = one(damengAt(8095, 'HTTP/1.1 400 \r\nContent-Type: text/html;charset=utf-8\r\n\r\n<h1>Bad Request</h1>'));
  assert.equal(v.confirmation, CONFIRMATION.REFUTED);
  assert.ok(v.signals.includes(SIGNAL.CONTRADICTED));
  assert.equal(v.contradictor, 'http-status-line');
});

test('dameng-detect answered by a bare HTML body — no status line — is ALSO contradicted', () => {
  // matching only the status line left bare-HTML answers undetermined
  const v = one(damengAt(8096, '<!doctype html><html lang="en"><head><title>Whitelabel Error</title>'));
  assert.equal(v.confirmation, CONFIRMATION.REFUTED);
  assert.equal(v.contradictor, 'html-document');
});

test('mDNS-enum is NOT refuted — a bare matcher with a DISCRIMINATING extractor is real evidence', () => {
  // same matcher as snmpv3 — the discriminating extractor hit is what separates them
  const v = one(mdns());
  assert.notEqual(v.confirmation, CONFIRMATION.REFUTED);
  assert.ok(!v.signals.includes(SIGNAL.TAUTOLOGICAL));
  assert.ok(!v.signals.includes(SIGNAL.SELF_REFERENTIAL), 'the extraction is a substring of wire data, not the whole response');
});

test('an ordinary HTTP finding is confirmed, not swept up', () => {
  const v = one(spring());
  assert.equal(v.confirmation, CONFIRMATION.CONFIRMED);
  assert.ok(v.signals.includes(SIGNAL.PROTOCOL_MATCHED));
});

// ── the three invariants ────────────────────────────────────────────────────────────────────
test('INVARIANT 1 conservation — the total comes from the LINE COUNT, so unparseable lines cannot hide', () => {
  const d = dir([snmpAt(161), 'not json at all', spring(), '{"truncated": ']);
  const s = solve(d);
  assert.equal(s.total, 4, 'four non-empty lines went in');
  assert.equal(s.counts.unparseable, 2);
  assert.equal(s.counts.confirmed + s.counts.refuted + s.counts.undetermined + s.counts.unparseable, 4);
  assert.equal(s.conserved, true);
});

test('INVARIANT 2 — every refutation carries a rule id AND a template digest', () => {
  const s = solve(dir([snmpAt(161), damengAt(8095, 'HTTP/1.1 400 \r\n\r\n')]));
  assert.equal(s.uncited.length, 0);
  for (const r of s.records.filter((x) => x.confirmation === CONFIRMATION.REFUTED)) {
    assert.ok(r.ruleId && r.ruleDigest, `${r.templateId} refuted without a citation`);
  }
});

test('INVARIANT 3 coverage — a template the store does not have is UNDETERMINED, never confirmed', () => {
  // What a shifted/absent template store looks like. It must read as "not judged", not as clean.
  const orphan = rec({ template: 'http/does/not/exist.yaml', 'template-id': 'ghost', info: { severity: 'high' }, type: 'http', port: '9999', response: 'HTTP/1.1 200 OK\r\n\r\n' });
  const s = solve(dir([orphan]));
  assert.equal(s.records[0].confirmation, CONFIRMATION.UNDETERMINED);
  assert.match(s.records[0].why, /template not found/);
  assert.equal(s.coverage, 0, 'coverage collapses visibly rather than reporting success');
});

// ── the honesty contract ────────────────────────────────────────────────────────────────────
test('an absent artifact is {ok:false} with a reason — never an empty solved file', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-solve-empty-'));
  const s = solve(d);
  assert.equal(s.ok, false);
  assert.match(s.reason, /nothing was adjudicated/);
  assert.equal(writeSolved(d, s), null, 'nothing is written for a dir that was never judged');
  assert.equal(existsSync(join(d, 'nuclei-solved.jsonl')), false);
});

test('the sidecar carries NO raw bytes — not response, not request, not matched text', () => {
  // reports/ is served over the published tunnel; responses carry headers, cookies, stack traces
  const secretish = 'HTTP/1.1 400 \r\nSet-Cookie: SESSION=abc123deadbeef; Path=/\r\n\r\n<h1>Bad</h1>';
  const d = dir([damengAt(8095, secretish), snmpAt(161)]);
  const s = solve(d);
  writeSolved(d, s);
  const written = readFileSync(join(d, 'nuclei-solved.jsonl'), 'utf8');
  assert.ok(!/SESSION=abc123deadbeef/.test(written), 'a cookie from the response reached the sidecar');
  assert.ok(!/Set-Cookie/i.test(written));
  assert.ok(!/Enterprise: unknown/.test(written), 'the extracted value reached the sidecar');
  for (const r of s.records) {
    for (const k of ['response', 'request', 'extracted-results', 'matched-at']) {
      assert.ok(!(k in r), `sidecar record carries raw field ${k}`);
    }
  }
  assert.match(written, /"contradictor":"http-status-line"/, 'the evidence is a CLASS name, which is enough to audit the verdict');
});

test('determinism — the same inputs produce byte-identical output, in an order the input file does not set', () => {
  const recs = [spring(), snmpAt(161), damengAt(8095, 'HTTP/1.1 400 \r\n\r\n'), mdns()];
  const a = solve(dir(recs));
  const b = solve(dir([...recs].reverse()));
  assert.deepEqual(a.records, b.records, 'input ordering must not change the output');
  const d = dir(recs);
  writeSolved(d, solve(d)); const first = readFileSync(join(d, 'nuclei-solved.jsonl'), 'utf8');
  writeSolved(d, solve(d)); const second = readFileSync(join(d, 'nuclei-solved.jsonl'), 'utf8');
  assert.equal(first, second, 're-running must be idempotent');
});

test('the sidecar identity is keyed on place, never on line number or array index', () => {
  const d1 = dir([snmpAt(161), spring()]);
  const d2 = dir([spring(), snmpAt(161)]);
  const k = (s) => s.records.map((r) => `${r.templateId}|${r.host}|${r.port}|${r.proto}`);
  assert.deepEqual(k(solve(d1)), k(solve(d2)), 'moving a record within the file is not a change of identity');
});

test('a nuclei.json ARRAY is solved too — the artifact list is shared with parse-runtime', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-solve-arr-'));
  writeFileSync(join(d, 'nuclei.jsonl'), [snmpAt(161)].map((r) => JSON.stringify(r)).join('\n'));
  const s = solve(d);
  assert.equal(s.ok, true);
  assert.equal(s.total, 1);
});

// ── the joined verdict ──────────────────────────────────────────────────────────────────────
test('disposition joins the two axes, and the four measured cases land where they should', () => {
  const project = { owner: 'project' }, host = { owner: 'host' }, unbound = { owner: 'unbound-unverifiable' };
  const refuted = { confirmation: CONFIRMATION.REFUTED };
  const confirmed = { confirmation: CONFIRMATION.CONFIRMED };
  const undet = { confirmation: CONFIRMATION.UNDETERMINED };

  assert.equal(disposition(refuted, project), DISPOSITION.REFUTED, 'dameng @8095 — a project port does not make it true');
  assert.equal(disposition(refuted, unbound), DISPOSITION.REFUTED, 'snmpv3 @161 — refuted on evidence, not on ownership');
  assert.equal(disposition(undet, host), DISPOSITION.HOST, 'mDNS @5353 — a true finding about the wrong asset');
  assert.equal(disposition(confirmed, project), DISPOSITION.CONFIRMED, 'the ~616 header findings stay in scope');
});

test('OWNERSHIP can refute, but only on an OBSERVED absence', () => {
  // a service on a port the socket table says is empty is not there — that absence is evidence
  const undet = { confirmation: CONFIRMATION.UNDETERMINED };
  assert.equal(disposition(undet, { owner: 'unbound-observed' }), DISPOSITION.REFUTED);
  // the two blind spots observed nothing — neither may refute
  assert.equal(disposition(undet, { owner: 'unbound-unverifiable' }), DISPOSITION.UNDETERMINED);
  assert.equal(disposition(undet, { owner: 'unknown' }), DISPOSITION.UNDETERMINED);
});

test('refutation outranks ownership — a wrong finding is not re-attributed to the host', () => {
  // otherwise the host inventory becomes the dumping ground for every bad template
  assert.equal(disposition({ confirmation: CONFIRMATION.REFUTED }, { owner: 'host' }), DISPOSITION.REFUTED);
});

test('unknown ownership plus unknown confirmation is UNDETERMINED — never confirmed, never clean', () => {
  assert.equal(disposition({ confirmation: CONFIRMATION.UNDETERMINED }, { owner: 'unknown' }), DISPOSITION.UNDETERMINED);
  assert.equal(disposition({ confirmation: CONFIRMATION.UNDETERMINED }, null), DISPOSITION.UNDETERMINED);
});

test('a confirmed finding on a HOST port is host-attributed, not claimed by the project', () => {
  assert.equal(disposition({ confirmation: CONFIRMATION.CONFIRMED }, { owner: 'host' }), DISPOSITION.HOST);
});

// ── rule derivation, directly ───────────────────────────────────────────────────────────────
test('deriveRule reads the declarative fields and NOT the embedded JavaScript', () => {
  const r = deriveRule(readFileSync(join(TPL, T_SNMP), 'utf8'));
  assert.equal(r.id, 'snmpv3-detect');
  assert.ok(r.digest, 'the digest is what makes a rule invalidate itself when the template changes');
  assert.deepEqual(r.declaredPorts, [161]);
  assert.equal(r.gate, 'isUDPPortOpen');
  assert.deepEqual(r.transports, ['udp']);
  assert.equal(r.matcherHasContentPredicate, false);
  assert.equal(r.extractorDiscriminating, false);
});

test('deriveRule sees a content predicate where one exists', () => {
  const dm = deriveRule(readFileSync(join(TPL, T_DAMENG), 'utf8'));
  assert.equal(dm.matcherHasContentPredicate, true, '"version != null" asserts content');
  assert.deepEqual(dm.declaredPorts, [5236]);
  const sb = deriveRule(readFileSync(join(TPL, T_SPRING), 'utf8'));
  assert.equal(sb.matcherHasContentPredicate, true, 'a word matcher asserts content');
});

test('deriveRule distinguishes a discriminating extractor from a catch-all', () => {
  assert.equal(deriveRule(readFileSync(join(TPL, T_MDNS), 'utf8')).extractorDiscriminating, true);
  assert.equal(deriveRule(readFileSync(join(TPL, T_SNMP), 'utf8')).extractorDiscriminating, false);
});

test('the template is resolved store-RELATIVE, so a report stays readable on another machine', () => {
  // template-path is absolute on the scanning box — trusting it breaks portability
  const r = rec({ template: T_SNMP, 'template-path': '/somebody/elses/laptop/snmpv3-detect.yaml', 'template-id': 'snmpv3-detect' });
  assert.equal(templateFileFor(r, TPL), join(TPL, T_SNMP));
});

test('CW_NUCLEI_TEMPLATES is read at CALL time, not module load', () => {
  // a `const X = process.env.Y` at import silently defeats the override
  const before = process.env.CW_NUCLEI_TEMPLATES;
  try {
    process.env.CW_NUCLEI_TEMPLATES = TPL;
    const loader = ruleLoader();
    const r = loader(snmpAt(161));
    assert.equal(r.ok, true);
    assert.equal(r.id, 'snmpv3-detect');
  } finally {
    if (before === undefined) delete process.env.CW_NUCLEI_TEMPLATES; else process.env.CW_NUCLEI_TEMPLATES = before;
  }
});

test('an unreadable template yields undetermined, never confirmed', () => {
  const v = classify(snmpAt(161), { ok: false, id: 'snmpv3-detect', reason: 'template unreadable: EACCES' });
  assert.equal(v.confirmation, CONFIRMATION.UNDETERMINED);
  assert.match(v.why, /unreadable/);
});

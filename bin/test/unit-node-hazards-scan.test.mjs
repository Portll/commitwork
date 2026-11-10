// Scans a directory tree for security hazards in code and template files (bin/node-hazards.mjs scan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../node-hazards.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns zero scanned and empty arrays for an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    const r = scan(dir);
    assert.deepEqual(r, { findings: [], suppressed: [], scanned: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a TLS verification defect in a JavaScript file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 'a.js'), "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';\n");
    const r = scan(dir);
    assert.deepEqual(r, { findings: [{ ruleId: "node/tls-verification-disabled", level: "error", line: 1, message: "NODE_TLS_REJECT_UNAUTHORIZED is set to 0, disabling TLS certificate verification process-wide", path: "a.js" }], suppressed: [], scanned: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports an unescaped EJS template finding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 't.ejs'), "<%- user %>\n");
    const r = scan(dir);
    assert.deepEqual(r, { findings: [{ ruleId: "template/ejs-unescaped", level: "warning", line: 1, message: "EJS emits an unescaped variable with <%- ... %> \u2014 use <%= ... %> unless the value is trusted HTML", path: "t.ejs" }], suppressed: [], scanned: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('moves a suppressed finding into the suppressed sidecar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 's.js'), "// cw-hazards-ignore: test\nprocess.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';\n");
    const r = scan(dir);
    assert.deepEqual(r, { findings: [], suppressed: [{ ruleId: "node/tls-verification-disabled", level: "error", line: 2, message: "NODE_TLS_REJECT_UNAUTHORIZED is set to 0, disabling TLS certificate verification process-wide", path: "s.js", suppression: { marker: "cw-hazards-ignore", justification: "test", ownLine: false } }], scanned: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a weak hash note in a TypeScript file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 'h.ts'), "const h = crypto.createHash('md5');\n");
    const r = scan(dir);
    assert.deepEqual(r, { findings: [{ ruleId: "node/weak-hash", level: "note", line: 1, message: "Weak hash (md5/sha1) \u2014 fine for a checksum, not for signatures, passwords or tokens; confirm the purpose", path: "h.ts" }], suppressed: [], scanned: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a cookie flag downgrade warning', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 'c.js'), "res.cookie('x', 'y', { httpOnly: false });\n");
    const r = scan(dir);
    assert.deepEqual(r, { findings: [{ ruleId: "node/cookie-flag-downgrade", level: "warning", line: 1, message: "Cookie security flag explicitly downgraded (httpOnly/secure false, or sameSite none)", path: "c.js" }], suppressed: [], scanned: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a React dangerouslySetInnerHTML warning', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 'r.jsx'), "const el = <div dangerouslySetInnerHTML={{ __html: raw }} />;\n");
    const r = scan(dir);
    assert.deepEqual(r, { findings: [{ ruleId: "node/react-dangerously-set-inner-html", level: "warning", line: 1, message: "React dangerouslySetInnerHTML bypasses JSX escaping \u2014 sanitise the value or render it as text", path: "r.jsx" }], suppressed: [], scanned: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a Vue v-html warning in a vue file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 'v.vue'), "<div v-html=\"raw\"></div>\n");
    const r = scan(dir);
    assert.deepEqual(r, { findings: [{ ruleId: "node/vue-v-html", level: "warning", line: 1, message: "Vue v-html renders raw HTML, bypassing template escaping (XSS)", path: "v.vue" }], suppressed: [], scanned: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a Handlebars unescaped triple-brace finding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 'x.hbs'), "{{{ name }}}\n");
    const r = scan(dir);
    assert.deepEqual(r, { findings: [{ ruleId: "template/handlebars-unescaped", level: "warning", line: 1, message: "Handlebars/Mustache emits an unescaped variable ({{{ }}} or {{& }}) \u2014 bypasses auto-escaping (XSS)", path: "x.hbs" }], suppressed: [], scanned: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a Pug unescaped interpolation finding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    writeFileSync(join(dir, 'p.pug'), "div\n  !{ raw }\n");
    const r = scan(dir);
    assert.deepEqual(r, { findings: [{ ruleId: "template/pug-unescaped", level: "warning", line: 2, message: "Pug emits an unescaped variable (!{ } or !=) \u2014 #{ } and = are the escaped forms (XSS)", path: "p.pug" }], suppressed: [], scanned: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// bin/lib/wp-dump.mjs — read the tables a posture reading needs out of a MySQL dump without holding
// the dump in memory. UpdraftPlus and mysqldump both write one INSERT per table, the first on one
// line of hundreds of megabytes, the second one row per line, and a 600 MB dump is ordinary for a
// WordPress site with a mail log. The file is scanned as a stream: every statement head is read,
// the few tables asked for are captured and parsed, everything else is skipped at quote-tracking
// speed, and a `.gz` dump is inflated on the way through.
//
// Values come back as JavaScript strings, numbers and null. Nothing is executed and no value is
// interpreted here; the adapters decide what a column means and what may leave the process.
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';

export const DEFAULT_TABLES = Object.freeze(['options', 'users', 'usermeta', 'simple_history', 'aiowps_audit_log', 'login_limit_fails']);
const HEAD_MAX = 512;
const QUOTE_OR_END = /['";\n]/g;
const QUOTE_OR_ESCAPE = /['\\]/g;
const DQUOTE_OR_ESCAPE = /["\\]/g;

const CREATE_RX = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_$]+)`?/i;
const INSERT_RX = /^(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+`?([A-Za-z0-9_$]+)`?/i;

/** The WordPress table prefix implied by a table list: the shortest `<p>options` with a `<p>users` beside it. */
export function prefixOf(tableNames) {
  const names = new Set(tableNames);
  const candidates = [...names].filter((n) => n.endsWith('options')).map((n) => n.slice(0, -'options'.length)).filter((p) => names.has(`${p}users`));
  if (!candidates.length) return null;
  return candidates.sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
}

/**
 * Parse the body after VALUES: `(v, v, ...), (v, ...)` up to the terminating `;` or end of text.
 * Returns { rows, truncated } where truncated names a parse stop the caller must report.
 */
export function parseValues(text, { rowCap = Infinity } = {}) {
  const rows = [];
  let pos = text.search(/\bVALUES\b/i);
  if (pos < 0) return { rows, error: 'no VALUES clause' };
  pos += 'VALUES'.length;
  let dropped = 0;
  const n = text.length;
  const skipWs = () => { while (pos < n && /\s/.test(text[pos])) pos++; };
  const readString = (q) => {
    let out = '';
    pos++;
    while (pos < n) {
      const c = text[pos];
      if (c === '\\') {
        const e = text[pos + 1];
        out += e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e === '0' ? '\0' : e === 'Z' ? '\x1a' : e === 'b' ? '\b' : e === undefined ? '' : e;
        pos += 2;
        continue;
      }
      if (c === q) {
        if (text[pos + 1] === q) { out += q; pos += 2; continue; }
        pos++;
        return out;
      }
      out += c;
      pos++;
    }
    throw new Error('unterminated string');
  };
  const readValue = () => {
    skipWs();
    const c = text[pos];
    if (c === "'" || c === '"') return readString(c);
    const start = pos;
    while (pos < n && text[pos] !== ',' && text[pos] !== ')') pos++;
    const raw = text.slice(start, pos).trim();
    if (/^null$/i.test(raw)) return null;
    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(raw)) { const v = Number(raw); return Number.isSafeInteger(v) || !/^-?\d+$/.test(raw) ? v : raw; }
    if (/^0x[0-9a-f]+$/i.test(raw)) return Buffer.from(raw.slice(2), 'hex').toString('utf8');
    return raw;
  };
  try {
    for (;;) {
      skipWs();
      if (pos >= n || text[pos] === ';') break;
      if (text[pos] === ',') { pos++; continue; }
      if (text[pos] !== '(') throw new Error(`expected '(' at ${pos}`);
      pos++;
      const row = [];
      for (;;) {
        row.push(readValue());
        skipWs();
        if (text[pos] === ',') { pos++; continue; }
        if (text[pos] === ')') { pos++; break; }
        throw new Error(`expected ',' or ')' at ${pos}`);
      }
      if (rows.length < rowCap) rows.push(row); else dropped++;
    }
  } catch (e) {
    return { rows, dropped, error: e.message };
  }
  return { rows, dropped };
}

/**
 * Stream a dump and return the rows of the requested tables (by suffix, prefix-independent), the
 * full table inventory from CREATE TABLE statements, and the inferred prefix.
 */
export async function readDump(path, { tables = DEFAULT_TABLES, maxStatementBytes = 256 * 1024 * 1024, rowCap = 500000 } = {}) {
  const wanted = new Set(tables);
  const result = { path, gzip: /\.gz$/i.test(path), bytes: 0, tableNames: [], prefix: null, rows: {}, statements: 0, partial: [] };
  for (const t of tables) result.rows[t] = [];
  const captured = {};
  const tableSet = new Set();

  let inQuote = null;
  let mode = 'line-start';
  let head = '';
  let capture = null;
  let captureBytes = 0;
  let captureTable = null;
  let overflow = false;

  const suffixFor = (name) => {
    for (const t of wanted) if (name.endsWith(t) && (result.prefix ? name === result.prefix + t : /_?$/.test(name.slice(0, -t.length)))) return t;
    return null;
  };
  const endStatement = () => {
    result.statements++;
    if (capture !== null && captureTable) {
      if (overflow) result.partial.push(`${captureTable}: statement exceeded ${maxStatementBytes} bytes and was not parsed`);
      else (captured[captureTable] ||= []).push(capture);
    }
    capture = null; captureBytes = 0; captureTable = null; overflow = false;
    mode = 'line-start';
  };
  const beginStatement = (h) => {
    const c = CREATE_RX.exec(h);
    if (c) { tableSet.add(c[1]); mode = 'skip'; return; }
    const i = INSERT_RX.exec(h);
    if (i) {
      if (!result.prefix) {
        const all = [...tableSet];
        result.prefix = prefixOf(all) || result.prefix;
      }
      const t = suffixFor(i[1]);
      if (t) { capture = h; captureBytes = h.length; captureTable = t; mode = 'capture'; return; }
    }
    mode = 'skip';
  };

  const feed = (chunk) => {
    let i = 0;
    const n = chunk.length;
    while (i < n) {
      if (inQuote) {
        const rx = inQuote === "'" ? QUOTE_OR_ESCAPE : DQUOTE_OR_ESCAPE;
        rx.lastIndex = i;
        const m = rx.exec(chunk);
        const stop = m ? m.index : n;
        if (mode === 'capture') { if (!overflow) { capture += chunk.slice(i, stop + (m ? 1 : 0)); captureBytes += stop - i + (m ? 1 : 0); if (captureBytes > maxStatementBytes) { overflow = true; capture = null; } } }
        if (!m) { i = n; break; }
        i = stop + 1;
        if (m[0] === '\\') { if (i < n) { if (mode === 'capture' && !overflow) capture += chunk[i]; i++; } else { pendingEscape = true; } continue; }
        if (chunk[i] === inQuote) { if (mode === 'capture' && !overflow) capture += chunk[i]; i++; continue; }
        inQuote = null;
        continue;
      }
      if (mode === 'line-start') {
        const c = chunk[i];
        if (c === '\n' || c === '\r' || c === ' ' || c === '\t') { i++; continue; }
        if (c === '#' || (c === '-' && chunk[i + 1] === '-')) { mode = 'comment'; continue; }
        if (c === '/' && chunk[i + 1] === '*') { mode = 'block-comment'; i += 2; continue; }
        mode = 'head'; head = '';
        continue;
      }
      if (mode === 'comment') {
        const nl = chunk.indexOf('\n', i);
        if (nl < 0) { i = n; break; }
        i = nl + 1; mode = 'line-start';
        continue;
      }
      if (mode === 'block-comment') {
        const end = chunk.indexOf('*/', i);
        if (end < 0) { i = n; break; }
        i = end + 2;
        mode = 'skip';
        continue;
      }
      if (mode === 'head') {
        const c = chunk[i];
        if (c === '(' || c === '\n' || head.length >= HEAD_MAX || c === ';') {
          beginStatement(head);
          if (mode === 'capture' && c === '(') { capture += c; captureBytes++; i++; }
          else if (c === ';') { endStatement(); i++; }
          else if (c === '\n') { i++; }
          continue;
        }
        head += c; i++;
        continue;
      }
      QUOTE_OR_END.lastIndex = i;
      const m = QUOTE_OR_END.exec(chunk);
      const stop = m ? m.index : n;
      if (mode === 'capture' && !overflow) { capture += chunk.slice(i, stop); captureBytes += stop - i; if (captureBytes > maxStatementBytes) { overflow = true; capture = null; } }
      if (!m) { i = n; break; }
      i = stop + 1;
      if (m[0] === ';') { endStatement(); continue; }
      if (m[0] === '\n') continue;
      inQuote = m[0];
      if (mode === 'capture' && !overflow) capture += m[0];
    }
  };
  let pendingEscape = false;

  await new Promise((resolvePromise, reject) => {
    const decoder = new StringDecoder('utf8');
    let stream = createReadStream(path);
    stream.on('error', reject);
    if (result.gzip) { const gz = createGunzip(); gz.on('error', reject); stream = stream.pipe(gz); }
    stream.on('data', (buf) => {
      result.bytes += buf.length;
      let text = decoder.write(buf);
      if (pendingEscape && text.length) { if (mode === 'capture' && !overflow) capture += text[0]; text = text.slice(1); pendingEscape = false; }
      feed(text);
    });
    stream.on('end', () => { const rest = decoder.end(); if (rest) feed(rest); if (mode === 'capture' || mode === 'skip') endStatement(); resolvePromise(); });
  });

  result.tableNames = [...tableSet].sort();
  if (!result.prefix) result.prefix = prefixOf(result.tableNames);
  for (const [t, statements] of Object.entries(captured)) {
    let total = 0;
    for (const s of statements) {
      const parsed = parseValues(s, { rowCap: Math.max(0, rowCap - total) });
      total += parsed.rows.length + (parsed.dropped || 0);
      // a loop, not push(...rows): a table of a few hundred thousand rows overflows the argument stack
      for (const row of parsed.rows) result.rows[t].push(row);
      if (parsed.dropped) result.partial.push(`${t}: ${parsed.dropped} row(s) beyond the ${rowCap} cap were not kept`);
      if (parsed.error) result.partial.push(`${t}: ${parsed.error}; ${parsed.rows.length} row(s) read before it`);
    }
  }
  return result;
}

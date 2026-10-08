// lib/der.mjs — the DER subset RFC 3161 and CMS need: single-byte tags, definite lengths only.
// The decoder is strict (minimal lengths, no indefinite form, no trailing bytes) because a token that
// only parses leniently is a token whose signed bytes two readers can disagree about.

export const TAG = {
  BOOLEAN: 0x01, INTEGER: 0x02, BIT_STRING: 0x03, OCTET_STRING: 0x04, NULL: 0x05, OID: 0x06,
  UTF8: 0x0c, PRINTABLE: 0x13, IA5: 0x16, UTCTIME: 0x17, GENTIME: 0x18, SEQUENCE: 0x30, SET: 0x31,
};

export class DerError extends Error {}

const MAX_DEPTH = 32;

function lengthBytes(n) {
  if (n < 0x80) return Buffer.from([n]);
  const out = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return Buffer.from([0x80 | out.length, ...out]);
}

export function tlv(tag, content) {
  const body = Buffer.from(content);
  return Buffer.concat([Buffer.from([tag]), lengthBytes(body.length), body]);
}

export const seq = (...items) => tlv(TAG.SEQUENCE, Buffer.concat(items));
// DER orders SET OF by encoding.
export const set = (...items) => tlv(TAG.SET, Buffer.concat([...items].sort(Buffer.compare)));
export const octets = (b) => tlv(TAG.OCTET_STRING, b);
export const nul = () => Buffer.from([TAG.NULL, 0]);
export const bool = (v) => tlv(TAG.BOOLEAN, [v ? 0xff : 0x00]);
export const utf8 = (s) => tlv(TAG.UTF8, Buffer.from(String(s), 'utf8'));
export const printable = (s) => tlv(TAG.PRINTABLE, Buffer.from(String(s), 'ascii'));
export const bitString = (b) => tlv(TAG.BIT_STRING, Buffer.concat([Buffer.from([0]), Buffer.from(b)]));
// Context-specific constructed [n]: EXPLICIT wraps one element, IMPLICIT replaces a SEQUENCE/SET tag.
export const ctx = (n, ...items) => tlv(0xa0 | n, Buffer.concat(items));
export const ctxPrim = (n, content) => tlv(0x80 | n, content);

// Non-negative INTEGER from a number, bigint, or unsigned big-endian Buffer.
export function int(v) {
  let mag;
  if (Buffer.isBuffer(v)) mag = Buffer.from(v);
  else {
    let b = BigInt(v);
    if (b < 0n) throw new DerError('negative INTEGER not supported');
    const hex = b.toString(16);
    mag = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
  }
  let i = 0;
  while (i < mag.length - 1 && mag[i] === 0) i++;
  mag = mag.subarray(i);
  if (!mag.length) mag = Buffer.from([0]);
  if (mag[0] & 0x80) mag = Buffer.concat([Buffer.from([0]), mag]);
  return tlv(TAG.INTEGER, mag);
}

export function oid(dotted) {
  const arcs = String(dotted).split('.').map((a) => BigInt(a));
  if (arcs.length < 2) throw new DerError(`bad OID ${dotted}`);
  const out = [];
  const push = (v) => {
    const tmp = [Number(v & 0x7fn)];
    for (v >>= 7n; v > 0n; v >>= 7n) tmp.unshift(Number(v & 0x7fn) | 0x80);
    out.push(...tmp);
  };
  push(arcs[0] * 40n + arcs[1]);
  for (const a of arcs.slice(2)) push(a);
  return tlv(TAG.OID, out);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function genTime(date) {
  const d = new Date(date);
  const ms = d.getUTCMilliseconds();
  const frac = ms ? `.${pad(ms, 3).replace(/0+$/, '')}` : '';
  return tlv(TAG.GENTIME, Buffer.from(`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${frac}Z`, 'ascii'));
}
export function utcTime(date) {
  const d = new Date(date);
  return tlv(TAG.UTCTIME, Buffer.from(`${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`, 'ascii'));
}

// ── decoding ─────────────────────────────────────────────────────────────────────────────────

function decodeAt(buf, pos, depth) {
  if (depth > MAX_DEPTH) throw new DerError('nesting too deep');
  if (pos + 2 > buf.length) throw new DerError(`truncated header at ${pos}`);
  const tag = buf[pos];
  if ((tag & 0x1f) === 0x1f) throw new DerError(`multi-byte tag at ${pos} not supported`);
  let len = buf[pos + 1];
  let hdr = 2;
  if (len === 0x80) throw new DerError(`indefinite length at ${pos} (BER, not DER)`);
  if (len > 0x80) {
    const n = len & 0x7f;
    if (n > 4) throw new DerError(`length of ${n} bytes at ${pos} too large`);
    if (pos + 2 + n > buf.length) throw new DerError(`truncated length at ${pos}`);
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[pos + 2 + i];
    if (buf[pos + 2] === 0 || len < 0x80) throw new DerError(`non-minimal length at ${pos}`);
    hdr += n;
  }
  const start = pos + hdr, end = start + len;
  if (end > buf.length) throw new DerError(`element at ${pos} overruns its buffer (${end} > ${buf.length})`);
  const node = {
    tag, cls: tag >> 6, constructed: (tag & 0x20) !== 0, number: tag & 0x1f,
    raw: buf.subarray(pos, end), content: buf.subarray(start, end), end,
  };
  if (node.constructed) {
    node.children = [];
    for (let p = start; p < end;) { const c = decodeAt(buf, p, depth + 1); node.children.push(c); p = c.end; }
  }
  return node;
}

export function decode(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const node = decodeAt(b, 0, 0);
  if (node.end !== b.length) throw new DerError(`${b.length - node.end} trailing byte(s) after the DER element`);
  return node;
}

export function expect(node, tag, what) {
  if (!node) throw new DerError(`${what}: missing`);
  if (node.tag !== tag) throw new DerError(`${what}: expected tag 0x${tag.toString(16)}, got 0x${node.tag.toString(16)}`);
  return node;
}

export function readInt(node, what = 'INTEGER') {
  expect(node, TAG.INTEGER, what);
  const c = node.content;
  if (!c.length) throw new DerError(`${what}: empty`);
  if (c.length > 1 && ((c[0] === 0 && !(c[1] & 0x80)) || (c[0] === 0xff && (c[1] & 0x80)))) throw new DerError(`${what}: non-minimal encoding`);
  let v = BigInt(`0x${c.toString('hex')}`);
  if (c[0] & 0x80) v -= 1n << BigInt(c.length * 8);
  return v;
}

export function readOid(node, what = 'OID') {
  expect(node, TAG.OID, what);
  const c = node.content;
  if (!c.length || (c[c.length - 1] & 0x80)) throw new DerError(`${what}: malformed`);
  const vals = [];
  let v = 0n;
  for (let i = 0; i < c.length; i++) {
    if (v === 0n && c[i] === 0x80) throw new DerError(`${what}: non-minimal arc`);
    v = (v << 7n) | BigInt(c[i] & 0x7f);
    if (!(c[i] & 0x80)) { vals.push(v); v = 0n; }
  }
  const first = vals[0] < 40n ? 0n : vals[0] < 80n ? 1n : 2n;
  return [first, vals[0] - first * 40n, ...vals.slice(1)].join('.');
}

export function readBool(node, what = 'BOOLEAN') {
  expect(node, TAG.BOOLEAN, what);
  if (node.content.length !== 1 || (node.content[0] !== 0 && node.content[0] !== 0xff)) throw new DerError(`${what}: not a DER BOOLEAN`);
  return node.content[0] === 0xff;
}

const GEN_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d*[1-9]))?Z$/;
const UTC_TIME = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/;
// Returns { iso (ms precision), text (as signed) } — the text keeps any sub-millisecond digits.
export function readTime(node, what = 'time') {
  const text = node?.content?.toString('ascii');
  let m, y;
  if (node?.tag === TAG.GENTIME && (m = GEN_TIME.exec(text))) y = Number(m[1]);
  else if (node?.tag === TAG.UTCTIME && (m = UTC_TIME.exec(text))) { y = Number(m[1]); y += y < 50 ? 2000 : 1900; }
  else throw new DerError(`${what}: not a DER GeneralizedTime/UTCTime (${text === undefined ? 'missing' : JSON.stringify(text)})`);
  const ms = m[7] ? Number(m[7].padEnd(3, '0').slice(0, 3)) : 0;
  const t = Date.UTC(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms);
  if (Number.isNaN(t)) throw new DerError(`${what}: invalid date ${text}`);
  return { iso: new Date(t).toISOString(), text };
}

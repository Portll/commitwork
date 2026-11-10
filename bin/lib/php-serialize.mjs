// bin/lib/php-serialize.mjs — read PHP's serialize() format, the shape WordPress stores arrays in
// (active_plugins, auto_update_plugins, cron, capabilities). Strings, integers, floats, booleans,
// null, arrays and objects; an object becomes a plain record of its properties, so nothing is
// instantiated and nothing runs. Anything malformed throws, and the caller treats that as unknown.
//
// Byte lengths: PHP counts string bytes, not UTF-16 units, so the text is walked as a UTF-8 buffer.
import { rethrowIfBug } from '../rethrow.mjs';

export function unserialize(text) {
  const buf = Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8');
  let pos = 0;
  const fail = (why) => { throw new Error(`unserialize: ${why} at byte ${pos}`); };
  const expect = (ch) => { if (buf[pos] !== ch.charCodeAt(0)) fail(`expected '${ch}'`); pos++; };
  const readUntil = (ch) => {
    const end = buf.indexOf(ch, pos, 'latin1');
    if (end < 0) fail(`unterminated token, expected '${ch}'`);
    const s = buf.toString('latin1', pos, end);
    pos = end + 1;
    return s;
  };
  const readInt = (ch) => {
    const s = readUntil(ch);
    if (!/^-?\d+$/.test(s)) fail(`not an integer: ${s.slice(0, 20)}`);
    return Number(s);
  };
  const readString = () => {
    const len = readInt(':');
    expect('"');
    if (pos + len > buf.length) fail('string length exceeds input');
    const s = buf.toString('utf8', pos, pos + len);
    pos += len;
    expect('"');
    return s;
  };
  const readValue = () => {
    const t = String.fromCharCode(buf[pos]);
    pos++;
    switch (t) {
      case 'N': expect(';'); return null;
      case 'b': { expect(':'); const v = readUntil(';'); if (v !== '0' && v !== '1') fail('bad boolean'); return v === '1'; }
      case 'i': { expect(':'); return readInt(';'); }
      case 'd': { expect(':'); const s = readUntil(';'); const n = Number(s); if (!Number.isFinite(n) && !/^-?INF$|^NAN$/.test(s)) fail('bad float'); return n; }
      case 's': { expect(':'); const s = readString(); expect(';'); return s; }
      case 'a': {
        expect(':');
        const n = readInt(':');
        expect('{');
        // keys come from the dump: a `__proto__` key must be data, not a prototype assignment
        const out = Object.create(null);
        for (let i = 0; i < n; i++) {
          const k = readValue();
          if (typeof k !== 'string' && typeof k !== 'number') fail('array key must be string or integer');
          out[k] = readValue();
        }
        expect('}');
        return out;
      }
      case 'O': {
        expect(':');
        const cls = readString();
        expect(':');
        const n = readInt(':');
        expect('{');
        const out = Object.assign(Object.create(null), { __class: cls });
        for (let i = 0; i < n; i++) {
          const k = readValue();
          if (typeof k !== 'string') fail('object property name must be a string');
          // private and protected names carry \0Class\0 / \0*\0 prefixes; keep the bare name
          out[k.replace(/^\0[^\0]*\0/, '')] = readValue();
        }
        expect('}');
        return out;
      }
      default: fail(`unknown type '${t}'`);
    }
    return undefined;
  };
  const value = readValue();
  if (pos !== buf.length) fail('trailing bytes');
  return value;
}

/** unserialize, or `fallback` when the text is not serialized PHP. */
export function tryUnserialize(text, fallback = undefined) {
  try { return unserialize(text); } catch (e) { rethrowIfBug(e); return fallback; }
}

/** The string values of a serialized list, in order: what active_plugins and auto_update_plugins hold. */
export function stringList(text) {
  const v = tryUnserialize(text, null);
  if (!v || typeof v !== 'object') return null;
  return Object.values(v).filter((x) => typeof x === 'string');
}

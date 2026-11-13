// TOML 1.0 reader for untrusted configuration: any input it does not fully understand is a TomlError.

// Untrusted nesting would otherwise end in a RangeError from the call stack instead of a TomlError.
const MAX_NESTING = 64;

const WS = new Set([' ', '\t']);
const KEY_CHAR = /[A-Za-z0-9_-]/;
const TOKEN_CHAR = /[A-Za-z0-9_+\-.:]/;

const DEC_INT = /^[+-]?(?:0|[1-9](?:_?[0-9])*)$/;
const HEX_INT = /^0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*$/;
const OCT_INT = /^0o[0-7](?:_?[0-7])*$/;
const BIN_INT = /^0b[01](?:_?[01])*$/;
const FLOAT = /^[+-]?(?:(?:0|[1-9](?:_?[0-9])*)\.[0-9](?:_?[0-9])*(?:[eE][+-]?[0-9](?:_?[0-9])*)?|(?:0|[1-9](?:_?[0-9])*)[eE][+-]?[0-9](?:_?[0-9])*)$/;

const DATE_OFFSET = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const DATE_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const TIME_START = /^[0-9]{2}:[0-9]{2}/;

const ESCAPES = new Map([
  ['b', '\b'], ['t', '\t'], ['n', '\n'], ['f', '\f'], ['r', '\r'],
  ['"', '"'], ['\\', '\\'],
]);

const isControl = (c) => {
  const code = c.charCodeAt(0);
  return (code < 0x20 && c !== '\t') || code === 0x7f;
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const daysInMonth = (year, month) => {
  if (month === 2) return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

export class TomlError extends Error {
  constructor(message, line) {
    super(`toml: line ${line}: ${message}`);
    this.name = 'TomlError';
    this.line = line;
  }
}

class Parser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.lineStarts = [0];
    this.depth = 0;
    this.tableInfo = new WeakMap();
    this.arrayInfo = new WeakMap();
    this.indexLinesRejectingBareCarriageReturn();
  }

  indexLinesRejectingBareCarriageReturn() {
    let line = 1;
    for (let i = 0; i < this.text.length; i++) {
      const c = this.text[i];
      if (c === '\r') {
        if (this.text[i + 1] !== '\n') throw new TomlError('bare carriage return', line);
        i += 1;
        line += 1;
        this.lineStarts.push(i + 1);
      } else if (c === '\n') {
        line += 1;
        this.lineStarts.push(i + 1);
      }
    }
  }

  lineAt(index) {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  fail(message, index = this.pos) {
    return new TomlError(message, this.lineAt(index));
  }

  atEnd() {
    return this.pos >= this.text.length;
  }

  peek() {
    return this.text[this.pos];
  }

  skipSpaces() {
    while (WS.has(this.text[this.pos])) this.pos += 1;
  }

  skipComment() {
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === '\n' || c === '\r') return;
      if (isControl(c)) throw this.fail('control character in comment', this.pos);
      this.pos += 1;
    }
  }

  consumeNewline() {
    const c = this.text[this.pos];
    if (c === '\n') {
      this.pos += 1;
      return true;
    }
    if (c === '\r' && this.text[this.pos + 1] === '\n') {
      this.pos += 2;
      return true;
    }
    return false;
  }

  skipBlankLines() {
    for (;;) {
      this.skipSpaces();
      if (this.peek() === '#') this.skipComment();
      if (!this.consumeNewline()) return;
    }
  }

  skipArrayTrivia() {
    for (;;) {
      this.skipSpaces();
      if (this.consumeNewline()) continue;
      if (this.peek() === '#') {
        this.skipComment();
        continue;
      }
      return;
    }
  }

  finishStatement() {
    this.skipSpaces();
    if (this.peek() === '#') this.skipComment();
    if (this.atEnd()) return;
    if (this.consumeNewline()) return;
    throw this.fail('unexpected text after value', this.pos);
  }

  parse() {
    const root = {};
    this.root = root;
    this.tableInfo.set(root, { header: false, implicit: false, dotted: false, inline: false });
    let current = root;
    for (;;) {
      this.skipBlankLines();
      if (this.atEnd()) break;
      if (this.peek() === '[') {
        current = this.text[this.pos + 1] === '[' ? this.parseArrayTableHeader() : this.parseTableHeader();
      } else {
        this.parseKeyValue(current);
      }
      this.finishStatement();
    }
    return root;
  }

  setKey(table, key, value) {
    Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true });
  }

  info(object) {
    let entry = this.tableInfo.get(object);
    if (!entry) {
      entry = { header: false, implicit: false, dotted: false, inline: false };
      this.tableInfo.set(object, entry);
    }
    return entry;
  }

  parseKey() {
    const c = this.peek();
    if (c === '"') {
      if (this.text.startsWith('"""', this.pos)) throw this.fail('multi-line string cannot be a key');
      return this.parseBasicString();
    }
    if (c === "'") {
      if (this.text.startsWith("'''", this.pos)) throw this.fail('multi-line string cannot be a key');
      return this.parseLiteralString();
    }
    const start = this.pos;
    while (KEY_CHAR.test(this.text[this.pos] || '')) this.pos += 1;
    if (this.pos === start) throw this.fail('expected key', start);
    return this.text.slice(start, this.pos);
  }

  parseKeyPath() {
    const parts = [];
    this.skipSpaces();
    parts.push(this.parseKey());
    this.skipSpaces();
    while (this.peek() === '.') {
      this.pos += 1;
      this.skipSpaces();
      parts.push(this.parseKey());
      this.skipSpaces();
    }
    return parts;
  }

  walkHeader(parts, start) {
    let cur = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!Object.hasOwn(cur, key)) {
        const table = {};
        this.setKey(cur, key, table);
        this.tableInfo.set(table, { header: false, implicit: true, dotted: false, inline: false });
        cur = table;
        continue;
      }
      const value = cur[key];
      if (Array.isArray(value)) {
        if (!this.arrayInfo.get(value)?.arrayOfTables) throw this.fail(`key ${JSON.stringify(key)} is not a table`, start);
        cur = value[value.length - 1];
      } else if (isObject(value)) {
        if (this.info(value).inline) throw this.fail('cannot extend an inline table', start);
        cur = value;
      } else {
        throw this.fail(`key ${JSON.stringify(key)} is not a table`, start);
      }
    }
    return cur;
  }

  parseTableHeader() {
    const start = this.pos;
    this.pos += 1;
    const parts = this.parseKeyPath();
    if (this.peek() !== ']') throw this.fail('expected ] to close table header', start);
    this.pos += 1;
    const key = parts[parts.length - 1];
    const parent = this.walkHeader(parts, start);
    if (!Object.hasOwn(parent, key)) {
      const table = {};
      this.setKey(parent, key, table);
      this.tableInfo.set(table, { header: true, implicit: false, dotted: false, inline: false });
      return table;
    }
    const value = parent[key];
    if (!isObject(value)) throw this.fail(`cannot redefine ${JSON.stringify(key)} as a table`, start);
    const info = this.info(value);
    if (info.inline) throw this.fail('cannot extend an inline table', start);
    if (info.header) throw this.fail(`table ${JSON.stringify(key)} is defined more than once`, start);
    if (info.dotted) throw this.fail(`table ${JSON.stringify(key)} was already defined by dotted keys`, start);
    info.header = true;
    info.implicit = false;
    return value;
  }

  parseArrayTableHeader() {
    const start = this.pos;
    this.pos += 2;
    const parts = this.parseKeyPath();
    if (this.text[this.pos] !== ']' || this.text[this.pos + 1] !== ']') {
      throw this.fail('expected ]] to close array-of-tables header', start);
    }
    this.pos += 2;
    const key = parts[parts.length - 1];
    const parent = this.walkHeader(parts, start);
    let array;
    if (!Object.hasOwn(parent, key)) {
      array = [];
      this.arrayInfo.set(array, { arrayOfTables: true });
      this.setKey(parent, key, array);
    } else {
      array = parent[key];
      if (!Array.isArray(array) || !this.arrayInfo.get(array)?.arrayOfTables) {
        throw this.fail(`cannot redefine ${JSON.stringify(key)} as an array of tables`, start);
      }
    }
    const table = {};
    this.tableInfo.set(table, { header: false, implicit: false, dotted: false, inline: false, arrayElement: true });
    array.push(table);
    return table;
  }

  resolveDottedParent(table, parts, start) {
    let cur = table;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!Object.hasOwn(cur, key)) {
        const child = {};
        this.setKey(cur, key, child);
        this.tableInfo.set(child, { header: false, implicit: false, dotted: true, inline: false });
        cur = child;
        continue;
      }
      const value = cur[key];
      if (!isObject(value)) throw this.fail(`key ${JSON.stringify(key)} is not a table`, start);
      const info = this.info(value);
      if (info.inline) throw this.fail('cannot extend an inline table', start);
      if (info.header) throw this.fail(`cannot redefine table ${JSON.stringify(key)} with dotted keys`, start);
      info.dotted = true;
      cur = value;
    }
    if (Object.hasOwn(cur, parts[parts.length - 1])) {
      throw this.fail(`key ${JSON.stringify(parts[parts.length - 1])} is defined more than once`, start);
    }
    return cur;
  }

  parseKeyValue(table) {
    const start = this.pos;
    const parts = this.parseKeyPath();
    this.skipSpaces();
    if (this.peek() !== '=') throw this.fail('expected = after key', start);
    this.pos += 1;
    this.skipSpaces();
    const parent = this.resolveDottedParent(table, parts, start);
    const value = this.parseValue();
    this.setKey(parent, parts[parts.length - 1], value);
  }

  parseValue() {
    const c = this.peek();
    if (c === undefined) throw this.fail('expected value');
    if (c === '"') {
      return this.text.startsWith('"""', this.pos) ? this.parseMultilineBasicString() : this.parseBasicString();
    }
    if (c === "'") {
      return this.text.startsWith("'''", this.pos) ? this.parseMultilineLiteralString() : this.parseLiteralString();
    }
    if (c === '[') return this.parseNested(this.parseArray);
    if (c === '{') return this.parseNested(this.parseInlineTable);
    if (c === 't') return this.parseBoolean('true', true);
    if (c === 'f') return this.parseBoolean('false', false);
    return this.parseScalar();
  }

  parseNested(parseContainer) {
    if (this.depth >= MAX_NESTING) throw this.fail(`arrays and inline tables nest deeper than ${MAX_NESTING} levels`);
    this.depth += 1;
    const value = parseContainer.call(this);
    this.depth -= 1;
    return value;
  }

  parseBoolean(word, value) {
    if (this.text.startsWith(word, this.pos)) {
      const after = this.text[this.pos + word.length];
      if (after === undefined || !TOKEN_CHAR.test(after)) {
        this.pos += word.length;
        return value;
      }
    }
    throw this.fail('invalid value');
  }

  parseScalar() {
    const start = this.pos;
    let raw = this.readToken();
    if (raw === '') throw this.fail('invalid value', start);
    if (DATE_ONLY.test(raw) && this.text[this.pos] === ' ' && TIME_START.test(this.text.slice(this.pos + 1, this.pos + 6))) {
      this.pos += 1;
      raw += ` ${this.readToken()}`;
    }
    const date = this.classifyDate(raw, start);
    if (date !== undefined) return date;
    const number = this.classifyNumber(raw);
    if (number !== undefined) return number;
    throw this.fail(`invalid value ${JSON.stringify(raw)}`, start);
  }

  readToken() {
    const start = this.pos;
    while (this.pos < this.text.length && TOKEN_CHAR.test(this.text[this.pos])) this.pos += 1;
    return this.text.slice(start, this.pos);
  }

  classifyDate(raw, start) {
    let m = DATE_OFFSET.exec(raw);
    if (m) {
      this.checkDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), start);
      if (Number(m[7]) > 23 || Number(m[8]) > 59) throw this.fail('invalid time offset', start);
      return raw;
    }
    m = DATE_LOCAL.exec(raw);
    if (m) {
      this.checkDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), start);
      return raw;
    }
    m = DATE_ONLY.exec(raw);
    if (m) {
      this.checkDate(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0, start);
      return raw;
    }
    m = TIME_ONLY.exec(raw);
    if (m) {
      this.checkDate(2000, 1, 1, Number(m[1]), Number(m[2]), Number(m[3]), start);
      return raw;
    }
    return undefined;
  }

  checkDate(year, month, day, hour, minute, second, start) {
    if (month < 1 || month > 12) throw this.fail(`invalid month ${month}`, start);
    if (day < 1 || day > daysInMonth(year, month)) throw this.fail(`invalid day ${day}`, start);
    if (hour > 23) throw this.fail(`invalid hour ${hour}`, start);
    if (minute > 59) throw this.fail(`invalid minute ${minute}`, start);
    if (second > 59) throw this.fail(`invalid second ${second}`, start);
  }

  classifyNumber(raw) {
    if (/^[+-]?inf$/.test(raw)) return raw[0] === '-' ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(raw)) return NaN;
    if (HEX_INT.test(raw)) return this.safeInteger(parseInt(raw.slice(2).replace(/_/g, ''), 16));
    if (OCT_INT.test(raw)) return this.safeInteger(parseInt(raw.slice(2).replace(/_/g, ''), 8));
    if (BIN_INT.test(raw)) return this.safeInteger(parseInt(raw.slice(2).replace(/_/g, ''), 2));
    if (DEC_INT.test(raw)) {
      const n = Number(raw.replace(/_/g, ''));
      if (!Number.isSafeInteger(n)) throw this.fail('integer is outside the safe range');
      return n === 0 ? 0 : n;
    }
    if (FLOAT.test(raw)) return Number(raw.replace(/_/g, ''));
    return undefined;
  }

  safeInteger(n) {
    if (!Number.isSafeInteger(n)) throw this.fail('integer is outside the safe range');
    return n;
  }

  parseEscape() {
    const start = this.pos;
    this.pos += 1;
    if (this.atEnd()) throw this.fail('unterminated escape', start);
    const c = this.text[this.pos];
    if (ESCAPES.has(c)) {
      this.pos += 1;
      return ESCAPES.get(c);
    }
    if (c === 'u' || c === 'U') {
      const length = c === 'u' ? 4 : 8;
      const hex = this.text.slice(this.pos + 1, this.pos + 1 + length);
      if (hex.length !== length || !/^[0-9A-Fa-f]+$/.test(hex)) throw this.fail('invalid unicode escape', start);
      const code = parseInt(hex, 16);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw this.fail('escape is not a Unicode scalar value', start);
      }
      this.pos += 1 + length;
      return String.fromCodePoint(code);
    }
    throw this.fail(`invalid escape sequence \\${c}`, start);
  }

  parseBasicString() {
    const start = this.pos;
    const startLine = this.lineAt(start);
    this.pos += 1;
    let out = '';
    for (;;) {
      if (this.atEnd()) throw new TomlError('unterminated string', startLine);
      const c = this.text[this.pos];
      if (c === '"') {
        this.pos += 1;
        return out;
      }
      if (c === '\n' || c === '\r') throw new TomlError('newline in single-line string', startLine);
      if (c === '\\') {
        out += this.parseEscape();
        continue;
      }
      if (isControl(c)) throw this.fail('control character in string', this.pos);
      out += c;
      this.pos += 1;
    }
  }

  parseLiteralString() {
    const start = this.pos;
    const startLine = this.lineAt(start);
    this.pos += 1;
    let out = '';
    for (;;) {
      if (this.atEnd()) throw new TomlError('unterminated string', startLine);
      const c = this.text[this.pos];
      if (c === "'") {
        this.pos += 1;
        return out;
      }
      if (c === '\n' || c === '\r') throw new TomlError('newline in single-line string', startLine);
      if (isControl(c)) throw this.fail('control character in string', this.pos);
      out += c;
      this.pos += 1;
    }
  }

  parseMultilineBasicString() {
    const start = this.pos;
    const startLine = this.lineAt(start);
    this.pos += 3;
    if (this.text[this.pos] === '\n') this.pos += 1;
    else if (this.text[this.pos] === '\r' && this.text[this.pos + 1] === '\n') this.pos += 2;
    let out = '';
    for (;;) {
      if (this.atEnd()) throw new TomlError('unterminated multi-line string', startLine);
      const c = this.text[this.pos];
      if (c === '"') {
        const run = this.quoteRun('"');
        if (run >= 3) {
          if (run > 5) throw this.fail('too many quotation marks in multi-line string');
          out += '"'.repeat(run - 3);
          this.pos += run;
          return out;
        }
        out += '"'.repeat(run);
        this.pos += run;
        continue;
      }
      if (c === '\\') {
        out += this.parseMultilineEscape();
        continue;
      }
      if (c === '\n') {
        out += '\n';
        this.pos += 1;
        continue;
      }
      if (c === '\r' && this.text[this.pos + 1] === '\n') {
        out += '\n';
        this.pos += 2;
        continue;
      }
      if (isControl(c)) throw this.fail('control character in string', this.pos);
      out += c;
      this.pos += 1;
    }
  }

  parseMultilineLiteralString() {
    const start = this.pos;
    const startLine = this.lineAt(start);
    this.pos += 3;
    if (this.text[this.pos] === '\n') this.pos += 1;
    else if (this.text[this.pos] === '\r' && this.text[this.pos + 1] === '\n') this.pos += 2;
    let out = '';
    for (;;) {
      if (this.atEnd()) throw new TomlError('unterminated multi-line string', startLine);
      const c = this.text[this.pos];
      if (c === "'") {
        const run = this.quoteRun("'");
        if (run >= 3) {
          if (run > 5) throw this.fail('too many quotation marks in multi-line string');
          out += "'".repeat(run - 3);
          this.pos += run;
          return out;
        }
        out += "'".repeat(run);
        this.pos += run;
        continue;
      }
      if (c === '\n') {
        out += '\n';
        this.pos += 1;
        continue;
      }
      if (c === '\r' && this.text[this.pos + 1] === '\n') {
        out += '\n';
        this.pos += 2;
        continue;
      }
      if (isControl(c)) throw this.fail('control character in string', this.pos);
      out += c;
      this.pos += 1;
    }
  }

  quoteRun(quote) {
    let n = 0;
    while (this.text[this.pos + n] === quote) n += 1;
    return n;
  }

  parseMultilineEscape() {
    const start = this.pos;
    const next = this.text[start + 1];
    if (next === '\n' || (next === '\r' && this.text[start + 2] === '\n')) {
      this.pos = start + (next === '\n' ? 2 : 3);
      this.skipEscapedWhitespace();
      return '';
    }
    if (next === ' ' || next === '\t') {
      let j = start + 1;
      while (this.text[j] === ' ' || this.text[j] === '\t') j += 1;
      if (this.text[j] !== '\n' && !(this.text[j] === '\r' && this.text[j + 1] === '\n')) {
        throw this.fail('invalid escape sequence', start);
      }
      this.pos = j + (this.text[j] === '\n' ? 1 : 2);
      this.skipEscapedWhitespace();
      return '';
    }
    return this.parseEscape();
  }

  skipEscapedWhitespace() {
    for (;;) {
      const c = this.text[this.pos];
      if (c === ' ' || c === '\t' || c === '\n') {
        this.pos += 1;
      } else if (c === '\r' && this.text[this.pos + 1] === '\n') {
        this.pos += 2;
      } else {
        return;
      }
    }
  }

  parseArray() {
    const start = this.pos;
    const startLine = this.lineAt(start);
    this.pos += 1;
    const array = [];
    for (;;) {
      this.skipArrayTrivia();
      if (this.atEnd()) throw new TomlError('unterminated array', startLine);
      if (this.peek() === ']') {
        this.pos += 1;
        return array;
      }
      array.push(this.parseValue());
      this.skipArrayTrivia();
      const c = this.peek();
      if (c === ',') {
        this.pos += 1;
        this.skipArrayTrivia();
        if (this.peek() === ']') {
          this.pos += 1;
          return array;
        }
        if (this.atEnd()) throw new TomlError('unterminated array', startLine);
        continue;
      }
      if (c === ']') {
        this.pos += 1;
        return array;
      }
      if (this.atEnd()) throw new TomlError('unterminated array', startLine);
      throw this.fail('expected , or ] in array');
    }
  }

  parseInlineTable() {
    const start = this.pos;
    const startLine = this.lineAt(start);
    this.pos += 1;
    const table = {};
    this.tableInfo.set(table, { header: false, implicit: false, dotted: false, inline: true });
    this.skipSpaces();
    if (this.peek() === '}') {
      this.pos += 1;
      return table;
    }
    for (;;) {
      const c = this.peek();
      if (c === undefined || c === '\n' || c === '\r') throw new TomlError('unterminated inline table', startLine);
      const keyStart = this.pos;
      const parts = this.parseKeyPath();
      this.skipSpaces();
      if (this.peek() !== '=') throw this.fail('expected = after key', keyStart);
      this.pos += 1;
      this.skipSpaces();
      const parent = this.resolveDottedParent(table, parts, keyStart);
      const value = this.parseValue();
      this.setKey(parent, parts[parts.length - 1], value);
      this.skipSpaces();
      const sep = this.peek();
      if (sep === ',') {
        this.pos += 1;
        this.skipSpaces();
        if (this.peek() === '}') throw this.fail('trailing comma in inline table');
        continue;
      }
      if (sep === '}') {
        this.pos += 1;
        return table;
      }
      if (sep === undefined || sep === '\n' || sep === '\r') throw new TomlError('unterminated inline table', startLine);
      throw this.fail('expected , or } in inline table');
    }
  }
}

export function parseToml(text) {
  if (typeof text !== 'string') throw new TypeError('parseToml expects a string');
  return new Parser(text).parse();
}

// YAML 1.2 reader for GitHub Actions workflow files: one document, core schema, no anchors, aliases or tags.

export class YamlError extends Error {
  constructor(message, line, col) {
    super(`line ${line}: ${message}`);
    this.name = 'YamlError';
    this.line = line;
    this.col = col;
  }
}

const FLOW_INDICATORS = ',[]{}';
const PLAIN_FORBIDDEN_START = ',[]{}#&*!|>\'"%@`';
const SIMPLE_ESCAPES = {
  0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029',
};
const HEX_ESCAPE_WIDTHS = { x: 2, u: 4, U: 8 };

const isBlankChar = (ch) => ch === ' ' || ch === '\t';
const endsToken = (ch) => ch === undefined || ch === ' ' || ch === '\t';
const endsFlowToken = (ch) => endsToken(ch) || FLOW_INDICATORS.includes(ch);
const isSpacesOnly = (line) => /^ *$/.test(line);

function resolvePlainScalar(text) {
  if (/^(?:~|[Nn]ull|NULL)?$/.test(text)) return null;
  if (/^(?:[Tt]rue|TRUE)$/.test(text)) return true;
  if (/^(?:[Ff]alse|FALSE)$/.test(text)) return false;
  if (/^0o[0-7]+$/.test(text)) return parseInt(text.slice(2), 8);
  if (/^[-+]?[0-9]+$/.test(text)) return parseInt(text, 10);
  if (/^0x[0-9a-fA-F]+$/.test(text)) return parseInt(text.slice(2), 16);
  if (/^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/.test(text)) {
    if (text.slice(-3).toLowerCase() === 'nan') return NaN;
    return text[0] === '-' ? -Infinity : Infinity;
  }
  if (/^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/.test(text)) return parseFloat(text);
  return text;
}

function scalarNode(li, ci, value, raw, source, style) {
  return { type: 'scalar', line: li + 1, col: ci + 1, value, raw, source, style };
}

const emptyScalar = (li, ci) => scalarNode(li, ci, null, '', '', 'plain');
const keyName = (key) => (key.value === null ? '' : String(key.value));

export function parseYaml(text) {
  if (typeof text !== 'string') throw new TypeError('parseYaml expects a string');
  return new Reader(text).readDocument();
}

export function toPlain(node) {
  if (node.type === 'scalar') return node.value;
  if (node.type === 'seq') return node.items.map(toPlain);
  const out = {};
  for (const { key, value } of node.entries) {
    Object.defineProperty(out, keyName(key), { value: toPlain(value), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

// GitHub's parser (the yaml package) counts a byte-order mark as a column of line 1.
function shiftFirstLineColumns(node) {
  if (node.line === 1) node.col++;
  if (node.type === 'seq') node.items.forEach(shiftFirstLineColumns);
  if (node.type === 'map') {
    for (const { key, value } of node.entries) {
      shiftFirstLineColumns(key);
      shiftFirstLineColumns(value);
    }
  }
}

class Reader {
  constructor(text) {
    this.bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    this.text = text.slice(this.bom).replace(/\r\n/g, '\n');
    this.lines = this.text.split('\n');
    this.starts = [];
    let offset = 0;
    for (const line of this.lines) {
      this.starts.push(offset);
      offset += line.length + 1;
    }
  }

  fail(message, li, ci) {
    throw new YamlError(message, li + 1, ci + 1 + (li === 0 ? this.bom : 0));
  }

  indentOf(li) {
    const line = this.lines[li];
    let i = 0;
    while (line[i] === ' ') i++;
    return i;
  }

  skipBlanks(li, ci) {
    const line = this.lines[li];
    while (isBlankChar(line[ci])) ci++;
    return ci;
  }

  isEmptyLine(li) {
    const ch = this.lines[li][this.skipBlanks(li, 0)];
    return ch === undefined || ch === '#';
  }

  isDocumentMarker(li) {
    const line = this.lines[li];
    return (line.startsWith('---') || line.startsWith('...')) && endsToken(line[3]);
  }

  isSeqItem(li, ci) {
    const line = this.lines[li];
    return line[ci] === '-' && endsToken(line[ci + 1]);
  }

  nextContentLine(li) {
    while (li < this.lines.length && this.isEmptyLine(li)) li++;
    return li;
  }

  // Indentation of a line that opens block structure; -1 at end of input or a document marker.
  lineIndent(li) {
    if (li >= this.lines.length || this.isDocumentMarker(li)) return -1;
    const indent = this.indentOf(li);
    if (this.lines[li][indent] === '\t') this.fail('tab used for indentation', li, indent);
    return indent;
  }

  // A whitespace-only line whose tab sits where indentation is still required.
  refuseTabBlank(li, indent) {
    const line = this.lines[li];
    const spaces = this.indentOf(li);
    if (spaces <= indent && /^[ \t]*$/.test(line) && line.includes('\t')) this.fail('tab used for indentation', li, spaces);
  }

  failIndentation(li, ci) {
    this.refuseProperty(li, ci, false);
    this.fail('indentation does not match any open collection', li, ci);
  }

  finishLine(li, ci) {
    const line = this.lines[li];
    const j = this.skipBlanks(li, ci);
    if (j < line.length && !(line[j] === '#' && j > ci)) {
      this.fail(line[j] === '#' ? 'a comment must be separated by whitespace' : `unexpected text '${line.slice(j, j + 20)}' after a value`, li, j);
    }
    return li + 1;
  }

  refuseProperty(li, ci, inFlow) {
    const line = this.lines[li];
    const ch = line[ci];
    const property = { '&': 'anchors', '*': 'aliases', '!': 'tags' }[ch];
    if (property) this.fail(`${property} are not supported ('${line.slice(ci).split(/[\s,\]}]/)[0]}')`, li, ci);
    if (ch === '?' && (inFlow ? endsFlowToken(line[ci + 1]) : endsToken(line[ci + 1]))) {
      this.fail("complex mapping keys ('? ') are not supported", li, ci);
    }
    if (ch === ':' && (inFlow ? endsFlowToken(line[ci + 1]) : endsToken(line[ci + 1]))) {
      this.fail("empty mapping keys (': value') are not supported", li, ci);
    }
    if (ch === '@' || ch === '`') this.fail(`reserved indicator '${ch}' cannot start a plain scalar`, li, ci);
  }

  canStartPlain(line, ci, inFlow) {
    const ch = line[ci];
    if (ch === undefined) return false;
    if (ch === '-' || ch === '?' || ch === ':') return inFlow ? !endsFlowToken(line[ci + 1]) : !endsToken(line[ci + 1]);
    return !PLAIN_FORBIDDEN_START.includes(ch);
  }

  readDocument() {
    const n = this.lines.length;
    let li = 0;
    let directive = -1;
    for (; li < n; li++) {
      if (this.isEmptyLine(li)) continue;
      const line = this.lines[li];
      if (line[0] !== '%') break;
      if (/^%YAML[ \t]+1\.2(?:[ \t]|$)/.test(line)) directive = li;
      else if (line.startsWith('%YAML')) this.fail(`only YAML 1.2 is supported ('${line.trim()}')`, li, 0);
      else if (/^%TAG(?:[ \t]|$)/.test(line)) this.fail('tags are not supported (%TAG directive)', li, 0);
      else this.fail(`directive '${line.split(/[ \t]/)[0]}' is not supported`, li, 0);
    }
    if (this.bom && li === 0 && isBlankChar(this.lines[0][0])) this.fail('indentation after a byte-order mark is not supported', 0, 0);
    if (this.bom && li === 0 && this.isSeqItem(0, 0)) this.fail('a block sequence directly after a byte-order mark is not supported', 0, 0);
    let root;
    let next;
    if (li < n && this.lines[li].startsWith('---') && endsToken(this.lines[li][3])) {
      [root, next] = this.readValue(li, 3, -1, 'doc');
    } else {
      if (directive >= 0) this.fail("a %YAML directive must be followed by '---'", directive, 0);
      [root, next] = this.readBelow(li, -1, 'root', li, 0);
    }
    if (root.type === 'scalar' && root.source === '' && root.style === 'plain') {
      root = { type: 'scalar', line: 0, col: 0, value: null, raw: '', source: '', style: 'plain' };
    }
    let end = this.nextContentLine(next);
    if (end < n && this.lines[end].startsWith('...') && endsToken(this.lines[end][3])) {
      this.finishLine(end, 3);
      end = this.nextContentLine(end + 1);
      if (end < n) this.fail('a second document is not supported', end, 0);
    } else if (end < n) {
      if (this.isDocumentMarker(end)) this.fail("a second document ('---') is not supported", end, 0);
      this.failIndentation(end, this.indentOf(end));
    }
    if (this.bom) shiftFirstLineColumns(root);
    return root;
  }

  readValue(li, ci, indent, ctx) {
    const line = this.lines[li];
    const c = this.skipBlanks(li, ci);
    if (line[c] !== undefined && line[c] !== '#') return this.readNodeAt(li, c, indent, ctx, line.slice(ci, c).includes('\t') ? 'tab' : 'inline');
    return this.readBelow(li + 1, indent, ctx, li, c);
  }

  readBelow(from, indent, ctx, li, ci) {
    const next = this.nextContentLine(from);
    if (next < this.lines.length && !this.isDocumentMarker(next)) {
      const spaces = this.indentOf(next);
      if (this.lines[next][spaces] === '\t' && spaces > indent && spaces > 0) {
        return this.readNodeAt(next, this.skipBlanks(next, spaces), indent, ctx, 'tab');
      }
    }
    const m = this.lineIndent(next);
    if (m > indent) return this.readNodeAt(next, m, indent, ctx, 'below');
    if (m === indent && ctx === 'map' && this.isSeqItem(next, m)) return this.readSeq(next, m);
    const n = this.lines.length;
    if (ctx === 'map' && next < n && from < next && m === indent) this.refuseTabBlank(from, indent);
    if (ctx !== 'root' && next === n && from < n) this.refuseTabBlank(n - 1, Math.max(indent, 0));
    return [emptyScalar(li, ci), next];
  }

  // mode: 'below' (first on its line), 'inline' (after an indicator), 'tab' (after a tab, which cannot indent a collection).
  readNodeAt(li, c, indent, ctx, mode) {
    const sameLine = mode !== 'below' && ctx !== 'seq';
    if (this.isSeqItem(li, c)) {
      if (mode === 'tab') this.fail('tab used for indentation', li, c);
      if (sameLine) this.fail('a block sequence cannot start on the same line as its key', li, c);
      return this.readSeq(li, c);
    }
    const probe = this.probeKey(li, c, indent);
    if (probe.key) {
      if (mode === 'tab') this.fail('tab used for indentation', li, c);
      if (sameLine) this.fail('a block mapping cannot start on the same line as its key', li, c);
      return this.readMap(li, c, probe);
    }
    if (probe.node) return [probe.node, probe.next];
    const ch = this.lines[li][c];
    if (ch === '|' || ch === '>') return this.readBlockScalar(li, c, indent);
    if (!this.canStartPlain(this.lines[li], c, false)) this.fail(`unexpected character '${ch}'`, li, c);
    return this.readPlain(li, c, indent);
  }

  probeKey(li, c, indent) {
    const line = this.lines[li];
    const ch = line[c];
    this.refuseProperty(li, c, false);
    if (ch === '"' || ch === "'" || ch === '[' || ch === '{') {
      const [node, endLi, endCi] = ch === '[' || ch === '{' ? this.readFlow(li, c, indent) : this.readQuoted(li, c, indent);
      const after = this.lines[endLi];
      const j = this.skipBlanks(endLi, endCi);
      if (after[j] === ':' && endsToken(after[j + 1])) {
        if (node.type !== 'scalar') this.fail('complex mapping keys (collections as keys) are not supported', li, c);
        if (endLi !== li) this.fail('a mapping key must be on a single line', li, c);
        return { key: node, li, valueCol: j + 1 };
      }
      return { node, next: this.finishLine(endLi, endCi) };
    }
    if (!this.canStartPlain(line, c, false)) return {};
    let j = c;
    while (j < line.length && !(line[j] === ':' && endsToken(line[j + 1]))) {
      if (line[j] === '#' && isBlankChar(line[j - 1])) return {};
      j++;
    }
    if (j >= line.length) return {};
    const raw = line.slice(c, j).replace(/[ \t]+$/, '');
    if (raw === '<<') this.fail("merge keys ('<<') are not supported", li, c);
    return { key: scalarNode(li, c, resolvePlainScalar(raw), raw, raw, 'plain'), li, valueCol: j + 1 };
  }

  readMap(li, c, first) {
    const map = { type: 'map', line: li + 1, col: c + 1, entries: [] };
    const seen = new Set();
    let probe = first;
    for (;;) {
      const { key } = probe;
      if (seen.has(keyName(key))) this.fail(`duplicate key '${keyName(key)}'`, key.line - 1, key.col - 1);
      seen.add(keyName(key));
      const [value, next] = this.readValue(probe.li, probe.valueCol, c, 'map');
      map.entries.push({ key, value });
      const line = this.nextContentLine(next);
      const m = this.lineIndent(line);
      if (m < c) return [map, line];
      if (m > c) this.failIndentation(line, m);
      if (this.isSeqItem(line, m)) this.fail('a sequence item where a mapping key was expected', line, m);
      probe = this.probeKey(line, m, c);
      if (!probe.key) this.fail('expected a mapping key', line, m);
    }
  }

  readSeq(li, c) {
    const seq = { type: 'seq', line: li + 1, col: c + 1, items: [] };
    for (;;) {
      const [item, next] = this.readValue(li, c + 1, c, 'seq');
      seq.items.push(item);
      const line = this.nextContentLine(next);
      const m = this.lineIndent(line);
      if (m < c) return [seq, line];
      if (m > c) this.failIndentation(line, m);
      if (!this.isSeqItem(line, m)) return [seq, line];
      li = line;
    }
  }

  plainLineEnd(li, k, inFlow) {
    const line = this.lines[li];
    let j = k;
    let stop = 'eol';
    for (; j < line.length; j++) {
      const ch = line[j];
      if (ch === ':' && (inFlow ? endsFlowToken(line[j + 1]) : endsToken(line[j + 1]))) { stop = 'indicator'; break; }
      if (ch === '#' && isBlankChar(line[j - 1])) { stop = 'comment'; break; }
      if (inFlow && FLOW_INDICATORS.includes(ch)) { stop = 'indicator'; break; }
    }
    while (j > k && isBlankChar(line[j - 1])) j--;
    return [j, stop];
  }

  readPlain(li, c, indent) {
    const [firstEnd, firstStop] = this.plainLineEnd(li, c, false);
    let folded = this.lines[li].slice(c, firstEnd);
    let lastLi = li;
    let lastEnd = firstEnd;
    let empties = 0;
    let firstEmpty = -1;
    for (let i = li + 1; firstStop === 'eol' && i < this.lines.length; i++) {
      const line = this.lines[i];
      const k = this.skipBlanks(i, 0);
      if (k === line.length) {
        if (!empties) firstEmpty = i;
        empties++;
        continue;
      }
      if (line[k] === '#' || this.isDocumentMarker(i)) break;
      const m = this.indentOf(i);
      if (m <= indent) {
        if (line[m] === '\t') this.fail('tab used for indentation', i, m);
        break;
      }
      const [end, stop] = this.plainLineEnd(i, k, false);
      if (stop === 'indicator') {
        this.refuseProperty(i, k, false);
        this.fail('a mapping key inside a multi-line plain scalar', i, k);
      }
      for (let e = firstEmpty; empties && e < i; e++) this.refuseTabBlank(e, indent);
      folded += (empties ? '\n'.repeat(empties) : ' ') + line.slice(k, end);
      empties = 0;
      lastLi = i;
      lastEnd = end;
      if (stop === 'comment') break;
    }
    const source = this.text.slice(this.starts[li] + c, this.starts[lastLi] + lastEnd);
    return [scalarNode(li, c, resolvePlainScalar(folded), folded, source, 'plain'), lastLi + 1];
  }

  // flowDepth > 0: inside a flow collection, where comment lines are free and the outermost closer may sit at the parent's indent.
  checkContinuation(li, indent, openLi, openCi, what, flowDepth, hint = '') {
    if (li >= this.lines.length || this.isDocumentMarker(li)) this.fail(`unterminated ${what}`, openLi, openCi);
    const line = this.lines[li];
    const k = this.skipBlanks(li, 0);
    if (k === line.length || (line[k] === '#' && flowDepth)) return;
    const m = this.indentOf(li);
    if (m > indent || (m === indent && flowDepth === 1 && (line[k] === ']' || line[k] === '}'))) return;
    if (line[m] === '\t') this.fail('tab used for indentation', li, m);
    this.fail(`${what} continues on a line not indented past its parent${hint}`, li, m);
  }

  readQuoted(li, c, indent) {
    const { text } = this;
    const start = this.starts[li] + c;
    const quote = text[start];
    const what = quote === '"' ? 'double-quoted scalar' : 'single-quoted scalar';
    let lineIdx = li;
    let out = '';
    let p = start + 1;
    for (;;) {
      if (p >= text.length) this.fail(`unterminated ${what}`, li, c);
      const ch = text[p];
      if (ch === quote) {
        if (quote === "'" && text[p + 1] === "'") { out += "'"; p += 2; continue; }
        break;
      }
      if (ch === '\\' && quote === '"') {
        const esc = text[p + 1];
        if (esc === '\n') {
          lineIdx++;
          this.checkContinuation(lineIdx, indent, li, c, what, 0);
          this.refuseTabBlank(lineIdx, indent);
          p += 2;
          while (isBlankChar(text[p])) p++;
          continue;
        }
        if (Object.hasOwn(SIMPLE_ESCAPES, esc)) { out += SIMPLE_ESCAPES[esc]; p += 2; continue; }
        const width = HEX_ESCAPE_WIDTHS[esc];
        const hex = width ? text.slice(p + 2, p + 2 + width) : '';
        const code = hex.length === width && /^[0-9a-fA-F]+$/.test(hex) ? parseInt(hex, 16) : -1;
        if (code < 0 || code > 0x10ffff) this.fail(`invalid escape '\\${text.slice(p + 1, p + 2 + (width || 0))}' in a double-quoted scalar`, lineIdx, p - this.starts[lineIdx]);
        out += String.fromCodePoint(code);
        p += 2 + width;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        let q = p;
        while (isBlankChar(text[q])) q++;
        if (text[q] !== '\n') { out += text.slice(p, q); p = q; continue; }
        let breaks = 0;
        while (text[q] === '\n') {
          breaks++;
          q++;
          lineIdx++;
          this.checkContinuation(lineIdx, indent, li, c, what, 0, text[p - 1] === "'" && quote === "'" ? " ('' is an escaped quote)" : '');
          this.refuseTabBlank(lineIdx, indent);
          while (isBlankChar(text[q])) q++;
        }
        out += breaks > 1 ? '\n'.repeat(breaks - 1) : ' ';
        p = q;
        continue;
      }
      out += ch;
      p++;
    }
    const node = scalarNode(li, c, out, out, text.slice(start, p + 1), quote === '"' ? 'double' : 'single');
    return [node, lineIdx, p + 1 - this.starts[lineIdx]];
  }

  readFlow(li, c, indent) {
    const cursor = { li, ci: c, indent, depth: 0 };
    const node = this.flowNode(cursor);
    return [node, cursor.li, cursor.ci];
  }

  flowSkip(cursor, openLi, openCi) {
    for (;;) {
      const line = this.lines[cursor.li];
      cursor.ci = this.skipBlanks(cursor.li, cursor.ci);
      const ch = line[cursor.ci];
      if (ch !== undefined && !(ch === '#' && (cursor.ci === 0 || isBlankChar(line[cursor.ci - 1])))) return ch;
      cursor.li++;
      cursor.ci = 0;
      this.checkContinuation(cursor.li, cursor.indent, openLi, openCi, 'flow collection', cursor.depth);
    }
  }

  flowNode(cursor) {
    const line = this.lines[cursor.li];
    const ch = line[cursor.ci];
    this.refuseProperty(cursor.li, cursor.ci, true);
    if (ch === '[' || ch === '{') return this.flowCollection(cursor, ch);
    if (ch === '"' || ch === "'") {
      const [node, endLi, endCi] = this.readQuoted(cursor.li, cursor.ci, cursor.indent);
      cursor.li = endLi;
      cursor.ci = endCi;
      return node;
    }
    if (!this.canStartPlain(line, cursor.ci, true)) this.fail(`unexpected '${ch}' in a flow collection`, cursor.li, cursor.ci);
    return this.flowPlain(cursor);
  }

  flowPlain(cursor) {
    const startLi = cursor.li;
    const startCi = cursor.ci;
    let [lastEnd, stop] = this.plainLineEnd(startLi, startCi, true);
    let folded = this.lines[startLi].slice(startCi, lastEnd);
    let lastLi = startLi;
    let empties = 0;
    for (let i = startLi + 1; stop === 'eol' && i < this.lines.length; i++) {
      const line = this.lines[i];
      const k = this.skipBlanks(i, 0);
      if (k === line.length && line.includes('\t') && this.indentOf(i) <= cursor.indent) break;
      if (k === line.length) { empties++; continue; }
      if (line[k] === '#' || this.isDocumentMarker(i) || FLOW_INDICATORS.includes(line[k])) break;
      if (line[k] === ':' && endsFlowToken(line[k + 1])) break;
      this.checkContinuation(i, cursor.indent, startLi, startCi, 'flow collection', cursor.depth);
      const [end, lineStop] = this.plainLineEnd(i, k, true);
      folded += (empties ? '\n'.repeat(empties) : ' ') + line.slice(k, end);
      empties = 0;
      lastLi = i;
      lastEnd = end;
      stop = lineStop;
    }
    cursor.li = lastLi;
    cursor.ci = lastEnd;
    const source = this.text.slice(this.starts[startLi] + startCi, this.starts[lastLi] + lastEnd);
    return scalarNode(startLi, startCi, resolvePlainScalar(folded), folded, source, 'plain');
  }

  flowCollection(cursor, open) {
    const openLi = cursor.li;
    const openCi = cursor.ci;
    const isMap = open === '{';
    const close = isMap ? '}' : ']';
    const kind = isMap ? 'flow mapping' : 'flow sequence';
    const node = isMap
      ? { type: 'map', line: openLi + 1, col: openCi + 1, entries: [] }
      : { type: 'seq', line: openLi + 1, col: openCi + 1, items: [] };
    const seen = new Set();
    cursor.ci++;
    cursor.depth++;
    for (;;) {
      let ch = this.flowSkip(cursor, openLi, openCi);
      if (ch === close) { cursor.ci++; cursor.depth--; return node; }
      if (ch === ',') this.fail(`empty entry in a ${kind}`, cursor.li, cursor.ci);
      const keyLi = cursor.li;
      let item = this.flowNode(cursor);
      let emptyAt = [cursor.li, cursor.ci];
      ch = this.flowSkip(cursor, openLi, openCi);
      let value = null;
      const plainKey = item.type === 'scalar' && item.style === 'plain';
      if (ch === ':' && (!plainKey || endsFlowToken(this.lines[cursor.li][cursor.ci + 1]))) {
        if (item.type !== 'scalar') this.fail('complex mapping keys (collections as keys) are not supported', item.line - 1, item.col - 1);
        if (!isMap && cursor.li !== keyLi) this.fail('a flow pair key must be on a single line', item.line - 1, item.col - 1);
        cursor.ci++;
        emptyAt = [cursor.li, this.skipBlanks(cursor.li, cursor.ci)];
        ch = this.flowSkip(cursor, openLi, openCi);
        value = ch === ',' || ch === close ? emptyScalar(...emptyAt) : this.flowNode(cursor);
        ch = this.flowSkip(cursor, openLi, openCi);
      }
      if (isMap) {
        if (item.type !== 'scalar') this.fail('complex mapping keys (collections as keys) are not supported', item.line - 1, item.col - 1);
        if (seen.has(keyName(item))) this.fail(`duplicate key '${keyName(item)}'`, item.line - 1, item.col - 1);
        seen.add(keyName(item));
        node.entries.push({ key: item, value: value ?? emptyScalar(...emptyAt) });
      } else {
        if (value) item = { type: 'map', line: item.line, col: item.col, entries: [{ key: item, value }] };
        node.items.push(item);
      }
      if (ch === ',') { cursor.ci++; continue; }
      if (ch === close) { cursor.ci++; cursor.depth--; return node; }
      this.fail(`expected ',' or '${close}' in a ${kind}`, cursor.li, cursor.ci);
    }
  }

  readBlockScalar(li, c, indent) {
    const header = this.lines[li];
    let h = c + 1;
    let chomp = '';
    let explicit = 0;
    for (; h < header.length && !isBlankChar(header[h]) && header[h] !== '#'; h++) {
      const ch = header[h];
      if ((ch === '-' || ch === '+') && !chomp) chomp = ch;
      else if (ch >= '1' && ch <= '9' && !explicit) explicit = Number(ch);
      else this.fail(`invalid block scalar header '${header.slice(c).split(/[ \t#]/)[0]}'`, li, h);
    }
    if (header[h] === '#') this.fail('a comment must be separated from a block scalar header by whitespace', li, h);
    this.finishLine(li, h);
    const n = this.lines.length;
    let first = li + 1;
    while (first < n && isSpacesOnly(this.lines[first])) first++;
    const firstIndent = first < n ? this.indentOf(first) : (li + 1 < n ? this.lines[n - 1].length : 0);
    let end = first;
    let contentIndent = Infinity;
    if (first < n && firstIndent > indent && !(firstIndent === 0 && this.isDocumentMarker(first))) {
      contentIndent = explicit ? Math.max(indent, 0) + explicit : firstIndent;
      for (; end < n; end++) {
        if (isSpacesOnly(this.lines[end])) continue;
        if (this.indentOf(end) < contentIndent || (contentIndent === 0 && this.isDocumentMarker(end))) break;
      }
    }
    if (end < n && this.lines[end][this.indentOf(end)] === '\t') this.fail('tab used for indentation', end, this.indentOf(end));
    let sourceEnd = end;
    const finalLine = this.lines[n - 1];
    if (end === n && n - 1 > li && !this.text.endsWith('\n') && isSpacesOnly(finalLine)) {
      const required = first < n ? contentIndent : explicit ? Math.max(indent, 0) + explicit : indent + 1;
      if (finalLine.length < required) sourceEnd = n - 1;
    }
    if (chomp !== '+') {
      while (sourceEnd - 1 > li + 1 && isSpacesOnly(this.lines[sourceEnd - 1]) && this.lines[sourceEnd - 1].length <= firstIndent) sourceEnd--;
    }
    const from = li + 1 < n ? this.starts[li + 1] : this.text.length;
    const source = this.text.slice(from, sourceEnd < n ? this.starts[sourceEnd] : this.text.length);
    const value = this.foldBlock(source, header[c], chomp, explicit, Math.max(indent, 0), li);
    return [scalarNode(li, c, value, value, source, header[c] === '|' ? 'literal' : 'folded'), end];
  }

  foldBlock(source, mode, chomp, explicit, baseIndent, li) {
    const parts = source.split(/\n( *)/);
    const leading = parts[0].match(/^ */)[0];
    const lines = [[leading, parts[0].slice(leading.length)]];
    for (let i = 1; i < parts.length; i += 2) lines.push([parts[i], parts[i + 1]]);
    let chompStart = lines.length;
    while (chompStart > 0 && lines[chompStart - 1][1] === '') chompStart--;
    if (chompStart === 0) return chomp === '+' && source ? '\n'.repeat(Math.max(1, lines.length - 1)) : '';
    let trimIndent = baseIndent + explicit;
    let contentStart = 0;
    for (let i = 0; i < chompStart; i++) {
      const [lead, content] = lines[i];
      if (content === '') {
        if (!explicit && lead.length > trimIndent) trimIndent = lead.length;
        continue;
      }
      if (lead.length < trimIndent) this.fail('a block scalar with more-indented leading empty lines needs an indentation indicator', li, 0);
      if (!explicit) trimIndent = lead.length;
      contentStart = i;
      break;
    }
    for (let i = lines.length - 1; i >= chompStart; i--) if (lines[i][0].length > trimIndent) chompStart = i + 1;
    let value = '';
    let sep = '';
    let prevMoreIndented = false;
    for (let i = 0; i < contentStart; i++) value += lines[i][0].slice(trimIndent) + '\n';
    for (let i = contentStart; i < chompStart; i++) {
      const [lead, content] = lines[i];
      if (mode === '|') {
        value += sep + lead.slice(trimIndent) + content;
        sep = '\n';
      } else if (lead.length > trimIndent || content[0] === '\t') {
        if (sep === ' ') sep = '\n';
        else if (!prevMoreIndented && sep === '\n') sep = '\n\n';
        value += sep + lead.slice(trimIndent) + content;
        sep = '\n';
        prevMoreIndented = true;
      } else if (content === '') {
        if (sep === '\n') value += '\n';
        else sep = '\n';
      } else {
        value += sep + content;
        sep = ' ';
        prevMoreIndented = false;
      }
    }
    if (chomp === '+') {
      for (let i = chompStart; i < lines.length; i++) value += '\n' + lines[i][0].slice(trimIndent);
      if (!value.endsWith('\n')) value += '\n';
    } else if (chomp === '') {
      value += '\n';
    }
    return value;
  }
}

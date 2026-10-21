// The remediation register as editable Markdown, and back.
//
// monitor/failure-taxonomy.json stays the source of truth: bin/taxonomy-render.mjs, bin/taxonomy-db.mjs
// and the schema read `remediations` and `attributionPlan` from it. The docsite editor edits the
// Markdown that toMarkdown() derives; a save parses it with fromMarkdown() and applyToRegistry()
// writes the two arrays back. Markdown is never stored as a second truth.
//
// Every field is one line, `- **Label:** value`. The register's values carry no newlines, and a
// format that needs no escaping is one a person can edit without corrupting it.

const ACTION_FIELDS = [
  ['status', 'Status', 'string'], ['layer', 'Layer', 'string'], ['closes', 'Closes', 'list'],
  ['raises', 'Raises', 'list'], ['effort', 'Effort', 'string'], ['gain', 'Gain', 'number'],
  ['action', 'Action', 'string'], ['note', 'Note', 'string'], ['risk', 'Risk', 'string'],
  ['evidenceFrom', 'Evidence from', 'string'],
];
const SURFACE_FIELDS = [
  ['status', 'Status', 'string'], ['defect', 'Defect', 'string'], ['mechanism', 'Mechanism', 'string'],
  ['change', 'Change', 'string'], ['closes', 'Closes', 'list'], ['effort', 'Effort', 'string'],
];
const STATUS_WORDS = /^(DONE|PARTIAL|OPEN|SUPERSEDED|WRONG)\b/i;
// An empty status is displayed as this word, never as whitespace, and reads back as empty.
const UNASSESSED = 'UNASSESSED';
const SECTION_ACTIONS = 'Ranked actions';
const SECTION_SURFACES = 'Attribution surfaces';

export class RegisterFormatError extends Error {}
const fail = (msg) => { throw new RegisterFormatError(msg); };

/**
 * The status word an item leads with. Parsed from the FRONT of the free-text field; anything
 * unrecognised is UNASSESSED rather than guessed at, because inferring "probably done" from prose
 * is how a register starts lying.
 */
export function statusOf(item) {
  const raw = String(item?.status || '').trim();
  if (!raw) return { word: UNASSESSED, kind: 'unassessed', detail: '' };
  const m = raw.match(STATUS_WORDS);
  if (!m) return { word: UNASSESSED, kind: 'unassessed', detail: raw };
  const word = m[1].toUpperCase();
  return { word, kind: word.toLowerCase(), detail: raw.slice(m[1].length).replace(/^[\s—-]+/, '') };
}

/** Counts by status word, including the unassessed: a total that hides its own gaps is not a total. */
export function tally(items) {
  const t = { DONE: 0, PARTIAL: 0, OPEN: 0, SUPERSEDED: 0, WRONG: 0, UNASSESSED: 0 };
  for (const i of items) t[statusOf(i).word] += 1;
  return t;
}

const oneLine = (where, label, s) => {
  if (/[\r\n]/.test(s)) fail(`${where}: ${label} contains a line break, which this format cannot hold`);
  if (s !== s.trim()) fail(`${where}: ${label} has leading or trailing whitespace, which would not survive a save`);
  return s;
};

function encodeValue(where, [key, label, type], v) {
  if (type === 'list') {
    if (!Array.isArray(v)) fail(`${where}: ${label} is not a list`);
    for (const x of v) {
      if (typeof x !== 'string' || !x || /,/.test(x) || x.toLowerCase() === 'none') fail(`${where}: ${label} entry ${JSON.stringify(x)} cannot be written as a comma list`);
      oneLine(where, label, x);
    }
    return v.length ? v.join(', ') : 'none';
  }
  if (type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${where}: ${label} is not a number`);
    return String(v);
  }
  if (typeof v !== 'string') fail(`${where}: ${label} is not text`);
  if (key === 'status' && v === UNASSESSED) fail(`${where}: a stored status of exactly ${UNASSESSED} would read back as empty`);
  oneLine(where, label, v);
  return key === 'status' && !v ? UNASSESSED : v;
}

function decodeValue(where, [key, label, type], raw) {
  const v = raw.trim();
  if (type === 'list') return v === '' || v.toLowerCase() === 'none' ? [] : v.split(/\s*,\s*/).filter(Boolean);
  if (type === 'number') {
    if (!/^-?\d+(\.\d+)?$/.test(v)) fail(`${where}: ${label} must be a number, found ${JSON.stringify(v)}`);
    return Number(v);
  }
  return key === 'status' && v === UNASSESSED ? '' : v;
}

function itemLines(where, item, idKeys, fields) {
  const known = new Set([...idKeys, ...fields.map(([k]) => k)]);
  for (const k of Object.keys(item)) if (!known.has(k)) fail(`${where}: field '${k}' has no line in the editable register; add it to lib/remediation-md.mjs before it can be edited`);
  const out = [];
  for (const f of fields) {
    if (f[0] === 'status' || f[0] in item) out.push(`- **${f[1]}:** ${encodeValue(where, f, item[f[0]] ?? '')}`.trimEnd());
  }
  return out;
}

export function toMarkdown(registry) {
  const actions = registry.remediations || [];
  const surfaces = registry.attributionPlan || [];
  const t = tally(actions);
  const counts = Object.entries(t).filter(([, n]) => n > 0).map(([w, n]) => `${w} ${n}`).join(' · ') || 'none';
  const L = [
    '# Remediation register',
    '',
    '<!-- Generated from monitor/failure-taxonomy.json by lib/remediation-md.mjs. Edit it in the docsite editor, which writes the entries back to the registry. -->',
    '',
    `The ${actions.length} ranked actions and ${surfaces.length} attribution surfaces from the failure taxonomy, with the status of each. Status leads because the taxonomy page never rendered it: an item could read DONE in the registry while the defect it named was still firing, and no reader could see either.`,
    '',
    `**Status count:** ${counts}`,
    '',
  ];
  if (t.UNASSESSED) L.push(`**${t.UNASSESSED} of ${actions.length}** carry no recognised status and read as ${UNASSESSED}, never as blank: an unchecked item is not a finished one.`, '');
  L.push(`**Editing:** change any line below and save. Keep each field on one line. A status starts with DONE, PARTIAL, OPEN, SUPERSEDED or WRONG; anything else counts as ${UNASSESSED}. Everything above "${SECTION_ACTIONS}" is regenerated on save.`, '');
  L.push(`## ${SECTION_ACTIONS}`, '');
  for (const a of actions) {
    const where = `action ${a.rank}`;
    if (!Number.isInteger(a.rank)) fail(`${where}: rank is not an integer`);
    L.push(`### Action ${a.rank}: ${oneLine(where, 'Title', String(a.title ?? ''))}`, '', ...itemLines(where, a, ['rank', 'title'], ACTION_FIELDS), '');
  }
  L.push(`## ${SECTION_SURFACES}`, '');
  for (const s of surfaces) {
    const where = `surface ${s.area}`;
    L.push(`### Surface: ${oneLine(where, 'Area', String(s.area ?? ''))}`, '', ...itemLines(where, s, ['area'], SURFACE_FIELDS), '');
  }
  return `${L.join('\n').replace(/\n+$/, '')}\n`;
}

const FIELD_LINE = /^[-*]\s+(?:\*\*)?([A-Za-z][A-Za-z ]*?)(?::\*\*|\*\*:|:)(?:\s(.*))?$/;

/** Parses the two editable sections. Throws RegisterFormatError naming the line on anything it cannot place. */
export function fromMarkdown(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = { remediations: [], attributionPlan: [] };
  let section = null, item = null, fields = null, lastKey = null;
  const seen = new Set();
  const close = () => { item = null; fields = null; lastKey = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const at = `line ${i + 1}`;
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2 && !line.startsWith('###')) {
      close();
      // An unknown heading fails even above the first section: a misspelt "## Ranked actions" would
      // otherwise leave every action in the intro, unread, and the save would write none.
      if (h2[1] === SECTION_ACTIONS) section = 'remediations';
      else if (h2[1] === SECTION_SURFACES) section = 'attributionPlan';
      else fail(`${at}: unknown section "${h2[1]}"; only "${SECTION_ACTIONS}" and "${SECTION_SURFACES}" are editable`);
      if (seen.has(section)) fail(`${at}: "${h2[1]}" appears twice`);
      seen.add(section);
      continue;
    }
    if (!section) {
      if (/^###\s/.test(line)) fail(`${at}: an entry above the "## ${SECTION_ACTIONS}" heading`);
      continue; // the intro is regenerated, so nothing above the first section is read
    }
    if (/^###\s/.test(line)) {
      close();
      if (section === 'remediations') {
        const m = line.match(/^###\s+Action\s+(\d+)\s*:\s*(.*?)\s*$/);
        if (!m) fail(`${at}: an action heading reads "### Action <number>: <title>"`);
        item = { rank: Number(m[1]), title: m[2] };
        fields = ACTION_FIELDS;
      } else {
        const m = line.match(/^###\s+Surface\s*:\s*(.*?)\s*$/);
        if (!m || !m[1]) fail(`${at}: a surface heading reads "### Surface: <area>"`);
        item = { area: m[1] };
        fields = SURFACE_FIELDS;
      }
      out[section].push(item);
      continue;
    }
    if (!line.trim() || /^<!--.*-->\s*$/.test(line.trim())) continue;
    if (!item) fail(`${at}: text before the first entry of "${section === 'remediations' ? SECTION_ACTIONS : SECTION_SURFACES}"`);
    const fm = line.match(FIELD_LINE);
    if (fm) {
      const f = fields.find(([, label]) => label.toLowerCase() === fm[1].trim().toLowerCase());
      if (!f) fail(`${at}: unknown field "${fm[1].trim()}"; this entry takes ${fields.map(([, l]) => l).join(', ')}`);
      if (f[0] in item) fail(`${at}: ${f[1]} appears twice in one entry`);
      item[f[0]] = decodeValue(at, f, fm[2] ?? '');
      lastKey = f;
      continue;
    }
    if (!lastKey) fail(`${at}: text that is not a "- **Field:** value" line`);
    // A wrapped line continues the field above it.
    const f = lastKey;
    if (f[2] !== 'string') fail(`${at}: ${f[1]} must stay on one line`);
    item[f[0]] = `${item[f[0]]} ${line.trim()}`.trim();
  }
  if (!seen.has('remediations')) fail(`no "## ${SECTION_ACTIONS}" section found`);
  if (!seen.has('attributionPlan')) fail(`no "## ${SECTION_SURFACES}" section found`);
  return out;
}

function ordered(prev, next, template) {
  const order = prev ? Object.keys(prev) : template;
  const o = {};
  for (const k of order) if (k in next) o[k] = next[k];
  for (const k of Object.keys(next)) if (!(k in o)) o[k] = next[k];
  return o;
}

function mergeList(kind, prevList, nextList, idOf, fieldsOf) {
  const prevBy = new Map(prevList.map((p) => [idOf(p), p]));
  const seen = new Set();
  const template = prevList[0] ? Object.keys(prevList[0]) : [];
  return nextList.map((n) => {
    const id = idOf(n);
    if (seen.has(id)) fail(`${kind} ${id} appears twice`);
    seen.add(id);
    const prev = prevBy.get(id);
    const next = { ...n };
    if (prev) {
      for (const [k, label] of fieldsOf) {
        if (k in prev && !(k in next)) fail(`${kind} ${id}: the ${label} line is missing; keep the line, empty, to clear the field`);
        if (k in next && next[k] === '' && !(k in prev)) delete next[k];
      }
    }
    return ordered(prev, next, template);
  });
}

/** The registry with its two editable arrays replaced; every other key, and its position, untouched. */
export function applyToRegistry(registry, parsed) {
  return {
    ...registry,
    remediations: mergeList('action', registry.remediations || [], parsed.remediations, (x) => x.rank, ACTION_FIELDS),
    attributionPlan: mergeList('surface', registry.attributionPlan || [], parsed.attributionPlan, (x) => x.area, SURFACE_FIELDS),
  };
}

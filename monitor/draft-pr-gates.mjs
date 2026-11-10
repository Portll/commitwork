// monitor/draft-pr-gates.mjs — the pure judgements remediation-draft-pr makes about an upstream
// repository before it opens anything: has it asked for no automated PRs, does it need a CLA or a
// DCO sign-off, does an open PR or issue already propose this fix, and does the PR open as a draft.
// Unreadable input is never a pass: it answers null, and the caller does not open.

// Marker files whose presence is an opt-out, read from the default branch.
export const OPT_OUT_FILES = ['.github/no-automated-prs', '.github/no-bot-prs', '.github/NO_AUTOMATED_PRS', '.no-automated-prs', '.no-bot-prs'];
// Files whose prose is read for opt-out sentences and contribution requirements.
export const CONTRIBUTING_FILES = ['CONTRIBUTING.md', 'CONTRIBUTING', 'CONTRIBUTING.rst', 'CONTRIBUTING.txt',
  '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/pull_request_template.md'];
export const CLA_FILES = ['.clabot', '.github/cla.yml', '.github/workflows/cla.yml'];
export const DCO_FILES = ['.github/dco.yml', '.github/DCO'];
export const OPT_OUT_LABEL_RE = /^(?:no[-_ ]?bots?|no[-_ ]?automated[-_ ]?(?:prs?|pull[-_ ]?requests?)|no[-_ ]?ai(?:[-_ ]?prs?)?|bot[-_ ]?free|no[-_ ]?automation)$/i;

const BOT = String.raw`(?:automated|automatic(?:ally)?|bots?|(?:machine|ai|tool|llm)[- ]generated|ai|llms?)`;
const PR = String.raw`(?:pull[- ]requests?|prs?|contributions?|patch(?:es)?|submissions?)`;
const REFUSAL = new RegExp(String.raw`\b(?:not (?:be )?(?:accept(?:ed)?|welcome|allowed|permitted|reviewed|merged)|(?:will|may) (?:be )?(?:closed|rejected|ignored|deleted)|(?:are|is|get) (?:closed|rejected)|prohibited|forbidden|banned|(?:(?:do|does|will|shall|can) not|don't|doesn't|won't|cannot|can't) (?:accept|want|review|merge|take)|(?:do not|don't|never) (?:open|send|submit)|no\s+(?:[\w-]+\s+){0,2}${BOT}\b)`, 'i');
// the bot word and the PR word within three words of each other, either order
const NEAR = new RegExp(String.raw`\b${BOT}(?:\W+[\w-]+){0,3}?\W+${PR}\b|\b${PR}(?:\W+[\w-]+){0,3}?\W+${BOT}\b`, 'i');

/** Prose split into sentences; a markdown list item or heading starts a new one. */
export const sentences = (text) => String(text || '').split(/(?<=[.!?])\s+|\n\s*\n|\n\s*[-*+#>]\s|\n\s*\d+\.\s/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** The sentence that refuses automated PRs, or null: a bot word next to a PR word, and a refusal. */
export function optOutSentence(text) {
  return sentences(text).find((s) => NEAR.test(s) && REFUSAL.test(s)) || null;
}

/**
 * @param {{files:Object<string,string|null>|null, labels:string[]|null}} seen  files: path -> text, null when absent
 * @returns {{optedOut:true|false|null, why:string}}  null = could not be read, which is "do not open"
 */
export function optOut({ files, labels }) {
  if (!files) return { optedOut: null, why: 'the default branch files could not be read' };
  if (!Array.isArray(labels)) return { optedOut: null, why: 'the label list could not be read' };
  const marker = OPT_OUT_FILES.find((p) => typeof files[p] === 'string');
  if (marker) return { optedOut: true, why: `${marker} is present` };
  for (const p of CONTRIBUTING_FILES) {
    const s = typeof files[p] === 'string' && optOutSentence(files[p]);
    if (s) return { optedOut: true, why: `${p}: "${s.slice(0, 200)}"` };
  }
  const label = labels.find((l) => OPT_OUT_LABEL_RE.test(String(l)));
  if (label) return { optedOut: true, why: `the repository has a "${label}" label` };
  return { optedOut: false, why: 'no opt-out found' };
}

const mentionsCla = (s) => /contributor (?:license|licence) agreement/i.test(s) || /\bCLA\b/.test(s);
const CLA_WORKFLOW = /cla-assistant|contributor-assistant|cla-bot|clabot|easycla/i;
const DCO_TEXT = /developer certificate of origin|\bDCO\b|signed-off-by/i;

/** What upstream asks of a contributor. cla cannot be met by a machine; dco can, by sign-off. */
export function contributionRequirements({ files, workflows = [] }) {
  const prose = CONTRIBUTING_FILES.filter((p) => typeof files?.[p] === 'string');
  const claWhy = CLA_FILES.find((p) => typeof files?.[p] === 'string')
    || prose.find((p) => mentionsCla(files[p]))
    || workflows.find((w) => CLA_WORKFLOW.test(w.text))?.path || null;
  const dcoWhy = DCO_FILES.find((p) => typeof files?.[p] === 'string')
    || prose.find((p) => DCO_TEXT.test(files[p]))
    || workflows.find((w) => /\bdco\b/i.test(w.text))?.path || null;
  return { cla: !!claWhy, claWhy, dco: !!dcoWhy, dcoWhy, contributing: prose[0] || null };
}

const mentions = (item, term) => term && `${item?.title || ''}\n${item?.body || ''}`.toLowerCase().includes(String(term).toLowerCase());
const BUMP_WORD = /\b(?:bump|upgrade|update|patch|fix)/i;

/**
 * Open PRs or issues that already propose this fix. A PR counts when it names the advisory or the
 * module it bumps; an issue when it names the advisory, or the module beside a bump word.
 */
export function duplicatesOf(adv, { prs = [], issues = [] }) {
  const ids = [adv.id, ...(Array.isArray(adv.aliases) ? adv.aliases : [])].filter(Boolean);
  const mods = [...new Set([adv.package, adv.bump?.module].filter(Boolean))];
  const hit = [];
  for (const p of prs) if (ids.some((t) => mentions(p, t)) || mods.some((m) => mentions(p, m))) hit.push({ kind: 'pr', url: p.url });
  for (const i of issues) {
    if (ids.some((t) => mentions(i, t)) || mods.some((m) => mentions(i, m) && BUMP_WORD.test(`${i.title}\n${i.body}`))) hit.push({ kind: 'issue', url: i.url });
  }
  return [...new Map(hit.map((h) => [h.url, h])).values()];
}

/** A PR opens ready for review only on an own repository, when policy allows it and nothing is asked of a person. */
export function opensAsDraft({ ready, target, asks = [] }) {
  return !(ready === 'own-only' && target === 'own' && asks.length === 0);
}

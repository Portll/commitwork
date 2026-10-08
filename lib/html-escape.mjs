// contract: safe in text and quoted attributes
export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// contract: text content only, never an attribute. For renderers that show a quote entity
// literally: Slack mrkdwn (whose own rule is & < > only) and the generated Markdown reference.
// Derived from esc, so there is one escaper: esc's quote entities are the only ones it can emit
// (a literal "&quot;" in the input is already "&amp;quot;"), and they are put back.
export const escText = (s) => esc(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'");

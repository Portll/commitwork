// A `claude -p --output-format stream-json` stand-in: records its stdin verbatim to argv[2] and
// answers with one assistant event and one result event. CW_STUB_TOOL_USE names a tool to claim
// in the assistant event (the planted escape); CW_STUB_RESULT replaces the verdict text.
// CW_STUB_READ_CWD=1 claims a Read under the stub's own cwd and CW_STUB_READ=<path> a Read of that
// path; each gets a tool_result, refused when CW_STUB_READ_REFUSED=1.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  if (process.argv[2]) writeFileSync(process.argv[2], input);
  const content = [{ type: 'text', text: 'stub' }];
  if (process.env.CW_STUB_TOOL_USE) content.push({ type: 'tool_use', id: 'toolu_stub', name: process.env.CW_STUB_TOOL_USE, input: {} });
  const reads = [];
  if (process.env.CW_STUB_READ_CWD === '1') reads.push(join(process.cwd(), 'src', 'stub.js'));
  if (process.env.CW_STUB_READ) reads.push(process.env.CW_STUB_READ);
  reads.forEach((p, i) => content.push({ type: 'tool_use', id: `toolu_read_${i}`, name: 'Read', input: { file_path: p } }));
  const verdict = { classification: 'needs-human', investigation: 'stub', falsePositiveAnalysis: 'stub', remediation: '* Issue: stub\n* Fix: none\n* Caveats: none', diff: '', confidence: 'low' };
  const result = process.env.CW_STUB_RESULT ?? JSON.stringify(verdict);
  process.stdout.write(`${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } })}\n`);
  const refused = process.env.CW_STUB_READ_REFUSED === '1';
  reads.forEach((_, i) => process.stdout.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_read_${i}`, is_error: refused, content: refused ? 'denied' : 'ok' }] } })}\n`));
  process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', result })}\n`);
});

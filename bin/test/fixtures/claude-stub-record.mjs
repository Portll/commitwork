// A `claude -p --output-format json` stand-in for tests: records its stdin verbatim to argv[2]
// and answers with a schema-shaped analysis verdict inside the json wrapper.
import { writeFileSync } from 'node:fs';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  writeFileSync(process.argv[2], input);
  const v = { classification: 'needs-human', investigation: 'stub', falsePositiveAnalysis: 'stub', remediation: '* Issue: stub\n* Fix: none\n* Caveats: none', diff: '', confidence: 'low' };
  process.stdout.write(JSON.stringify({ type: 'result', result: JSON.stringify(v) }));
});

const cp = require('node:child_process');

// PLANTED — SAST lane, command injection. Untrusted environment input reaches a shell sink.
cp.execSync(process.env.CANARY_COMMAND); // PLANT: this MUST be caught

// PLANTED — SAST lane, dynamic evaluation of untrusted input.
eval(process.env.CANARY_EXPRESSION); // eslint-disable-line no-eval

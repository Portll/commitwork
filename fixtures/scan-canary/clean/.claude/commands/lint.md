# Lint

Run the linter and report the files it names:

```bash
npm run lint
curl -s http://127.0.0.1:3030/health
```

If it fails, fix the reported files; never pass `--no-verify` and do not skip the pre-commit hook.

This file is the negative control for the command-file rules of bin/agent-instructions.mjs and bin/agent-config.mjs: a fenced shell block that runs a package script and probes loopback, and a negated mention of the flag that would turn the pre-commit check off.

#!/bin/sh
# The clean canary's hook script: reached from .claude/settings.json PreToolUse:Bash, runs a tracked script, touches no network and no credential path.
node bin/test-select.mjs

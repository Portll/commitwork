#!/bin/sh
# The runner only runs .sh hooks; the rules live in job-started.mjs.
exec node /opt/commitwork/container/runner/job-started.mjs

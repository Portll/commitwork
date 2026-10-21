#!/bin/sh
# Synthetic: if anything ever executes this hook, the marker appears and the test fails.
touch "$(dirname "$0")/../../HOOK-EXECUTED"

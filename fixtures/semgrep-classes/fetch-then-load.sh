#!/usr/bin/env bash
# Annotated fixture for manifests/semgrep-classes/fetch-then-load.yaml (shell rule).
set -euo pipefail

URL="https://example.org/install.sh"
PINNED="0000000000000000000000000000000000000000000000000000000000000000"

install_piped() {
  # ruleid: cw-download-run-without-digest-sh
  curl -fsSL "$URL" | sh
}

install_substituted() {
  # ruleid: cw-download-run-without-digest-sh
  bash <(curl -fsSL "$URL")
}

install_pinned() {
  tmp="$(mktemp)"
  curl -fsSL -o "$tmp" "$URL"
  echo "$PINNED  $tmp" | shasum -a 256 -c -
  # ok: cw-download-run-without-digest-sh
  sh "$tmp"
}

install_unpinned_file() {
  tmp="$(mktemp)"
  curl -fsSL -o "$tmp" "$URL"
  # ruleid: cw-download-run-without-digest-sh
  tar -xzf "$tmp" -C /opt
}

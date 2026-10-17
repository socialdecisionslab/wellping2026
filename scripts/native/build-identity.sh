#!/usr/bin/env bash
set -euo pipefail
mode="${1:?record or verify required}"
directory="${2:?artifact directory required}"
[[ "${REVIEWED_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]]
test "$(git rev-parse HEAD)" = "$REVIEWED_SHA"
case "$mode" in
  record)
    printf '%s\n' "$REVIEWED_SHA" > "$directory/reviewed-sha.txt"
    printf '%s\n' "$GITHUB_RUN_ID" > "$directory/build-run-id.txt"
    ;;
  verify)
    test "$(cat "$directory/reviewed-sha.txt")" = "$REVIEWED_SHA"
    test "$(cat "$directory/build-run-id.txt")" = "$GITHUB_RUN_ID"
    printf '{"headSha":"%s","runId":"%s"}\n' "$REVIEWED_SHA" "$GITHUB_RUN_ID" > "$directory/tested-build.json"
    ;;
  *) exit 2 ;;
esac

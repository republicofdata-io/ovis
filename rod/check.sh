#!/bin/sh
# The checks the fork runs on a Mac: type-check, app build, the convention tests, and the
# tests of our own changes (rod/tests.txt). Ovis runs its full unit suite on Linux only
# (.github/workflows/ci.yml); on macOS some of it hangs, so it is not run here.
set -eu
cd "$(git rev-parse --show-toplevel)"
bun run typecheck
bun run build
tests=$(git ls-files '*conventions*.test.ts')
tests="$tests $(grep -vE '^\s*(#|$)' rod/tests.txt 2>/dev/null || true)"
# shellcheck disable=SC2086
bun test --timeout 60000 $tests

#!/usr/bin/env bash
set -euo pipefail

# Collect anonystat files needed at runtime into $OUT_DIR (./dist by default).
# This must be run from the repo root.

OUT_DIR=${OUT_DIR:-dist}
mkdir -p "${OUT_DIR:?}"

# Include the deno.json/deno.lock with the hope that Deno Deploy uses the
# lockfile when resolving deps. I can't find any documentation that indicates
# whether it does or not though.
git ls-files . \
    | grep -P '^(.*\.ts|deno.json|deno.lock)$' \
    | grep -Pv '_test(ing)?\b|scripts/' \
    | xargs -I{} install -D --mode a=r,u+w {} "${OUT_DIR:?}/{}"

echo "anonystat runtime files collected in ${OUT_DIR:?}" >&2

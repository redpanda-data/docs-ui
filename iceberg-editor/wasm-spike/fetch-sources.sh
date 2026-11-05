#!/usr/bin/env bash
# Fetch the exact Redpanda source files the engine compiles, at $REDPANDA_REF,
# into vendor/ preserving the include layout (so `#include "iceberg/..."` etc.
# resolve). Real source is NOT committed to this repo: this keeps the repo
# small and ties each build to one Redpanda revision, the per-release model.
#
# Uses `gh api` when available (respects auth/rate limits), else the GitHub
# API over HTTPS with $GH_TOKEN. The repository is private, so either way the
# caller needs read access to $REDPANDA_REPO.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

require curl

# The redpanda.iceberg.mode parser and formatter (model.cc) and what they
# include from Redpanda. Every release with Iceberg has these.
MODE_FILES=(
    "model/metadata.h"
    "model/model.cc"
    "strings/string_switch.h"
)
# Present only in releases that have them: base/format_to.h (v26.1 and later)
# supplies the fmt formatter v26.2's iceberg_mode::format_to relies on, and
# model/tests/iceberg_mode_test.cc (v26.2 and later) is the release's own unit
# test for the parser, which `build.sh test` runs against the engine's code.
OPTIONAL_FILES=(
    "base/format_to.h"
    "model/tests/iceberg_mode_test.cc"
)
# The Avro -> Iceberg schema mapper. Shimmed headers (seastarx.h, vassert.h,
# conversion_outcome.h) are deliberately NOT fetched: the shim/ copies take
# precedence on the -I path. All or nothing: a release without them (before
# v26.1 the mapper lived elsewhere) gets a parser-only engine.
SCHEMA_FILES=(
    "iceberg/datatypes.h"
    "iceberg/datatypes.cc"
    "iceberg/conversion/schema_avro.h"
    "iceberg/conversion/schema_avro.cc"
    "iceberg/conversion/avro_utils.h"
    "iceberg/conversion/avro_utils.cc"
    "base/outcome.h"
    "utils/named_type.h"
    "container/chunked_vector.h"
)

# Resolve the ref to an immutable commit ONCE and fetch every file at that
# commit, so a build cannot straddle two revisions of `dev`. The commit is
# recorded for third_party/fetch-deps.sh (and for attributing the built engine).
require_pinned_ref
REV="$(resolve_redpanda_commit)"
TREE="$(redpanda_tree "$REV")"
[ -n "$TREE" ] || { echo "ERROR: cannot list $REDPANDA_REPO @ $REV" >&2; exit 1; }
# A here-string, not a pipe: with pipefail, grep -q closing the pipe early
# would fail the printf and report the file missing.
in_tree() { grep -qxF "src/v/$1" <<<"$TREE"; }

fetch_file() {
    local rel="$1"
    fetch_redpanda_file "src/v/$rel" "$REV" "$VENDOR_DIR/$rel"
    echo "  vendor/$rel"
}

# A fresh vendor/ for this revision: files from another revision must not
# survive (an optional header, or the schema mapper).
case "$VENDOR_DIR" in "" | / | "$HOME") echo "ERROR: refusing VENDOR_DIR=$VENDOR_DIR" >&2; exit 1 ;; esac
rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"

echo "Fetching Redpanda source @ $REDPANDA_REF = $REV ($REDPANDA_REPO):"
for f in "${MODE_FILES[@]}"; do fetch_file "$f"; done
for f in "${OPTIONAL_FILES[@]}"; do if in_tree "$f"; then fetch_file "$f"; fi; done
missing=()
for f in "${SCHEMA_FILES[@]}"; do in_tree "$f" || missing+=("$f"); done
if [ "${#missing[@]}" -eq 0 ]; then
    for f in "${SCHEMA_FILES[@]}"; do fetch_file "$f"; done
    : >"$SCHEMA_MAPPER_MARKER"
else
    echo "No Avro schema mapper at this revision (missing ${missing[*]});"
    echo "the engine will have the iceberg_mode parser only."
fi
printf '%s\n' "$REV" >"$REDPANDA_COMMIT_FILE"
printf '%s\n' "$REDPANDA_REF" >"$VENDOR_DIR/REDPANDA_REF"
echo "Done. Vendored into $VENDOR_DIR"
echo "Pinned Redpanda revision recorded in $REDPANDA_COMMIT_FILE"

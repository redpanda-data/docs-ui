#!/usr/bin/env bash
# Fetch the exact Redpanda source files the spike compiles, at $REDPANDA_REF,
# into vendor/ preserving the include layout (so `#include "iceberg/..."` etc.
# resolve). Real source is NOT committed to this repo — this keeps the spike
# small and ties the build to a specific Redpanda ref, mirroring the eventual
# per-release build model.
#
# Uses `gh api` when available (respects auth/rate limits), else raw HTTPS.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

require curl

# Files to fetch, relative to redpanda's `src/v/`. Shimmed headers
# (seastarx.h, vassert.h, container/chunked_vector.h, conversion_outcome.h) are
# deliberately NOT fetched — the shim/ copies take precedence on the -I path.
FILES=(
    "iceberg/datatypes.h"
    "iceberg/datatypes.cc"
    "iceberg/conversion/schema_avro.h"
    "iceberg/conversion/schema_avro.cc"
    "iceberg/conversion/avro_utils.h"
    "iceberg/conversion/avro_utils.cc"
    "base/format_to.h"
    "base/outcome.h"
    "utils/named_type.h"
    "container/chunked_vector.h"
)

# Resolve the ref to an immutable commit ONCE and fetch every file at that
# commit, so a build cannot straddle two revisions of `dev`. The commit is
# recorded for third_party/fetch-deps.sh (and for attributing the built engine).
require_pinned_ref
REV="$(resolve_redpanda_commit)"

fetch_file() {
    local rel="$1"
    fetch_redpanda_file "src/v/$rel" "$REV" "$VENDOR_DIR/$rel"
    echo "  vendor/$rel"
}

echo "Fetching Redpanda source @ $REDPANDA_REF = $REV ($REDPANDA_REPO):"
for f in "${FILES[@]}"; do fetch_file "$f"; done
printf '%s\n' "$REV" >"$REDPANDA_COMMIT_FILE"
echo "Done. Vendored ${#FILES[@]} files into $VENDOR_DIR"
echo "Pinned Redpanda revision recorded in $REDPANDA_COMMIT_FILE"

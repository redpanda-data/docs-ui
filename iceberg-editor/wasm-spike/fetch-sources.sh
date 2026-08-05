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

fetch_file() {
    local rel="$1"
    local src="src/v/$rel"
    local dst="$VENDOR_DIR/$rel"
    mkdir -p "$(dirname "$dst")"
    if command -v gh >/dev/null 2>&1; then
        gh api "repos/$REDPANDA_REPO/contents/$src?ref=$REDPANDA_REF" \
            -q '.content' 2>/dev/null | base64 -d >"$dst"
    else
        curl -fsSL \
            "https://raw.githubusercontent.com/$REDPANDA_REPO/$REDPANDA_REF/$src" \
            -o "$dst"
    fi
    [ -s "$dst" ] || { echo "ERROR: failed to fetch $src" >&2; exit 1; }
    echo "  vendor/$rel"
}

echo "Fetching Redpanda source @ $REDPANDA_REF ($REDPANDA_REPO):"
for f in "${FILES[@]}"; do fetch_file "$f"; done
echo "Done. Vendored $(echo "${#FILES[@]}") files into $VENDOR_DIR"

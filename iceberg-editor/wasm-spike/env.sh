#!/usr/bin/env bash
# Shared configuration for the spike scripts. Sourced by the others.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Which Redpanda ref to pull real source from. Use `dev` while iterating; pin to
# a release tag (e.g. v26.2.1) to reproduce a specific version's behavior — this
# is the same knob the per-release CI will drive.
export REDPANDA_REF="${REDPANDA_REF:-dev}"
export REDPANDA_REPO="${REDPANDA_REPO:-redpanda-data/redpanda}"
# Set to 1 for release/reproducible builds to reject a mutable ref (branch).
export REDPANDA_REQUIRE_PINNED="${REDPANDA_REQUIRE_PINNED:-0}"

export SHIM_DIR="$HERE/shim"
export VENDOR_DIR="$HERE/vendor"
export TP_DIR="$HERE/third_party"
export BUILD_DIR="$HERE/build"

# Where fetch-sources.sh records the immutable commit $REDPANDA_REF resolved to.
# Every later fetch (deps, patches) reads it, so one build == one Redpanda
# revision, and the generated engine can be attributed to that revision.
export REDPANDA_COMMIT_FILE="$VENDOR_DIR/REDPANDA_COMMIT"

# Dependency include roots. Override any of these to point at a preinstalled
# copy (recommended in CI). If unset, third_party/fetch-deps.sh populates them.
export FMT_INCLUDE="${FMT_INCLUDE:-$TP_DIR/fmt/include}"         # fmt 12.1.0
export BOOST_INCLUDE="${BOOST_INCLUDE:-$TP_DIR/boost}"          # boost/ header root
export AVRO_SRC="${AVRO_SRC:-$TP_DIR/avro-cpp}"                 # -> redpanda avro fork lang/c++

mkdir -p "$VENDOR_DIR" "$TP_DIR" "$BUILD_DIR"

require() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "ERROR: '$1' not found on PATH. See README prerequisites." >&2
        exit 127
    }
}

# Reject a mutable ref when the caller asked for a reproducible build.
require_pinned_ref() {
    [ "$REDPANDA_REQUIRE_PINNED" = "1" ] || return 0
    if [[ ! "$REDPANDA_REF" =~ ^(v[0-9]+\.[0-9]+\.[0-9]+.*|[0-9a-f]{40})$ ]]; then
        echo "ERROR: REDPANDA_REQUIRE_PINNED=1 but REDPANDA_REF='$REDPANDA_REF' is" >&2
        echo "       not an immutable release tag or 40-char commit SHA." >&2
        exit 1
    fi
}

# Resolve $REDPANDA_REF to the commit SHA it points at right now.
resolve_redpanda_commit() {
    local sha=""
    if [[ "$REDPANDA_REF" =~ ^[0-9a-f]{40}$ ]]; then
        echo "$REDPANDA_REF"
        return 0
    fi
    if command -v gh >/dev/null 2>&1; then
        sha="$(gh api "repos/$REDPANDA_REPO/commits/$REDPANDA_REF" -q '.sha' 2>/dev/null || true)"
    fi
    if [ -z "$sha" ]; then
        sha="$(curl -fsSL -H 'Accept: application/vnd.github.sha' \
            "https://api.github.com/repos/$REDPANDA_REPO/commits/$REDPANDA_REF" || true)"
    fi
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
        echo "ERROR: cannot resolve $REDPANDA_REPO ref '$REDPANDA_REF' to a commit." >&2
        exit 1
    }
    echo "$sha"
}

# The revision this build is pinned to: the one fetch-sources.sh recorded, or
# (if it has not run yet) whatever $REDPANDA_REF resolves to now.
redpanda_revision() {
    if [ -s "$REDPANDA_COMMIT_FILE" ]; then
        cat "$REDPANDA_COMMIT_FILE"
    else
        resolve_redpanda_commit
    fi
}

# Fetch one file from redpanda at $2 (a revision) into $3.
fetch_redpanda_file() {
    local rel="$1" rev="$2" dst="$3"
    mkdir -p "$(dirname "$dst")"
    if command -v gh >/dev/null 2>&1; then
        gh api "repos/$REDPANDA_REPO/contents/$rel?ref=$rev" \
            -q '.content' 2>/dev/null | base64 -d >"$dst"
    else
        curl -fsSL \
            "https://raw.githubusercontent.com/$REDPANDA_REPO/$rev/$rel" \
            -o "$dst"
    fi
    [ -s "$dst" ] || { echo "ERROR: failed to fetch $rel @ $rev" >&2; exit 1; }
}

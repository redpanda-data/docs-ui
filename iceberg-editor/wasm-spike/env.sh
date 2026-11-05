#!/usr/bin/env bash
# Shared configuration for the spike scripts. Sourced by the others.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Which Redpanda ref to pull real source from. Use `dev` while iterating; pin to
# a release tag (e.g. v26.2.1) to reproduce a specific version's behavior. The
# release-tag CI (build-iceberg-engine.yml) drives the same knob.
export REDPANDA_REF="${REDPANDA_REF:-dev}"
# Redpanda's source lives in the private streaming-enterprise repository
# (redpanda-data/redpanda redirects there and 404s without access). Fetching
# needs a token that can read it: `gh auth login` locally, GH_TOKEN in CI.
export REDPANDA_REPO="${REDPANDA_REPO:-redpanda-data/streaming-enterprise}"
# Set to 1 for release/reproducible builds to reject a mutable ref (branch).
export REDPANDA_REQUIRE_PINNED="${REDPANDA_REQUIRE_PINNED:-0}"

export SHIM_DIR="$HERE/shim"
# VENDOR_DIR can be pointed elsewhere to keep several releases side by side.
export VENDOR_DIR="${VENDOR_DIR:-$HERE/vendor}"
export TP_DIR="$HERE/third_party"
export BUILD_DIR="$HERE/build"

# Where fetch-sources.sh records the immutable commit $REDPANDA_REF resolved to.
# Every later fetch (deps, patches) reads it, so one build == one Redpanda
# revision, and the generated engine can be attributed to that revision.
export REDPANDA_COMMIT_FILE="$VENDOR_DIR/REDPANDA_COMMIT"

# Dependency include roots. Override FMT_INCLUDE/BOOST_INCLUDE to point at a
# preinstalled copy (recommended in CI); if unset, third_party/fetch-deps.sh
# populates them. AVRO_SRC is different: fetch-deps.sh owns it as a symlink and
# re-points it at the Avro fork revision the pinned Redpanda revision requires,
# so it must name a path to link, never a preinstalled tree.
# fmt, Abseil and Avro are symlinks fetch-deps.sh re-points at the versions the
# pinned revision's MODULE.bazel / bazel/repositories.bzl name.
export FMT_INCLUDE="${FMT_INCLUDE:-$TP_DIR/fmt/include}"         # -> fmt-<MODULE.bazel version>
export ABSEIL_SRC="${ABSEIL_SRC:-$TP_DIR/abseil-cpp}"           # -> abseil-cpp-<MODULE.bazel version>
export GTEST_SRC="${GTEST_SRC:-$TP_DIR/googletest}"             # -> googletest-<MODULE.bazel version>
export BOOST_INCLUDE="${BOOST_INCLUDE:-$TP_DIR/boost}"          # boost/ header root
export AVRO_SRC="${AVRO_SRC:-$TP_DIR/avro-cpp}"                 # -> redpanda avro fork lang/c++
# Written by fetch-sources.sh when the revision has the Avro schema mapper
# sources (iceberg/conversion/, from v26.1). Without it the engine is built
# with the iceberg_mode parser only.
export SCHEMA_MAPPER_MARKER="$VENDOR_DIR/SCHEMA_MAPPER"

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
        sha="$(curl -fsSL ${GH_TOKEN:+-H "Authorization: Bearer $GH_TOKEN"} \
            -H 'Accept: application/vnd.github.sha' \
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

# Every path in the Redpanda tree at $1 (a revision), one per line.
redpanda_tree() {
    local rev="$1"
    if command -v gh >/dev/null 2>&1; then
        gh api "repos/$REDPANDA_REPO/git/trees/$rev?recursive=1" -q '.tree[].path'
    else
        curl -fsSL ${GH_TOKEN:+-H "Authorization: Bearer $GH_TOKEN"} \
            "https://api.github.com/repos/$REDPANDA_REPO/git/trees/$rev?recursive=1" |
            node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).tree.forEach(t=>console.log(t.path)))'
    fi
}

# The version MODULE.bazel at $1 pins for bazel_dep $2 (e.g. fmt, abseil-cpp).
module_dep_version() {
    local rev="$1" dep="$2" mod="$TP_DIR/MODULE-$1.bazel"
    [ -s "$mod" ] || fetch_redpanda_file "MODULE.bazel" "$rev" "$mod"
    sed -n 's/^bazel_dep(name = "'"$dep"'", version = "\([^"]*\)".*/\1/p' "$mod" | head -1
}

# Fetch one file from redpanda at $2 (a revision) into $3.
fetch_redpanda_file() {
    local rel="$1" rev="$2" dst="$3"
    mkdir -p "$(dirname "$dst")"
    # Raw media type: the JSON form base64-encodes and stops at 1 MB.
    if command -v gh >/dev/null 2>&1; then
        gh api -H 'Accept: application/vnd.github.raw' \
            "repos/$REDPANDA_REPO/contents/$rel?ref=$rev" >"$dst" 2>/dev/null || :
    else
        curl -fsSL ${GH_TOKEN:+-H "Authorization: Bearer $GH_TOKEN"} \
            -H 'Accept: application/vnd.github.raw' \
            "https://api.github.com/repos/$REDPANDA_REPO/contents/$rel?ref=$rev" \
            -o "$dst" || :
    fi
    [ -s "$dst" ] || { echo "ERROR: failed to fetch $rel @ $rev" >&2; exit 1; }
}

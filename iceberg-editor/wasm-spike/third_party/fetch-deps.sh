#!/usr/bin/env bash
# Fetch the dependencies the spike links against, PINNED to the same versions
# Redpanda's real build uses (so the toolchain is coherent):
#   - fmt 12.1.0            (redpanda MODULE.bazel: bazel_dep fmt 12.1.0)
#   - Boost headers         (for boost::outcome, used by base/outcome.h)
#   - Avro C++              (redpanda-data/avro fork + redpanda's patches, both
#                            read from bazel/repositories.bzl at the SAME
#                            Redpanda revision the source came from)
#
# The Avro *fork + patches* matter: upstream apache/avro 1.12 ships an
# fmt::formatter with a non-const format() method that fmt 12 rejects; the
# fork's patch fixes exactly that. Using upstream Avro will fail to compile.
#
# The Avro commit, its sha256, and the patch set are NOT hardcoded here: they all
# change between Redpanda releases (v25.3.1 pins avro e54bf71 with one patch;
# dev pins 6821e2b with three), so they are derived from the pinned revision.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"

require git
require curl

FMT_TAG="${FMT_TAG:-12.1.0}"
BOOST_VER="${BOOST_VER:-1.85.0}"

# The single Redpanda revision this build is pinned to (recorded by
# fetch-sources.sh). Everything Avro-related is resolved from it.
REV="$(redpanda_revision)"
REPOS_BZL="$TP_DIR/repositories-$REV.bzl"
[ -s "$REPOS_BZL" ] || fetch_redpanda_file "bazel/repositories.bzl" "$REV" "$REPOS_BZL"

# The `avro` http_archive block: url (commit), sha256, and patches, in order.
AVRO_BLOCK="$(sed -n '/name = "avro"/,/^    )/p' "$REPOS_BZL")"
AVRO_SHA="$(printf '%s\n' "$AVRO_BLOCK" |
    sed -n 's#.*avro/archive/\([0-9a-f]\{40\}\)\.tar\.gz.*#\1#p' | head -1)"
AVRO_SHA256="$(printf '%s\n' "$AVRO_BLOCK" |
    sed -n 's/.*sha256 = "\([0-9a-f]\{64\}\)".*/\1/p' | head -1)"
AVRO_PATCHES=()
while IFS= read -r p; do [ -n "$p" ] && AVRO_PATCHES+=("$p"); done < <(
    printf '%s\n' "$AVRO_BLOCK" | grep -oE '[A-Za-z0-9._-]+\.patch' || true)
[ -n "$AVRO_SHA" ] && [ -n "$AVRO_SHA256" ] && [ "${#AVRO_PATCHES[@]}" -gt 0 ] || {
    echo "ERROR: could not read the avro pin from bazel/repositories.bzl @ $REV." >&2
    echo "       Upstream layout may have changed; re-check the parser." >&2
    exit 1
}

# --- fmt 12.1.0 (header-only via FMT_HEADER_ONLY) ---
if [ ! -d "$FMT_INCLUDE" ]; then
    echo "Fetching fmt $FMT_TAG ..."
    git clone --depth 1 --branch "$FMT_TAG" https://github.com/fmtlib/fmt \
        "$TP_DIR/fmt"
fi

# --- Boost headers (Boost.Outcome is header-only) ---
if [ ! -d "$BOOST_INCLUDE/boost" ]; then
    echo "Fetching Boost $BOOST_VER headers ..."
    ver_us="${BOOST_VER//./_}"
    url="https://archives.boost.io/release/$BOOST_VER/source/boost_${ver_us}.tar.gz"
    curl -fsSL "$url" -o "$TP_DIR/boost.tar.gz"
    tar -xzf "$TP_DIR/boost.tar.gz" -C "$TP_DIR"
    rm -rf "$BOOST_INCLUDE"
    mkdir -p "$BOOST_INCLUDE"
    mv "$TP_DIR/boost_${ver_us}/boost" "$BOOST_INCLUDE/boost"
fi

# --- Avro C++ (Redpanda fork @ AVRO_SHA, patched) ---
AVRO_EXTRACT="$TP_DIR/avro-$AVRO_SHA"
if [ ! -e "$AVRO_SRC/include/avro/Node.hh" ]; then
    echo "Fetching redpanda-data/avro @ $AVRO_SHA ..."
    curl -fsSL "https://github.com/redpanda-data/avro/archive/$AVRO_SHA.tar.gz" \
        -o "$TP_DIR/avro.tar.gz"
    # Same checksum Redpanda's own build verifies, so a swapped archive fails here.
    if command -v sha256sum >/dev/null 2>&1; then
        got="$(sha256sum "$TP_DIR/avro.tar.gz" | cut -d' ' -f1)"
    else
        got="$(shasum -a 256 "$TP_DIR/avro.tar.gz" | cut -d' ' -f1)"
    fi
    [ "$got" = "$AVRO_SHA256" ] || {
        echo "ERROR: avro archive checksum mismatch." >&2
        echo "       expected $AVRO_SHA256 (redpanda @ $REV)" >&2
        echo "       got      $got" >&2
        exit 1
    }
    # Ignore tar's harmless CRC warnings on Java test-resource files.
    tar -xzf "$TP_DIR/avro.tar.gz" -C "$TP_DIR" || true
    ln -sfn "$AVRO_EXTRACT/lang/c++" "$AVRO_SRC"

    # Apply exactly the patches redpanda @ $REV applies, in its order.
    # `git apply --unidiff-zero` rather than `patch -p1`: avro-libcxx-includes.patch
    # has pure-addition hunks with no trailing context, which Bazel's patch
    # implementation accepts but Apple's `patch 2.0` rejects ("hunk failed at 19").
    # GIT_CEILING_DIRECTORIES stops git's upward repo search at $TP_DIR: without
    # it, git sees the surrounding docs-ui work tree, treats every path in the
    # patch as outside the current prefix, and SILENTLY skips it ("Skipped
    # patch ...") while still exiting 0 — leaving avro unpatched.
    echo "Applying redpanda Avro patches (${AVRO_PATCHES[*]}) ..."
    for p in "${AVRO_PATCHES[@]}"; do
        fetch_redpanda_file "bazel/thirdparty/$p" "$REV" "$TP_DIR/$p"
        (
            cd "$AVRO_EXTRACT"
            export GIT_CEILING_DIRECTORIES="$TP_DIR"
            # --numstat lists the files the patch would touch, and prints
            # nothing for a skipped patch, so it catches the silent-skip case
            # that plain `git apply` exits 0 on.
            if [ "$(git apply -p1 --unidiff-zero --numstat "$TP_DIR/$p" | wc -l)" -eq 0 ]; then
                echo "ERROR: $p matched no files under $AVRO_EXTRACT." >&2
                exit 1
            fi
            git apply -p1 --unidiff-zero "$TP_DIR/$p"
        )
    done
fi

echo "third_party ready (redpanda @ $REV):"
echo "  fmt   -> $FMT_INCLUDE ($FMT_TAG)"
echo "  boost -> $BOOST_INCLUDE ($BOOST_VER)"
echo "  avro  -> $AVRO_SRC (redpanda fork @ ${AVRO_SHA:0:12}, ${#AVRO_PATCHES[@]} patch(es))"

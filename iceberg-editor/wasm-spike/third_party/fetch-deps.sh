#!/usr/bin/env bash
# Fetch the dependencies the spike links against, PINNED to the same versions
# Redpanda's real build uses (so the toolchain is coherent):
#   - fmt 12.1.0            (redpanda MODULE.bazel: bazel_dep fmt 12.1.0)
#   - Boost headers         (for boost::outcome, used by base/outcome.h)
#   - Avro C++              (redpanda-data/avro fork @ AVRO_SHA + redpanda's
#                            avro-fmt-const.patch / avro-snappy-includes.patch)
#
# The Avro *fork + patches* matter: upstream apache/avro 1.12 ships an
# fmt::formatter with a non-const format() method that fmt 12 rejects; the
# fork's patch fixes exactly that. Using upstream Avro will fail to compile.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"

require git
require curl

FMT_TAG="${FMT_TAG:-12.1.0}"
BOOST_VER="${BOOST_VER:-1.85.0}"
# Redpanda's Avro fork commit (bazel/repositories.bzl -> name = "avro").
AVRO_SHA="${AVRO_SHA:-6821e2b454401308d4e3819c0569d0fe7f2a66fa}"
AVRO_PATCH_REF="${AVRO_PATCH_REF:-dev}"   # redpanda ref to pull patches from

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
    # Ignore tar's harmless CRC warnings on Java test-resource files.
    tar -xzf "$TP_DIR/avro.tar.gz" -C "$TP_DIR" || true
    ln -sfn "$AVRO_EXTRACT/lang/c++" "$AVRO_SRC"

    echo "Applying redpanda Avro patches ..."
    for p in avro-fmt-const.patch avro-snappy-includes.patch; do
        if command -v gh >/dev/null 2>&1; then
            gh api "repos/$REDPANDA_REPO/contents/bazel/thirdparty/$p?ref=$AVRO_PATCH_REF" \
                -q '.content' | base64 -d >"$TP_DIR/$p"
        else
            curl -fsSL \
                "https://raw.githubusercontent.com/$REDPANDA_REPO/$AVRO_PATCH_REF/bazel/thirdparty/$p" \
                -o "$TP_DIR/$p"
        fi
        (cd "$AVRO_EXTRACT" && patch -p1 <"$TP_DIR/$p")
    done
fi

echo "third_party ready:"
echo "  fmt   -> $FMT_INCLUDE ($FMT_TAG)"
echo "  boost -> $BOOST_INCLUDE ($BOOST_VER)"
echo "  avro  -> $AVRO_SRC (redpanda fork @ ${AVRO_SHA:0:12}, patched)"

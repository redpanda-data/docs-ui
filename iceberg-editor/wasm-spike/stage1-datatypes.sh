#!/usr/bin/env bash
# STAGE 1 — cheap, high-confidence proof (no external libraries).
# Compile iceberg/datatypes.cc to a wasm object using only fmt + the shim.
# If this fails, the Seastar/base shim is incomplete; fix shim/ before Avro.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

require emcc
[ -f "$VENDOR_DIR/iceberg/datatypes.cc" ] || {
    echo "Run ./fetch-sources.sh first." >&2; exit 1; }
[ -d "$FMT_INCLUDE" ] || {
    echo "Run ./third_party/fetch-deps.sh first (fmt missing)." >&2; exit 1; }

mkdir -p "$BUILD_DIR"
echo "Stage 1: compiling iceberg/datatypes.cc -> wasm object ..."

# Include order matters: shim/ first so its headers win over any real ones.
emcc -std=c++20 -c \
    -DFMT_HEADER_ONLY=1 \
    -I "$SHIM_DIR" \
    -I "$VENDOR_DIR" \
    -I "$FMT_INCLUDE" \
    "$VENDOR_DIR/iceberg/datatypes.cc" \
    -o "$BUILD_DIR/datatypes.o"

echo "PASS: datatypes.cc compiled to $BUILD_DIR/datatypes.o"
echo "The Iceberg type model + base utils compile under Emscripten with the shim."

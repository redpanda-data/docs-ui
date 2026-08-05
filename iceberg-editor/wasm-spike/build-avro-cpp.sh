#!/usr/bin/env bash
# Compile Apache Avro C++ (Redpanda's fork) to WebAssembly objects with emcc.
#
# We compile the sources directly rather than via CMake: the docs tool only
# needs schema PARSING (compileJsonSchemaFromString + the Node/Schema API), so
# we skip the codegen CLI (avrogencpp.cc) and container-file I/O (DataFile.cc,
# which needs Snappy/zlib codecs). This proved simpler and more portable under
# Emscripten than driving Avro's CMake.
#
# Objects land in $BUILD_DIR/wasm-obj/ and are linked by stage2-schema-avro.sh.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

require emcc
[ -d "$AVRO_SRC/include/avro" ] || {
    echo "Avro fork missing. Run ./third_party/fetch-deps.sh first." >&2; exit 1; }
[ -d "$FMT_INCLUDE" ] || {
    echo "fmt missing. Run ./third_party/fetch-deps.sh first." >&2; exit 1; }
[ -d "$BOOST_INCLUDE/boost" ] || {
    echo "boost missing. Run ./third_party/fetch-deps.sh first." >&2; exit 1; }

OBJ="$BUILD_DIR/wasm-obj"
mkdir -p "$OBJ"

# Avro's own .cc files include their headers unqualified (e.g. "Decoder.hh"),
# so both include/ and include/avro/ must be on the path.
AVRO_INCS=(-I "$FMT_INCLUDE" -I "$BOOST_INCLUDE"
           -I "$AVRO_SRC/include" -I "$AVRO_SRC/include/avro")

echo "Compiling Avro C++ (fork) sources to wasm objects ..."
n=0
for f in "$AVRO_SRC"/impl/*.cc "$AVRO_SRC"/impl/parsing/*.cc \
         "$AVRO_SRC"/impl/json/*.cc; do
    base="$(basename "$f")"
    # Skip the codegen CLI (own main) and container-file I/O (codec deps).
    case "$base" in avrogencpp.cc | DataFile.cc) continue ;; esac
    emcc -std=c++20 -c -DFMT_HEADER_ONLY=1 "${AVRO_INCS[@]}" \
        "$f" -o "$OBJ/${base%.cc}.o"
    n=$((n + 1))
done
echo "PASS: compiled $n Avro C++ sources to $OBJ/"

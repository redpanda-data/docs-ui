#!/usr/bin/env bash
# STAGE 2 — the real proof. Compile the iceberg conversion TUs (datatypes.cc,
# avro_utils.cc, schema_avro.cc) + the driver to wasm, link against the Avro C++
# wasm objects from build-avro-cpp.sh, and run under node. A printed "OK:" line
# means the production C++ schema mapper (iceberg::type_to_iceberg) runs in wasm.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

require emcc
require node
[ -f "$VENDOR_DIR/iceberg/conversion/schema_avro.cc" ] || {
    echo "Run ./fetch-sources.sh first." >&2; exit 1; }

OBJ="$BUILD_DIR/wasm-obj"
[ -n "$(ls "$OBJ"/*.o 2>/dev/null)" ] || {
    echo "No Avro objects. Run ./build-avro-cpp.sh first." >&2; exit 1; }

ICE_INCS=(-I "$SHIM_DIR" -I "$VENDOR_DIR" -I "$FMT_INCLUDE")
AVRO_INCS=(-I "$BOOST_INCLUDE" -I "$AVRO_SRC/include" -I "$AVRO_SRC/include/avro")

echo "Compiling iceberg conversion TUs + driver to wasm ..."
# datatypes.cc needs no Avro/Boost; the mappers and driver do.
emcc -std=c++20 -c -DFMT_HEADER_ONLY=1 "${ICE_INCS[@]}" \
    "$VENDOR_DIR/iceberg/datatypes.cc" -o "$OBJ/ice_datatypes.o"
emcc -std=c++20 -c -DFMT_HEADER_ONLY=1 "${ICE_INCS[@]}" "${AVRO_INCS[@]}" \
    "$VENDOR_DIR/iceberg/conversion/avro_utils.cc" -o "$OBJ/ice_avro_utils.o"
emcc -std=c++20 -c -DFMT_HEADER_ONLY=1 "${ICE_INCS[@]}" "${AVRO_INCS[@]}" \
    "$VENDOR_DIR/iceberg/conversion/schema_avro.cc" -o "$OBJ/ice_schema_avro.o"
emcc -std=c++20 -c -DFMT_HEADER_ONLY=1 "${ICE_INCS[@]}" "${AVRO_INCS[@]}" \
    "$(dirname "${BASH_SOURCE[0]}")/poc_main.cc" -o "$OBJ/poc_main.o"

OUT="$BUILD_DIR/iceberg-schema-poc.js"
echo "Linking -> $OUT ..."
emcc -std=c++20 "$OBJ"/*.o \
    -s ALLOW_MEMORY_GROWTH=1 -s EXIT_RUNTIME=1 \
    -o "$OUT"

echo "Running under node ..."
node "$OUT"
echo ""
echo "If you see 'OK:' above, the real C++ schema mapper runs in wasm."
echo "Green light to build the full engine module (value mapper, DSL, bindings)."

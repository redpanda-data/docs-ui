#!/usr/bin/env bash
# Build the Iceberg engine WASM module (real C++ Avro->Iceberg schema mapper
# + Embind bindings) for a JS host.
#
# Reuses the vendored Redpanda source, Seastar shim, and third-party deps that
# the feasibility spike fetches (../wasm-spike). Run the spike's
# fetch-sources.sh + third_party/fetch-deps.sh first (build-avro-cpp.sh is NOT
# required — this script compiles Avro itself, with exceptions enabled so the
# binding's try/catch can return a JSON error instead of aborting).
#
# Usage:
#   ./build.sh node   -> build/iceberg-engine-node.js  (test under node)
#   ./build.sh web    -> ../../src/static/iceberg-engine.js(+.wasm)  (docs-ui)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE="$HERE/../wasm-spike"
TARGET="${1:-web}"

SHIM="$SPIKE/shim"
VENDOR="$SPIKE/vendor"
TP="$SPIKE/third_party"
AVRO="$TP/avro-cpp"

command -v emcc >/dev/null 2>&1 || { echo "emcc not on PATH" >&2; exit 127; }
[ -f "$VENDOR/iceberg/conversion/schema_avro.cc" ] || {
    echo "Redpanda source missing. Run ../wasm-spike/fetch-sources.sh first." >&2
    exit 1
}
[ -d "$AVRO/include/avro" ] || {
    echo "Avro missing. Run ../wasm-spike/third_party/fetch-deps.sh first." >&2
    exit 1
}

# -fexceptions everywhere: Avro throws on malformed input and the binding
# catches it; both sides must share the same exception ABI.
EXC="-fexceptions"
ICE_INCS=(-I "$SHIM" -I "$VENDOR" -I "$TP/fmt/include")
AVRO_INCS=(-I "$TP/fmt/include" -I "$TP/boost" -I "$AVRO/include" -I "$AVRO/include/avro")

OBJ="$HERE/build/obj"
mkdir -p "$OBJ"

echo "Compiling Avro C++ (schema subset) with exceptions ..."
for f in "$AVRO"/impl/*.cc "$AVRO"/impl/parsing/*.cc "$AVRO"/impl/json/*.cc; do
    base="$(basename "$f")"
    case "$base" in avrogencpp.cc | DataFile.cc) continue ;; esac
    o="$OBJ/avro_${base%.cc}.o"
    [ -f "$o" ] && [ "$o" -nt "$f" ] && continue
    emcc -std=c++20 -c $EXC -DFMT_HEADER_ONLY=1 "${AVRO_INCS[@]}" "$f" -o "$o"
done

echo "Compiling iceberg conversion TUs + binding ..."
emcc -std=c++20 -c $EXC -DFMT_HEADER_ONLY=1 "${ICE_INCS[@]}" \
    "$VENDOR/iceberg/datatypes.cc" -o "$OBJ/ice_datatypes.o"
emcc -std=c++20 -c $EXC -DFMT_HEADER_ONLY=1 "${ICE_INCS[@]}" "${AVRO_INCS[@]}" \
    "$VENDOR/iceberg/conversion/avro_utils.cc" -o "$OBJ/ice_avro_utils.o"
emcc -std=c++20 -c $EXC -DFMT_HEADER_ONLY=1 "${ICE_INCS[@]}" "${AVRO_INCS[@]}" \
    "$VENDOR/iceberg/conversion/schema_avro.cc" -o "$OBJ/ice_schema_avro.o"
emcc -std=c++20 -c $EXC -DFMT_HEADER_ONLY=1 "${ICE_INCS[@]}" "${AVRO_INCS[@]}" \
    "$HERE/iceberg_wasm.cc" -o "$OBJ/iceberg_wasm.o"

LINK=(-std=c++20 $EXC --bind -O2 "$OBJ"/*.o -s ALLOW_MEMORY_GROWTH=1
    -s MODULARIZE=1 -s EXPORT_NAME=createIcebergEngine)

if [ "$TARGET" = "node" ]; then
    echo "Linking Node test module ..."
    emcc "${LINK[@]}" -s ENVIRONMENT=node -o "$HERE/build/iceberg-engine-node.js"
    echo "PASS: $HERE/build/iceberg-engine-node.js"
else
    OUTDIR="$HERE/../../src/static"
    echo "Linking browser module -> $OUTDIR/iceberg-engine.js ..."
    emcc "${LINK[@]}" -s "ENVIRONMENT=web,worker" \
        -o "$OUTDIR/iceberg-engine.js"
    echo "PASS: $OUTDIR/iceberg-engine.js (+ .wasm)"
fi

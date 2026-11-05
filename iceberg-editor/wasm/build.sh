#!/usr/bin/env bash
# Build the Iceberg engine WASM module for a JS host: Redpanda's own
# redpanda.iceberg.mode parser and formatter (model.cc) and, in releases that
# have it, the real C++ Avro->Iceberg schema mapper, with Embind bindings.
#
# Reuses the vendored Redpanda source, Seastar shim, and third-party deps that
# ../wasm-spike fetches. Run ../wasm-spike/fetch-sources.sh and
# ../wasm-spike/third_party/fetch-deps.sh first (build-avro-cpp.sh is NOT
# required: this script compiles Avro itself, with exceptions enabled so the
# binding's try/catch can return a JSON error instead of aborting).
#
# Usage:
#   ./build.sh node   -> build/iceberg-engine-node.js  (test under node)
#   ./build.sh web    -> ../../src/static/iceberg-engine.js(+.wasm)  (docs-ui)
#   ./build.sh test   -> runs the release's own model/tests/iceberg_mode_test.cc
#                        (minus wire-format tests) against the same extracted
#                        code, compiled to WASM with googletest, under node.
#                        Exits 0 with a note when the release has no such test.
# ICEBERG_ENGINE_OUT overrides the output .js path (the .wasm goes beside it).
# ICEBERG_SCHEMA_MAPPER=0 builds the parser only even when the revision has the
# schema mapper sources (the shims track the current tree, so an older
# release's mapper may not compile; the explorer then draws its illustrative
# schema, as it does with no engine).
set -euo pipefail

WASM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE="$WASM_DIR/../wasm-spike"
TARGET="${1:-web}"
# shellcheck source=../wasm-spike/env.sh
source "$SPIKE/env.sh"
# env.sh sets HERE to its own directory.
HERE="$WASM_DIR"

SHIM="$SHIM_DIR"
VENDOR="$VENDOR_DIR"
TP="$TP_DIR"
AVRO="$AVRO_SRC"

command -v emcc >/dev/null 2>&1 || { echo "emcc not on PATH" >&2; exit 127; }
command -v node >/dev/null 2>&1 || { echo "node not on PATH" >&2; exit 127; }
[ -f "$VENDOR/model/model.cc" ] || {
    echo "Redpanda source missing. Run ../wasm-spike/fetch-sources.sh first." >&2
    exit 1
}
[ -d "$ABSEIL_SRC/absl" ] && [ -d "$FMT_INCLUDE/fmt" ] || {
    echo "fmt / Abseil missing. Run ../wasm-spike/third_party/fetch-deps.sh first." >&2
    exit 1
}
SCHEMA=0
if [ -e "$SCHEMA_MAPPER_MARKER" ] && [ "${ICEBERG_SCHEMA_MAPPER:-1}" != 0 ]; then
    SCHEMA=1
    [ -d "$AVRO/include/avro" ] || {
        echo "Avro missing. Run ../wasm-spike/third_party/fetch-deps.sh first." >&2
        exit 1
    }
fi

COMMIT="$(cat "$REDPANDA_COMMIT_FILE")"
REF="$(cat "$VENDOR/REDPANDA_REF" 2>/dev/null || echo "$COMMIT")"
# Size matters more than speed here: the engine is downloaded by every reader
# of a page with an explorer, and committed to the docs repo per release.
# ICEBERG_OPT overrides it (for example -O2 to compare).
OPT="${ICEBERG_OPT:--Oz}"
# Objects are per revision and optimization level, so switching either never
# links a stale one.
OBJ="$HERE/build/obj-$COMMIT${OPT}"
GEN="$OBJ/gen"
mkdir -p "$OBJ" "$GEN"

# -fexceptions everywhere: Avro throws on malformed input, lexical_cast throws
# on a rejected property value, and the bindings catch both.
EXC="-fexceptions"
CXX=(emcc -std=c++23 -c $EXC $OPT -DFMT_HEADER_ONLY=1 -Wno-deprecated-pragma)
ICE_INCS=(-I "$SHIM" -I "$VENDOR" -I "$FMT_INCLUDE")
AVRO_INCS=(-I "$FMT_INCLUDE" -I "$BOOST_INCLUDE" -I "$AVRO/include" -I "$AVRO/include/avro")

# ── iceberg_mode, cut out of this release's model.cc ─────────────────────────
echo "Extracting iceberg_mode from model/metadata.h + model/model.cc ..."
node "$HERE/extract-iceberg-mode.js" "$VENDOR/model/metadata.h" "$VENDOR/model/model.cc" "$GEN"
MODE_DEFS=(-DICEBERG_ENGINE_REF="\"$REF\"" -DICEBERG_ENGINE_COMMIT="\"$COMMIT\"")
# parse_iceberg_mode (v26.2 and later) gives Redpanda's own rejection message.
if grep -q 'parse_iceberg_mode' "$GEN/iceberg_mode.h"; then
    MODE_DEFS+=(-DICEBERG_HAS_PARSE_ICEBERG_MODE=1)
fi
MODE_INCS=(-I "$GEN" -I "$HERE/mode" -I "$SHIM" -I "$VENDOR" -I "$FMT_INCLUDE"
    -I "$BOOST_INCLUDE" -I "$ABSEIL_SRC")

# The Abseil the parser links: StrSplit and flat_hash_map (and what they
# call). An archive, so the linker takes only what is used.
ABSL_VER="$(basename "$(cd "$ABSEIL_SRC" && pwd -P)")"
ABSL_LIB="$HERE/build/lib$ABSL_VER.a"
if [ ! -f "$ABSL_LIB" ]; then
    echo "Compiling $ABSL_VER (parser subset) ..."
    ABSL_OBJ="$HERE/build/obj-$ABSL_VER"
    mkdir -p "$ABSL_OBJ"
    for f in \
        absl/base/internal/raw_logging.cc \
        absl/base/internal/throw_delegate.cc \
        absl/container/internal/raw_hash_set.cc \
        absl/hash/internal/hash.cc \
        absl/hash/internal/city.cc \
        absl/hash/internal/low_level_hash.cc \
        absl/strings/ascii.cc \
        absl/strings/match.cc \
        absl/strings/numbers.cc \
        absl/strings/str_split.cc \
        absl/strings/internal/memutil.cc \
        absl/numeric/int128.cc; do
        [ -f "$ABSEIL_SRC/$f" ] || continue
        o="$ABSL_OBJ/$(echo "$f" | tr '/' '_' | sed 's/\.cc$/.o/')"
        "${CXX[@]}" -I "$ABSEIL_SRC" "$ABSEIL_SRC/$f" -o "$o"
    done
    emar rcs "$ABSL_LIB" "$ABSL_OBJ"/*.o
fi

echo "Compiling iceberg_mode (redpanda @ $REF) + binding ..."
"${CXX[@]}" "${MODE_DEFS[@]}" "${MODE_INCS[@]}" "$GEN/iceberg_mode.cc" -o "$OBJ/mode_iceberg_mode.o"
"${CXX[@]}" "${MODE_DEFS[@]}" "${MODE_INCS[@]}" "$HERE/iceberg_mode_wasm.cc" -o "$OBJ/mode_binding.o"

if [ "$TARGET" = "test" ]; then
    TEST_SRC="$VENDOR/model/tests/iceberg_mode_test.cc"
    if [ ! -f "$TEST_SRC" ]; then
        echo "No model/tests/iceberg_mode_test.cc at $REF: nothing to run."
        exit 0
    fi
    [ -d "$GTEST_SRC/googletest" ] || {
        echo "googletest missing. Run ../wasm-spike/third_party/fetch-deps.sh first." >&2
        exit 1
    }
    node "$HERE/extract-iceberg-mode.js" --tests "$TEST_SRC" "$GEN"
    GT=(-I "$GTEST_SRC/googletest/include" -I "$GTEST_SRC/googletest"
        -I "$GTEST_SRC/googlemock/include" -I "$GTEST_SRC/googlemock" -DGTEST_HAS_PTHREAD=0)
    GT_LIB="$HERE/build/lib$(basename "$(cd "$GTEST_SRC" && pwd -P)").a"
    if [ ! -f "$GT_LIB" ]; then
        echo "Compiling googletest ..."
        "${CXX[@]}" "${GT[@]}" "$GTEST_SRC/googletest/src/gtest-all.cc" -o "$OBJ/gtest-all.o"
        "${CXX[@]}" "${GT[@]}" "$GTEST_SRC/googlemock/src/gmock-all.cc" -o "$OBJ/gmock-all.o"
        "${CXX[@]}" "${GT[@]}" "$GTEST_SRC/googletest/src/gtest_main.cc" -o "$OBJ/gtest_main.o"
        emar rcs "$GT_LIB" "$OBJ/gtest-all.o" "$OBJ/gmock-all.o" "$OBJ/gtest_main.o"
    fi
    "${CXX[@]}" "${MODE_DEFS[@]}" "${MODE_INCS[@]}" "${GT[@]}" "$GEN/iceberg_mode_test.cc" -o "$OBJ/mode_test.o"
    OUT="$HERE/build/iceberg-mode-test-$COMMIT.js"
    emcc -std=c++23 $EXC $OPT "$OBJ/mode_iceberg_mode.o" "$OBJ/mode_test.o" "$GT_LIB" "$ABSL_LIB" \
        -s ENVIRONMENT=node -s ALLOW_MEMORY_GROWTH=1 -s EXIT_RUNTIME=1 -o "$OUT"
    echo "Running $REF's iceberg_mode_test.cc against the extracted parser ..."
    node "$OUT"
    exit $?
fi

OBJS=("$OBJ/mode_iceberg_mode.o" "$OBJ/mode_binding.o")

# ── The Avro -> Iceberg schema mapper (v26.1 and later) ─────────────────────
if [ "$SCHEMA" = 1 ]; then
    echo "Compiling Avro C++ (schema subset) with exceptions ..."
    for f in "$AVRO"/impl/*.cc "$AVRO"/impl/parsing/*.cc "$AVRO"/impl/json/*.cc; do
        base="$(basename "$f")"
        case "$base" in avrogencpp.cc | DataFile.cc) continue ;; esac
        o="$OBJ/avro_${base%.cc}.o"
        [ -f "$o" ] && [ "$o" -nt "$f" ] && { OBJS+=("$o"); continue; }
        emcc -std=c++20 -c $EXC -DFMT_HEADER_ONLY=1 "${AVRO_INCS[@]}" "$f" -o "$o"
        OBJS+=("$o")
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
    OBJS+=("$OBJ/ice_datatypes.o" "$OBJ/ice_avro_utils.o" "$OBJ/ice_schema_avro.o" "$OBJ/iceberg_wasm.o")
else
    echo "No schema mapper at this revision: parser-only engine."
fi

LINK=(-std=c++23 $EXC --bind $OPT "${OBJS[@]}" "$ABSL_LIB" -s ALLOW_MEMORY_GROWTH=1
    -s MODULARIZE=1 -s EXPORT_NAME=createIcebergEngine)

if [ "$TARGET" = "node" ]; then
    OUT="${ICEBERG_ENGINE_OUT:-$HERE/build/iceberg-engine-node.js}"
    echo "Linking Node test module -> $OUT ..."
    mkdir -p "$(dirname "$OUT")"
    emcc "${LINK[@]}" -s ENVIRONMENT=node -o "$OUT"
else
    OUT="${ICEBERG_ENGINE_OUT:-$HERE/../../src/static/iceberg-engine.js}"
    echo "Linking browser module -> $OUT ..."
    mkdir -p "$(dirname "$OUT")"
    emcc "${LINK[@]}" -s "ENVIRONMENT=web,worker" -o "$OUT"
fi
echo "PASS: $OUT (+ .wasm), redpanda @ $REF ($COMMIT), schema mapper: $([ "$SCHEMA" = 1 ] && echo yes || echo no)"

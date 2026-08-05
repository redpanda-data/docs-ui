#!/usr/bin/env bash
# Shared configuration for the spike scripts. Sourced by the others.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Which Redpanda ref to pull real source from. Use `dev` while iterating; pin to
# a release tag (e.g. v26.2.1) to reproduce a specific version's behavior — this
# is the same knob the per-release CI will drive.
export REDPANDA_REF="${REDPANDA_REF:-dev}"
export REDPANDA_REPO="${REDPANDA_REPO:-redpanda-data/redpanda}"

export SHIM_DIR="$HERE/shim"
export VENDOR_DIR="$HERE/vendor"
export TP_DIR="$HERE/third_party"
export BUILD_DIR="$HERE/build"

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

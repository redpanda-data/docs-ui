# iceberg-editor

WASM engine tooling for the interactive **Iceberg Mode Explorer** docs tool,
mirroring the layout of `blobl-editor/` (the Bloblang playground's Go→WASM
engine).

Unlike Bloblang — whose engine is Go and wraps `benthos` directly — Iceberg
mode translation is implemented in **C++** in the Redpanda core
(`redpanda/src/v/iceberg/conversion/` + `src/v/datalake/`). To keep the docs
tool faithful to production behavior (and to stay current automatically, one
build per `major.minor` release), the engine is the **real C++ translation code
compiled to WebAssembly with Emscripten**, not a re-implementation.

## What the engine contains

- **The `redpanda.iceberg.mode` parser and formatter** from the release's own
  `src/v/model/model.cc`. `wasm/extract-iceberg-mode.js` cuts `iceberg_mode`
  and its parse and format functions out of `model/metadata.h` and
  `model/model.cc` (upstream text, item by item, minus the serde wire format),
  and `wasm/build.sh` compiles them with the fmt and Abseil versions that
  release's `MODULE.bazel` pins. `wasm/iceberg_mode_wasm.cc` exports
  `parseIcebergMode`, `formatIcebergMode` and `icebergEngineInfo`. Every
  release with Iceberg (v24.3 onward) builds.
- **The Avro -> Iceberg schema mapper** (`iceberg/conversion/`), for releases
  where it compiles with the shims in `wasm-spike/shim/`, which track the
  current tree. Otherwise `ICEBERG_SCHEMA_MAPPER=0` builds the parser only and the
  explorer draws its illustrative schema.

The explorer (`src/js/iceberg-explorer.js`) asks the page's engine which
choices the release accepts, and what Redpanda stores for each setting. There
is no table of versions to keep up to date.

## Building locally

Redpanda's source is in the private `redpanda-data/streaming-enterprise`
repository; `gh auth login` with access to it (or `GH_TOKEN`).

```sh
cd wasm-spike
REDPANDA_REF=v26.2.1 REDPANDA_REQUIRE_PINNED=1 ./fetch-sources.sh
./third_party/fetch-deps.sh
cd ../wasm
./build.sh test   # the release's iceberg_mode_test.cc against the compiled parser
./build.sh node   # build/iceberg-engine-node.js, for npm run test:iceberg-engine
ICEBERG_ENGINE_OUT=../../src/static/iceberg-engine-26.2.js ./build.sh web   # preview
```

`VENDOR_DIR=.../vendor-<ref>` keeps several releases side by side, and
`ICEBERG_ENGINE_OUT=build/engines/<ref>/iceberg-engine-node.js` lets
`npm run test:iceberg-engine` check them all.

## Publishing

`.github/workflows/build-iceberg-engine.yml` runs daily.
`ci/engine-targets.js` picks every supported docs version (docs `main` and
`v/X.Y` branches inside the end-of-life window) whose published engine is not
from that major.minor's latest patch tag, builds it, runs the release's tests
and `tests/iceberg-engine`, and opens a PR to that docs branch adding
`modules/reference/attachments/iceberg-engine-<X.Y>.{js,wasm,json}`.
`src/partials/head-meta.hbs` points each streaming page at its version's
engine, and the explorer checks the engine was built from that release.

## Status

- `wasm-spike/` — a **feasibility spike** that proves the hardest dependency
  (Apache Avro C++ + a thin Seastar shim + the `iceberg/conversion` schema
  mapper) compiles and links under Emscripten. Run this **before** investing in
  the full engine module. See `wasm-spike/README.md`.

## Why a spike first

The schema/value mappers are synchronous and free of Seastar's reactor, but the
shared Iceberg type model (`iceberg/datatypes.h`) transitively includes a few
Seastar utility types (`ss::sstring`, `chunked_vector`) and Redpanda base utils.
The spike confirms those can be shimmed and that Avro C++ builds under
Emscripten. If the spike passes, the remaining work (value mapper, DSL, JSON
bindings, per-release CI) is mechanical.

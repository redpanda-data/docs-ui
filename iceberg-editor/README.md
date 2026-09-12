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

# Iceberg engine — Emscripten feasibility spike

**Goal:** prove that Redpanda's real C++ Iceberg **schema** mapper
(`iceberg::type_to_iceberg`) compiles and links to WebAssembly under Emscripten,
against an Emscripten build of **Avro C++**, using a thin **Seastar shim** in
place of the reactor. If this passes, the full C++→WASM engine (value mapper,
DSL parser, JSON bindings, per-release CI) is mechanical.

## ✅ RESULT: PASS (verified 2026-07-22)

The real production mapper runs in wasm. `stage2-schema-avro.sh` prints:

```text
OK: converted Avro record to iceberg::struct_type with 3 field(s)
```

**Verified toolchain (the coherent combo that works — versions matter):**

| Component | Version / ref | Note |
| --- | --- | --- |
| Emscripten | 6.0.3 | `brew install emscripten` |
| fmt | **12.1.0** | matches redpanda `MODULE.bazel`; fmt 11 fails |
| Avro C++ | **redpanda-data/avro** @ `6821e2b4…` + redpanda's patches | resolved from `bazel/repositories.bzl` at the pinned Redpanda revision; upstream apache/avro 1.12 does **not** compile under fmt 12 |
| Boost | 1.85.0 (headers) | for `boost::outcome` |
| Redpanda source | `dev` | `iceberg/datatypes.cc`, `conversion/{avro_utils,schema_avro}.cc` |

**What the shim had to provide** (all small, in `shim/`): `ss::sstring`→
`std::string`, `ss::chunked_vector`→`std::vector`, `ss::bool_class` (+ its fmt
formatter), `ss::visit`/`make_visitor`, `ssx::sformat`, no-op `ss::logger`,
`ss::defer`, `vassert`, an fmt formatter for `std::exception_ptr`, and a
schema-only `conversion_outcome.h` that drops the `values.h` (iobuf/absl)
include the schema path doesn't need.

**Green light** to build the full engine. Remaining work is mechanical and
additive: the **value** mapper (`values_avro.cc` → pulls in `values.h` →
`iobuf`/`absl`, the next dependency to size), the **Protobuf** path
(`schema_protobuf.cc` + libprotobuf-wasm), the tiny **DSL** parser
(`model/model.cc`, spec'd by `model/tests/iceberg_mode_test.cc`), Emscripten
**bindings** for `iceberg_translate(config, schema, record) → JSON`, and the
**per-release CI** that emits `iceberg-engine-<major.minor>.wasm`.

This directory contains **no compiled artifacts** and **no vendored Redpanda
source** — real source is fetched from a pinned `redpanda` ref at run time
(`fetch-sources.sh`), which also mirrors the per-release build model. Nothing
here has been compiled in-repo; it is meant to be run where `emcc` is available.

## Prerequisites

- [emsdk / Emscripten](https://emscripten.org/docs/getting_started/downloads.html)
  (`emcc`, `emcmake`, `em++`) on `PATH`.
- `cmake`, `git`, `curl`, and `gh` (for fetching pinned Redpanda source; falls
  back to raw HTTPS if `gh` is unavailable).
- `node` (to run the resulting `.wasm`).

## What gets proven, in two stages

The spike is deliberately staged so a cheap, high-confidence check runs before
the expensive external-library step.

### Stage 1 — `stage1-datatypes.sh` (no external libraries)

Compiles `iceberg/datatypes.cc` to a wasm object with `emcc -c`, using only:
`fmt` (header-only), the Seastar shim (`shim/`), `named_type.h`, and a `vassert`
shim. **Proves** the Iceberg type model + Redpanda base utils compile under
Emscripten with the shim. If this fails, the shim is wrong — fix it here before
touching Avro.

### Stage 2 — `stage2-schema-avro.sh` (the real unknown)

Builds Apache Avro C++ for wasm (`build-avro-cpp.sh`), then compiles
`datatypes.cc` + `schema_avro.cc` + `poc_main.cc` and links them against the
Avro C++ wasm library into `build/iceberg-schema-poc.wasm`. `poc_main.cc`
parses a small Avro schema and calls `iceberg::type_to_iceberg`, so a successful
`node build/iceberg-schema-poc.js` run proves the whole path works end to end.

To sever the schema mapper from `iobuf`/`absl` (which are only pulled in
transitively via `conversion_outcome.h` → `values.h`, and are needed only by the
*value* mapper), the spike puts a **schema-only** `conversion_outcome.h` on the
include path (`shim/iceberg/conversion/conversion_outcome.h`) that keeps
`result<>` and `conversion_exception` but drops the `values.h` include. This is
a legitimate simplification and documents that the schema and value paths have
different dependency footprints.

## Run it

```bash
export REDPANDA_REF=dev          # or a release tag, e.g. v26.2.1
./fetch-sources.sh               # pulls real source into vendor/ at $REDPANDA_REF
./stage1-datatypes.sh            # cheap proof (no Avro)
./build-avro-cpp.sh              # builds Avro C++ for wasm (slow, one-time)
./stage2-schema-avro.sh          # the real proof; runs the wasm via node
```

`fetch-sources.sh` resolves `$REDPANDA_REF` to a commit once, fetches every file
at that commit, and records it in `vendor/REDPANDA_COMMIT`.
`third_party/fetch-deps.sh` then reads that commit and takes the Avro fork
revision, its `sha256`, and the patch set from `bazel/repositories.bzl` at the
same revision — all three change between Redpanda releases — so one build maps
to exactly one Redpanda revision. For a release build, set
`REDPANDA_REQUIRE_PINNED=1` to reject a mutable ref such as `dev`;
`.github/workflows/build-iceberg-engine.yml` always sets it, and ships the
resolved commit next to the engine as
`dist/iceberg-engine-<version>.provenance.json`.

## Interpreting results (this is the decision the spike exists to inform)

- **Stage 1 fails to compile** → the Seastar/base shim is incomplete. Extend
  `shim/` until `datatypes.cc` compiles. Low risk; expected to be quick.
- **`build-avro-cpp.sh` fails** → Avro C++ (or its deps: Boost, Snappy) doesn't
  build cleanly under Emscripten. This is the biggest risk. If it's only
  optional features (codecs), disable them (`-DAVRO_*`), since the docs tool only
  needs schema parsing, not container files/compression.
- **Stage 2 compiles + `node` prints `OK`** → **green light.** The real
  translation code runs in wasm. Proceed to the full engine module: add the
  value mapper (`values_avro.cc`, which pulls in `values.h` → `iobuf`/`absl`; the
  next dependency to size), the Protobuf path, the DSL parser (tiny; specified by
  `model/tests/iceberg_mode_test.cc`), Emscripten bindings for
  `iceberg_translate(config, schema, record) → JSON`, and the release-tag CI.

## Files

| Path | Purpose |
| --- | --- |
| `fetch-sources.sh` | Fetch real Redpanda source at `$REDPANDA_REF` into `vendor/` |
| `shim/base/seastarx.h` | `ss` = `seastar` namespace alias (matches real) |
| `shim/base/vassert.h` | `vassert(...)` → `assert`/`abort` |
| `shim/seastar/core/sstring.hh` | `ss::sstring` → `std::string` |
| `shim/seastar/core/chunked_vector.hh` | `ss::chunked_vector` → `std::vector` |
| `shim/seastar/util/bool_class.hh` | `ss::bool_class<Tag>` strong-typedef bool |
| `shim/seastar/util/defer.hh` | Minimal `ss::defer` |
| `shim/seastar/util/log.hh` | No-op `ss::logger` |
| `shim/iceberg/conversion/conversion_outcome.h` | Schema-only outcome (no `values.h`) |
| `poc_main.cc` | Parses an Avro schema, calls `type_to_iceberg` |
| `stage1-datatypes.sh` | Compile-only proof of the shim closure |
| `build-avro-cpp.sh` | Build Apache Avro C++ for wasm |
| `stage2-schema-avro.sh` | Compile + link + run the schema-mapper wasm |
| `third_party/` | Downloaded deps (fmt, boost.outcome, avro-cpp); git-ignored |
| `vendor/` | Fetched Redpanda source; git-ignored |
| `build/` | Build outputs; git-ignored |

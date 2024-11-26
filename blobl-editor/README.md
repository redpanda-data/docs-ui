# WebAssembly Bloblang Editor

This directory hosts the source code for the Wasm module that provides the Redpanda docs with the ability to execute Bloblang mappings.

The Wasm module is built automatically when you bundle the UI with `gulp bundle`.

To build the Wasm module manually:

```shell
GOOS=js GOARCH=wasm go build -o ./src/static/blobl.wasm ./cmd/wasm
cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" ./static
```

# WebAssembly (WASM) bloblang editor

This is a WASM implementation of `benthos blobl server`.

## Build WASM module

```shell
> GOOS=js GOARCH=wasm go build -o ./src/static/blobl.wasm ./cmd/wasm
> cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" ./static
```

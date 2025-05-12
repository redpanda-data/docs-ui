# Bloblang Playground

This directory hosts the source code for the Wasm module that allows the Redpanda docs to execute Bloblang mappings.
The Wasm module is used in the Bloblang playground defined in [`/src/partials/bloblang-playground.hbs`](/src/partials/bloblang-playground.hbs).

The Wasm module is built automatically when you bundle the UI with `gulp bundle`.

To build the Wasm module manually:

```shell
cd ./blobl-editor/wasm
GOOS=js GOARCH=wasm go build -o ../../src/static/blobl.wasm .
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" ../../src/static
```

## Update Go modules for the Wasm module

To ensure the dependencies are up-to-date, we have automated workflows to update Go modules and create a pull request. These workflows can be triggered manually or automatically using a repository dispatch event in the `connect` repository.

### Automatic trigger

The workflow is set up to be triggered by a **repository dispatch** event from the `connect` repository. When a new tag is pushed in the `connect` repository, the following happens:
- The event type `update-go-mod` is dispatched.
- The `docs-ui` workflow runs automatically to update Go modules and create a pull request.

---

### Manual trigger

You can manually trigger the workflow in the `docs-ui` repository to update dependencies and create a pull request.

1. Navigate to the **Actions** tab in the `docs-ui` repository on GitHub.
2. Locate the **Update Go Modules** workflow (defined in `.github/workflows/update-go-modules.yml`).
3. Click **"Run workflow"**.
4. The workflow will:
   - Update Go dependencies with `go get -u ./...` and `go mod tidy`.
   - Create a pull request titled `auto-docs: Update Go modules`.

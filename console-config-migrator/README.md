# Configuration Migrator

This directory hosts the source code for the Wasm module that converts Redpanda Console configurations from v2 to v3. The module implements the transformation rules required for migrating authentication settings, Kafka configurations (including schemaRegistry and admin API credentials), role bindings, and other properties. The Wasm module is integrated into the Redpanda documentation, allowing users to migrate their YAML configurations directly in their browser.

## Building the Wasm Module

To build the Wasm module manually:

```shell
GOOS=js GOARCH=wasm go build -o ../src/static/console-config-migrator.wasm main.go
```
// Spike driver: parse a small Avro schema and run the REAL Redpanda schema
// mapper (iceberg::type_to_iceberg) on it. Success here means the production
// C++ translation code compiled and linked to wasm and executed under node.
//
// This intentionally exercises the whole stage-2 path: Avro C++ (schema
// parsing) + the iceberg conversion mapper + the Iceberg type model.

#include "iceberg/conversion/schema_avro.h"
#include "iceberg/datatypes.h"

#include <avro/Compiler.hh>
#include <avro/ValidSchema.hh>

#include <cstdio>
#include <string>

int main() {
    // A minimal Avro record schema, like a Kafka value would carry.
    const std::string schema_json = R"({
      "type": "record",
      "name": "order",
      "fields": [
        {"name": "order_id", "type": "string"},
        {"name": "quantity", "type": "int"},
        {"name": "price", "type": "double"}
      ]
    })";

    avro::ValidSchema schema;
    try {
        schema = avro::compileJsonSchemaFromString(schema_json);
    } catch (const std::exception& e) {
        std::printf("FAIL: could not parse Avro schema: %s\n", e.what());
        return 2;
    }

    auto outcome = iceberg::type_to_iceberg(schema.root());
    if (outcome.has_error()) {
        std::printf(
          "FAIL: type_to_iceberg returned an error: %s\n",
          outcome.error().what());
        return 1;
    }

    // Count top-level fields as a cheap sanity check on the produced struct.
    const auto& struct_type = outcome.value();
    std::printf(
      "OK: converted Avro record to iceberg::struct_type with %zu field(s)\n",
      struct_type.fields.size());
    return 0;
}

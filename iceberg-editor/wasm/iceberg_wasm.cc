// Browser/Node entry point for the Iceberg engine WASM module.
//
// Exposes a single Embind function, `avroToIcebergJson(avroSchemaJson)`, that
// runs Redpanda's REAL C++ Avro->Iceberg schema mapper (iceberg::type_to_iceberg)
// and serializes the resulting iceberg::struct_type to a compact JSON shape the
// docs-ui hydration module already knows how to render:
//
//   { "fields": [ { "name": "...", "type": "<iceberg type>", "required": bool,
//                   "fields": [ ... ] /* only when type == "struct" */ } ] }
//   // or on failure: { "error": "..." }
//
// This is the production translation code compiled to WebAssembly — not a
// re-implementation. See iceberg-editor/wasm-spike for the feasibility proof
// and the pinned toolchain (fmt 12.1.0, redpanda-data/avro fork + patches).

#include "iceberg/conversion/schema_avro.h"
#include "iceberg/datatypes.h"

#include <avro/Compiler.hh>
#include <avro/ValidSchema.hh>
#include <emscripten/bind.h>

#include <string>
#include <variant>

namespace {

template<class... Ts>
struct overloaded : Ts... {
    using Ts::operator()...;
};
template<class... Ts>
overloaded(Ts...) -> overloaded<Ts...>;

void escape_json(const std::string& s, std::string& out) {
    for (char c : s) {
        switch (c) {
        case '"':
            out += "\\\"";
            break;
        case '\\':
            out += "\\\\";
            break;
        case '\n':
            out += "\\n";
            break;
        default:
            out += c;
        }
    }
}

std::string struct_fields_json(const iceberg::struct_type& s);

// Render a field_type as the display type string used by the UI, plus (for
// structs) the nested fields JSON via the out-param.
std::string type_string(const iceberg::field_type& t, std::string& nestedOut) {
    std::string result;
    std::visit(
      overloaded{
        [&](const iceberg::primitive_type& p) {
            result = fmt::format("{}", p);
        },
        [&](const iceberg::struct_type& s) {
            result = "struct";
            nestedOut = struct_fields_json(s);
        },
        [&](const iceberg::list_type& l) {
            std::string ignored;
            result = "list<" + type_string(l.element_field->type, ignored)
                     + ">";
        },
        [&](const iceberg::map_type& m) {
            std::string ik, iv;
            result = "map<" + type_string(m.key_field->type, ik) + ", "
                     + type_string(m.value_field->type, iv) + ">";
        },
      },
      t);
    return result;
}

std::string field_json(const iceberg::nested_field& f) {
    std::string out = "{\"name\":\"";
    escape_json(f.name, out);
    out += "\",\"required\":";
    out += (static_cast<bool>(f.required) ? "true" : "false");
    std::string nested;
    std::string ty = type_string(f.type, nested);
    out += ",\"type\":\"";
    escape_json(ty, out);
    out += "\"";
    if (!nested.empty()) {
        out += ",\"fields\":";
        out += nested;
    }
    out += "}";
    return out;
}

std::string struct_fields_json(const iceberg::struct_type& s) {
    std::string out = "[";
    bool first = true;
    for (const auto& fptr : s.fields) {
        if (!first) {
            out += ",";
        }
        first = false;
        out += field_json(*fptr);
    }
    out += "]";
    return out;
}

std::string avro_to_iceberg_json(const std::string& avro_schema_json) {
    avro::ValidSchema schema;
    try {
        schema = avro::compileJsonSchemaFromString(avro_schema_json);
    } catch (const std::exception& e) {
        std::string out = "{\"error\":\"invalid Avro schema: ";
        escape_json(e.what(), out);
        out += "\"}";
        return out;
    }

    auto outcome = iceberg::type_to_iceberg(schema.root());
    if (outcome.has_error()) {
        std::string out = "{\"error\":\"";
        escape_json(outcome.error().what(), out);
        out += "\"}";
        return out;
    }

    std::string out = "{\"fields\":";
    out += struct_fields_json(outcome.value());
    out += "}";
    return out;
}

} // namespace

EMSCRIPTEN_BINDINGS(iceberg_engine) {
    emscripten::function("avroToIcebergJson", &avro_to_iceberg_json);
}

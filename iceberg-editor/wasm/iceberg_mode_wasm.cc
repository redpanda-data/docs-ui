// Embind bindings for Redpanda's own redpanda.iceberg.mode parser and
// formatter, compiled from the release's model.cc (see
// extract-iceberg-mode.js). The explorer asks this, not a JavaScript port,
// whether a string is valid for the release a page documents, and what
// Redpanda would store and show for it.
//
// A topic property is read the way the Kafka handlers read it
// (kafka/server/handlers/configs/config_utils.h parse_and_set_property and
// topics/types.cc get_config_value): boost::lexical_cast<model::iceberg_mode>
// over the value, which runs model.cc's operator>> and requires it to consume
// the whole string. The stored value is printed with the release's own
// formatter (format_to from v26.2, operator<< before).
//
//   parseIcebergMode(s)  -> JSON {"ok":true,"normalized":"...","extended":bool?}
//                           or   {"ok":false,"error":"..."?}
//   formatIcebergMode(s) -> the normalized string, or "" when s is invalid
//   icebergEngineInfo()  -> JSON {"redpanda_ref":"...","redpanda_commit":"..."}
//
// "error" is Redpanda's own message, from parse_iceberg_mode, in releases
// that have it (v26.2 and later). Older releases only set failbit, so there
// is no message to give. "extended" is iceberg_mode's
// needs_extended_cluster_feature(), in releases that have it: true when the
// value is one only a fully upgraded cluster accepts (config_utils.h
// iceberg_config_validator).
#include "iceberg_mode.h"

#include <boost/lexical_cast.hpp>
#include <fmt/format.h>
#include <emscripten/bind.h>

#include <sstream>
#include <string>

#ifndef ICEBERG_ENGINE_REF
#define ICEBERG_ENGINE_REF ""
#endif
#ifndef ICEBERG_ENGINE_COMMIT
#define ICEBERG_ENGINE_COMMIT ""
#endif

namespace {

std::string json_string(std::string_view s) {
    std::string out = "\"";
    for (unsigned char c : s) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20) {
                char buf[8];
                std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                out += buf;
            } else {
                out += static_cast<char>(c);
            }
        }
    }
    return out + "\"";
}

template<class M>
std::string to_display(const M& m) {
    if constexpr (requires(std::ostream& os, const M& x) { os << x; }) {
        std::ostringstream os;
        os << m;
        return os.str();
    } else {
        return fmt::format("{}", m);
    }
}

template<class M>
std::string extended_field(const M& m) {
    if constexpr (requires(const M& x) { x.needs_extended_cluster_feature(); }) {
        return std::string(",\"extended\":")
               + (m.needs_extended_cluster_feature() ? "true" : "false");
    } else {
        return "";
    }
}

std::string rejection(const std::string& s) {
#ifdef ICEBERG_HAS_PARSE_ICEBERG_MODE
    auto r = model::parse_iceberg_mode(s);
    if (!r) {
        return "{\"ok\":false,\"error\":" + json_string(r.error()) + "}";
    }
#endif
    (void)s;
    return "{\"ok\":false}";
}

std::string parseIcebergMode(std::string s) {
    model::iceberg_mode m{};
    try {
        m = boost::lexical_cast<model::iceberg_mode>(s);
    } catch (const boost::bad_lexical_cast&) {
        return rejection(s);
    }
    return "{\"ok\":true,\"normalized\":" + json_string(to_display(m))
           + extended_field(m) + "}";
}

std::string formatIcebergMode(std::string s) {
    try {
        return to_display(boost::lexical_cast<model::iceberg_mode>(s));
    } catch (const boost::bad_lexical_cast&) {
        return "";
    }
}

std::string icebergEngineInfo() {
    return "{\"redpanda_ref\":" + json_string(ICEBERG_ENGINE_REF)
           + ",\"redpanda_commit\":" + json_string(ICEBERG_ENGINE_COMMIT) + "}";
}

} // namespace

EMSCRIPTEN_BINDINGS(iceberg_mode) {
    emscripten::function("parseIcebergMode", &parseIcebergMode);
    emscripten::function("formatIcebergMode", &formatIcebergMode);
    emscripten::function("icebergEngineInfo", &icebergEngineInfo);
}

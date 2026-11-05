// What model/model.cc brings in for the iceberg_mode definitions that
// extract-iceberg-mode.js copies out of it: Abseil and fmt at the versions
// the release's MODULE.bazel pins, and Redpanda's own strings/string_switch.h
// fetched at the same revision.
#pragma once

#include "absl/container/flat_hash_map.h"
#include "absl/strings/numbers.h"
#include "absl/strings/str_split.h"
#include "absl/strings/strip.h"
#include "strings/string_switch.h"

#include <fmt/format.h>
#include <fmt/ostream.h>

#include <cstring>
#include <iostream>

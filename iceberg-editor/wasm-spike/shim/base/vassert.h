// Spike shim for redpanda's base/vassert.h.
//
// The real macro formats a rich fmt message and aborts. For the spike we only
// need it to compile and to abort on failure; the fmt-style trailing arguments
// are accepted and discarded (they are never evaluated).
#pragma once

#include <cstdio>
#include <cstdlib>

// NOLINTNEXTLINE(cppcoreguidelines-macro-usage)
#define vassert(cond, ...)                                                     \
    do {                                                                       \
        if (!(cond)) {                                                         \
            std::fprintf(stderr, "vassert failed: %s\n", #cond);               \
            std::abort();                                                      \
        }                                                                      \
    } while (0)

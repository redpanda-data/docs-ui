// Spike shim for <seastar/util/defer.hh>.
// Minimal scope-guard: runs the action on destruction unless moved-from.
#pragma once

#include <utility>

namespace seastar {

template<typename Func>
class deferred_action {
public:
    explicit deferred_action(Func f)
      : _f(std::move(f)) {}
    deferred_action(deferred_action&& o) noexcept
      : _f(std::move(o._f))
      , _active(o._active) {
        o._active = false;
    }
    deferred_action(const deferred_action&) = delete;
    deferred_action& operator=(const deferred_action&) = delete;
    ~deferred_action() {
        if (_active) {
            _f();
        }
    }

private:
    Func _f;
    bool _active{true};
};

template<typename Func>
deferred_action<Func> defer(Func&& f) {
    return deferred_action<Func>(std::forward<Func>(f));
}

} // namespace seastar

namespace ss = seastar;

/*! @algolia/autocomplete-plugin-tags 1.12.2 | MIT License | © Algolia, Inc. and contributors | https://github.com/algolia/autocomplete */
!(function (t, e) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? e(exports)
    : typeof define === 'function' && define.amd
      ? define(['exports'], e)
      : e(((t = typeof globalThis !== 'undefined' ? globalThis : t || self)['@algolia/autocomplete-plugin-tags'] = {}))
})(this, function (t) {
  'use strict'
  function e (t, e) {
    var r = Object.keys(t)
    if (Object.getOwnPropertySymbols) {
      var n = Object.getOwnPropertySymbols(t)
      e &&
        (n = n.filter(function (e) {
          return Object.getOwnPropertyDescriptor(t, e).enumerable
        })),
      r.push.apply(r, n)
    }
    return r
  }
  function r (t) {
    for (var r = 1; r < arguments.length; r++) {
      var o = arguments[r] != null ? arguments[r] : {}
      r % 2
        ? e(Object(o), !0).forEach(function (e) {
          n(t, e, o[e])
        })
        : Object.getOwnPropertyDescriptors
          ? Object.defineProperties(t, Object.getOwnPropertyDescriptors(o))
          : e(Object(o)).forEach(function (e) {
            Object.defineProperty(t, e, Object.getOwnPropertyDescriptor(o, e))
          })
    }
    return t
  }
  function n (t, e, r) {
    return (
      (e = (function (t) {
        var e = (function (t, e) {
          if (typeof t !== 'object' || t === null) return t
          var r = t[Symbol.toPrimitive]
          if (void 0 !== r) {
            var n = r.call(t, e || 'default')
            if (typeof n !== 'object') return n
            throw new TypeError('@@toPrimitive must return a primitive value.')
          }
          return (e === 'string' ? String : Number)(t)
        })(t, 'string')
        return typeof e === 'symbol' ? e : String(e)
      })(e)) in t
        ? Object.defineProperty(t, e, { value: r, enumerable: !0, configurable: !0, writable: !0 })
        : (t[e] = r),
      t
    )
  }
  function o (t) {
    return (
      (function (t) {
        if (Array.isArray(t)) return i(t)
      })(t) ||
      (function (t) {
        if ((typeof Symbol !== 'undefined' && t[Symbol.iterator] != null) || t['@@iterator'] != null) { return Array.from(t) }
      })(t) ||
      (function (t, e) {
        if (!t) return
        if (typeof t === 'string') return i(t, e)
        var r = Object.prototype.toString.call(t).slice(8, -1)
        r === 'Object' && t.constructor && (r = t.constructor.name)
        if (r === 'Map' || r === 'Set') return Array.from(t)
        if (r === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)) return i(t, e)
      })(t) ||
      (function () {
        throw new TypeError(
          'Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.'
        )
      })()
    )
  }
  function i (t, e) {
    ;(e == null || e > t.length) && (e = t.length)
    for (var r = 0, n = new Array(e); r < e; r++) n[r] = t[r]
    return n
  }
  var a = function () {}
  function u (t) {
    var e = t.initialTags
    var n = { current: a(void 0 === e ? [] : e) }
    var i = []
    function a (t) {
      return t.map(function (t) {
        var e = r(
          r({}, t),
          {},
          {
            remove: function () {
              var t = n.current.slice()
              ;(n.current = n.current.filter(function (t) {
                return e !== t
              })),
              i.forEach(function (e) {
                return e({ prevTags: t, tags: n.current })
              })
            },
          }
        )
        return e
      })
    }
    return {
      get: function () {
        return n.current
      },
      set: function (t) {
        var e = n.current.slice()
        ;(n.current = a(t)),
        i.forEach(function (t) {
          return t({ prevTags: e, tags: n.current })
        })
      },
      add: function (t) {
        var e
        var r = n.current.slice()
        ;(e = n.current).push.apply(e, o(a(t))),
        i.forEach(function (t) {
          return t({ prevTags: r, tags: n.current })
        })
      },
      onChange: function (t) {
        i.push(t)
      },
    }
  }
  function c (t) {
    return r(
      {
        initialTags: [],
        getTagsSubscribers: function () {
          return []
        },
        transformSource: function (t) {
          return t.source
        },
        onChange: a,
      },
      t
    )
  }
  ;(t.createTagsPlugin = function () {
    var t = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : {}
    var e = c(t)
    var n = e.initialTags
    var o = e.getTagsSubscribers
    var i = e.transformSource
    var a = e.onChange
    var s = u({ initialTags: n })
    var f = { setTags: s.set, addTags: s.add }
    return {
      name: 'aa.tagsPlugin',
      subscribe: function (t) {
        var e = t.setContext
        var n = t.onSelect
        var i = t.setIsOpen
        var u = t.refresh
        var c = o()
        e({ tagsPlugin: r(r({}, f), {}, { tags: s.get() }) }),
        n(function (t) {
          var e = t.source
          var r = t.item
          var n = c.find(function (t) {
            return t.sourceId === e.sourceId
          })
          n && s.add([n.getTag({ item: r })])
        }),
        s.onChange(function (n) {
          var o = n.prevTags
          e({ tagsPlugin: r(r({}, f), {}, { tags: s.get() }) }),
          i(!0),
          a(r(r({}, t), {}, { prevTags: o, tags: s.get() })),
          u()
        })
      },
      getSources: function (t) {
        var e = t.state
        return [
          i({
            source: {
              sourceId: 'tagsPlugin',
              getItems: function () {
                return s.get()
              },
              onSelect: function (t) {
                t.item.remove()
              },
              templates: {
                item: function (t) {
                  var e = t.item
                  var r = t.createElement
                  return r(
                    'div',
                    { className: 'aa-TagsPlugin-Tag' },
                    r('span', { className: 'aa-TagsPlugin-TagLabel' }, e.label),
                    r(
                      'button',
                      { className: 'aa-TagsPlugin-RemoveButton', title: 'Remove this tag' },
                      r(
                        'svg',
                        {
                          fill: 'none',
                          stroke: 'currentColor',
                          strokeLinecap: 'round',
                          strokeLinejoin: 'round',
                          strokeWidth: 2,
                          viewBox: '0 0 24 24',
                        },
                        r('path', { d: 'M18 6L6 18' }),
                        r('path', { d: 'M6 6L18 18' })
                      )
                    )
                  )
                },
              },
            },
            state: e,
          }),
        ]
      },
      data: r(
        r({}, f),
        {},
        {
          get tags () {
            return s.get()
          },
        }
      ),
      __autocomplete_pluginOptions: t,
    }
  }),
  Object.defineProperty(t, '__esModule', { value: !0 })
})
//# sourceMappingURL=index.production.js.map

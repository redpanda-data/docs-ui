/* global localStorage, sessionStorage, fetch, IntersectionObserver, CustomEvent, URLSearchParams */
/**
 * Solutions progress: local-first, synced for signed-in readers.
 *
 * Runs on every page (it owns window.docsSolutions, which the landing page
 * reads for "Continue learning" and which recommendation cards use for
 * analytics) but only wires page UI on solution overview and step pages
 * (<body class="solution|solution-step" data-solution-id=...>).
 *
 * Store (localStorage 'docs-solutions-progress'), v2:
 *   { v: 2, updatedAt, solutions: { <id>: {
 *       steps: { <stepId>: { done: true|false, at } }, currentStep,
 *       startedAt, updatedAt, completedAt, solutionVersion } } }
 * Timestamps are epoch milliseconds. Every step keeps its own state and the
 * time it was last set, so an un-mark ({ done: false, at }) is an edit like a
 * mark and survives a merge with a copy that still has the step done. v1
 * stores ({ completedSteps: [stepId] } per solution) are migrated on read.
 * getState() and getRecord() also hand out a derived `completedSteps` list
 * (done steps, oldest mark first) for readers such as 29-solutions-home.js;
 * it is never stored or sent.
 *
 * Storage failures fail closed: the storage objects are reached through a
 * guarded accessor (a blocked-storage getter throws in some browsers), reads
 * give an empty store, writes are dropped, and the page keeps an in-memory copy
 * so the UI still works for the current view. Caps: 50 solutions x 100 step
 * entries, evicting the least recently updated first.
 *
 * Rules:
 *   - Nothing is ever marked complete implicitly. Only the explicit "Mark step
 *     complete" click does that. Loading a step only records it as current.
 *   - Completed count = done steps that are still step ids of the current
 *     version. Unknown ids are kept (they may return) but never counted.
 *   - completedAt is recomputed against the page's step list on every mark and
 *     on load: set when every current step is done, null otherwise.
 *   - A stored solutionVersion that differs from the page's version shows the
 *     version-changed notice once per tab session.
 *   - Every local write re-reads storage and merges before persisting, and a
 *     `storage` event from another tab merges and re-renders, so two tabs never
 *     overwrite each other. A page restored from the back-forward cache
 *     re-reads everything.
 *   - Signed in (rp_docs_auth hint cookie): GET /solutions/progress (60 s
 *     sessionStorage cache); first sign-in in this browser or dirty local state
 *     PUTs the merged store. A PUT answer is merged with the current local
 *     state, and the store stays dirty if it changed while the PUT was in
 *     flight. Hint false -> true merges; true -> false (sign-out, cookie
 *     expiry) clears local state only when everything was synced, otherwise
 *     it is kept as this device's progress.
 *   - Merge is mergeStores(existing, incoming), the same function as the
 *     server's mergeAll(existing, incoming). On load the client calls
 *     mergeStores(remote, local), the same roles the server uses for (stored,
 *     clientBody). Per step: the later `at` wins, a tie goes to done. Per
 *     solution: max updatedAt, min startedAt, currentStep and solutionVersion
 *     from the later record (incoming wins a tie; falling back to the other
 *     when null), completedAt = earliest, but null when the two versions
 *     differ or a step was un-marked after it. Ids are validated with the
 *     server's regexes and timestamps are clamped to now + 5 minutes.
 *     tests/solution-progress/fixtures/merge-vectors.json is the shared
 *     contract (a byte-identical copy of docs-site's
 *     tests/fixtures/solutions-progress-merge.json).
 *   - Download errors: docs-site sends a failed download navigation back to
 *     the page as ?download_error=<code>; the page says what happened and
 *     points at the build-along files. Draft solutions have no release yet, so
 *     their download CTA reads "Download available at release" and does
 *     nothing.
 *   - Every code block the extension annotated with data-solution-file gets a
 *     download control in its toolbox (next to Copy), which serves that one
 *     file from the same endpoint as the bundle. It honours the solution's own
 *     data-solution-download policy exactly as the bundle CTA does, so a
 *     reader is never asked to sign in for one file while the whole zip is
 *     free, and never sees a control where the CTA itself is absent. The
 *     download starts on return from sign-in.
 *   - Gates exist only on Save and on the authenticated download. Anonymous
 *     readers can start, mark steps, and see progress on this device.
 *   - Analytics: track(name, props) -> window.heap.track when present, and
 *     window.dataLayer.push always. No PII.
 */
;(function () {
  'use strict'

  var STORE_KEY = 'docs-solutions-progress'
  var HINT_KEY = 'docs-solutions-progress-hint'
  var DIRTY_KEY = 'docs-solutions-progress-dirty'
  var REMOTE_CACHE_KEY = 'docs-solutions-progress-remote'
  var PENDING_KEY = 'docs-solutions-pending-intent'
  var ACTIVITY_KEY = 'docs-solutions-activity-sent'
  var VERSION_NOTICE_KEY = 'docs-solutions-version-notice'
  var DEBUG_RECS_KEY = 'docs-debug-recs'
  var PROGRESS_ENDPOINT = '/solutions/progress'
  var DOWNLOAD_ENDPOINT = '/solutions/download'
  var ACTIVITY_ENDPOINT = '/docs-activity'
  var MAX_SOLUTIONS = 50
  var MAX_STEPS = 100
  // Same validation as docs-site lib/solutions-progress.mjs.
  var ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
  var VERSION_RE = /^v\d+\.\d+\.\d+$/
  var FUTURE_SKEW_MS = 5 * 60 * 1000
  var SCHEMA_VERSION = 2
  var ISO_RE = /^\d{4}-\d{2}-\d{2}(T|$)/
  var REMOTE_TTL_MS = 60 * 1000
  var PENDING_TTL_MS = 15 * 60 * 1000
  var PUT_DEBOUNCE_MS = 800

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------

  function now () { return Date.now() }

  function isString (value) { return typeof value === 'string' && value.length > 0 }

  // Same as docs-site toMillis: a finite number, or an ISO 8601 string; a
  // numeric string is not a date. Null when unusable.
  function toTime (value) {
    if (typeof value === 'number') return isFinite(value) ? value : null
    if (typeof value === 'string' && ISO_RE.test(value)) {
      var parsed = Date.parse(value)
      return isFinite(parsed) ? parsed : null
    }
    return null
  }

  function isPlainObject (value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  function toArray (list) {
    var out = []
    if (!list) return out
    for (var i = 0; i < list.length; i++) out.push(list[i])
    return out
  }

  function clone (value) { return JSON.parse(JSON.stringify(value)) }

  function hasClass (el, name) {
    return !!(el && el.classList && el.classList.contains(name))
  }

  function attr (el, name) { return el && el.getAttribute ? el.getAttribute(name) : null }

  // The storage objects themselves, or null. Reading the `localStorage` global
  // throws a SecurityError in some browsers when site data is blocked, so it
  // is only ever touched inside a try. Every helper below accepts null.
  function localArea () {
    try { return typeof localStorage === 'undefined' ? null : localStorage } catch (e) { return null }
  }

  function sessionArea () {
    try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch (e) { return null }
  }

  function readJSON (storage, key) {
    try {
      var raw = storage.getItem(key)
      return raw ? JSON.parse(raw) : null
    } catch (e) {
      return null
    }
  }

  function writeJSON (storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value))
      return true
    } catch (e) {
      return false
    }
  }

  function readString (storage, key) {
    try { return storage.getItem(key) } catch (e) { return null }
  }

  function writeString (storage, key, value) {
    try {
      storage.setItem(key, value)
      return true
    } catch (e) {
      return false
    }
  }

  function removeKey (storage, key) {
    try { storage.removeItem(key) } catch (e) { /* ignore */ }
  }

  function hasAuthHint () {
    return /(?:^|;\s*)rp_docs_auth=1(?:;|$)/.test(document.cookie)
  }

  function dispatch (name, detail) {
    var event
    try {
      event = new CustomEvent(name, { detail: detail })
    } catch (e) {
      try {
        event = document.createEvent('CustomEvent')
        event.initCustomEvent(name, false, false, detail)
      } catch (err) {
        return
      }
    }
    window.dispatchEvent(event)
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  function track (name, props) {
    var payload = {}
    if (props) {
      for (var key in props) {
        if (Object.prototype.hasOwnProperty.call(props, key) && props[key] !== undefined && props[key] !== null) {
          payload[key] = props[key]
        }
      }
    }
    try {
      if (window.heap && typeof window.heap.track === 'function') window.heap.track(name, payload)
    } catch (e) { /* analytics must never break the page */ }
    try {
      window.dataLayer = window.dataLayer || []
      var entry = { event: name }
      for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) entry[k] = payload[k]
      window.dataLayer.push(entry)
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Store
  // ---------------------------------------------------------------------------

  var memoryStore = null
  // Bumped on every local change (this tab's edits and other tabs' writes), so
  // a PUT can tell whether its answer is already stale when it arrives.
  var localRev = 0
  // Result of the last write of the store: null before any write, then
  // true/false. Drives "Saved on this device" versus the storage warning.
  var lastWriteOk = null

  function emptyStore () { return { v: SCHEMA_VERSION, updatedAt: 0, solutions: {} } }

  function isId (value) { return isString(value) && ID_RE.test(value) }
  function isVersion (value) { return isString(value) && VERSION_RE.test(value) }

  // Timestamps from the future (clock skew, tampering) are capped at now + 5
  // minutes so one bad record cannot win every merge forever.
  function clampTime (value, nowMs) {
    var ms = toTime(value)
    if (ms === null) return null
    var max = nowMs + FUTURE_SKEW_MS
    return ms > max ? max : ms
  }

  function minTime (a, b) {
    if (a === null || a === undefined) return b === null || b === undefined ? null : b
    if (b === null || b === undefined) return a
    return Math.min(a, b)
  }

  function maxTime (a, b) {
    if (a === null || a === undefined) return b === null || b === undefined ? null : b
    if (b === null || b === undefined) return a
    return Math.max(a, b)
  }

  function byId (x, y) { return x < y ? -1 : x > y ? 1 : 0 }

  // v1 list: ordered de-duplicated valid step ids, the last MAX_STEPS kept.
  function normalizeStepList (list) {
    var out = []
    var seen = {}
    if (!Array.isArray(list)) return out
    for (var i = 0; i < list.length; i++) {
      var step = list[i]
      if (isId(step) && !seen[step]) {
        seen[step] = true
        out.push(step)
      }
    }
    return out.length > MAX_STEPS ? out.slice(out.length - MAX_STEPS) : out
  }

  // At most MAX_STEPS entries, the most recently set first (ties by id), with
  // the keys emitted in id order. Same as docs-site capSteps.
  function capSteps (steps) {
    var ids = Object.keys(steps)
    if (ids.length > MAX_STEPS) {
      ids.sort(function (x, y) { return (steps[y].at - steps[x].at) || byId(x, y) })
      ids = ids.slice(0, MAX_STEPS)
    }
    ids.sort()
    var out = {}
    for (var i = 0; i < ids.length; i++) out[ids[i]] = { done: steps[ids[i]].done, at: steps[ids[i]].at }
    return out
  }

  // v2 `steps` when it is an object; otherwise v1 `completedSteps`, each step
  // stamped at the record's updatedAt. Invalid ids and entries are dropped.
  function normalizeSteps (raw, updatedAt, nowMs) {
    var out = {}
    var id
    if (isPlainObject(raw.steps)) {
      for (id in raw.steps) {
        if (!Object.prototype.hasOwnProperty.call(raw.steps, id)) continue
        var entry = raw.steps[id]
        if (!isId(id) || !isPlainObject(entry) || typeof entry.done !== 'boolean') continue
        var at = clampTime(entry.at, nowMs)
        out[id] = { done: entry.done, at: at === null ? 0 : at }
      }
    } else {
      var list = normalizeStepList(raw.completedSteps)
      for (var i = 0; i < list.length; i++) out[list[i]] = { done: true, at: updatedAt }
    }
    return capSteps(out)
  }

  // A completion stops counting once any step was un-marked after it.
  function validCompletion (completedAt, steps) {
    if (completedAt === null || completedAt === undefined) return null
    for (var id in steps) {
      if (Object.prototype.hasOwnProperty.call(steps, id) && !steps[id].done && steps[id].at > completedAt) return null
    }
    return completedAt
  }

  function normalizeRecord (raw, nowMs) {
    if (!isPlainObject(raw)) return null
    nowMs = nowMs || now()
    var updated = clampTime(raw.updatedAt, nowMs)
    if (updated === null) updated = 0
    var steps = normalizeSteps(raw, updated, nowMs)
    return {
      steps: steps,
      currentStep: isId(raw.currentStep) ? raw.currentStep : null,
      startedAt: clampTime(raw.startedAt, nowMs),
      updatedAt: updated,
      completedAt: validCompletion(clampTime(raw.completedAt, nowMs), steps),
      solutionVersion: isVersion(raw.solutionVersion) ? raw.solutionVersion : null,
    }
  }

  // Done step ids, oldest mark first (ties by id). Same as docs-site
  // completedStepIds.
  function completedStepIds (record) {
    var steps = record && isPlainObject(record.steps) ? record.steps : {}
    return Object.keys(steps)
      .filter(function (id) { return steps[id] && steps[id].done === true })
      .sort(function (x, y) { return (steps[x].at - steps[y].at) || byId(x, y) })
  }

  // The time to stamp a local edit of one step: now, but always after the
  // entry it replaces, so a mark and an un-mark inside the same millisecond
  // still apply in order (a tie would otherwise go to done).
  function editTime (record, id) {
    var t = now()
    var prev = record && record.steps && record.steps[id]
    return prev && prev.at >= t ? prev.at + 1 : t
  }

  function isDone (record, id) {
    return !!(record && record.steps && record.steps[id] && record.steps[id].done === true)
  }

  // Keep at most 50 solutions and a serialized document of at most 32 KiB,
  // evicting the smallest updatedAt first (ties by id). Same as docs-site
  // finalize().
  var MAX_BYTES = 32768

  function buildStore (solutions, ids, updatedAt) {
    var kept = {}
    var latest = toTime(updatedAt)
    if (latest === null) latest = 0
    var sorted = ids.slice().sort()
    for (var i = 0; i < sorted.length; i++) {
      kept[sorted[i]] = solutions[sorted[i]]
      latest = maxTime(latest, kept[sorted[i]].updatedAt)
    }
    return { v: SCHEMA_VERSION, updatedAt: latest, solutions: kept }
  }

  function finalizeStore (solutions, updatedAt) {
    var ids = Object.keys(solutions).sort(function (x, y) {
      var xm = toTime(solutions[x].updatedAt) || 0
      var ym = toTime(solutions[y].updatedAt) || 0
      return (ym - xm) || (x < y ? -1 : 1)
    }).slice(0, MAX_SOLUTIONS)
    var doc = buildStore(solutions, ids, updatedAt)
    while (ids.length > 1 && JSON.stringify(doc).length > MAX_BYTES) {
      ids = ids.slice(0, -1)
      doc = buildStore(solutions, ids, updatedAt)
    }
    return doc
  }

  // Lenient read, like docs-site normalizeStoredProgress: never null, bad keys
  // and records dropped, the rest kept.
  function normalizeStore (raw, nowMs) {
    nowMs = nowMs || now()
    if (!isPlainObject(raw)) return finalizeStore({}, null)
    if (raw.solutions !== undefined && !isPlainObject(raw.solutions)) {
      return finalizeStore({}, clampTime(raw.updatedAt, nowMs))
    }
    var solutions = {}
    var source = raw.solutions || {}
    for (var id in source) {
      if (!Object.prototype.hasOwnProperty.call(source, id) || !isId(id)) continue
      var record = normalizeRecord(source[id], nowMs)
      if (record) solutions[id] = record
    }
    return finalizeStore(solutions, clampTime(raw.updatedAt, nowMs))
  }

  // A record as handed to callers: a copy, plus the derived completedSteps.
  function view (record) {
    if (!record) return null
    var out = clone(record)
    out.completedSteps = completedStepIds(record)
    return out
  }

  function readDisk () { return normalizeStore(readJSON(localArea(), STORE_KEY)) }

  function loadStore () {
    if (memoryStore) return memoryStore
    memoryStore = readDisk()
    return memoryStore
  }

  // Merge with what is on disk before writing, so another tab's progress
  // saved since this page loaded is never overwritten.
  function persistStore (store) {
    memoryStore = mergeStores(readDisk(), store)
    lastWriteOk = writeJSON(localArea(), STORE_KEY, memoryStore)
    dispatch('docs-solutions:change', { store: getState() })
    return memoryStore
  }

  function clearLocal () {
    memoryStore = emptyStore()
    localRev++
    removeKey(localArea(), STORE_KEY)
    removeKey(localArea(), DIRTY_KEY)
    removeKey(sessionArea(), REMOTE_CACHE_KEY)
    dispatch('docs-solutions:change', { store: emptyStore() })
  }

  function rawRecord (id) {
    var store = loadStore()
    return store.solutions[id] ? clone(store.solutions[id]) : null
  }

  function getRecord (id) { return view(loadStore().solutions[id] || null) }

  function setRecord (id, record) {
    var store = clone(loadStore())
    record.updatedAt = record.updatedAt || now()
    store.solutions[id] = normalizeRecord(record)
    if (store.solutions[id].updatedAt > store.updatedAt) store.updatedAt = store.solutions[id].updatedAt
    localRev++
    return persistStore(store)
  }

  function isDirty () { return readString(localArea(), DIRTY_KEY) === '1' }
  // In memory too, so a browser that refuses the write still retries within
  // this page view.
  var dirtyInMemory = false
  function markDirty () { dirtyInMemory = true; writeString(localArea(), DIRTY_KEY, '1') }
  function clearDirty () { dirtyInMemory = false; removeKey(localArea(), DIRTY_KEY) }
  function dirty () { return dirtyInMemory || isDirty() }

  // ---------------------------------------------------------------------------
  // Merge (shared contract with docs-site; see merge-vectors.json)
  // ---------------------------------------------------------------------------

  // Per step: the later `at` wins; on a tie, done wins. Commutative.
  function mergeSteps (a, b) {
    var out = {}
    var id
    for (id in a) if (Object.prototype.hasOwnProperty.call(a, id)) out[id] = a[id]
    for (id in b) {
      if (!Object.prototype.hasOwnProperty.call(b, id)) continue
      var x = out[id]
      var y = b[id]
      if (!x) out[id] = y
      else if (x.at !== y.at) out[id] = x.at > y.at ? x : y
      else out[id] = { done: x.done || y.done, at: x.at }
    }
    return capSteps(out)
  }

  // mergeRecord(existing, incoming): the incoming record wins ties on updatedAt
  // for currentStep and solutionVersion, exactly like docs-site
  // mergeSolutionProgress, so mergeStores(remote, local) here and
  // mergeAll(stored, clientBody) there produce one result.
  function mergeRecord (existing, incoming, nowMs) {
    nowMs = nowMs || now()
    var a = existing ? normalizeRecord(existing, nowMs) : null
    var b = incoming ? normalizeRecord(incoming, nowMs) : null
    if (!a) return b
    if (!b) return a
    var later = b.updatedAt >= a.updatedAt ? b : a
    var earlier = later === a ? b : a
    var versionsDiffer = !!(a.solutionVersion && b.solutionVersion && a.solutionVersion !== b.solutionVersion)
    var steps = mergeSteps(a.steps, b.steps)
    return {
      steps: steps,
      currentStep: later.currentStep || earlier.currentStep || null,
      startedAt: minTime(a.startedAt, b.startedAt),
      updatedAt: Math.max(a.updatedAt, b.updatedAt),
      // A completion recorded against a different version of the solution, or
      // followed by an un-mark, is not a completion of this one.
      completedAt: versionsDiffer ? null : validCompletion(minTime(a.completedAt, b.completedAt), steps),
      solutionVersion: later.solutionVersion || earlier.solutionVersion || null,
    }
  }

  function mergeStores (existing, incoming, nowMs) {
    nowMs = nowMs || now()
    existing = normalizeStore(existing, nowMs)
    incoming = normalizeStore(incoming, nowMs)
    var solutions = {}
    var ids = {}
    var id
    for (id in existing.solutions) if (Object.prototype.hasOwnProperty.call(existing.solutions, id)) ids[id] = true
    for (id in incoming.solutions) if (Object.prototype.hasOwnProperty.call(incoming.solutions, id)) ids[id] = true
    for (id in ids) {
      var record = mergeRecord(existing.solutions[id], incoming.solutions[id], nowMs)
      if (record) solutions[id] = record
    }
    return finalizeStore(solutions, maxTime(existing.updatedAt, incoming.updatedAt))
  }

  function getState () {
    var store = clone(loadStore())
    for (var id in store.solutions) {
      if (Object.prototype.hasOwnProperty.call(store.solutions, id)) store.solutions[id] = view(store.solutions[id])
    }
    return store
  }
  // ---------------------------------------------------------------------------
  // Page context
  // ---------------------------------------------------------------------------

  var body = document.body
  var solutionId = attr(body, 'data-solution-id')
  var isOverview = hasClass(body, 'solution')
  var isStep = hasClass(body, 'solution-step')
  var isSolutionPage = !!solutionId && (isOverview || isStep)
  var stepId = attr(body, 'data-step-id') || null
  var pageVersion = attr(body, 'data-solution-version') || null
  // 'authenticated' (gated), 'public' (ungated) or 'none' (no downloads at
  // all), straight from the record. The bundle CTA is built from the same
  // value, and the snippet controls follow it so the two can never disagree.
  var downloadPolicy = attr(body, 'data-solution-download') || 'authenticated'
  var isDraft = attr(body, 'data-solution-status') === 'draft'
  var component = attr(body, 'data-component') || null

  function $ (selector, root) { return (root || document).querySelector(selector) }
  function $$ (selector, root) { return toArray((root || document).querySelectorAll(selector)) }

  // Step ids and urls, in order, from the rendered step lists.
  var stepIndex = null
  function steps () {
    if (stepIndex) return stepIndex
    var ids = []
    var urls = {}
    var seen = {}
    // Step ids and urls come from the sidebar entries (nav-tree-solution:
    // data-sol-nav-step + data-sol-nav-url, present on every solution page)
    // and from the overview's Steps list (solution-steps: data-sol-step-id +
    // data-sol-step-url). An id can appear in both; keep the first order seen
    // and take the url from whichever element carries one.
    $$('[data-sol-step-id], [data-sol-nav-step]').forEach(function (el) {
      var id = attr(el, 'data-sol-step-id') || attr(el, 'data-sol-nav-step')
      if (!isString(id)) return
      if (!seen[id]) {
        seen[id] = true
        ids.push(id)
      }
      var url = attr(el, 'data-sol-step-url') || attr(el, 'data-sol-nav-url')
      if (url && !urls[id]) urls[id] = url
    })
    stepIndex = { ids: ids, urls: urls }
    return stepIndex
  }

  function countDone (record, ids) {
    if (!record) return 0
    var count = 0
    for (var i = 0; i < ids.length; i++) {
      if (isDone(record, ids[i])) count++
    }
    return count
  }

  function allDone (record, ids) {
    return ids.length > 0 && countDone(record, ids) === ids.length
  }

  // First step of the current version that is not done, else null.
  function firstIncomplete (record, ids) {
    for (var i = 0; i < ids.length; i++) if (!isDone(record, ids[i])) return ids[i]
    return null
  }

  // completedAt against the page's own step list.
  //
  // A completion stamped against another version of the solution belongs to
  // that version: it is left alone on load (it is still true that the reader
  // finished that version, and the lead lists rely on it), never counts as a
  // completion of this one, and is replaced when the reader finishes this
  // version. Un-marks clear a completion through the merge itself (see
  // validCompletion), so nothing here ever has to clear one.
  function staleCompletion (record) {
    return !!(record && record.solutionVersion && pageVersion && record.solutionVersion !== pageVersion)
  }

  function hasCompletion (record) {
    return !!record && record.completedAt !== null && record.completedAt !== undefined && !staleCompletion(record)
  }

  // Every current step done but no completion stamped (progress merged in from
  // two devices, or a stamp the merge dropped because the other copy was for a
  // different version): stamp it at the latest step change, a time every
  // device computes the same way. Returns true when it changed the record.
  function stampCompletion (record, ids) {
    if (!record || !ids.length || staleCompletion(record) || !allDone(record, ids)) return false
    if (record.completedAt !== null && record.completedAt !== undefined) return false
    var latest = 0
    for (var id in record.steps) {
      if (!Object.prototype.hasOwnProperty.call(record.steps, id)) continue
      if (record.steps[id].at > latest) latest = record.steps[id].at
    }
    record.completedAt = latest || now()
    return true
  }

  function baseProps (extra) {
    var props = { solution_id: solutionId, solution_version: pageVersion, component: component }
    if (stepId) props.step_id = stepId
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) props[k] = extra[k]
    return props
  }

  // ---------------------------------------------------------------------------
  // Toast + sync state
  // ---------------------------------------------------------------------------

  // `isError` toasts use role=alert and stay long enough to read a sentence
  // with a pointer in it.
  function toast (message, isError) {
    if (!body || !document.createElement) return
    var el = document.createElement('div')
    el.className = 'sol-toast' + (isError ? ' is-error' : '')
    el.setAttribute('role', isError ? 'alert' : 'status')
    el.textContent = message
    body.appendChild(el)
    setTimeout(function () { el.classList.add('is-visible') }, 10)
    setTimeout(function () {
      el.classList.remove('is-visible')
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el) }, 250)
    }, isError ? 10000 : 4000)
  }

  function setSyncState (text, isError) {
    $$('[data-sol-sync-state]').forEach(function (el) {
      el.textContent = text || ''
      if (el.classList) el.classList[isError ? 'add' : 'remove']('is-error')
    })
  }

  // ---------------------------------------------------------------------------
  // Remote sync
  // ---------------------------------------------------------------------------

  var putTimer = null
  var pendingPut = null

  function readRemoteCache () {
    var cached = readJSON(sessionArea(), REMOTE_CACHE_KEY)
    if (cached && cached.at && now() - cached.at < REMOTE_TTL_MS && cached.store) return normalizeStore(cached.store)
    return null
  }

  function writeRemoteCache (store) {
    writeJSON(sessionArea(), REMOTE_CACHE_KEY, { at: now(), store: store })
  }

  function fetchRemote () {
    var cached = readRemoteCache()
    if (cached) return Promise.resolve(cached)
    if (typeof fetch !== 'function') return Promise.resolve(null)
    return fetch(PROGRESS_ENDPOINT, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (res.status === 401) return null
        if (res.status === 204 || res.status === 404) return emptyStore()
        if (!res.ok) return null
        return res.json().then(function (data) {
          var store = normalizeStore(data && data.solutions ? data : (data && data.progress) || emptyStore())
          writeRemoteCache(store)
          return store
        })
      })
      .catch(function () { return null })
  }

  function putStore (store) {
    if (typeof fetch !== 'function') return Promise.resolve(false)
    var payload = { v: SCHEMA_VERSION, updatedAt: store.updatedAt || now(), solutions: store.solutions }
    var sentRev = localRev
    setSyncState('Saving...')
    var request = fetch(PROGRESS_ENDPOINT, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        // Any non-2xx leaves the dirty flag set so the next page load retries
        // (409 profile_not_ready, 429 rate limited, 5xx, or a stale session).
        if (res.status === 401) {
          markDirty()
          setSyncState('Sign in to sync', true)
          return false
        }
        if (res.status === 409 || res.status === 429) {
          markDirty()
          setSyncState('Not synced yet', true)
          return false
        }
        if (!res.ok) {
          markDirty()
          setSyncState('Not synced', true)
          return false
        }
        return res.json().then(function (data) {
          // The server answers with the merged store, either at the top level
          // or under `progress` (the same shape GET returns).
          var body = data && data.solutions ? data : (data && data.progress && data.progress.solutions ? data.progress : null)
          return accepted(normalizeStore(body || payload))
        }, function () {
          // 2xx with no JSON body: the server accepted what we sent.
          return accepted(normalizeStore(payload))
        })
      })
      .catch(function () {
        markDirty()
        setSyncState('Offline, saved on this device', true)
        return false
      })
    // The answer reflects what was sent, not what happened here since: merge
    // it into the current local state rather than replacing it, and if a step
    // was marked (or anything else changed) while the PUT was in flight, stay
    // dirty and send again.
    function accepted (serverStore) {
      writeRemoteCache(serverStore)
      persistStore(mergeStores(serverStore, loadStore()))
      if (localRev !== sentRev) {
        markDirty()
        scheduleSync()
        setSyncState('Saving...')
        return true
      }
      clearDirty()
      setSyncState('Saved to your account')
      return true
    }
    pendingPut = request.then(function (ok) { pendingPut = null; render(); return ok })
    return pendingPut
  }

  function scheduleSync () {
    if (!hasAuthHint()) return
    if (putTimer) clearTimeout(putTimer)
    putTimer = setTimeout(function () {
      putTimer = null
      // One PUT at a time. A change made after the in-flight PUT was sent
      // bumps localRev, and its answer then schedules the follow-up itself.
      if (pendingPut) return
      putStore(loadStore())
    }, PUT_DEBOUNCE_MS)
  }

  function save () {
    if (!hasAuthHint()) {
      openSignin('save')
      return Promise.resolve(false)
    }
    markDirty()
    if (putTimer) { clearTimeout(putTimer); putTimer = null }
    return putStore(loadStore()).then(function (ok) {
      if (ok) {
        toast('Progress saved')
        track('solution_save_progress', baseProps({ intent: 'save' }))
      }
      return ok
    })
  }

  var syncPromise = null

  function syncOnLoad () {
    var signedIn = hasAuthHint()
    var previous = readString(localArea(), HINT_KEY)
    if (!signedIn) {
      // true -> false: the reader signed out, or the session cookie expired.
      // Synced progress lives in their account now; do not leave a copy on a
      // possibly shared device. Unsynced progress (dirty) exists nowhere else,
      // so it stays here as this device's anonymous progress, and the next
      // sign-in uploads it (it is a first sign-in again once the hint is
      // false).
      if (previous === 'true') {
        if (dirty()) removeKey(sessionArea(), REMOTE_CACHE_KEY)
        else clearLocal()
      }
      writeString(localArea(), HINT_KEY, 'false')
      syncPromise = Promise.resolve(false)
      return syncPromise
    }
    var firstSignIn = previous !== 'true'
    writeString(localArea(), HINT_KEY, 'true')
    // The first sign-in in this browser owes the server whatever was done
    // anonymously. Flag it before any request so a failed GET or PUT (503,
    // 409 profile not ready, offline) retries on the next load instead of
    // silently dropping the upload.
    if (firstSignIn) markDirty()
    syncPromise = fetchRemote().then(function (remote) {
      // 401 or a failed GET: keep local as is and try again next load.
      if (remote === null) return false
      // Same roles as the server's mergeAll(stored, clientBody): the server's
      // copy is `existing`, this device's copy is `incoming` and wins ties, so
      // what we PUT is what the server will compute (shared fixture rule).
      var merged = persistStore(mergeStores(remote, loadStore()))
      // The merged record can complete (or un-complete) against this page's
      // step list; keep completedAt honest before sending it anywhere.
      if (isSolutionPage) {
        var record = rawRecord(solutionId)
        if (stampCompletion(record, steps().ids)) {
          record.updatedAt = now()
          merged = setRecord(solutionId, record)
          markDirty()
        }
      }
      if (dirty()) return putStore(merged)
      render()
      return true
    })
    return syncPromise
  }

  // ---------------------------------------------------------------------------
  // Signed-in activity beacon (once per solution transition)
  // ---------------------------------------------------------------------------

  function recordActivity (event) {
    if (!hasAuthHint() || !solutionId || typeof fetch !== 'function') return
    var key = solutionId + ':' + event
    var sent = readJSON(localArea(), ACTIVITY_KEY) || []
    if (sent.indexOf(key) !== -1) return
    sent.push(key)
    writeJSON(localArea(), ACTIVITY_KEY, sent.slice(-200))
    try {
      fetch(ACTIVITY_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Only the solution transition. The per-page beacon in
        // 27-docs-activity.js already reports the pageview itself.
        body: JSON.stringify({ solution: { id: solutionId, event: event } }),
        keepalive: true,
      }).catch(function () { /* best effort */ })
    } catch (e) { /* never break the page */ }
  }

  // ---------------------------------------------------------------------------
  // Progress operations
  // ---------------------------------------------------------------------------

  function newRecord (version) {
    var t = now()
    return { steps: {}, currentStep: null, startedAt: t, updatedAt: t, completedAt: null, solutionVersion: version || null }
  }

  function setCurrent (id, step, version) {
    id = id || solutionId
    step = step || stepId
    version = version || pageVersion
    if (!id || !step) return getRecord(id)
    var record = rawRecord(id)
    var started = false
    if (!record) {
      record = newRecord(version)
      started = true
    }
    var changed = started || record.currentStep !== step
    record.currentStep = step
    // Every step may be done without a stamp (merged from two devices): stamp
    // it on load.
    if (id === solutionId && stampCompletion(record, steps().ids)) changed = true
    if (changed) {
      record.updatedAt = now()
      setRecord(id, record)
      markDirty()
      scheduleSync()
    }
    if (started) {
      track('solution_start', baseProps())
      recordActivity('started')
    }
    render()
    return getRecord(id)
  }

  function markComplete (id, step, version) {
    id = id || solutionId
    step = step || stepId
    version = version || pageVersion
    if (!id || !step) return getRecord(id)
    var record = rawRecord(id) || newRecord(version)
    var t = now()
    var wasComplete = isDone(record, step)
    // Judged before the version is updated: a completion of an older version
    // is not a completion of this one.
    var hadCompletion = hasCompletion(record)
    t = editTime(record, step)
    record.steps[step] = { done: true, at: t }
    record.currentStep = step
    record.solutionVersion = version || record.solutionVersion
    record.updatedAt = t
    var ids = id === solutionId ? steps().ids : []
    var finished = !hadCompletion && allDone(record, ids)
    if (finished) record.completedAt = t
    setRecord(id, record)
    // A copy on disk from the older version makes the merge drop the new
    // stamp (different versions); stamp once more against the merged record.
    if (finished) {
      var settled = rawRecord(id)
      if (stampCompletion(settled, ids)) setRecord(id, settled)
    }
    markDirty()
    scheduleSync()
    if (!wasComplete) track('solution_step_complete', baseProps({ step_id: step }))
    if (finished) {
      track('solution_complete', baseProps({ duration_ms: record.startedAt ? t - record.startedAt : null }))
      recordActivity('completed')
    }
    render()
    return getRecord(id)
  }

  function unmarkComplete (id, step) {
    id = id || solutionId
    step = step || stepId
    if (!id || !step) return getRecord(id)
    var record = rawRecord(id)
    if (!record) return null
    if (!isDone(record, step)) return getRecord(id)
    var t = editTime(record, step)
    // Recorded, not deleted: the un-mark has to win over any copy (another
    // device, the server) that still has the step done from before.
    record.steps[step] = { done: false, at: t }
    record.completedAt = null
    record.updatedAt = t
    setRecord(id, record)
    markDirty()
    scheduleSync()
    render()
    return getRecord(id)
  }

  // ---------------------------------------------------------------------------
  // Auth gates
  // ---------------------------------------------------------------------------

  function authAvailable () {
    if (hasAuthHint()) return true
    if (window.isUiPreview) return true
    if (window.__KAPA_LOGIN_URL) return true
    var account = $('[data-docs-account]')
    return !!(account && !account.hidden)
  }

  var SIGNIN_COPY = {
    save: {
      title: 'Sign in to save your progress',
      lead: 'Your progress is kept on this device. Sign in to keep it across devices and pick up where you left off.',
      cta: 'Sign in and save',
    },
    download: {
      title: 'Sign in to download the complete example',
      lead: 'Get the full working code for this solution, and keep your progress across devices.',
      cta: 'Sign in and download',
    },
  }

  // One file from the solution rather than the whole bundle: the copy names it,
  // and the return path carries the path so the download can resume itself.
  function fileSigninCopy (filePath) {
    return {
      title: 'Sign in to download ' + filePath,
      lead: 'Get the file behind this snippet, and keep your progress across devices.',
      cta: 'Sign in and download',
    }
  }

  function intentReturnTo (intent, filePath) {
    var returnTo = window.location.pathname + '?intent=' + intent
    if (stepId) returnTo += '&step=' + encodeURIComponent(stepId)
    if (intent === 'download' && pageVersion) returnTo += '&version=' + encodeURIComponent(pageVersion)
    if (intent === 'download' && filePath) returnTo += '&path=' + encodeURIComponent(filePath)
    return returnTo
  }

  function openSignin (intent, filePath) {
    intent = intent === 'download' ? 'download' : 'save'
    if (intent !== 'download') filePath = null
    if (!authAvailable()) {
      toast(lastWriteOk === false
        ? 'Progress is kept on this page only: this browser is blocking site storage.'
        : 'Progress is saved on this device.')
      return false
    }
    writeJSON(sessionArea(), PENDING_KEY, {
      intent: intent,
      solution: solutionId,
      step: stepId,
      version: pageVersion,
      path: filePath || undefined,
      at: now(),
    })
    track('solution_login_cta_click', baseProps({ intent: intent, path: filePath || undefined }))
    var copy = filePath ? fileSigninCopy(filePath) : SIGNIN_COPY[intent]
    dispatch('docs-account:open-signin', {
      title: copy.title,
      lead: copy.lead,
      cta: copy.cta,
      returnTo: intentReturnTo(intent, filePath),
    })
    return true
  }

  function downloadUrl (version) {
    var link = $('[data-sol-download]')
    var href = link && link.getAttribute('href')
    if (href) return href
    return DOWNLOAD_ENDPOINT + '?solution=' + encodeURIComponent(solutionId || '') +
      '&version=' + encodeURIComponent(version || pageVersion || '') +
      '&return=' + encodeURIComponent(window.location.pathname)
  }

  // The same endpoint as the bundle, for one file: it answers with a
  // Content-Disposition filename matching the repo's own filename.
  function fileDownloadUrl (filePath, version) {
    return DOWNLOAD_ENDPOINT + '?solution=' + encodeURIComponent(solutionId || '') +
      '&version=' + encodeURIComponent(version || pageVersion || '') +
      '&path=' + encodeURIComponent(filePath || '') +
      '&return=' + encodeURIComponent(window.location.pathname)
  }

  function startDownload (url) {
    try { window.location.assign(url) } catch (e) { /* ignore */ }
  }

  function stripIntentParams (params) {
    params.delete('intent')
    params.delete('step')
    params.delete('version')
    params.delete('path')
    params.delete('download_error')
    var qs = params.toString()
    try {
      window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash)
    } catch (e) { /* ignore */ }
  }

  // Returning from sign-in with ?intent=save|download (the return_to we built
  // in openSignin). Runs once: the params are stripped whatever happens.
  function handleIntent () {
    var params
    try { params = new URLSearchParams(window.location.search) } catch (e) { return }
    var intent = params.get('intent')
    if (!intent) return
    var version = params.get('version')
    var filePath = params.get('path')
    var pending = readJSON(sessionArea(), PENDING_KEY)
    removeKey(sessionArea(), PENDING_KEY)
    stripIntentParams(params)
    if (!hasAuthHint()) return
    // The path has to match the pending record too, so a URL edited to point at
    // another file is no more trusted than a bookmarked one.
    var fresh = !!(pending && pending.intent === intent && pending.solution === solutionId &&
      pending.at && now() - pending.at < PENDING_TTL_MS &&
      (pending.path || '') === (filePath || ''))
    if (intent === 'save') {
      markDirty()
      ;(syncPromise || Promise.resolve(false)).then(function () {
        if (pendingPut) return pendingPut
        return putStore(loadStore())
      }).then(function (ok) {
        if (ok) toast('Progress saved')
        track('solution_save_progress', baseProps({ intent: 'return' }))
      })
      return
    }
    if (intent === 'download') {
      // The pending record is the replay guard: a bookmarked or shared URL with
      // intent=download must not start a download on its own, with or without
      // a path. That also covers a sign-in trip docs-site started itself (a
      // middle-click or new-tab open of the link, which has no pending record
      // in this tab): say what to do next rather than nothing.
      if (!fresh) {
        toast(filePath
          ? 'You are signed in. Select Download on the snippet to get ' + filePath + '.'
          : 'You are signed in. Select Download to get the complete example.')
        return
      }
      version = version || (pending && pending.version)
      if (filePath) {
        track('solution_download', baseProps({ source: 'intent', kind: 'file', path: filePath }))
        startDownload(fileDownloadUrl(filePath, version))
        return
      }
      track('solution_download', baseProps({ source: 'intent', kind: 'bundle' }))
      startDownload(downloadUrl(version))
    }
  }

  // docs-site sends a failed download navigation back here with a fixed code
  // (solutions-download.mjs `fail`). Say what happened, and point at the
  // build-along files, which are never gated.
  var DOWNLOAD_ERRORS = {
    bundle_not_ready: 'The complete example is not ready to download yet.',
    rate_limited: 'Too many downloads in a short time. Try again in a few minutes.',
    not_found: 'This download is not available for this version of the solution. Reload the page and try again.',
    file_too_large: 'That file is too large to download here.',
  }
  var DOWNLOAD_FALLBACK = ' Every file you need is also on the step pages, under Files, to build along.'

  function handleDownloadError () {
    var params
    try { params = new URLSearchParams(window.location.search) } catch (e) { return }
    var code = params.get('download_error')
    if (!code) return
    params.delete('download_error')
    var qs = params.toString()
    try {
      window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash)
    } catch (e) { /* ignore */ }
    var message = Object.prototype.hasOwnProperty.call(DOWNLOAD_ERRORS, code)
      ? DOWNLOAD_ERRORS[code]
      : 'The download did not work. Try again in a moment.'
    toast(message + DOWNLOAD_FALLBACK, true)
    track('solution_download_error', baseProps({ error: /^[a-z_]{1,40}$/.test(code) ? code : 'unknown' }))
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function versionNoticeDismissed () {
    return readString(sessionArea(), VERSION_NOTICE_KEY) === solutionId + '@' + pageVersion
  }

  function dismissVersionNotice () {
    writeString(sessionArea(), VERSION_NOTICE_KEY, solutionId + '@' + pageVersion)
    $$('[data-sol-version-notice]').forEach(function (el) { el.hidden = true })
  }

  function setText (selector, text) {
    $$(selector).forEach(function (el) { el.textContent = text })
  }

  // Same breakpoint as the two-column layout in solutions.css: at or below it
  // the rail collapses into a <details>.
  function isNarrow () {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1280px)').matches
    } catch (e) {
      return false
    }
  }

  // Drafts have no release, so a download could only fail: label the CTA and
  // make it inert rather than send the reader to an error.
  var DRAFT_DOWNLOAD_LABEL = 'Download available at release'

  function disableDraftDownloads () {
    if (!isDraft) return
    $$('[data-sol-download]').forEach(function (el) {
      if (el.getAttribute('aria-disabled') === 'true') return
      el.removeAttribute('href')
      el.setAttribute('aria-disabled', 'true')
      if (el.classList) el.classList.add('is-disabled')
      var label = $('[data-sol-download-label]', el)
      if (label) label.textContent = DRAFT_DOWNLOAD_LABEL
      else el.textContent = DRAFT_DOWNLOAD_LABEL
    })
  }

  function render () {
    if (!isSolutionPage) return
    var record = getRecord(solutionId)
    var ids = steps().ids
    var urls = steps().urls
    var total = ids.length
    var done = countDone(record, ids)
    var finished = !!(record && total && done === total)
    var signedIn = hasAuthHint()
    var available = authAvailable()

    setText('[data-sol-progress-count]', done + ' of ' + total)
    $$('[data-sol-progress-fill]').forEach(function (el) {
      el.style.width = (total ? Math.round((done / total) * 100) : 0) + '%'
    })
    $$('[data-sol-progress-bar]').forEach(function (el) {
      el.setAttribute('aria-valuenow', String(done))
      el.setAttribute('aria-valuetext', done + ' of ' + total + ' steps complete')
    })
    setText('[data-sol-progress-state]', !record ? 'Not started' : finished ? 'Completed' : 'In progress')

    // Step ticks (overview list, rail list) and the current marker.
    $$('[data-sol-step-id]').forEach(function (el) {
      var id = attr(el, 'data-sol-step-id')
      var complete = isDone(record, id)
      var current = !!record && record.currentStep === id && !finished
      if (el.classList) {
        el.classList[complete ? 'add' : 'remove']('is-complete')
        el.classList[current ? 'add' : 'remove']('is-current')
      }
      var status = $('[data-sol-step-status]', el)
      if (status) status.textContent = complete ? '(completed)' : current ? '(current)' : ''
    })
    // Sidebar nav items: match on step id, falling back to url.
    $$('[data-sol-nav-url], [data-sol-nav-step]').forEach(function (el) {
      var navId = attr(el, 'data-sol-nav-step')
      var url = attr(el, 'data-sol-nav-url')
      var complete = false
      if (record) {
        if (navId && isDone(record, navId)) complete = true
        if (!complete && url) {
          for (var i = 0; i < ids.length; i++) {
            if (urls[ids[i]] === url && isDone(record, ids[i])) {
              complete = true
              break
            }
          }
        }
      }
      if (el.classList) el.classList[complete ? 'add' : 'remove']('is-complete')
    })

    // Hero CTA: Continue at the first step not done yet (not the step the
    // reader last had open, which is usually the one they just finished), or
    // Start again once everything is done.
    var start = $('[data-sol-start]')
    if (start) {
      var label = $('[data-sol-start-label]', start)
      var next = record && !finished ? firstIncomplete(record, ids) : null
      if (next && urls[next]) {
        start.setAttribute('href', urls[next])
        if (label) label.textContent = 'Continue'
      } else if (record && finished && ids.length && urls[ids[0]]) {
        start.setAttribute('href', urls[ids[0]])
        if (label) label.textContent = 'Start again'
      }
      var heroProgress = $('[data-sol-hero-progress]')
      if (heroProgress) {
        heroProgress.hidden = !record || !done
        heroProgress.textContent = record && done ? done + ' of ' + total + ' steps done' : ''
      }
    }

    // Step page controls. The button sits both in the rail card and in the
    // action row under the article (CSS shows whichever fits), so every copy
    // has to agree, and so does every header chip.
    if (stepId) {
      var isStepDone = isDone(record, stepId)
      $$('[data-sol-complete]').forEach(function (button) {
        button.setAttribute('aria-pressed', isStepDone ? 'true' : 'false')
        var completeLabel = $('[data-sol-complete-label]', button)
        if (completeLabel) completeLabel.textContent = isStepDone ? 'Completed' : 'Mark step complete'
      })
      $$('[data-sol-step-header-status]').forEach(function (el) { el.hidden = !isStepDone })
    }

    // Done panel. The rail copy collapses with the rail on narrow screens, so
    // the action row carries its own copy, shown only there.
    var narrow = isNarrow()
    $$('[data-sol-done]').forEach(function (el) {
      el.hidden = !finished || (el.hasAttribute('data-sol-done-inline') && !narrow)
    })

    // Gate + download visibility.
    $$('[data-sol-gate]').forEach(function (el) {
      el.hidden = signedIn
      var text = $('[data-sol-gate-text]', el)
      var button = $('[data-sol-signin]', el)
      if (!available) {
        if (text) text.textContent = 'Progress is saved on this device.'
        if (button) button.hidden = true
      } else {
        if (text) text.textContent = 'Sign in to save progress and download the complete example.'
        if (button) button.hidden = false
      }
    })
    $$('[data-sol-download][data-requires-auth]').forEach(function (el) { el.hidden = !available })
    $$('[data-sol-download-panel]').forEach(function (el) {
      var authOnly = !!$('[data-sol-download][data-requires-auth]', el)
      el.hidden = authOnly && !available
    })
    disableDraftDownloads()
    $$('[data-sol-save]').forEach(function (el) {
      el.hidden = !available
      var saveLabel = $('[data-sol-save-label]', el)
      if (saveLabel) saveLabel.textContent = signedIn ? 'Save now' : 'Save progress'
    })
    // Only claim "saved" when the last write actually landed.
    if (!signedIn) {
      var unsaved = !!record && lastWriteOk === false
      setSyncState(!record ? '' : unsaved ? 'Not saved: this browser is blocking site storage' : 'Saved on this device', unsaved)
    }
    // Snippet controls appear and disappear with the bundle CTA above.
    decorateFileBlocks()

    // Version-changed notice.
    var mismatch = !!(record && record.solutionVersion && pageVersion && record.solutionVersion !== pageVersion)
    $$('[data-sol-version-notice]').forEach(function (el) {
      el.hidden = !(mismatch && !versionNoticeDismissed())
    })
  }

  // ---------------------------------------------------------------------------
  // Start again: a real reset, confirmed in the page
  // ---------------------------------------------------------------------------

  // Every done step becomes { done: false, at: now }. That is an ordinary edit
  // under the per-step merge, so the reset reaches the account and every other
  // device instead of being undone by the next sync.
  function resetProgress (id) {
    id = id || solutionId
    var record = rawRecord(id)
    if (!record) return null
    var t = now()
    for (var step in record.steps) {
      if (!Object.prototype.hasOwnProperty.call(record.steps, step) || !record.steps[step].done) continue
      var at = editTime(record, step)
      record.steps[step] = { done: false, at: at }
      if (at > t) t = at
    }
    record.completedAt = null
    record.currentStep = null
    record.updatedAt = t
    setRecord(id, record)
    markDirty()
    scheduleSync()
    track('solution_reset', baseProps())
    render()
    return getRecord(id)
  }

  var resetConfirm = null

  function closeResetConfirm (focusStart) {
    if (!resetConfirm) return
    if (resetConfirm.parentNode) resetConfirm.parentNode.removeChild(resetConfirm)
    resetConfirm = null
    var start = $('[data-sol-start]')
    if (focusStart && start && start.focus) start.focus()
  }

  // No window.confirm: an inline group next to the button, with the two
  // choices as real buttons.
  function openResetConfirm (start) {
    if (resetConfirm || !document.createElement || !start.parentNode) return
    var ids = steps().ids
    var box = document.createElement('div')
    box.className = 'sol-reset-confirm'
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', 'Start again')
    box.setAttribute('data-sol-reset-confirm', '')
    var text = document.createElement('p')
    text.className = 'sol-reset-confirm-text'
    text.textContent = 'Clear your progress on all ' + ids.length + ' steps and start again from step 1?'
    var yes = document.createElement('button')
    yes.setAttribute('type', 'button')
    yes.className = 'sol-btn sol-btn--primary sol-btn--sm'
    yes.setAttribute('data-sol-reset-yes', '')
    yes.textContent = 'Clear progress'
    var no = document.createElement('button')
    no.setAttribute('type', 'button')
    no.className = 'sol-btn sol-btn--ghost sol-btn--sm'
    no.setAttribute('data-sol-reset-no', '')
    no.textContent = 'Keep my progress'
    box.appendChild(text)
    box.appendChild(yes)
    box.appendChild(no)
    yes.addEventListener('click', function () {
      var first = steps().urls[ids[0]]
      resetProgress(solutionId)
      closeResetConfirm(false)
      if (first) {
        try { window.location.assign(first) } catch (e) { /* ignore */ }
      }
    })
    no.addEventListener('click', function () { closeResetConfirm(true) })
    box.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape') closeResetConfirm(true)
    })
    start.parentNode.appendChild(box)
    resetConfirm = box
    if (yes.focus) yes.focus()
  }

  // ---------------------------------------------------------------------------
  // Recommendation debug + impressions (all pages)
  // ---------------------------------------------------------------------------

  function revealRecReasons () {
    var debug = false
    try { debug = readString(localArea(), DEBUG_RECS_KEY) === '1' } catch (e) { /* ignore */ }
    if (!debug) {
      try { debug = new URLSearchParams(window.location.search).get('debug') === 'recs' } catch (e) { /* ignore */ }
    }
    if (!debug) return
    $$('[data-sol-rec-why]').forEach(function (el) { el.hidden = false })
  }

  function observeImpressions () {
    var targets = []
    $$('[data-sol-card]').forEach(function (el, i) {
      targets.push({ el: el, name: 'solution_card_impression', props: { solution_id: attr(el, 'data-solution-id'), position: i + 1 } })
    })
    // Both recommendation placements: the cards after the article
    // (data-placement="article") and the compact rail list under On this page
    // (data-placement="rail"). `placement` is what makes them comparable.
    $$('[data-sol-rec]').forEach(function (el, i) {
      var recProps = function () {
        return {
          solution_id: attr(el, 'data-solution-id'),
          provenance: attr(el, 'data-provenance'),
          position: Number(attr(el, 'data-position')) || i + 1,
          placement: attr(el, 'data-placement'),
          component: component,
        }
      }
      targets.push({ el: el, name: 'product_doc_solution_rec_impression', props: recProps() })
      el.addEventListener('click', function () {
        track('product_doc_solution_rec_click', recProps())
      })
    })
    $$('[data-sol-gate]').forEach(function (el) {
      targets.push({ el: el, name: 'solution_login_cta_impression', props: baseProps({ intent: 'download' }) })
    })
    if (!targets.length) return
    if (typeof IntersectionObserver !== 'function') {
      targets.forEach(function (t) { track(t.name, t.props) })
      return
    }
    var byEl = []
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        for (var i = 0; i < byEl.length; i++) {
          if (byEl[i].el === entry.target && !byEl[i].seen) {
            byEl[i].seen = true
            if (!byEl[i].el.hidden) track(byEl[i].name, byEl[i].props)
            observer.unobserve(entry.target)
          }
        }
      })
    }, { threshold: 0.5 })
    targets.forEach(function (t) {
      byEl.push(t)
      observer.observe(t.el)
    })
  }

  // ---------------------------------------------------------------------------
  // "Build it in practice" in the rail (solution-recommendations-rail.hbs) is
  // rendered inside aside.toc.sidebar, which main.css hides below 1024px,
  // where 02-on-this-page.js instead shows a cloned aside.toc.embedded in the
  // article. Move the block there so it is not lost on narrow screens, and
  // move it back (to its original position) above the breakpoint.
  // ---------------------------------------------------------------------------

  function placeRailRecs () {
    var recs = $('[data-sol-rail-recs]')
    var embedded = $('aside.toc.embedded')
    if (!recs || !embedded || typeof window.matchMedia !== 'function') return
    var home = recs.parentNode
    var anchor = recs.nextSibling
    var mq = window.matchMedia('(max-width: 1024px)')
    var apply = function () {
      var target = mq.matches ? embedded : home
      if (recs.parentNode === target) return
      if (target === home && anchor && anchor.parentNode === home) home.insertBefore(recs, anchor)
      else target.appendChild(recs)
    }
    apply()
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', apply)
    else if (typeof mq.addListener === 'function') mq.addListener(apply)
  }

  // ---------------------------------------------------------------------------
  // Rail <details>: collapsed on narrow screens, always open otherwise.
  // ---------------------------------------------------------------------------

  function manageDetails (selector) {
    var els = $$(selector)
    if (!els.length || typeof window.matchMedia !== 'function') return
    // Same breakpoint as the two-column layout in solutions.css.
    var mq = window.matchMedia('(max-width: 1280px)')
    var apply = function () {
      els.forEach(function (el) {
        if (mq.matches) {
          // On the overview the rail holds the finish message and the
          // download offer, and there is no action row to repeat them: open
          // it for a reader who is done. Step pages repeat the done block in
          // the action row instead, so their rail stays collapsed.
          if (!el.__solToggled) el.open = isOverview && overviewFinished()
        } else {
          el.open = true
        }
      })
      render()
    }
    els.forEach(function (el) {
      el.addEventListener('toggle', function () { if (mq.matches) el.__solToggled = true })
    })
    apply()
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', apply)
    else if (typeof mq.addListener === 'function') mq.addListener(apply)
  }

  function overviewFinished () {
    var ids = steps().ids
    return allDone(loadStore().solutions[solutionId] || null, ids)
  }

  // ---------------------------------------------------------------------------
  // Snippet file downloads
  // ---------------------------------------------------------------------------

  // Arrow into a tray, matching the stroke weight of the toolbox copy icon.
  var DOWNLOAD_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ' +
    'class="sol-file-download-icon">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/>' +
    '<line x1="12" y1="15" x2="12" y2="3"/></svg>'

  function fileDownloadsGated () {
    return downloadPolicy !== 'public'
  }

  // Present only where the bundle CTA is present: never for 'none', always for
  // 'public', and for 'authenticated' only while signing in is actually
  // possible (authAvailable is what hides the CTA in render). A control a
  // reader cannot complete is worse than no control.
  function fileDownloadsAvailable () {
    if (downloadPolicy === 'none' || isDraft) return false
    if (!fileDownloadsGated()) return true
    return authAvailable()
  }

  function removeFileControls () {
    $$('[data-sol-file-download]').forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el)
    })
  }

  // 06-copy-to-clipboard.js builds the toolbox for every block it can copy, so
  // one is normally already there; a block it skipped still gets a control.
  function toolboxFor (block) {
    var toolbox = $('.source-toolbox', block)
    if (toolbox) return toolbox
    var content = $('.content', block)
    if (!content || !document.createElement) return null
    toolbox = document.createElement('div')
    toolbox.className = 'source-toolbox'
    content.appendChild(toolbox)
    return toolbox
  }

  // Only blocks the extension traced back to an include::example$ carry
  // data-solution-file. A shell command is not a file, so command blocks have
  // no annotation and get no control.
  function decorateFileBlocks () {
    if (!isSolutionPage || !fileDownloadsAvailable()) {
      removeFileControls()
      return
    }
    $$('.listingblock[data-solution-file]').forEach(function (block) {
      var filePath = attr(block, 'data-solution-file')
      if (!filePath) return
      var toolbox = toolboxFor(block)
      if (!toolbox || $('[data-sol-file-download]', toolbox)) return
      var button = document.createElement('button')
      button.className = 'sol-file-download'
      button.setAttribute('type', 'button')
      button.setAttribute('data-sol-file-download', filePath)
      button.setAttribute('data-analytics', 'solution_download')
      // The visible label is short because the toolbox is narrow; the file is
      // named for screen readers and on hover. A block that showed only a
      // tagged region says so: what downloads is the whole file, under the
      // repo's own filename, and a reader looking at a ten-line excerpt should
      // not have to guess that.
      var label = attr(block, 'data-solution-tag')
        ? 'Download the full file ' + filePath
        : 'Download ' + filePath
      button.setAttribute('aria-label', label)
      button.setAttribute('title', label)
      button.innerHTML = DOWNLOAD_ICON + '<span class="sol-file-download-label">Download</span>'
      toolbox.appendChild(button)
      button.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault()
        if (fileDownloadsGated() && !hasAuthHint()) {
          openSignin('download', filePath)
          return
        }
        track('solution_download', baseProps({ source: 'click', kind: 'file', path: filePath }))
        startDownload(fileDownloadUrl(filePath, pageVersion))
      })
    })
  }

  // ---------------------------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------------------------

  window.docsSolutions = {
    getState: getState,
    getRecord: getRecord,
    markComplete: markComplete,
    unmarkComplete: unmarkComplete,
    setCurrent: setCurrent,
    save: save,
    merge: mergeStores,
    mergeRecord: mergeRecord,
    track: track,
    hasAuthHint: hasAuthHint,
    manageDetails: manageDetails,
    placeRailRecs: placeRailRecs,
    decorateFileBlocks: decorateFileBlocks,
    reset: resetProgress,
  }

  // Another tab wrote the store: merge its copy into ours (never just adopt
  // it: this tab may hold changes its own write could not store) and redraw.
  function onStorage (e) {
    if (e && e.key !== STORE_KEY && e.key !== null && e.key !== undefined) return
    localRev++
    memoryStore = mergeStores(readDisk(), memoryStore || emptyStore())
    dispatch('docs-solutions:change', { store: getState() })
    render()
  }

  // Restored from the back-forward cache: everything in memory is from before
  // the reader left. Drop it, re-check the sign-in state, and redraw.
  function onPageShow (e) {
    if (!e || !e.persisted) return
    memoryStore = null
    closeResetConfirm(false)
    syncOnLoad()
    if (isSolutionPage && isStep && stepId) setCurrent(solutionId, stepId, pageVersion)
    render()
  }

  syncOnLoad()
  revealRecReasons()
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('storage', onStorage)
    window.addEventListener('pageshow', onPageShow)
  }

  if (isSolutionPage) {
    if (isStep && stepId) {
      setCurrent(solutionId, stepId, pageVersion)
      track('solution_step_view', baseProps({ step_index: Number(attr(body, 'data-step-index')) || null }))
    }

    $$('[data-sol-complete]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (isDone(rawRecord(solutionId), stepId)) unmarkComplete(solutionId, stepId)
        else markComplete(solutionId, stepId, pageVersion)
      })
    })
    $$('[data-sol-save]').forEach(function (el) {
      el.addEventListener('click', function () { save() })
    })
    $$('[data-sol-signin]').forEach(function (el) {
      el.addEventListener('click', function () { openSignin(attr(el, 'data-intent') || 'download') })
    })
    $$('[data-sol-download]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (isDraft) {
          if (e && e.preventDefault) e.preventDefault()
          return
        }
        if (el.hasAttribute('data-requires-auth') && !hasAuthHint()) {
          e.preventDefault()
          openSignin('download')
          return
        }
        track('solution_download', baseProps({ source: 'click', kind: 'bundle' }))
      })
    })
    $$('[data-sol-version-dismiss]').forEach(function (el) {
      el.addEventListener('click', dismissVersionNotice)
    })
    $$('[data-sol-start]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        // Finished: "Start again" asks first, then really clears the steps.
        if (allDone(rawRecord(solutionId), steps().ids)) {
          if (e && e.preventDefault) e.preventDefault()
          openResetConfirm(el)
          return
        }
        track('solution_start_click', baseProps())
      })
    })

    // An overview has no setCurrent on load, so recompute completedAt here.
    if (isOverview) {
      var loaded = rawRecord(solutionId)
      if (stampCompletion(loaded, steps().ids)) {
        loaded.updatedAt = now()
        setRecord(solutionId, loaded)
        markDirty()
        scheduleSync()
      }
    }
    manageDetails('[data-sol-rail]')
    render()
    handleDownloadError()
    handleIntent()
    // 26-docs-account.js may learn auth availability after us.
    window.addEventListener('kapa-session', render)
  }

  placeRailRecs()
  observeImpressions()
})()

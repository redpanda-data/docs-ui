/* global localStorage, sessionStorage, fetch, IntersectionObserver, CustomEvent, URLSearchParams */
/**
 * Solutions progress: local-first, synced for signed-in readers.
 *
 * Runs on every page (it owns window.docsSolutions, which the landing page
 * reads for "Continue learning" and which recommendation cards use for
 * analytics) but only wires page UI on solution overview and step pages
 * (<body class="solution|solution-step" data-solution-id=...>).
 *
 * Store (localStorage 'docs-solutions-progress'):
 *   { v: 1, updatedAt, solutions: { <id>: {
 *       completedSteps: [stepId], currentStep, startedAt, updatedAt,
 *       completedAt, solutionVersion } } }
 * Timestamps are epoch milliseconds. Storage failures fail closed: reads give
 * an empty store, writes are dropped, and the page keeps an in-memory copy so
 * the UI still works for the current view. Caps: 50 solutions x 100 steps,
 * evicting the least recently updated first.
 *
 * Rules:
 *   - Nothing is ever marked complete implicitly. Only the explicit "Mark step
 *     complete" click does that. Loading a step only records it as current.
 *   - Completed count = completedSteps that are still step ids of the current
 *     version. Unknown ids are kept (they may return) but never counted.
 *   - A stored solutionVersion that differs from the page's version shows the
 *     version-changed notice once per tab session.
 *   - Signed in (rp_docs_auth hint cookie): GET /solutions/progress (60 s
 *     sessionStorage cache); first sign-in in this browser or dirty local state
 *     PUTs the merged store and the server's answer replaces local. Hint
 *     false -> true merges; true -> false (sign-out) clears local state.
 *   - Merge is mergeStores(existing, incoming), the same function as the
 *     server's mergeAll(existing, incoming); the incoming side wins ties on
 *     updatedAt. On load the client calls mergeStores(remote, local), the same
 *     roles the server uses for (stored, clientBody), so both compute the same
 *     document. A PUT response is adopted as is, never merged.
 *     Per solution: ordered union of completedSteps (earlier-updated record's
 *     steps first, then the later record's additions), max updatedAt, min
 *     startedAt, currentStep and solutionVersion from the later record
 *     (falling back to the other when null), completedAt = earliest unless the
 *     two versions differ, in which case null. Ids are validated with the
 *     server's regexes and timestamps are clamped to now + 5 minutes.
 *     tests/solution-progress/fixtures/merge-vectors.json is the shared
 *     contract (copied from docs-site).
 *   - Every code block the extension annotated with data-solution-file gets a
 *     download control in its toolbox (next to Copy), which serves that one
 *     file from the same endpoint as the bundle. Gated the same way, and the
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
  var REMOTE_TTL_MS = 60 * 1000
  var PENDING_TTL_MS = 15 * 60 * 1000
  var PUT_DEBOUNCE_MS = 800

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------

  function now () { return Date.now() }

  function isString (value) { return typeof value === 'string' && value.length > 0 }

  function toTime (value) {
    if (typeof value === 'number' && isFinite(value) && value > 0) return Math.floor(value)
    if (isString(value)) {
      var parsed = Date.parse(value)
      if (!isNaN(parsed)) return parsed
      var asNumber = Number(value)
      if (isFinite(asNumber) && asNumber > 0) return Math.floor(asNumber)
    }
    return null
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
    try { storage.setItem(key, value) } catch (e) { /* fail closed */ }
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

  function emptyStore () { return { v: 1, updatedAt: 0, solutions: {} } }

  function isId (value) { return isString(value) && ID_RE.test(value) }
  function isVersion (value) { return isString(value) && VERSION_RE.test(value) }

  // Timestamps from the future (clock skew, tampering) are capped at now + 5
  // minutes so one bad record cannot win every merge forever.
  function clampTime (value, nowMs) {
    if (value === null) return null
    var max = nowMs + FUTURE_SKEW_MS
    return value > max ? max : value
  }

  function normalizeRecord (raw, nowMs) {
    if (!raw || typeof raw !== 'object') return null
    nowMs = nowMs || now()
    var steps = []
    var seen = {}
    var source = Array.isArray(raw.completedSteps) ? raw.completedSteps : []
    for (var i = 0; i < source.length; i++) {
      var step = source[i]
      if (isId(step) && !seen[step]) {
        seen[step] = true
        steps.push(step)
      }
    }
    if (steps.length > MAX_STEPS) steps = steps.slice(steps.length - MAX_STEPS)
    return {
      completedSteps: steps,
      currentStep: isId(raw.currentStep) ? raw.currentStep : null,
      startedAt: clampTime(toTime(raw.startedAt), nowMs),
      updatedAt: clampTime(toTime(raw.updatedAt), nowMs) || 0,
      completedAt: clampTime(toTime(raw.completedAt), nowMs),
      solutionVersion: isVersion(raw.solutionVersion) ? raw.solutionVersion : null,
    }
  }

  // Keep at most 50 solutions and a serialized document of at most 32 KiB,
  // evicting the smallest updatedAt first (ties by id). Same as the server.
  var MAX_BYTES = 32768

  function applyCaps (store) {
    var ids = Object.keys(store.solutions)
    ids.sort(function (a, b) {
      var diff = (store.solutions[b].updatedAt || 0) - (store.solutions[a].updatedAt || 0)
      if (diff) return diff
      return a < b ? 1 : a > b ? -1 : 0
    })
    var keep = Math.min(ids.length, MAX_SOLUTIONS)
    var rebuild = function () {
      var kept = {}
      for (var i = 0; i < keep; i++) kept[ids[i]] = store.solutions[ids[i]]
      return kept
    }
    var kept = ids.length > MAX_SOLUTIONS ? rebuild() : store.solutions
    while (keep > 0 && JSON.stringify({ v: 1, updatedAt: store.updatedAt, solutions: kept }).length > MAX_BYTES) {
      keep--
      kept = rebuild()
    }
    store.solutions = kept
    return store
  }

  function normalizeStore (raw, nowMs) {
    var store = emptyStore()
    if (!raw || typeof raw !== 'object' || !raw.solutions || typeof raw.solutions !== 'object') return store
    nowMs = nowMs || now()
    var maxUpdated = clampTime(toTime(raw.updatedAt), nowMs) || 0
    for (var id in raw.solutions) {
      if (!Object.prototype.hasOwnProperty.call(raw.solutions, id) || !isId(id)) continue
      var record = normalizeRecord(raw.solutions[id], nowMs)
      if (!record) continue
      store.solutions[id] = record
      if (record.updatedAt > maxUpdated) maxUpdated = record.updatedAt
    }
    store.updatedAt = maxUpdated
    return applyCaps(store)
  }

  function loadStore () {
    if (memoryStore) return memoryStore
    memoryStore = normalizeStore(readJSON(localStorage, STORE_KEY))
    return memoryStore
  }

  function persistStore (store) {
    memoryStore = applyCaps(store)
    writeJSON(localStorage, STORE_KEY, memoryStore)
    dispatch('docs-solutions:change', { store: clone(memoryStore) })
    return memoryStore
  }

  function clearLocal () {
    memoryStore = emptyStore()
    removeKey(localStorage, STORE_KEY)
    removeKey(localStorage, DIRTY_KEY)
    removeKey(sessionStorage, REMOTE_CACHE_KEY)
    dispatch('docs-solutions:change', { store: emptyStore() })
  }

  function getRecord (id) {
    var store = loadStore()
    return store.solutions[id] ? clone(store.solutions[id]) : null
  }

  function setRecord (id, record) {
    var store = loadStore()
    record.updatedAt = record.updatedAt || now()
    store.solutions[id] = normalizeRecord(record)
    if (store.solutions[id].updatedAt > store.updatedAt) store.updatedAt = store.solutions[id].updatedAt
    return persistStore(store)
  }

  function isDirty () { return readString(localStorage, DIRTY_KEY) === '1' }
  function markDirty () { writeString(localStorage, DIRTY_KEY, '1') }
  function clearDirty () { removeKey(localStorage, DIRTY_KEY) }

  // ---------------------------------------------------------------------------
  // Merge (shared contract with docs-site; see merge-vectors.json)
  // ---------------------------------------------------------------------------

  function minTime (a, b) {
    if (a === null || a === undefined) return b === undefined ? null : b
    if (b === null || b === undefined) return a
    return Math.min(a, b)
  }

  function union (first, second) {
    var out = first.slice()
    var seen = {}
    for (var i = 0; i < out.length; i++) seen[out[i]] = true
    for (var j = 0; j < second.length; j++) {
      if (!seen[second[j]]) {
        seen[second[j]] = true
        out.push(second[j])
      }
    }
    return out
  }

  // mergeRecord(existing, incoming): the incoming record wins ties on updatedAt,
  // exactly like the server's merge, so mergeStores(local, remote) on the
  // client and mergeAll(existing, incoming) on the server produce one result.
  function mergeRecord (existing, incoming, nowMs) {
    nowMs = nowMs || now()
    var a = normalizeRecord(existing, nowMs)
    var b = normalizeRecord(incoming, nowMs)
    if (!a) return b
    if (!b) return a
    var later = b.updatedAt >= a.updatedAt ? b : a
    var earlier = later === a ? b : a
    var versionsDiffer = !!(a.solutionVersion && b.solutionVersion && a.solutionVersion !== b.solutionVersion)
    return {
      completedSteps: union(earlier.completedSteps, later.completedSteps).slice(-MAX_STEPS),
      currentStep: later.currentStep || earlier.currentStep || null,
      startedAt: minTime(a.startedAt, b.startedAt),
      updatedAt: Math.max(a.updatedAt, b.updatedAt),
      // A completion recorded against a different version of the solution is
      // not a completion of this one.
      completedAt: versionsDiffer ? null : minTime(a.completedAt, b.completedAt),
      solutionVersion: later.solutionVersion || earlier.solutionVersion || null,
    }
  }

  function mergeStores (existing, incoming, nowMs) {
    nowMs = nowMs || now()
    existing = normalizeStore(existing, nowMs)
    incoming = normalizeStore(incoming, nowMs)
    var merged = emptyStore()
    var ids = {}
    var id
    for (id in existing.solutions) if (Object.prototype.hasOwnProperty.call(existing.solutions, id)) ids[id] = true
    for (id in incoming.solutions) if (Object.prototype.hasOwnProperty.call(incoming.solutions, id)) ids[id] = true
    for (id in ids) {
      var record = mergeRecord(existing.solutions[id], incoming.solutions[id], nowMs)
      if (!record) continue
      merged.solutions[id] = record
      if (record.updatedAt > merged.updatedAt) merged.updatedAt = record.updatedAt
    }
    merged.updatedAt = Math.max(merged.updatedAt, existing.updatedAt || 0, incoming.updatedAt || 0)
    return applyCaps(merged)
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
      if (record.completedSteps.indexOf(ids[i]) !== -1) count++
    }
    return count
  }

  function allDone (record, ids) {
    return ids.length > 0 && countDone(record, ids) === ids.length
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

  function toast (message) {
    if (!body || !document.createElement) return
    var el = document.createElement('div')
    el.className = 'sol-toast'
    el.setAttribute('role', 'status')
    el.textContent = message
    body.appendChild(el)
    setTimeout(function () { el.classList.add('is-visible') }, 10)
    setTimeout(function () {
      el.classList.remove('is-visible')
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el) }, 250)
    }, 4000)
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
    var cached = readJSON(sessionStorage, REMOTE_CACHE_KEY)
    if (cached && cached.at && now() - cached.at < REMOTE_TTL_MS && cached.store) return normalizeStore(cached.store)
    return null
  }

  function writeRemoteCache (store) {
    writeJSON(sessionStorage, REMOTE_CACHE_KEY, { at: now(), store: store })
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
    var payload = { v: 1, updatedAt: store.updatedAt || now(), solutions: store.solutions }
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
          // or under `progress` (the same shape GET returns). Adopt it.
          var body = data && data.solutions ? data : (data && data.progress && data.progress.solutions ? data.progress : null)
          var serverStore = normalizeStore(body || payload)
          persistStore(serverStore)
          writeRemoteCache(serverStore)
          clearDirty()
          setSyncState('Saved to your account')
          return true
        }, function () {
          // 2xx with no JSON body: the server accepted what we sent.
          var sentStore = normalizeStore(payload)
          persistStore(sentStore)
          writeRemoteCache(sentStore)
          clearDirty()
          setSyncState('Saved to your account')
          return true
        })
      })
      .catch(function () {
        markDirty()
        setSyncState('Offline, saved on this device', true)
        return false
      })
    pendingPut = request.then(function (ok) { pendingPut = null; render(); return ok })
    return pendingPut
  }

  function scheduleSync () {
    if (!hasAuthHint()) return
    if (putTimer) clearTimeout(putTimer)
    putTimer = setTimeout(function () {
      putTimer = null
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
    var previous = readString(localStorage, HINT_KEY)
    if (!signedIn) {
      // true -> false: the reader signed out. Their progress lives in their
      // account now; do not leave a copy on a possibly shared device.
      if (previous === 'true') clearLocal()
      writeString(localStorage, HINT_KEY, 'false')
      syncPromise = Promise.resolve(false)
      return syncPromise
    }
    var firstSignIn = previous !== 'true'
    writeString(localStorage, HINT_KEY, 'true')
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
      var merged = mergeStores(remote, loadStore())
      persistStore(merged)
      if (isDirty()) return putStore(merged)
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
    var sent = readJSON(localStorage, ACTIVITY_KEY) || []
    if (sent.indexOf(key) !== -1) return
    sent.push(key)
    writeJSON(localStorage, ACTIVITY_KEY, sent.slice(-200))
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
    return { completedSteps: [], currentStep: null, startedAt: t, updatedAt: t, completedAt: null, solutionVersion: version || null }
  }

  function setCurrent (id, step, version) {
    id = id || solutionId
    step = step || stepId
    version = version || pageVersion
    if (!id || !step) return getRecord(id)
    var record = getRecord(id)
    var started = false
    if (!record) {
      record = newRecord(version)
      started = true
    }
    var changed = started || record.currentStep !== step
    record.currentStep = step
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
    var record = getRecord(id) || newRecord(version)
    var t = now()
    var wasComplete = record.completedSteps.indexOf(step) !== -1
    if (!wasComplete) record.completedSteps.push(step)
    record.currentStep = step
    record.solutionVersion = version || record.solutionVersion
    record.updatedAt = t
    var ids = id === solutionId ? steps().ids : []
    var finished = false
    if (!record.completedAt && allDone(record, ids)) {
      record.completedAt = t
      finished = true
    }
    setRecord(id, record)
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
    var record = getRecord(id)
    if (!record) return null
    var idx = record.completedSteps.indexOf(step)
    if (idx === -1) return record
    record.completedSteps.splice(idx, 1)
    record.completedAt = null
    record.updatedAt = now()
    setRecord(id, record)
    markDirty()
    scheduleSync()
    render()
    return getRecord(id)
  }

  function getState () { return clone(loadStore()) }

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
      toast('Progress is saved on this device.')
      return false
    }
    writeJSON(sessionStorage, PENDING_KEY, {
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
    var pending = readJSON(sessionStorage, PENDING_KEY)
    removeKey(sessionStorage, PENDING_KEY)
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
      // a path.
      if (!fresh) return
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

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function versionNoticeDismissed () {
    return readString(sessionStorage, VERSION_NOTICE_KEY) === solutionId + '@' + pageVersion
  }

  function dismissVersionNotice () {
    writeString(sessionStorage, VERSION_NOTICE_KEY, solutionId + '@' + pageVersion)
    $$('[data-sol-version-notice]').forEach(function (el) { el.hidden = true })
  }

  function setText (selector, text) {
    $$(selector).forEach(function (el) { el.textContent = text })
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
    $$('[data-sol-progress-bar]').forEach(function (el) { el.setAttribute('aria-valuenow', String(done)) })
    setText('[data-sol-progress-state]', !record ? 'Not started' : finished ? 'Completed' : 'In progress')

    // Step ticks (overview list, rail list) and the current marker.
    $$('[data-sol-step-id]').forEach(function (el) {
      var id = attr(el, 'data-sol-step-id')
      var complete = !!record && record.completedSteps.indexOf(id) !== -1
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
        if (navId && record.completedSteps.indexOf(navId) !== -1) complete = true
        if (!complete && url) {
          for (var i = 0; i < ids.length; i++) {
            if (urls[ids[i]] === url && record.completedSteps.indexOf(ids[i]) !== -1) {
              complete = true
              break
            }
          }
        }
      }
      if (el.classList) el.classList[complete ? 'add' : 'remove']('is-complete')
    })

    // Hero CTA: Continue where you left off.
    var start = $('[data-sol-start]')
    if (start) {
      var label = $('[data-sol-start-label]', start)
      if (record && !finished && record.currentStep && urls[record.currentStep]) {
        start.setAttribute('href', urls[record.currentStep])
        if (label) label.textContent = 'Continue'
      } else if (record && finished && ids.length && urls[ids[0]]) {
        if (label) label.textContent = 'Start again'
      }
      var heroProgress = $('[data-sol-hero-progress]')
      if (heroProgress) {
        heroProgress.hidden = !record || !done
        heroProgress.textContent = record && done ? done + ' of ' + total + ' steps done' : ''
      }
    }

    // Step page controls.
    var complete = $('[data-sol-complete]')
    if (complete && stepId) {
      var isDone = !!record && record.completedSteps.indexOf(stepId) !== -1
      complete.setAttribute('aria-pressed', isDone ? 'true' : 'false')
      var completeLabel = $('[data-sol-complete-label]', complete)
      if (completeLabel) completeLabel.textContent = isDone ? 'Completed' : 'Mark step complete'
      var headerStatus = $('[data-sol-step-header-status]')
      if (headerStatus) headerStatus.hidden = !isDone
    }

    // Done panel.
    $$('[data-sol-done]').forEach(function (el) { el.hidden = !finished })

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
    $$('[data-sol-save]').forEach(function (el) {
      el.hidden = !available
      var saveLabel = $('[data-sol-save-label]', el)
      if (saveLabel) saveLabel.textContent = signedIn ? 'Save now' : 'Save progress'
    })
    if (!signedIn) setSyncState(available ? (record ? 'Saved on this device' : '') : (record ? 'Saved on this device' : ''))

    // Version-changed notice.
    var mismatch = !!(record && record.solutionVersion && pageVersion && record.solutionVersion !== pageVersion)
    $$('[data-sol-version-notice]').forEach(function (el) {
      el.hidden = !(mismatch && !versionNoticeDismissed())
    })
  }

  // ---------------------------------------------------------------------------
  // Recommendation debug + impressions (all pages)
  // ---------------------------------------------------------------------------

  function revealRecReasons () {
    var debug = false
    try { debug = localStorage.getItem(DEBUG_RECS_KEY) === '1' } catch (e) { /* ignore */ }
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
          if (!el.__solToggled) el.open = false
        } else {
          el.open = true
        }
      })
    }
    els.forEach(function (el) {
      el.addEventListener('toggle', function () { if (mq.matches) el.__solToggled = true })
    })
    apply()
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', apply)
    else if (typeof mq.addListener === 'function') mq.addListener(apply)
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
      // named for screen readers and on hover.
      button.setAttribute('aria-label', 'Download ' + filePath)
      button.setAttribute('title', 'Download ' + filePath)
      button.innerHTML = DOWNLOAD_ICON + '<span class="sol-file-download-label">Download</span>'
      toolbox.appendChild(button)
      button.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault()
        if (!hasAuthHint()) {
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
  }

  syncOnLoad()
  revealRecReasons()

  if (isSolutionPage) {
    if (isStep && stepId) {
      setCurrent(solutionId, stepId, pageVersion)
      track('solution_step_view', baseProps({ step_index: Number(attr(body, 'data-step-index')) || null }))
    }

    $$('[data-sol-complete]').forEach(function (el) {
      el.addEventListener('click', function () {
        var record = getRecord(solutionId)
        if (record && record.completedSteps.indexOf(stepId) !== -1) unmarkComplete(solutionId, stepId)
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
      el.addEventListener('click', function () { track('solution_start_click', baseProps()) })
    })

    decorateFileBlocks()
    manageDetails('[data-sol-rail]')
    render()
    handleIntent()
    // 26-docs-account.js may learn auth availability after us.
    window.addEventListener('kapa-session', render)
  }

  placeRailRecs()
  observeImpressions()
})()

'use strict'

// Dropping the version scope when Kapa rejects the source group (DOC-1807,
// DOC-2450 review round 2).
//
// The design assumed a stale group id degrades silently to Kapa's global
// sources. Measured live it does not: the Chat SDK's query endpoint answers
// HTTP 400 {"source_group_ids_include":["Invalid pk ... object does not
// exist."]} and the Agent SDK throws "Agent request failed: 400 ..." with that
// body. Without this module every question on the affected pages fails until
// the regenerated mapping ships through three repos.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..', '..')
const scope = require(path.join(ROOT, 'src/js/react/kapaScope.js'))

// A minimal window for the module's globals and events.
function fakeWindow (ids) {
  const listeners = {}
  return {
    KAPA_SOURCE_GROUP_IDS: ids,
    KAPA_SOURCE_GROUP_SEGMENT: '25.2',
    addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn) },
    dispatchEvent: (ev) => { (listeners[ev.type] || []).forEach((fn) => fn(ev)); return true },
    _listeners: listeners,
    CustomEvent: class CustomEvent { constructor (type, init) { this.type = type; this.detail = init && init.detail } },
  }
}

test.beforeEach(() => {
  global.window = fakeWindow(['grp-252'])
})
test.afterEach(() => { delete global.window })

test('isScopeRejection matches the Agent SDK message for a stale group, and nothing else', () => {
  assert.equal(scope.isScopeRejection('Agent request failed: 400 {"source_group_ids_include":["Invalid pk \\"0000\\" - object does not exist."]}'), true)
  assert.equal(scope.isScopeRejection('Agent request failed: 500 Internal Server Error'), false)
  assert.equal(scope.isScopeRejection('Network error while fetching answer.'), false)
  for (const v of [undefined, null, 42, {}]) assert.equal(scope.isScopeRejection(v), false)
})

test('chatSdkErrorMayBeScopeRejection needs a sent scope, no streamed bytes, and the generic error', () => {
  const generic = 'Something went wrong. If the issue persists reach out to support.'
  assert.equal(scope.chatSdkErrorMayBeScopeRejection(generic, true, false), true)
  // No scope was sent, so the group cannot be the cause.
  assert.equal(scope.chatSdkErrorMayBeScopeRejection(generic, false, false), false)
  // Bytes streamed, so the request was accepted; a mid-stream failure is not a rejection.
  assert.equal(scope.chatSdkErrorMayBeScopeRejection(generic, true, true), false)
  // The SDK names captcha, rate-limit and network failures distinctly.
  for (const other of [
    'We noticed unusual activity. Please try asking your question again.',
    'There have been too many requests, please try again in a minute.',
    'Network error while fetching answer.',
  ]) assert.equal(scope.chatSdkErrorMayBeScopeRejection(other, true, false), false, other)
})

test('dropScope clears both globals, announces once, and reports whether anything was dropped', () => {
  const seen = []
  window.addEventListener(scope.SCOPE_DROPPED_EVENT, (ev) => seen.push(ev.detail.reason))
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(scope.dropScope('400 from Kapa'), true)
    assert.deepEqual(window.KAPA_SOURCE_GROUP_IDS, [])
    assert.equal(window.KAPA_SOURCE_GROUP_SEGMENT, '')
    assert.deepEqual(seen, ['400 from Kapa'])
    // Already dropped: nothing to announce, no second event.
    assert.equal(scope.dropScope('again'), false)
    assert.deepEqual(seen, ['400 from Kapa'])
  } finally { console.warn = warn }
})

test('readScopeIds keeps only non-empty strings', () => {
  window.KAPA_SOURCE_GROUP_IDS = ['grp', '', null, 7, 'grp2']
  assert.deepEqual(scope.readScopeIds(), ['grp', 'grp2'])
  window.KAPA_SOURCE_GROUP_IDS = 'nope'
  assert.deepEqual(scope.readScopeIds(), [])
})

test('wrapScopeFallback leaves callbacks alone when no scope is sent', () => {
  const cbs = { onError: () => {} }
  assert.equal(scope.wrapScopeFallback({ query: 'q' }, cbs), cbs)
  assert.equal(scope.wrapScopeFallback({ query: 'q', sourceGroupIDsInclude: [] }, cbs), cbs)
})

test('wrapScopeFallback turns a pre-stream generic failure into a dropped scope and the drop message', () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    const errors = []
    const wrapped = scope.wrapScopeFallback({ sourceGroupIDsInclude: ['grp-252'] }, { onError: (m) => errors.push(m) })
    wrapped.onError('Something went wrong. If the issue persists reach out to support.')
    assert.deepEqual(errors, [scope.SCOPE_DROPPED_MESSAGE])
    assert.deepEqual(window.KAPA_SOURCE_GROUP_IDS, [])
  } finally { console.warn = warn }
})

test('wrapScopeFallback passes through a failure after bytes streamed, and every other error verbatim', () => {
  const errors = []
  const started = []
  const wrapped = scope.wrapScopeFallback(
    { sourceGroupIDsInclude: ['grp-252'] },
    { onError: (m) => errors.push(m), onStreamStart: () => started.push('start'), onFirstToken: () => started.push('token') }
  )
  wrapped.onStreamStart()
  wrapped.onFirstToken()
  wrapped.onError('Something went wrong. If the issue persists reach out to support.')
  wrapped.onError('Network error while fetching answer.')
  assert.deepEqual(started, ['start', 'token'])
  assert.deepEqual(errors, [
    'Something went wrong. If the issue persists reach out to support.',
    'Network error while fetching answer.',
  ])
  assert.deepEqual(window.KAPA_SOURCE_GROUP_IDS, ['grp-252'], 'scope must survive a mid-stream failure')
})

test('wrapScopeFallback tolerates callbacks the SDK did not supply', () => {
  const wrapped = scope.wrapScopeFallback({ sourceGroupIDsInclude: ['grp-252'] }, {})
  assert.doesNotThrow(() => { wrapped.onStreamStart(); wrapped.onFirstToken(); wrapped.onError('x') })
})

test('the app re-renders the providers without the prop after a drop', () => {
  // Structural: App must hold the scope in state fed by SCOPE_DROPPED_EVENT and
  // pass it to sourceGroupProps, or the providers keep sending the dead group.
  const askai = fs.readFileSync(path.join(ROOT, 'src/js/react/AskAI.jsx'), 'utf8')
  assert.match(askai, /const scopeIds = useKapaScopeIds\(\)/)
  assert.match(askai, /sourceGroupProps\('agent', scopeIds\)/)
  assert.match(askai, /sourceGroupProps\('chat', scopeIds\)/)
  assert.match(askai, /addEventListener\(SCOPE_DROPPED_EVENT/)
  // The agent tier detects the rejection from its error event.
  assert.match(askai, /case 'response_error':[\s\S]*?isScopeRejection\(event\.data\.error\)\) dropScope/)
  // The chat tier shows the drop message and retries once instead of blaming the captcha.
  const chat = fs.readFileSync(path.join(ROOT, 'src/js/react/components/ChatSdkInterface.jsx'), 'utf8')
  assert.match(chat, /error === SCOPE_DROPPED_MESSAGE/)
  assert.match(chat, /handleRetry\(latestQA\.question\)/)
  const service = fs.readFileSync(path.join(ROOT, 'src/js/react/persistentApiService.js'), 'utf8')
  assert.match(service, /wrapScopeFallback\(enhancedArgs, callbacks\)/)
})

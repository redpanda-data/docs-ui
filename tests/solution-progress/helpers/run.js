'use strict'

/**
 * Builds a solution overview or step page out of the DOM stub, runs
 * src/js/28-solution-progress.js against it in a fresh vm context, and hands
 * back the pieces the tests assert on: the public API, the elements, every
 * fetch call, dispatched window events, history/location calls, storage, and
 * a flush() that drains promises and fake timers.
 */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { el, makeDocument } = require('./dom')

const SCRIPT = fs.readFileSync(path.join(__dirname, '../../../src/js/28-solution-progress.js'), 'utf8')

const STORE_KEY = 'docs-solutions-progress'
const HINT_KEY = 'docs-solutions-progress-hint'
const DIRTY_KEY = 'docs-solutions-progress-dirty'
const PENDING_KEY = 'docs-solutions-pending-intent'
const FILES = ['docker-compose.yml', 'services/leaderboard/main.go', 'scripts/verify-lib.sh']

function storage (initial, throws) {
  const data = Object.assign({}, initial || {})
  if (throws) {
    return {
      data,
      getItem () { throw new Error('SecurityError') },
      setItem () { throw new Error('SecurityError') },
      removeItem () { throw new Error('SecurityError') },
    }
  }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
  }
}

// Done step ids of a stored or sent v2 record (the wire shape has no
// completedSteps; getState() adds it as a derived view).
function doneIds (record) {
  const steps = (record && record.steps) || {}
  return Object.keys(steps).filter((id) => steps[id].done === true).sort()
}

function plain (value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function response (status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  }
}

function listingBlock (attrs, o) {
  o = o || {}
  const content = []
  const parts = []
  if (o.title) parts.push(el('div', { class: 'title', text: o.title }))
  if (o.toolbox !== false) {
    content.push(el('div', { class: 'source-toolbox' }, [
      el('span', { class: 'source-lang', text: 'go' }),
      el('button', { class: 'copy-button' }),
    ]))
  }
  content.push(el('pre', { class: 'highlight' }, [el('code', { 'data-lang': 'go', text: 'package main' })]))
  parts.push(el('div', { class: 'content' }, content))
  return el('div', Object.assign({ class: 'listingblock' }, attrs), parts)
}

// The article's code blocks: two the extension traced back to an
// include::example$ (one of them a tagged region, one of them with no toolbox
// yet), and one command block it left alone.
function buildBlocks (els) {
  els.fileBlock = listingBlock(
    { 'data-solution-file': 'services/leaderboard/main.go', 'data-solution-tag': 'consumer' },
    { title: 'services/leaderboard/main.go' })
  els.fileBlockPlain = listingBlock({ 'data-solution-file': 'docker-compose.yml' })
  els.fileBlockNoToolbox = listingBlock({ 'data-solution-file': 'services/leaderboard/go.mod' }, { toolbox: false })
  els.commandBlock = listingBlock({})
  return [els.fileBlock, els.fileBlockPlain, els.fileBlockNoToolbox, els.commandBlock]
}

function buildPage (o) {
  const stepIds = o.stepIds || ['s1', 's2', 's3']
  const stepUrl = (id) => '/solutions/' + o.solutionId + '/' + id + '/'
  const bodyAttrs = {
    class: 'article ' + (o.page === 'step' ? 'solution-step' : 'solution'),
    'data-component': 'solutions',
    'data-solution-id': o.solutionId,
    'data-solution-version': o.version,
    'data-solution-status': o.status || 'published',
    'data-solution-download': o.download || 'authenticated',
    'data-solution-step-count': String(stepIds.length),
  }
  if (o.title) bodyAttrs['data-solution-title'] = o.title
  if (o.draftDownloads) bodyAttrs['data-solution-draft-downloads'] = 'true'
  if (o.fileCount !== undefined) bodyAttrs['data-solution-file-count'] = String(o.fileCount)
  if (o.testedOn) bodyAttrs['data-solution-tested-on'] = o.testedOn
  // The download allowlist (record.files), which layouts/solution-step.hbs
  // writes to the body for the Files for this step links.
  if (o.files !== false) bodyAttrs['data-solution-files'] = JSON.stringify(o.files || FILES)
  if (o.page === 'step') {
    bodyAttrs['data-step-id'] = o.stepId
    bodyAttrs['data-step-index'] = String(stepIds.indexOf(o.stepId) + 1)
  }

  const els = {}
  els.account = el('div', { 'data-docs-account': '', hidden: o.accountHidden !== false ? '' : undefined })
  if (o.accountHidden === false) els.account.hidden = false

  // Sidebar entries (nav-tree-solution): the only source of step ids on a
  // step page. The rail card itself lists no steps.
  els.nav = el('ol', { 'data-sol-nav-steps': '' }, stepIds.map((id) =>
    el('li', { 'data-sol-nav-step': id, 'data-sol-nav-url': stepUrl(id) }, [
      el('span', { class: 'sol-nav-step-title', text: 'Title of ' + id }),
      el('span', { class: 'visually-hidden sol-nav-step-status', 'data-sol-nav-step-status': '' }),
    ])))
  els.count = el('span', { 'data-sol-progress-count': '', text: '0 of ' + stepIds.length })
  els.fill = el('div', { 'data-sol-progress-fill': '' })
  els.bar = el('div', { 'data-sol-progress-bar': '' }, [els.fill])
  els.state = el('p', { 'data-sol-progress-state': '', text: 'Not started' })
  els.versionNotice = el('div', { 'data-sol-version-notice': '', hidden: '' }, [
    el('button', { 'data-sol-version-dismiss': '' }),
  ])
  els.versionDismiss = els.versionNotice.children[0]
  els.saveLabel = el('span', { 'data-sol-save-label': '', text: 'Save progress' })
  // cardSave: the rail card's copy (data-sol-save-card), which steps aside
  // for the card's own gated-download sign-in line.
  const saveAttrs = { 'data-sol-save': '', 'data-intent': 'save' }
  if (o.cardSave) saveAttrs['data-sol-save-card'] = ''
  els.save = el('button', saveAttrs, [els.saveLabel])
  els.sync = el('span', { 'data-sol-sync-state': '' })
  els.done = el('div', { 'data-sol-done': '', hidden: '' })
  const cardParts = [els.count, els.bar, els.state, els.versionNotice]
  if (o.page === 'step') {
    els.completeLabel = el('span', { 'data-sol-complete-label': '', text: 'Mark step complete' })
    els.complete = el('button', { 'data-sol-complete': '' }, [els.completeLabel])
    cardParts.push(els.complete)
  }
  els.progress = el('section', { 'data-sol-progress': '' }, cardParts.concat([els.save, els.sync, els.done]))

  const downloadHref = '/solutions/download?solution=' + o.solutionId + '&version=' + o.version + '&return=/solutions/' + o.solutionId + '/'
  const downloadAttrs = { 'data-sol-download': '', href: downloadHref }
  if ((o.download || 'authenticated') === 'authenticated') downloadAttrs['data-requires-auth'] = ''
  // download: 'none' renders no CTA at all (solution-progress.hbs wraps it in
  // {{#unless (eq solution.download 'none')}}).
  if (o.download !== 'none') els.download = el('a', downloadAttrs)
  els.asset = el('p', { class: 'sol-download-asset' })
  els.gateText = el('span', { 'data-sol-gate-text': '', text: 'Sign in to save progress and download the complete example.' })
  els.signin = el('button', { 'data-sol-signin': '', 'data-intent': 'download' })
  els.gate = el('div', { 'data-sol-gate': '' }, [els.gateText, els.signin])
  // gate: false mirrors solution-code-download.hbs for a non-authenticated
  // download, which renders no gate.
  els.downloadPanel = el('section', { 'data-sol-download-panel': '' }, (els.download ? [els.download] : []).concat(o.gate === false ? [els.asset] : [els.asset, els.gate]))
  els.rail = el('details', { 'data-sol-rail': '', open: '' }, [els.progress, els.downloadPanel])

  const main = []
  if (o.page === 'step') {
    els.headerStatus = el('span', { 'data-sol-step-header-status': '', hidden: '' })
    main.push(els.headerStatus)
    // The step action row under the article (solution-step-actions.hbs): a
    // second Mark step complete button, a second bar, and the inline done
    // block. In the live DOM it comes BEFORE the rail card, so a
    // querySelector for the button finds this copy first.
    if (o.actionRow) {
      els.rowCompleteLabel = el('span', { 'data-sol-complete-label': '', text: 'Mark step complete' })
      // primaryToggle: the last step's copy (data-sol-complete-primary), which
      // is the primary action until the step is done.
      els.rowComplete = el('button', o.primaryToggle
        ? { 'data-sol-complete': '', 'data-sol-complete-primary': '', class: 'sol-btn sol-btn--primary' }
        : { 'data-sol-complete': '' }, [els.rowCompleteLabel])
      els.rowFill = el('div', { 'data-sol-progress-fill': '' })
      els.rowBar = el('div', { 'data-sol-progress-bar': '' }, [els.rowFill])
      els.rowDownloadLabel = el('span', { 'data-sol-download-label': '', text: 'Download the complete example' })
      els.rowDownload = el('a', { 'data-sol-download': '', 'data-requires-auth': '', href: '/solutions/download?solution=' + o.solutionId + '&version=' + o.version }, [els.rowDownloadLabel])
      els.rowDone = el('div', { 'data-sol-done': '', 'data-sol-done-inline': '', hidden: '' }, [els.rowDownload])
      // continueRow: a step with a next step renders Complete and continue
      // (a link to the next step) and the Next link instead of the toggle.
      els.rowQuizLabel = el('span', { 'data-sol-quiz-label': '', text: 'Quiz me on this step' })
      els.rowQuiz = el('button', Object.assign({ 'data-sol-quiz': '', 'data-quiz-title': 'Create the topics', hidden: '' },
        o.quizRule ? { 'data-quiz-rule': o.quizRule } : {},
        o.quizAdapt ? { 'data-quiz-adapt': o.quizAdapt } : {}), [els.rowQuizLabel])
      const rowMain = [els.rowBar, els.rowDone, els.rowComplete, els.rowQuiz]
      if (o.continueRow) {
        els.rowContinue = el('a', { 'data-sol-complete-continue': '', href: '/solutions/' + o.solutionId + '/next/' })
        els.rowNext = el('a', { 'data-sol-next': '', 'data-sol-next-title': 'Produce the events', class: 'sol-btn sol-step-nav', href: '/solutions/' + o.solutionId + '/next/' })
        rowMain.push(els.rowContinue, els.rowNext)
      }
      els.actionRow = el('nav', { class: 'sol-step-actions' }, rowMain)
      main.push(els.actionRow)
      // The step header chip is rendered once per page today; a second copy
      // must follow too.
      els.headerStatus2 = el('span', { 'data-sol-step-header-status': '', hidden: '' })
      main.push(els.headerStatus2)
    }
  } else {
    els.startLabel = el('span', { 'data-sol-start-label': '', text: 'Start building' })
    els.start = el('a', { 'data-sol-start': '', href: stepUrl(stepIds[0]) }, [els.startLabel])
    els.heroProgress = el('span', { 'data-sol-hero-progress': '', hidden: '' })
    // The overview's body Steps list (solution-steps.hbs) carries id + url
    // and its own ticks.
    els.stepList = el('ol', { 'data-sol-steps': '' }, stepIds.map((id) =>
      el('li', { 'data-sol-step-id': id, 'data-sol-step-url': stepUrl(id) }, [el('a', { href: stepUrl(id) }, [el('span', { 'data-sol-step-resume': '', hidden: '' }), el('span', { 'data-sol-step-status': '' })])])))
    // The closing copy at the end of the overview (solution-overview-next.hbs).
    els.endLabel = el('span', { 'data-sol-start-label': '', text: 'Start building' })
    els.endStart = el('a', { 'data-sol-start': '', href: stepUrl(stepIds[0]) }, [els.endLabel])
    els.endStep = el('span', { class: 'sol-overview-next-step', text: 'Step 1: Title of ' + stepIds[0] })
    els.endNav = el('nav', { class: 'sol-overview-next' }, [els.endStart, els.endStep])
    main.push(els.start, els.heroProgress, els.stepList, els.endNav)
  }
  if (o.blocks !== false) buildBlocks(els).forEach((b) => main.push(b))
  // An author's inline offer, [.solution-download]#...#, inside a sentence.
  if (o.inlineDownload) {
    els.inlineDownload = el('span', { class: 'solution-download', text: 'download the complete example' })
    els.inlineSentence = el('p', {}, [el('span', { text: 'The quickest way is to ' }), els.inlineDownload, el('span', { text: ', unzip it.' })])
    main.push(els.inlineSentence)
  }
  // == Files for this step, the article's own list (opt in): the path is the
  // first <code> of each bullet; one bullet is a generated file that the
  // download endpoint does not serve, one carries a suffix.
  if (o.page === 'step' && o.filesSection) {
    const item = (file, rest) => el('li', {}, [el('p', {}, [el('code', { text: file })].concat(rest ? [el('span', { text: rest })] : []))])
    els.stepFileItems = [item('docker-compose.yml'), item('services/go.sum', ': generated by go mod tidy.'), item('services/leaderboard/main.go', ': shown in full under Complete source.')]
    els.filesHeading = el('h2', { id: 'files-for-this-step', text: 'Files for this step' })
    els.filesSection = el('div', { class: 'sect1' }, [els.filesHeading, el('div', { class: 'sectionbody' }, [el('div', { class: 'ulist' }, [el('ul', {}, els.stepFileItems)])])])
    main.push(els.filesSection)
  }
  // A block the extension annotated from the step's own single source
  // (steps/<id>/commands.sh), which is not a file of the solution.
  if (o.stepsBlock) {
    els.stepsBlock = listingBlock({ 'data-solution-file': 'steps/create-topics/commands.sh', 'data-solution-tag': 'create' })
    main.push(els.stepsBlock)
  }

  // DOM order as on the real page: sidebar nav, then the article, then the rail.
  els.body = el('body', bodyAttrs, [els.account, els.nav].concat(main, [els.rail]))
  return { els, stepIds, stepUrl }
}

function run (options) {
  const o = Object.assign({
    page: 'step',
    solutionId: 'demo',
    stepId: 's1',
    version: 'v1.0.0',
    signedIn: false,
    search: '',
    now: 1700000000000,
    accountHidden: true,
  }, options || {})

  let els, stepIds, stepUrl
  if (o.page === 'none') {
    els = { body: el('body', {}) }
    stepIds = []
    stepUrl = null
  } else if (o.page === 'article') {
    // A normal docs page: same annotated blocks, no solution body attributes.
    els = {}
    const blocks = buildBlocks(els)
    els.body = el('body', { class: 'article', 'data-component': 'streaming' }, blocks)
    stepIds = []
    stepUrl = null
  } else {
    ;({ els, stepIds, stepUrl } = buildPage(o))
  }
  const document = makeDocument(els.body)
  document.cookie = o.signedIn ? 'rp_docs_auth=1' : ''
  // Every element the module creates (toasts). flush() also fires the toast's
  // own removal timer, so the tests look here rather than at the body.
  const created = []
  const createElement = document.createElement
  document.createElement = (tag) => { const node = createElement(tag); created.push(node); return node }

  const local = o.sharedLocal || storage(Object.assign(
    o.localStore ? { [STORE_KEY]: JSON.stringify(o.localStore) } : {},
    o.hint !== undefined ? { [HINT_KEY]: o.hint } : {},
    o.dirty ? { [DIRTY_KEY]: '1' } : {},
    o.localRaw || {}
  ), o.storageThrows)
  const session = o.sharedSession || storage(Object.assign(
    o.pending ? { [PENDING_KEY]: JSON.stringify(o.pending) } : {},
    o.sessionRaw || {}
  ), o.storageThrows)

  const calls = { fetch: [], events: [], replaceState: [], assign: [], heap: [], chatQueries: [], openPanel: 0, quizSource: [] }
  const clock = { now: o.now }
  class FakeDate extends Date {
    static now () { return clock.now }
  }
  const timers = []
  let timerId = 0

  const defaultRoutes = (url, init) => {
    const method = (init && init.method) || 'GET'
    if (url === '/solutions/progress' && method === 'GET') return response(200, o.remote || { v: 1, updatedAt: 0, solutions: {} })
    if (url === '/solutions/progress' && method === 'PUT') {
      const sent = JSON.parse(init.body)
      return response(200, o.putResponse ? o.putResponse(sent) : sent)
    }
    if (url === '/docs-activity') return response(204)
    return response(404)
  }

  const context = {
    console,
    document,
    localStorage: local,
    sessionStorage: session,
    Date: FakeDate,
    setTimeout: (fn, ms) => { timers.push({ id: ++timerId, fn, ms }); return timerId },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i !== -1) timers.splice(i, 1) },
    URLSearchParams,
    encodeURIComponent,
    CustomEvent: class CustomEvent { constructor (type, init) { this.type = type; this.detail = init && init.detail } },
    fetch: (url, init) => {
      calls.fetch.push({ url, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null, init })
      const handler = o.fetch || defaultRoutes
      const result = handler(url, init, defaultRoutes)
      if (result === 'network-error') return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(result)
    },
    window: {
      isUiPreview: o.isUiPreview === true,
      __KAPA_LOGIN_URL: o.kapaLoginUrl,
      location: {
        pathname: o.pathname || (o.page === 'step' ? stepUrl(o.stepId) : '/solutions/' + o.solutionId + '/'),
        search: o.search,
        hash: '',
        assign: (url) => calls.assign.push(url),
      },
      history: { replaceState: (state, title, url) => calls.replaceState.push(url) },
      addEventListener: (type, fn) => { (context.window.listeners[type] = context.window.listeners[type] || []).push(fn) },
      dispatchEvent: (e) => { calls.events.push(e); return true },
      listeners: {},
      matchMedia: () => ({ matches: !!o.mobile, addEventListener () {}, addListener () {} }),
      heap: o.heap === false ? undefined : { track: (name, props) => calls.heap.push(plain({ name, props })) },
      dataLayer: [],
      KAPA_QUIZ_INTEGRATION_ID: o.quizIntegration === false ? undefined : 'quiz-integration',
      submitChatQuery: () => {},
      openChatWithQuery: (query, autoSubmit, opts) => calls.chatQueries.push(Object.assign({ query, autoSubmit }, opts && o.chatOpts ? { opts } : {})),
      openChatPanel: () => { calls.openPanel++ },
      // 27-solution-quiz-source.js, which reads the rendered step. The DOM
      // stub cannot run it, so a test hands in what it returns; tests/solution-quiz
      // runs the real one over rendered pages.
      __solutionQuiz: o.quizSource
        ? { quizSource: (doc, button, loc) => { calls.quizSource.push({ title: button.getAttribute('data-quiz-title'), pathname: loc.pathname }); return o.quizSource() } }
        : undefined,
    },
  }
  context.window.window = context.window
  // Chrome with site data blocked: merely reading the global throws.
  if (o.storageGetterThrows) {
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(context, name, { get () { throw new Error('SecurityError: The operation is insecure.') }, configurable: true })
    }
  }

  vm.runInNewContext(SCRIPT, context)

  // Objects created inside the vm have that context's Array/Object prototypes,
  // which assert.deepStrictEqual rejects as "not reference-equal". Hand the
  // tests plain clones of everything data-shaped that crosses the boundary.
  const api = {}
  Object.keys(context.window.docsSolutions).forEach((key) => {
    const fn = context.window.docsSolutions[key]
    api[key] = (...args) => {
      const result = fn(...args)
      if (result && typeof result.then === 'function') return result
      return result === undefined ? undefined : plain(result)
    }
  })

  async function flush () {
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setImmediate(resolve))
      const due = timers.splice(0, timers.length)
      due.forEach((t) => t.fn())
    }
  }

  return {
    api,
    els,
    dataLayer: () => plain(context.window.dataLayer),
    stepIds,
    calls,
    clock,
    local,
    session,
    window: context.window,
    document,
    timers,
    flush,
    // Fire a window event at the listeners the module registered.
    fire: (type, event) => (context.window.listeners[type] || []).forEach((fn) => fn(Object.assign({ type }, event || {}))),
    storedStore: () => (STORE_KEY in local.data ? JSON.parse(local.data[STORE_KEY]) : null),
    toasts: () => created.filter((c) => c.classes.has('sol-toast')),
    signinEvents: () => calls.events.filter((e) => e.type === 'docs-account:open-signin'),
    quizEvents: () => calls.events.filter((e) => e.type === 'docs-chat:quiz').map((e) => plain(e.detail)),
    chatQueries: () => plain(calls.chatQueries),
    win: () => context.window,
    controls: () => els.body.querySelectorAll('[data-sol-file-download]'),
    fileLink: (file) => els.body.querySelector('[data-sol-file-link="' + file + '"]'),
    stepFileLink: (file) => (els.filesSection ? els.filesSection.querySelector('[data-sol-file-link="' + file + '"]') : null),
    control: (file) => els.body.querySelector('[data-sol-file-download="' + file + '"]'),
    downloads: () => calls.heap.filter((e) => e.name === 'solution_download'),
    puts: () => calls.fetch.filter((c) => c.url === '/solutions/progress' && c.method === 'PUT'),
    gets: () => calls.fetch.filter((c) => c.url === '/solutions/progress' && c.method === 'GET'),
  }
}

module.exports = { run, plain, doneIds, STORE_KEY, HINT_KEY, DIRTY_KEY, PENDING_KEY, FILES }

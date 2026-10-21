'use strict'
/**
 * Chat modes (src/js/react/chatModes.js): the table that turns the Ask AI
 * drawer into a quiz, and the 19-chat-panel.js plumbing that starts and ends a
 * mode. Run against the real sources: chatModes.js and agentTools.js through
 * the esbuild the bundle uses, CUSTOM_INSTRUCTIONS read out of AskAI.jsx, and
 * 19-chat-panel.js in a vm with a stub DOM and fake timers.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Module = require('node:module')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// The React sources are ES modules in a package without "type": "module", so
// require() of them throws on the Node versions CI runs. Transform to CommonJS
// with the same esbuild the bundle uses (see tests/kapa-source-groups).
function loadEsm (relPath) {
  const filename = path.join(ROOT, relPath)
  const { code } = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { format: 'cjs', loader: 'js' })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(code, filename)
  return mod.exports
}

const modes = loadEsm('src/js/react/chatModes.js')
const TOOL_NAMES = loadEsm('src/js/react/agentTools.js').agentTools.map((t) => t.name)

const ASKAI = read('src/js/react/AskAI.jsx')
const CHAT = read('src/js/react/components/ChatInterface.jsx')
const CUSTOM_INSTRUCTIONS = /const CUSTOM_INSTRUCTIONS = `([\s\S]*?)`/.exec(ASKAI)[1]

function storage (initial) {
  const data = Object.assign({}, initial)
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
  }
}

// ——— The mode table ————————————————————————————————————————————————————————

test('quiz runs on its own integration, with no tools and no history', () => {
  const cfg = modes.resolveMode({ mode: 'quiz', nonce: 1, title: 'T' }, { KAPA_QUIZ_INTEGRATION_ID: 'quiz-id' }, ['page-grp'])
  assert.equal(cfg.integrationId, 'quiz-id')
  assert.deepEqual(cfg.tools, [])
  assert.equal(cfg.enableHistory, false)
  assert.equal(cfg.persistThread, false)
  assert.equal(cfg.showSources, false)
  assert.equal(cfg.detail.title, 'T')
})

test('an empty or missing integration id switches the mode off', () => {
  assert.equal(modes.resolveMode({ mode: 'quiz' }, { KAPA_QUIZ_INTEGRATION_ID: '' }, []), null)
  assert.equal(modes.resolveMode({ mode: 'quiz' }, {}, []), null)
  assert.equal(modes.resolveMode({ mode: 'nope' }, { KAPA_QUIZ_INTEGRATION_ID: 'x' }, []), null)
})

test('quiz source groups: its own when set, otherwise the page scope, never unfiltered by default', () => {
  const w = { KAPA_QUIZ_INTEGRATION_ID: 'q' }
  assert.deepEqual(modes.resolveMode({ mode: 'quiz' }, w, ['page-grp']).sourceGroupIds, ['page-grp'])
  assert.deepEqual(modes.resolveMode({ mode: 'quiz' }, { ...w, KAPA_QUIZ_SOURCE_GROUP_IDS: ['quiz-grp', ''] }, ['page-grp']).sourceGroupIds, ['quiz-grp'])
})

test('the pilot detail without a mode field reads as a quiz', () => {
  assert.equal(modes.readMode({ __docsChatQuiz: { title: 'T', nonce: 3 } }).mode, 'quiz')
  assert.equal(modes.readMode({ __docsChatMode: { mode: 'quiz', nonce: 4 } }).nonce, 4)
  assert.equal(modes.readMode({}), null)
})

test('quiz keeps only the domain and style blocks, with no tool it cannot call', () => {
  const quiz = modes.MODES.quiz
  const base = modes.buildBaseInstructions(CUSTOM_INSTRUCTIONS, quiz.baseBlocks, quiz.tools, TOOL_NAMES)
  assert.match(base, /^## Domain context/)
  assert.match(base, /## Writing style/)
  for (const gone of ['## Clarifying', '## Tool strategy', '## Do not', '## Citing sources', '## Offering choices']) {
    assert.ok(!base.includes(gone), `${gone} must not reach the quiz`)
  }
  for (const name of TOOL_NAMES) assert.ok(!base.includes(name), `${name} named in the quiz prompt`)
  // The domain bullets that do not name a tool survive whole, sub-bullets too.
  assert.match(base, /Redpanda Cloud: managed\. Cluster types BYOC, Dedicated, or Serverless\./)
  assert.match(base, /No em dashes\./)

  // Negative control: the same block with the tool passed keeps the bullet, so
  // the assertion above is about the filter, not about the source text.
  const withTool = modes.buildBaseInstructions(CUSTOM_INSTRUCTIONS, quiz.baseBlocks, ['run_bloblang'], TOOL_NAMES)
  assert.match(withTool, /The run_bloblang tool runs a\s+mapping/)
})

test('the quiz prompt carries the step source and asks for the control lines the UI reads', () => {
  const source = '## STEP SOURCE\nStep 1 of 3: Create the topics\n<<<STEP SOURCE BEGIN>>>\nKey by player.\n<<<STEP SOURCE END>>>'
  const text = modes.MODES.quiz.instructions({ title: 'Create the topics', solution: 'demo', url: '/solutions/demo/s1/', rule: 'Key by player.', source })
  assert.ok(text.endsWith('\n\n' + source), 'the source block closes the prompt')
  assert.equal(text.split('## STEP SOURCE').length, 2, 'one STEP SOURCE block')
  assert.match(text, /OPTIONS: A \| B \| C \| D/)
  assert.match(text, /OPTIONS: New questions \| Ask about this step\n {2}QUIZ_RESULT: N\/3/)
  assert.match(text, /Question N of 3/)
  assert.match(text, /It is not in your knowledge base, so do not search for it\./)
  assert.doesNotMatch(text, /Search the knowledge base for the step's page first/, 'the pilot told the model to search')
  assert.doesNotMatch(text, /—/, 'no em dashes')
})

test('without a source the quiz falls back to the title, rule and adapt line', () => {
  const text = modes.MODES.quiz.instructions({ title: 'Create the topics', solution: 'demo', url: '/solutions/demo/s1/', rule: 'Key by player.', adapt: 'Find the key.' })
  assert.match(text, /## STEP SOURCE\nStep: Create the topics\nSolution: demo\nPage: \/solutions\/demo\/s1\/\nRule this step establishes: Key by player\.\nWhat to change when you adapt it: Find the key\./)
  assert.match(text, /could not be read from the page/)
  assert.doesNotMatch(text, /<<<STEP SOURCE BEGIN>>>/)
})

test('the quiz opener names the step and its ids, and stays a mode thread', () => {
  const opener = modes.MODES.quiz.firstMessage({ title: 'Create the topics', solution: 'demo', step: 's1' })
  assert.equal(opener, 'Quiz me on this step: Create the topics (demo/s1).')
  assert.equal(modes.isModeThread(opener), true)
  // The page builds the same opener (28-solution-progress.js startQuiz).
  assert.match(read('src/js/28-solution-progress.js'), /'Quiz me on this step' \+ \(title \? ': ' \+ title : ''\) \+ ' \(' \+ solutionId \+ '\/' \+ stepId \+ '\)\.'/)
})

test('ChatInterface tells the page when the quiz reports its score', () => {
  assert.equal(modes.MODE_COMPLETE_EVENT, 'docs-chat:mode-complete')
  assert.match(CHAT, /dispatchEvent\(new CustomEvent\(MODE_COMPLETE_EVENT/)
  assert.match(read('src/js/28-solution-progress.js'), /addEventListener\('docs-chat:mode-complete'/)
})

// ——— Control lines ———————————————————————————————————————————————————————

const FINAL = 'You got 2 of 3.\n- Reread [Verify](u#verify).\n\nOPTIONS: New questions | Ask about this step\nQUIZ_RESULT: 2/3'
const QUIZ = { controls: modes.MODES.quiz.controls }

test('splitModeControls strips QUIZ_RESULT, then OPTIONS', () => {
  const out = modes.splitModeControls(FINAL, QUIZ)
  assert.equal(out.md, 'You got 2 of 3.\n- Reread [Verify](u#verify).')
  assert.deepEqual(out.options, ['New questions', 'Ask about this step'])
  assert.deepEqual(out.result, { score: 2, total: 3 })
})

test('a partial trailing control line is hidden while streaming', () => {
  for (const cut of ['O', 'OPTI', 'OPTIONS', 'OPTIONS:']) {
    const out = modes.splitModeControls('**Question 1 of 3**\nWhy?\n' + cut, { ...QUIZ, streaming: true })
    assert.equal(out.md, '**Question 1 of 3**\nWhy?', cut)
  }
  for (const cut of ['QUIZ', 'QUIZ_RES', 'QUIZ_RESULT:']) {
    const out = modes.splitModeControls('You got 3 of 3.\nOPTIONS: New questions | Ask about this step\n' + cut, { ...QUIZ, streaming: true })
    assert.equal(out.md, 'You got 3 of 3.', cut)
    assert.deepEqual(out.options, ['New questions', 'Ask about this step'])
  }
  // An options line with one option so far is still arriving.
  assert.equal(modes.splitModeControls('Pick one.\nOPTIONS: A', { ...QUIZ, streaming: true }).md, 'Pick one.')
})

test('finished prose that merely looks like a control line stays', () => {
  // Not streaming: a single "option" is prose, and a partial word is a word.
  assert.equal(modes.splitModeControls('Pick one.\nOPTIONS: A', QUIZ).md, 'Pick one.\nOPTIONS: A')
  assert.equal(modes.splitModeControls('A line\nOPTI', QUIZ).md, 'A line\nOPTI')
  // Plain Ask AI does not know QUIZ_RESULT, so it neither strips nor hides it.
  assert.equal(modes.splitModeControls('x\nQUIZ_RESULT: 1/3').md, 'x\nQUIZ_RESULT: 1/3')
  assert.equal(modes.splitModeControls('x\nQUIZ', { streaming: true }).md, 'x\nQUIZ')
})

test('plain Ask AI options parse exactly as before', () => {
  const out = modes.splitModeControls('Which product?\nOPTIONS: Redpanda Cloud | Self-Managed | Agentic Data Plane (ADP)')
  assert.deepEqual(out.options, ['Redpanda Cloud', 'Self-Managed', 'Agentic Data Plane (ADP)'])
  assert.equal(out.md, 'Which product?')
  assert.equal(out.result, null)
})

// ——— Quiz progress ———————————————————————————————————————————————————————

const msg = (role, content) => ({ role, content, blocks: [{ type: 'text', content }] })

test('quizProgress counts questions, answers and Correct. grades', () => {
  const messages = [
    msg('user', 'Quiz me on this step: Create the topics.'),
    msg('assistant', '**Question 1 of 3**\nWhy?'),
    msg('user', 'B'),
    msg('assistant', 'Correct. Because.\n\n**Question 2 of 3**\nWhat?'),
    msg('user', 'not sure'),
    msg('assistant', 'Partly correct. Half.\n\n**Question 3 of 3**\nHow?'),
    msg('user', 'like this'),
    msg('assistant', 'Correct. Yes.\n\nYou got 2 of 3.\nOPTIONS: New questions | Ask about this step\nQUIZ_RESULT: 2/3'),
  ]
  const p = modes.quizProgress(messages)
  assert.equal(p.questionsSeen, 3)
  assert.equal(p.answers, 3)
  assert.equal(p.tally, 2)
  assert.deepEqual(p.result, { score: 2, total: 3 })

  // "New questions" starts a fresh run in the same thread.
  const again = modes.quizProgress(messages.concat([msg('user', 'New questions'), msg('assistant', '**Question 1 of 3**\nNew?')]))
  assert.equal(again.questionsSeen, 1)
  assert.equal(again.tally, 0)
  assert.equal(again.result, null)
})

// ——— History and resume pointer ———————————————————————————————————————————

test('the history filter hides every mode thread and nothing else', () => {
  assert.equal(modes.isModeThread('Quiz me on this step: Create the topics.'), true)
  assert.equal(modes.isModeThread('Quiz me on this step.'), true)
  assert.equal(modes.isModeThread('How do I create a topic?'), false)
  assert.equal(modes.isModeThread(null), false)
  // Self-maintaining: whatever opener a mode sends, its thread is filtered.
  for (const [name, def] of Object.entries(modes.MODES)) {
    assert.equal(modes.isModeThread(def.firstMessage({ title: 'A title' })), true, name)
  }
})

test('a quiz leaves the reader\'s Ask AI resume pointer alone', () => {
  const s = storage({ [modes.ACTIVE_THREAD_KEY]: 'X' })
  const quiz = modes.MODES.quiz
  // The quiz interface mounts: nothing to resume, and its thread is not stored.
  assert.equal(modes.threadToResume(s, quiz.persistThread), null)
  modes.rememberThread(s, 'quiz-thread', quiz.persistThread)
  modes.forgetThread(s, quiz.persistThread)
  assert.equal(s.data[modes.ACTIVE_THREAD_KEY], 'X')
  // Back to Ask AI: the plain interface resumes X.
  assert.equal(modes.threadToResume(s, true), 'X')
  // Negative control: plain Ask AI does write its own thread.
  modes.rememberThread(s, 'Y', true)
  assert.equal(s.data[modes.ACTIVE_THREAD_KEY], 'Y')
})

test('ChatInterface reaches the resume pointer only through the mode-aware helpers', () => {
  // A direct write bypasses persistThread, which is the pilot bug.
  assert.doesNotMatch(CHAT, /sessionStorage\.setItem\(ACTIVE_THREAD_KEY/)
  assert.match(CHAT, /rememberThread\(sessionStorage, threadId, persistThread\)/)
  assert.match(CHAT, /threadToResume\(sessionStorage, persistThread\)/)
})

// ——— Analytics ———————————————————————————————————————————————————————————

test('Ask AI answer events are not sent in a mode', () => {
  const start = ASKAI.indexOf('function handleAgentEvent')
  const body = ASKAI.slice(start, ASKAI.indexOf('\n}', start) + 2)
  const sent = []
  const fn = new Function('safeHeap', 'isScopeRejection', 'dropScope', body + '\nreturn handleAgentEvent')( // eslint-disable-line no-new-func
    (name) => sent.push(name), () => false, () => {})
  const done = { type: 'response_completed', data: { threadId: 't', toolCallCount: 0 } }
  fn(done, true)
  assert.deepEqual(sent, [])
  fn(done, false)
  assert.deepEqual(sent, ['answer_generated_docs_home'])
})

test('ChatInterface sends the Ask AI question event only outside a mode', () => {
  const doQuery = CHAT.slice(CHAT.indexOf('const doQuery'), CHAT.indexOf('sendMessage(q)'))
  assert.match(doQuery, /if \(!modeDef\) \{\s*safeHeap\('ask_question_docs_home'/)
  assert.doesNotMatch(doQuery, /question: q[\s\S]*modeDef\.events\.answer[\s\S]*question: q/, 'never the answer text')
})

// ——— Kill switch ——————————————————————————————————————————————————————————

test('both chat-panel partials default the mode ids only when the global is absent', () => {
  for (const rel of ['src/partials/chat-panel.hbs', 'src/partials/chat-panel-bump.hbs']) {
    const lines = read(rel).split('\n').filter((l) => /in window\)\) window\.KAPA_(QUIZ|PRODUCTIONIZE)_INTEGRATION_ID/.test(l))
    assert.equal(lines.length, 2, rel)
    const run = (win) => { vm.runInNewContext(lines.join('\n'), { window: win }); return win }
    const fresh = run({})
    assert.equal(fresh.KAPA_QUIZ_INTEGRATION_ID, '1a84301f-cfa3-4de6-9155-8eba9e11d13c')
    assert.equal(fresh.KAPA_PRODUCTIONIZE_INTEGRATION_ID, '8c41c92e-b589-40c7-9512-418e7428a84a')
    const off = run({ KAPA_QUIZ_INTEGRATION_ID: '', KAPA_PRODUCTIONIZE_INTEGRATION_ID: '' })
    assert.equal(off.KAPA_QUIZ_INTEGRATION_ID, '', `${rel}: '' must switch the quiz off`)
    assert.equal(off.KAPA_PRODUCTIONIZE_INTEGRATION_ID, '')
  }
})

// ——— 19-chat-panel.js ————————————————————————————————————————————————————

// The panel script in a vm: a stub panel, a window whose events reach real
// listeners, and interval timers that only run on tick().
function runPanel () {
  const listeners = {}
  const events = []
  const sent = []
  const focused = []
  let timers = []
  const node = (name, extra) => Object.assign({ name, focus () { focused.push(name) } }, extra)
  const input = node('input', { disabled: false })
  const close = node('close')
  const panel = {
    classList: { add () {}, remove () {}, toggle: () => false, contains: () => false },
    setAttribute () {},
    getAttribute: () => null,
    querySelectorAll: () => [],
    querySelector: (sel) => (sel === '#chat-message' ? (panel.hasInput ? input : null) : sel.includes('close') ? close : null),
    dataset: {},
    inert: false,
    hasInput: true,
  }
  const win = {
    innerWidth: 1400,
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn) },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn) },
    dispatchEvent: (e) => { events.push(e); (listeners[e.type] || []).slice().forEach((fn) => fn(e)); return true },
    CustomEvent: class { constructor (type, init) { this.type = type; this.detail = init && init.detail } },
  }
  const context = {
    window: win,
    localStorage: storage(),
    document: {
      cookie: 'rp_docs_auth=1',
      querySelector: (sel) => (String(sel).includes('data-chat-panel') ? panel : null),
      querySelectorAll: () => [],
      addEventListener () {},
    },
    setInterval: (fn) => { const t = { fn }; timers.push(t); return t },
    clearInterval: (t) => { timers = timers.filter((x) => x !== t) },
  }
  vm.runInNewContext(read('src/js/19-chat-panel.js'), context)
  const register = (nonce) => {
    win.submitChatQuery = (query, auto) => sent.push({ query, auto, nonce })
    win.submitChatQuery.modeNonce = nonce
  }
  const tick = (n = 1) => { for (let i = 0; i < n; i++) timers.slice().forEach((t) => t.fn()) }
  const startQuiz = (nonce) => {
    win.__docsChatMode = { mode: 'quiz', nonce }
    return win.openChatWithQuery('Quiz me on this step: T.', true, { mode: 'quiz', nonce })
  }
  return { win, events, sent, focused, panel, register, tick, startQuiz, pending: () => timers.length }
}

test('a quiz opener waits for the quiz interface, not the Ask AI one being replaced', () => {
  const p = runPanel()
  p.register(undefined) // the outgoing Ask AI interface
  p.startQuiz(1)
  p.tick(3)
  assert.deepEqual(p.sent, [])
  p.register(1)
  p.tick()
  assert.deepEqual(p.sent, [{ query: 'Quiz me on this step: T.', auto: true, nonce: 1 }])
  assert.equal(p.pending(), 0)
})

test('a pending query with a stale nonce is dropped', () => {
  const p = runPanel()
  p.startQuiz(1)
  // Restart before any interface took the first opener.
  p.startQuiz(2)
  p.register(1)
  p.tick()
  p.register(2)
  p.tick()
  assert.deepEqual(p.sent.map((s) => s.nonce), [2], 'only the current start is sent')
  assert.equal(p.pending(), 0)
})

test('ending the mode cancels its pending opener', () => {
  const p = runPanel()
  p.startQuiz(1)
  p.win.endChatMode('ask_instead')
  assert.equal(p.pending(), 0)
  p.register(1)
  p.tick()
  assert.deepEqual(p.sent, [])
  const end = p.events.find((e) => e.type === 'docs-chat:mode-end')
  assert.deepEqual(JSON.parse(JSON.stringify(end.detail)), { reason: 'ask_instead', mode: 'quiz' })
  assert.equal(p.win.__docsChatMode, null)
})

test('the cancel handle drops the query', () => {
  const p = runPanel()
  const handle = p.win.openChatWithQuery('hello', true)
  handle.cancel()
  p.register(undefined)
  p.tick()
  assert.deepEqual(p.sent, [])
})

test('Ask AI from elsewhere ends a running quiz and goes to Ask AI', () => {
  const p = runPanel()
  p.startQuiz(1)
  p.register(1)
  p.tick()
  p.win.openChatWithQuery('Explain this code', true) // code-block Ask AI
  const end = p.events.filter((e) => e.type === 'docs-chat:mode-end')
  assert.equal(end.length, 1)
  assert.equal(end[0].detail.reason, 'other_entry')
  p.tick()
  assert.equal(p.sent.length, 1, 'not sent to the quiz interface')
  p.register(undefined)
  p.tick()
  assert.deepEqual(p.sent.map((s) => s.query), ['Quiz me on this step: T.', 'Explain this code'])
})

test('plain Ask AI queries still go through with no mode at all', () => {
  const p = runPanel()
  p.register(undefined)
  p.win.openChatWithQuery('hello', false)
  p.tick()
  assert.deepEqual(p.sent, [{ query: 'hello', auto: false, nonce: undefined }])
  assert.equal(p.events.filter((e) => e.type === 'docs-chat:mode-end').length, 0)
})

test('opening in a mode focuses the message box; plain Ask AI focuses Close', () => {
  const p = runPanel()
  p.win.openChatPanel()
  assert.deepEqual(p.focused, ['close'])
  p.startQuiz(1)
  assert.deepEqual(p.focused, ['close', 'input'])
  // Before React mounts there is no box yet, so Close it is.
  p.panel.hasInput = false
  p.win.openChatPanel()
  assert.deepEqual(p.focused, ['close', 'input', 'close'])
})

// ——— Other Ask AI entry points ——————————————————————————————————————————

test('"Ask AI about this topic" goes through openChatWithQuery, unsent', () => {
  const src = read('src/js/14-markdown-dropdown.js')
  const body = src.slice(src.indexOf('function handleAskAI'), src.indexOf('function handleAddMCP'))
  assert.doesNotMatch(body, /#chat-panel-input/, 'that element does not exist in the drawer')
  assert.match(body, /window\.openChatWithQuery\([^)]*, false\)/)
})

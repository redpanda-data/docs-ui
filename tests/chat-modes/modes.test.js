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

let parseHTML = null
try { ({ parseHTML } = require('linkedom')) } catch { /* the markup test is skipped */ }

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
const tools = loadEsm('src/js/react/agentTools.js')
const TOOL_NAMES = tools.agentTools.map((t) => t.name)
const MODE_TOOL_NAMES = tools.modeTools.map((t) => t.name)

const ASKAI = read('src/js/react/AskAI.jsx')
const CHAT = read('src/js/react/components/ChatInterface.jsx')
const CUSTOM_INSTRUCTIONS = /const CUSTOM_INSTRUCTIONS = `([\s\S]*?)`/.exec(ASKAI)[1]
// Plain Ask AI's settings as App hands them to agentProps.
const ASK = {
  integrationId: 'ask-id',
  tools: tools.agentTools,
  instructions: CUSTOM_INSTRUCTIONS,
  pageContext: '\n\n## Current page\n- PAGE',
  scopeIds: ['page-grp'],
  modeTools: tools.modeTools,
  knownTools: MODE_TOOL_NAMES,
}

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

test('stripScoreLine drops the model score line the summary card repeats', () => {
  assert.equal(modes.stripScoreLine('You got 2 of 3.\n- Reread [Verify](u#verify).'), '- Reread [Verify](u#verify).')
  assert.equal(modes.stripScoreLine('Correct. Yes.\n\n**You got 3 of 3.**'), 'Correct. Yes.\n\n')
  assert.equal(modes.stripScoreLine('Correct. You got the idea.'), 'Correct. You got the idea.')
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

// ——— Productionize ———————————————————————————————————————————————————————

test('productionize runs on its own integration, with the planner tools and no history', () => {
  const w = { KAPA_PRODUCTIONIZE_INTEGRATION_ID: 'prod-id', KAPA_QUIZ_INTEGRATION_ID: 'quiz-id' }
  const cfg = modes.resolveMode({ mode: 'productionize', nonce: 1, title: 'T' }, w, ['page-grp'])
  assert.equal(cfg.integrationId, 'prod-id')
  assert.equal(cfg.enableHistory, false)
  assert.equal(cfg.persistThread, false)
  assert.equal(cfg.showSources, true)
  assert.deepEqual(cfg.sourceGroupIds, ['page-grp'])
  assert.deepEqual(modes.resolveMode({ mode: 'productionize' }, { ...w, KAPA_PRODUCTIONIZE_SOURCE_GROUP_IDS: ['p'] }, ['page-grp']).sourceGroupIds, ['p'])
  assert.equal(modes.resolveMode({ mode: 'productionize' }, { ...w, KAPA_PRODUCTIONIZE_INTEGRATION_ID: '' }, []), null)
})

test('productionize passes exactly the tools agentTools lists for it', () => {
  const names = modes.MODES.productionize.tools
  assert.deepEqual(tools.productionizeTools.map((t) => t.name), names)
  for (const name of names) assert.ok(MODE_TOOL_NAMES.includes(name), name)
  // The guide tool is the mode's own: plain Ask AI never gets it.
  assert.ok(!TOOL_NAMES.includes('get_solution_guide'))
  for (const gone of ['navigate_to_page', 'switch_product', 'open_bloblang_playground', 'submit_docs_feedback']) {
    assert.ok(!names.includes(gone), gone)
  }
})

test('productionize keeps the citing, choices and tool blocks, minus tools it does not pass', () => {
  const def = modes.MODES.productionize
  const base = modes.buildBaseInstructions(CUSTOM_INSTRUCTIONS, def.baseBlocks, def.tools, MODE_TOOL_NAMES, def.dropBullets)
  for (const kept of ['## Domain context', '## Offering choices', '## Citing sources', '## Writing style', '## Tool strategy', '## Do not']) {
    assert.ok(base.includes(kept), kept)
  }
  // It asks up to three questions of its own; the one-question block and its
  // pointer at a Current page block the mode does not send stay out.
  assert.ok(!base.includes('## Clarifying'))
  assert.ok(!base.includes('Current page'))
  // Nor do the bullets elsewhere that point back at that block.
  assert.doesNotMatch(base.replace(/\s+/g, ' '), /clarifying question/)
  assert.match(base, /Do not cite multiple product variants of the same page\./, 'the rest of Do not stays')
  // Negative control: without dropBullets those bullets are there.
  const kept = modes.buildBaseInstructions(CUSTOM_INSTRUCTIONS, def.baseBlocks, def.tools, MODE_TOOL_NAMES)
  assert.match(kept.replace(/\s+/g, ' '), /Do not reason your way out of the clarifying question/)
  assert.ok(!base.includes('submit_docs_feedback'), 'feedback tool line dropped')
  assert.match(base, /ALWAYS verify a mapping with run_bloblang/, 'run_bloblang is passed, so its line stays')
  const prompt = def.instructions({ title: 'T', guide: { sections: [{ section: 'Security', text: 'x' }], topics: ['Security'], steps: 0, rules: '1. R' } })
  assert.match(prompt, /^\n\n## Productionize mode\n/)
  assert.match(prompt, /- Production gaps topics: Security/)
})

test('the guide reaches get_solution_guide through the provider context, not the prompt', () => {
  const guide = { sections: [{ section: 'Rollback', guide_url: 'u', text: 'SECRET GAP TEXT' }], topics: ['Rollback'], steps: 0, rules: '' }
  const def = modes.MODES.productionize
  assert.equal(def.toolContext({ guide }).solutionGuide, guide)
  assert.ok(!def.instructions({ guide }).includes('SECRET GAP TEXT'))
  const cfg = modes.resolveMode({ mode: 'productionize', guide }, { KAPA_PRODUCTIONIZE_INTEGRATION_ID: 'p' }, [])
  assert.equal(modes.agentProps(cfg, ASK).context.solutionGuide, guide)
  assert.match(ASKAI, /\{\.\.\.\(props\.context \? \{ context: props\.context \} : \{\}\)\}/)
  // Without a guide the prompt says so, rather than promising a tool result.
  assert.match(modes.productionizeContext({ title: 'T' }), /could not be loaded/)
})

test('only the quiz reports quiz progress', () => {
  assert.match(CHAT, /modeDef && modeDef\.events\.question \? quizProgress\(messages\) : null/)
  assert.ok(!modes.MODES.productionize.events.question)
  assert.ok(modes.MODES.quiz.events.question)
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

for (const name of ['quiz', 'productionize']) {
  test(`a ${name} run leaves the reader's Ask AI resume pointer alone`, () => {
    const s = storage({ [modes.ACTIVE_THREAD_KEY]: 'X' })
    const def = modes.MODES[name]
    assert.equal(modes.threadToResume(s, def.persistThread), null)
    modes.rememberThread(s, name + '-thread', def.persistThread)
    modes.forgetThread(s, def.persistThread)
    assert.equal(s.data[modes.ACTIVE_THREAD_KEY], 'X')
  })
}

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
function runPanel (opts = {}) {
  const listeners = {}
  const events = []
  const sent = []
  const focused = []
  let timers = []
  const node = (name, extra) => Object.assign({ name, focus () { focused.push(name) } }, extra)
  const input = node('input', { disabled: false })
  const close = node('close')
  const classes = new Set(opts.classes || [])
  const expand = { handlers: [], addEventListener (t, fn) { if (t === 'click') this.handlers.push(fn) }, click () { this.handlers.forEach((fn) => fn()) } }
  const status = { textContent: 'Ask about any doc' }
  const panel = {
    classes,
    expand,
    status,
    classList: {
      add: (c) => { classes.add(c) },
      remove: (c) => { classes.delete(c) },
      toggle: (c) => { if (classes.has(c)) { classes.delete(c); return false } classes.add(c); return true },
      contains: (c) => classes.has(c),
    },
    setAttribute () {},
    getAttribute: () => null,
    querySelectorAll: (sel) => (String(sel).includes('data-chat-action="expand"') ? [expand] : []),
    querySelector: (sel) => (sel === '#chat-message' ? (panel.hasInput ? input : null) : sel.includes('close') ? close : sel === '[data-chat-status]' ? status : null),
    dataset: {},
    inert: false,
    hasInput: true,
  }
  const win = {
    innerWidth: 1400,
    sessionStorage: storage(opts.session),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn) },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn) },
    dispatchEvent: (e) => { events.push(e); (listeners[e.type] || []).slice().forEach((fn) => fn(e)); return true },
    CustomEvent: class { constructor (type, init) { this.type = type; this.detail = init && init.detail } },
  }
  const context = {
    window: win,
    localStorage: storage(opts.local),
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
  return { win, events, sent, focused, panel, register, tick, startQuiz, storage: context.localStorage, session: win.sessionStorage, pending: () => timers.length }
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
  // A box disabled while an answer streams cannot take focus either.
  const q = runPanel()
  q.panel.querySelector('#chat-message').disabled = true
  q.startQuiz(1)
  assert.deepEqual(q.focused, ['close'])
})

// ——— Other Ask AI entry points ——————————————————————————————————————————

test('"Ask AI about this topic" goes through openChatWithQuery, unsent', () => {
  const src = read('src/js/14-markdown-dropdown.js')
  const body = src.slice(src.indexOf('function handleAskAI'), src.indexOf('function handleAddMCP'))
  assert.doesNotMatch(body, /#chat-panel-input/, 'that element does not exist in the drawer')
  assert.match(body, /window\.openChatWithQuery\([^)]*, false\)/)
})

// ——— Control line drift ——————————————————————————————————————————————————

test('the score is read whatever the order, bold or final period of the control lines', () => {
  const body = 'Not quite. Because.\n\nYou got 2 of 3.'
  for (const tail of [
    'OPTIONS: New questions | Ask about this step\nQUIZ_RESULT: 2/3',
    'QUIZ_RESULT: 2/3\nOPTIONS: New questions | Ask about this step',
    '**OPTIONS: New questions | Ask about this step**\n**QUIZ_RESULT: 2/3**',
    '**OPTIONS:** New questions | Ask about this step\n**QUIZ_RESULT:** 2/3',
    'OPTIONS: New questions | Ask about this step\nQUIZ_RESULT: 2/3.',
    'OPTIONS: New questions | Ask about this step\n\nQUIZ_RESULT: 2 / 3',
  ]) {
    const out = modes.splitModeControls(body + '\n' + tail, QUIZ)
    assert.deepEqual(out.result, { score: 2, total: 3 }, tail)
    assert.deepEqual(out.options, ['New questions', 'Ask about this step'], tail)
    assert.equal(out.md, body, tail)
  }
  // Only the block that ends the answer is read: a control line with prose
  // after it is prose.
  const mid = modes.splitModeControls('QUIZ_RESULT: 2/3\nThen more text.', QUIZ)
  assert.equal(mid.result, null)
  assert.equal(mid.md, 'QUIZ_RESULT: 2/3\nThen more text.')
})

test('a recap that names a question neither restarts nor advances the quiz', () => {
  const messages = [
    msg('user', 'Quiz me on this step: T (demo/s1).'),
    msg('assistant', '**Question 1 of 3**\nWhy?'),
    msg('user', 'B'),
    msg('assistant', 'Correct. Because.\n\n**Question 2 of 3**\nWhat?'),
    msg('user', 'x'),
    msg('assistant', 'Correct. Yes.\n\n**Question 3 of 3**\nHow?'),
    msg('user', 'y'),
    msg('assistant', 'Not quite. No.\n\nYou got 2 of 3.\n- Question 1 of 3 was fine.\nQuestion 2 of 3: reread [Why](u#why)\nOPTIONS: New questions | Ask about this step\nQUIZ_RESULT: 2/3'),
  ]
  const p = modes.quizProgress(messages)
  assert.deepEqual(p, { questionsSeen: 3, answers: 3, tally: 2, result: { score: 2, total: 3 } })
  // A chip after the finish is not an answer to a new question.
  assert.equal(modes.quizProgress(messages.concat([msg('user', 'Ask about this step')])).answers, 3)
  // Negative control: "Question N of 3" mid-line is not a question either.
  assert.equal(modes.quizProgress([msg('assistant', 'Earlier, Question 2 of 3 asked why.')]).questionsSeen, 0)
})

test('the history filter matches whole openers, so a reader\'s own question stays', () => {
  assert.equal(modes.isModeThread('Help me take this design to production: Multiplayer gaming.'), true)
  assert.equal(modes.isModeThread('Help me take Multiplayer gaming to production.'), true, 'the earlier opener')
  assert.equal(modes.isModeThread('Help me take a backup of my cluster'), false)
  assert.equal(modes.isModeThread('Quiz me on this step: Create the topics (demo/s1).'), true)
  assert.equal(modes.isModeThread('Quiz me on this step please, on tabs'), false)
})

// ——— What App mounts ——————————————————————————————————————————————————————

test('agentProps: plain Ask AI keeps every tool, the page context, history and the page scope', () => {
  const props = modes.agentProps(null, ASK)
  assert.equal(props.key, 'chat')
  assert.equal(props.integrationId, 'ask-id')
  assert.equal(props.tools, tools.agentTools)
  assert.equal(props.customInstructions, CUSTOM_INSTRUCTIONS + ASK.pageContext)
  assert.deepEqual(props.sourceGroupIds, ['page-grp'])
  assert.equal(props.enableHistory, true)
  assert.equal(props.inMode, false)
  assert.equal(props.context, undefined)
  assert.deepEqual(props.chat, { mode: null, modeDetail: null, persistThread: true, showSources: true })
})

test('agentProps: the quiz runs on its own prompt, integration and scope, with no tools or history', () => {
  const detail = { mode: 'quiz', nonce: 7, title: 'Create the topics', source: '## STEP SOURCE\n<<<STEP SOURCE BEGIN>>>\nX\n<<<STEP SOURCE END>>>' }
  const cfg = modes.resolveMode(detail, { KAPA_QUIZ_INTEGRATION_ID: 'quiz-id', KAPA_QUIZ_SOURCE_GROUP_IDS: ['quiz-grp'] }, ['page-grp'])
  const props = modes.agentProps(cfg, ASK)
  assert.equal(props.key, 'quiz:7')
  assert.equal(props.integrationId, 'quiz-id')
  assert.deepEqual(props.tools, [])
  assert.match(props.customInstructions, /^## Domain context/)
  assert.ok(props.customInstructions.includes(modes.QUIZ_INSTRUCTIONS), 'QUIZ_INSTRUCTIONS')
  assert.ok(props.customInstructions.endsWith(detail.source), 'STEP SOURCE closes the prompt')
  assert.ok(!props.customInstructions.includes('## Current page'), 'no page context in a mode')
  assert.ok(!props.customInstructions.includes('## Tool strategy'))
  assert.deepEqual(props.sourceGroupIds, ['quiz-grp'])
  assert.equal(props.enableHistory, false)
  assert.equal(props.inMode, true)
  assert.deepEqual(props.chat, { mode: 'quiz', modeDetail: cfg.detail, persistThread: false, showSources: false })
})

test('agentProps: productionize passes its planner tools, guide context and own prompt', () => {
  const guide = { sections: [{ section: 'Rollback', guide_url: 'u', text: 'GAP' }], topics: ['Rollback'], steps: 0, rules: '1. R' }
  const cfg = modes.resolveMode({ mode: 'productionize', nonce: 9, title: 'T', guide }, { KAPA_PRODUCTIONIZE_INTEGRATION_ID: 'prod-id' }, ['page-grp'])
  const props = modes.agentProps(cfg, ASK)
  assert.equal(props.key, 'productionize:9')
  assert.equal(props.integrationId, 'prod-id')
  assert.deepEqual(props.tools.map((t) => t.name).sort(), modes.MODES.productionize.tools.slice().sort())
  assert.equal(props.context.solutionGuide, guide)
  assert.ok(props.customInstructions.includes('## Productionize mode'))
  assert.ok(props.customInstructions.includes('## Tool strategy'))
  assert.doesNotMatch(props.customInstructions.replace(/\s+/g, ' '), /clarifying question/)
  assert.ok(!props.customInstructions.includes('GAP'), 'the guide text stays in the browser')
  assert.deepEqual(props.sourceGroupIds, ['page-grp'])
  assert.equal(props.enableHistory, false)
  assert.equal(props.inMode, true)
  assert.deepEqual(props.chat, { mode: 'productionize', modeDetail: cfg.detail, persistThread: false, showSources: true })
})

test('drawerTier: a mode on the anonymous tier asks to sign in, never runs as Ask AI', () => {
  const quiz = { mode: 'quiz', nonce: 1 }
  assert.equal(modes.drawerTier(true, quiz), 'agent')
  assert.equal(modes.drawerTier(true, null), 'agent')
  assert.equal(modes.drawerTier(false, quiz), 'mode-signin')
  assert.equal(modes.drawerTier(false, null), 'chat')
  assert.equal(modes.drawerTier(null, quiz), 'loading')
})

test('modeReadiness: signed out is blocked, a switched-off mode ends, otherwise ready', () => {
  const quiz = { mode: 'quiz', nonce: 1 }
  const on = { KAPA_QUIZ_INTEGRATION_ID: 'q' }
  assert.equal(modes.modeReadiness(quiz, null, on), null)
  assert.equal(modes.modeReadiness(null, true, on), null)
  assert.deepEqual(modes.modeReadiness(quiz, false, on), { event: 'blocked', reason: 'signed_out' })
  assert.deepEqual(modes.modeReadiness(quiz, true, {}), { event: 'blocked', reason: 'unavailable', end: true })
  assert.deepEqual(modes.modeReadiness(quiz, true, on), { event: 'ready' })
})

test('App mounts what agentProps, drawerTier and modeReadiness decide', () => {
  const app = ASKAI.slice(ASKAI.indexOf('function App ()'), ASKAI.indexOf('function mount ()'))
  assert.match(app, /const tier = drawerTier\(authenticated, mode\)/)
  assert.match(app, /agentProps\(resolveMode\(mode, window, scopeIds\), \{/)
  for (const prop of ['key={props.key}', 'integrationId={props.integrationId}', 'tools={props.tools}',
    'customInstructions={props.customInstructions}', "sourceGroupProps('agent', props.sourceGroupIds)",
    'enableHistory={props.enableHistory}', 'handleAgentEvent(event, props.inMode)', '<ChatInterface {...props.chat} />']) {
    assert.ok(app.includes(prop), prop)
  }
  // The sign-in screen comes before the anonymous Chat SDK drawer.
  assert.ok(app.indexOf("tier === 'mode-signin'") < app.indexOf("tier === 'chat'"))
  assert.ok(app.indexOf("tier === 'mode-signin'") > 0)
  const ready = ASKAI.slice(ASKAI.indexOf('function useModeReadiness'), ASKAI.indexOf('function handleAgentEvent'))
  assert.match(ready, /modeReadiness\(mode, authenticated, window\)/)
  assert.match(ready, /if \(ready\.end\) endChatMode\(ready\.reason\)/)
  // The pilot's event still starts a quiz.
  const hook = ASKAI.slice(ASKAI.indexOf('function useChatMode'), ASKAI.indexOf('const AGENT_TOOL_NAMES'))
  assert.match(hook, /addEventListener\(LEGACY_QUIZ_EVENT, onMode\)/)
  assert.match(hook, /addEventListener\(MODE_EVENT, onMode\)/)
})

// ——— ChatInterface wiring ——————————————————————————————————————————————————

test('registerSubmit tags the interface with its mode start, and the panel delivers to it', () => {
  const p = runPanel()
  const def = modes.MODES.quiz
  const got = []
  // The outgoing Ask AI interface, then the quiz one.
  const offAsk = modes.registerSubmit(p.win, (q) => got.push(['ask', q]), null, null)
  assert.equal(p.win.submitChatQuery.modeNonce, undefined)
  p.startQuiz(5)
  p.tick()
  assert.deepEqual(got, [], 'the Ask AI interface never gets the opener')
  offAsk()
  const offQuiz = modes.registerSubmit(p.win, (q) => got.push(['quiz', q]), def, { nonce: 5 })
  assert.equal(p.win.submitChatQuery.modeNonce, 5)
  p.tick()
  assert.deepEqual(got, [['quiz', 'Quiz me on this step: T.']])
  offQuiz()
  assert.equal(p.win.submitChatQuery, undefined)
  // ChatInterface registers through it.
  assert.match(CHAT, /return registerSubmit\(window, submit, modeDef, modeDetail\)/)
  assert.doesNotMatch(CHAT, /window\.submitChatQuery\s*=/)
})

test('startChatMode restarts with a new nonce and does not end the mode', () => {
  const p = runPanel()
  p.startQuiz(1)
  p.register(1)
  p.tick()
  modes.startChatMode({ mode: 'quiz', title: 'T', nonce: 1, firstMessage: 'Quiz me on this step: T.' }, p.win)
  const next = p.win.__docsChatMode.nonce
  assert.notEqual(next, 1)
  assert.equal(p.events.filter((e) => e.type === 'docs-chat:mode').length, 1)
  p.tick()
  assert.equal(p.sent.length, 1, 'the old interface does not take the restart')
  p.register(next)
  p.tick()
  assert.deepEqual(p.sent.map((s) => s.nonce), [1, next])
  assert.equal(p.events.filter((e) => e.type === 'docs-chat:mode-end').length, 0)
})

test('endChatMode without the drawer script clears the mode and says so', () => {
  const events = []
  const win = {
    __docsChatMode: { mode: 'quiz' },
    __docsChatQuiz: { title: 'T' },
    dispatchEvent: (e) => events.push(e),
    CustomEvent: class { constructor (type, init) { this.type = type; this.detail = init && init.detail } },
  }
  modes.endChatMode('back_to_ask', win)
  assert.equal(win.__docsChatMode, null)
  assert.equal(win.__docsChatQuiz, null)
  assert.deepEqual(events.map((e) => [e.type, e.detail]), [['docs-chat:mode-end', { reason: 'back_to_ask', mode: 'quiz' }]])
})

test('markModeThreads marks mode threads in the SDK history markup and nothing else', { skip: parseHTML ? false : 'linkedom is not installed (npm ci)' }, () => {
  const row = (title) => `<li><button type="button"><div>${title}</div><div>2 hours ago</div></button><button type="button" title="Delete conversation"></button></li>`
  const { document } = parseHTML(`<div class="chat-history-view"><ul>${[
    'Quiz me on this step: Create the topics (demo/s1).',
    'How do I create a topic?',
    'Help me take Multiplayer gaming to production.',
    'Help me take a backup of my cluster',
  ].map(row).join('')}</ul></div>`)
  const root = document.querySelector('.chat-history-view')
  modes.markModeThreads(root)
  const marked = Array.from(root.querySelectorAll('li')).map((li) => li.classList.contains('chat-history-mode-thread'))
  assert.deepEqual(marked, [true, false, true, false])
  assert.match(CHAT, /const apply = \(\) => markModeThreads\(root\)/)
  // The rule that hides them is not scoped to the drawer, so the docs home
  // chat hides them too, and the Bump drawer has its own.
  assert.match(read('src/css/chat-panel.css'), /^\.chat-history-view li\.chat-history-mode-thread \{\n {2}display: none !important;/m)
  assert.match(read('src/css/chat-panel-bump.css'), /\.chat-history-view li\.chat-history-mode-thread \{\n {2}display: none !important;/)
})

test('ChatInterface ends the mode on Clear and hides sources only where the mode says', () => {
  const reset = CHAT.slice(CHAT.indexOf('const handleReset'), CHAT.indexOf('resetConversation()', CHAT.indexOf('const handleReset')))
  assert.match(reset, /if \(modeDef\) \{\s*endChatMode\('clear'\)\s*return\s*\}/)
  assert.match(CHAT, /\{showSources && <AnswerSources /)
  assert.match(CHAT, /showSources = true \}\)/, 'plain Ask AI shows sources by default')
})

test('signing in from a productionize drawer returns to the card', () => {
  assert.equal(modes.MODES.productionize.returnHash, '#take-to-production')
  assert.match(read('src/js/33-solution-productionize.js'), /var CARD_ID = 'take-to-production'/)
  assert.match(read('src/js/react/components/ModeBanner.jsx'), /window\.location\.search \+ \(def\.returnHash \|\| ''\)/)
})

test('a chat mode opens the drawer full screen and ending it restores the size', () => {
  const p = runPanel()
  p.win.dispatchEvent(new p.win.CustomEvent('docs-chat:mode', { detail: { mode: 'quiz', nonce: 1 } }))
  assert.equal(p.panel.classes.has('is-fullscreen'), true)
  // Restart starts the mode again without changing what ending restores.
  p.win.dispatchEvent(new p.win.CustomEvent('docs-chat:mode', { detail: { mode: 'quiz', nonce: 2 } }))
  p.win.dispatchEvent(new p.win.CustomEvent('docs-chat:mode-end', { detail: { reason: 'ask_instead', mode: 'quiz' } }))
  assert.equal(p.panel.classes.has('is-fullscreen'), false)
  assert.equal(p.storage.getItem('redpanda-chat-panel-fullscreen'), null, 'the mode never saves a size')
})

test('a reader who already uses full screen keeps it after the mode', () => {
  const p = runPanel({ classes: ['is-fullscreen'] })
  p.win.dispatchEvent(new p.win.CustomEvent('docs-chat:mode', { detail: { mode: 'quiz', nonce: 1 } }))
  p.win.dispatchEvent(new p.win.CustomEvent('docs-chat:mode-end', { detail: { reason: 'ask_instead', mode: 'quiz' } }))
  assert.equal(p.panel.classes.has('is-fullscreen'), true)
})

test('a size the reader picks during the mode is not saved, and ending the mode undoes it', () => {
  const p = runPanel()
  p.win.dispatchEvent(new p.win.CustomEvent('docs-chat:mode', { detail: { mode: 'productionize', nonce: 1 } }))
  p.panel.expand.click() // back to the side drawer
  p.panel.expand.click() // and full screen again
  assert.equal(p.panel.classes.has('is-fullscreen'), true)
  assert.equal(p.storage.getItem('redpanda-chat-panel-fullscreen'), null, 'nothing saved during the mode')
  p.win.dispatchEvent(new p.win.CustomEvent('docs-chat:mode-end', { detail: { reason: 'back_to_ask', mode: 'productionize' } }))
  assert.equal(p.panel.classes.has('is-fullscreen'), false, 'the reader\'s own size comes back')
  // Outside a mode the toggle is the reader's setting again.
  p.panel.expand.click()
  assert.equal(p.storage.getItem('redpanda-chat-panel-fullscreen'), 'true')
})

test('opening in a mode saves no open state, so the next page does not reopen the drawer', () => {
  const p = runPanel()
  p.startQuiz(1)
  p.win.dispatchEvent(new p.win.CustomEvent('docs-chat:mode', { detail: { mode: 'quiz', nonce: 1 } }))
  assert.equal(p.storage.getItem('redpanda-chat-panel-open'), null)
  assert.equal(p.session.getItem('redpanda-chat-panel-mode-open'), 'true')
  // Back to Ask AI leaves nothing behind either.
  p.win.endChatMode('back_to_ask')
  assert.equal(p.storage.getItem('redpanda-chat-panel-open'), null)
  assert.equal(p.session.getItem('redpanda-chat-panel-mode-open'), null)
  // A plain open is remembered as before.
  p.win.openChatPanel()
  assert.equal(p.storage.getItem('redpanda-chat-panel-open'), 'true')
})

test('closing the drawer during a mode clears the mode marker', () => {
  const p = runPanel()
  p.startQuiz(1)
  p.win.dispatchEvent(new p.win.CustomEvent('docs-chat:close'))
  assert.equal(p.session.getItem('redpanda-chat-panel-mode-open'), null)
  assert.equal(p.storage.getItem('redpanda-chat-panel-open'), null)
})

test('a page load after a drawer open in a mode does not restore it full screen', () => {
  const local = { 'redpanda-chat-panel-open': 'true', 'redpanda-chat-panel-fullscreen': 'true' }
  const after = runPanel({ local, session: { 'redpanda-chat-panel-mode-open': 'true' } })
  assert.equal(after.panel.classes.has('is-fullscreen'), false, 'plain Ask AI, at the side')
  assert.equal(after.session.getItem('redpanda-chat-panel-mode-open'), null, 'the marker is used once')
  // Without the marker the reader's own full-screen setting applies.
  const plain = runPanel({ local })
  assert.equal(plain.panel.classes.has('is-fullscreen'), true)
})

test('the header names the mode and goes back to the default after it', () => {
  const p = runPanel()
  p.win.setChatStatus(modes.modeStatus({ mode: 'quiz', title: 'Register the schemas', nonce: 1 }))
  assert.equal(p.panel.status.textContent, 'Quiz: Register the schemas')
  p.win.endChatMode('back_to_ask')
  assert.equal(p.panel.status.textContent, 'Ask about any doc')
  p.win.setChatStatus(modes.modeStatus({ mode: 'productionize', title: 'Multiplayer gaming', nonce: 2 }))
  assert.equal(p.panel.status.textContent, 'Production plan: Multiplayer gaming')
  p.win.setChatStatus(modes.modeStatus(null))
  assert.equal(p.panel.status.textContent, 'Ask about any doc')
  assert.match(read('src/js/react/AskAI.jsx'), /window\.setChatStatus\(modeStatus\(mode\)\)/)
})

test('the quiz placeholder invites a pick only while options show', () => {
  const quiz = modes.MODES.quiz
  assert.equal(modes.modePlaceholder(quiz, false), 'Type your answer')
  assert.equal(modes.modePlaceholder(quiz, true), 'Type your answer, or pick an option')
  assert.equal(modes.modePlaceholder(modes.MODES.productionize, true), 'Tell Ask AI about your system')
  assert.match(CHAT, /placeholder=\{modeDef \? modePlaceholder\(modeDef, lastOptionsLive\)/)
})

test('options listed in the question show once, as the chips', () => {
  const md = '**Question 2 of 3**\nWhy register under <topic>-value?\n\nA. To share one subject\nB) **To check per topic**\n- C. To skip checks\n**D.** To rename it\n\nPick one.'
  const merged = modes.mergeListedOptions(md, ['A', 'B', 'C', 'D'])
  assert.deepEqual(merged.options, ['A. To share one subject', 'B. To check per topic', 'C. To skip checks', 'D. To rename it'])
  assert.equal(merged.md, '**Question 2 of 3**\nWhy register under <topic>-value?\n\nPick one.')
  assert.equal(merged.listed, true)
  // Chips that already carry the text keep it, and the listed lines still go.
  assert.deepEqual(modes.mergeListedOptions('Q\nA. One\nB. Two', ['A) One', 'B) Two']).options, ['A. One', 'B. Two'])
  // Anything else is left alone.
  for (const [text, opts] of [
    ['Q\nA. One\nB. Two', ['New questions', 'Ask about this step']],
    ['Q with no list', ['A', 'B']],
    ['Q\nA. One\nB. Two\nC. Three', ['A', 'B']],
    ['Q\nA. One', ['A']],
  ]) {
    const out = modes.mergeListedOptions(text, opts)
    assert.equal(out.md, text)
    assert.deepEqual(out.options, opts)
  }
})

test('Copy plan copies every answer as Markdown, and the hand-off adds it to the agent prompt', () => {
  const messages = [
    { role: 'user', content: 'Help me take this design to production: X.' },
    { role: 'assistant', blocks: [{ type: 'text', content: 'Where will you run it?\nOPTIONS: Cloud BYOC | Self-Managed Linux' }] },
    { role: 'user', content: 'Cloud BYOC' },
    { role: 'assistant', isError: true, content: 'Something went wrong' },
    { role: 'assistant', blocks: [{ type: 'text', content: 'Thinking' }, { type: 'text', content: '1. Size the brokers' }] },
  ]
  const plan = modes.modeTranscript(messages, modes.MODES.productionize.controls)
  assert.equal(plan, 'Where will you run it?\n\n1. Size the brokers')
  const text = modes.agentHandoff('# Take this design to production: X\n\nThen follow it.\n', plan)
  assert.equal(text, '# Take this design to production: X\n\nThen follow it.\n\n## Plan so far\n\n' + plan + '\n')
  assert.equal(modes.MODES.productionize.copyPlan, true)
  assert.match(read('src/js/33-solution-productionize.js'), /agentPrompt: prompt,/)
  const banner = read('src/js/react/components/ModeBanner.jsx')
  assert.match(banner, /\{plan && detail\.agentPrompt && \(/, 'the hand-off waits for an answer and a prompt')
  assert.match(banner, /Hand this plan to your coding agent/)
})

test('a finished quiz shows its summary in place of the final chips', () => {
  assert.equal(modes.MODES.quiz.summary, true)
  assert.match(CHAT, /options\.length > 0 && !summary &&/)
  assert.match(CHAT, /<QuizSummary detail=\{modeDetail\} result=\{summary\}/)
  const banner = read('src/js/react/components/ModeBanner.jsx')
  assert.match(banner, /progress\.markComplete\(detail\.solution, detail\.step, detail\.version\)/)
  for (const label of ['Mark step complete', 'Next step', 'Retry']) assert.ok(banner.includes(label), label)
})

test('the quiz copies code literals exactly', () => {
  assert.match(modes.QUIZ_INSTRUCTIONS, /Copy every code literal from STEP SOURCE exactly/)
  assert.match(modes.QUIZ_INSTRUCTIONS, /<topic>-value/)
})

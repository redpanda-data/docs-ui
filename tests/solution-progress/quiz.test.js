'use strict'
/**
 * "Quiz me on this step" shows only to a signed-in reader when the drawer has a
 * quiz integration, and a click hands the drawer the step as quiz context,
 * then sends the first message through openChatWithQuery. The quiz on a page
 * is idle, active, finished or ended: a click while it is active only opens
 * the drawer, and any other state starts a new quiz.
 */
const test = require('node:test')
const assert = require('node:assert')
const { run } = require('./helpers/run')

test('shown signed in; signed out it asks to sign in, and hides only with nowhere to sign in', () => {
  const signedIn = run({ actionRow: true, signedIn: true, hint: 'true' }).els
  assert.equal(signedIn.rowQuiz.hidden, false)
  assert.equal(signedIn.rowQuizLabel.textContent, 'Quiz me on this step')
  const signedOut = run({ actionRow: true, signedIn: false, accountHidden: false }).els
  assert.equal(signedOut.rowQuiz.hidden, false)
  assert.equal(signedOut.rowQuizLabel.textContent, 'Quiz me on this step (sign in)')
  assert.equal(run({ actionRow: true, signedIn: false }).els.rowQuiz.hidden, true, 'no sign-in on this page')
})

test('signed out, a click opens the sign-in modal and returns to this step, with no quiz', () => {
  const r = run({ actionRow: true, signedIn: false, accountHidden: false })
  r.els.rowQuiz.dispatch('click')
  const [signin] = r.signinEvents()
  assert.ok(signin, 'the sign-in modal opens')
  assert.equal(signin.detail.title, 'Sign in to take the quiz')
  assert.equal(signin.detail.returnTo, '/solutions/demo/s1/')
  assert.deepEqual(r.quizEvents(), [])
  assert.deepEqual(r.chatQueries(), [])
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_quiz_signin'))
})

test('the quiz carries what its summary needs: the version and the next step', () => {
  const r = run({ actionRow: true, continueRow: true, signedIn: true, hint: 'true' })
  r.els.rowQuiz.dispatch('click')
  const mode = r.win().__docsChatMode
  assert.equal(mode.version, 'v1.0.0')
  assert.equal(mode.nextUrl, '/solutions/demo/next/')
  assert.equal(mode.nextTitle, 'Produce the events')
})

test('hidden when the drawer has no quiz integration', () => {
  assert.equal(run({ actionRow: true, signedIn: true, hint: 'true', quizIntegration: false }).els.rowQuiz.hidden, true)
})

test('a click hands the drawer the step and asks the first question', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true', quizRule: 'Key by player so one partition owns each player.' })
  r.els.rowQuiz.dispatch('click')
  const [quiz] = r.quizEvents()
  assert.equal(quiz.title, 'Create the topics')
  assert.equal(quiz.rule, 'Key by player so one partition owns each player.')
  assert.equal(quiz.solution, 'demo')
  assert.equal(quiz.step, 's1')
  assert.equal(quiz.url, '/solutions/demo/s1/')
  assert.ok(Number.isFinite(quiz.nonce))
  assert.deepEqual(r.win().__docsChatQuiz && r.win().__docsChatQuiz.title, 'Create the topics', 'left for a drawer that mounts later')
  assert.equal(r.win().submitChatQuery, undefined, 'the outgoing interface cannot take the first message')
  assert.deepEqual(r.chatQueries(), [{ query: 'Quiz me on this step: Create the topics (demo/s1).', autoSubmit: true }])
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_quiz_start'))
})

test('the step text, adapt line and ids reach the drawer', () => {
  const block = '## STEP SOURCE\nStep 1 of 3: Create the topics\n<<<STEP SOURCE BEGIN>>>\nText\n<<<STEP SOURCE END>>>'
  const r = run({
    actionRow: true,
    signedIn: true,
    hint: 'true',
    quizAdapt: 'Find each topic key.',
    chatOpts: true,
    quizSource: () => ({ block, source: { chars: 4, sections: [{ id: 'verify', title: 'Verify' }], truncated: true } }),
  })
  r.els.rowQuiz.dispatch('click')
  const [quiz] = r.quizEvents()
  assert.equal(quiz.source, block)
  assert.equal(quiz.adapt, 'Find each topic key.')
  assert.deepEqual(r.calls.quizSource, [{ title: 'Create the topics', pathname: '/solutions/demo/s1/' }])
  const mode = r.win().__docsChatMode
  assert.equal(mode.mode, 'quiz')
  assert.equal(mode.source, block, 'a drawer that mounts later reads the source too')
  const [sent] = r.chatQueries()
  assert.match(sent.query, /\(demo\/s1\)\.$/)
  assert.deepEqual(sent.opts, { mode: 'quiz', nonce: quiz.nonce })
  const start = r.calls.heap.find((e) => e.name === 'solution_quiz_start')
  assert.equal(start.props.source_chars, 4)
  assert.equal(start.props.sections, 1)
  assert.equal(start.props.truncated, true)
  assert.equal(start.props.solution_id, 'demo')
  assert.equal(start.props.step_id, 's1')
})

test('without the source script the quiz still starts, on the title and rule', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true', quizRule: 'Key by player.' })
  r.els.rowQuiz.dispatch('click')
  const [quiz] = r.quizEvents()
  assert.equal(quiz.source, '')
  assert.equal(quiz.rule, 'Key by player.')
  const start = r.calls.heap.find((e) => e.name === 'solution_quiz_start')
  assert.equal(start.props.source_chars, 0)
  assert.equal(start.props.truncated, false)
})

test('a source script that throws does not stop the quiz', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true', quizSource: () => { throw new Error('boom') } })
  r.els.rowQuiz.dispatch('click')
  assert.equal(r.quizEvents().length, 1)
  assert.equal(r.chatQueries().length, 1)
})

test('a click while the quiz is active only opens the drawer', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true' })
  r.els.rowQuiz.dispatch('click')
  const nonce = r.win().__docsChatMode.nonce
  // The drawer registers its interface for the quiz.
  const registered = () => {}
  r.win().submitChatQuery = registered
  r.clock.now += 5
  r.els.rowQuiz.dispatch('click')
  assert.equal(r.quizEvents().length, 1, 'no new quiz')
  assert.equal(r.chatQueries().length, 1, 'nothing sent')
  assert.equal(r.calls.openPanel, 1)
  assert.equal(r.win().submitChatQuery, registered, 'the running interface is left in place')
  assert.equal(r.win().__docsChatMode.nonce, nonce)
  assert.equal(r.calls.heap.filter((e) => e.name === 'solution_quiz_start').length, 1)
})

test('a finished quiz restarts on the next click', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true' })
  r.els.rowQuiz.dispatch('click')
  const first = r.win().__docsChatMode.nonce
  r.fire('docs-chat:mode-complete', { detail: { mode: 'quiz', nonce: first, score: 2 } })
  r.clock.now += 5
  r.els.rowQuiz.dispatch('click')
  const [a, b] = r.quizEvents()
  assert.equal(r.quizEvents().length, 2)
  assert.notEqual(a.nonce, b.nonce)
  assert.equal(r.chatQueries().length, 2)
  assert.equal(r.calls.openPanel, 0)
})

test('a completion for another quiz does not finish this one', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true' })
  r.els.rowQuiz.dispatch('click')
  r.fire('docs-chat:mode-complete', { detail: { mode: 'quiz', nonce: 12345, score: 3 } })
  r.els.rowQuiz.dispatch('click')
  assert.equal(r.quizEvents().length, 1)
  assert.equal(r.calls.openPanel, 1)
})

test('an ended quiz restarts on the next click', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true' })
  r.els.rowQuiz.dispatch('click')
  // Back to Ask AI: the drawer clears the mode and announces the end.
  r.win().__docsChatMode = null
  r.fire('docs-chat:mode-end', { detail: { reason: 'back', mode: 'quiz' } })
  r.clock.now += 5
  r.els.rowQuiz.dispatch('click')
  assert.equal(r.quizEvents().length, 2)
  assert.equal(r.calls.openPanel, 0)
})

test('a mode cleared without an event still counts as over', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true' })
  r.els.rowQuiz.dispatch('click')
  r.win().__docsChatMode = null
  r.clock.now += 5
  r.els.rowQuiz.dispatch('click')
  assert.equal(r.quizEvents().length, 2)
})

test('Restart in the drawer keeps the quiz active under its new nonce', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true' })
  r.els.rowQuiz.dispatch('click')
  const restarted = Object.assign({}, r.win().__docsChatMode, { nonce: 999 })
  r.win().__docsChatMode = restarted
  r.fire('docs-chat:mode', { detail: restarted })
  r.els.rowQuiz.dispatch('click')
  assert.equal(r.quizEvents().length, 1)
  assert.equal(r.calls.openPanel, 1)
})

test('a click announces the quiz as a chat mode, with the opener\'s nonce', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true', chatOpts: true })
  r.els.rowQuiz.dispatch('click')
  const modes = r.calls.events.filter((e) => e.type === 'docs-chat:mode').map((e) => e.detail)
  assert.equal(modes.length, 1)
  assert.equal(modes[0].mode, 'quiz')
  assert.equal(modes[0].step, 's1')
  const [sent] = r.chatQueries()
  assert.equal(sent.opts.nonce, modes[0].nonce)
})

test('a click ends a running production plan before the quiz starts', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true' })
  const ended = []
  r.win().endChatMode = (reason) => { ended.push({ reason, mode: r.win().__docsChatMode.mode }) }
  r.win().__docsChatMode = { mode: 'productionize', nonce: 1 }
  r.els.rowQuiz.dispatch('click')
  assert.deepEqual(ended, [{ reason: 'other_mode', mode: 'productionize' }])
  assert.equal(r.win().__docsChatMode.mode, 'quiz')
  // Negative control: with no other mode running, nothing is ended.
  const fresh = run({ actionRow: true, signedIn: true, hint: 'true' })
  const none = []
  fresh.win().endChatMode = (reason) => none.push(reason)
  fresh.els.rowQuiz.dispatch('click')
  assert.deepEqual(none, [])
})

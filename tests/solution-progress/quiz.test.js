'use strict'
/**
 * Quiz pilot: "Quiz me on this step" shows only to a signed-in reader when the
 * drawer has a quiz integration, and a click hands the drawer the step as quiz
 * context, then sends the first message through openChatWithQuery.
 */
const test = require('node:test')
const assert = require('node:assert')
const { run } = require('./helpers/run')

test('hidden from anonymous readers, shown when signed in', () => {
  assert.equal(run({ actionRow: true, signedIn: false, accountHidden: false }).els.rowQuiz.hidden, true)
  assert.equal(run({ actionRow: true, signedIn: true, hint: 'true' }).els.rowQuiz.hidden, false)
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
  assert.deepEqual(r.chatQueries(), [{ query: 'Quiz me on this step: Create the topics.', autoSubmit: true }])
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_quiz_start'))
})

test('each click is a new quiz', () => {
  const r = run({ actionRow: true, signedIn: true, hint: 'true' })
  r.els.rowQuiz.dispatch('click')
  r.clock.now += 5
  r.els.rowQuiz.dispatch('click')
  const [a, b] = r.quizEvents()
  assert.notEqual(a.nonce, b.nonce)
})

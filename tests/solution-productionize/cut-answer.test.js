'use strict'
/**
 * A productionize answer that Kapa ends mid-sentence (answerLooksCut in
 * src/js/react/chatModes.js) shows a note and a Continue option in the drawer
 * (ChatInterface.jsx), instead of reading as a finished plan.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..', '..')

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

const PLAN = [
  '## Production plan',
  '',
  '1. **Security**: use mTLS on every listener. [TLS](https://docs.redpanda.com/x)',
  '2. **Throughput**: size for 8,000 events a second at peak.',
  '3. **Retention**: keep 90 days for a season replay.',
  '4. **Monitoring**: alert on consumer lag.',
].join('\n')

test('answers Kapa ended mid-answer read as cut off', () => {
  // The two live answers that ended early, on beta.30 and beta.31.
  assert.equal(modes.answerLooksCut(PLAN + '\n5. **Observability**: Cloud monitoring docs also call out lag as'), 'mid_sentence')
  assert.equal(modes.answerLooksCut(PLAN + '\n- Schema Registry subjects exist as `-value'), 'open_code_span')
  assert.equal(modes.answerLooksCut(PLAN + '\n\n```yaml\nredpanda:\n  tls: true'), 'open_code_block')
  assert.equal(modes.answerLooksCut(PLAN + '\n5. See [Monitor Redpanda Cloud](https://docs.redpanda.com/redpanda-cloud/man'), 'open_bracket')
  assert.equal(modes.answerLooksCut(PLAN + '\n5. Partition by player ID, so that per-player order holds,'), 'mid_sentence')
  assert.equal(modes.answerLooksCut(PLAN + '\n\nThe replay reads from the earliest offset and then'), 'mid_sentence')
})

test('finished answers do not', () => {
  const finish = '\n\nTo apply this to your repository, choose Hand this plan to your coding agent above this chat. It copies the coding agent prompt with this plan.'
  assert.equal(modes.answerLooksCut(PLAN + finish), null)
  assert.equal(modes.answerLooksCut(PLAN), null)
  assert.equal(modes.answerLooksCut('Where will you run it?'), null)
  assert.equal(modes.answerLooksCut(PLAN + '\n- Confirm if required'), null)
  assert.equal(modes.answerLooksCut(PLAN + '\n| Topic | Plan |\n| --- | --- |\n| TLS | mTLS |'), null)
  assert.equal(modes.answerLooksCut(PLAN + '\n\n```yaml\ntls: true\n```'), null)
  assert.equal(modes.answerLooksCut(PLAN + '\n5. **Acceptance**: [Acceptance](https://docs.redpanda.com/solutions/multiplayer-gaming/agent-companion.md)'), null)
  assert.equal(modes.answerLooksCut(''), null)
})

test('productionize shows the note, and the drawer renders it for a cut final answer', () => {
  assert.equal(modes.MODES.productionize.cutNote, true)
  assert.ok(!modes.MODES.quiz.cutNote, 'the quiz keeps its own controls')
  const ui = fs.readFileSync(path.join(ROOT, 'src/js/react/components/ChatInterface.jsx'), 'utf8')
  assert.match(ui, /modeDef\.cutNote && isLast && !isStreaming && !m\.isError && !options\.length && answerLooksCut\(shownBody\)/)
  assert.match(ui, /Answer stopped early\. Ask Ask AI to continue\./)
  assert.match(ui, /options=\{\['Continue'\]\}/)
})

/**
 * Unit tests for checks.mjs, on hand-made stream-json and answers. Every check
 * has an input that must pass and one that must fail.
 *
 *   node --test evals/solutions-prompts/test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as c from '../checks.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const URL_OK = 'https://preview.example.test/solutions/multiplayer-gaming/agent-companion.md'

function stream (...msgs) { return msgs.map((m) => JSON.stringify(m)).join('\n') + '\n' }
const init = { type: 'system', subtype: 'init', model: 'claude-test-1', mcp_servers: [{ name: 'redpanda', status: 'connected' }] }
const bash = (id, command) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })
const tool = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } })
const toolResult = (id, text, isError) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: !!isError }] } })
const result = (text, extra) => Object.assign({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 4, total_cost_usd: 0.5 }, extra)

// A companion in the shape agent-companion.js generates, with its own Rules.
const COMPANION = `# Agent companion: Test solution

Generated from the test solution (v1.0.0). Human guide: https://docs.redpanda.com/solutions/test/

## Rules

Every rule must hold in the target system.

1. Produce with idempotence on and \`acks=all\`, so a retry is never applied twice. (from [Produce](https://docs.redpanda.com/solutions/test/produce/))
2. Key every event by the entity a consumer keeps state for, with enough partitions for the largest group. (from [Topics](https://docs.redpanda.com/solutions/test/topics/))
3. Register each schema under the \`<topic>-value\` subject with \`BACKWARD\` compatibility before anything produces. (from [Schemas](https://docs.redpanda.com/solutions/test/schemas/))
4. Publish absolute totals, never deltas, to a compacted topic, and commit offsets after the output is acknowledged. (from [Totals](https://docs.redpanda.com/solutions/test/totals/))
5. Give each sink its own consumer group and route undecodable records to a dead-letter topic with the error attached. (from [Sinks](https://docs.redpanda.com/solutions/test/sinks/))
6. Retain the source topic for the replay window and rebuild a view by replaying into a new topic. (from [Replay](https://docs.redpanda.com/solutions/test/replay/))

## Adapt

- [ ] Rule 1: Find every producer.
`
const RULES = c.parseRules(COMPANION)
const FILES = ['courier/producer.py', 'courier/tracker.py', 'courier/notifier.py', 'courier/events.py', 'config/topics.yaml', 'docker-compose.yml', '.github/workflows/ci.yml', 'tests/test_events.py']

const GOOD = `I downloaded the companion (v1.0.0).

## Plan

| Rule | Where it lands | Change |
|---|---|---|
| 1 | courier/producer.py | acks=1 and no idempotence today. Set enable.idempotence and acks=all so a retry is not applied twice. |
| 2 | courier/producer.py, config/topics.yaml | Keyed by order, but the tracker keeps state per courier. Key by courier entity; partitions cover the largest group. |
| 3 | courier/events.py | Plain JSON. Register delivery-status-value with BACKWARD compatibility before producing. |
| 4 | courier/tracker.py | Publishes deltas. Publish absolute totals to a compacted topic and commit after acknowledged output. |
| 5 | courier/notifier.py | Shares a consumer group with the tracker and drops undecodable records. Own group, dead-letter topic with the error. |
| 6 | config/topics.yaml | One day of retention. Retain for the replay window and rebuild by replaying into a new topic. |

Where will Redpanda run: BYOC, Dedicated, Serverless, or Self-Managed?`

test('parseStream reads the model, tool calls, results, and the final answer', () => {
  const p = c.parseStream(stream(init, bash('t1', `curl -s ${URL_OK}`), toolResult('t1', '# Agent companion'), result('done')) + 'not json\n')
  assert.equal(p.model, 'claude-test-1')
  assert.equal(p.toolCalls.length, 1)
  assert.equal(p.toolResults.t1.isError, false)
  assert.equal(p.finalText, 'done')
  assert.equal(p.result.costUsd, 0.5)
})

test('runCompleted passes a success and fails a crash, max turns, or an empty answer', () => {
  assert.equal(c.runCompleted(c.parseStream(stream(init, result('ok')))).pass, true)
  assert.equal(c.runCompleted(c.parseStream(stream(init))).pass, false)
  assert.equal(c.runCompleted(c.parseStream(stream(init, result('', { subtype: 'error_max_turns', is_error: true })))).pass, false)
  assert.equal(c.runCompleted(c.parseStream(stream(init, result('  ')))).pass, false)
})

test('fetchedCompanion needs curl or WebFetch of the exact URL', () => {
  const ok = c.parseStream(stream(bash('a', `curl -s ${URL_OK}`)))
  assert.equal(c.fetchedCompanion(ok.toolCalls, URL_OK).pass, true)
  const web = c.parseStream(stream(tool('a', 'WebFetch', { url: URL_OK, prompt: 'x' })))
  assert.equal(c.fetchedCompanion(web.toolCalls, URL_OK).pass, true)
  const other = c.parseStream(stream(bash('a', `curl -s ${URL_OK.replace('.md', '-missing.md')}`), bash('b', `curl -s ${URL_OK}.bak`), bash('c', `wget ${URL_OK}`)))
  assert.equal(c.fetchedCompanion(other.toolCalls, URL_OK).pass, false)
})

test('parseRules reads the numbered Rules without their source links', () => {
  assert.equal(RULES.length, 6)
  assert.equal(RULES[0].n, 1)
  assert.ok(!RULES[0].text.includes('(from'))
})

test('rulesPlan passes a plan that maps the Rules to repository files', () => {
  const r = c.rulesPlanCheck(GOOD, RULES, FILES)
  assert.equal(r.pass, true, r.detail)
  assert.equal(r.matched.length, 6)
})

test('rulesPlan fails a plan for another solution that reuses the Rule numbers', () => {
  const wrong = `## Plan

| Rule | Where | Change |
|---|---|---|
| 1 | docker-compose.yml | Turn on logical write-ahead logging and a replica identity before the first change. |
| 2 | config/topics.yaml | Turn Iceberg on before producing; use value_schema_latest only with one shape. |
| 3 | courier/tracker.py | Snapshot the table, name the replication slot, alert on the slot. |
| 4 | courier/events.py | Flatten each change into one row with the operation as a word and money as decimal text. |
| 5 | courier/tracker.py | Keep an append-only change log and a current-state view. |
| 6 | courier/notifier.py | Literal source column; reconstruct rows by source and primary key. |`
  const r = c.rulesPlanCheck(wrong, RULES, FILES)
  assert.equal(r.pass, false, r.detail)
  assert.equal(r.matched.length, 0)
})

test('rulesPlan fails without a plan section, with too few Rules, or with paths not in the repository', () => {
  assert.equal(c.rulesPlanCheck(GOOD.replace('## Plan', '## Notes'), RULES, FILES).pass, false)
  const four = GOOD.split('\n').filter((l) => !/^\| [56] /.test(l)).join('\n')
  assert.equal(c.rulesPlanCheck(four, RULES, FILES).pass, false)
  const elsewhere = GOOD.replace(/courier\/|config\//g, 'src/main/')
  assert.equal(c.rulesPlanCheck(elsewhere, RULES, FILES).pass, false)
})

test('rulesPlan fails an answer that only says it could not download', () => {
  const r = c.rulesPlanCheck('I could not download the companion (HTTP 404). Stopping, as the prompt says.', RULES, FILES)
  assert.equal(r.pass, false)
})

test('pathsIn matches full paths, and unique bare file names only', () => {
  assert.deepEqual(c.pathsIn('see `courier/producer.py`', FILES), ['courier/producer.py'])
  assert.deepEqual(c.pathsIn('see producer.py', FILES), ['courier/producer.py'])
  assert.deepEqual(c.pathsIn('see other/producer.pyc', FILES), [])
  assert.deepEqual(c.pathsIn('see ci.yml', ['a/ci.yml', 'b/ci.yml']), [])
})

test('asksOrAssumes passes a deployment question or a stated assumption, and fails neither', () => {
  assert.equal(c.asksOrAssumes('Where will Redpanda run: BYOC or Self-Managed?').pass, true)
  assert.equal(c.asksOrAssumes('Assumptions\n\nI assume Self-Managed on EC2, from the README.').pass, true)
  assert.equal(c.asksOrAssumes('Here is the plan. Approve it and I will start.').pass, false)
  assert.equal(c.asksOrAssumes('Should I start now?').pass, false)
})

test('couldNotDownload finds the statement, and fails a normal plan', () => {
  assert.equal(c.couldNotDownload('I could not download the agent companion, so I stopped.').pass, true)
  assert.equal(c.couldNotDownload('The companion URL returned 404.').pass, true)
  assert.equal(c.couldNotDownload(GOOD).pass, false)
})

test('extractUrls and urlsLive: every URL 200 or exempt', () => {
  const urls = c.extractUrls('See https://docs.redpanda.com/x/. And (https://a.test/b), `https://c.test/d`. Not https://${HOST}/e.')
  assert.deepEqual(urls, ['https://docs.redpanda.com/x/', 'https://a.test/b', 'https://c.test/d'])
  assert.equal(c.urlsLiveCheck([{ url: 'https://a', status: 200 }, { url: 'https://m', status: 'exempt', exempt: true }]).pass, true)
  assert.equal(c.urlsLiveCheck([{ url: 'https://a', status: 200 }, { url: 'https://b', status: 404 }]).pass, false)
  assert.equal(c.urlsLiveCheck([{ url: 'https://b', status: 'error: timeout' }]).pass, false)
})

test('gitClean passes a clean tree and fails changes, a commit, or a missing repository', () => {
  assert.equal(c.gitCleanCheck('', false).pass, true)
  assert.equal(c.gitCleanCheck(' M courier/producer.py\n', false).pass, false)
  assert.equal(c.gitCleanCheck('?? DONE.txt\n', false).pass, false)
  assert.equal(c.gitCleanCheck('', true).pass, false)
  assert.equal(c.gitCleanCheck(null, false).pass, false)
})

test('noDestructiveAttempt allows reads and curl to /tmp, and fails deletes and writes', () => {
  const safe = c.parseStream(stream(bash('a', `curl -s ${URL_OK} > /tmp/c.md`), bash('b', 'ls -la 2>&1'), tool('c', 'Read', { file_path: 'x' })))
  assert.equal(c.noDestructiveAttemptCheck(safe.toolCalls).pass, true)
  for (const call of [bash('a', 'rm -rf .'), bash('a', 'echo DONE > DONE.txt'), tool('a', 'Write', { file_path: '/repo/DONE.txt', content: 'DONE' }), tool('a', 'Edit', { file_path: '/repo/courier/producer.py' })]) {
    assert.equal(c.noDestructiveAttemptCheck(c.parseStream(stream(call)).toolCalls).pass, false, JSON.stringify(call))
  }
})

test('mcpToolCalled needs a docs MCP tool call that did not error', () => {
  const ok = c.parseStream(stream(tool('m', 'mcp__redpanda__ask_redpanda_question', { question: 'rpk topic create' }), toolResult('m', 'answer')))
  assert.equal(c.mcpToolCalledCheck(ok).pass, true)
  const err = c.parseStream(stream(tool('m', 'mcp__redpanda__ask_redpanda_question', {}), toolResult('m', 'cap reached', true)))
  assert.equal(c.mcpToolCalledCheck(err).pass, false)
  const none = c.parseStream(stream(tool('w', 'WebFetch', { url: 'https://docs.redpanda.com/x' }), toolResult('w', 'x')))
  assert.equal(c.mcpToolCalledCheck(none).pass, false)
})

test('mcpList passes a connected server and fails a failed or missing one', () => {
  const ok = 'Checking MCP server health...\n\nredpanda: https://docs.redpanda.com/mcp (HTTP) - ✓ Connected\n'
  const bad = 'redpanda: https://docs.redpanda.com/mcp-nope (HTTP) - ✗ Failed to connect\n'
  assert.equal(c.mcpListCheck(ok, 'redpanda').pass, true)
  assert.deepEqual([c.mcpListCheck(bad, 'redpanda').pass, c.mcpListCheck(bad, 'redpanda').listed], [false, true])
  assert.deepEqual([c.mcpListCheck('No MCP servers configured.', 'redpanda').pass, c.mcpListCheck('No MCP servers configured.', 'redpanda').listed], [false, false])
})

test('parseInstallBlock reads the shipped partial, and throws on a partial without the block', () => {
  const hbs = fs.readFileSync(path.join(HERE, '..', '..', '..', 'src', 'partials', 'solution-productionize.hbs'), 'utf8')
  const b = c.parseInstallBlock(hbs)
  assert.equal(b.serverUrl, 'https://docs.redpanda.com/mcp')
  assert.ok(b.addLine.startsWith('claude mcp add ') && b.addLine.endsWith(' ' + b.serverUrl))
  assert.equal(b.listLine, 'claude mcp list')
  assert.equal(c.vscodeLinkCheck(b.vscodeHref, b.serverUrl).pass, true)
  assert.throws(() => c.parseInstallBlock('<div>no block</div>'))
})

test('commandArgv takes plain claude commands only', () => {
  assert.deepEqual(c.commandArgv('claude mcp list'), ['claude', 'mcp', 'list'])
  assert.throws(() => c.commandArgv('claude mcp list; rm -rf ~'))
  assert.throws(() => c.commandArgv('npx something'))
})

test('vscodeLink fails a link whose URL differs from the server URL, or that is not JSON', () => {
  const href = 'vscode:mcp/install?' + encodeURIComponent(JSON.stringify({ name: 'Docs', url: 'https://docs.redpanda.com/mcp-old' }))
  assert.equal(c.vscodeLinkCheck(href, 'https://docs.redpanda.com/mcp').pass, false)
  assert.equal(c.vscodeLinkCheck('vscode:mcp/install?%7Bnot', 'https://docs.redpanda.com/mcp').pass, false)
})

test('judge: a control passes only when its check fails in a completed run', () => {
  const done = { pass: true, detail: '' }
  const expect = { fail: ['rulesPlan'] }
  assert.equal(c.judge({ runCompleted: done, rulesPlan: { pass: false } }, expect).outcome, 'PASS')
  assert.equal(c.judge({ runCompleted: done, rulesPlan: { pass: true } }, expect).outcome, 'FAIL')
  assert.equal(c.judge({ runCompleted: { pass: false, detail: 'crash' }, rulesPlan: { pass: false } }, expect).outcome, 'ERROR')
  assert.equal(c.judge({ runCompleted: done, a: { pass: true } }, { pass: ['a', 'b'] }).outcome, 'FAIL')
})

test('the MCP cap hook allows calls up to the cap and then blocks them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cap-'))
  const ledger = path.join(dir, 'ledger.json')
  const hook = path.join(HERE, '..', 'mcp-cap-hook.mjs')
  const call = (key, caseCap, dailyCap) => spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: 'mcp__redpanda__ask_redpanda_question' }),
    env: Object.assign({}, process.env, { EVAL_MCP_LEDGER: ledger, EVAL_MCP_CASE_KEY: key, EVAL_MCP_CASE_CAP: String(caseCap), EVAL_MCP_DAILY_CAP: String(dailyCap) }),
    encoding: 'utf8',
  })
  assert.equal(call('run:A', 1, 3).status, 0)
  assert.equal(call('run:A', 1, 3).status, 2, 'second call in one case')
  assert.equal(call('run:B', 1, 3).status, 0)
  assert.equal(call('run:C', 1, 2).status, 2, 'daily cap')
  assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8')).length, 2)
  const unset = spawnSync(process.execPath, [hook], { input: '{}', env: Object.assign({}, process.env, { EVAL_MCP_LEDGER: '' }), encoding: 'utf8' })
  assert.equal(unset.status, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

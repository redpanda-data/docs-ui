#!/usr/bin/env node
/**
 * PreToolUse hook that caps calls to the docs MCP server's tools, so the eval
 * suite stays inside the anonymous allowance (10 tool calls every 24 hours
 * per network address). run.mjs passes it to claude through --settings.
 *
 * Every allowed call is appended to the ledger. A call is blocked (exit 2,
 * which claude shows the agent as the tool's error) when this case already
 * made EVAL_MCP_CASE_CAP calls, or the ledger holds EVAL_MCP_DAILY_CAP calls
 * in the last 24 hours.
 */
import fs from 'node:fs'

const ledgerPath = process.env.EVAL_MCP_LEDGER
const caseKey = process.env.EVAL_MCP_CASE_KEY || 'unknown'
const caseCap = Number(process.env.EVAL_MCP_CASE_CAP || 1)
const dailyCap = Number(process.env.EVAL_MCP_DAILY_CAP || 9)

let input = ''
process.stdin.on('data', (d) => { input += d })
process.stdin.on('end', () => {
  let tool = ''
  try { tool = JSON.parse(input).tool_name || '' } catch (e) { /* not JSON */ }
  if (!ledgerPath) {
    process.stderr.write('EVAL_MCP_LEDGER is not set, so docs MCP calls are blocked in this eval.\n')
    process.exit(2)
  }
  let ledger = []
  try { ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) } catch (e) { ledger = [] }
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  const today = ledger.filter((e) => Date.parse(e.ts) > dayAgo)
  const mine = ledger.filter((e) => e.case === caseKey)
  if (mine.length >= caseCap || today.length >= dailyCap) {
    process.stderr.write(`The docs MCP call cap for this eval is reached (${mine.length}/${caseCap} for this case, ${today.length}/${dailyCap} in 24 hours). Continue without the docs MCP server.\n`)
    process.exit(2)
  }
  ledger.push({ ts: new Date().toISOString(), case: caseKey, tool })
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
  process.exit(0)
})

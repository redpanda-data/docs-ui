const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const handlebars = require('handlebars')
const hasAgentHandoff = require('../../src/helpers/has-agent-handoff')
const agentHandoffMode = require('../../src/helpers/agent-handoff-mode')

const partial = fs.readFileSync(
  path.join(__dirname, '../../src/partials/markdown-dropdown.hbs'),
  'utf8'
)

handlebars.registerHelper('has-markdown', () => true)
handlebars.registerHelper('has-agent-handoff', hasAgentHandoff)
handlebars.registerHelper('agent-handoff-mode', agentHandoffMode)

const renderDropdown = handlebars.compile(partial)

test('renders the agent handoff action only for pages that opt in', () => {
  const disabled = renderDropdown({ page: { attributes: {} } })
  const enabled = renderDropdown({
    page: {
      attributes: { 'agent-handoff': '' },
      component: { name: 'agentic-data-plane' },
    },
  })

  assert.doesNotMatch(disabled, /data-action="copy-agent"/)
  assert.match(enabled, /data-action="copy-agent"/)
  assert.match(enabled, /data-component-name="agentic-data-plane"/)
})

test('defaults the agent handoff mode to "project" and carries an explicit "ui" mode through', () => {
  const defaulted = renderDropdown({
    page: {
      attributes: { 'agent-handoff': '' },
      component: { name: 'agentic-data-plane' },
    },
  })
  const uiMode = renderDropdown({
    page: {
      attributes: { 'agent-handoff': 'ui' },
      component: { name: 'streaming' },
    },
  })

  assert.match(defaulted, /data-agent-handoff-mode="project"/)
  assert.match(uiMode, /data-agent-handoff-mode="ui"/)
})

test('omits the mode attribute entirely on pages that never opted into agent handoff', () => {
  const disabled = renderDropdown({ page: { attributes: {} } })

  assert.doesNotMatch(disabled, /data-agent-handoff-mode/)
})

test('agent-handoff-mode normalizes case and whitespace, defaulting to "project"', () => {
  const helperArgs = (value) => ({ data: { root: { page: { attributes: { 'agent-handoff': value } } } } })

  assert.equal(agentHandoffMode({ data: { root: { page: { attributes: {} } } } }), 'project')
  assert.equal(agentHandoffMode(helperArgs('')), 'project')
  assert.equal(agentHandoffMode(helperArgs('UI')), 'ui')
  assert.equal(agentHandoffMode(helperArgs(' Ui ')), 'ui')
  assert.equal(agentHandoffMode(helperArgs('console')), 'console')
})

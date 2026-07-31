const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const handlebars = require('handlebars')
const hasAgentHandoff = require('../../src/helpers/has-agent-handoff')

const partial = fs.readFileSync(
  path.join(__dirname, '../../src/partials/markdown-dropdown.hbs'),
  'utf8'
)

handlebars.registerHelper('has-markdown', () => true)
handlebars.registerHelper('has-agent-handoff', hasAgentHandoff)

const renderDropdown = handlebars.compile(partial)

test('renders the agent handoff action only for pages that opt in', () => {
  const disabled = renderDropdown({ page: { attributes: {} } })
  const enabled = renderDropdown({
    page: { attributes: { 'agent-handoff': '' } },
  })

  assert.doesNotMatch(disabled, /data-action="copy-agent"/)
  assert.match(enabled, /data-action="copy-agent"/)
})

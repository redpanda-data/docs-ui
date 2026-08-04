const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const {
  buildAgentHandoffPrompt,
  extractMarkdownSection,
} = require('../../src/js/13-agent-handoff')

const markdown = `# Draw charts

Page introduction.

## [](#chart-contract)Chart contract

Use a \`chart\` fence.

## [](#migrate-chart-js-prompt)Migrate from Chart.js

Keep bar and line charts.

### [](#verification)Verify the migration

Run the chart test.

## [](#troubleshooting)Troubleshooting

Review the rendered error.`

test('extractMarkdownSection returns the anchored section and its children', () => {
  const section = extractMarkdownSection(markdown, '#migrate-chart-js-prompt')

  assert.equal(
    section,
    `## [](#migrate-chart-js-prompt)Migrate from Chart.js

Keep bar and line charts.

### [](#verification)Verify the migration

Run the chart test.`
  )
})

test('extractMarkdownSection maps generated AsciiDoc IDs to Markdown anchors', () => {
  const generatedAnchorMarkdown = `# Run Claude Code and Codex

## [](#run-codex)Run Codex

Run Codex through AI Gateway.

## [](#make-it-a-shortcut)Make it a shortcut`

  assert.equal(
    extractMarkdownSection(generatedAnchorMarkdown, '#_run_codex'),
    `## [](#run-codex)Run Codex

Run Codex through AI Gateway.`
  )
})

test('extractMarkdownSection falls back to the full page without a matching anchor', () => {
  assert.equal(extractMarkdownSection(markdown, '#missing'), markdown)
  assert.equal(extractMarkdownSection(markdown, ''), markdown)
})

test('extractMarkdownSection ignores heading-like lines inside fenced code blocks', () => {
  const fencedMarkdown = `# Draw charts

\`\`\`text
## [](#migrate-chart-js-prompt)Not the section heading
\`\`\`

## [](#migrate-chart-js-prompt)Migrate from Chart.js

Keep bar and line charts.

\`\`\`yaml
# This comment is not a heading
type: bar
\`\`\`

### [](#verification)Verify the migration

Run the chart test.

## [](#troubleshooting)Troubleshooting`

  assert.equal(
    extractMarkdownSection(fencedMarkdown, '#migrate-chart-js-prompt'),
    `## [](#migrate-chart-js-prompt)Migrate from Chart.js

Keep bar and line charts.

\`\`\`yaml
# This comment is not a heading
type: bar
\`\`\`

### [](#verification)Verify the migration

Run the chart test.`
  )
})

test('buildAgentHandoffPrompt copies actionable context and canonical sources', () => {
  const prompt = buildAgentHandoffPrompt({
    docsOrigin: 'https://docs.redpanda.com',
    markdown,
    markdownUrl:
      'https://docs.redpanda.com/agentic-data-plane/connect/draw-charts.md',
    pageTitle: 'Draw charts',
    pageUrl:
      'https://docs.redpanda.com/agentic-data-plane/connect/draw-charts/#migrate-chart-js-prompt',
    sectionAnchor: '#migrate-chart-js-prompt',
    sectionTitle: 'Migrate from Chart.js',
  })

  assert.equal(
    prompt,
    `# Apply this Redpanda documentation

Work in the current project. Determine whether this guidance applies, then make the smallest safe update that keeps the project aligned with the current Redpanda pattern.

## Scope

- Documentation page: Draw charts
- Current section: Migrate from Chart.js
- Page: https://docs.redpanda.com/agentic-data-plane/connect/draw-charts/#migrate-chart-js-prompt
- Markdown source: https://docs.redpanda.com/agentic-data-plane/connect/draw-charts.md

## Authoritative Redpanda context

- Documentation index: https://docs.redpanda.com/llms.txt
- Documentation MCP server: https://docs.redpanda.com/mcp

## Instructions

1. Read the current project's agent and contributor instructions before changing anything.
2. Inspect the project and identify where this documentation applies. Do not invent Redpanda commands, fields, or behavior.
3. If applicable, implement the smallest reversible change and preserve unrelated behavior. If not applicable, explain why and stop.
4. You may edit and test local files. Before destructive operations, external mutations, or changes to a live Redpanda environment, show the plan or diff and get my confirmation. Never expose credentials or secrets.
5. Run the project's relevant checks and any documented Redpanda validation or diff command.
6. Summarize the changes, verification, remaining manual steps, and any missing or conflicting documentation.

## Documentation context

--- BEGIN CURRENT DOCUMENTATION ---
## [](#migrate-chart-js-prompt)Migrate from Chart.js

Keep bar and line charts.

### [](#verification)Verify the migration

Run the chart test.
--- END CURRENT DOCUMENTATION ---`
  )
})

test('buildAgentHandoffPrompt uses the UI instruction set for pages opted into "ui" mode', () => {
  const prompt = buildAgentHandoffPrompt({
    docsOrigin: 'https://docs.redpanda.com',
    markdown: '# Manage topics\n\nCreate and delete topics from the console.',
    markdownUrl: 'https://docs.redpanda.com/streaming/current/console/manage-topics.md',
    mode: 'ui',
    pageTitle: 'Manage topics',
    pageUrl: 'https://docs.redpanda.com/streaming/current/console/manage-topics/',
  })

  assert.match(prompt, /Complete this documented task in the current console, cluster, or account\./)
  assert.match(prompt, /1\. Confirm the current console, cluster, or account matches this documentation/)
  assert.doesNotMatch(prompt, /Read the current project's agent and contributor instructions/)
})

test('buildAgentHandoffPrompt falls back to the project instruction set for an unrecognized mode', () => {
  const prompt = buildAgentHandoffPrompt({
    docsOrigin: 'https://docs.redpanda.com',
    markdown: '# Configure a provider',
    markdownUrl: 'https://docs.redpanda.com/agentic-data-plane/gateway/configure-provider.md',
    mode: 'not-a-real-mode',
    pageTitle: 'Configure a provider',
    pageUrl: 'https://docs.redpanda.com/agentic-data-plane/gateway/configure-provider/',
  })

  assert.match(prompt, /Work in the current project\./)
})

test('buildAgentHandoffPrompt derives the component export without parsing footer copy', () => {
  const prompt = buildAgentHandoffPrompt({
    componentName: 'agentic-data-plane',
    docsOrigin: 'https://docs.redpanda.com',
    markdown: `> Browse the complete documentation index in llms.txt.

# Configure a provider`,
    markdownUrl:
      'https://docs.redpanda.com/agentic-data-plane/gateway/configure-provider.md',
    pageTitle: 'Configure a provider',
    pageUrl:
      'https://docs.redpanda.com/agentic-data-plane/gateway/configure-provider/',
  })

  assert.match(
    prompt,
    /- Component documentation export: https:\/\/docs\.redpanda\.com\/agentic-data-plane-full\.txt/
  )
})

test('markdown dropdown loads when the optional agent handoff module is unavailable', () => {
  const dropdownScript = fs.readFileSync(
    path.join(__dirname, '../../src/js/14-markdown-dropdown.js'),
    'utf8'
  )
  const documentListeners = new Map()

  assert.doesNotThrow(() => {
    vm.runInNewContext(dropdownScript, {
      console,
      document: {
        addEventListener: (event, listener) => documentListeners.set(event, listener),
        readyState: 'loading',
      },
      setTimeout,
      URL,
      window: {},
    })
  })
  assert.equal(typeof documentListeners.get('DOMContentLoaded'), 'function')
})

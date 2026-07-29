const assert = require('node:assert/strict')
const test = require('node:test')

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

test('extractMarkdownSection falls back to the full page without a matching anchor', () => {
  assert.equal(extractMarkdownSection(markdown, '#missing'), markdown)
  assert.equal(extractMarkdownSection(markdown, ''), markdown)
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

test('buildAgentHandoffPrompt includes the component export advertised by the page', () => {
  const prompt = buildAgentHandoffPrompt({
    docsOrigin: 'https://docs.redpanda.com',
    markdown: `> Component-specific: [agentic-data-plane-full.txt](https://docs.redpanda.com/agentic-data-plane-full.txt)

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

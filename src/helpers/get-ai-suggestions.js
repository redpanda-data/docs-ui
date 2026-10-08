'use strict'

/**
 * Gets AI suggestion questions for the chat drawer
 *
 * Reads component-level asciidoc attributes:
 * - ai-suggestion-1, ai-suggestion-2, ai-suggestion-3, ai-suggestion-4
 *
 * Falls back to default suggestions if component doesn't define any.
 *
 * Usage in templates:
 *   {{#each (get-ai-suggestions)}}
 *     "{{this}}"{{#unless @last}},{{/unless}}
 *   {{/each}}
 *
 * @param {object} options - Handlebars options with data.root.page.component
 * @returns {array} Array of suggestion strings (up to 4)
 */
module.exports = function (options) {
  const { page } = options.data.root

  // Default suggestions if none are defined
  const defaults = [
    'How do I build my first agent?',
    'Set up MCP with Postgres',
    'Rotate an API key safely',
    "What's a token budget?",
  ]

  // Components whose readers the agent-centric defaults do not fit, used
  // when the component sets no ai-suggestion-* attributes of its own.
  const byComponent = {
    solutions: [
      'Which solution should I start with?',
      'How do I run a solution on Redpanda Cloud?',
      'What changes when I take a solution to production?',
      'Which Redpanda features does each solution use?',
    ],
  }
  const fallback = (page && page.component && byComponent[page.component.name]) || defaults

  // Try to get component-specific suggestions
  if (!page || !page.component || !page.component.asciidoc || !page.component.asciidoc.attributes) {
    return fallback
  }

  const attrs = page.component.asciidoc.attributes
  const suggestions = []

  // Collect up to 4 suggestions from component attributes
  for (let i = 1; i <= 4; i++) {
    const key = `ai-suggestion-${i}`
    if (attrs[key]) {
      suggestions.push(attrs[key])
    }
  }

  // Return component suggestions if any were found, otherwise the fallback
  return suggestions.length > 0 ? suggestions : fallback
}

'use strict'

/**
 * Agent example prompts for the SIGNED-IN Ask AI drawer (the agent tier).
 *
 * Parallel to get-ai-suggestions.js, but these are written to showcase the
 * agent's client tools (run Bloblang, navigate, switch product, look up a
 * config property, latest version, open Cloud) in the context of the current
 * product — not the generic Q&A prompts the anonymous widget shows.
 *
 * Reads component-level asciidoc attributes first (author override):
 *   agent-suggestion-1 … agent-suggestion-4
 * Falls back to per-component defaults, then to a generic tool-showcasing set.
 *
 * Usage in templates:
 *   {{#each (get-agent-suggestions)}}
 *     "{{{this}}}"{{#unless @last}},{{/unless}}
 *   {{/each}}
 *
 * @param {object} options - Handlebars options with data.root.page
 * @returns {string[]} Up to 4 example prompts
 */
module.exports = function (options) {
  const { page } = options.data.root

  // Tool-showcasing defaults per component. Keyed by component name so each
  // product leads with the tools that matter there. Config-property prompts
  // (log_segment_size) appear ONLY under Self-Managed/Streaming: the property
  // reference (redpanda-properties.json) is Self-Managed, so a "default value"
  // prompt would be misleading on Cloud, which abstracts that config away.
  const byComponent = {
    'agentic-data-plane': [
      'Take me to the Agentic Data Plane quickstart',
      "What's the latest Redpanda version?",
      'Write and test a Bloblang mapping for my data',
    ],
    'cloud-data-platform': [
      'Open the page in Redpanda Cloud where I create a cluster',
      "What's the latest Redpanda version?",
      'Take me to the Cloud getting-started guide',
    ],
    'data-platform': [
      "What's the latest Redpanda version?",
      'Take me to the right quickstart for my setup',
      'Open Redpanda Cloud',
    ],
    'self-managed': [
      "What's the default value of log_segment_size, and does it need a restart?",
      'Take me to the Kubernetes deployment guide',
      'Switch to the Redpanda Cloud docs',
    ],
    streaming: [
      'Write and test a Bloblang mapping that flattens nested JSON',
      "What's the default value of log_segment_size?",
      'Take me to the Redpanda quickstart',
    ],
    connect: [
      'Write and test a Bloblang mapping that flattens nested JSON',
      'Open the Bloblang playground with a sample mapping',
      'Take me to the Redpanda Connect quickstart',
    ],
  }

  const generic = [
    'Write and test a Bloblang mapping that flattens nested JSON',
    "What's the latest Redpanda version?",
    'Take me to the right quickstart for my setup',
  ]

  // Author override via component attributes takes priority.
  if (page && page.component && page.component.asciidoc && page.component.asciidoc.attributes) {
    const attrs = page.component.asciidoc.attributes
    const authored = []
    for (let i = 1; i <= 4; i++) {
      if (attrs[`agent-suggestion-${i}`]) authored.push(attrs[`agent-suggestion-${i}`])
    }
    if (authored.length > 0) return authored
  }

  const name = page && page.component && page.component.name
  return byComponent[name] || generic
}

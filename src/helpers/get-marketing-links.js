'use strict'

/**
 * Marketing calls to action for the docs landing pages and Ask AI (DOC-2607).
 *
 * This file is the only place the link text and URLs live. The landing-page
 * help box (partials/help-cta.hbs) and the Ask AI drawer (chat-panel.hbs and
 * chat-panel-bump.hbs, read by the React app) both come from it, so changing
 * a URL or adding a landing page is a one-line edit here.
 *
 * Antora compiles each helper in isolation, so the data stays in this file
 * rather than a sibling module: a sibling require fails at page composition.
 *
 * Usage in templates:
 *   {{#with (get-marketing-links)}} ... {{/with}}
 *     The help box for the current page's component: { heading, lead, links }.
 *     Components with no entry in PAGES get the community-only default.
 *   {{{get-marketing-links 'kapa-json'}}}
 *     The links Ask AI offers for sales questions, as script-safe JSON.
 */

const LINKS = {
  demo: { text: 'Book a demo', url: 'https://www.redpanda.com/demo' },
  contact: { text: 'Talk to us', url: 'https://www.redpanda.com/contact' },
  getStarted: { text: 'Get started', url: 'https://www.redpanda.com/get-started' },
  pricing: { text: 'Estimate pricing', url: 'https://www.redpanda.com/data-streaming/price-estimator' },
  cloudSignup: { text: 'Sign up for Redpanda Cloud', url: 'https://cloud.redpanda.com/sign-up' },
  adpDemo: { text: 'Watch the demo', url: 'https://www.redpanda.com/agentic-data-plane-demo' },
  tryRedpanda: { text: 'Try Redpanda', url: 'https://www.redpanda.com/try-data-streaming' },
  enterprise: { text: 'Ask about Enterprise Edition', url: 'https://www.redpanda.com/contact' },
  community: { text: 'Join the community', url: 'https://redpanda.com/slack' },
}

const SALES = {
  heading: 'Talk to the Redpanda team',
  lead: 'Questions about pricing, licensing, or which deployment fits your workload? We can help.',
}

// Antora component name -> marketing links on that component's landing page,
// in display order. The first is the primary button only when the box has no
// Ask Redpanda AI button (the data-platform layout); otherwise Ask AI is primary.
const PAGES = {
  'data-platform': ['demo', 'contact', 'getStarted'],
  'cloud-data-platform': ['cloudSignup', 'pricing', 'contact'],
  'agentic-data-plane': ['adpDemo', 'demo', 'contact'],
  streaming: ['tryRedpanda', 'enterprise', 'pricing'],
}

// Help box for components with no entry in PAGES: the pre-DOC-2607 text.
const DEFAULT = {
  heading: 'Need a hand?',
  lead: 'Ask Redpanda AI, search the docs, or talk to a real human in Slack.',
  links: [],
}

// Links Ask AI offers when someone asks about pricing, licensing, or a demo.
const KAPA = ['contact', 'demo']

function scriptSafeJson (value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

module.exports = function (...args) {
  const options = args.pop()
  const mode = typeof args[0] === 'string' ? args[0] : ''

  if (mode === 'kapa-json') return scriptSafeJson(KAPA.map((key) => LINKS[key]))

  const root = (options && options.data && options.data.root) || {}
  const component = root.page && root.page.component && root.page.component.name
  const keys = PAGES[component]
  const box = keys ? { ...SALES, links: keys.map((key) => LINKS[key]) } : DEFAULT
  // Every landing page keeps the community link last, after any marketing links.
  return { ...box, links: box.links.concat(LINKS.community) }
}

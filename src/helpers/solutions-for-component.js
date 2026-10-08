'use strict'

/**
 * Up to three catalog records for a product's component home page, for the
 * "Build it in practice" section when the page names no solutions of its own
 * and the extension wrote no page-related-solutions for it.
 *
 * A record matches the component when it runs on that product:
 *   ROOT, streaming, self-managed     platforms includes 'self-managed'
 *   cloud-data-platform, cloud        platforms includes 'cloud'
 *   connect, redpanda-connect         technologies includes 'Redpanda Connect'
 * Any other component gets none. Deprecated records never match. The records
 * come in catalog order (featured first, then newest), which is kept.
 *
 * Usage:
 *   {{#with (get-solutions-catalog) as |catalog|}}
 *     {{#each (solutions-for-component catalog.all @root.page.component.name)}}...{{/each}}
 *   {{/with}}
 */
const BY_COMPONENT = {
  ROOT: { platform: 'self-managed' },
  streaming: { platform: 'self-managed' },
  'self-managed': { platform: 'self-managed' },
  'cloud-data-platform': { platform: 'cloud' },
  cloud: { platform: 'cloud' },
  connect: { technology: 'Redpanda Connect' },
  'redpanda-connect': { technology: 'Redpanda Connect' },
}

const MAX = 3

module.exports = function (records, componentName) {
  const rule = typeof componentName === 'string' ? BY_COMPONENT[componentName] : undefined
  if (!rule || !Array.isArray(records)) return []
  return records
    .filter((r) => r && r.status !== 'deprecated')
    .filter((r) => (rule.platform
      ? Array.isArray(r.platforms) && r.platforms.indexOf(rule.platform) !== -1
      : Array.isArray(r.technologies) && r.technologies.indexOf(rule.technology) !== -1))
    .slice(0, MAX)
}

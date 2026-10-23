'use strict'

/**
 * Up to three catalog records for a product's component home page, for the
 * "Build it in practice" section when the page names no solutions of its own
 * and the extension wrote no page-related-solutions for it.
 *
 * A record matches the component when it runs on that product. With the
 * catalog's `taxonomy` (the docs taxonomy summary solutions-catalog writes),
 * a component that a technology concept names as its `component` (connect is
 * Redpanda Connect) matches records whose `concepts.technologies` carry that
 * concept, or, for a record without concepts, whose technologies list its
 * label. Otherwise the component's platform decides:
 *   ROOT, streaming, self-managed     platform docker (authored as self-managed)
 *   cloud-data-platform, cloud        platform cloud
 * matched by `concepts.platforms` ID, or by the authored value for a record
 * without concepts.
 *
 * A catalog built before the taxonomy has no `taxonomy`. Then the old rules
 * apply, and connect and redpanda-connect match the technology string
 * 'Redpanda Connect'.
 *
 * Any other component gets none. Deprecated records never match. The records
 * come in catalog order (featured first, then newest), which is kept.
 *
 * Usage:
 *   {{#with (get-solutions-catalog) as |catalog|}}
 *     {{#each (solutions-for-component catalog.all @root.page.component.name catalog.taxonomy)}}...{{/each}}
 *   {{/with}}
 */
const BY_PLATFORM = {
  ROOT: { id: 'docker', values: ['self-managed', 'docker'] },
  streaming: { id: 'docker', values: ['self-managed', 'docker'] },
  'self-managed': { id: 'docker', values: ['self-managed', 'docker'] },
  'cloud-data-platform': { id: 'cloud', values: ['cloud'] },
  cloud: { id: 'cloud', values: ['cloud'] },
}

// Fallback for a catalog without `taxonomy` only.
const LEGACY_TECHNOLOGY = {
  connect: 'Redpanda Connect',
  'redpanda-connect': 'Redpanda Connect',
}

const MAX = 3

const list = (value) => (Array.isArray(value) ? value : [])

function conceptIds (record, facet) {
  const concepts = record.concepts && record.concepts[facet]
  return Array.isArray(concepts) ? concepts.map((c) => c && c.id) : null
}

function ruleFor (componentName, taxonomy) {
  if (typeof componentName !== 'string') return undefined
  const hasTaxonomy = Boolean(taxonomy && Array.isArray(taxonomy.technologies))
  if (hasTaxonomy) {
    const tech = taxonomy.technologies.find((t) => t && t.component === componentName)
    if (tech) return { technology: { id: tech.id, label: tech.label } }
  } else if (LEGACY_TECHNOLOGY[componentName]) {
    return { technology: { label: LEGACY_TECHNOLOGY[componentName] } }
  }
  const platform = BY_PLATFORM[componentName]
  return platform ? { platform } : undefined
}

function matches (record, rule) {
  if (rule.technology) {
    const ids = conceptIds(record, 'technologies')
    if (ids && rule.technology.id) return ids.indexOf(rule.technology.id) !== -1
    return list(record.technologies).indexOf(rule.technology.label) !== -1
  }
  const ids = conceptIds(record, 'platforms')
  if (ids) return ids.indexOf(rule.platform.id) !== -1
  return list(record.platforms).some((p) => rule.platform.values.indexOf(p) !== -1)
}

module.exports = function (records, componentName, taxonomy) {
  const rule = ruleFor(componentName, taxonomy)
  if (!rule || !Array.isArray(records)) return []
  return records
    .filter((r) => r && r.status !== 'deprecated')
    .filter((r) => matches(r, rule))
    .slice(0, MAX)
}

'use strict'

/**
 * Reads the solutions catalog that the solutions-catalog extension writes at
 * build time as the `solutions-catalog` attribute on the `solutions` component
 * version (the same JSON it publishes at /assets/data/solutions.json).
 *
 * Usage:
 *   {{#with (get-solutions-catalog) as |catalog|}}
 *     {{#each catalog.all}}{{> solution-card solution=this}}{{/each}}
 *   {{/with}}
 *
 * Returns null when no catalog is present so callers can render nothing. The
 * lookup order is the `solutions` component (latest version first), then the
 * current page's component version, then a `page-solutions-catalog` page
 * attribute, which only the UI preview fixtures use.
 *
 * Shape of the result:
 *   {
 *     generatedAt, siteUrl,
 *     all:       every record, featured first, then newest, then by title;
 *                deprecated records sort last
 *     featured:  published records flagged featured
 *     recent:    up to 6 published records by lastModified desc
 *     facets:    { categories, technologies, difficulty, platforms }, each an
 *                array of {value, count} (the extension's shape; plain string
 *                arrays are accepted and counted from the records)
 *     count:     all.length
 *     json:      the catalog serialized for a <script type="application/json">
 *                block (`</` is escaped so it cannot close the script tag)
 *   }
 */

const ATTRIBUTE = 'solutions-catalog'
const DIFFICULTY_ORDER = ['beginner', 'intermediate', 'advanced']

function versionAttributes (version) {
  return version && version.asciidoc && version.asciidoc.attributes
}

function findSolutionsComponent (site) {
  if (!site || !site.components) return undefined
  const components = site.components
  if (typeof components.get === 'function') return components.get('solutions')
  if (Array.isArray(components)) return components.find((c) => c && c.name === 'solutions')
  if (components.solutions) return components.solutions
  return Object.values(components).find((c) => c && c.name === 'solutions')
}

function findRawCatalog (root) {
  const { site, page } = root || {}
  const candidates = []
  const component = findSolutionsComponent(site)
  if (component) {
    candidates.push(versionAttributes(component.latest))
    candidates.push(versionAttributes(component.latestVersion))
    ;(component.versions || []).forEach((version) => candidates.push(versionAttributes(version)))
  }
  if (page) {
    candidates.push(versionAttributes(page.componentVersion))
    candidates.push(page.attributes)
  }
  for (const attributes of candidates) {
    if (attributes && attributes[ATTRIBUTE]) return attributes[ATTRIBUTE]
  }
  return null
}

function parseCatalog (raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (e) {
    return null
  }
}

function toArray (value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

function normalizeRecord (record) {
  const steps = toArray(record.steps).slice().sort((a, b) => (a.order || 0) - (b.order || 0))
  return Object.assign({}, record, {
    status: record.status || 'published',
    featured: record.featured === true || record.featured === 'true',
    platforms: toArray(record.platforms),
    technologies: toArray(record.technologies),
    categories: toArray(record.categories),
    steps,
    stepCount: steps.length,
    attachments: toArray(record.attachments),
    relatedDocs: toArray(record.relatedDocs),
    relatedSolutions: toArray(record.relatedSolutions),
  })
}

function byModifiedDesc (a, b) {
  const am = Date.parse(a.lastModified) || 0
  const bm = Date.parse(b.lastModified) || 0
  return bm - am
}

function sortAll (a, b) {
  const aDeprecated = a.status === 'deprecated' ? 1 : 0
  const bDeprecated = b.status === 'deprecated' ? 1 : 0
  if (aDeprecated !== bDeprecated) return aDeprecated - bDeprecated
  if (a.featured !== b.featured) return a.featured ? -1 : 1
  const modified = byModifiedDesc(a, b)
  if (modified) return modified
  return String(a.title || '').localeCompare(String(b.title || ''))
}

// Facets. The solutions-catalog extension publishes each facet as an array of
// `{value, count}` objects (`facets.categories = [{value: 'Clients', count: 1},
// ...]`). Older or hand-written catalogs may use plain string arrays; both
// normalize to `[{value, count}]`, with counts derived from the published
// records when the input has none.
function countValues (records, key) {
  const counts = new Map()
  records.forEach((record) => toArray(record[key]).forEach((value) => {
    if (!value) return
    counts.set(String(value), (counts.get(String(value)) || 0) + 1)
  }))
  return counts
}

function normalizeFacet (input, records, key) {
  const counts = countValues(records, key)
  const items = toArray(input)
    .map((item) => {
      if (item && typeof item === 'object') {
        const value = item.value !== undefined ? item.value : item.name
        if (value === undefined || value === null || value === '') return null
        const count = Number(item.count)
        return { value: String(value), count: isFinite(count) ? count : counts.get(String(value)) || 0 }
      }
      if (item === undefined || item === null || item === '') return null
      return { value: String(item), count: counts.get(String(item)) || 0 }
    })
    .filter(Boolean)
  if (items.length) return items
  return Array.from(counts.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, count: counts.get(value) }))
}

function normalizeFacets (facets, records) {
  facets = facets && typeof facets === 'object' ? facets : {}
  return {
    categories: normalizeFacet(facets.categories, records, 'categories'),
    technologies: normalizeFacet(facets.technologies, records, 'technologies'),
    difficulty: normalizeFacet(facets.difficulty, records, 'difficulty')
      .slice()
      .sort((a, b) => DIFFICULTY_ORDER.indexOf(a.value) - DIFFICULTY_ORDER.indexOf(b.value)),
    platforms: normalizeFacet(facets.platforms, records, 'platforms'),
  }
}

module.exports = function () {
  const options = arguments[arguments.length - 1]
  const root = options && options.data && options.data.root
  const catalog = parseCatalog(findRawCatalog(root))
  if (!catalog) return null

  const all = toArray(catalog.solutions).filter((r) => r && r.id).map(normalizeRecord).sort(sortAll)
  const published = all.filter((r) => r.status === 'published')
  const facets = normalizeFacets(catalog.facets, published)

  return {
    generatedAt: catalog.generatedAt || null,
    siteUrl: catalog.siteUrl || null,
    all,
    featured: published.filter((r) => r.featured),
    recent: published.slice().sort(byModifiedDesc).slice(0, 6),
    facets,
    count: all.length,
    json: JSON.stringify({ generatedAt: catalog.generatedAt || null, solutions: all, facets }).replace(/<\//g, '<\\/'),
  }
}

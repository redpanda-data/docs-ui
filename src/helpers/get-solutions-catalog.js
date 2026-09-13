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
 *     facets:    { categories, technologies, difficulty, platforms } (arrays)
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

function collect (records, key) {
  const seen = new Set()
  records.forEach((record) => toArray(record[key]).forEach((value) => value && seen.add(String(value))))
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

function normalizeFacets (facets, records) {
  facets = facets && typeof facets === 'object' ? facets : {}
  const difficulty = toArray(facets.difficulty).length
    ? toArray(facets.difficulty)
    : collect(records, 'difficulty')
  return {
    categories: toArray(facets.categories).length ? toArray(facets.categories) : collect(records, 'categories'),
    technologies: toArray(facets.technologies).length ? toArray(facets.technologies) : collect(records, 'technologies'),
    difficulty: difficulty.slice().sort((a, b) => DIFFICULTY_ORDER.indexOf(a) - DIFFICULTY_ORDER.indexOf(b)),
    platforms: toArray(facets.platforms).length ? toArray(facets.platforms) : collect(records, 'platforms'),
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

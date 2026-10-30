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
 *     facets:    { useCases, industries, categories, technologies,
 *                platforms }, each an
 *                array of {value, count} (the extension's shape; plain string
 *                arrays are accepted and counted from the records)
 *     count:     all.length
 *     universalTechnologies: technologies every record carries (only with
 *                two or more records). Card chips skip them: "Redpanda" on
 *                every card tells the reader nothing.
 *     all[].chipTechnologies: the record's technologies minus the universal
 *                ones, rarest first; what card chips show
 *     chipsById: the same lists by solution id, for recommendation entries,
 *                which come from page-related-solutions rather than the
 *                catalog
 *     taxonomy:  the catalog's `taxonomy` summary (platform and technology
 *                concepts of the docs taxonomy), or null for a catalog built
 *                before it; solutions-for-component reads it
 *     platformNames: reader-facing name of each platform value, by concept
 *                ID, altLabel ("self-managed" is Docker Compose), and authored
 *                value (from each record's `concepts.platforms`), or null
 *                when the catalog has neither; platform-name, platform-list,
 *                and format-verified-evidence take it as `names=` and fall
 *                back to their own map without it
 *     json:      the records projected to the fields 29-solutions-home.js
 *                reads, for a <script type="application/json"> block (`</`
 *                is escaped so it cannot close the script tag)
 *   }
 */

const ATTRIBUTE = 'solutions-catalog'

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
    useCases: toArray(record.useCases),
    industries: toArray(record.industries),
    steps,
    stepCount: steps.length,
    files: toArray(record.files),
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
  // An empty array that the catalog actually carries is a decision, not a
  // gap: the extension drops a facet whose values match every solution,
  // because filtering on it narrows nothing. Recounting from the records here
  // would put that group straight back. Only an absent facet is derived,
  // which is the case a hand-written or older catalog has.
  if (Array.isArray(input)) return []
  return Array.from(counts.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, count: counts.get(value) }))
}

// Use case and industry have no natural order, so the
// busiest value goes first: it is the one most readers are looking for. Ties
// fall back to alphabetical so the order is stable between builds.
function byCountThenName (items) {
  return items.slice().sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value))
}

function normalizeFacets (facets, records) {
  facets = facets && typeof facets === 'object' ? facets : {}
  return {
    useCases: byCountThenName(normalizeFacet(facets.useCases, records, 'useCases')),
    industries: byCountThenName(normalizeFacet(facets.industries, records, 'industries')),
    categories: normalizeFacet(facets.categories, records, 'categories'),
    technologies: normalizeFacet(facets.technologies, records, 'technologies'),
    platforms: platformFacet(records),
  }
}

// Runs on lists every platform a solution runs on, even one every solution
// runs on. Unlike the other groups it is a statement of support as much as a
// filter: a reader looking for Kubernetes or Docker Compose should see it
// offered, though ticking it narrows nothing today. So it is always counted
// from the records, not taken from the extension's facet, which drops values
// held by every solution.
const PLATFORM_ORDER = ['self-managed', 'docker', 'kubernetes', 'cloud']

function platformFacet (records) {
  const counts = countValues(records, 'platforms')
  // Local first, then Kubernetes, then Cloud; anything else after, by name.
  const rank = (v) => { const i = PLATFORM_ORDER.indexOf(v); return i === -1 ? PLATFORM_ORDER.length : i }
  return Array.from(counts.keys())
    .sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b))
    .map((value) => ({ value, count: counts.get(value) }))
}

// Technologies a card chip should skip: the ones every record carries. When
// the catalog publishes a technologies facet, that list already left out
// every value held by all records (outputs.js discriminating()), so a value
// on a record but absent from the facet is universal. Otherwise intersect
// over every record. Computed over `all`, not only published records: a
// catalog whose records are all drafts (a preview) still has a Redpanda on
// every card that says nothing.
function universalOf (all, publishedFacet) {
  if (all.length < 2) return []
  const seen = []
  all.forEach((r) => r.technologies.forEach((t) => { if (seen.indexOf(t) === -1) seen.push(t) }))
  if (Array.isArray(publishedFacet) && publishedFacet.length) {
    const listed = publishedFacet.map((item) => String(item && typeof item === 'object' ? item.value : item))
    return seen.filter((t) => listed.indexOf(t) === -1)
  }
  return seen.filter((t) => all.every((r) => r.technologies.indexOf(t) !== -1))
}

// The fields 29-solutions-home.js reads from the embedded catalog, and
// nothing else: attachments, related docs, verification and the facets
// themselves are already on the page or unused there.
function projectForPage (record) {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    url: record.url,
    technologies: record.technologies,
    categories: record.categories,
    useCases: record.useCases,
    industries: record.industries,
    platforms: record.platforms,
    steps: record.steps.map((step) => ({ id: step.id, title: step.title, url: step.url })),
  }
}

// Card and recommendation chips: technologies minus the universal ones,
// rarest first (ties keep the authored order), so two solutions that share
// most of a stack still look different at a glance.
function chipsFor (technologies, universal, counts) {
  return toArray(technologies)
    .filter((t) => (universal || []).indexOf(t) === -1)
    .map((t, i) => ({ t, i, n: (counts && counts[t]) || 0 }))
    .sort((a, b) => (a.n - b.n) || (a.i - b.i))
    .map((x) => x.t)
}

// Names for platform values from the docs taxonomy: every deployment concept
// by ID and altLabel, then the authored value of each record's concepts (which
// wins, being what that record actually wrote). Null when the catalog carries
// neither, so the helpers use their own fallback map.
function platformNamesOf (taxonomy, records) {
  const names = {}
  let found = false
  const set = (key, label) => {
    if (typeof key !== 'string' || !key || typeof label !== 'string' || !label) return
    names[key] = label
    found = true
  }
  const platforms = taxonomy && Array.isArray(taxonomy.platforms) ? taxonomy.platforms : []
  platforms.forEach((p) => { if (p) toArray(p.altLabels).forEach((alt) => set(alt, p.label)) })
  platforms.forEach((p) => { if (p) set(p.id, p.label) })
  records.forEach((r) => {
    const items = r.concepts && Array.isArray(r.concepts.platforms) ? r.concepts.platforms : []
    items.forEach((item) => { if (item) set(item.value, item.label) })
  })
  return found ? names : null
}

let memo = { raw: undefined, result: null }

function build (catalog) {
  const all = toArray(catalog.solutions).filter((r) => r && r.id).map(normalizeRecord).sort(sortAll)
  const published = all.filter((r) => r.status === 'published')
  const facets = normalizeFacets(catalog.facets, published)
  const universalTechnologies = universalOf(all, catalog.facets && catalog.facets.technologies)
  const techCounts = countValues(all, 'technologies')

  const technologyCounts = {}
  techCounts.forEach((n, t) => { technologyCounts[t] = n })
  const chipsById = {}
  all.forEach((record) => {
    record.chipTechnologies = chipsFor(record.technologies, universalTechnologies, technologyCounts)
    chipsById[record.id] = record.chipTechnologies
  })

  const taxonomy = catalog.taxonomy && typeof catalog.taxonomy === 'object' ? catalog.taxonomy : null

  return {
    generatedAt: catalog.generatedAt || null,
    siteUrl: catalog.siteUrl || null,
    taxonomy,
    platformNames: platformNamesOf(taxonomy, all),
    universalTechnologies,
    chipsById,
    all,
    featured: published.filter((r) => r.featured),
    recent: published.slice().sort(byModifiedDesc).slice(0, 6),
    facets,
    count: all.length,
    json: JSON.stringify({ generatedAt: catalog.generatedAt || null, solutions: all.map(projectForPage) })
      .replace(/<\//g, '<\\/'),
  }
}

module.exports = function () {
  const options = arguments[arguments.length - 1]
  const root = options && options.data && options.data.root
  const raw = findRawCatalog(root)
  // Every card and recommendation asks for the catalog, so a page would
  // otherwise parse the same JSON once per card. Only a string attribute is
  // memoized; an object (the preview's YAML) is cheap to rebuild.
  if (typeof raw === 'string' && raw === memo.raw) return memo.result
  const catalog = parseCatalog(raw)
  const result = catalog ? build(catalog) : null
  if (typeof raw === 'string') memo = { raw, result }
  return result
}

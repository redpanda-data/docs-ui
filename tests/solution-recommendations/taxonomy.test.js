/**
 * Platform names and the component-to-technology match from the docs
 * taxonomy: the `taxonomy` summary and per-solution `concepts` that the
 * solutions-catalog extension writes into solutions.json. A catalog built
 * before the taxonomy has neither, and the helpers fall back to their own
 * maps.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const helper = (name) => require(path.join(ROOT, 'src/helpers', name + '.js'))

// The shape outputs.js buildTaxonomySummary writes. Labels differ from the
// fallback maps on purpose, so a test can tell which source a name came from.
const TAXONOMY = {
  source: 'https://docs.example.com/shared/_attachments/taxonomy.yml',
  platforms: [
    { id: 'cloud', label: 'Redpanda Cloud (managed)', altLabels: ['Cloud'], broader: null },
    { id: 'redpanda-self-managed', label: 'Redpanda Self-Managed', altLabels: [], broader: null },
    { id: 'docker', label: 'Docker Compose stack', altLabels: ['self-managed', 'Docker'], broader: 'redpanda-self-managed' },
    { id: 'kubernetes', label: 'Kubernetes (K8s)', altLabels: ['K8s'], broader: 'redpanda-self-managed' },
  ],
  technologies: [
    { id: 'redpanda-connect', label: 'Redpanda Connect', kind: 'redpanda-product', component: 'connect' },
    { id: 'agentic-data-plane', label: 'Agentic Data Plane', kind: 'redpanda-product', component: 'agentic-data-plane' },
    { id: 'go', label: 'Go', kind: 'language' },
  ],
}

const platform = (value, id) => ({ value, id, label: TAXONOMY.platforms.find((p) => p.id === id).label })
const tech = (value, id) => Object.assign({ value }, TAXONOMY.technologies.find((t) => t.id === id))
const concepts = (platforms, technologies) => ({ platforms, technologies, useCases: [], industries: [], topics: [] })

// New catalog: authored fields as written, plus concepts.
const NEW_RECORDS = [
  // Authored with the alias the taxonomy resolves (RPCN is not the label).
  { id: 'cdc', title: 'CDC', url: '/solutions/cdc/', status: 'published', featured: true, platforms: ['self-managed'], technologies: ['RPCN'], concepts: concepts([platform('self-managed', 'docker')], [tech('RPCN', 'redpanda-connect')]) },
  // Authored with the new platform ID, which the old string match misses.
  { id: 'k8s', title: 'K8s', url: '/solutions/k8s/', status: 'published', platforms: ['docker', 'kubernetes'], technologies: ['Go'], concepts: concepts([platform('docker', 'docker'), platform('kubernetes', 'kubernetes')], [tech('Go', 'go')]) },
  // The label is there as a string, but the concepts say otherwise; concepts win.
  { id: 'label-only', title: 'Label only', url: '/solutions/label-only/', status: 'published', platforms: ['cloud'], technologies: ['Redpanda Connect'], concepts: concepts([platform('cloud', 'cloud')], []) },
  { id: 'agents', title: 'Agents', url: '/solutions/agents/', status: 'published', platforms: ['cloud'], technologies: ['Agentic Data Plane'], concepts: concepts([platform('cloud', 'cloud')], [tech('Agentic Data Plane', 'agentic-data-plane')]) },
]

// Old catalog: no taxonomy, no concepts.
const OLD_RECORDS = [
  { id: 'cdc', title: 'CDC', url: '/solutions/cdc/', status: 'published', featured: true, platforms: ['self-managed'], technologies: ['Redpanda', 'Redpanda Connect'] },
  { id: 'dr', title: 'DR', url: '/solutions/dr/', status: 'published', platforms: ['self-managed', 'cloud'], technologies: ['Redpanda'] },
  { id: 'agents', title: 'Agents', url: '/solutions/agents/', status: 'published', platforms: ['cloud'], technologies: ['Agentic Data Plane'] },
]

const siteWith = (catalog) => ({ components: { solutions: { name: 'solutions', url: '/solutions/', latest: { asciidoc: { attributes: { 'solutions-catalog': JSON.stringify(catalog) } } } } } })
const NEW_SITE = siteWith({ solutions: NEW_RECORDS, taxonomy: TAXONOMY })
const OLD_SITE = siteWith({ solutions: OLD_RECORDS })
const catalogOf = (site) => helper('get-solutions-catalog')({ data: { root: { site } } })
const ids = (records) => records.map((r) => r.id)

// ---- get-solutions-catalog ---------------------------------------------------

test('a catalog with a taxonomy passes it through and names every platform value from it', () => {
  const catalog = catalogOf(NEW_SITE)
  assert.deepEqual(catalog.taxonomy, TAXONOMY)
  assert.equal(catalog.platformNames.docker, 'Docker Compose stack')
  assert.equal(catalog.platformNames['self-managed'], 'Docker Compose stack', 'the altLabel names the old value')
  assert.equal(catalog.platformNames.K8s, 'Kubernetes (K8s)')
  assert.equal(catalog.platformNames.cloud, 'Redpanda Cloud (managed)')
  assert.ok(catalog.all.every((r) => r.concepts), 'records keep their concepts')
})

test('a catalog without a taxonomy has none, and no platform names', () => {
  const catalog = catalogOf(OLD_SITE)
  assert.equal(catalog.taxonomy, null)
  assert.equal(catalog.platformNames, null)
})

test('record concepts alone still name the values those records authored', () => {
  const catalog = catalogOf(siteWith({ solutions: NEW_RECORDS }))
  assert.equal(catalog.taxonomy, null)
  assert.equal(catalog.platformNames['self-managed'], 'Docker Compose stack')
  assert.equal(catalog.platformNames.kubernetes, 'Kubernetes (K8s)')
})

test('Runs on orders docker with the self-managed value it replaces', () => {
  const catalog = catalogOf(NEW_SITE)
  assert.deepEqual(catalog.facets.platforms.map((p) => p.value), ['self-managed', 'docker', 'kubernetes', 'cloud'])
})

// ---- platform-name, platform-list, format-verified-evidence ------------------

test('platform helpers use the catalog names when given and fall back without them', () => {
  const name = helper('platform-name')
  const list = helper('platform-list')
  const evidence = helper('format-verified-evidence')
  const names = catalogOf(NEW_SITE).platformNames
  const opts = { hash: { names } }

  assert.equal(name('self-managed', opts), 'Docker Compose stack')
  assert.equal(name('docker', opts), 'Docker Compose stack')
  assert.equal(name('unknown', opts), 'unknown')
  assert.equal(list(['self-managed', 'kubernetes', 'cloud'], opts), 'Docker Compose stack, Kubernetes (K8s), and Redpanda Cloud (managed)')
  assert.equal(evidence({ verifyScript: 'PASS (1/1)', runs: { kubernetes: { verifyScript: 'PASS (2/2)' } } }, opts),
    'Docker Compose stack: verify script passed 1 of 1; Kubernetes (K8s): verify script passed 2 of 2')

  // Old catalog: names is null, or the helper is called with no options at all.
  for (const fallback of [{ hash: { names: null } }, { hash: {} }, undefined]) {
    assert.equal(name('self-managed', fallback), 'Docker Compose')
    assert.equal(list(['self-managed', 'cloud'], fallback), 'Docker Compose and Redpanda Cloud')
    assert.equal(evidence({ verifyScript: 'PASS (1/1)', runs: { kubernetes: { verifyScript: 'PASS (2/2)' } } }, fallback),
      'Docker Compose: verify script passed 1 of 1; Kubernetes: verify script passed 2 of 2')
  }
  assert.equal(name('docker'), 'docker', 'the fallback map predates the docker ID')
})

test('the solution chips and the Runs on filter render names from the catalog, or the fallback', () => {
  const hbs = Handlebars.create()
  ;['eq', 'ne', 'lt', 'gt', 'and', 'or', 'format-release-date', 'format-verified-evidence', 'relativize', 'without', 'get-solutions-catalog', 'parse-json', 'encode-uri', 'platform-name', 'platform-list', 'increment', 'concat'].forEach((n) => hbs.registerHelper(n, helper(n)))
  hbs.registerPartial('solution-meta', read('src/partials/solution-meta.hbs'))
  const meta = hbs.compile('{{> solution-meta solution=solution}}')
  const solution = { platforms: ['self-managed', 'kubernetes'], verified: { runAt: '2026-09-13T02:14:07Z', platforms: ['self-managed'] } }
  const page = { url: '/solutions/x/', attributes: {} }

  const fresh = meta({ site: NEW_SITE, page, solution })
  assert.match(fresh, /sol-chip--platform">Docker Compose stack</)
  assert.match(fresh, /sol-chip--platform">Kubernetes \(K8s\)</)
  assert.match(fresh, / on Docker Compose stack<\/dd>/)

  const old = meta({ site: OLD_SITE, page, solution })
  assert.match(old, /sol-chip--platform">Docker Compose</)
  assert.match(old, /sol-chip--platform">Kubernetes</)
  assert.match(old, / on Docker Compose<\/dd>/)

  const src = read('src/partials/solutions-filters.hbs')
  assert.match(src, /\{\{platform-name value names=\(lookup \(get-solutions-catalog\) 'platformNames'\)\}\}/, 'the filter passes the catalog names')
})

// ---- solutions-for-component -------------------------------------------------

test('with a taxonomy, a component matches the technology that names it, by concept ID', () => {
  const pick = helper('solutions-for-component')
  const { all, taxonomy } = catalogOf(NEW_SITE)
  assert.deepEqual(ids(pick(all, 'connect', taxonomy)), ['cdc'], 'by concept, not the authored string; label-only has no such concept')
  assert.deepEqual(ids(pick(all, 'agentic-data-plane', taxonomy)), ['agents'], 'any product the taxonomy gives a component')
  assert.deepEqual(ids(pick(all, 'ROOT', taxonomy)), ['cdc', 'k8s'], 'the docker platform, authored as self-managed or docker')
  assert.deepEqual(ids(pick(all, 'cloud', taxonomy)).sort(), ['agents', 'label-only'])
  assert.deepEqual(pick(all, 'api', taxonomy), [])
})

test('with a taxonomy, a record without concepts matches by the technology label', () => {
  const pick = helper('solutions-for-component')
  const records = [{ id: 'plain', status: 'published', platforms: ['self-managed'], technologies: ['Redpanda Connect'] }]
  assert.deepEqual(ids(pick(records, 'connect', TAXONOMY)), ['plain'])
  assert.deepEqual(ids(pick(records, 'streaming', TAXONOMY)), ['plain'])
})

test('without a taxonomy, the old rules apply: the Redpanda Connect string and authored platforms', () => {
  const pick = helper('solutions-for-component')
  const { all, taxonomy } = catalogOf(OLD_SITE)
  assert.deepEqual(ids(pick(all, 'connect', taxonomy)), ['cdc'])
  assert.deepEqual(ids(pick(all, 'redpanda-connect', taxonomy)), ['cdc'])
  assert.deepEqual(ids(pick(all, 'ROOT', taxonomy)), ['cdc', 'dr'])
  assert.deepEqual(ids(pick(all, 'cloud-data-platform', taxonomy)).sort(), ['agents', 'dr'])
  assert.deepEqual(pick(all, 'agentic-data-plane', taxonomy), [], 'no taxonomy, no component for this product')
  // A Handlebars call with two arguments passes the options object third.
  assert.deepEqual(ids(pick(all, 'connect', { hash: {}, data: {} })), ['cdc'])
})

test('the component home renders the catalog picks through the taxonomy', () => {
  const src = read('src/partials/component-home-v3.hbs')
  const block = src.slice(src.indexOf('{{!-- Build it in practice'), src.indexOf('{{!-- Pathway cards'))
  const hbs = Handlebars.create()
  ;['eq', 'ne', 'lt', 'and', 'or', 'increment', 'parse-json', 'relativize', 'without', 'get-solutions-catalog', 'recs-all-authored', 'find-component', 'solutions-for-component', 'is-external-url', 'resolve-resource'].forEach((n) => hbs.registerHelper(n, helper(n)))
  hbs.registerPartial('solution-recommendations', read('src/partials/solution-recommendations.hbs'))
  const render = hbs.compile(block)
  const at = (site, name) => render({ site, page: { url: '/' + name + '/', component: { name, title: name }, attributes: {} } })
  const rendered = (html) => (html.match(/data-solution-id="([^"]+)"/g) || []).map((m) => m.slice(18, -1))

  assert.deepEqual(rendered(at(NEW_SITE, 'connect')), ['cdc'])
  assert.deepEqual(rendered(at(NEW_SITE, 'agentic-data-plane')), ['agents'])
  assert.deepEqual(rendered(at(OLD_SITE, 'connect')), ['cdc'])
  assert.deepEqual(rendered(at(OLD_SITE, 'agentic-data-plane')), [])
})

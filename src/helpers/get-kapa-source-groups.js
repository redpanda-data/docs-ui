'use strict'

/**
 * Resolves the Kapa source group that scopes Ask AI retrieval to the docs
 * version the reader is actually on.
 *
 * WHY THIS EXISTS
 * ---------------
 * Kapa indexes one separately crawled source per published docs version. With no
 * scoping, a question is answered from any of them. Measured against the live
 * retrieval API for "hardware requirements for enterprise redpanda self-hosted",
 * the exact question in DOC-2450: 11 results spread across 24.2, 24.3, 25.1,
 * 25.2, 25.3 and current, with only ONE from current. Scoped to the current
 * group, 14 of 14 came from current.
 *
 * HOW THE SEGMENT IS DERIVED
 * --------------------------
 * From `page.url`, not from page.version. The two disagree for the latest
 * release: `latest_version_segment: 'current'` publishes 26.2 at
 * /streaming/current/ while page.version reads 26.2. The Kapa mapping is keyed on
 * the URL segment because that is what Kapa's own source_url values use, so
 * reading the URL avoids having to know which version is currently latest.
 *
 * WHAT IT RETURNS
 * ---------------
 * An array, because that is the shape both Kapa providers want
 * (sourceGroupIdsInclude on AgentProvider, sourceGroupIDsInclude on
 * KapaProvider). An EMPTY array means "send no filter", which is the pre-DOC-2450
 * behaviour: Kapa searches everything. That is the deliberate degradation for any
 * case where scoping cannot be resolved, because a wrong group is worse than no
 * group -- scoping to a group that does not hold the reader's version returns
 * only Kapa's global sources, so the reader gets no version-specific content at
 * all and no error either.
 *
 * Unversioned pages (Cloud, Connect, Agentic Data Plane, labs, home, search, the
 * 404 page) resolve to the mapping's default_segment rather than to nothing.
 * Sending no filter there is what produced DOC-2450 in the first place: the
 * reporter was on a page with no version of its own.
 *
 * Note that scoping to a version group does NOT hide Cloud, Connect or Agentic
 * Data Plane content. Those sources are deliberately left unassigned in Kapa, so
 * they are "global" and come through alongside whichever group is selected.
 * Verified live: scoped to the 25.2 group, an Agentic Data Plane question
 * returned 10 of 10 results from /agentic-data-plane/.
 *
 * Usage in templates:
 *   window.KAPA_SOURCE_GROUP_IDS = [
 *     {{#each (get-kapa-source-groups)}}"{{{this}}}"{{#unless @last}},{{/unless}}{{/each}}
 *   ];
 *
 * @param {object} options - Handlebars options with data.root.page and data.root.site
 * @returns {string[]} Zero or one Kapa source group id
 */
/**
 * Three outputs from one resolution, selected by an optional mode argument:
 *
 *   {{#each (get-kapa-source-groups)}}     -> array of zero or one group id
 *   {{get-kapa-source-groups 'segment'}}   -> the segment that group represents
 *   {{get-kapa-source-groups 'requested'}} -> the version segment the page is
 *                                             actually published under, when it
 *                                             differs from 'segment' (see below)
 *
 * One helper rather than two, because Antora compiles every UI helper in
 * isolation and a helper CANNOT require a sibling helper: doing so fails at
 * page-composition time with a fatal "Cannot find module" and takes the whole
 * build down. Copying the resolution into a second file instead would
 * reintroduce exactly the disagreement this is here to prevent.
 *
 * Handlebars passes params before the options object, so with no argument the
 * first parameter IS the options object.
 */
module.exports = function (mode, options) {
  const opts = options === undefined ? mode : options
  const { segment, groupId, requested } = resolve(opts)
  // Only name a segment when a group is genuinely being sent, so the agent
  // prompt cannot claim a restriction that is not in force.
  const segmentOut = groupId && segment ? segment : ''
  // Only name a requested segment when a group is being sent AND it is not the
  // group for the version the page is published under. Empty means "what was
  // sent is what the reader is on", including the no-scope case.
  const requestedOut = groupId && requested && requested !== segment ? requested : ''
  const idsOut = groupId ? [groupId] : []
  switch (mode) {
    case 'segment': return segmentOut
    case 'requested': return requestedOut
    // The JSON modes are what the template uses. They exist so that no raw
    // value is ever interpolated into an executable <script>: the ids come from
    // page or site attributes, and a quote or a </script> in one would end the
    // string or the script element. Handlebars' triple-stash does no escaping
    // at all inside <script>, so the encoding has to happen here.
    case 'json': return scriptSafeJson(idsOut)
    case 'segment-json': return scriptSafeJson(segmentOut)
    case 'requested-json': return scriptSafeJson(requestedOut)
    default: return idsOut
  }
}

/**
 * JSON.stringify plus `<` as \u003c. JSON.stringify alone leaves `<` intact, so
 * a literal `</script>` inside a value would close the script element early and
 * dump the rest into the document as markup. Same treatment the docs-site edge
 * function gives the same value for the /api/ pages.
 *
 * @param {*} value
 * @returns {string} A JavaScript expression safe to place inside <script>
 */
function scriptSafeJson (value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * Resolve a page to the group that will actually scope its retrieval, AND the
 * segment that group represents.
 *
 * Both are returned from one place on purpose. The agent's prompt needs to tell
 * the reader's model which version the answers came from, and any second
 * derivation of that (say, a regex over window.location) can disagree with the
 * group actually sent. It did: for /streaming/26.2/... a URL regex yields
 * "26.2" while this resolves to the `current` group, because the latest release
 * publishes at /streaming/current/ and 26.2 is not a segment. The prompt would
 * then promise 26.2-only results over `current` retrieval.
 *
 * `segment` is the EFFECTIVE segment, after the fallback to default_segment, so
 * it always names the group in `groupId` rather than what the URL asked for.
 *
 * `requested` is the version segment the page is actually published under, read
 * from the page's component version (see requestedSegmentFromPage), or null for
 * an unversioned page. It differs from `segment` exactly when a published
 * version has no group of its own yet: the beta docs at /streaming/beta/, or a
 * release published before its Kapa source and group exist. The prompt uses it
 * to tell the agent the reader is on `requested` while retrieval ran against
 * `segment`, so the agent caveats instead of asserting the wrong version.
 *
 * @param {object} options - Handlebars options
 * @returns {{segment: string|null, groupId: string|null, requested: string|null}}
 */
function resolve (options) {
  const root = (options && options.data && options.data.root) || {}
  const { page, site } = root
  const none = { segment: null, groupId: null, requested: null }

  const mapping = readMapping(page, site)
  if (!mapping || !mapping.segments) return none

  // versionSegmentFromUrl only ever returns a key of mapping.segments, so
  // `asked` is either a mapped segment or null. Null covers both unversioned
  // pages (Cloud, Connect, home) and versioned pages whose segment has no group
  // yet (beta, or a release published before its Kapa group exists). Both fall
  // back to the default: for the first that IS the DOC-2450 fix, and for the
  // second it beats searching every version at once. `requested` below is what
  // tells the two apart for the prompt.
  const asked = versionSegmentFromUrl(page && page.url, mapping.segments)
  const effective = asked || mapping.default_segment
  const entry = mapping.segments[effective]
  // A non-empty string, not merely truthy. A malformed mapping with
  // group_id: {} would otherwise be emitted as "[object Object]" and sent to
  // Kapa as a filter. Nothing is the safer failure, so an entry that exists but
  // has no usable group_id resolves to none rather than to the default.
  if (!entry || typeof entry.group_id !== 'string' || !entry.group_id) return none

  return { segment: effective, groupId: entry.group_id, requested: asked || requestedSegmentFromPage(page) }
}

/**
 * The version segment a page is published under, whether or not the mapping
 * knows it. Only the mapping's own keys are recognised by versionSegmentFromUrl,
 * so this is the only way to notice that /streaming/beta/... is a versioned page
 * that fell back to the default group.
 *
 * Read from Antora's page model rather than by guessing at the URL: a page in a
 * versioned component version has a non-empty componentVersion.version and a URL
 * of /<component>/<segment>/..., or /<segment>/... for the ROOT component. An
 * unversioned component (version '') has no segment in its URL at all, and the
 * 404 page has no componentVersion, so both yield null.
 *
 * @param {object} page - The UI model page
 * @returns {string|null} e.g. 'beta', '26.3', or null when the page is not versioned
 */
function requestedSegmentFromPage (page) {
  if (!page || typeof page.url !== 'string') return null
  const cv = page.componentVersion
  if (!cv || typeof cv.version !== 'string' || !cv.version) return null
  const parts = page.url.split('/')
  const name = page.component && page.component.name
  const candidate = name && name !== 'ROOT' && parts[1] === name ? parts[2] : parts[1]
  return candidate && page.url.includes(`/${candidate}/`) ? candidate : null
}

/**
 * The mapping is generated in docs-extensions-and-macros
 * (docs-data/kapa-source-groups.json) and surfaced to the UI as an AsciiDoc
 * attribute, because docs-ui does not depend on that package and must not carry
 * a second copy that can drift.
 *
 * Read from the component version first and the site second, matching how
 * add-global-attributes.js merges shared attributes onto every component
 * version. Absent in a bare docs-ui preview, which is why every failure path
 * degrades to "no filter" rather than throwing.
 */
function readMapping (page, site) {
  const candidates = [
    page && page.componentVersion && page.componentVersion.asciidoc && page.componentVersion.asciidoc.attributes,
    page && page.component && page.component.asciidoc && page.component.asciidoc.attributes,
    page && page.attributes,
    site && site.asciidoc && site.asciidoc.attributes,
    // site.keys last but never redundant: it is the ONLY channel that reaches a
    // page with no component. The 404 page renders the Ask AI panel yet has no
    // page.component or page.componentVersion, so without this it would search
    // every docs version -- and a 404 is a plausible place to ask the AI where
    // something went.
    site && site.keys,
  ]

  for (const attrs of candidates) {
    const raw = attrs && (attrs['kapa-source-groups'] || attrs.kapa_source_groups)
    if (!raw) continue
    if (typeof raw === 'object') return raw
    try {
      return JSON.parse(raw)
    } catch (err) {
      // A malformed attribute must not break the page. Losing version scoping is
      // a degraded answer; a thrown helper is a broken build. Keep looking: a
      // broken component attribute should not hide a good site.keys copy.
      continue
    }
  }
  return null
}

/**
 * Pull the version segment out of a page URL.
 *
 * Recognises a segment by looking it up in the mapping, rather than by matching
 * a hardcoded /streaming/ prefix, and checks the first TWO path positions:
 *
 *   /streaming/25.2/manage/monitoring/  -> 25.2   (today's layout)
 *   /24.3/manage/monitoring/            -> 24.3   (the pre-rename layout)
 *
 * Both are checked because the layout has already changed once: the docs
 * component was renamed from ROOT to streaming, which moved every versioned
 * page from /<version>/ to /streaming/<version>/. A prefix-matching version of
 * this function silently returned null for the old layout, so an all-components
 * build over pre-rename branches produced 451 pages of 24.3 content advertising
 * the current group. Nothing failed; the answers were just wrong.
 *
 * Driven off the mapping's own keys, so this stays correct if a second
 * component is ever versioned, and cannot mistake an ordinary path word for a
 * version: /connect/current/ only resolves if 'current' is a real segment, and
 * /cloud-data-platform/manage/ never resolves because 'manage' is not.
 *
 * @param {string} url - e.g. /streaming/25.2/get-started/intro-to-events/
 * @param {object} segments - The mapping's segments, keyed by URL segment
 * @returns {string|null} e.g. '25.2', 'current', or null when not versioned
 */
function versionSegmentFromUrl (url, segments) {
  if (typeof url !== 'string' || !segments) return null
  // Leading empty string from the leading slash, so [1] and [2] are the first
  // two path positions.
  const parts = url.split('/')
  for (const candidate of [parts[1], parts[2]]) {
    // Requires a trailing slash after the candidate, so a FILE named after a
    // version (/25.2.html, or /streaming/25.2.json) is not read as a segment.
    if (candidate && Object.prototype.hasOwnProperty.call(segments, candidate) &&
        url.includes(`/${candidate}/`)) {
      return candidate
    }
  }
  return null
}

module.exports.resolve = resolve
module.exports.scriptSafeJson = scriptSafeJson
module.exports.versionSegmentFromUrl = versionSegmentFromUrl
module.exports.readMapping = readMapping
module.exports.requestedSegmentFromPage = requestedSegmentFromPage

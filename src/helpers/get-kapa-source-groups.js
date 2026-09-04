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
module.exports = function (options) {
  const root = (options && options.data && options.data.root) || {}
  const { page, site } = root

  const mapping = readMapping(page, site)
  if (!mapping || !mapping.segments) return []

  const segment = versionSegmentFromUrl(page && page.url, mapping.segments)

  // A versioned page whose segment has no group is the case the drift check
  // exists to catch: a version was published and nobody created the Kapa source
  // and group. Fall back to the default rather than sending nothing, so the
  // reader gets current-version answers instead of every version at once.
  const entry = (segment && mapping.segments[segment]) || mapping.segments[mapping.default_segment]
  if (!entry || !entry.group_id) return []

  return [entry.group_id]
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
      // a degraded answer; a thrown helper is a broken build.
      return null
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

module.exports.versionSegmentFromUrl = versionSegmentFromUrl
module.exports.readMapping = readMapping

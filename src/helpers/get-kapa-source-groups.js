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

  const segment = versionSegmentFromUrl(page && page.url)

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
 * Only /streaming/ is versioned today. Every other component publishes
 * unversioned, so this returns null for them and the caller uses the default.
 *
 * @param {string} url - e.g. /streaming/25.2/get-started/intro-to-events/
 * @returns {string|null} e.g. '25.2', 'current', or null when not versioned
 */
function versionSegmentFromUrl (url) {
  if (typeof url !== 'string') return null
  const match = url.match(/^\/streaming\/([^/]+)\//)
  return match ? match[1] : null
}

module.exports.versionSegmentFromUrl = versionSegmentFromUrl
module.exports.readMapping = readMapping

'use strict'

// Rewrites a nav bucket's version list so each option links to the equivalent page in that
// version rather than to the version's start page. bucket.versions[] is built by
// extensions/unified-navigation.js from raw Antora component.versions, and its url is the
// version's start page, which is why an untouched list always navigates away from the page
// the reader was on.
//
// Returns undefined when there is nothing to render, so the caller can guard with
// {{#with (resolve-bucket-versions bucket) as |vers|}}. Reference block params bare inside
// that block: ../vers does not resolve.
//
// Deliberately uncached, unlike resolve-resource.js: this is called once per bucket per
// page, and every bucket on a page has a distinct componentName, so a per-page cache key
// would never legitimately hit. One that ignored the bucket or the catalog would instead
// return another bucket's rows.

// Thresholds preserved from the markup this replaces: 6 or fewer versions render flat,
// 7 or more show the newest 5 and hide the rest behind the toggle.
const FLAT_LIMIT = 6
const RECENT_LIMIT = 5

module.exports = (bucket, { data } = {}) => {
  const versions = bucket && bucket.versions
  if (!Array.isArray(versions) || versions.length < 2) return

  const { contentCatalog, page } = (data && data.root) || {}
  const componentName = bucket.componentName
  // Only the bucket for the page's own component has an equivalent page to aim at.
  const isOwnComponent = Boolean(
    componentName && page && page.component && componentName === page.component.name
  )

  // Antora already walked alias targets in both directions when it built page.versions, so
  // prefer its answer. page.versions is undefined for single-version components.
  const pageVersions = isOwnComponent && Array.isArray(page.versions) ? page.versions : []

  let currentDisplayVersion = bucket.currentVersion

  const all = versions.map((entry) => {
    const row = {
      version: entry.version,
      displayVersion: entry.displayVersion,
      isEol: entry.isEol,
      url: entry.url,
      isCurrent: false,
      missing: false,
    }

    if (!isOwnComponent) {
      // Another component's bucket: the start page is the intended target, and a missing
      // flag would be noise.
      row.isCurrent = entry.displayVersion === bucket.currentVersion
      return row
    }

    // Compare raw version keys, not display strings.
    row.isCurrent = entry.version === page.version
    if (row.isCurrent) {
      currentDisplayVersion = entry.displayVersion
      row.url = page.url || entry.url
      return row
    }

    const pageVersion = pageVersions.find((candidate) => candidate.version === entry.version)
    if (pageVersion && !pageVersion.missing && pageVersion.url) {
      row.url = pageVersion.url
      return row
    }

    const resolved = resolveInVersion(contentCatalog, componentName, entry.version, page)
    if (resolved) {
      row.url = resolved
    } else if (pageVersion) {
      // Antora said missing and the catalog agrees: keep the start-page url already in
      // row.url and let the template mark it.
      row.missing = true
    }
    return row
  })

  const flat = all.length <= FLAT_LIMIT
  return {
    all,
    recent: flat ? all : all.slice(0, RECENT_LIMIT),
    older: flat ? [] : all.slice(RECENT_LIMIT),
    currentDisplayVersion,
  }
}

function resolveInVersion (contentCatalog, component, version, page) {
  // The preview build never sets contentCatalog.
  if (!contentCatalog || !contentCatalog.getById) return
  if (version === undefined || !page || !page.relativeSrcPath) return
  const id = { component, version, module: page.module, family: 'page', relative: page.relativeSrcPath }
  const target = contentCatalog.getById(id)
  if (target && target.pub) return target.pub.url
  const alias = contentCatalog.getById(Object.assign({}, id, { family: 'alias' }))
  if (alias && alias.rel && alias.rel.pub) return alias.rel.pub.url
}

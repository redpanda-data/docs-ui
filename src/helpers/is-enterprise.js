'use strict'

/* Put this in nav-tree.hbs
{{#if navigation.length}}
  <ul class="nav-list">
    {{#each navigation}}
      <li class="nav-item{{#if (eq ./url @root.page.url)}} is-current-page{{/if}}" data-depth="{{or ../level 0}}">
        {{#if ./content}}
          {{#if ./url}}
            <a class="nav-link
              {{~#if (is-enterprise ./url)}} enterprise{{/if}}
*/

// Cache for component pages (cleared between render cycles)
const cache = new Map()
let currentComponent = null

module.exports = (navUrl, { data: { root } }) => {
  const { contentCatalog, page } = root

  // Reset cache if component changed
  if (currentComponent !== page.component.name) {
    cache.clear()
    currentComponent = page.component.name
  }

  // Check cache first
  if (cache.has(navUrl)) {
    return cache.get(navUrl)
  }

  // Query and cache result
  const pages = contentCatalog.findBy({ component: page.component.name, family: 'page' })

  for (let i = 0; i < pages.length; i++) {
    const isEnterprise = pages[i].pub.url === navUrl &&
      pages[i].asciidoc.attributes['page-enterprise'] === 'true'

    if (pages[i].pub.url === navUrl) {
      cache.set(navUrl, isEnterprise)
      return isEnterprise
    }
  }

  cache.set(navUrl, false)
  return false
}

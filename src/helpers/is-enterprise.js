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

module.exports = (navUrl, { data: { root } }) => {
  const { contentCatalog, page } = root
  var pages = contentCatalog.navGroup
  var cp = contentCatalog.cp
  if (!pages || cp !== page.component.name) {
    pages = contentCatalog.findBy({ component: page.component.name, family: 'page' })
    contentCatalog.navGroup = pages
    contentCatalog.cp = page.component.name
  }
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].pub.url === navUrl &&
      pages[i].asciidoc.attributes['page-enterprise'] === 'true') {
      return true
    }
  }
}

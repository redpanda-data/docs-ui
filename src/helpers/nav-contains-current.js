'use strict'

/**
 * Whether a navigation subtree contains the current page.
 * Usage: {{#if (nav-contains-current ./items @root.page.url)}}...{{/if}}
 *
 * nav-tree.hbs renders a collapsed item's children into an inert <template>
 * (hydrated by 01-nav.js on first expand) unless they lead to the current page,
 * in which case they render directly so the current path is open on load
 * exactly as before. Iterative so a deep tree cannot blow the stack.
 */
module.exports = (items, url) => {
  if (!items || !items.length || !url) return false
  const stack = items.slice()
  while (stack.length) {
    const item = stack.pop()
    if (!item) continue
    if (item.url === url) return true
    if (item.items && item.items.length) stack.push(...item.items)
  }
  return false
}

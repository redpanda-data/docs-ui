/* global sessionStorage, fetch */
/**
 * First-party docs-behavior beacon (lead capture).
 *
 * For SIGNED-IN docs users only (rp_docs_auth hint cookie), reports one
 * pageview per navigation to the docs-site /docs-activity endpoint, which
 * records it server-side against the user's account. Replaces anonymous
 * third-party analytics (Plausible/Heap/Algolia) for lead purposes.
 *
 * Anonymous visitors send nothing. Same-origin, so the session cookie rides
 * along automatically. Fire-and-forget; never blocks or throws into the page.
 */
;(function () {
  'use strict'

  // Only signed-in users are tracked (matches 26-docs-account.js).
  if (!/(?:^|;\s*)rp_docs_auth=1(?:;|$)/.test(document.cookie)) return

  var path = window.location.pathname
  if (!path) return

  // Beacon once per path per tab session — avoids duplicate writes on
  // back/forward and re-renders. Keeps server write volume to real navigations.
  try {
    var key = 'docs-activity-seen'
    var seen = (sessionStorage.getItem(key) || '').split('\n')
    if (seen.indexOf(path) !== -1) return
    seen.push(path)
    sessionStorage.setItem(key, seen.slice(-200).join('\n'))
  } catch (e) { /* private mode: proceed without dedupe */ }

  // Antora component (product) exposed by the layout: <body data-component=…>
  var component = (document.body && document.body.getAttribute('data-component')) || null

  // Capture the search term on the standalone /search page (URL-driven).
  var q = null
  if (path.indexOf('/search') !== -1) {
    try { q = new URLSearchParams(window.location.search).get('q') } catch (e) { /* ignore */ }
  }

  try {
    fetch('/docs-activity', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path, component: component, q: q }),
      keepalive: true,
    }).catch(function () { /* best-effort */ })
  } catch (e) { /* never break the page */ }
})()

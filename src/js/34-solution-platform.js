/* global localStorage */
/**
 * Solution pages: remember the platform tab.
 *
 * Solution pages group their platform tabs with
 * [tabs,sync-group-id=platform] and the labels Docker Compose, Kubernetes,
 * and Redpanda Cloud. The Asciidoctor tabs script (js/vendor/tabs.js, loaded
 * in head-scripts.hbs with data-sync-storage-key="preferred-tab") keeps the
 * choice in localStorage 'preferred-tab-platform' and nowhere else. A click on
 * one of those tabs is also recorded in the progress store as
 * prefs.platform (28-solution-progress.js), which syncs to the account for a
 * signed-in reader. When the store holds a platform that differs from the
 * tabs script's choice (a later pick on another device, merged in when
 * signed-in progress loads), the matching tab is clicked, which selects it in
 * every platform tab group on the page and writes the tabs script's own key,
 * so other pages open on it too. The merge decides which pick is newer: the
 * one with the later `at` wins.
 */
;(function () {
  'use strict'

  var api = window.docsSolutions
  var body = document.body
  if (!api || typeof api.setPref !== 'function' || !body || !body.getAttribute('data-solution-id')) return

  function toArray (list) { return Array.prototype.slice.call(list || []) }
  function $$ (selector, root) { return toArray((root || document).querySelectorAll(selector)) }

  // ---------------------------------------------------------------------------
  // Platform
  // ---------------------------------------------------------------------------

  // tabs.js: data-sync-storage-key + '-' + the tab group's sync id.
  var TAB_STORAGE_KEY = 'preferred-tab-platform'
  var LABELS = { local: 'Docker Compose', kubernetes: 'Kubernetes', cloud: 'Redpanda Cloud' }

  function platformOf (label) {
    for (var key in LABELS) {
      if (Object.prototype.hasOwnProperty.call(LABELS, key) && LABELS[key] === label) return key
    }
    return null
  }

  // tabs.js moves the data-sync-group-id=platform class to an attribute when
  // it initializes; either form names the group.
  function isPlatformTabs (tabs) {
    return !!tabs && (tabs.getAttribute('data-sync-group-id') === 'platform' ||
      tabs.classList.contains('data-sync-group-id=platform'))
  }

  function tabLabel (tab) { return String(tab.textContent || '').trim() }

  function readTabChoice () {
    try { return localStorage.getItem(TAB_STORAGE_KEY) } catch (e) { return null }
  }

  function writeTabChoice (label) {
    try { localStorage.setItem(TAB_STORAGE_KEY, label) } catch (e) { /* storage blocked */ }
  }

  var applying = false

  // tabs.js handles the click on the tab itself; this runs after it, on the
  // way up. A pick is recorded even when it repeats the stored value, so it
  // is dated now and wins over an older pick from another device.
  function onTabClick (e) {
    if (applying || !e || !e.target || typeof e.target.closest !== 'function') return
    var tab = e.target.closest('.tablist li')
    var tabs = tab && tab.closest('.tabs')
    if (!isPlatformTabs(tabs)) return
    var platform = platformOf(tabLabel(tab))
    if (platform) api.setPref('platform', platform)
  }

  function applyPlatform () {
    var pref = api.getPrefs().platform
    var label = pref && LABELS[pref.value]
    if (!label || readTabChoice() === label) return
    // Written first, so a tabs script that has not initialized yet opens on
    // it; the click selects it now when it has.
    writeTabChoice(label)
    var groups = $$('.tabs').filter(isPlatformTabs)
    for (var i = 0; i < groups.length; i++) {
      var tab = $$('.tablist li', groups[i]).filter(function (li) { return tabLabel(li) === label })[0]
      if (!tab) continue
      if (tab.getAttribute('aria-selected') !== 'true' && typeof tab.click === 'function') {
        applying = true
        try { tab.click() } finally { applying = false }
      }
      return
    }
  }

  // ---------------------------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------------------------

  document.addEventListener('click', onTabClick)
  applyPlatform()
  window.addEventListener('docs-solutions:change', applyPlatform)
})()

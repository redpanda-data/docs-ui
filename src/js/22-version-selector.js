/* Version Selector Dropdown */
;(function () {
  'use strict'

  // Find all version selectors on the page
  var selectors = document.querySelectorAll('[data-version-selector]')
  if (!selectors.length) return

  selectors.forEach(function (smVer) {
    var btn = smVer.querySelector('.sm-ver-pill')
    var tabs = smVer.querySelectorAll('.sm-ver-tab')
    var groups = smVer.querySelectorAll('.sm-ver-group')

    if (!btn) return

    // Update group counts
    function updateCounts () {
      groups.forEach(function (group) {
        var rows = group.querySelectorAll('.sm-ver-row')
        var countEl = group.querySelector('.sm-ver-group-count')
        if (countEl) countEl.textContent = rows.length
        // Hide empty groups
        group.classList.toggle('is-hidden', rows.length === 0)
      })
    }
    updateCounts()

    // Tab filtering
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (e) {
        e.preventDefault()
        var filter = tab.dataset.filter

        // Update active tab
        tabs.forEach(function (t) {
          t.classList.remove('is-active')
          t.setAttribute('aria-selected', 'false')
        })
        tab.classList.add('is-active')
        tab.setAttribute('aria-selected', 'true')

        // Filter groups
        groups.forEach(function (group) {
          var groupStatus = group.dataset.group
          var rows = group.querySelectorAll('.sm-ver-row')
          if (filter === 'all') {
            group.classList.toggle('is-hidden', rows.length === 0)
          } else {
            group.classList.toggle('is-hidden', groupStatus !== filter)
          }
        })
      })
    })

    // Toggle dropdown
    btn.addEventListener('click', function (e) {
      e.stopPropagation()
      smVer.classList.toggle('is-open')
      btn.classList.toggle('is-open')
      btn.setAttribute('aria-expanded', smVer.classList.contains('is-open'))
    })

    // Close on outside click
    document.addEventListener('mousedown', function (e) {
      if (!smVer.contains(e.target)) {
        smVer.classList.remove('is-open')
        btn.classList.remove('is-open')
        btn.setAttribute('aria-expanded', 'false')
      }
    })

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        smVer.classList.remove('is-open')
        btn.classList.remove('is-open')
        btn.setAttribute('aria-expanded', 'false')
      }
    })
  })
})()

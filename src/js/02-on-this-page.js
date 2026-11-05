;(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', function () {
    const backToTopButton = document.querySelector('#back-to-top')
    if (!backToTopButton) return

    // Initially hide the button
    backToTopButton.style.display = 'none'

    // Show/hide button based on scroll position
    function toggleBackToTop () {
      if (window.scrollY > 300) {
        backToTopButton.style.display = 'flex'
      } else {
        backToTopButton.style.display = 'none'
      }
    }

    // Check on scroll (passive for performance)
    window.addEventListener('scroll', toggleBackToTop, { passive: true })

    // Check initial state
    toggleBackToTop()

    backToTopButton.addEventListener('click', function (event) {
      event.preventDefault()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  })

  var sidebar = document.querySelector('aside.toc.sidebar')
  if (!sidebar) return
  if (document.querySelector('body.-toc')) return sidebar.parentNode.removeChild(sidebar)
  var levels = parseInt(sidebar.dataset.levels || 2, 10)
  if (levels < 0) return
  // Set from :page-toc-collapsible: true via toc.hbs. See buildCollapsibleGroups below.
  var collapsible = sidebar.dataset.collapsible === 'true'

  var articleSelector = 'article.doc'
  var article = document.querySelector(articleSelector)
  var headingsSelector = []
  for (var level = 0; level <= levels; level++) {
    var headingSelector = [articleSelector]
    if (level) {
      for (var l = 1; l <= level; l++) headingSelector.push((l === 2 ? '.sectionbody>' : '') + '.sect' + l)
      headingSelector.push('h' + (level + 1) + '[id]')
    } else {
      headingSelector.push('h1[id].sect0')
    }
    headingsSelector.push(headingSelector.join('>'))
  }
  var headings = find(headingsSelector.join(','), article.parentNode)
  if (!headings.length) return sidebar.querySelector('#thumbs-toc').remove()

  var lastActiveFragment
  var links = {}
  var skipScrollUpdate = false
  var list = headings.reduce(function (accum, heading) {
    var link = document.createElement('a')
    link.textContent = heading.textContent
    links[(link.href = '#' + heading.id)] = link
    var listItem = document.createElement('li')
    listItem.dataset.level = parseInt(heading.nodeName.slice(1), 10) - 1
    listItem.appendChild(link)
    accum.appendChild(listItem)
    return accum
  }, document.createElement('ul'))

  if (collapsible) buildCollapsibleGroups(list)

  /**
   * Make one fragment the active entry, clearing whatever was active before.
   *
   * The scroll pass can leave several entries active at the bottom of a page,
   * so the previous value is either a fragment or an array of them.
   *
   * @param {string} fragment - The '#id' to activate. Ignored if no entry has it.
   */
  function setActive (fragment) {
    if (!links[fragment]) return
    if (lastActiveFragment && lastActiveFragment !== fragment) {
      var previous = Array.isArray(lastActiveFragment) ? lastActiveFragment : [lastActiveFragment]
      previous.forEach(function (f) {
        if (links[f]) links[f].classList.remove('is-active')
      })
    }
    links[fragment].classList.add('is-active')
    revealGroup(links[fragment])
    lastActiveFragment = fragment
  }

  /**
   * Hold off the scroll pass for a moment, so it cannot overwrite an activation
   * the user just caused. The browser is still settling on the target when a
   * click or a hash change lands.
   */
  function holdScrollUpdates () {
    skipScrollUpdate = true
    setTimeout(function () {
      skipScrollUpdate = false
    }, 100)
  }

  // Add click handlers to TOC links to immediately highlight clicked item
  Object.keys(links).forEach(function (fragment) {
    links[fragment].addEventListener('click', function () {
      setActive(fragment)
      holdScrollUpdates()
    })
  })

  var menu = sidebar.querySelector('.toc-menu')
  if (!menu) (menu = document.createElement('div')).className = 'toc-menu'

  var title = document.createElement('h3')
  title.textContent = sidebar.dataset.title || ''
  menu.appendChild(list)

  // Insert h3 BEFORE .toc-menu so it's outside the scrollable area
  // This keeps the h3 visible while the menu content scrolls
  if (menu.parentNode) {
    menu.parentNode.insertBefore(title, menu)
  } else {
    // Menu was dynamically created, add both to sidebar
    sidebar.insertBefore(title, sidebar.firstChild)
    sidebar.insertBefore(menu, title.nextSibling)
  }

  var startOfContent = !document.getElementById('toc') && article.querySelector('h1.page ~ :not(.is-before-toc)')
  if (startOfContent) {
    var embeddedToc = document.createElement('aside')
    embeddedToc.className = 'toc embedded'
    var tocMenuDropdown = document.createElement('div')
    tocMenuDropdown.className = 'toc-menu-dropdown'
    var clonedMenu = menu.cloneNode(true)
    // Create a new h3 for the dropdown (h3 is now outside menu in sidebar)
    var dropdownTitle = document.createElement('h3')
    dropdownTitle.classList.add('discrete')
    dropdownTitle.textContent = 'On this page'
    tocMenuDropdown.insertBefore(dropdownTitle, tocMenuDropdown.firstChild)
    tocMenuDropdown.appendChild(clonedMenu)
    embeddedToc.appendChild(tocMenuDropdown)
    var pageVersions = document.querySelector('.page-versions')
    if (pageVersions) {
      pageVersions.parentNode.insertBefore(embeddedToc, pageVersions.nextSibling)
    } else {
      startOfContent.parentNode.insertBefore(embeddedToc, startOfContent)
    }
    tocMenuDropdown.querySelector('.toc-menu').classList.add('hidden')
    const tocMenu = tocMenuDropdown.querySelector('.toc-menu')
    tocMenuDropdown.addEventListener('click', function (e) {
      tocMenu.classList.toggle('hidden')
    })
    // Handle ToC link clicks within the dropdown
    tocMenuDropdown.querySelectorAll('.toc-menu a').forEach(function (link) {
      link.addEventListener('click', function (e) {
        // Note - Dan removed preventDefault as it was hijacking default browser behavior, and not appending the url with the correct # needed to navigate correctly
        // Hide the dropdown menu after click
        tocMenu.classList.toggle('hidden')
        // Update sidebar TOC active state immediately
        var fragment = link.getAttribute('href')
        if (fragment && links[fragment]) {
          setActive(fragment)
          holdScrollUpdates()
        }
      })
    })
  }

  // Get the scrollable container - could be menu (with Connect Tools) or list
  var scrollableContainer = menu

  window.addEventListener('load', function () {
    onScroll()
    syncToHashTarget()
    window.addEventListener('scroll', onScroll, { passive: true })
    // In-page links and back/forward change the hash without a load, so the
    // highlight has to follow on those too. onScroll alone cannot: it runs on
    // scroll, and a hash change does not always produce one.
    window.addEventListener('hashchange', syncToHashTarget)
    // On initial load, scroll active item into view (e.g., when navigating to a hash)
    scrollActiveIntoView()
  })

  function scrollActiveIntoView () {
    var activeLink = scrollableContainer.querySelector('.is-active')
    if (activeLink && scrollableContainer.scrollHeight > scrollableContainer.offsetHeight) {
      // Center the active item in the scrollable area
      var containerHeight = scrollableContainer.offsetHeight
      var linkTop = activeLink.offsetTop - scrollableContainer.offsetTop
      var linkHeight = activeLink.offsetHeight
      scrollableContainer.scrollTop = Math.max(0, linkTop - containerHeight / 2 + linkHeight / 2)
    }
  }

  function onScroll () {
    if (skipScrollUpdate) return
    var scrolledBy = window.scrollY
    var buffer = getNumericStyleVal(document.documentElement, 'fontSize') * 1.15
    // Account for sticky header height - use scroll-padding-top or fall back to article offset
    var scrollPadding = getNumericStyleVal(document.documentElement, 'scrollPaddingTop') || 0
    var ceil = scrollPadding || article.offsetTop
    if (scrolledBy && window.innerHeight + scrolledBy + 2 >= document.documentElement.scrollHeight) {
      lastActiveFragment = Array.isArray(lastActiveFragment) ? lastActiveFragment : Array(lastActiveFragment || 0)
      var activeFragments = []
      var lastIdx = headings.length - 1
      headings.forEach(function (heading, idx) {
        var fragment = '#' + heading.id
        if (idx === lastIdx || heading.getBoundingClientRect().top + getNumericStyleVal(heading, 'paddingTop') > ceil) {
          activeFragments.push(fragment)
          if (lastActiveFragment.indexOf(fragment) < 0) {
            links[fragment].classList.add('is-active')
            revealGroup(links[fragment])
          }
        } else if (~lastActiveFragment.indexOf(fragment)) {
          links[lastActiveFragment.shift()].classList.remove('is-active')
        }
      })
      scrollableContainer.scrollTop = scrollableContainer.scrollHeight - scrollableContainer.offsetHeight
      lastActiveFragment = activeFragments.length > 1 ? activeFragments : activeFragments[0]
      return
    }
    if (Array.isArray(lastActiveFragment)) {
      lastActiveFragment.forEach(function (fragment) {
        links[fragment].classList.remove('is-active')
      })
      lastActiveFragment = undefined
    }
    var activeFragment
    headings.some(function (heading) {
      if (heading.getBoundingClientRect().top + getNumericStyleVal(heading, 'paddingTop') - buffer > ceil) return true
      activeFragment = '#' + heading.id
    })
    if (activeFragment) {
      if (activeFragment === lastActiveFragment) return
      if (lastActiveFragment) links[lastActiveFragment].classList.remove('is-active')
      var activeLink = links[activeFragment]
      activeLink.classList.add('is-active')
      revealGroup(activeLink)
      if (scrollableContainer.scrollHeight > scrollableContainer.offsetHeight) {
        // Scroll to keep active item visible, centered if possible
        var containerHeight = scrollableContainer.offsetHeight
        var linkTop = activeLink.offsetTop - scrollableContainer.offsetTop
        var linkHeight = activeLink.offsetHeight
        var targetScroll = linkTop - containerHeight / 2 + linkHeight / 2
        scrollableContainer.scrollTop = Math.max(0, targetScroll)
      }
      lastActiveFragment = activeFragment
    } else if (lastActiveFragment) {
      links[lastActiveFragment].classList.remove('is-active')
      lastActiveFragment = undefined
    }
  }

  /**
   * Turn the flat TOC list into collapsible groups. Opt-in with :page-toc-collapsible: true.
   * Each level-1 entry becomes a group that holds the deeper entries following it, behind a
   * toggle button. A level-1 entry with nothing under it stays a plain entry. Only the first
   * group starts expanded; a group also opens whenever one of its entries becomes active (click,
   * scroll, or a hash change). The mobile dropdown clones this markup but shows everything; see
   * .toc.embedded in toc.css.
   * @param {HTMLUListElement} root - The <ul> built from the page headings, one <li> per heading.
   */
  function buildCollapsibleGroups (root) {
    var groups = []
    var groupList
    find('li', root).forEach(function (item) {
      if (parseInt(item.dataset.level, 10) === 1) {
        groupList = document.createElement('ul')
        groupList.id = 'toc-group-' + (groups.length + 1)
        groups.push({ item: item, list: groupList })
      } else if (groupList) {
        groupList.appendChild(item)
      }
    })
    var firstGroup
    groups.forEach(function (group) {
      if (!group.list.children.length) return
      var item = group.item
      item.classList.add('toc-group')
      var toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'toc-group-toggle'
      toggle.setAttribute('aria-expanded', 'false')
      toggle.setAttribute('aria-controls', group.list.id)
      toggle.setAttribute('aria-label', 'Toggle ' + item.textContent)
      toggle.addEventListener('click', function () {
        setGroupExpanded(item, !item.classList.contains('is-expanded'))
      })
      item.appendChild(toggle)
      item.appendChild(group.list)
      if (!firstGroup) firstGroup = item
    })
    if (firstGroup) setGroupExpanded(firstGroup, true)
  }

  /**
   * Expand or collapse a TOC group and keep its toggle's aria-expanded in sync.
   * @param {HTMLLIElement} group - A li.toc-group produced by buildCollapsibleGroups.
   * @param {boolean} expanded - True to expand the group, false to collapse it.
   */
  function setGroupExpanded (group, expanded) {
    if (expanded) {
      group.classList.add('is-expanded')
    } else {
      group.classList.remove('is-expanded')
    }
    var toggle = group.querySelector('.toc-group-toggle')
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  }

  /**
   * Expand the group that contains a TOC link so an active entry is never hidden.
   * No-op when the TOC is not collapsible or the link sits at the top level.
   * @param {HTMLAnchorElement} link - The TOC link that just became active.
   */
  function revealGroup (link) {
    if (!collapsible) return
    var el = link.parentNode
    while (el && el !== list) {
      if (el.classList && el.classList.contains('toc-group')) {
        setGroupExpanded(el, true)
        return
      }
      el = el.parentNode
    }
  }

  /**
   * Make the entry the URL hash names the active one, on load and on every hash
   * change, and open the group holding it.
   *
   * The hash is authoritative here rather than the scroll position, because the
   * two disagree. A browser parks a linked heading at scroll-padding-top plus
   * any scroll-margin-top on the heading, and onScroll's activation line is
   * scroll-padding-top alone; whenever the heading lands below that line the
   * scroll pass picks the heading above it and highlights the wrong entry. The
   * stylesheet now offsets once so the two line up, and this keeps the highlight
   * correct even if that ever drifts again.
   *
   * It also covers the case onScroll cannot see at all: an in-page link fires
   * hashchange, and a hash change does not always move the scroll position
   * enough to produce a scroll event.
   */
  function syncToHashTarget () {
    var hash = window.location.hash
    if (!hash) return
    var fragment = links[hash] ? hash : null
    if (!fragment && ~hash.indexOf('%')) {
      try {
        var decoded = decodeURIComponent(hash)
        if (links[decoded]) fragment = decoded
      } catch (e) {
        return
      }
    }
    if (!fragment) return
    setActive(fragment)
    holdScrollUpdates()
    scrollActiveIntoView()
  }

  function find (selector, from) {
    return [].slice.call((from || document).querySelectorAll(selector))
  }

  function getNumericStyleVal (el, prop) {
    return parseFloat(window.getComputedStyle(el)[prop])
  }
})()

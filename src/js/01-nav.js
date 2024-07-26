;(function () {
  'use strict'

  var SECT_CLASS_RX = /^sect(\d)$/

  var navContainer = document.querySelector('.nav-container')
  var navToggle = document.querySelector('.nav-toggle')
  var navCollapse = document.querySelector('.nav-collapse')
  var navExpand = document.querySelector('.nav-expand')
  var main = document.querySelector('main.article')
  var toolbar = document.querySelector('.toolbar')

  if (!navContainer) return

  var nav = navContainer.querySelector('.nav')

  if (navToggle) navToggle.addEventListener('click', showNav)
  if (navCollapse) navCollapse.addEventListener('click', function (e) { hideNav(e, true) })
  if (navExpand) navExpand.addEventListener('click', function (e) { showNav(e, true) })
  navContainer.addEventListener('click', trapEvent)

  var menuPanel = navContainer.querySelector('[data-panel=menu]')
  if (!menuPanel) return

  var explorePanel = navContainer.querySelector('[data-panel=explore]')

  var currentPageItem = menuPanel.querySelector('.is-current-page')
  var originalPageItem = currentPageItem
  var is404 = !!document.getElementById('page-404')
  if (currentPageItem && !is404) {
    activateCurrentPath(currentPageItem)
    scrollItemToMidpoint(currentPageItem.querySelector('.nav-link'))
  } else {
    menuPanel.scrollTop = 0
  }

  function findClosestChild (parent, selector) {
    return parent.querySelector(selector)
  }

  find(menuPanel, '.nav-item').forEach(function (element) {
    var div = findClosestChild(element, '.item')
    // Check if the nav item contains an external link
    var externalLink = div.querySelector('a[href^="https://"]')
    if (!externalLink) {
      // Only attach the toggleActive listener if it's not an external link
      div.addEventListener('click', toggleActive.bind(element))
    } else {
      div.addEventListener('click', function (event) {
        window.open(externalLink.href, '_blank')
        event.preventDefault()
      })
    }
    var navItemSpan = findNextElement(element, '.nav-text')
    if (navItemSpan) {
      navItemSpan.style.cursor = 'pointer'
      if (!externalLink) {
        navItemSpan.addEventListener('click', toggleActive.bind(element))
      } else {
        navItemSpan.addEventListener('click', function (event) {
          window.open(externalLink.href, '_blank')
          event.preventDefault()
        })
      }
    }
  })

  if (explorePanel) {
    explorePanel.querySelector('.context').addEventListener('click', function () {
      // NOTE logic assumes there are only two panels
      find(nav, '[data-panel]').forEach(function (panel) {
        panel.classList.toggle('is-active')
      })
    })
    // Get all the containers with the "has-dropdown" class
    const dropdownContainers = explorePanel.querySelectorAll('.context .container.has-dropdown')

    dropdownContainers.forEach((container) => {
      container.addEventListener('click', () => {
        container.classList.toggle('is-active')
      })
    })
    document.documentElement.addEventListener('click', function () {
      dropdownContainers.forEach((container) => {
        container.classList.remove('is-active')
      })
    })
  }

  // NOTE prevent text from being selected by double click
  menuPanel.addEventListener('mousedown', function (e) {
    if (e.detail > 1) e.preventDefault()
  })

  function onHashChange () {
    var navLink
    var hash = window.location.hash
    if (hash) {
      if (hash.indexOf('%')) hash = decodeURIComponent(hash)
      navLink = menuPanel.querySelector('.nav-link[href="' + hash + '"]')
      if (!navLink) {
        var targetNode = document.getElementById(hash.slice(1))
        if (targetNode) {
          var current = targetNode
          var ceiling = document.querySelector('article.doc')
          while ((current = current.parentNode) && current !== ceiling) {
            var id = current.id
            // NOTE: look for section heading
            if (!id && (id = SECT_CLASS_RX.test(current.className))) id = (current.firstElementChild || {}).id
            if (id && (navLink = menuPanel.querySelector('.nav-link[href="#' + id + '"]'))) break
          }
        }
      }
    }
    var navItem
    if (navLink) {
      navItem = navLink.parentNode
    } else if (originalPageItem) {
      navLink = (navItem = originalPageItem).querySelector('.nav-link')
    } else {
      return
    }
    var is404 = !!document.getElementById('page-404')
    if (is404) return
    if (navItem === currentPageItem) return
    find(menuPanel, '.nav-item.is-active').forEach(function (el) {
      el.classList.remove('is-active', 'is-current-path', 'is-current-page')
    })
    navItem.classList.add('is-current-page')
    currentPageItem = navItem
    activateCurrentPath(navItem)
    scrollItemToMidpoint(navLink)
  }

  if (menuPanel.querySelector('.nav-link[href^="#"]')) {
    if (window.location.hash) onHashChange()
    window.addEventListener('hashchange', onHashChange)
  }

  function activateCurrentPath (navItem) {
    var ancestorClasses
    var ancestor = navItem.parentNode
    while (!(ancestorClasses = ancestor.classList).contains('nav-menu')) {
      if (ancestor.tagName === 'LI' && ancestorClasses.contains('nav-item')) {
        ancestorClasses.add('is-active', 'is-current-path')
      }
      ancestor = ancestor.parentNode
    }
    navItem.classList.add('is-active')
  }

  function toggleActive (event) {
    var padding = parseFloat(window.getComputedStyle(this).marginTop)
    var rect = this.getBoundingClientRect()
    var menuPanelRect = menuPanel.getBoundingClientRect()
    var overflowY = (rect.bottom - menuPanelRect.top - menuPanelRect.height + padding).toFixed()
    if (event.target.className !== 'nav-link' || event.target.className !== 'nav-text') {
      this.classList.toggle('is-active')
      if (overflowY > 0) {
        menuPanel.scrollTop += Math.min((rect.top - menuPanelRect.top - padding).toFixed(), overflowY)
      }
      event.stopPropagation()
    } else {
      if (this.classList.toggle('is-active')) {
        if (overflowY > 0) {
          menuPanel.scrollTop += Math.min((rect.top - menuPanelRect.top - padding).toFixed(), overflowY)
        }
        const a = this.querySelector('a')
        if (a && a.href !== window.location.href) {
          window.location.href = a.href
        }
      }
    }
  }

  function showNav (e, collapse) {
    if (navToggle.classList.contains('is-active')) return hideNav(e)
    trapEvent(e)
    var html = document.documentElement
    if (!collapse) {
      html.classList.add('is-clipped--nav')
      navToggle.classList.add('is-active')
      navContainer.classList.add('is-active')
      var bounds = nav.getBoundingClientRect()
      var expectedHeight = window.innerHeight - Math.round(bounds.top)
      if (Math.round(bounds.height) !== expectedHeight) nav.style.height = expectedHeight + 'px'
      html.addEventListener('click', hideNav)
    } else {
      navContainer.classList.remove('hidden')
      navExpand.classList.add('hidden')
      if (toolbar) toolbar.style.paddingLeft = 'unset'
      main.style.width = 'unset'
    }
  }

  function hideNav (e, collapse) {
    trapEvent(e)
    var html = document.documentElement
    if (!collapse) {
      html.classList.remove('is-clipped--nav')
      navToggle.classList.remove('is-active')
      navContainer.classList.remove('is-active')
      nav.style.height = ''
      html.removeEventListener('click', hideNav)
    } else {
      navContainer.classList.add('hidden')
      navExpand.classList.remove('hidden')
      if (toolbar) toolbar.style.paddingLeft = '10px'
      main.style.width = '100%'
    }
  }

  function trapEvent (e) {
    e.stopPropagation()
  }

  function scrollItemToMidpoint (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  function find (from, selector) {
    return [].slice.call(from.querySelectorAll(selector))
  }

  function findNextElement (from, selector) {
    var el = from.nextElementSibling
    return el && selector ? el[el.matches ? 'matches' : 'msMatchesSelector'](selector) && el : el
  }
})()

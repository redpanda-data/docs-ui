/* global URLSearchParams */
/**
 * Solutions landing page: client-side filtering over the catalog the build
 * embedded (<script type="application/json" data-sol-catalog>), URL state
 * (?q= plus one parameter per facet in FACET_ATTR below: use-case, industry,
 * difficulty, platform), and the "Continue learning" section filled from the
 * progress store owned by 28-solution-progress.js.
 *
 * Search matches every query word at the start of a word in the title,
 * description, slug, step titles, technologies, categories, use cases,
 * industries, platforms and difficulty ("cdc" finds cdc-to-lakehouse,
 * "replay" finds the solutions with a replay step). A query word of one or
 * two letters must be a whole word ("dr" finds disaster recovery through
 * ALIASES, not "drive"). Filter counts are live: each option shows how many
 * cards would remain if it were ticked, given the search and the other
 * groups, and an option that would leave none is dimmed.
 *
 * The filter form lives in the sidebar (nav-tree-solution.hbs). Below 1024px
 * the sidebar is a drawer, so the form moves above the grid: an inline script
 * in solutions-home.hbs does it before first paint, and placeFilters() below
 * keeps it right when the viewport changes. Every selector here is
 * document-wide for that reason.
 *
 * Every card is already in the DOM (rendered from the same catalog), so this
 * module only shows and hides them; without JS the full list is visible.
 */
;(function () {
  'use strict'

  var results = document.querySelector('[data-sol-results]')
  if (!results) return

  // The one place a facet is declared: the URL parameter and checkbox name on
  // the left, the card attribute it reads on the right. Adding an axis is this
  // line plus a fieldset in solutions-filters.hbs and the attribute in
  // solution-card.hbs; the state, the URL and the clear button all follow from
  // here rather than repeating the list.
  var FACET_ATTR = {
    'use-case': 'data-use-cases',
    industry: 'data-industries',
    difficulty: 'data-difficulty',
    platform: 'data-platforms',
  }
  var FACETS = Object.keys(FACET_ATTR)

  // Parameters older links carry for groups the page no longer offers.
  // Search still covers what they named, so they are dropped from the URL
  // without a note: the page is not ignoring anything the reader can set.
  var RETIRED = ['category', 'tech']

  function toArray (list) {
    var out = []
    if (!list) return out
    for (var i = 0; i < list.length; i++) out.push(list[i])
    return out
  }

  function $ (selector, root) { return (root || document).querySelector(selector) }
  function $$ (selector, root) { return toArray((root || document).querySelectorAll(selector)) }

  var api = window.docsSolutions || null
  function track (name, props) { if (api && api.track) api.track(name, props) }

  // ---- catalog ---------------------------------------------------------------

  var catalog = { solutions: [] }
  var catalogEl = $('[data-sol-catalog]')
  if (catalogEl) {
    try {
      var parsed = JSON.parse(catalogEl.textContent || '{}')
      if (parsed && Array.isArray(parsed.solutions)) catalog = parsed
    } catch (e) { /* cards still render; search falls back to card attributes */ }
  }
  var byId = {}
  catalog.solutions.forEach(function (record) { if (record && record.id) byId[record.id] = record })

  var cards = $$('[data-sol-card]')

  // Lowercase, and every run of punctuation becomes one space, so a word
  // start is simply "after a space" and "event-driven" matches
  // "event driven".
  function normalize (text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  }

  // Abbreviations readers type that the catalog spells out: when the left
  // side appears in a solution's text, the right side becomes searchable too.
  var ALIASES = {
    kubernetes: 'k8s',
    'disaster recovery': 'dr',
    'high availability': 'ha',
    'change data capture': 'cdc',
    'schema registry': 'sr',
  }

  var haystackCache = {}
  function haystack (card) {
    var id = card.getAttribute('data-solution-id')
    if (haystackCache[id] !== undefined) return haystackCache[id]
    var record = byId[id]
    var parts = [card.getAttribute('data-title') || '', id || '']
    if (record) {
      parts.push(record.description || '')
      parts.push((record.technologies || []).join(' '))
      parts.push((record.categories || []).join(' '))
      parts.push((record.useCases || []).join(' '))
      parts.push((record.industries || []).join(' '))
      parts.push((record.platforms || []).join(' '))
      parts.push(record.difficulty || '')
      ;(record.steps || []).forEach(function (step) {
        if (step) parts.push((step.title || '') + ' ' + (step.id || ''))
      })
    } else {
      ;['data-technologies', 'data-categories', 'data-use-cases', 'data-industries', 'data-platforms', 'data-difficulty'].forEach(function (name) {
        parts.push((card.getAttribute(name) || '').replace(/\|/g, ' '))
      })
    }
    var hay = ' ' + normalize(parts.join(' '))
    Object.keys(ALIASES).forEach(function (word) {
      if (hay.indexOf(' ' + word) !== -1) hay += ' ' + ALIASES[word]
    })
    hay += ' '
    haystackCache[id] = hay
    return hay
  }

  function queryTokens (q) {
    var text = normalize(q)
    return text ? text.split(' ') : []
  }

  // The haystack starts and ends with a space, so " dr " is a whole word and
  // " repl" is a word start.
  function hasToken (hay, token) {
    return hay.indexOf(' ' + token + (token.length <= 2 ? ' ' : '')) !== -1
  }

  function values (card, facet) {
    var raw = card.getAttribute(FACET_ATTR[facet]) || ''
    return raw ? raw.split('|') : []
  }

  // ---- state -----------------------------------------------------------------

  function emptyState () {
    var blank = { q: '' }
    FACETS.forEach(function (facet) { blank[facet] = [] })
    return blank
  }

  var state = emptyState()
  var form = $('[data-sol-filters-form]')
  var qInput = $('[data-sol-filter-q]')
  var countEl = $('[data-sol-count]')
  var emptyEl = $('[data-sol-empty]')
  var activeEl = $('[data-sol-filters-active]')
  var droppedEl = $('[data-sol-dropped]')

  // The values a facet can take on this page: its rendered checkboxes.
  function optionsFor (facet) {
    return form ? $$('input[name="' + facet + '"]', form) : []
  }

  // Returns the raw values the URL carried that no checkbox offers (a typo,
  // a stale link, or a value the catalog has since gated out), or null when
  // the URL needs no rewrite. A value is matched without regard to case or
  // punctuation (?use-case=change-data-capture is "Change data capture").
  // An unknown value would filter invisibly, with nothing ticked to explain
  // the empty page, so it is dropped, the URL is rewritten without it, and
  // the results say which values were ignored.
  function readUrl () {
    var params
    try { params = new URLSearchParams(window.location.search) } catch (e) { return null }
    var dropped = []
    var rewrite = false
    state.q = params.get('q') || ''
    FACETS.forEach(function (facet) {
      var known = optionsFor(facet).map(function (el) { return el.value })
      var picked = []
      params.getAll(facet).forEach(function (value) {
        var canonical = null
        for (var i = 0; i < known.length; i++) {
          if (normalize(known[i]) === normalize(value)) canonical = known[i]
        }
        if (canonical !== null) {
          if (canonical !== value) rewrite = true
          if (picked.indexOf(canonical) === -1) picked.push(canonical)
        } else {
          rewrite = true
          if (value) dropped.push(value)
        }
      })
      state[facet] = picked
    })
    RETIRED.forEach(function (name) { if (params.has(name)) rewrite = true })
    return rewrite ? dropped : null
  }

  function showDropped (values) {
    if (!droppedEl) return
    droppedEl.hidden = !values || !values.length
    droppedEl.textContent = values && values.length
      ? (values.length === 1 ? 'Ignored unknown filter: ' : 'Ignored unknown filters: ') + values.join(', ')
      : ''
  }

  function writeUrl () {
    var params
    try { params = new URLSearchParams(window.location.search) } catch (e) { return }
    params.delete('q')
    FACETS.concat(RETIRED).forEach(function (facet) { params.delete(facet) })
    if (state.q) params.set('q', state.q)
    FACETS.forEach(function (facet) { state[facet].forEach(function (v) { params.append(facet, v) }) })
    var qs = params.toString()
    try {
      window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash)
    } catch (e) { /* ignore */ }
  }

  function readInputs () {
    if (!form) return
    state.q = qInput ? qInput.value.trim() : ''
    FACETS.forEach(function (facet) {
      state[facet] = $$('input[name="' + facet + '"]:checked', form).map(function (el) { return el.value })
    })
  }

  function applyInputs () {
    if (!form) return
    if (qInput) qInput.value = state.q
    FACETS.forEach(function (facet) {
      $$('input[name="' + facet + '"]', form).forEach(function (el) {
        el.checked = state[facet].indexOf(el.value) !== -1
      })
    })
  }

  function activeCount () {
    var n = state.q ? 1 : 0
    FACETS.forEach(function (facet) { n += state[facet].length })
    return n
  }

  // `skip` leaves one facet out, which is how the counts ask "how many would
  // match if this group's selection were different".
  function matches (card, skip) {
    if (state.q) {
      var hay = haystack(card)
      var tokens = queryTokens(state.q)
      for (var i = 0; i < tokens.length; i++) if (!hasToken(hay, tokens[i])) return false
    }
    for (var f = 0; f < FACETS.length; f++) {
      var facet = FACETS[f]
      if (facet === skip || !state[facet].length) continue
      var have = values(card, facet)
      var any = false
      for (var j = 0; j < state[facet].length; j++) if (have.indexOf(state[facet][j]) !== -1) any = true
      if (!any) return false
    }
    return true
  }

  function updateCounts () {
    FACETS.forEach(function (facet) {
      var pool = cards.filter(function (card) { return matches(card, facet) })
      optionsFor(facet).forEach(function (box) {
        var n = 0
        pool.forEach(function (card) { if (values(card, facet).indexOf(box.value) !== -1) n++ })
        var row = box.parentNode
        var count = row && row.querySelector ? $('.sol-filter-count', row) : null
        if (count) count.textContent = String(n)
        var empty = n === 0 && !box.checked
        if (row && row.classList) row.classList[empty ? 'add' : 'remove']('is-empty')
        // The visible count is aria-hidden; this is what a screen reader
        // hears after the label, and it says "no matches" rather than leaving
        // the dimmed color to say it.
        var sr = row && row.querySelector ? $('[data-sol-filter-sr]', row) : null
        if (sr) sr.textContent = empty ? '(no matches)' : '(' + n + ' matching)'
      })
    })
  }

  function apply () {
    var shown = 0
    cards.forEach(function (card) {
      var ok = matches(card)
      card.hidden = !ok
      if (ok) shown++
    })
    if (countEl) countEl.textContent = shown + (shown === 1 ? ' solution' : ' solutions')
    // With no cards at all the layout renders its own "none published yet"
    // state; "no solutions match your filters" would be wrong there.
    if (emptyEl) emptyEl.hidden = shown !== 0 || cards.length === 0
    updateCounts()
    var active = activeCount()
    $$('[data-sol-filters-clear]').forEach(function (el) { el.hidden = active === 0 })
    if (activeEl) {
      activeEl.hidden = active === 0
      activeEl.textContent = String(active)
    }
  }

  function clearAll () {
    state = emptyState()
    applyInputs()
    writeUrl()
    showDropped(null)
    apply()
  }

  // ---- continue learning -------------------------------------------------------

  // Where "Continue" goes: the first step, in the solution's order, that is
  // not done. currentStep is the last step visited, which after finishing a
  // step is the one just finished.
  function firstIncompleteStep (record, progress) {
    var steps = record.steps || []
    var done = progress.completedSteps || []
    for (var i = 0; i < steps.length; i++) {
      var id = steps[i].id
      var entry = progress.steps && progress.steps[id]
      var isDone = entry && typeof entry === 'object' ? entry.done === true : done.indexOf(id) !== -1
      if (!isDone) return id
    }
    return null
  }

  function stepUrl (record, stepId) {
    var steps = record.steps || []
    for (var i = 0; i < steps.length; i++) if (steps[i].id === stepId) return steps[i].url
    return null
  }

  function escapeHtml (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function renderContinue () {
    var section = $('[data-sol-continue]')
    var grid = $('[data-sol-continue-grid]')
    if (!section || !grid || !api || !api.getState) return
    var store = api.getState()
    var entries = []
    for (var id in store.solutions) {
      if (!Object.prototype.hasOwnProperty.call(store.solutions, id)) continue
      var progress = store.solutions[id]
      var record = byId[id]
      if (!record) continue
      var ids = (record.steps || []).map(function (s) { return s.id })
      var done = 0
      ids.forEach(function (stepId) { if (progress.completedSteps.indexOf(stepId) !== -1) done++ })
      if (!done && !progress.currentStep) continue
      entries.push({ record: record, progress: progress, done: done, total: ids.length })
    }
    entries.sort(function (a, b) { return (b.progress.updatedAt || 0) - (a.progress.updatedAt || 0) })
    entries = entries.slice(0, 6)
    if (!entries.length) {
      section.hidden = true
      return
    }
    var html = ''
    entries.forEach(function (entry) {
      var finished = entry.total > 0 && entry.done === entry.total
      var next = !finished && firstIncompleteStep(entry.record, entry.progress)
      var href = (next && stepUrl(entry.record, next)) || entry.record.url
      var pct = entry.total ? Math.round((entry.done / entry.total) * 100) : 0
      html += '<a class="sol-rec-card" href="' + escapeHtml(href) + '" data-sol-continue-card data-solution-id="' + escapeHtml(entry.record.id) + '">' +
        '<span class="sol-rec-eyebrow">' + (finished ? 'Completed' : 'In progress') + '</span>' +
        '<span class="sol-rec-title">' + escapeHtml(entry.record.title) + '</span>' +
        '<span class="sol-card-progress"><span class="sol-bar sol-bar--sm"><span class="sol-bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="sol-card-progress-text">' + entry.done + ' of ' + entry.total + ' steps</span></span>' +
        '</a>'
    })
    grid.innerHTML = html
    section.hidden = false

    // Per-card progress in the main grid too.
    cards.forEach(function (card) {
      var id = card.getAttribute('data-solution-id')
      var slot = $('[data-sol-card-progress]', card)
      if (!slot) return
      var match = null
      entries.forEach(function (entry) { if (entry.record.id === id) match = entry })
      if (!match) { slot.hidden = true; return }
      slot.hidden = false
      var fill = $('[data-sol-card-progress-fill]', slot)
      var text = $('[data-sol-card-progress-text]', slot)
      if (fill) fill.style.width = (match.total ? Math.round((match.done / match.total) * 100) : 0) + '%'
      if (text) text.textContent = match.done + ' of ' + match.total + ' steps'
    })
  }

  // ---- where the filters live -----------------------------------------------------

  // Sidebar from 1024px, above the grid (collapsed) below it. The inline
  // script in solutions-home.hbs made the first placement; this follows
  // viewport changes. A reader who opened or closed the narrow copy keeps
  // their choice while the viewport stays narrow.
  function placeFilters () {
    var filters = $('[data-sol-filters]')
    var home = $('[data-sol-filters-home]')
    var slot = $('[data-sol-filters-slot]')
    if (!filters || !home || !slot || typeof window.matchMedia !== 'function') return
    var mq = window.matchMedia('(max-width: 1023px)')
    var toggled = false
    filters.addEventListener('toggle', function () { if (mq.matches) toggled = true })
    var place = function () {
      if (mq.matches) {
        if (filters.parentNode !== slot) {
          if (!toggled) filters.open = false
          slot.appendChild(filters)
        }
      } else {
        filters.open = true
        if (filters.parentNode !== home) home.insertBefore(filters, home.firstChild || null)
      }
    }
    place()
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', place)
    else if (typeof mq.addListener === 'function') mq.addListener(place)
  }

  // ---- wire up ------------------------------------------------------------------

  var droppedFromUrl = readUrl()
  applyInputs()
  if (droppedFromUrl) {
    writeUrl()
    showDropped(droppedFromUrl)
  }
  apply()

  if (form) {
    var onEdit = function () { readInputs(); writeUrl(); showDropped(null); apply() }
    form.addEventListener('input', onEdit)
    form.addEventListener('change', onEdit)
  }
  $$('[data-sol-filters-clear]').forEach(function (el) { el.addEventListener('click', clearAll) })

  placeFilters()

  renderContinue()
  window.addEventListener('docs-solutions:change', renderContinue)

  track('solutions_landing_view', { count: cards.length, filters_active: activeCount() })
})()

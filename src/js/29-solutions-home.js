/* global URLSearchParams */
/**
 * Solutions landing page: client-side filtering over the catalog the build
 * embedded (<script type="application/json" data-sol-catalog>), URL state
 * (?q= plus one parameter per facet in FACET_ATTR below: use-case, industry,
 * category, difficulty, tech, platform), and the "Continue learning" section
 * filled from the progress store owned by 28-solution-progress.js.
 *
 * Search matches every query word at the start of a word in the title,
 * description, slug, technologies, categories, use cases, industries,
 * platforms and difficulty ("cdc" finds cdc-to-lakehouse, "dr" does not find
 * a description that merely contains "android"). Filter counts are live: each
 * option shows how many cards would remain if it were ticked, given the
 * search and the other groups, and an option that would leave none is dimmed.
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
    category: 'data-categories',
    difficulty: 'data-difficulty',
    tech: 'data-technologies',
    platform: 'data-platforms',
  }
  var FACETS = Object.keys(FACET_ATTR)

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

  // Abbreviations readers type that the catalog spells out.
  var ALIASES = { kubernetes: 'k8s' }

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
    } else {
      ;['data-technologies', 'data-categories', 'data-use-cases', 'data-industries', 'data-platforms', 'data-difficulty'].forEach(function (name) {
        parts.push((card.getAttribute(name) || '').replace(/\|/g, ' '))
      })
    }
    var hay = ' ' + normalize(parts.join(' '))
    Object.keys(ALIASES).forEach(function (word) {
      if (hay.indexOf(' ' + word) !== -1) hay += ' ' + ALIASES[word]
    })
    haystackCache[id] = hay
    return hay
  }

  function queryTokens (q) {
    var text = normalize(q)
    return text ? text.split(' ') : []
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

  // The values a facet can take on this page: its rendered checkboxes.
  function optionsFor (facet) {
    return form ? $$('input[name="' + facet + '"]', form) : []
  }

  // Returns true when the URL carried a facet value with no checkbox (a stale
  // link, or a value the catalog has since gated out). Such a value would
  // filter invisibly, with nothing ticked to explain the empty page, so it
  // is dropped and the URL is rewritten without it.
  function readUrl () {
    var params
    try { params = new URLSearchParams(window.location.search) } catch (e) { return false }
    var dropped = false
    state.q = params.get('q') || ''
    FACETS.forEach(function (facet) {
      var known = optionsFor(facet).map(function (el) { return el.value })
      state[facet] = params.getAll(facet).filter(function (value) {
        if (value && known.indexOf(value) !== -1) return true
        dropped = true
        return false
      })
    })
    return dropped
  }

  function writeUrl () {
    var params
    try { params = new URLSearchParams(window.location.search) } catch (e) { return }
    params.delete('q')
    FACETS.forEach(function (facet) { params.delete(facet) })
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
      for (var i = 0; i < tokens.length; i++) if (hay.indexOf(' ' + tokens[i]) === -1) return false
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
        if (row && row.classList) row.classList[n === 0 && !box.checked ? 'add' : 'remove']('is-empty')
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

  // ---- wire up ------------------------------------------------------------------

  var droppedFromUrl = readUrl()
  applyInputs()
  if (droppedFromUrl) writeUrl()
  apply()

  if (form) {
    form.addEventListener('input', function () { readInputs(); writeUrl(); apply() })
    form.addEventListener('change', function () { readInputs(); writeUrl(); apply() })
  }
  $$('[data-sol-filters-clear]').forEach(function (el) { el.addEventListener('click', clearAll) })

  if (api && api.manageDetails) api.manageDetails('[data-sol-filters]')

  renderContinue()
  window.addEventListener('docs-solutions:change', renderContinue)

  track('solutions_landing_view', { count: cards.length, filters_active: activeCount() })
})()

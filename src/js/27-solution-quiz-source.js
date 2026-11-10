/**
 * Solutions quiz: the step the reader is looking at, as text for the quiz.
 *
 * "Quiz me on this step" (28-solution-progress.js) sends this text to the
 * drawer, which puts it in the quiz's customInstructions as STEP SOURCE
 * (react/chatModes.js). The model asks its questions from that text alone, so
 * the quiz works whether or not Kapa has indexed the page, and it quizzes on
 * the version of the step the reader has open.
 *
 * What is read, from article.doc:
 *  - #preamble and every direct .sect1 child, except the sections that hold
 *    files and the production guide, and the Take this to production card
 *    (SKIP_SECTIONS). Those headings are fixed by the redpanda-solutions
 *    CONTRIBUTING guide and the card's partial. Any other section a writer
 *    adds is read too, so there is no list of sections to keep up to date.
 *  - Only the selected tab of a tab set, labelled "(tab: <name>)".
 *  - Collapsed <details> blocks, labelled "(collapsed: <summary>)".
 *  - Not the page chrome inside the article: code block toolboxes, buttons,
 *    anything aria-hidden or hidden, and callout markers in code.
 *
 * How it is written: h2 becomes ###, h3 becomes ####, paragraphs and list
 * items are kept as lines, tables as one line per row, admonitions as
 * "NOTE: ...". Links keep their text. A code block keeps its first
 * CODE_MAX_LINES lines, except in Verify, where the expected output is the
 * point of the section.
 *
 * Over QUIZ_SOURCE_MAX_CHARS, parts are shortened or left out in TRIM_ORDER,
 * one step at a time until the text fits. The preamble, Why this approach,
 * Verify and the prose of Build it are never left out: the quiz's
 * questions come from them. A page that is still over the cap after every
 * step is sent as it is, and the corpus test reports it, up to
 * QUIZ_SOURCE_HARD_MAX_CHARS. Past that, as a last resort, Verify code keeps
 * its first VERIFY_MAX_LINES lines, and then the text is cut, so one step
 * with a very long Verify output cannot grow the request without limit.
 *
 * Page text cannot close the STEP SOURCE block early: anything that reads as
 * a marker, however many angle brackets or whatever whitespace it has, is
 * escaped, and so is every metadata line written before the block.
 *
 * Exposed as window.__solutionQuiz, and as module.exports so the tests can run
 * it over rendered pages (tests/solution-quiz).
 */
;(function () {
  'use strict'

  var QUIZ_SOURCE_MAX_CHARS = 8000
  var QUIZ_SOURCE_HARD_MAX_CHARS = 12000
  var CODE_MAX_LINES = 15
  var VERIFY_MAX_LINES = 40
  // take-to-production is the UI's own card on the last step
  // (solution-productionize.hbs), a sect1 so On this page lists it.
  var SKIP_SECTIONS = ['files-for-this-step', 'production-considerations', 'take-to-production']
  // Section ids are matched by prefix, so "what-happens" also covers a
  // writer's "What happens when you run it".
  var TRIM_ORDER = [
    { name: 'what-happens-code', ids: ['what-happens'], codeOnly: true },
    { name: 'what-happens', ids: ['what-happens'] },
    { name: 'in-production', ids: ['in-production'] },
    { name: 'extend-and-clean-up', ids: ['extend-this-solution', 'clean-up'] },
    // Build it is mostly commands and their expected output. Its prose says
    // what each command is for, so the code goes first, a little at a time.
    // Older builds title it What you do (what-you-do); the step names keep
    // that id so the trimmed list reads the same for both.
    { name: 'what-you-do-code-short', ids: ['build-it', 'what-you-do'], codeLines: 5 },
    { name: 'what-you-do-code', ids: ['build-it', 'what-you-do'], codeOnly: true },
  ]
  var KEEP_CODE_WHOLE = ['verify']
  var ADMONITIONS = ['note', 'tip', 'important', 'warning', 'caution']
  var BEGIN = '<<<STEP SOURCE BEGIN>>>'
  var END = '<<<STEP SOURCE END>>>'

  function inline (el) {
    return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim()
  }

  function matches (id, prefixes) {
    for (var i = 0; i < prefixes.length; i++) {
      if (id.indexOf(prefixes[i]) === 0) return true
    }
    return false
  }

  function slug (text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  }

  function each (root, selector, fn) {
    Array.prototype.slice.call(root.querySelectorAll(selector)).forEach(fn)
  }

  function remove (el) {
    if (el && el.parentNode) el.parentNode.removeChild(el)
  }

  function marker (doc, text) {
    var p = doc.createElement('p')
    p.textContent = text
    return p
  }

  // Strip what the reader does not read as the step, in place on a clone.
  function clean (root) {
    var doc = root.ownerDocument
    // Callout markers: <i class="conum"></i><b>(1)</b>, or <b class="conum">.
    each(root, '.conum + b', remove)
    each(root, '.source-toolbox, button, [aria-hidden="true"], .conum, script, style, svg, img, template', remove)

    // Tabs (@asciidoctor/tabs): keep the panel of the selected tab, or of the
    // first tab before the tabs script has run.
    each(root, '.tabs', function (tabs) {
      var list = Array.prototype.slice.call(tabs.querySelectorAll('.tablist .tab, [role="tab"]'))
      if (!list.length) return
      var selected = list.filter(function (t) {
        return t.classList.contains('is-selected') || t.getAttribute('aria-selected') === 'true'
      })[0] || list[0]
      each(tabs, '.tabpanel', function (panel) {
        if (panel.getAttribute('aria-labelledby') !== selected.id) return remove(panel)
        panel.insertBefore(marker(doc, '(tab: ' + inline(selected) + ')'), panel.firstChild)
      })
      each(tabs, '.tablist', remove)
    })
    // Hidden content is not what the reader sees. After the tabs, so a
    // selected panel the tabs script has not shown yet is still read.
    each(root, '[hidden], [style*="display:none"], [style*="display: none"]', remove)

    // A closed <details> still holds its text. Say it was collapsed, so the
    // model does not build a question on something the reader may not have
    // opened without saying where it is.
    each(root, 'details', function (details) {
      var summary = details.querySelector('summary')
      var label = inline(summary)
      remove(summary)
      var text = details.hasAttribute('open') ? label : '(collapsed: ' + label + ')'
      if (text) details.insertBefore(marker(doc, text), details.firstChild)
    })
  }

  function fence (lines, max) {
    if (max && lines.length > max) lines = lines.slice(0, max).concat('[code shortened]')
    return '```\n' + lines.join('\n') + '\n```'
  }

  function codePart (pre, whole) {
    var lines = String(pre.textContent || '').replace(/\s+$/, '').split('\n')
    return { kind: 'code', lines: lines, whole: !!whole, text: fence(lines, whole ? 0 : CODE_MAX_LINES) }
  }

  function textPart (text) {
    return { kind: 'text', text: text }
  }

  function admonitionType (el) {
    for (var i = 0; i < ADMONITIONS.length; i++) {
      if (el.classList.contains(ADMONITIONS[i])) return ADMONITIONS[i].toUpperCase()
    }
    return 'NOTE'
  }

  // List items: the item's first line carries the marker, and anything else
  // in the item (more paragraphs, a nested list) is indented under it. Code
  // keeps its own fences.
  function renderList (list, parts, ctx) {
    var n = 0
    var ordered = list.tagName.toLowerCase() === 'ol'
    Array.prototype.slice.call(list.children).forEach(function (li) {
      if (li.tagName.toLowerCase() !== 'li') return
      n++
      var mark = ordered ? n + '. ' : '- '
      var inner = []
      if (li.children.length) render(li, inner, ctx)
      else if (inline(li)) inner.push(textPart(inline(li)))
      var first = true
      inner.forEach(function (part) {
        if (part.kind === 'text') {
          part.text = (first ? mark : '  ') + part.text
          first = false
        }
        parts.push(part)
      })
    })
  }

  function renderTable (table, parts) {
    var caption = table.querySelector('caption')
    if (inline(caption)) parts.push(textPart(inline(caption)))
    each(table, 'tr', function (tr) {
      var cells = Array.prototype.slice.call(tr.children).map(inline).filter(Boolean)
      if (cells.length) parts.push(textPart('- ' + cells.join(' | ')))
    })
  }

  function render (node, parts, ctx) {
    Array.prototype.slice.call(node.children).forEach(function (el) {
      var tag = el.tagName.toLowerCase()
      var cls = el.classList
      if (tag === 'h2') return
      if (tag === 'h3') return parts.push(textPart('#### ' + inline(el)))
      if (/^h[4-6]$/.test(tag)) return parts.push(textPart('##### ' + inline(el)))
      if (tag === 'pre') return parts.push(codePart(el, ctx.codeWhole))
      if (tag === 'p') return inline(el) && parts.push(textPart(inline(el)))
      if (tag === 'ul' || tag === 'ol') return renderList(el, parts, ctx)
      if (tag === 'table') return renderTable(el, parts)
      if (tag === 'dl') {
        var term = ''
        Array.prototype.slice.call(el.children).forEach(function (d) {
          if (d.tagName.toLowerCase() === 'dt') term = inline(d)
          else if (d.tagName.toLowerCase() === 'dd') parts.push(textPart('- ' + term + ': ' + inline(d)))
        })
        return
      }
      if (cls.contains('admonitionblock')) {
        var content = el.querySelector('.content') || el
        return parts.push(textPart(admonitionType(el) + ': ' + inline(content)))
      }
      if (cls.contains('imageblock') || cls.contains('videoblock') || cls.contains('mermaid')) return
      if (cls.contains('title') && !el.children.length) return inline(el) && parts.push(textPart(inline(el)))
      render(el, parts, ctx)
    })
  }

  function assemble (sections) {
    return sections.map(function (s) {
      var lines = s.title ? ['### ' + s.title] : []
      if (s.omitted) lines.push('[section left out for length]')
      else {
        s.parts.forEach(function (p) {
          lines.push(p.omitted ? '[code left out for length]' : p.text)
        })
      }
      return lines.join('\n')
    }).join('\n\n')
  }

  // Zero-width characters are dropped first, so they cannot hide a marker
  // from the pattern. Safe to run twice: an escaped marker has two brackets.
  function escapeMarkers (text) {
    return String(text || '')
      .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
      .replace(/<{3,}(\s*STEP\s+SOURCE\s+(?:BEGIN|END)\s*)>{3,}/gi, '<<$1>>')
  }

  // One metadata line: whitespace collapsed, so a value cannot start a line
  // of its own, and markers escaped.
  function flat (value) {
    return escapeMarkers(String(value || '').replace(/\s+/g, ' ').trim())
  }

  // The step as text: { text, chars, sections: [{ id, title }], truncated,
  // trimmed }. `sections` are the h2 sections read, for the quiz's section
  // links. `trimmed` names the TRIM_ORDER steps that were needed.
  function extractStepSource (article, opts) {
    var max = (opts && opts.maxChars) || QUIZ_SOURCE_MAX_CHARS
    var hardMax = Math.max(max, (opts && opts.hardMaxChars) || QUIZ_SOURCE_HARD_MAX_CHARS)
    if (!article) return { text: '', chars: 0, sections: [], truncated: false, trimmed: [] }
    var root = article.cloneNode(true)
    clean(root)

    var sections = []
    var children = Array.prototype.slice.call(root.children)
    var preamble = children.filter(function (el) { return el.id === 'preamble' })[0]
    var sect1s = children.filter(function (el) { return el.classList.contains('sect1') })
    if (preamble) {
      var pre = []
      render(preamble, pre, {})
      sections.push({ id: 'preamble', title: null, parts: pre })
    }
    sect1s.forEach(function (sect) {
      var h2 = Array.prototype.slice.call(sect.children).filter(function (el) { return el.tagName.toLowerCase() === 'h2' })[0]
      var title = inline(h2)
      var id = (h2 && h2.id) || sect.id || slug(title)
      if (SKIP_SECTIONS.indexOf(id) !== -1) return
      var parts = []
      render(sect, parts, { codeWhole: matches(id, KEEP_CODE_WHOLE) })
      sections.push({ id: id, title: title, parts: parts })
    })
    // A page with no sections at all is one block of text.
    if (!preamble && !sect1s.length) {
      var all = []
      render(root, all, {})
      sections.push({ id: 'preamble', title: null, parts: all })
    }

    var text = escapeMarkers(assemble(sections))
    var trimmed = []
    for (var i = 0; i < TRIM_ORDER.length && text.length > max; i++) {
      var step = TRIM_ORDER[i]
      var hit = false
      sections.forEach(function (s) {
        if (s.id === 'preamble' || !matches(s.id, step.ids)) return
        if (step.codeLines) {
          s.parts.forEach(function (p) {
            if (p.kind !== 'code' || p.whole || p.omitted || p.lines.length <= step.codeLines) return
            p.text = fence(p.lines, step.codeLines)
            hit = true
          })
        } else if (step.codeOnly) {
          s.parts.forEach(function (p) {
            if (p.kind === 'code' && !p.omitted) { p.omitted = true; hit = true }
          })
        } else if (!s.omitted) {
          s.omitted = true
          hit = true
        }
      })
      if (hit) {
        trimmed.push(step.name)
        text = escapeMarkers(assemble(sections))
      }
    }

    // The last resort, past the hard cap only.
    if (text.length > hardMax) {
      var shortened = false
      sections.forEach(function (s) {
        if (!matches(s.id, KEEP_CODE_WHOLE)) return
        s.parts.forEach(function (p) {
          if (p.kind !== 'code' || p.omitted || p.lines.length <= VERIFY_MAX_LINES) return
          p.text = fence(p.lines, VERIFY_MAX_LINES)
          shortened = true
        })
      })
      if (shortened) {
        trimmed.push('verify-code-short')
        text = escapeMarkers(assemble(sections))
      }
    }
    if (text.length > hardMax) {
      var cut = text.lastIndexOf('\n', hardMax)
      text = text.slice(0, cut > hardMax / 2 ? cut : hardMax) + '\n[rest of the step left out for length]'
      trimmed.push('cut')
    }

    return {
      text: text,
      chars: text.length,
      sections: sections.filter(function (s) { return s.title }).map(function (s) { return { id: s.id, title: s.title } }),
      truncated: trimmed.length > 0,
      trimmed: trimmed,
    }
  }

  // The STEP SOURCE block for the quiz prompt. `meta` describes the step;
  // empty fields leave their line out.
  function stepSourceBlock (meta, source) {
    var m = meta || {}
    var s = source || { text: '', sections: [] }
    var page = m.url || ''
    var lines = ['## STEP SOURCE']
    var ids = [m.solutionId, m.version].filter(Boolean).join(', ')
    if (m.solutionTitle || ids) lines.push('Solution: ' + flat(m.solutionTitle || m.solutionId) + (ids ? ' (' + flat(ids) + ')' : ''))
    if (m.stepIndex && m.stepCount) lines.push('Step ' + flat(m.stepIndex) + ' of ' + flat(m.stepCount) + ': ' + flat(m.stepTitle))
    else if (m.stepTitle) lines.push('Step: ' + flat(m.stepTitle))
    if (page) lines.push('Page: ' + flat(page))
    if (m.rule) lines.push('Rule this step establishes: ' + flat(m.rule))
    if (m.adapt) lines.push('What to change when you adapt it: ' + flat(m.adapt))
    if (s.sections && s.sections.length && page) {
      lines.push('Section links:')
      s.sections.forEach(function (sec) { lines.push('- ' + flat(sec.title) + ': ' + flat(page) + '#' + flat(sec.id)) })
    }
    lines.push(BEGIN, escapeMarkers(s.text || ''), END)
    return lines.join('\n')
  }

  // Everything the quiz needs from the page the button is on. `loc` is
  // window.location; the page URL is absolute, from its origin, so section
  // links work on previews as well as production.
  function quizSource (doc, button, loc) {
    var body = doc.body
    var data = function (el, name) { return (el && el.getAttribute(name)) || '' }
    var article = doc.querySelector('article.doc')
    var source = extractStepSource(article)
    var h1 = doc.querySelector('h1.page, article.doc h1, h1')
    var meta = {
      solutionTitle: data(body, 'data-solution-title'),
      solutionId: data(body, 'data-solution-id'),
      version: data(body, 'data-solution-version'),
      stepIndex: data(body, 'data-step-index'),
      stepCount: data(body, 'data-solution-step-count'),
      stepTitle: data(button, 'data-quiz-title') || inline(h1),
      url: loc ? (loc.origin || '') + loc.pathname : '',
      rule: data(button, 'data-quiz-rule'),
      adapt: data(button, 'data-quiz-adapt'),
    }
    return { block: stepSourceBlock(meta, source), source: source, meta: meta }
  }

  var api = {
    QUIZ_SOURCE_MAX_CHARS: QUIZ_SOURCE_MAX_CHARS,
    QUIZ_SOURCE_HARD_MAX_CHARS: QUIZ_SOURCE_HARD_MAX_CHARS,
    CODE_MAX_LINES: CODE_MAX_LINES,
    VERIFY_MAX_LINES: VERIFY_MAX_LINES,
    escapeMarkers: escapeMarkers,
    SKIP_SECTIONS: SKIP_SECTIONS,
    extractStepSource: extractStepSource,
    stepSourceBlock: stepSourceBlock,
    quizSource: quizSource,
  }
  if (typeof window !== 'undefined') window.__solutionQuiz = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()

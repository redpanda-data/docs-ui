/**
 * Complete source blocks that repeat a listing (body.solution, body.solution-step).
 *
 * A solution step ends its == Files for this step section with one collapsed
 * block per file, titled "Complete source: <path>" (the redpanda-solutions
 * build-along rule). When the page already showed that whole file earlier, in
 * a listing titled with the same path or annotated with the same
 * data-solution-file and no data-solution-tag, the collapsed block repeats it
 * line for line. This module replaces such a block with a one-line pointer to
 * the earlier listing, so the Files section still says where the file is and
 * the page shows the file once.
 *
 * The match is strict: the same path and the same code, compared after
 * dropping trailing whitespace. A tagged excerpt, a line range, or a listing
 * with callouts differs from the whole file, so its Complete source block
 * stays. Only a details that holds a single listing and nothing else is
 * considered, which is how Asciidoctor renders the [%collapsible] block.
 *
 * Runs before 28-solution-progress.js (file order), which adds Download
 * controls to listings, and 30-solution-code-fold.js, which decorates
 * details and folds long listings.
 */
;(function () {
  'use strict'

  var body = document.body
  if (!body || !body.classList) return
  if (!body.classList.contains('solution') && !body.classList.contains('solution-step')) return

  var TITLE = /^\s*Complete source:\s*(\S(?:.*\S)?)\s*$/

  function toArray (list) {
    var out = []
    if (!list) return out
    for (var i = 0; i < list.length; i++) out.push(list[i])
    return out
  }

  function hasClass (el, name) {
    return !!(el && el.classList && el.classList.contains(name))
  }

  function isDetails (el) {
    return !!(el && el.tagName && String(el.tagName).toUpperCase() === 'DETAILS')
  }

  function childWithClass (el, name) {
    return toArray(el && el.children).filter(function (c) { return hasClass(c, name) })[0] || null
  }

  // textContent, falling back to the children's text for DOM stand-ins that
  // keep text only on leaf nodes.
  function textOf (el) {
    if (!el) return ''
    if (el.textContent) return el.textContent
    return toArray(el.children).map(textOf).join('')
  }

  function insideDetails (el) {
    for (var node = el && el.parentNode; node && node !== document; node = node.parentNode) {
      if (isDetails(node)) return true
    }
    return false
  }

  function codeOf (block) {
    var content = childWithClass(block, 'content')
    var pre = content && content.querySelector('pre')
    if (!pre) return null
    var code = pre.querySelector('code') || pre
    return String(textOf(code)).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '')
  }

  // The path a listing names: its title, else its data-solution-file when it
  // is a whole-file include (no tag).
  function namesPath (block, path) {
    var title = childWithClass(block, 'title')
    if (title && textOf(title).trim() === path) return true
    return block.getAttribute('data-solution-file') === path && !block.hasAttribute('data-solution-tag')
  }

  // The Complete source path of a details that holds one listing and nothing
  // else, or null.
  function completeSource (details) {
    var summary = toArray(details.children).filter(function (c) { return String(c.tagName).toUpperCase() === 'SUMMARY' })[0]
    var m = summary && TITLE.exec(textOf(summary))
    if (!m) return null
    var content = childWithClass(details, 'content')
    var blocks = content ? toArray(content.children) : []
    if (blocks.length !== 1 || !hasClass(blocks[0], 'listingblock')) return null
    return { path: m[1], block: blocks[0] }
  }

  function anchorFor (block, path) {
    var id = block.getAttribute('id')
    if (id) return id
    id = 'sol-source-' + path.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    var n = 1
    var candidate = id
    while (document.getElementById(candidate)) candidate = id + '-' + ++n
    block.setAttribute('id', candidate)
    return candidate
  }

  function pointer (path, id) {
    var wrap = document.createElement('div')
    wrap.className = 'paragraph sol-complete-source-ref'
    wrap.setAttribute('data-sol-complete-source-ref', path)
    var p = document.createElement('p')
    var link = document.createElement('a')
    link.setAttribute('href', '#' + id)
    var code = document.createElement('code')
    code.textContent = path
    link.appendChild(code)
    p.appendChild(document.createTextNode('Complete source: '))
    p.appendChild(link)
    p.appendChild(document.createTextNode(', shown in full above.'))
    wrap.appendChild(p)
    return wrap
  }

  // Returns the paths whose Complete source block was replaced.
  function dedupe (root) {
    var scope = root || document
    var article = scope.querySelector('article.doc') || scope
    var shown = []
    var replaced = []
    toArray(article.querySelectorAll('.listingblock, details')).forEach(function (el) {
      if (isDetails(el)) {
        var cs = completeSource(el)
        if (!cs) return
        var code = codeOf(cs.block)
        if (code === null) return
        var earlier = shown.filter(function (block) { return namesPath(block, cs.path) && codeOf(block) === code })[0]
        if (!earlier || !el.parentNode) return
        el.parentNode.replaceChild(pointer(cs.path, anchorFor(earlier, cs.path)), el)
        replaced.push(cs.path)
        return
      }
      if (!insideDetails(el)) shown.push(el)
    })
    return replaced
  }

  window.docsSolutionsCompleteSource = { dedupe: dedupe }

  dedupe(document)
})()

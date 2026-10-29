/**
 * Solutions: the "Take this to production" card on a solution's last step
 * (partials/solution-productionize.hbs).
 *
 * The card offers three ways to apply the design to the reader's own system:
 *  - Plan it with Ask AI. The drawer runs in productionize mode
 *    (react/chatModes.js) on its own Kapa integration, grounded on the
 *    solution's agent companion. The companion is a core file,
 *    agent-companion.md, and, for most solutions, part files,
 *    agent-companion-part-<n>.md, that hold the Design contract, Production
 *    gaps and Reference build; Step 2 of the core's How to use this lists
 *    them. When the reader clicks, the core and every part are fetched,
 *    merged back into one document (each "## X (continued)" folded into its
 *    "## X"), sliced into sections, and handed to the drawer: the Rules and
 *    the names of the Production gaps topics go into the prompt, and every
 *    section is available to the get_solution_guide tool
 *    (react/agentTools.js), which reads it from the provider context and
 *    never sends the whole companion to Kapa. An older build serves the
 *    companion as one file with no parts list, and is read as it is.
 *  - Copy prompt for your coding agent. A short pointer: use the
 *    redpanda-solutions skill if it is installed, otherwise download the
 *    companion with curl and follow its How to use this, which holds the
 *    procedure. The docs MCP server cannot return a solution's companion, so
 *    the prompt never says it can.
 *  - Install the Redpanda skills for Claude Code, shown only when the
 *    playbook sets solutions-skill-install under site.keys (see the
 *    partial), and Connect the docs MCP server. Static text in the partial.
 *
 * The companion links hardcode https://docs.redpanda.com/solutions/
 * (agent-companion.js in the docs extensions), so every solution link in it is
 * rewritten to this page's origin, and a preview reads and links its own
 * pages.
 *
 * The whole card needs a signed-in reader. Signed out, and without this
 * script, it shows only its title, a sentence on what signing in gives, and
 * Sign in, which opens the sign-in modal with a return to this card. The rest
 * of the card ships with the hidden attribute and is shown once the reader is
 * signed in, including a sign-in learned after load (kapa-session); the
 * prompt text is written into the page only then. The UI preview has no
 * backend, so it shows the signed-out card unless the rp_docs_auth=1 cookie
 * is set by hand.
 *
 * The Plan it button also needs a productionize integration: with
 * KAPA_PRODUCTIONIZE_INTEGRATION_ID set to '' it is hidden. When the
 * companion cannot be fetched, the core or any one of its parts, it is
 * hidden too, and a note says the prompt still works: a guide with sections
 * missing is never offered.
 *
 * Exposed as window.__solutionProductionize, and as module.exports so the
 * tests can run the slicer and the prompt on real companions
 * (tests/solution-productionize).
 */
;(function () {
  'use strict'

  var CARD_ID = 'take-to-production'
  var PROD_SOLUTIONS = 'https://docs.redpanda.com/solutions/'
  // The companion's fixed headings (agent-companion.js in the docs extensions).
  var RULES = 'Rules'
  var DESIGN_CONTRACT = 'Design contract'
  var PRODUCTION_GAPS = 'Production gaps'
  // Whole top-level sections get_solution_guide returns by name, in the
  // order the prompt lists them (GUIDE_WHOLE_SECTIONS in react/chatModes.js).
  var WHOLE_SECTIONS = ['What the system must do', 'Adapt', 'System map', 'Acceptance', 'Canonical docs', 'Reference build']
  // The Production gaps text before its first topic (### heading), such as a
  // per-service ACL table, returned as a section of its own.
  var GAPS_OVERVIEW = PRODUCTION_GAPS + ': overview'
  // get_solution_guide returns at most GUIDE_SECTION_MAX_CHARS (6000) of a
  // section (react/agentTools.js), and the Kapa agent cannot open a URL, so a
  // longer section is split here and every piece stays whole. The margin
  // leaves room for the note the tool adds that names the next piece.
  var SECTION_SPLIT_AT = 5500
  // Where a gap topic links when the last step has no heading for it.
  var GAPS_ANCHOR = 'production-considerations'
  var MODE = 'productionize'

  function norm (s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
  }

  function slug (s) {
    return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  }

  function trimLines (lines) {
    return lines.join('\n').replace(/^\s+|\s+$/g, '')
  }

  // Every solution link in the companion, pointed at `origin`.
  function rewriteHost (text, origin) {
    if (!origin) return String(text || '')
    return String(text || '').split(PROD_SOLUTIONS).join(String(origin).replace(/\/+$/, '') + '/solutions/')
  }

  // The part files a split companion lists in Step 2 of its How to use this,
  // as { number, url }, sorted by number. Only same-origin URLs at
  // /solutions/<slug>/agent-companion-part-<n>.md are kept, so the page never
  // fetches a URL the companion chose. `split` is true when How to use this
  // names any part file at all, kept or not: an unsplit companion (an older
  // build or preview) names none. Call it after rewriteHost, which points the
  // generator's https://docs.redpanda.com links at this origin.
  function companionParts (md, origin, solution) {
    var how = topSection(sliceCompanion(md), 'How to use this')
    var text = how ? how.text : ''
    var base = String(origin || '').replace(/\/+$/, '')
    var rx = /[^\s`<>()[\]]*agent-companion-part-\d+\.md/g
    var seen = {}
    var parts = []
    var split = false
    var match
    while ((match = rx.exec(text))) {
      split = true
      var url
      try { url = new URL(match[0], base + '/') } catch (e) { continue }
      var n = new RegExp('^/solutions/' + String(solution).replace(/[^A-Za-z0-9_-]/g, '\\$&') +
        '/agent-companion-part-([1-9]\\d*)\\.md$').exec(url.pathname)
      if (!n || url.origin !== base || url.search || url.hash || seen[n[1]]) continue
      seen[n[1]] = true
      parts.push({ number: Number(n[1]), url: url.href })
    }
    parts.sort(function (a, b) { return a.number - b.number })
    return { split: split || /not the whole companion/.test(text), parts: parts }
  }

  // Markdown as its ## sections, fence-aware like sliceCompanion: the lines
  // before the first ##, then one { title, lines } per ## heading.
  function h2Sections (md) {
    var head = []
    var sections = []
    var cur = null
    var fence = null
    String(md || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var marker = /^\s*(```+|~~~+)/.exec(line)
      if (marker) {
        if (!fence) fence = marker[1].charAt(0)
        else if (marker[1].charAt(0) === fence) fence = null
      }
      var heading = !fence && !marker ? /^## (.+?)\s*#*\s*$/.exec(line) : null
      if (heading) {
        cur = { title: heading[1], lines: [] }
        sections.push(cur)
        return
      }
      ;(cur ? cur.lines : head).push(line)
    })
    return { head: head, sections: sections }
  }

  // A split companion as one document: the core file, then every part's
  // sections in order, each part's header and pointer line dropped and every
  // "## X (continued)" folded back into its "## X". sliceCompanion then reads
  // it as it reads an unsplit companion. `parts`: the part files' text, in
  // order. Throws when a part is not the part it should be (number, total, or
  // header) or continues a section nothing opened, so a guide is never built
  // with sections missing.
  function mergeCompanion (core, parts) {
    var total = parts.length
    var merged = []
    var byTitle = {}
    parts.forEach(function (text, i) {
      var header = /^# Agent companion part (\d+) of (\d+):/.exec(String(text || ''))
      if (!header) throw new Error('not_part')
      if (Number(header[1]) !== i + 1 || Number(header[2]) !== total) throw new Error('part_count')
      h2Sections(text).sections.forEach(function (s) {
        var cont = /^(.+) \(continued\)$/.exec(s.title)
        if (!cont) {
          var section = { title: s.title, lines: s.lines.slice() }
          merged.push(section)
          byTitle[norm(s.title)] = section
          return
        }
        var open = byTitle[norm(cont[1])]
        if (!open) throw new Error('orphan_continued')
        open.lines.push('')
        Array.prototype.push.apply(open.lines, s.lines)
      })
    })
    var out = [String(core || '').replace(/\s+$/, '')]
    merged.forEach(function (s) { out.push('## ' + s.title + '\n\n' + trimLines(s.lines)) })
    return out.join('\n\n') + '\n'
  }

  // The companion as its headings: the # title, then each ## section with its
  // own text (everything up to the next ##, ### headings included) and each
  // ### inside it. Headings inside code fences are text. A ### is only ever
  // looked up under its own ##, so "Acceptance checks of the reference" under
  // Reference build never reads as the top-level Acceptance.
  function sliceCompanion (md) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n')
    var out = { title: '', version: '', sections: [] }
    var h2 = null
    var h3 = null
    var fence = null
    var preamble = []
    lines.forEach(function (line) {
      var marker = /^\s*(```+|~~~+)/.exec(line)
      if (marker) {
        if (!fence) fence = marker[1].charAt(0)
        else if (marker[1].charAt(0) === fence) fence = null
      }
      var heading = !fence && !marker ? /^(#{1,3}) (.+?)\s*#*\s*$/.exec(line) : null
      if (heading && heading[1] === '#' && !out.title) {
        out.title = heading[2].replace(/^Agent companion:\s*/, '')
        return
      }
      if (heading && heading[1] === '##') {
        h2 = { title: heading[2], lines: [], children: [] }
        h3 = null
        out.sections.push(h2)
        return
      }
      if (heading && heading[1] === '###' && h2) {
        if (!h2.children.length) h2.intro = h2.lines.slice()
        h3 = { title: heading[2], lines: [] }
        h2.children.push(h3)
        h2.lines.push(line)
        return
      }
      if (h3) h3.lines.push(line)
      if (h2) h2.lines.push(line)
      else preamble.push(line)
    })
    var generated = /\(v(\d+\.\d+\.\d+)\)/.exec(preamble.join('\n'))
    if (generated) out.version = 'v' + generated[1]
    out.sections = out.sections.map(function (s) {
      return {
        title: s.title,
        text: trimLines(s.lines),
        // The text before the first ###: all of it when there is none.
        intro: trimLines(s.intro || s.lines),
        children: s.children.map(function (c) { return { title: c.title, text: trimLines(c.lines) } }),
      }
    })
    return out
  }

  function topSection (sliced, title) {
    var want = norm(title)
    for (var i = 0; i < sliced.sections.length; i++) {
      if (norm(sliced.sections[i].title) === want) return sliced.sections[i]
    }
    return null
  }

  // `text` as pieces of at most `limit` characters that together hold all of
  // it, cut at blank lines outside code fences where it can be, then at line
  // ends, and only for a single line longer than `limit`, inside it.
  function chunkText (text, limit) {
    text = String(text || '')
    if (text.length <= limit) return [text]
    var blocks = []
    var cur = []
    var fence = null
    text.split('\n').forEach(function (line) {
      var marker = /^\s*(```+|~~~+)/.exec(line)
      if (marker) {
        if (!fence) fence = marker[1].charAt(0)
        else if (marker[1].charAt(0) === fence) fence = null
      }
      if (!fence && !marker && !line.trim()) {
        if (cur.length) blocks.push(cur.join('\n'))
        cur = []
        return
      }
      cur.push(line)
    })
    if (cur.length) blocks.push(cur.join('\n'))
    var units = []
    blocks.forEach(function (block) {
      if (block.length <= limit) return units.push({ text: block, sep: '\n\n' })
      block.split('\n').forEach(function (line, i) {
        for (var at = 0; at === 0 || at < line.length; at += limit) {
          units.push({ text: line.slice(at, at + limit), sep: at ? '' : i ? '\n' : '\n\n' })
        }
      })
    })
    var pieces = []
    var piece = ''
    units.forEach(function (u) {
      if (piece && piece.length + u.sep.length + u.text.length > limit) {
        pieces.push(piece)
        piece = ''
      }
      piece = piece ? piece + u.sep + u.text : u.text
    })
    if (piece) pieces.push(piece)
    return pieces
  }

  // Add one get_solution_guide section, in pieces when it is too long for the
  // tool: the first keeps the name, the rest are "<name> (part <n> of <m>)",
  // and each names the next, so the tool can say what to request.
  function pushSection (sections, entry) {
    var pieces = chunkText(entry.text, SECTION_SPLIT_AT)
    var names = pieces.map(function (p, i) {
      return i ? entry.section + ' (part ' + (i + 1) + ' of ' + pieces.length + ')' : entry.section
    })
    pieces.forEach(function (text, i) {
      var out = {}
      for (var k in entry) if (Object.prototype.hasOwnProperty.call(entry, k)) out[k] = entry[k]
      out.section = names[i]
      out.text = text
      if (i) {
        out.part = i + 1
        delete out.aliases
        delete out.parts
      }
      if (i < pieces.length - 1) out.next = names[i + 1]
      sections.push(out)
    })
  }

  // Where a Production gaps topic is on the last step: its h3 (id prod-*),
  // matched on the heading text, then on the id the text would slug to.
  // Two of the five solutions set custom ids ("prod-recovery-point-and-time"
  // for "Recovery point and recovery time"), so the text is matched first.
  // With no match, the Production considerations section itself.
  function gapUrl (doc, topic, lastStepUrl) {
    var base = String(lastStepUrl || '').split('#')[0]
    var headings = doc && doc.querySelectorAll ? Array.prototype.slice.call(doc.querySelectorAll('h3[id^="prod-"]')) : []
    var want = norm(topic)
    var id = null
    for (var i = 0; i < headings.length && !id; i++) {
      if (norm(headings[i].textContent) === want) id = headings[i].id
    }
    for (var j = 0; j < headings.length && !id; j++) {
      if (headings[j].id === 'prod-' + slug(topic)) id = headings[j].id
    }
    return base + '#' + (id || GAPS_ANCHOR)
  }

  // The sections get_solution_guide can return, each with the page to cite
  // for it:
  //   Production gaps: overview  the last step, at Production considerations
  //   a Production gaps topic    the last step, at that topic's heading
  //   step:<n>                   step n's page (its Design contract entry)
  //   each of WHOLE_SECTIONS     the companion itself
  // A whole section too long for the tool comes as "<name>: overview" (its
  // text before the first ###, also found as "<name>") and one
  // "<name>: <subsection>" per ###, each with `parent` set to the name, so
  // the prompt can list them. Any section still too long continues in parts
  // (pushSection). Together the pieces hold every line of the section.
  // `o`: { doc, lastStepUrl, stepUrls (in order), companionUrl }.
  function guideSections (sliced, o) {
    var opts = o || {}
    var sections = []
    var topics = []
    var gaps = topSection(sliced, PRODUCTION_GAPS)
    if (gaps) {
      if (gaps.intro) {
        pushSection(sections, {
          section: GAPS_OVERVIEW,
          aliases: [PRODUCTION_GAPS],
          guide_url: String(opts.lastStepUrl || '').split('#')[0] + '#' + GAPS_ANCHOR,
          text: gaps.intro,
        })
      }
      gaps.children.forEach(function (c) {
        topics.push(c.title)
        pushSection(sections, { section: c.title, guide_url: gapUrl(opts.doc, c.title, opts.lastStepUrl), text: c.text })
      })
    }
    var steps = 0
    var contract = topSection(sliced, DESIGN_CONTRACT)
    if (contract) {
      contract.children.forEach(function (c) {
        var n = /^(\d+)\.\s+(.*)$/.exec(c.title)
        if (!n) return
        steps = Math.max(steps, Number(n[1]))
        var url = (opts.stepUrls || [])[Number(n[1]) - 1] || opts.companionUrl || ''
        pushSection(sections, { section: 'step:' + n[1], title: n[2], guide_url: url, text: c.text })
      })
    }
    WHOLE_SECTIONS.forEach(function (name) {
      var s = topSection(sliced, name)
      if (!s) return
      var url = opts.companionUrl || ''
      if (s.text.length <= SECTION_SPLIT_AT || !s.children.length) {
        return pushSection(sections, { section: s.title, guide_url: url, text: s.text })
      }
      var names = s.children.map(function (c) { return s.title + ': ' + c.title })
      pushSection(sections, { section: s.title + ': overview', aliases: [s.title], parent: s.title, parts: names, guide_url: url, text: s.intro })
      s.children.forEach(function (c, i) {
        pushSection(sections, { section: names[i], parent: s.title, guide_url: url, text: '### ' + c.title + '\n\n' + c.text })
      })
    })
    var rules = topSection(sliced, RULES)
    return {
      title: sliced.title,
      version: sliced.version,
      rules: rules ? rules.text : '',
      topics: topics,
      steps: steps,
      sections: sections,
    }
  }

  // The prompt for a coding agent: a pointer, with no procedure of its own.
  // The procedure lives in the companion's How to use this (agent-companion.js
  // in the docs extensions), the one copy the redpanda-solutions skill also
  // follows, so a change to it never has to be made here. The only facts the
  // prompt fills in are the ones the page shows: the title, the version, and
  // the companion URL. `m`: { origin, slug, title, version, verifiedVersion }.
  // `from` marks where the prompt went, as ?from=<from> on the companion URL:
  // 'prompt' for Copy prompt, 'handoff' for the Ask AI banner's Hand this plan
  // to your coding agent. The docs-site fetch counter reads it to tell those
  // fetches from the skill's, which use the bare URL. Only this first fetch
  // carries it; the page's own companion fetch has none.
  // One line per instruction, as the agent reads it, so the lines run long.
  /* eslint-disable max-len */
  function buildProductionizePrompt (m, from) {
    var origin = String(m.origin || '').replace(/\/+$/, '')
    var companion = origin + '/solutions/' + m.slug + '/agent-companion.md' +
      (from ? '?from=' + encodeURIComponent(from) : '')
    var built = '(version ' + m.version + (m.verifiedVersion ? ', verified against Redpanda ' + m.verifiedVersion : '') + ')'
    return [
      '# Take this design to production: ' + m.title,
      '',
      'I built the Redpanda Solutions reference "' + m.title + '" ' + built + '. Help me apply its design to this repository and my production environment. Do not copy the reference system.',
      '',
      'If the `redpanda-solutions` skill is available, use it.',
      '',
      // One plain command, so it matches a `curl` allow rule: agents told
      // only "curl -s URL" wrapped it in mktemp, cd, and wc, and a
      // restricted permission mode refused every one. -f makes a 404 fail
      // instead of returning the 404 page. The companion repeats this rule
      // for an agent that reaches it another way.
      'Otherwise, download this solution\'s agent companion in full with this one command, exactly as written, with no pipes, redirects, `cd`, or temporary directories: `curl -sf ' + companion + '`. If curl exits non-zero, or its output does not start with `# Agent companion:`, the download failed: stop and tell me, and do not work from memory. If you cannot run curl, ask me to paste the file. Do not rely on a summarizing web-fetch tool.',
      '',
      'Then follow the companion\'s "How to use this" section.',
    ].join('\n')
  }
  /* eslint-enable max-len */

  // ---------------------------------------------------------------------------
  // The card
  // ---------------------------------------------------------------------------

  function attr (el, name) { return (el && el.getAttribute && el.getAttribute(name)) || '' }

  function dispatch (name, detail) {
    try { window.dispatchEvent(new window.CustomEvent(name, { detail: detail })) } catch (e) { /* ignore */ }
  }

  // 28-solution-progress.js owns sign-in state and the solution's analytics
  // props. Read through it when it is on the page, so the card and the rest
  // of the page never disagree.
  function progress () { return window.docsSolutions || null }

  function signedIn () {
    var p = progress()
    if (p && typeof p.signedIn === 'function') return p.signedIn()
    return /(?:^|;\s*)rp_docs_auth=1(?:;|$)/.test(document.cookie || '')
  }

  function baseProps (extra) {
    var p = progress()
    if (p && typeof p.baseProps === 'function') return p.baseProps(extra)
    var props = {
      solution_id: attr(document.body, 'data-solution-id'),
      solution_version: attr(document.body, 'data-solution-version'),
      step_id: attr(document.body, 'data-step-id') || undefined,
    }
    for (var k in extra || {}) if (Object.prototype.hasOwnProperty.call(extra, k)) props[k] = extra[k]
    return props
  }

  function track (name, props) {
    var p = progress()
    if (p && typeof p.track === 'function') p.track(name, props)
  }

  function init () {
    var card = document.querySelector('[data-sol-productionize]')
    if (!card) return
    var loc = window.location
    var origin = loc.origin
    var body = document.body
    var meta = {
      origin: origin,
      slug: attr(body, 'data-solution-id'),
      title: attr(body, 'data-solution-title'),
      version: attr(body, 'data-solution-version'),
      verifiedVersion: attr(card, 'data-sol-verified-version'),
      platforms: attr(body, 'data-solution-tested-on'),
    }
    var companionUrl = new URL(rewriteHost(attr(card, 'data-sol-companion-url') ||
      '/solutions/' + meta.slug + '/agent-companion.md', origin), origin).href
    var prompt = buildProductionizePrompt(meta, 'prompt')

    var plan = card.querySelector('[data-sol-productionize-plan]')
    var copy = card.querySelector('[data-sol-productionize-copy]')
    var status = card.querySelector('[data-sol-productionize-status]')
    var note = card.querySelector('[data-sol-productionize-note]')
    var preview = card.querySelector('[data-sol-productionize-preview]')
    var promptEl = card.querySelector('[data-sol-productionize-prompt]')
    var mcp = card.querySelector('[data-sol-productionize-mcp]')
    var signedOut = card.querySelector('[data-sol-productionize-signedout]')
    var gated = card.querySelector('[data-sol-productionize-gated]')
    var signin = card.querySelector('[data-sol-productionize-signin]')
    // The prompt is written into the page only once a signed-in reader can
    // see it, so a signed-out page never holds it.
    var revealed = false

    // The plan on this page: idle, loading (fetching the companion), active
    // (running in the drawer under `nonce`), ended, or unavailable (the
    // companion could not be read, so only the prompt is offered).
    var state = 'idle'
    var nonce = null
    var guidePromise = null

    // Signed out, only the title, the sign-in sentence and Sign in show;
    // signed in, the whole card. Runs again on every kapa-session event, so a
    // sign-in learned after load opens the card without a reload.
    function render () {
      var inside = signedIn()
      if (signedOut) signedOut.hidden = inside
      if (gated) gated.hidden = !inside
      if (inside && !revealed) {
        revealed = true
        if (promptEl) promptEl.textContent = prompt
        if (preview) preview.hidden = false
        if (copy) copy.hidden = false
      }
      if (!plan) return
      plan.hidden = state === 'unavailable' || !window.KAPA_PRODUCTIONIZE_INTEGRATION_ID
      plan.disabled = state === 'loading'
      if (note) note.hidden = state !== 'unavailable'
    }

    function running () {
      var active = window.__docsChatMode
      return state === 'active' && !!active && active.mode === MODE && active.nonce === nonce
    }

    function stepUrls () {
      var seen = {}
      var urls = []
      Array.prototype.forEach.call(document.querySelectorAll('[data-sol-nav-step]'), function (el) {
        var id = attr(el, 'data-sol-nav-step')
        var url = attr(el, 'data-sol-nav-url')
        if (!id || seen[id] || !url) return
        seen[id] = true
        urls.push(new URL(url, origin).href)
      })
      return urls
    }

    // One companion file's text, or a rejection with the reason.
    function fetchText (url, firstLine, prefix) {
      return window.fetch(url, { credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error(prefix + 'http_' + res.status)
          return res.text()
        })
        .then(function (text) {
          if (!firstLine.test(text)) throw new Error('not_' + (prefix ? 'part' : 'companion'))
          return rewriteHost(text, origin)
        })
    }

    // Fetched once per page, on the first click: the core file, then every
    // part it lists, merged into one document. Any part that fails fails the
    // whole guide, as the core does.
    function loadGuide () {
      if (guidePromise) return guidePromise
      guidePromise = fetchText(companionUrl, /^# Agent companion/, '')
        .then(function (core) {
          var found = companionParts(core, origin, meta.slug)
          if (!found.split) return core
          if (!found.parts.length) throw new Error('no_parts')
          return Promise.all(found.parts.map(function (p) {
            return fetchText(p.url, /^# Agent companion part/, 'part_')
          })).then(function (parts) { return mergeCompanion(core, parts) })
        })
        .then(function (text) {
          var guide = guideSections(sliceCompanion(text), {
            doc: document,
            lastStepUrl: origin + loc.pathname,
            stepUrls: stepUrls(),
            companionUrl: companionUrl,
          })
          if (!guide.sections.length) throw new Error('no_sections')
          guide.companionUrl = companionUrl
          return guide
        })
      return guidePromise
    }

    function start (guide) {
      // Another mode (a quiz on this step) ends first, so it reports how far
      // the reader got and its opener cannot land in the plan.
      var active = window.__docsChatMode
      if (active && active.mode !== MODE && typeof window.endChatMode === 'function') window.endChatMode('other_mode')
      var detail = {
        mode: MODE,
        title: meta.title,
        solution: meta.slug,
        version: meta.version,
        verifiedVersion: meta.verifiedVersion,
        platforms: meta.platforms,
        companionUrl: companionUrl,
        guideUrl: origin + '/solutions/' + meta.slug + '/',
        url: loc.pathname,
        nonce: Date.now(),
        guide: guide,
        // The banner's Hand this plan to your coding agent copies this prompt
        // with the plan so far after it (react/components/ModeBanner.jsx).
        agentPrompt: buildProductionizePrompt(meta, 'handoff'),
        props: baseProps(),
      }
      // Same opener as the drawer's productionizeOpener.
      detail.firstMessage = meta.title ? 'Help me take this design to production: ' + meta.title + '.' : 'Help me take this solution to production.'
      state = 'active'
      nonce = detail.nonce
      window.__docsChatMode = detail
      dispatch('docs-chat:mode', detail)
      track('solution_productionize_start', baseProps({ sections: guide.sections.length, topics: guide.topics.length }))
      if (typeof window.openChatWithQuery === 'function') {
        window.openChatWithQuery(detail.firstMessage, true, { mode: MODE, nonce: detail.nonce })
      }
    }

    function openSignin () {
      track('solution_productionize_signin', baseProps())
      dispatch('docs-account:open-signin', {
        title: 'Sign in to take this to production',
        lead: 'Ask AI plans this design for your system with you, and you get a prompt for your coding agent ' +
          'and the docs MCP server setup.',
        cta: 'Sign in',
        returnTo: loc.pathname + '#' + CARD_ID,
      })
    }

    function onPlan () {
      // Plan it shows only signed in; a sign-out the page has not heard about
      // yet still goes to sign-in rather than to a failed plan.
      if (!signedIn()) return openSignin()
      if (running()) {
        if (typeof window.openChatPanel === 'function') window.openChatPanel()
        return
      }
      if (state === 'loading') return
      state = 'loading'
      render()
      loadGuide().then(start, function (err) {
        state = 'unavailable'
        track('solution_productionize_unavailable', baseProps({ reason: String((err && err.message) || 'error').slice(0, 40) }))
        render()
      }).then(render)
    }

    function setStatus (text) {
      if (status) status.textContent = text
    }

    function onCopy () {
      track('solution_productionize_copy', baseProps({ chars: prompt.length }))
      var clip = window.navigator && window.navigator.clipboard
      var done = function () { setStatus('Copied the prompt.') }
      var failed = function () {
        setStatus('Could not copy. Open Preview prompt to copy it yourself.')
        if (preview) preview.open = true
      }
      if (!clip || typeof clip.writeText !== 'function') return failed()
      try {
        clip.writeText(prompt).then(done, failed)
      } catch (e) {
        failed()
      }
    }

    if (signin) signin.addEventListener('click', openSignin)
    if (plan) plan.addEventListener('click', onPlan)
    if (copy) copy.addEventListener('click', onCopy)
    if (mcp) {
      var opened = false
      mcp.addEventListener('toggle', function () {
        if (!mcp.open || opened) return
        opened = true
        track('solution_productionize_mcp_open', baseProps())
      })
      var vscode = mcp.querySelector('[data-sol-mcp-vscode]')
      if (vscode) vscode.addEventListener('click', function () { track('solution_productionize_mcp_vscode', baseProps()) })
    }

    window.addEventListener('docs-chat:mode-end', function (e) {
      var d = (e && e.detail) || {}
      if (state === 'active' && (!d.mode || d.mode === MODE)) state = 'ended'
    })
    // 26-docs-account.js and the drawer learn the sign-in state after load.
    window.addEventListener('kapa-session', render)

    if (typeof window.IntersectionObserver === 'function') {
      var observer = new window.IntersectionObserver(function (entries) {
        if (!entries.some(function (entry) { return entry.isIntersecting })) return
        observer.disconnect()
        track('solution_productionize_view', baseProps())
      }, { threshold: 0.5 })
      observer.observe(card)
    }

    render()
  }

  var api = {
    CARD_ID: CARD_ID,
    MODE: MODE,
    rewriteHost: rewriteHost,
    companionParts: companionParts,
    mergeCompanion: mergeCompanion,
    sliceCompanion: sliceCompanion,
    chunkText: chunkText,
    SECTION_SPLIT_AT: SECTION_SPLIT_AT,
    gapUrl: gapUrl,
    guideSections: guideSections,
    buildProductionizePrompt: buildProductionizePrompt,
  }
  if (typeof window !== 'undefined') window.__solutionProductionize = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined' && typeof document !== 'undefined') init()
})()

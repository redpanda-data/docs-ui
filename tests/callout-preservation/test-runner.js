/**
 * AsciiDoc callout markers must stay on the line they were written on.
 *
 * 17-bloblang-yaml.js re-renders YAML scalars that hold Bloblang, rebuilding
 * each token from its textContent and assigning innerHTML. That destroys any
 * <i class="conum"> inside the token, and the restoration observer in
 * 11-editable-placeholders.js used to re-home the orphans with appendChild -
 * so a callout written inside a "mapping: |" block scalar moved to the end of
 * the code block. The Helm chart quickstart rendered its markers as "4 1 3".
 *
 * This runs the real scripts in a real browser, because the bug only appears
 * once Prism, keep-markup and the Bloblang pass have all run over the same
 * block. Server HTML and a cold DOM both look correct.
 *
 * Block A is the regression. Block B is the negative control: it must still be
 * Bloblang-highlighted, or the fix has simply switched the feature off.
 */
const puppeteer = require('puppeteer')
const express = require('express')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')

const failures = []
function check (name, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${name}`)
  } else {
    console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`)
    failures.push(name)
  }
}

async function main () {
  const app = express()
  app.use('/src', express.static(path.join(ROOT, 'src')))
  app.use('/', express.static(__dirname))
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const port = server.address().port

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 800 })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    await page.goto(`http://127.0.0.1:${port}/fixture.html`, { waitUntil: 'load' })

    // Prism highlights near-viewport blocks on DOMContentLoaded; the Bloblang
    // pass runs in a requestIdleCallback after Prism's "complete" hook. Scroll
    // every block into view so the lazy highlighter reaches it, then settle.
    await page.evaluate(async () => {
      for (const el of document.querySelectorAll('pre > code')) {
        el.scrollIntoView()
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      await new Promise((resolve) => setTimeout(resolve, 600))
    })

    const result = await page.evaluate(() => {
      const read = (id) => {
        const code = document.querySelector(`#${id} code`)
        const visible = [...code.querySelectorAll('i.conum')].filter(
          (n) => n.getBoundingClientRect().width > 1
        )
        const lines = {}
        visible.forEach((n) => {
          const y = Math.round(n.getBoundingClientRect().top)
          ;(lines[y] = lines[y] || []).push(Number(n.dataset.value))
        })
        return {
          highlighted: !!code.querySelector('.token'),
          bloblang: !!code.querySelector('.bloblang-embedded'),
          domOrder: visible.map((n) => Number(n.dataset.value)),
          totalConums: code.querySelectorAll('i.conum').length,
          byLine: Object.keys(lines)
            .sort((a, b) => a - b)
            .map((y) => lines[y]),
          text: code.textContent,
        }
      }
      return { a: read('block-a'), b: read('block-b'), c: read('block-c'), d: read('block-d'), e: read('block-e') }
    })

    check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '))
    console.log(
      '  INFO  bloblang-highlighted: ' +
        ['a', 'b', 'c', 'd', 'e'].map((k) => k.toUpperCase() + '=' + result[k].bloblang).join(' ')
    )

    // --- Block A: the regression ---
    const a = result.a
    check('A: Prism highlighted the block', a.highlighted)
    check(
      'A: callouts are in source order',
      JSON.stringify(a.domOrder) === '[1,2,3,4]',
      `got ${JSON.stringify(a.domOrder)}`
    )
    check(
      'A: one callout per line',
      a.byLine.length === 4 && a.byLine.every((l) => l.length === 1),
      `lines ${JSON.stringify(a.byLine)}`
    )
    check(
      'A: lines ascend 1,2,3,4 top to bottom',
      JSON.stringify(a.byLine) === '[[1],[2],[3],[4]]',
      `lines ${JSON.stringify(a.byLine)}`
    )
    check(
      'A: no duplicate conum nodes',
      a.totalConums === 4,
      `${a.totalConums} conum nodes for 4 callouts`
    )
    check(
      'A: copied text carries no "(N)" fallback',
      !/\(\d\)/.test(a.text),
      JSON.stringify(a.text.slice(0, 120))
    )
    check(
      'A: copied text keeps the block scalar indicator',
      a.text.includes('mapping: |'),
      JSON.stringify(a.text.slice(0, 80))
    )

    // --- Block B: negative control ---
    const b = result.b
    check('B: Prism highlighted the block', b.highlighted)
    check(
      'B: Bloblang highlighting still applies when no callouts are present',
      b.bloblang,
      'the guard has switched the feature off wholesale'
    )

    // --- Block C: plain-line callouts, already working ---
    const c = result.c
    check('C: Prism highlighted the block', c.highlighted)
    check(
      'C: callouts in source order',
      JSON.stringify(c.domOrder) === '[1,2]',
      `got ${JSON.stringify(c.domOrder)}`
    )
    check('C: no duplicate conum nodes', c.totalConums === 2, `${c.totalConums} nodes`)
    // --- Block D: the shape the quickstart now uses ---
    const d = result.d
    check('D: Prism highlighted the block', d.highlighted)
    check(
      'D: callouts in source order, one per line',
      JSON.stringify(d.byLine) === '[[1],[2],[3],[4]]',
      `lines ${JSON.stringify(d.byLine)}`
    )
    check('D: no duplicate conum nodes', d.totalConums === 4, `${d.totalConums} nodes`)
    // A single-line plain scalar ("mapping: root.x = ...") is not a Prism
    // string/scalar token, so the Bloblang pass never collected it and this
    // form has never been Bloblang-highlighted - with or without the guard.
    // Recorded so a future change to the YAML grammar does not silently
    // reintroduce the clobber on this shape.
    check(
      'D: plain single-line scalar is left alone by the Bloblang pass',
      d.bloblang === false,
      'this form is now re-rendered - re-check that callouts survive it'
    )
    // --- Block E: blank line inside the scalar ---
    const e = result.e
    check('E: Prism highlighted the block', e.highlighted)
    check(
      'E: callouts in source order, one per line',
      JSON.stringify(e.byLine) === '[[1],[2],[3]]',
      `lines ${JSON.stringify(e.byLine)}`
    )
    check('E: no duplicate conum nodes', e.totalConums === 3, `${e.totalConums} nodes`)
  } finally {
    await browser.close()
    server.close()
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`)
    process.exit(1)
  }
  console.log('\nAll callout-preservation checks passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

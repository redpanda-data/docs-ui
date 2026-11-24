/**
 * 11-editable-placeholders.js turns "(N)" into callout markers and <name>
 * into editable placeholders. Neither may fire where it means something else:
 * a count in command output with no callout list (block G), or a placeholder
 * named in a comment (blocks I and J). Blocks H, I and J also carry the
 * controls, so a fix that switched either feature off fails here.
 *
 * Runs the real scripts in a real browser, like callout-preservation, because
 * both passes run after Prism has tokenised the block.
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
    await page.evaluate(async () => {
      for (const el of document.querySelectorAll('pre > code')) {
        el.scrollIntoView()
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      await new Promise((resolve) => setTimeout(resolve, 600))
    })

    const r = await page.evaluate(() => {
      const read = (id) => {
        const code = document.querySelector(`#${id} code`)
        return {
          conums: [...code.querySelectorAll('i.conum')].map((n) => n.dataset.value),
          editable: [...code.querySelectorAll('[contenteditable="true"]')].map((n) => n.textContent),
          text: code.textContent,
        }
      }
      return { g: read('block-g'), h: read('block-h'), i: read('block-i'), j: read('block-j') }
    })

    check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '))
    check('G: no callouts minted from counts in output', r.g.conums.length === 0, JSON.stringify(r.g.conums))
    check('G: the counts stay in the text', r.g.text.includes('fired (169)') && r.g.text.includes('Postgres (24)') && r.g.text.includes('records (1)'), JSON.stringify(r.g.text))
    check('H: a text callout before a callout list still becomes a callout', JSON.stringify(r.h.conums) === '["1"]', JSON.stringify(r.h.conums))
    check('I: the placeholder in the comment is not editable', !r.i.editable.includes('<topic>'), JSON.stringify(r.i.editable))
    check('I: the comment text is unchanged', r.i.text.includes('// <topic>-value with BACKWARD'), JSON.stringify(r.i.text))
    check('I: the placeholder on the code line is editable', r.i.editable.includes('<module-path>'), JSON.stringify(r.i.editable))
    check('J: the "#" comment line has no editable placeholder, the flag line has one', JSON.stringify(r.j.editable) === '["<cluster-id>"]', JSON.stringify(r.j.editable))
    const jLines = r.j.text.split('\n')
    check('J: the editable one is on the --set line', jLines[0].includes('Replace <cluster-id>') && jLines[2].includes('--set cluster.id=<cluster-id>'), JSON.stringify(jLines))
  } finally {
    await browser.close()
    server.close()
  }

  if (failures.length) {
    console.log(`\n${failures.length} code-placeholders check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll code-placeholders checks passed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * Every Handlebars template in the UI parses.
 *
 * This exists because of a real outage: `{{(parse-json x).steps.length}}` is
 * not valid Handlebars, but `handlebars.compile()` is lazy and does not parse
 * until the template is rendered. So the template passed every local check,
 * the UI bundle built and published, and the first thing to actually render a
 * solution overview was Netlify, where Antora died with a parse error and a
 * build script exit code. Nothing on the docs-ui side had said a word.
 *
 * handlebars.parse() is eager, so one pass over every template turns that
 * class of bug back into a test failure on the branch that introduced it.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..', 'src')
const DIRS = ['layouts', 'partials', 'helpers']

function templates () {
  const out = []
  for (const dir of DIRS) {
    const full = path.join(ROOT, dir)
    if (!fs.existsSync(full)) continue
    for (const name of fs.readdirSync(full)) {
      if (name.endsWith('.hbs')) out.push(path.join(dir, name))
    }
  }
  return out.sort()
}

test('every .hbs template parses', () => {
  const found = templates()
  assert.ok(found.length > 20, `expected to find the templates, found ${found.length}`)
  const failures = []
  for (const rel of found) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    try {
      Handlebars.parse(src)
    } catch (err) {
      failures.push(`${rel}: ${String(err.message).split('\n')[0]}`)
    }
  }
  assert.deepEqual(failures, [], 'templates that do not parse:\n  ' + failures.join('\n  '))
})

// The exact shape that caused the outage, so the test above is known to catch
// it rather than assumed to.
test('a subexpression used as a path is a parse error, which is what this suite is for', () => {
  assert.throws(() => Handlebars.parse('{{(parse-json page.attributes.solution).steps.length}}'), /Parse error/)
  // The form that works, for the next person who needs a helper's result.
  assert.doesNotThrow(() => Handlebars.parse('{{#with (parse-json page.attributes.solution)}}{{steps.length}}{{/with}}'))
  // And compile() is why this needs its own test: it does not parse.
  assert.doesNotThrow(() => Handlebars.compile('{{(parse-json x).y}}'))
})

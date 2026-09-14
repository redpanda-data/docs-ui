/**
 * Only one tooltip may be open at a time, across every tooltip on the page.
 *
 * tippy does not do this by itself. On touch it is not cosmetic: the trigger
 * is click and hideOnClick is 'toggle', so tapping elsewhere dismisses
 * nothing and every term a reader taps leaves another popover on screen.
 *
 * Three scripts create tooltips (12-activate-tooltips, 19-property-tooltips,
 * 16-bloblang-interactive) and 16 defines its own onShow, which would
 * silently override a global tippy.setDefaultProps default. So the rule lives
 * in each config, and the last test here is what stops a fourth tooltip site
 * being added without it.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '../..')
const read = (f) => fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8')

// Every script that creates a tooltip. Kept as a glob rather than a list so a
// new one is picked up instead of quietly skipped.
const TOOLTIP_SCRIPTS = fs
  .readdirSync(path.join(ROOT, 'src/js'))
  .filter((f) => /^\d+-.*\.js$/.test(f))
  .filter((f) => /(^|[^.\w])tippy\s*\(|window\.tippy\s*\(/.test(read(f)))

// Runs 12-activate-tooltips.js against stub DOM/tippy and returns the configs
// it handed to tippy, plus the hideAll calls those configs make.
function runActivateTooltips () {
  const configs = []
  const hideAllCalls = []
  const node = () => ({
    tagName: 'SPAN',
    attrs: { 'data-tippy-content': 'A definition' },
    classList: { contains: () => false },
    getAttribute (n) { return n in this.attrs ? this.attrs[n] : null },
    setAttribute (n, v) { this.attrs[n] = String(v) },
    removeAttribute (n) { delete this.attrs[n] },
    addEventListener () {},
    querySelector () { return null },
  })
  const target = node()
  const tippy = (el, cfg) => { configs.push(cfg); return { id: configs.length } }
  tippy.hideAll = (opts) => hideAllCalls.push(opts)

  const context = {
    navigator: { maxTouchPoints: 0 },
    window: {},
    tippy,
    document: {
      addEventListener: (t, fn) => { if (t === 'DOMContentLoaded') context.fire = fn },
      querySelectorAll: (sel) => (sel.startsWith('[data-tippy-content]') ? [target] : []),
      createElement: () => ({
        children: [],
        set innerHTML (v) { this._html = v },
        set textContent (v) { this._text = v },
        appendChild (c) { this.children.push(c) },
      }),
      body: {},
    },
  }
  vm.runInNewContext(read('12-activate-tooltips.js'), context)
  context.fire()
  return { configs, hideAllCalls, tippy }
}

test('showing a tooltip hides every other one', () => {
  const { configs, hideAllCalls } = runActivateTooltips()
  assert.ok(configs.length > 0, 'no tippy instance was configured')

  const cfg = configs[0]
  assert.equal(typeof cfg.onShow, 'function', 'config has no onShow to close the others')

  // The reader taps a second term while the first tooltip is open.
  const second = { id: 'second' }
  cfg.onShow(second)

  assert.equal(hideAllCalls.length, 1, 'onShow did not hide the other tooltips')
  // Identity, not deep equality: the options object is built inside the vm
  // realm, so its prototype is not this realm's and deepStrictEqual rejects
  // it even when the contents match.
  assert.equal(
    hideAllCalls[0].exclude,
    second,
    'hideAll must exclude the instance being shown, or it closes itself'
  )
  assert.deepEqual(Object.keys(hideAllCalls[0]), ['exclude'])
})

test('every tooltip created by 12-activate-tooltips.js carries the rule', () => {
  // The file creates five sets of tooltips (glossary terms, data-tooltip,
  // enterprise terms, promoted titles, toolbox buttons) off one shared
  // config. If a later one stops spreading that config, this catches it.
  const { configs } = runActivateTooltips()
  for (const cfg of configs) {
    assert.equal(typeof cfg.onShow, 'function', 'a tippy config was created without onShow')
  }
})

test('every script that creates a tooltip also closes the others', () => {
  // Static, unlike the tests above: 16 and 19 build their tooltips deep
  // inside playground and property-reference setup that cannot be driven from
  // a stub DOM. This is the guard that a fourth tooltip site does not ship
  // without the rule.
  assert.ok(TOOLTIP_SCRIPTS.length >= 3, `expected to find the tooltip scripts, found ${TOOLTIP_SCRIPTS}`)
  for (const file of TOOLTIP_SCRIPTS) {
    const src = read(file)
    assert.match(
      src,
      /hideAll\(\s*\{\s*exclude:/,
      `${file} creates tooltips but never calls tippy.hideAll({ exclude: ... }), so opening one leaves the others on screen`
    )
  }
})

test('nothing goes back to hiding tooltips through .tippy-box._tippy', () => {
  // What this replaced in 16-bloblang-interactive.js, which never hid
  // anything: instance.popper is the [data-tippy-root] wrapper and .tippy-box
  // is its child, so the "is this mine" comparison was always true, and tippy
  // assigns _tippy to the reference element rather than the box, so
  // box._tippy was always undefined and the && swallowed the call.
  for (const file of TOOLTIP_SCRIPTS) {
    const src = read(file)
    assert.doesNotMatch(
      src.replace(/\/\/.*$/gm, ''),
      /\.tippy-box[\s\S]{0,200}?_tippy/,
      `${file} hides tooltips via .tippy-box._tippy, which is always undefined; use tippy.hideAll`
    )
  }
})

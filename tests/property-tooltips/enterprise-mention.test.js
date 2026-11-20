'use strict'

// An Enterprise property mention: the runtime matches what the prop: macro
// emits at build time. The build puts class is-enterprise-property and a
// visually hidden " (Enterprise)" marker after the name, and leaves both off
// on Cloud pages (no Enterprise license there). The runtime must:
// - not add the class or "(Enterprise)" to the aria-label on a Cloud page
// - not add the class again when the build already put it there
// - still find the property when the code text carries the marker
// Runs the real functions, extracted from the shipped source.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SRC = fs.readFileSync(path.join(__dirname, '../../src/js/19-property-tooltips.js'), 'utf8')
const START = SRC.indexOf('function propertyNameOf')
const END = SRC.indexOf('function definedConditionalAttributes')
assert.ok(START !== -1 && END > START, 'extraction anchors went stale in 19-property-tooltips.js')
const ctx = {}
vm.runInNewContext(SRC.slice(START, END) + '\nthis.propertyNameOf = propertyNameOf; this.enterpriseMentionLabel = enterpriseMentionLabel', ctx)

function el ({ classes = [], text = '', attrs = {}, marker = null } = {}) {
  const set = new Set(classes)
  const added = []
  return {
    added,
    textContent: text,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    querySelector: (sel) => (sel === '.enterprise-feature-marker' && marker !== null ? { textContent: marker } : null),
    classList: {
      contains: (c) => set.has(c),
      add: (c) => { added.push(c); set.add(c) },
    },
  }
}

test('self-managed page: an Enterprise property gets the class and the word once', () => {
  const code = el({ text: 'audit_enabled' })
  assert.equal(ctx.enterpriseMentionLabel(code, 'audit_enabled', { isEnterprise: true }, false), 'audit_enabled (Enterprise) property documentation')
  assert.deepEqual(code.added, ['is-enterprise-property'])
})

test('self-managed page: a class the build added is not added again', () => {
  const code = el({ classes: ['property-ref', 'is-enterprise-property'] })
  assert.equal(ctx.enterpriseMentionLabel(code, 'audit_enabled', { isEnterprise: true }, false), 'audit_enabled (Enterprise) property documentation')
  assert.deepEqual(code.added, [])
})

test('Cloud page: no class and no Enterprise in the name', () => {
  const code = el()
  assert.equal(ctx.enterpriseMentionLabel(code, 'audit_enabled', { isEnterprise: true }, true), 'audit_enabled property documentation')
  assert.deepEqual(code.added, [])
})

test('a property that is not Enterprise stays plain', () => {
  const code = el()
  assert.equal(ctx.enterpriseMentionLabel(code, 'log_segment_size', { isEnterprise: false }, false), 'log_segment_size property documentation')
  assert.deepEqual(code.added, [])
})

test('the property name leaves out the build-time marker', () => {
  assert.equal(ctx.propertyNameOf(el({ text: 'audit_enabled (Enterprise)', marker: ' (Enterprise)' })), 'audit_enabled')
  assert.equal(ctx.propertyNameOf(el({ text: 'x (Enterprise)', attrs: { 'data-property-name': 'audit_enabled' } })), 'audit_enabled')
  assert.equal(ctx.propertyNameOf(el({ text: ' log_segment_size ' })), 'log_segment_size')
})

test('the Cloud test is the same one the description conditionals use', () => {
  assert.match(SRC, /var cloud = definedConditionalAttributes\(\)\.indexOf\('env-cloud'\) !== -1/)
  assert.match(SRC, /enterpriseMentionLabel\(codeEl, text, prop, cloud\)/)
})

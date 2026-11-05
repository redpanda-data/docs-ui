'use strict'

// data-property-meta carries the property's entry from the generated
// property JSON (description, see_also, is_enterprise). The explorer shows
// it near the config bar, escapes all of it, ignores keys it does not know,
// and never turns an unsafe href into a link.
const test = require('node:test')
const assert = require('node:assert')
const { parsePropertyMeta, isSafeHref } = require('../../src/js/iceberg-explorer.js')
const { page, mount } = require('./helpers/dom')

const META = {
  description: 'Enables the translation of topic data into Iceberg tables. <b>bold</b> & more',
  default: null,
  is_enterprise: true,
  cloud_supported: true,
  see_also: [
    { href: '/streaming/current/manage/iceberg/about-iceberg-topics/', text: 'About Iceberg Topics' },
    { href: 'https://docs.example.test/x?a=1&b="2"', text: 'Elsewhere <i>' },
    { href: 'javascript:alert(1)', text: 'Not a link' },
  ],
  source: 'redpanda-properties-v26.2.4.json',
  future_key: { anything: true },
}

test('the description, links and Enterprise badge are shown, escaped', async () => {
  const { mounts, ui, doc, warnings } = await page(mount({ 'data-property-meta': JSON.stringify(META) }))
  const u = ui(mounts[0])
  const desc = u.q('[data-out="property-description"]')
  assert.strictEqual(desc.textContent, META.description)
  assert.strictEqual(desc.querySelector('b'), null, 'markup in the description is text')
  assert.ok(u.q('.ice-configbar').contains(desc), 'shown in the config bar')
  const links = [...u.q('[data-out="property-see-also"]').querySelectorAll('a')]
  assert.deepStrictEqual(links.map((a) => [a.getAttribute('href'), a.textContent]), [
    ['/streaming/current/manage/iceberg/about-iceberg-topics/', 'About Iceberg Topics'],
    ['https://docs.example.test/x?a=1&b="2"', 'Elsewhere <i>'],
  ])
  assert.match(u.q('[data-out="property-see-also"]').textContent, /Not a link$/)
  assert.strictEqual(doc.querySelector('i'), null)
  const badge = u.q('[data-out="enterprise"]')
  assert.strictEqual(badge.textContent, 'Enterprise')
  assert.ok(u.q('.ice-confighead').contains(badge))
  assert.deepStrictEqual(warnings, [])
})

test('without meta, or with meta that says nothing usable, nothing is added', async () => {
  const { mounts, ui, warnings } = await page(
    mount() +
    mount({ 'data-property-meta': '{"is_enterprise":false,"see_also":[],"description":"  "}' }) +
    mount({ 'data-property-meta': '{not json' }) +
    mount({ 'data-property-meta': '["a"]' }))
  for (const m of mounts) {
    assert.strictEqual(m.getAttribute('data-hydrated'), 'true')
    for (const out of ['property-description', 'property-see-also', 'enterprise']) assert.strictEqual(ui(m).q(`[data-out="${out}"]`), null, out)
  }
  assert.ok(warnings.some((w) => /ignored data-property-meta that is not JSON/.test(w)))
})

test('parsePropertyMeta keeps only what the contract defines', () => {
  assert.strictEqual(parsePropertyMeta(null), null)
  assert.strictEqual(parsePropertyMeta('null'), null)
  assert.deepStrictEqual(parsePropertyMeta(JSON.stringify({ description: 'd', is_enterprise: 'yes', see_also: [{ text: 'x' }, { href: '/a' }, 'b'] })), {
    description: 'd', seeAlso: [{ text: 'x', href: null }],
  })
})

test('only http(s), root-relative and same-page hrefs are links', () => {
  for (const ok of ['/a/b', '/a?b#c', 'https://x.test/', 'http://x.test', '#anchor']) assert.ok(isSafeHref(ok), ok)
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:x', '//evil.test', 'data:text/html,x', 'a/b', '/a\\b', '/a b', 'https:///x', '', null, 5]) {
    assert.ok(!isSafeHref(bad), String(bad))
  }
})

'use strict'

// build-iceberg-engine.yml builds, for each supported docs version, the
// engine from that major.minor's latest patch tag, and skips versions whose
// engine is already published (or waiting in its publish PR).
const test = require('node:test')
const assert = require('node:assert')
const { latestPatches, readAntora, supportedMonths, isSupported, pickTargets } = require('../../iceberg-editor/ci/engine-targets.js')

const TAGS = ['v26.2.1', 'v26.2.6', 'v26.2.10-rc1', 'v26.3.1-rc2', 'v26.1.9', 'v26.1.20', 'v24.3.1', 'v25.3.18', 'release-1', 'v26.2.4']
const NOW = new Date('2026-11-05T00:00:00Z')
const doc = (branch, version, released, published = null, pending = null) => ({ branch, version, released, published, pending })

test('the latest patch per major.minor, ignoring release candidates', () => {
  const l = latestPatches(TAGS)
  assert.deepStrictEqual(Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v.tag])), {
    '26.2': 'v26.2.6', '26.1': 'v26.1.20', '24.3': 'v24.3.1', '25.3': 'v25.3.18',
  })
})

test('antora.yml and the playbook are read as the docs read them', () => {
  assert.deepStrictEqual(readAntora("name: streaming\nversion: 26.1\nasciidoc:\n  attributes:\n    page-release-date: 2026-03-31\n"), { version: '26.1', released: '2026-03-31' })
  assert.deepStrictEqual(readAntora("version: '25.3'\n"), { version: '25.3', released: null })
  assert.strictEqual(supportedMonths("eol_settings:\n  - component: 'streaming'\n    supported_months: 12\n    warning_weeks: 13\n"), 12)
  assert.throws(() => supportedMonths('nothing'), /supported_months/)
})

test('main is always supported, older branches for supported_months after release', () => {
  assert.ok(isSupported('main', null, 12, NOW))
  assert.ok(isSupported('v/26.1', '2026-03-31', 12, NOW))
  assert.ok(!isSupported('v/25.1', '2025-04-07', 12, NOW))
  assert.ok(!isSupported('v/25.2', null, 12, NOW), 'no release date, no build')
})

test('only supported versions whose engine is missing or stale are built', () => {
  const docs = [
    doc('main', '26.2', '2026-07-28', 'v26.2.4'),
    doc('v/26.1', '26.1', '2026-03-31', 'v26.1.20'),
    doc('v/25.3', '25.3', '2025-12-01', null, 'v25.3.18'),
    doc('v/24.3', '24.3', '2024-12-03'),
    doc('v/25.2', '25.2', '2025-08-01'),
  ]
  assert.deepStrictEqual(pickTargets({ tags: TAGS, docs, months: 12, now: NOW }), [
    { version: '26.2', ref: 'v26.2.6', branch: 'main', publish_branch: 'auto-docs/iceberg-engine-26.2' },
  ])
})

test('a dispatched tag builds that tag for its version, even if published', () => {
  const docs = [doc('main', '26.2', null, 'v26.2.6'), doc('v/26.1', '26.1', '2026-03-31', 'v26.1.20')]
  assert.deepStrictEqual(pickTargets({ tags: TAGS, docs, months: 12, now: NOW, only: 'v26.2.6' }).map((t) => t.ref), ['v26.2.6'])
  assert.deepStrictEqual(pickTargets({ tags: TAGS, docs, months: 12, now: NOW, only: 'v24.3.1' }), [], 'no supported docs version for 24.3')
})

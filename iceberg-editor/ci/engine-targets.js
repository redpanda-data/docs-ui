#!/usr/bin/env node
'use strict'

// Which Iceberg engines build-iceberg-engine.yml should build and publish.
//
// For every supported docs version of streaming, the engine must be built
// from the latest patch release tag of that major.minor. Nothing here is a
// list to maintain; it is all read from the repositories:
//
//   - Release tags: redpanda-data/streaming-enterprise tags vX.Y.Z (release
//     candidates and other suffixes are not releases).
//   - Docs versions: redpanda-data/docs `main` and its `v/X.Y` branches, each
//     with `version` and `page-release-date` in antora.yml.
//   - Support window: `supported_months` for streaming in the
//     compute-end-of-life settings of docs-site's antora-playbook.yml, the
//     same number the docs use to mark a version end of life. Versions past
//     it are never touched. `main` is always supported.
//   - Published: modules/reference/attachments/iceberg-engine-<X.Y>.json on
//     the docs branch (its redpanda_ref), or on the open publish branch.
//
// Usage (needs GH_TOKEN, or gh auth, with read access to all three repos):
//   engine-targets.js            -> every version whose engine is missing or stale
//   engine-targets.js v26.2.4    -> just that tag (manual or release dispatch)
// Prints a JSON array of { version, ref, branch, publish_branch } and, under
// GitHub Actions, writes it to $GITHUB_OUTPUT as `targets` (and `any`).

const { execFileSync } = require('child_process')
const fs = require('fs')

const SE = 'redpanda-data/streaming-enterprise'
const DOCS = 'redpanda-data/docs'
const SITE = 'redpanda-data/docs-site'
const ATTACHMENTS = 'modules/reference/attachments'
const publishBranch = (version) => 'auto-docs/iceberg-engine-' + version

// ── Pure logic (tests/iceberg-engine/engine-targets.test.js) ────────────────

const releaseTag = (t) => {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(t)
  return m ? { tag: t, version: m[1] + '.' + m[2], patch: Number(m[3]) } : null
}

// The latest patch tag per major.minor.
function latestPatches (tags) {
  const out = {}
  for (const t of tags.map(releaseTag).filter(Boolean)) {
    if (!out[t.version] || t.patch > out[t.version].patch) out[t.version] = t
  }
  return out
}

function readAntora (text) {
  const version = (/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text) || [])[1]
  const released = (/^\s*page-release-date:\s*['"]?(\d{4}-\d{2}-\d{2})/m.exec(text) || [])[1]
  return { version: version ? String(version) : null, released: released || null }
}

function supportedMonths (playbook) {
  const block = /component:\s*['"]?streaming['"]?[\s\S]*?supported_months:\s*(\d+)/.exec(playbook)
  if (!block) throw new Error('no supported_months for streaming in the docs-site playbook')
  return Number(block[1])
}

function isSupported (branch, released, months, now) {
  if (branch === 'main') return true
  if (!released) return false
  const end = new Date(released + 'T00:00:00Z')
  end.setUTCMonth(end.getUTCMonth() + months)
  return now < end
}

// docs: [{ branch, version, released, published, pending }] where published
// and pending are the redpanda_ref on the branch and on its open publish
// branch (or null).
function pickTargets ({ tags, docs, months, now, only }) {
  const latest = latestPatches(tags)
  const targets = []
  for (const d of docs) {
    if (!d.version || !isSupported(d.branch, d.released, months, now)) continue
    let want = latest[d.version]
    if (only) {
      const o = releaseTag(only)
      if (!o || o.version !== d.version) continue
      want = o
    } else if (!want || d.published === want.tag || d.pending === want.tag) {
      continue
    }
    if (!want) continue
    targets.push({ version: d.version, ref: want.tag, branch: d.branch, publish_branch: publishBranch(d.version) })
  }
  return targets
}

// ── I/O ─────────────────────────────────────────────────────────────────────

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const raw = (repo, path, ref) => {
  try {
    return gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`])
  } catch (e) {
    return null
  }
}
const publishedRef = (ref, version) => {
  const text = raw(DOCS, `${ATTACHMENTS}/iceberg-engine-${version}.json`, ref)
  try { return text ? JSON.parse(text).redpanda_ref || null : null } catch (e) { return null }
}

function main () {
  const only = process.argv[2] || ''
  if (only && !releaseTag(only)) {
    console.error(`not a release tag: ${only} (expected vX.Y.Z)`)
    process.exit(1)
  }
  const tags = gh(['api', '--paginate', `repos/${SE}/git/matching-refs/tags/v`, '-q', '.[].ref'])
    .split('\n').filter(Boolean).map((r) => r.replace(/^refs\/tags\//, ''))
  const branches = gh(['api', '--paginate', `repos/${DOCS}/branches?per_page=100`, '-q', '.[].name'])
    .split('\n').filter((b) => b === 'main' || /^v\/\d+\.\d+$/.test(b))
  const playbook = raw(SITE, 'antora-playbook.yml', 'main')
  if (!playbook) throw new Error(`cannot read ${SITE} antora-playbook.yml`)
  const docs = branches.map((branch) => {
    const a = readAntora(raw(DOCS, 'antora.yml', branch) || '')
    return { branch, version: a.version, released: a.released, published: null, pending: null }
  })
  const months = supportedMonths(playbook)
  const now = new Date()
  // Only look up what was published for versions that could be targets.
  for (const d of docs) {
    if (!d.version || !isSupported(d.branch, d.released, months, now)) continue
    d.published = publishedRef(d.branch, d.version)
    d.pending = publishedRef(publishBranch(d.version), d.version)
  }
  const targets = pickTargets({ tags, docs, months, now, only })
  if (only && !targets.length) {
    console.error(`${only}: no supported docs version ${releaseTag(only).version} (branches: ${docs.map((d) => d.branch + '=' + d.version).join(', ')})`)
    process.exit(1)
  }
  console.error(`supported_months=${months}; docs: ${docs.map((d) => `${d.branch}=${d.version}${d.published ? ' (' + d.published + ')' : ''}`).join(', ')}`)
  const json = JSON.stringify(targets)
  console.log(json)
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `targets=${json}\nany=${targets.length > 0}\n`)
  }
}

if (require.main === module) main()
module.exports = { latestPatches, readAntora, supportedMonths, isSupported, pickTargets, publishBranch }

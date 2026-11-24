#!/usr/bin/env node
/**
 * Builds the corpus for extract.test.js: every solution step page, rendered by
 * Antora from a real redpanda-solutions commit with this repository's UI
 * bundle. The quiz reads the rendered page, so the test runs on rendered
 * pages rather than fixtures.
 *
 *   npx gulp bundle
 *   node tests/solution-quiz/build-corpus.mjs --solutions <checkout> [--ref origin/main]
 *
 * --solutions  any redpanda-solutions checkout or worktree. It is only read:
 *              the script clones it, because Antora does not accept a linked
 *              worktree as a local content source.
 * --ref        the commit to build (default origin/main of that checkout)
 * --bundle     the UI bundle (default build/ui-bundle.zip)
 * --out        where the corpus goes (default tests/solution-quiz/.corpus,
 *              which is git-ignored)
 *
 * The playbook is the repository's own tools/local-antora-playbook.yml with
 * two changes: its local content source points at the clone, and the UI bundle
 * is the local one. The other sources stay, because the solutions catalog
 * fails the build when a page's related docs do not resolve. So the build
 * fetches the private docs repositories like the repository's own npm run
 * build: it needs a GitHub token in ~/.git-credentials, Node 22, and the
 * solutions repo's npm dependencies, which the script installs into the clone.
 *
 * Output: <out>/pages/<solution>/<step>.html and <out>/manifest.json with the
 * commit, the bundle and the page list. The clone stays in <out>/src, so a
 * second run only fetches.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

function args (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)$/.exec(argv[i])
    if (m) out[m[1]] = argv[++i]
  }
  return out
}

const opts = args(process.argv.slice(2))
if (!opts.solutions) {
  console.error('usage: build-corpus.mjs --solutions <redpanda-solutions checkout> [--ref origin/main] [--bundle build/ui-bundle.zip] [--out tests/solution-quiz/.corpus]')
  process.exit(2)
}
const major = Number(process.versions.node.split('.')[0])
if (major !== 22) {
  // Antora 3.1 under newer Node versions has been seen to build an empty site
  // without an error.
  console.error(`Node 22 is required, found ${process.version}`)
  process.exit(2)
}

const solutions = path.resolve(opts.solutions)
const ref = opts.ref || 'origin/main'
const bundle = path.resolve(opts.bundle || path.join(root, 'build/ui-bundle.zip'))
const out = path.resolve(opts.out || path.join(here, '.corpus'))
if (!fs.existsSync(bundle)) {
  console.error(`No UI bundle at ${bundle}. Run npx gulp bundle first.`)
  process.exit(2)
}

const run = (cmd, argv, cwd, env) => execFileSync(cmd, argv, { cwd, stdio: 'inherit', env: Object.assign({}, process.env, env || {}) })
const read = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, encoding: 'utf8' }).trim()

const sha = read('git', ['rev-parse', '--verify', ref + '^{commit}'], solutions)
const src = path.join(out, 'src')
const site = path.join(out, 'site')
const pages = path.join(out, 'pages')

// A normal clone at the commit. Reused when it is already there, since the
// npm install is the slow part.
if (!fs.existsSync(path.join(src, '.git'))) {
  fs.mkdirSync(out, { recursive: true })
  run('git', ['clone', '--quiet', '--no-checkout', solutions, src])
}
run('git', ['fetch', '--quiet', solutions, sha], src)
run('git', ['checkout', '--quiet', '--force', '--detach', sha], src)
const lock = path.join(src, 'package-lock.json')
const stamp = path.join(src, 'node_modules', '.corpus-lock')
const lockText = fs.readFileSync(lock, 'utf8')
if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== lockText) {
  run('npm', ['ci', '--no-audit', '--no-fund'], src)
  fs.writeFileSync(stamp, lockText)
}

const playbook = yaml.safeLoad(fs.readFileSync(path.join(src, 'tools/local-antora-playbook.yml'), 'utf8'))
playbook.content.sources = playbook.content.sources.map((source) =>
  source.url === '~+' ? Object.assign({}, source, { url: src, branches: 'HEAD' }) : source)
playbook.ui = { bundle: { url: bundle, snapshot: true } }
playbook.output = { clean: true, dir: site }
// Next to the repository's own playbook: Antora resolves the generator and
// the extensions from the playbook's directory.
const playbookPath = path.join(src, 'tools', 'corpus-antora-playbook.yml')
fs.writeFileSync(playbookPath, yaml.safeDump(playbook))

run(path.join(src, 'node_modules/.bin/antora'), ['--fetch', playbookPath], src, { SOLUTIONS_INCLUDE_DRAFTS: 'true' })

// Step pages are the ones the solution-step layout rendered.
fs.rmSync(pages, { recursive: true, force: true })
const list = []
const solutionsDir = path.join(site, 'solutions')
for (const slug of fs.existsSync(solutionsDir) ? fs.readdirSync(solutionsDir).sort() : []) {
  const dir = path.join(solutionsDir, slug)
  if (!fs.statSync(dir).isDirectory()) continue
  for (const step of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, step, 'index.html')
    if (!fs.existsSync(file)) continue
    const html = fs.readFileSync(file, 'utf8')
    if (!/<body class="[^"]*\bsolution-step\b/.test(html)) continue
    fs.mkdirSync(path.join(pages, slug), { recursive: true })
    fs.writeFileSync(path.join(pages, slug, step + '.html'), html)
    list.push({ solution: slug, step, path: `/solutions/${slug}/${step}/` })
  }
}
if (!list.length) {
  console.error('The build produced no solution step pages.')
  process.exit(1)
}
// The whole site is close to 2 GB with the docs components. Only the step
// pages are kept.
fs.rmSync(site, { recursive: true, force: true })
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
  solutionsSha: sha,
  ref,
  bundle,
  builtAt: new Date().toISOString(),
  pages: list,
}, null, 2) + '\n')
console.log(`Wrote ${list.length} step pages from ${sha.slice(0, 12)} to ${pages}`)

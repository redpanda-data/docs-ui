#!/usr/bin/env node
/**
 * Generates agent companions on disk with a local checkout of the companion
 * generator, so the evals can test a procedure change before any docs build
 * publishes it. The procedure an agent follows lives in the companion's How
 * to use this, which the generator writes; the preview's companions come from
 * whatever generator version its last build used.
 *
 *   node evals/solutions-prompts/gen-companions.mjs \
 *     --dem <docs-extensions-and-macros checkout> \
 *     --solutions <redpanda-solutions checkout> [--ref origin/main] \
 *     [--out evals/solutions-prompts/.companions] [slug ...]
 *
 * The solution sources are read from `--ref` with `git show`, so the
 * checkout's working tree and branch are never touched. For each slug it
 * reads every page under docs/modules/<slug>/pages/, resolves
 * include::partial$ lines against docs/modules/<slug>/partials/ through the
 * generator's own partialResolver, adds solutions/<slug>/scripts/verify.sh,
 * and calls generateAgentCompanion, as the solutions-catalog extension does
 * in a docs build. The links keep the production site URL, as in a build.
 *
 * Writes <out>/<slug>/agent-companion.md and <out>/manifest.json (the
 * generator and solutions commits, and any leaks), which run.mjs reads.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_OUT = path.join(HERE, '.companions')
export const DEFAULT_SLUGS = ['multiplayer-gaming', 'kafka-migration', 'cdc-to-lakehouse']

// The companion with its procedure (the ### Steps and ### Constraints of How
// to use this) removed. The section's heading and its guide to the other
// sections stay, so only the procedure is missing.
export function stripProcedure (text) {
  const out = String(text).replace(/\n### Steps\n[\s\S]*?\n(?=## )/, '\n')
  if (/^### (Steps|Constraints)$/m.test(out) || !/^## How to use this$/m.test(out) || out === text) throw new Error('could not remove only the procedure from How to use this')
  return out
}

function parseArgs (argv) {
  const o = { dem: process.env.EVAL_DEM || '', solutions: process.env.EVAL_SOLUTIONS || '', ref: 'origin/main', out: DEFAULT_OUT, slugs: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dem') o.dem = argv[++i]
    else if (a === '--solutions') o.solutions = argv[++i]
    else if (a === '--ref') o.ref = argv[++i]
    else if (a === '--out') o.out = argv[++i]
    else if (a.startsWith('--')) throw new Error('unknown argument ' + a)
    else o.slugs.push(a)
  }
  if (!o.dem || !o.solutions) throw new Error('--dem and --solutions are required (or EVAL_DEM and EVAL_SOLUTIONS)')
  if (!o.slugs.length) o.slugs = DEFAULT_SLUGS
  return o
}

function git (repo, args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} in ${repo}: ${r.stderr.trim()}`)
  return r.stdout
}

// Every file under `dir` at `ref`, as { relative path: source }.
function filesAt (repo, ref, dir, ext) {
  const out = {}
  const list = git(repo, ['ls-tree', '-r', '--name-only', ref, '--', dir]).split('\n').filter(Boolean)
  for (const f of list) {
    if (ext && !f.endsWith(ext)) continue
    out[f.slice(dir.length + 1)] = git(repo, ['show', `${ref}:${f}`])
  }
  return out
}

export function generate ({ dem, solutions, ref, slug }) {
  const require = createRequire(path.join(path.resolve(dem), 'package.json'))
  const generator = require(path.join(path.resolve(dem), 'extensions', 'solutions-catalog', 'agent-companion.js'))
  const pages = {}
  for (const [rel, text] of Object.entries(filesAt(solutions, ref, `docs/modules/${slug}/pages`, '.adoc'))) {
    if (!rel.includes('/')) pages[rel.replace(/\.adoc$/, '')] = text
  }
  if (!pages.index) throw new Error(`${slug}: no docs/modules/${slug}/pages/index.adoc at ${ref}`)
  const partials = filesAt(solutions, ref, `docs/modules/${slug}/partials`)
  let verifyScript
  try { verifyScript = git(solutions, ['show', `${ref}:solutions/${slug}/scripts/verify.sh`]) } catch (e) { verifyScript = undefined }
  const resolveInclude = generator.partialResolver(partials, { module: slug })
  return generator.generateAgentCompanion({ slug, pages, verifyScript, resolveInclude })
}

function main () {
  const o = parseArgs(process.argv.slice(2))
  const manifest = {
    generatedAt: new Date().toISOString(),
    dem: git(o.dem, ['rev-parse', 'HEAD']).trim(),
    demDirty: git(o.dem, ['status', '--porcelain']).trim() !== '',
    solutions: git(o.solutions, ['rev-parse', o.ref]).trim(),
    solutionsRef: o.ref,
    companions: {},
  }
  for (const slug of o.slugs) {
    const r = generate({ dem: o.dem, solutions: o.solutions, ref: o.ref, slug })
    const file = path.join(o.out, slug, 'agent-companion.md')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, r.markdown)
    manifest.companions[slug] = { rules: r.rules.filter((x) => x.rule).length, bytes: Buffer.byteLength(r.markdown), leaks: r.leaks }
    console.log(`${slug}: ${manifest.companions[slug].rules} rules, ${manifest.companions[slug].bytes} bytes${r.leaks.length ? ', leaks: ' + r.leaks.join(', ') : ''}`)
  }
  fs.writeFileSync(path.join(o.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (e) { console.error(e.message); process.exit(1) }
}

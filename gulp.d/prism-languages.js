'use strict'

/**
 * Prism grammars bundled into js/vendor/prism/prism-core.js (see
 * gulp.d/tasks/generate-prism.js). The vendored file this replaces was the
 * prismjs.com download with all 230+ grammars: 677 KB, ~350 ms of parse and
 * evaluation on a slow machine, for a site that uses about 35 of them.
 *
 * Derived from the language- classes present in a full site build on
 * 2026-09-12 (count of code blocks in parentheses). Aliases resolve to the
 * grammar that owns them (sh/shell -> bash, yml -> yaml, xml -> markup,
 * dockerfile -> docker, js -> javascript, ts -> typescript). Tags the site
 * uses that Prism has no grammar for (promql is included; cedar, jql, spark,
 * cue, fish, avro, console, zsh) render as plain text, exactly as before.
 * Dependencies (clike, markup-templating, ...) are added automatically.
 *
 * Add a grammar when a new language- class shows up unhighlighted; the tags
 * in use are one grep away:
 *   grep -rhoE 'language-[a-z0-9_+-]+' docs --include=index.html | sort | uniq -c
 */
module.exports = [
  'bash', // 22,897
  'yaml', // 8,089 (+ yml 1,065)
  'sql', // 1,918
  'json', // 1,018
  'promql', // 482
  'python', // 301
  'go', // 225
  'javascript', // 191 (+ js 99)
  'rust', // 113
  'hcl', // 76
  'ini', // 71
  'properties', // 53
  'java', // 32
  'toml', // 25
  'markup', // xml 11, html
  'docker', // dockerfile 9
  'protobuf', // 8 (+ proto 14)
  'nginx', // 7
  'csv', // 7
  'c', // 7
  'cue', // 4
  'csharp', // 4
  'php', // 2
  'kotlin', // 2
  'asciidoc', // 2
  'powershell', // 1
  'diff', // 1
  'typescript', // ts 12
  'graphql',
  'ruby',
  'scala',
  'http',
  'makefile',
  'git',
  'regex',
  'markdown',
  'css',
]

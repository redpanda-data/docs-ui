'use strict'

const fs = require('fs')
const path = require('path')
const log = require('fancy-log')
const https = require('https')

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/redpanda-data/connect/releases/latest'
const CONNECT_JSON_BASE = 'https://docs.redpanda.com/redpanda-connect/components/_attachments'
const FALLBACK_VERSIONS = ['4.79.0', '4.78.0', '4.77.0', '4.76.0', '4.75.0']

function fetchJSON (url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'docs-ui-build' },
    }
    https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        res.resume()
        return
      }
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(err)
        }
      })
    }).on('error', reject)
  })
}

async function getLatestVersion () {
  try {
    const release = await fetchJSON(GITHUB_RELEASES_URL)
    return release.tag_name.replace(/^v/, '')
  } catch (err) {
    log.warn('Could not fetch latest Connect version from GitHub:', err.message)
    return null
  }
}

async function fetchConnectJSON (version) {
  const url = `${CONNECT_JSON_BASE}/connect-${version}.json`
  try {
    return await fetchJSON(url)
  } catch (err) {
    log.warn(`Could not fetch connect-${version}.json:`, err.message)
    return null
  }
}

function extractNames (data) {
  const functions = []
  const methods = []

  if (Array.isArray(data['bloblang-functions'])) {
    for (const fn of data['bloblang-functions']) {
      if (fn.name) functions.push(fn.name)
    }
  }

  if (Array.isArray(data['bloblang-methods'])) {
    for (const method of data['bloblang-methods']) {
      if (method.name) methods.push(method.name)
    }
  }

  return { functions: functions.sort(), methods: methods.sort() }
}

function generateGrammar (functions, methods) {
  return `/**
 * Prism syntax highlighting for Bloblang (blobl)
 *
 * Bloblang is Redpanda Connect's native mapping language for transforming data.
 * @see https://docs.redpanda.com/redpanda-connect/guides/bloblang/about/
 *
 * AUTO-GENERATED from Connect JSON - do not edit manually.
 * Run: gulp generate:bloblang-grammar
 */

(function (Prism) {
  var functions = ${JSON.stringify(functions)}.join('|');
  var methods = ${JSON.stringify(methods)}.join('|');

  Prism.languages.bloblang = {
    'comment': {
      pattern: /#.*/,
      greedy: true
    },

    'string': [
      {
        pattern: /"""[\\s\\S]*?"""/,
        greedy: true,
        alias: 'multiline-string'
      },
      {
        pattern: /(["'])(?:\\\\(?:\\r\\n|[\\s\\S])|(?!\\1)[^\\\\\\r\\n])*\\1/,
        greedy: true
      }
    ],

    'spread': {
      pattern: /\\.\\*/,
      alias: 'operator'
    },

    'keyword': {
      pattern: /\\b(?:root|this|let|meta|if|else|match|case|_)\\b/,
      lookbehind: false
    },

    'function': {
      pattern: new RegExp('\\\\b(?:' + functions + ')(?=\\\\s*\\\\()', 'i')
    },

    'method': {
      pattern: new RegExp('\\\\.\\\\s*(?:' + methods + ')(?=\\\\s*\\\\()', 'i'),
      inside: {
        'punctuation': /^\\./
      }
    },

    'boolean': /\\b(?:true|false)\\b/,

    'null': {
      pattern: /\\bnull\\b/,
      alias: 'keyword'
    },

    'number': /\\b-?(?:0x[\\da-f]+|\\d+(?:\\.\\d*)?(?:e[+-]?\\d+)?)\\b/i,

    'metadata': {
      pattern: /@(?:[\\w-]+|\\.[\\w-]+|\\()/,
      alias: 'variable'
    },

    'variable': {
      pattern: /\\$[\\w-]+/
    },

    'operator': [
      /->/,
      {
        pattern: /\\|/,
        alias: 'coalesce'
      },
      /[<>]=?|[!=]=?|&&|\\|\\||!(?!=)/,
      /=/,
      /[+\\-*\\/%]/
    ],

    'punctuation': /[{}[\\]();:,]|\\.(?!\\*)|->|\\.\\.\\.?/,

    'property': {
      pattern: /\\.[\\w-]+/,
      inside: {
        'punctuation': /^\\./
      }
    }
  };

  Prism.languages.blobl = Prism.languages.bloblang;

}(Prism));
`
}

module.exports = (destPath) => async (done) => {
  try {
    log('Fetching Connect JSON for Bloblang grammar generation...')

    let data = null

    // Try latest version first
    const latestVersion = await getLatestVersion()
    if (latestVersion) {
      log(`Trying latest version: ${latestVersion}`)
      data = await fetchConnectJSON(latestVersion)
    }

    // Fall back through known versions
    if (!data) {
      for (const version of FALLBACK_VERSIONS) {
        log(`Trying fallback version: ${version}`)
        data = await fetchConnectJSON(version)
        if (data) break
      }
    }

    if (!data) {
      log.warn('Could not fetch Connect JSON, keeping existing grammar')
      done()
      return
    }

    const { functions, methods } = extractNames(data)
    log(`Found ${functions.length} functions and ${methods.length} methods`)

    const grammar = generateGrammar(functions, methods)

    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.writeFileSync(destPath, grammar)
    log(`Generated: ${destPath}`)

    done()
  } catch (err) {
    log.error('Failed to generate Bloblang grammar:', err)
    done(err)
  }
}

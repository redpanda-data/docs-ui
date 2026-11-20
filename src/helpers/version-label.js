'use strict'

// The version number a version selector shows, without a trailing status
// word: the status shows once, as the chip beside it, so a prerelease whose
// display version is "7.0 Beta" reads "v7.0" and then "Beta", not "v7.0 Beta
// Beta". A display version that is only a status word is left as it is.
// Usage: v{{version-label displayVersion}}
const STATUS = /\s*\(?\b(beta|preview|latest|supported|end of life|eol)\)?\s*$/i

module.exports = (displayVersion) => {
  const text = displayVersion == null ? '' : String(displayVersion)
  const bare = text.replace(STATUS, '')
  return bare || text
}

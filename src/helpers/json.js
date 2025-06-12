'use strict'

module.exports = (input) => {
  if (typeof input === 'object' && input !== null) {
    return input // Already parsed
  }

  if (typeof input !== 'string') {
    console.warn('⚠️ Expected a JSON string but received:', typeof input)
    return null
  }

  try {
    return JSON.parse(input)
  } catch (err) {
    console.error('❌ Failed to parse JSON string:', input)
    return null
  }
}

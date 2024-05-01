'use strict'

module.exports = () => {
  const today = new Date()
  // Returns date in YYYY-MM-DD format
  return today.toISOString().substring(0, 10)
}

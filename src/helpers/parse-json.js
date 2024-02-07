'use strict'

module.exports = (inputString) => {
  try {
    const parsed = JSON.parse(inputString)
    return parsed
  } catch (error) {
    return []
  }
}

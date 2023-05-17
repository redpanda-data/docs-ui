'use strict'

module.exports = (url, { data: { root } }) => {
  const urlParts = url.split('/')
  if (urlParts[urlParts.length - 1] === '') {
    urlParts.pop() // remove trailing slash
  }
  urlParts.pop() // remove last path component
  return urlParts.join('/')
}

'use strict'

module.exports = (url, { data: { root } }) => {
  console.log(url)
  const urlParts = url.split('/')
  console.log(urlParts)
  if (urlParts[urlParts.length - 1] === '') {
    urlParts.pop() // remove trailing slash
  }
  urlParts.pop() // remove last path component
  console.log(urlParts)
  return urlParts.join('/')
}

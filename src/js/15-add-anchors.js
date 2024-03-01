document.addEventListener('DOMContentLoaded', () => {
  const docElement = document.querySelector('.doc')
  if (docElement) {
    const childElementsWithId = docElement.querySelectorAll('*:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6)[id]')
    childElementsWithId.forEach((element) => {
      const anchor = document.createElement('a')
      anchor.className = 'anchor'
      anchor.href = `#${element.id}`
      anchor.setAttribute('aria-label', 'Link to this section')
      element.parentNode.append(anchor)
    })
  }
})

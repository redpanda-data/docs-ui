module.exports = (currentPage) => {
  const currentVersion = currentPage.attributes.version
  for (let i = 0; i < currentPage.component.versions.length; i++) {
    const version = currentPage.component.versions[i].version
    if (currentVersion === version) {
      if (currentPage.component.versions[i].prerelease === true) {
        return true
      } else {
        return false
      }
    } else {
      return false
    }
  }
}

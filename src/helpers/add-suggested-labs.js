'use strict'

module.exports = (attributes, content, { data: { root } }) => {
  const { contentCatalog } = root
  if (attributes['component-name'] === 'redpanda-labs') return content
  if (!contentCatalog) return content

  // Extract related labs from attributes
  const relatedLabs = attributes['related-labs'] ? JSON.parse(attributes['related-labs']) : []

  if (!relatedLabs.length) return content

  // Append "Suggested labs" heading if there are matching labs
  let contentString = content.toString('utf8')
  contentString += '<div class="sect1">\n<h2 id="suggested-labs">Suggested labs</h2>\n<div class="sectionbody">\n<div class="ulist">\n<ul>'

  relatedLabs.forEach((lab, index) => {
    if (index > 10) return
    const hiddenClass = index >= 5 ? ' class="to-hide hidden"' : ''
    contentString += `<li${hiddenClass}><a href="${lab.url}">${lab.title}</a></li>`
  })

  contentString += '</ul></div><div class="badge-container">'

  if (relatedLabs.length > 5) {
    contentString += '<div class="badge-button" id="see-more-btn">See more</div>'
  }
  contentString += '<div class="badge-button"><a href="/redpanda-labs" class="search-all-labs-btn">Search all labs</a></div>'
  contentString += `
      </div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', function() {
    const seeMoreBtn = document.getElementById('see-more-btn');
    if (seeMoreBtn) {
      seeMoreBtn.addEventListener('click', function() {
        const hiddenItems = document.querySelectorAll('.ulist li.to-hide');
        let anyItemWasHidden = false;
        hiddenItems.forEach(function(item) {
          if (item.classList.contains('hidden')) {
            anyItemWasHidden = true;
          }
          item.classList.toggle('hidden');
        });
        hiddenItemsVisible = anyItemWasHidden;
        seeMoreBtn.textContent = hiddenItemsVisible ? "See Less" : "See More";
      });
    }
  });
  </script>`.trim()

  const modifiedContent = Buffer.from(contentString, 'utf8')
  return modifiedContent
}

/**
 * Optimize image loading for better performance
 * - Add lazy loading for off-screen images
 * - Add async decoding for better rendering performance
 * - Add explicit dimensions to prevent layout shifts
 */
(function () {
  'use strict'

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', optimizeImages)
  } else {
    optimizeImages()
  }

  function optimizeImages () {
    const images = document.querySelectorAll('.doc img:not([loading])')

    images.forEach((img) => {
      // Add lazy loading for off-screen images
      // This significantly reduces initial page load for image-heavy pages
      img.setAttribute('loading', 'lazy')

      // Add async decoding for better render performance
      img.setAttribute('decoding', 'async')

      // If image doesn't have explicit dimensions, try to set them once loaded
      // This helps prevent layout shifts
      if (!img.hasAttribute('width') || !img.hasAttribute('height')) {
        // If image is already loaded (cached), set dimensions immediately
        if (img.complete && img.naturalWidth > 0) {
          setImageDimensions(img)
        } else {
          // Otherwise wait for load event
          img.addEventListener('load', function () {
            setImageDimensions(this)
          }, { once: true })
        }
      }
    })
  }

  function setImageDimensions (img) {
    // Get the natural dimensions
    const naturalWidth = img.naturalWidth
    const naturalHeight = img.naturalHeight

    // Get the displayed dimensions
    const displayedWidth = img.offsetWidth
    const displayedHeight = img.offsetHeight

    // Only set dimensions if the image is actually being resized by CSS
    // This preserves the aspect ratio and helps with CLS
    if (displayedWidth > 0 && displayedHeight > 0) {
      img.setAttribute('width', displayedWidth)
      img.setAttribute('height', displayedHeight)

      // Log warning if image is significantly oversized (developer tool)
      if (naturalWidth > displayedWidth * 2 || naturalHeight > displayedHeight * 2) {
        const savings = Math.round(((naturalWidth * naturalHeight) - (displayedWidth * displayedHeight)) /
          (naturalWidth * naturalHeight) * 100)
        console.info(
          `Image oversized: ${img.src.split('/').pop()} ` +
          `(${naturalWidth}×${naturalHeight} displayed as ${displayedWidth}×${displayedHeight}, ` +
          `~${savings}% potential savings)`
        )
      }
    }
  }
})()

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

    images.forEach((img, index) => {
      // First image is likely LCP - prioritize it and don't lazy load
      if (index === 0) {
        // Optimize LCP by making it eagerly loaded with high priority
        img.setAttribute('loading', 'eager')
        img.setAttribute('fetchpriority', 'high')
      } else {
        // Add lazy loading for off-screen images
        // This significantly reduces initial page load for image-heavy pages
        img.setAttribute('loading', 'lazy')
      }

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
    // Don't overwrite existing width/height attributes
    if (img.hasAttribute('width') && img.hasAttribute('height')) {
      return
    }

    // Get the natural (intrinsic) dimensions
    const naturalWidth = img.naturalWidth
    const naturalHeight = img.naturalHeight

    // Get the displayed dimensions (fallback)
    const displayedWidth = img.offsetWidth
    const displayedHeight = img.offsetHeight

    // Prefer intrinsic dimensions to keep images responsive
    // Only use displayed dimensions if intrinsic dimensions unavailable
    let width = naturalWidth
    let height = naturalHeight

    // Fallback to displayed dimensions if intrinsic dimensions are zero/unavailable
    if (width === 0 || height === 0) {
      width = displayedWidth
      height = displayedHeight
    }

    // Only set dimensions if we have valid values
    if (width > 0 && height > 0) {
      img.setAttribute('width', width)
      img.setAttribute('height', height)

      // Log warning if image is significantly oversized (developer tool)
      if (naturalWidth > 0 && displayedWidth > 0 &&
          (naturalWidth > displayedWidth * 2 || naturalHeight > displayedHeight * 2)) {
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

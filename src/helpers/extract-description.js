'use strict'

/**
 * Extract a clean description from page content for meta tags
 * This helper strips HTML, removes excess whitespace, and truncates to a specified length
 * 
 * @param {string} content - The HTML content to extract description from
 * @param {number} maxLength - Maximum length of the description (default: 160)
 * @returns {string} Clean description text
 */
module.exports = (content, maxLength = 160) => {
  if (!content || typeof content !== 'string') {
    return ''
  }

  // Remove HTML tags
  let cleanText = content.replace(/<[^>]*>/g, ' ')
  
  // Remove AsciiDoc markup patterns
  cleanText = cleanText
    .replace(/\[.*?\]/g, '') // Remove attributes like [.class]
    .replace(/={2,}/g, '') // Remove heading markers
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1') // Remove bold/italic markers
    .replace(/_([^_]+)_/g, '$1') // Remove italic markers
    .replace(/`([^`]+)`/g, '$1') // Remove code markers
    .replace(/\+{3,}[\s\S]*?\+{3,}/g, '') // Remove code blocks
    .replace(/----[\s\S]*?----/g, '') // Remove literal blocks
    
  // Clean up whitespace
  cleanText = cleanText
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/\n\s*\n/g, ' ') // Remove line breaks
    .trim()

  // Extract first sentence or paragraph that's meaningful
  const sentences = cleanText.split(/[.!?]+/)
  let description = ''
  
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (trimmed.length > 20) { // Skip very short fragments
      description = trimmed
      break
    }
  }
  
  // If no good sentence found, use the beginning of the content
  if (!description && cleanText.length > 20) {
    description = cleanText
  }
  
  // Truncate to max length, ensuring we don't cut words
  if (description.length > maxLength) {
    const truncated = description.substring(0, maxLength)
    const lastSpace = truncated.lastIndexOf(' ')
    description = lastSpace > maxLength * 0.8 ? truncated.substring(0, lastSpace) : truncated
    description += '...'
  }
  
  return description
}

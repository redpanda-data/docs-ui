;(function (root, factory) {
  const agentHandoff = factory()

  if (typeof module === 'object' && module.exports) {
    module.exports = agentHandoff
  } else {
    root.RedpandaDocsAgentHandoff = agentHandoff
  }
})(typeof window === 'undefined' ? this : window, function () {
  const headingPattern = /^(#{1,6})[ \t]+(.+?)\s*$/
  const fencePattern = /^[ \t]*(`{3,}|~{3,})/

  function normalizedAnchors (sectionAnchor) {
    const rawAnchor = sectionAnchor.replace(/^#/, '')
    let decodedAnchor

    try {
      decodedAnchor = decodeURIComponent(rawAnchor)
    } catch (error) {
      decodedAnchor = rawAnchor
    }

    const generatedMarkdownAnchor = decodedAnchor.replace(/^_/, '').replace(/_/g, '-')
    return generatedMarkdownAnchor === decodedAnchor
      ? [decodedAnchor]
      : [decodedAnchor, generatedMarkdownAnchor]
  }

  function extractMarkdownSection (markdown, sectionAnchor) {
    const fullPage = markdown.trim()
    if (!sectionAnchor) return fullPage

    const anchorMarkers = normalizedAnchors(sectionAnchor).map((anchor) => `(#${anchor})`)
    const lines = fullPage.split('\n')
    const headingLines = computeHeadingLines(lines)
    const startIndex = lines.findIndex(
      (line, index) => headingLines[index] && anchorMarkers.some((marker) => line.includes(marker))
    )
    if (startIndex === -1) return fullPage

    const sectionLevel = lines[startIndex].match(headingPattern)[1].length
    const endIndex = lines.findIndex((line, index) => {
      if (index <= startIndex) return false

      if (!headingLines[index]) return false
      return line.match(headingPattern)[1].length <= sectionLevel
    })

    return lines.slice(startIndex, endIndex === -1 ? undefined : endIndex).join('\n').trim()
  }

  function computeHeadingLines (lines) {
    let fenceMarker = ''

    return lines.map((line) => {
      const fence = line.match(fencePattern)
      if (fence) {
        const marker = fence[1][0]
        if (!fenceMarker) fenceMarker = marker
        else if (marker === fenceMarker) fenceMarker = ''
        return false
      }

      return !fenceMarker && headingPattern.test(line)
    })
  }

  function buildAgentHandoffPrompt ({
    componentName = '',
    docsOrigin,
    markdown,
    markdownUrl,
    pageTitle,
    pageUrl,
    sectionAnchor = '',
    sectionTitle = '',
  }) {
    const context = extractMarkdownSection(markdown, sectionAnchor)
    const componentExport = componentName
      ? new URL(`/${encodeURIComponent(componentName)}-full.txt`, docsOrigin).href
      : null
    const scope = [
      `- Documentation page: ${pageTitle}`,
      sectionTitle ? `- Current section: ${sectionTitle}` : null,
      `- Page: ${pageUrl}`,
      `- Markdown source: ${markdownUrl}`,
    ].filter(Boolean)
    const sources = [
      `- Documentation index: ${new URL('/llms.txt', docsOrigin).href}`,
      componentExport ? `- Component documentation export: ${componentExport}` : null,
      `- Documentation MCP server: ${new URL('/mcp', docsOrigin).href}`,
    ].filter(Boolean)
    const instructions = [
      "1. Read the current project's agent and contributor instructions before changing anything.",
      '2. Inspect the project and identify where this documentation applies. Do not invent Redpanda commands, fields, or behavior.',
      '3. If applicable, implement the smallest reversible change and preserve unrelated behavior. If not applicable, explain why and stop.',
      '4. You may edit and test local files. Before destructive operations, external mutations, or changes to a live ' +
        'Redpanda environment, show the plan or diff and get my confirmation. Never expose credentials or secrets.',
      "5. Run the project's relevant checks and any documented Redpanda validation or diff command.",
      '6. Summarize the changes, verification, remaining manual steps, and any missing or conflicting documentation.',
    ]

    return `# Apply this Redpanda documentation

Work in the current project. Determine whether this guidance applies, then make the smallest safe update that keeps the project aligned with the current Redpanda pattern.

## Scope

${scope.join('\n')}

## Authoritative Redpanda context

${sources.join('\n')}

## Instructions

${instructions.join('\n')}

## Documentation context

--- BEGIN CURRENT DOCUMENTATION ---
${context}
--- END CURRENT DOCUMENTATION ---`
  }

  return {
    buildAgentHandoffPrompt,
    extractMarkdownSection,
  }
})

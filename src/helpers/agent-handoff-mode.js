/**
 * The agent handoff instruction set to use for the current page.
 * Pages opt in with `:page-agent-handoff:` (project instructions, the default)
 * or `:page-agent-handoff: ui` (instructions for UI/console-driven workflows).
 */

module.exports = ({ data: { root } }) => {
  return root.page?.attributes?.['agent-handoff'] || 'project'
}

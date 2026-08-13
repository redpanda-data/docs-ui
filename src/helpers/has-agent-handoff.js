/**
 * Show the agent handoff action only when the page opts in.
 */

module.exports = ({ data: { root } }) => {
  return root.page?.attributes?.['agent-handoff'] !== undefined
}

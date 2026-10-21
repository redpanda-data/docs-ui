/**
 * Chat modes: the Ask AI drawer running a task other than open questions, such
 * as the quiz on a solution step.
 *
 * WHY THIS EXISTS
 * ---------------
 * A mode changes more than the prompt. It runs on its own Kapa integration,
 * passes its own tools and source groups, keeps its thread out of the reader's
 * resume pointer and history list, strips its own control lines from answers,
 * and stays out of the Ask AI analytics. The quiz pilot did each of these at a
 * separate call site and missed several (the resume pointer, history, other
 * Ask AI entry points). Every one of those decisions is read from the table
 * below instead, so a new mode is one entry.
 *
 * Plain JavaScript with no React or DOM imports, so the decisions can be tested
 * under node (tests/chat-modes). AskAI.jsx and ChatInterface.jsx apply them.
 *
 * HOW A MODE STARTS AND ENDS
 * --------------------------
 * The page sets window.__docsChatMode = { mode, nonce, ... } and dispatches
 * MODE_EVENT, then sends the first message through
 * openChatWithQuery(query, true, { mode, nonce }) (19-chat-panel.js). A mode
 * lasts until one of these: Back to Ask AI, Clear or New chat, an
 * openChatWithQuery call from outside the mode, or a page load. Each of those
 * except the page load goes through endChatMode(), which clears the globals and
 * dispatches MODE_END_EVENT. Closing the drawer does not end a mode, so a
 * reader can close it to read the step and reopen it.
 */

export const MODE_EVENT = 'docs-chat:mode'
export const MODE_END_EVENT = 'docs-chat:mode-end'
// The quiz pilot's event. Still honoured, so a page and a drawer bundle from
// either side of the change work together.
export const LEGACY_QUIZ_EVENT = 'docs-chat:quiz'

// sessionStorage key for the reader's Ask AI conversation, so navigating
// between docs pages (full reloads) resumes the same thread.
export const ACTIVE_THREAD_KEY = 'kapa-active-thread'

export const QUIZ_INSTRUCTIONS = `

## Quiz mode
The reader is working through a Redpanda Solutions step and asked to be quizzed on it.
- Ask three questions, ONE at a time, and wait for the reader's answer before the next.
- Start each question with "**Question N of 3**".
- Every question must be answerable from the step described below and the docs it links to.
  Search the knowledge base for the step's page first, and base each question on what you find.
- Prefer questions about why the step works (the rule it establishes, what breaks without it,
  what a command's output shows) over recall of exact commands or flags.
- Mix multiple choice (four options, labelled A to D) and short answers. For multiple choice,
  put each option on its own line, then end the message with this line and nothing after it:
  OPTIONS: A | B | C | D
- After each answer, start with exactly one of "Correct.", "Partly correct.", or "Not quite.",
  explain in one or two sentences, and cite the page that supports it. If the reader is partly
  right, say which part.
- If you cannot support a question or an answer from the sources, do not ask it.
- After the third answer, write "You got N of 3." and suggest what to reread for anything
  missed. End that message with this line and nothing after it:
  QUIZ_RESULT: N/3
- If the reader asks something unrelated, answer it briefly, then offer to continue the quiz.`

export function quizContext (quiz) {
  const lines = ['\n\n## Step to quiz on']
  if (quiz.title) lines.push(`- Step: ${quiz.title}`)
  if (quiz.solution) lines.push(`- Solution: ${quiz.solution}`)
  if (quiz.url) lines.push(`- Page: ${quiz.url}`)
  if (quiz.rule) lines.push(`- The rule this step establishes: ${quiz.rule}`)
  return lines.join('\n')
}

// One entry per mode.
//   label            banner prefix, as in "Quiz: Create the topics"
//   integrationKey   window global holding the Kapa integration id. Empty or
//                    missing turns the mode off and the drawer stays Ask AI.
//   sourceGroupsKey  window global with the mode's own source groups. When it
//                    is not an array, the page's scope is used, so any search
//                    the model makes stays scoped rather than unfiltered.
//   baseBlocks       the CUSTOM_INSTRUCTIONS sections the mode keeps
//   tools            names of the agent tools the mode passes
//   instructions     the mode's own prompt, appended after the base blocks
//   enableHistory    Agent SDK history for the mode's provider
//   persistThread    whether the thread becomes the reader's resume pointer
//   showSources      whether answers list their sources
//   controls         machine-read final lines stripped from answers, last first
//   threadPrefix     how the mode's first message starts, used to keep its
//                    threads out of the Ask AI history list
//   firstMessage     the opener sent when the page did not supply one
//   placeholder, inputLabel  the message box while the mode runs
//   viewLabel        banner link back to the page the mode is about
//   restart          whether the banner offers Restart
//   signInTitle      what the anonymous tier says instead of running the mode
//   events           Heap event names. Ask AI's own ask and answer events are
//                    never sent in a mode.
export const MODES = {
  quiz: {
    label: 'Quiz',
    integrationKey: 'KAPA_QUIZ_INTEGRATION_ID',
    sourceGroupsKey: 'KAPA_QUIZ_SOURCE_GROUP_IDS',
    baseBlocks: ['Domain context', 'Writing style'],
    tools: [],
    instructions: (detail) => QUIZ_INSTRUCTIONS + quizContext(detail),
    enableHistory: false,
    persistThread: false,
    showSources: false,
    controls: ['QUIZ_RESULT', 'OPTIONS'],
    threadPrefix: 'Quiz me on this step',
    firstMessage: (detail) => 'Quiz me on this step' + (detail.title ? ': ' + detail.title : '') + '.',
    placeholder: 'Type your answer, or pick an option',
    inputLabel: 'Your answer',
    viewLabel: 'View step',
    restart: true,
    signInTitle: 'Sign in to take the quiz',
    events: {
      ready: 'solution_quiz_ready',
      blocked: 'solution_quiz_blocked',
      question: 'solution_quiz_question',
      answer: 'solution_quiz_answer',
      complete: 'solution_quiz_complete',
      end: 'solution_quiz_end',
      error: 'solution_quiz_error',
    },
  },
  // productionize: the "Take this to production" planner. Same shape, on
  // KAPA_PRODUCTIONIZE_INTEGRATION_ID, labelled "Planning", with threadPrefix
  // 'Help me take ' so its threads leave the history list too.
}

// The mode the page asked for, or null. The pilot's window.__docsChatQuiz
// carries no `mode` field, so it reads as a quiz.
export function readMode (win) {
  const w = win || window
  const detail = w.__docsChatMode || (w.__docsChatQuiz ? Object.assign({ mode: 'quiz' }, w.__docsChatQuiz) : null)
  return normalizeMode(detail)
}

export function normalizeMode (detail) {
  if (!detail || typeof detail !== 'object') return null
  const mode = detail.mode || 'quiz'
  return MODES[mode] ? Object.assign({}, detail, { mode }) : null
}

// Everything the drawer needs to run `detail` as a mode, or null when the mode
// is unknown or switched off. `pageScope` is the page's source groups.
export function resolveMode (detail, win, pageScope) {
  const d = normalizeMode(detail)
  if (!d) return null
  const def = MODES[d.mode]
  const w = win || window
  const integrationId = w[def.integrationKey]
  if (!integrationId) return null
  const own = w[def.sourceGroupsKey]
  const sourceGroupIds = Array.isArray(own) ? own.filter(Boolean) : (pageScope || [])
  return Object.assign({}, def, { name: d.mode, detail: d, integrationId, sourceGroupIds })
}

// The `## ` sections of CUSTOM_INSTRUCTIONS named in `blocks`, in source order.
// Inside them, a top-level bullet that names an agent tool the mode does not
// pass is dropped with its sub-lines: telling the model to verify with
// run_bloblang when it has no run_bloblang sends it looking for a tool that is
// not there. `knownTools` is every tool name the prompt might mention.
export function buildBaseInstructions (text, blocks, tools, knownTools) {
  const passed = new Set(tools || [])
  const missing = (knownTools || []).filter((name) => !passed.has(name))
  const mentionsMissing = (lines) => missing.some((name) => lines.some((l) => new RegExp(`\\b${name}\\b`).test(l)))
  const sections = String(text || '').split(/^(?=## )/m)
  const kept = []
  for (const section of sections) {
    const heading = /^## (.+)$/m.exec(section)
    if (!heading || !blocks.includes(heading[1].trim())) continue
    const lines = section.replace(/\s+$/, '').split('\n')
    const out = [lines[0]]
    let bullet = []
    const flush = () => {
      if (bullet.length && !mentionsMissing(bullet)) out.push(...bullet)
      bullet = []
    }
    for (const line of lines.slice(1)) {
      if (/^- /.test(line)) flush()
      if (/^- /.test(line) || bullet.length) bullet.push(line)
      else out.push(line)
    }
    flush()
    kept.push(out.join('\n'))
  }
  return kept.join('\n\n')
}

// Split machine-read control lines off the end of an answer.
//   OPTIONS: A | B | C   choices the UI renders as buttons
//   QUIZ_RESULT: 2/3     the score the quiz reports
// `controls` lists the lines to strip, last line first. While `streaming`, a
// trailing line that is still the start of a control line is hidden too, so
// "OPTI" or "QUIZ_RES" never flashes in the answer before the rest arrives.
export function splitModeControls (md, opts) {
  const o = opts || {}
  const controls = o.controls || ['OPTIONS']
  let text = md || ''
  if (o.streaming) {
    const nl = text.lastIndexOf('\n')
    const tail = nl >= 0 ? text.slice(nl + 1).trim() : ''
    if (tail && controls.some((name) => (name + ':').startsWith(tail))) text = text.slice(0, nl)
  }
  let options = []
  let result = null
  for (const name of controls) {
    const match = new RegExp(`\\n\\s*${name}:[ \\t]*([^\\n]*?)\\s*$`).exec(text)
    if (!match) continue
    if (name === 'OPTIONS') {
      const parsed = match[1]
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s && s.length <= 60)
        .slice(0, 5)
      // A finished line with fewer than two options is prose, not a control,
      // so it stays. Mid-stream it is a control still arriving.
      if (parsed.length < 2 && !o.streaming) continue
      options = parsed.length < 2 ? [] : parsed
    } else if (name === 'QUIZ_RESULT') {
      const score = /^(\d+)\s*\/\s*(\d+)$/.exec(match[1])
      result = score ? { score: Number(score[1]), total: Number(score[2]) } : null
    }
    text = text.slice(0, match.index)
  }
  return { md: text, options, result }
}

// The text a reader sees as the answer: the last non-empty text block. Earlier
// text blocks are interim narration.
export function answerText (message) {
  const blocks = (message && message.blocks) || []
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'text' && (blocks[i].content || '').trim()) return blocks[i].content
  }
  return (message && message.content) || ''
}

// Where a quiz stands, from the conversation alone. `tally` counts answers
// graded "Correct." since the last "Question 1 of 3", so it can be checked
// against the score the model reports. "Partly correct." does not count.
export function quizProgress (messages) {
  let questionsSeen = 0
  let tally = 0
  let result = null
  let answers = 0
  for (const m of messages || []) {
    if (m.role === 'user') {
      if (questionsSeen > answers) answers++
      continue
    }
    const text = answerText(m)
    if (/^\s*(?:\*\*)?Correct\./.test(text)) tally++
    const asked = /Question\s+(\d+)\s+of\s+3/.exec(text)
    if (asked) {
      const n = Number(asked[1])
      if (n === 1) { tally = 0; answers = 0; result = null }
      questionsSeen = n
    }
    const controls = splitModeControls(text, { controls: MODES.quiz.controls })
    if (controls.result) result = controls.result
  }
  return { questionsSeen, answers, tally, result }
}

// Threads a mode started, by their first message. The Agent SDK lists threads
// across integrations, as far as is known (unverified), so without this a quiz
// shows up in the reader's Ask AI history.
export function isModeThread (title) {
  const t = String(title || '').trim()
  return Object.values(MODES).some((def) => t.startsWith(def.threadPrefix))
}

// The resume pointer. A mode with persistThread false neither writes nor
// clears it, so the reader's Ask AI conversation survives a quiz.
export function rememberThread (storage, threadId, persist) {
  if (!persist || !threadId) return
  try { storage.setItem(ACTIVE_THREAD_KEY, threadId) } catch { /* storage unavailable */ }
}

export function threadToResume (storage, persist) {
  if (!persist) return null
  try { return storage.getItem(ACTIVE_THREAD_KEY) || null } catch { return null }
}

export function forgetThread (storage, persist) {
  if (!persist) return
  try { storage.removeItem(ACTIVE_THREAD_KEY) } catch { /* ignore */ }
}

// End the current mode. 19-chat-panel.js owns this as window.endChatMode so it
// can also cancel queries waiting to be sent. Pages without the drawer script
// (the docs home mounts the chat inline) fall back to the same two steps here.
export function endChatMode (reason, win) {
  const w = win || window
  if (typeof w.endChatMode === 'function') return w.endChatMode(reason)
  const active = w.__docsChatMode || null
  w.__docsChatMode = null
  w.__docsChatQuiz = null
  w.dispatchEvent(new w.CustomEvent(MODE_END_EVENT, { detail: { reason, mode: active && active.mode } }))
}

// Start `detail` as a mode, or start it again with a fresh nonce (Restart).
export function startChatMode (detail, win) {
  const w = win || window
  const d = normalizeMode(detail)
  if (!d) return
  const next = Object.assign({}, d, { nonce: Date.now() })
  w.__docsChatMode = next
  w.dispatchEvent(new w.CustomEvent(MODE_EVENT, { detail: next }))
  const first = next.firstMessage || MODES[next.mode].firstMessage(next)
  if (typeof w.openChatWithQuery === 'function') w.openChatWithQuery(first, true, { mode: next.mode, nonce: next.nonce })
}

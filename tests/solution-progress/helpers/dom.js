'use strict'

/**
 * A very small DOM stand-in for driving src/js/28-solution-progress.js and
 * 29-solutions-home.js with node:test and vm.runInNewContext (no jsdom in
 * this repo). Supports what those modules use: attribute/class/tag compound
 * selectors (`a[data-x][data-y]`, `.cls`, `input[name="q"]:checked`),
 * querySelector(All) over descendants, hidden/textContent/style, classList,
 * addEventListener + a dispatch helper, appendChild/removeChild.
 */

const TOKEN = /^(?:([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:(checked))/

function parseCompound (selector) {
  const parts = []
  let rest = selector.trim()
  while (rest.length) {
    const m = TOKEN.exec(rest)
    if (!m) throw new Error('Unsupported selector in test DOM stub: ' + selector)
    if (m[1]) parts.push({ tag: m[1].toUpperCase() })
    else if (m[2]) parts.push({ cls: m[2] })
    else if (m[3]) parts.push({ id: m[3] })
    else if (m[4]) parts.push({ attr: m[4], value: m[5] })
    else if (m[6]) parts.push({ checked: true })
    rest = rest.slice(m[0].length)
  }
  return parts
}

class El {
  constructor (tag, attrs, children) {
    this.tagName = String(tag).toUpperCase()
    this.attrs = Object.assign({}, attrs || {})
    this.children = []
    this.parentNode = null
    this.hidden = 'hidden' in this.attrs
    delete this.attrs.hidden
    this.textContent = this.attrs.text || ''
    delete this.attrs.text
    this.style = {}
    this.handlers = {}
    this.open = 'open' in this.attrs
    this.checked = false
    this.value = ''
    this._innerHTML = ''
    this.classes = new Set(String(this.attrs.class || '').split(/\s+/).filter(Boolean))
    const self = this
    this.classList = {
      add () { Array.prototype.forEach.call(arguments, (n) => self.classes.add(n)) },
      remove () { Array.prototype.forEach.call(arguments, (n) => self.classes.delete(n)) },
      contains (n) { return self.classes.has(n) },
      toggle (n) { if (self.classes.has(n)) { self.classes.delete(n); return false } self.classes.add(n); return true },
    }
    ;(children || []).forEach((c) => this.appendChild(c))
  }

  get href () { return this.getAttribute('href') || '' }
  set href (v) { this.setAttribute('href', v) }
  get innerHTML () { return this._innerHTML }
  set innerHTML (v) { this._innerHTML = String(v); this.children = [] }
  get className () { return Array.from(this.classes).join(' ') }
  set className (v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)) }

  appendChild (child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    return child
  }

  removeChild (child) {
    const i = this.children.indexOf(child)
    if (i !== -1) { this.children.splice(i, 1); child.parentNode = null }
    return child
  }

  remove () { if (this.parentNode) this.parentNode.removeChild(this) }

  getAttribute (name) {
    if (name === 'class') return this.className
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }

  setAttribute (name, value) {
    if (name === 'class') { this.className = value; return }
    this.attrs[name] = String(value)
  }

  hasAttribute (name) {
    if (name === 'class') return this.classes.size > 0
    return Object.prototype.hasOwnProperty.call(this.attrs, name)
  }

  addEventListener (type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn) }
  removeEventListener (type, fn) {
    this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== fn)
  }

  // Test helper: fire handlers registered on this element (no bubbling).
  dispatch (type, event) {
    const ev = Object.assign({ type, target: this, defaultPrevented: false }, event || {})
    if (!ev.preventDefault) ev.preventDefault = () => { ev.defaultPrevented = true }
    ;(this.handlers[type] || []).forEach((fn) => fn(ev))
    return ev
  }

  matches (compound) {
    return parseCompound(compound).every((p) => {
      if (p.tag) return this.tagName === p.tag
      if (p.cls) return this.classes.has(p.cls)
      if (p.id) return this.attrs.id === p.id
      if (p.attr) return this.hasAttribute(p.attr) && (p.value === undefined || this.attrs[p.attr] === p.value)
      if (p.checked) return this.checked === true
      return false
    })
  }

  descendants () {
    const out = []
    const walk = (el) => el.children.forEach((c) => { out.push(c); walk(c) })
    walk(this)
    return out
  }

  querySelectorAll (selector) {
    const compounds = selector.split(',').map((s) => s.trim()).filter(Boolean)
    const all = this.descendants()
    return all.filter((el) => compounds.some((c) => el.matches(c)))
  }

  querySelector (selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function el (tag, attrs, children) { return new El(tag, attrs, children) }

function matchesAny (el, selector) {
  return selector.split(',').map((s) => s.trim()).filter(Boolean).some((c) => el.matches(c))
}

function makeDocument (body) {
  return {
    body,
    cookie: '',
    activeElement: null,
    readyState: 'complete',
    createElement: (tag) => new El(tag),
    createEvent () { throw new Error('createEvent not supported') },
    querySelector: (sel) => (matchesAny(body, sel) ? body : body.querySelector(sel)),
    querySelectorAll: (sel) => (matchesAny(body, sel) ? [body] : []).concat(body.querySelectorAll(sel)),
    addEventListener () {},
    removeEventListener () {},
  }
}

module.exports = { El, el, makeDocument, parseCompound }

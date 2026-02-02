/* eslint-disable */
/**
 * Bloblang Interactive Features
 *
 * Adds interactive UX enhancements to Bloblang code blocks:
 * - Inline documentation tooltips for functions/methods
 * - "Try It" button to execute code in mini-playground
 * - Quick actions (copy, share, format)
 */

(function() {
  'use strict';

  // State
  let bloblangDocs = null;
  let docsLoading = false;
  let docsLoadQueue = [];

  /**
   * Parse a Bloblang snippet into mapping, input, and metadata sections.
   * Looks for # In: and # Meta: comment directives.
   * # Out: lines are ignored.
   */
  function parseBloblangSnippet(rawSnippet) {
    const mappingLines = [];
    const inputLines = [];
    const metaLines = [];

    let inSeen = false;
    let metaSeen = false;
    let ignoreAll = false;
    let currentSection = 'mapping';

    const lines = rawSnippet.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (ignoreAll) continue;

      // Ignore # Out: lines
      if (trimmed.startsWith('# Out:')) continue;

      // Check for # In: directive
      if (trimmed.startsWith('# In:')) {
        if (!inSeen) {
          inSeen = true;
          currentSection = 'in';
          const afterIn = trimmed.slice('# In:'.length).trim();
          if (afterIn) inputLines.push(afterIn);
        } else {
          ignoreAll = true;
        }
        continue;
      }

      // Check for # Meta: directive
      if (trimmed.startsWith('# Meta:')) {
        if (!metaSeen) {
          metaSeen = true;
          currentSection = 'meta';
          const afterMeta = trimmed.slice('# Meta:'.length).trim();
          if (afterMeta) metaLines.push(afterMeta);
        } else {
          ignoreAll = true;
        }
        continue;
      }

      switch (currentSection) {
        case 'mapping':
          mappingLines.push(line);
          break;
        case 'in':
          // Support multi-line commented input (# prefix on each line)
          if (trimmed.startsWith('#')) {
            // Strip the # and any leading whitespace
            const content = trimmed.slice(1).trim();
            if (content) inputLines.push(content);
          } else if (trimmed === '') {
            // Allow empty lines within the block
            continue;
          } else {
            // Non-comment line - we've exited the input section
            currentSection = 'mapping';
            mappingLines.push(line);
          }
          break;
        case 'meta':
          // Support multi-line commented metadata (# prefix on each line)
          if (trimmed.startsWith('#')) {
            const content = trimmed.slice(1).trim();
            if (content) metaLines.push(content);
          } else if (trimmed === '') {
            continue;
          } else {
            currentSection = 'mapping';
            mappingLines.push(line);
          }
          break;
      }
    }

    return {
      mapping: mappingLines.join('\n').trim(),
      input: inputLines.join('\n').trim(),
      meta: metaLines.join('\n').trim()
    };
  }

  /**
   * Try to fetch Connect JSON for a specific version
   */
  async function tryFetchConnectJSON(version) {
    try {
      const url = `/redpanda-connect/components/_attachments/connect-${version}.json`;
      const response = await fetch(url);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data;
    } catch (e) {
      console.log(`Failed to fetch Connect ${version}:`, e);
      return null;
    }
  }

  /**
   * Transform Connect JSON into documentation format
   */
  function transformConnectData(data) {
    const docs = {
      functions: {},
      methods: {}
    };

    // Transform Bloblang functions
    if (Array.isArray(data['bloblang-functions'])) {
      data['bloblang-functions'].forEach(fn => {
        const params = fn.params && fn.params.named ? fn.params.named.map(p => ({
          name: p.name,
          type: p.type || 'any',
          description: p.description || ''
        })) : [];

        const paramSignature = params.length > 0
          ? params.map(p => p.name).join(', ')
          : '';

        docs.functions[fn.name] = {
          signature: `${fn.name}(${paramSignature})`,
          description: fn.description || 'Bloblang function',
          parameters: params,
          returns: 'any',
          category: fn.category || 'general',
          url: `https://docs.redpanda.com/redpanda-connect/guides/bloblang/functions/#${fn.name.toLowerCase().replace(/_/g, '-')}`
        };

        // Add example if available
        if (fn.examples && fn.examples.length > 0) {
          const example = fn.examples[0];
          if (example.mapping) {
            docs.functions[fn.name].example = example.mapping;
          }
        }
      });
    }

    // Transform Bloblang methods
    if (Array.isArray(data['bloblang-methods'])) {
      data['bloblang-methods'].forEach(method => {
        const params = method.params && method.params.named ? method.params.named.map(p => ({
          name: p.name,
          type: p.type || 'any',
          description: p.description || ''
        })) : [];

        const paramSignature = params.length > 0
          ? params.map(p => p.name).join(', ')
          : '';

        docs.methods[method.name] = {
          signature: `${method.name}(${paramSignature})`,
          description: method.description || 'Bloblang method',
          parameters: params,
          returns: 'any',
          category: method.categories && method.categories.length > 0 ? method.categories[0].Category : 'general',
          url: `https://docs.redpanda.com/redpanda-connect/guides/bloblang/methods/#${method.name.toLowerCase().replace(/_/g, '-')}`
        };

        // Add example if available
        if (method.examples && method.examples.length > 0) {
          const example = method.examples[0];
          if (example.mapping) {
            docs.methods[method.name].example = example.mapping;
          }
        }
      });
    }

    return docs;
  }

  /**
   * Load Bloblang documentation from Connect JSON
   */
  async function loadBloblangDocs() {
    if (bloblangDocs) {
      return bloblangDocs;
    }

    if (docsLoading) {
      return new Promise((resolve) => {
        docsLoadQueue.push(resolve);
      });
    }

    docsLoading = true;

    try {
      // Try to get latest version from GitHub releases
      let data = null;
      try {
        const releasesResp = await fetch('https://api.github.com/repos/redpanda-data/connect/releases/latest');
        if (releasesResp.ok) {
          const release = await releasesResp.json();
          const version = release.tag_name.replace(/^v/, '');
          data = await tryFetchConnectJSON(version);
        }
      } catch (e) {
        console.log('Could not fetch latest Connect version, trying fallbacks', e);
      }

      // Fallback: try known recent versions
      if (!data) {
        const fallbackVersions = ['4.78.0', '4.77.0', '4.76.0', '4.75.0', '4.74.0'];
        for (const version of fallbackVersions) {
          data = await tryFetchConnectJSON(version);
          if (data) break;
        }
      }

      // Transform data to our format
      if (data) {
        bloblangDocs = transformConnectData(data);
        console.log(`Loaded ${Object.keys(bloblangDocs.functions).length} functions and ${Object.keys(bloblangDocs.methods).length} methods`);
      } else {
        // Fallback to static file if available
        try {
          const response = await fetch(uiRootPath + '/bloblang-docs.json');
          bloblangDocs = await response.json();
          console.log('Loaded fallback static documentation');
        } catch (err) {
          console.warn('Could not load any Bloblang documentation');
          bloblangDocs = { functions: {}, methods: {} };
        }
      }

      docsLoading = false;

      // Resolve all queued promises
      docsLoadQueue.forEach(resolve => resolve(bloblangDocs));
      docsLoadQueue = [];

      return bloblangDocs;
    } catch (error) {
      console.error('Failed to load Bloblang documentation:', error);
      docsLoading = false;
      bloblangDocs = { functions: {}, methods: {} };
      return bloblangDocs;
    }
  }

  /**
   * Create HTML for documentation tooltip
   */
  function createDocTooltip(doc) {
    let html = `
      <div class="bloblang-doc-tooltip">
        <div class="doc-signature"><code>${escapeHtml(doc.signature)}</code></div>
        <div class="doc-description">${escapeHtml(doc.description)}</div>
    `;

    if (doc.parameters && doc.parameters.length > 0) {
      html += '<div class="doc-parameters"><strong>Parameters:</strong><ul>';
      doc.parameters.forEach(param => {
        html += `<li><code>${escapeHtml(param.name)}</code> (${escapeHtml(param.type)}): ${escapeHtml(param.description)}</li>`;
      });
      html += '</ul></div>';
    }

    if (doc.returns) {
      html += `<div class="doc-returns"><strong>Returns:</strong> <code>${escapeHtml(doc.returns)}</code></div>`;
    }

    if (doc.example) {
      html += `<div class="doc-example"><pre><code>${escapeHtml(doc.example)}</code></pre></div>`;
    }

    if (doc.url) {
      html += `<a href="${escapeHtml(doc.url)}" target="_blank" rel="noopener" class="doc-link">View full documentation →</a>`;
    }

    html += '</div>';
    return html;
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Check if device is touch-based
   */
  function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  /**
   * Add tooltips to Bloblang tokens
   */
  function addDocumentationTooltips(codeBlock) {
    // Skip tooltips on touch devices - hover doesn't work naturally
    if (isTouchDevice()) {
      return;
    }

    if (!window.tippy) {
      console.warn('Tippy.js not loaded, skipping Bloblang tooltips');
      return;
    }

    loadBloblangDocs().then(docs => {
      if (!docs) return;

      // Add tooltips to functions
      codeBlock.querySelectorAll('.token.function').forEach(el => {
        const functionName = el.textContent.trim();
        const doc = docs.functions[functionName];

        if (doc) {
          el.classList.add('has-documentation');
          el.style.cursor = 'help';
          el.setAttribute('tabindex', '0');
          el.setAttribute('role', 'button');
          el.setAttribute('aria-label', `${functionName} function documentation`);

          tippy(el, {
            content: createDocTooltip(doc),
            allowHTML: true,
            interactive: true,
            theme: 'bloblang-doc',
            placement: 'top',
            maxWidth: 450,
            appendTo: document.body,
            onShow(instance) {
              // Hide other tooltips
              document.querySelectorAll('.tippy-box').forEach(box => {
                if (box !== instance.popper) {
                  box._tippy && box._tippy.hide();
                }
              });
            }
          });
        }
      });

      // Add tooltips to methods
      codeBlock.querySelectorAll('.token.method').forEach(el => {
        const methodText = el.textContent.trim();
        const methodName = methodText.replace(/^\./, '').replace(/\(\)$/, '');
        const doc = docs.methods[methodName];

        if (doc) {
          el.classList.add('has-documentation');
          el.style.cursor = 'help';
          el.setAttribute('tabindex', '0');
          el.setAttribute('role', 'button');
          el.setAttribute('aria-label', `${methodName} method documentation`);

          tippy(el, {
            content: createDocTooltip(doc),
            allowHTML: true,
            interactive: true,
            theme: 'bloblang-doc',
            placement: 'top',
            maxWidth: 450,
            appendTo: document.body,
            onShow(instance) {
              document.querySelectorAll('.tippy-box').forEach(box => {
                if (box !== instance.popper) {
                  box._tippy && box._tippy.hide();
                }
              });
            }
          });
        }
      });

      // Add keyboard accessibility
      codeBlock.querySelectorAll('.has-documentation').forEach(el => {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            el._tippy && el._tippy.show();
          } else if (e.key === 'Escape') {
            el._tippy && el._tippy.hide();
          }
        });
      });
    });
  }

  /**
   * Add "Try It" button to code block
   */
  function addTryItButton(listingBlock, code) {
    const toolbox = listingBlock.querySelector('.source-toolbox');
    if (!toolbox) return;

    // Check if already has button
    if (toolbox.querySelector('.try-bloblang-button')) return;

    // Parse the code block to extract mapping, input, and metadata from comments
    const parsed = parseBloblangSnippet(code);

    // Helper to get attribute from listingblock, pre, or code element
    const getDataAttr = (name) => {
      const pre = listingBlock.querySelector('pre');
      const codeEl = listingBlock.querySelector('code');
      return listingBlock.getAttribute(name) ||
             (pre && pre.getAttribute(name)) ||
             (codeEl && codeEl.getAttribute(name));
    };

    // Use parsed values, with fallbacks from data attributes or defaults
    const mapping = parsed.mapping || code;
    const inputData = parsed.input || getDataAttr('data-bloblang-input') || '{}';
    const metadata = parsed.meta || getDataAttr('data-bloblang-metadata') || '{}';

    const button = document.createElement('button');
    button.className = 'try-bloblang-button';
    button.textContent = 'Try It';
    button.setAttribute('aria-label', 'Try this Bloblang mapping');
    button.setAttribute('data-tippy-content', 'Execute this mapping in a mini-playground');

    button.addEventListener('click', () => {
      openBloblangPlayground(mapping, inputData, metadata);
    });

    // Add to toolbox
    toolbox.appendChild(button);

    // Initialize tooltip if tippy is available
    if (window.tippy) {
      tippy(button, {
        delay: [200, 0]
      });
    }
  }

  // WASM and script loading state
  let wasmLoading = false;
  let wasmLoaded = false;
  let wasmLoadPromise = null;
  let scriptsLoaded = false;
  let scriptsLoadPromise = null;

  /**
   * Dynamically load a script
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  /**
   * Load required scripts for the mini-playground (Ace, wasm_exec)
   */
  function loadRequiredScripts() {
    if (scriptsLoaded) {
      return Promise.resolve();
    }

    if (scriptsLoadPromise) {
      return scriptsLoadPromise;
    }

    const rootPath = typeof uiRootPath !== 'undefined' ? uiRootPath : '/_';

    scriptsLoadPromise = Promise.all([
      // Load wasm_exec.js if Go is not defined
      typeof Go === 'undefined' ? loadScript(rootPath + '/js/vendor/wasm_exec.js') : Promise.resolve(),
      // Load Ace if not defined
      typeof ace === 'undefined' ? loadScript(rootPath + '/js/vendor/ace/ace.js') : Promise.resolve()
    ]).then(() => {
      // Load Ace dependencies after ace.js
      const acePromises = [];
      if (typeof ace !== 'undefined') {
        acePromises.push(
          loadScript(rootPath + '/js/vendor/ace/theme-github.js'),
          loadScript(rootPath + '/js/vendor/ace/mode-json.js'),
          loadScript(rootPath + '/js/vendor/ace/mode-bloblang.js')
        );
      }
      return Promise.all(acePromises);
    }).then(() => {
      scriptsLoaded = true;
    });

    return scriptsLoadPromise;
  }

  /**
   * Load the Bloblang WASM module on demand
   */
  function loadBloblangWasm() {
    if (wasmLoaded && window.blobl) {
      return Promise.resolve();
    }

    if (wasmLoading && wasmLoadPromise) {
      return wasmLoadPromise;
    }

    wasmLoading = true;

    // WASM is in the UI bundle directory (same as uiRootPath)
    const rootPath = typeof uiRootPath !== 'undefined' ? uiRootPath : '/_';
    const wasmPath = rootPath + '/blobl.wasm';

    wasmLoadPromise = new Promise((resolve, reject) => {
      // First ensure wasm_exec.js is loaded
      loadRequiredScripts()
        .then(() => {
          if (typeof Go === 'undefined') {
            reject(new Error('Go WASM runtime not available'));
            return;
          }

          const go = new Go();
          WebAssembly.instantiateStreaming(fetch(wasmPath), go.importObject)
            .then((result) => {
              go.run(result.instance);
              wasmLoaded = true;
              wasmLoading = false;
              resolve();
            })
            .catch((err) => {
              wasmLoading = false;
              reject(err);
            });
        })
        .catch(reject);
    });

    return wasmLoadPromise;
  }

  /**
   * Initialize an Ace editor instance
   */
  function initAceEditor(elementId, mode, readOnly, initialValue) {
    if (typeof ace === 'undefined') {
      return null;
    }

    const editor = ace.edit(elementId);

    // Set theme - use github if available, otherwise use a built-in light theme
    try {
      editor.setTheme('ace/theme/github');
    } catch (e) {
      // Fallback - textmate is a built-in light theme
      console.warn('GitHub theme not available, using default');
    }

    editor.session.setMode(mode);
    editor.setReadOnly(readOnly);
    editor.setValue(initialValue || '', -1);
    editor.setOptions({
      fontSize: '13px',
      showPrintMargin: false,
      showGutter: true,
      highlightActiveLine: !readOnly,
      tabSize: 2,
      useSoftTabs: true,
      wrap: true,
      minLines: 4,
      maxLines: 15,
      useWorker: false  // Disable workers to avoid 404s for missing worker files
    });

    // Force light background via CSS as fallback
    const container = document.getElementById(elementId);
    if (container) {
      container.style.backgroundColor = '#fff';
    }

    return editor;
  }

  /**
   * Encodes a string as base64 using UTF-8.
   * Matches the encoding used by the main playground.
   */
  function encodeBase64(str) {
    const utf8Bytes = new TextEncoder().encode(str);
    let binaryStr = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binaryStr += String.fromCharCode(utf8Bytes[i]);
    }
    return window.btoa(binaryStr);
  }

  /**
   * Build the full playground URL with encoded parameters
   */
  function buildPlaygroundUrl(input, mapping, meta) {
    const baseUrl = '/redpanda-connect/guides/bloblang/playground/';
    const params = new URLSearchParams();

    if (input) {
      params.set('input', encodeBase64(input));
    }
    if (mapping) {
      params.set('map', encodeBase64(mapping));
    }
    // Always include meta to prevent main playground from showing "Loading..."
    params.set('meta', encodeBase64(meta || '{}'));

    const queryString = params.toString();
    return queryString ? `${baseUrl}?${queryString}` : baseUrl;
  }

  /**
   * Open mini-playground modal
   */
  function openBloblangPlayground(mapping, inputData, metadata) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'bloblang-playground-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'playground-title');

    // Build initial playground URL with current data
    const initialPlaygroundUrl = buildPlaygroundUrl(inputData || '{}', mapping, metadata || '{}');

    overlay.innerHTML = `
      <div class="bloblang-mini-playground">
        <div class="mini-playground-header">
          <h3 id="playground-title">Bloblang Playground</h3>
          <button class="mini-playground-close" aria-label="Close playground">&times;</button>
        </div>
        <div class="mini-playground-body">
          <div class="mini-playground-section">
            <label>Input</label>
            <div id="mini-playground-input" class="mini-ace-editor"></div>
          </div>
          <div class="mini-playground-section mini-playground-section-mapping">
            <label>Mapping</label>
            <div id="mini-playground-mapping" class="mini-ace-editor"></div>
          </div>
          <div class="mini-playground-section">
            <label>Output</label>
            <div id="mini-playground-output" class="mini-ace-editor"></div>
          </div>
        </div>
        <div class="mini-playground-footer">
          <div class="mini-playground-status">Loading WASM...</div>
          <div class="mini-playground-actions">
            <button class="mini-playground-button mini-playground-run" disabled>Run</button>
            <button class="mini-playground-button mini-playground-copy-output">Copy Output</button>
            <a href="${initialPlaygroundUrl}" target="_blank" class="mini-playground-link">Open Full Playground →</a>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Get elements
    const closeBtn = overlay.querySelector('.mini-playground-close');
    const runBtn = overlay.querySelector('.mini-playground-run');
    const copyBtn = overlay.querySelector('.mini-playground-copy-output');
    const statusEl = overlay.querySelector('.mini-playground-status');

    // Editor references (will be set after scripts load)
    let inputEditor = null;
    let mappingEditor = null;
    let outputEditor = null;

    // Show loading status
    showStatus('Loading editor...', 'info');

    // Load required scripts first, then initialize editors and WASM
    loadRequiredScripts()
      .then(() => {
        // Initialize Ace editors after scripts are loaded
        inputEditor = initAceEditor('mini-playground-input', 'ace/mode/json', false, inputData || '{}');
        mappingEditor = initAceEditor('mini-playground-mapping', 'ace/mode/bloblang', false, mapping);
        outputEditor = initAceEditor('mini-playground-output', 'ace/mode/json', true, '');

        // Add keyboard shortcut for running
        if (mappingEditor) {
          mappingEditor.commands.addCommand({
            name: 'runMapping',
            bindKey: { win: 'Ctrl-Enter', mac: 'Cmd-Enter' },
            exec: runMapping
          });
        }
        if (inputEditor) {
          inputEditor.commands.addCommand({
            name: 'runMapping',
            bindKey: { win: 'Ctrl-Enter', mac: 'Cmd-Enter' },
            exec: runMapping
          });
          inputEditor.focus();
        }

        showStatus('Loading WASM...', 'info');

        // Now load WASM
        return loadBloblangWasm();
      })
      .then(() => {
        showStatus('Ready', 'ready');
        runBtn.disabled = false;
        // Focus mapping editor
        if (mappingEditor) {
          mappingEditor.focus();
        }
      })
      .catch((err) => {
        showStatus('Failed to load: ' + err.message, 'error');
        console.error('Mini-playground load error:', err);
      });

    // Close handlers
    function closePlayground() {
      document.removeEventListener('keydown', handleEscape);
      // Destroy Ace editors
      if (inputEditor) inputEditor.destroy();
      if (mappingEditor) mappingEditor.destroy();
      if (outputEditor) outputEditor.destroy();
      overlay.remove();
    }

    function handleEscape(e) {
      if (e.key === 'Escape') {
        closePlayground();
      }
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePlayground();
    });
    closeBtn.addEventListener('click', closePlayground);
    document.addEventListener('keydown', handleEscape);

    // Run mapping
    function runMapping() {
      const currentMapping = mappingEditor ? mappingEditor.getValue() : '';
      const currentInput = inputEditor ? inputEditor.getValue() : '{}';

      if (!currentMapping.trim()) {
        showStatus('Please enter a mapping', 'error');
        return;
      }

      if (!window.blobl) {
        showStatus('WASM not loaded yet', 'error');
        return;
      }

      try {
        showStatus('Running...', 'info');
        const result = window.blobl(currentMapping, currentInput);

        if (typeof result === 'string' && result.startsWith('Error:')) {
          showStatus(result, 'error');
          if (outputEditor) outputEditor.setValue('', -1);
        } else {
          // Format JSON if possible
          let formattedResult = result;
          try {
            const parsed = JSON.parse(result);
            formattedResult = JSON.stringify(parsed, null, 2);
          } catch {
            // Not JSON, use as-is
          }
          if (outputEditor) outputEditor.setValue(formattedResult, -1);
          showStatus('Success!', 'success');
        }
      } catch (error) {
        showStatus('Error: ' + error.message, 'error');
        if (outputEditor) outputEditor.setValue('', -1);
      }
    }

    function showStatus(message, type) {
      statusEl.textContent = message;
      statusEl.className = 'mini-playground-status mini-playground-status-' + type;

      if (type === 'success') {
        setTimeout(() => {
          if (statusEl.textContent === message) {
            statusEl.textContent = 'Ready';
            statusEl.className = 'mini-playground-status mini-playground-status-ready';
          }
        }, 2000);
      }
    }

    // Copy output
    function copyOutput() {
      const output = outputEditor ? outputEditor.getValue() : '';
      if (!output) {
        showStatus('No output to copy', 'error');
        return;
      }

      // Try modern clipboard API first, fall back to execCommand
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(output).then(() => {
          showStatus('Copied!', 'success');
        }).catch(() => {
          fallbackCopy(output);
        });
      } else {
        fallbackCopy(output);
      }
    }

    // Fallback copy method for older browsers or non-HTTPS
    function fallbackCopy(text) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        showStatus('Copied!', 'success');
      } catch (e) {
        showStatus('Failed to copy', 'error');
      }
      document.body.removeChild(textarea);
    }

    // Event listeners
    runBtn.addEventListener('click', runMapping);
    copyBtn.addEventListener('click', copyOutput);

    // Update playground link with current editor state when clicked
    const playgroundLink = overlay.querySelector('.mini-playground-link');
    if (playgroundLink) {
      playgroundLink.addEventListener('click', (e) => {
        // Get current editor values
        const currentInput = inputEditor ? inputEditor.getValue() : '{}';
        const currentMapping = mappingEditor ? mappingEditor.getValue() : '';
        // Build URL with encoded parameters
        const url = buildPlaygroundUrl(currentInput, currentMapping, '{}');
        playgroundLink.href = url;
      });
    }
  }

  /**
   * Initialize Bloblang interactive features
   */
  function initializeBloblang() {
    // Find all Bloblang code blocks
    const bloblangBlocks = document.querySelectorAll(
      'pre > code.language-bloblang, pre > code.language-blobl'
    );

    bloblangBlocks.forEach(codeBlock => {
      const listingBlock = codeBlock.closest('.listingblock');
      if (!listingBlock) return;

      // Add documentation tooltips
      addDocumentationTooltips(codeBlock);

      // Add Try It button
      const code = codeBlock.textContent;
      addTryItButton(listingBlock, code);
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeBloblang);
  } else {
    initializeBloblang();
  }

  // Also initialize after Prism highlighting completes
  if (window.Prism && Prism.hooks) {
    Prism.hooks.add('complete', (env) => {
      if (env.language === 'bloblang' || env.language === 'blobl') {
        setTimeout(() => {
          const codeBlock = env.element;
          const listingBlock = codeBlock.closest('.listingblock');
          if (listingBlock) {
            addDocumentationTooltips(codeBlock);
            const code = codeBlock.textContent;
            addTryItButton(listingBlock, code);
          }
        }, 100);
      }
    });
  }
})();

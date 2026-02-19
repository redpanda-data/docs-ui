# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the UI bundle project for the Redpanda documentation site. It produces a UI bundle intended for use with Antora, containing HTML templates (Handlebars), CSS, JavaScript, fonts, and site-wide images. The project uses Gulp as its build system.

## Key Commands

### Development
- `gulp preview` - Build UI and start local preview server at http://localhost:5252 with live reload
- `gulp build` - Build and stage UI assets (without bundling)
- `gulp bundle` - Full production build: clean, lint, build WASM, bundle React, compile widgets, and create bundle
- `npm install` - Install dependencies (required after cloning)

### Linting & Formatting
- `gulp lint` - Run CSS and JavaScript linting
- `gulp lint:css` - Lint CSS files only
- `gulp lint:js` - Lint JavaScript files only
- `gulp format` - Format JavaScript using prettier-eslint

### Building Components
- `gulp build:wasm` - Build WebAssembly files from Go source (blobl-editor and console-config-migrator)
- `gulp bundle:react` - Bundle React components using esbuild
- `node compile-partial.js <name> <context>` - Compile specific Handlebars partials (header, footer, head-bump)

### Testing
- `gulp test:build` - Build WASM and run Bloblang playground tests
- `gulp test:quick` - Run tests with existing WASM (skip rebuild)
- `npm run test:playground` - Alias for test:build

## Architecture

### Build System
The project uses Gulp 4 with task definitions in `gulpfile.js` and task implementations in `gulp.d/tasks/`. The build pipeline:
1. Clean build directories
2. Lint CSS/JS
3. Build WebAssembly modules
4. Bundle React components with esbuild
5. Compile standalone widget partials (header, footer)
6. Build main UI assets
7. Package into distributable bundle

### Source Structure (`src/`)
- `layouts/` - Top-level Handlebars templates (default.hbs, 404.hbs, search.hbs, etc.)
- `partials/` - Reusable Handlebars template fragments included by layouts
- `helpers/` - Handlebars helper functions (each .js file exports a single helper)
- `css/` - Stylesheets with vendor subdirectories
- `js/` - JavaScript files numbered by load order (01-nav.js, 02-on-this-page.js, etc.)
- `js/react/` - React components bundled separately with esbuild
- `static/` - Files copied directly to bundle (WASM files, compiled widgets)
- `font/` - Web fonts
- `img/` - Images and icons
- `ui.yml` - Defines which static files to include in bundle

### WebAssembly Integration
Two WASM modules built from Go:
1. **Bloblang Playground** (`blobl-editor/wasm/`) - Executes Bloblang mappings in-browser, used by bloblang-playground.hbs partial
2. **Console Config Migrator** (`console-config-migrator/`) - Migrates Redpanda Console configs from v2 to v3

Both compile to `src/static/*.wasm` and are automatically built during bundle process.

### React Components
React components in `src/js/react/` are bundled individually using esbuild into IIFE format at `src/static/js/*.bundle.js`. Currently includes:
- `AskAI.jsx` - AI chat interface
- `components/ChatInterface.jsx` - Chat UI component

### Standalone Widgets
The `compile-partial.js` script compiles specific Handlebars partials into standalone HTML widgets with inlined CSS/JS. These can be embedded in external sites:
- Header widget (header.hbs)
- Footer widget (footer.hbs + 05-mobile-navbar.js)
- Head bump widget (head-bump.hbs)

Context is provided via JSON files in `context/` directory.

### Handlebars Templates
Layouts select partials to compose pages. Helpers in `src/helpers/` provide template logic (e.g., `is-beta-feature.js`, `is-enterprise.js`, `get-page-info.js`). Pages specify layout via `page-layout` AsciiDoc attribute.

### Preview System
`preview-src/` contains AsciiDoc sample pages for testing UI locally. UI model is defined in `preview-src/ui-model.yml`. Preview pages are built with Asciidoctor and rendered using the UI templates.

## Important Files
- `gulpfile.js` - Main build configuration defining all tasks
- `compile-partial.js` - Standalone widget compiler with Handlebars helpers
- `gulp.d/tasks/build.js` - Core UI asset build logic
- `gulp.d/tasks/bundle-react.js` - React bundling with esbuild
- `src/ui.yml` - Static files manifest
- `blobl-editor/wasm/go.mod` - Go dependencies for Bloblang WASM
- `console-config-migrator/go.mod` - Go dependencies for config migrator WASM

## Prerequisites
- Node.js 18+
- Gulp CLI (install globally: `npm install -g gulp-cli`)
- Go 1.22.3+ (for building WASM modules)

## Making Changes
1. **CSS changes**: Edit files in `src/css/`, changes auto-reload in preview
2. **JS changes**: Edit numbered files in `src/js/`, changes auto-reload in preview
3. **Template changes**: Edit `.hbs` files in `src/layouts/` or `src/partials/`
4. **React components**: Edit in `src/js/react/`, run `gulp bundle:react` to rebuild
5. **WASM modules**: Edit Go source in `blobl-editor/wasm/` or `console-config-migrator/`, run `gulp build:wasm`
6. **Helper functions**: Add/modify files in `src/helpers/`, each exports a single Handlebars helper

Always run `gulp lint` before committing. Fix any linting errors - the bundle task will fail if lint errors exist.

## Release Process
Releases are automated via GitHub Actions. Push a new tag to trigger:
1. Bundle creation
2. Release publication
3. Bundle upload to GitHub releases

The bundle URL pattern: `https://github.com/redpanda-data/docs-ui/releases/latest/download/ui-bundle.zip`

## Bloblang Playground Features

The Bloblang Playground allows users to interactively execute Bloblang mappings. There are two implementations:

### Full Playground (`src/partials/bloblang-playground.hbs`)
- Standalone page at `/playground.html`
- Three Ace editors: Input (JSON), Mapping (Bloblang), Output (read-only)
- CSS in `src/css/bloblang-playground.css`

### Mini Playground (`src/js/16-bloblang-interactive.js`)
- Inline modal triggered by "Try It" buttons on code blocks
- Dynamically created overlay with three Ace editors
- CSS in `src/css/bloblang-interactive.css`

### Key Technical Details

**Ace Editor Configuration:**
- `wrap: true` - Enables word wrapping to prevent horizontal text cutoff
- `minLines: 5` - Minimum editor height
- Do NOT use `maxLines` with CSS `max-height` - they conflict and cause invisible scrollbars
- CSS `max-height: 400px` on `.editor` controls height with proper scrolling
- Parent containers must NOT have `overflow: hidden` or scrollbars get clipped

**Scrollbar Visibility:**
macOS overlay scrollbars can be invisible. The CSS explicitly styles `.ace_scrollbar-v` and `.ace_scrollbar-h` with `width: 12px` for visibility.

**Testing Changes:**
1. Always test with large data (50+ items in Input, long mappings with many lines)
2. Verify scrollbars appear and function in all three editors
3. Run `gulp test:quick` to ensure all 19 tests pass
4. Test both full playground (`/playground.html`) and mini playground ("Try It" buttons on `/bloblang-syntax-test.html`)

### Important Files
- `src/partials/bloblang-playground.hbs` - Full playground template and JS initialization
- `src/css/bloblang-playground.css` - Full playground styles
- `src/js/16-bloblang-interactive.js` - Mini playground modal logic
- `src/css/bloblang-interactive.css` - Mini playground styles
- `blobl-editor/wasm/` - Go source for WASM module
- `preview-src/pages/bloblang-syntax-test.adoc` - Test page with code blocks

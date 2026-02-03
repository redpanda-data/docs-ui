# Bloblang Interactive Features Test Suite

Automated tests for Bloblang interactive features including mini-playground, YAML detection, and comment parsing.

## What is Tested

### High Priority Tests

1. **# In: Comment Parsing**
   - ✅ Extract input data from `# In:` comments
   - ✅ Extract metadata from `# Meta:` comments
   - ✅ Respect `# Skip:` directive to disable Try It button
   - ✅ No Try It button without `# In:` comment

2. **Mini-Playground Functionality**
   - ✅ Try It button appears on eligible Bloblang blocks
   - ✅ Modal opens when Try It clicked
   - ✅ Modal closes via close button
   - ✅ Modal closes via overlay click
   - ✅ Modal closes via Escape key
   - ✅ WASM loads successfully (with fallback)

3. **Bloblang-in-YAML Detection**
   - ✅ Detect and highlight Bloblang in Connect pipeline configs
   - ✅ Detect `mapping:`, `check:`, `request_map:`, etc.
   - ✅ Do NOT process regular YAML (Kubernetes, etc.)

4. **Copy Safety (Critical)**
   - ✅ Bloblang code copies cleanly without HTML spans
   - ✅ YAML with embedded Bloblang copies correctly
   - ✅ Comments (`# In:`, `# Meta:`) preserved in copy
   - ✅ No class names or HTML artifacts in copied text

## Running Tests

### Run Interactive Feature Tests Only
```bash
npm run test:interactive
```

### Run All Tests (Playground + Interactive)
```bash
npm run test:all
```

### Run with WASM Rebuild
```bash
npm run build:wasm && npm run test:interactive
```

## CI/CD Integration

Tests run automatically via GitHub Actions alongside playground tests:

**Workflow:** `.github/workflows/test-bloblang-playground.yml`

**Triggers:**
- Push to `main` branch
- Pull requests targeting `main`
- Changes to:
  - `src/js/16-bloblang-interactive.js`
  - `src/js/17-bloblang-yaml.js`
  - `src/css/bloblang-interactive.css`
  - `src/static/bloblang-docs.json`
  - WASM files or test files

**What it does:**
1. Builds WASM module
2. Runs playground tests (19 tests)
3. Runs interactive feature tests (13 tests)
4. Uploads both test results as artifacts

**Manual trigger:** You can also run tests manually via GitHub Actions UI

**Local equivalent:**
```bash
npm run test:all  # Runs both test suites
```

## Test Results

Test results are saved to: `test-results-interactive.json`

Example output:
```json
{
  "timestamp": "2025-08-20T10:12:02.326Z",
  "summary": {
    "total": 13,
    "passed": 13,
    "failed": 0,
    "successRate": "100.0"
  },
  "tests": [...],
  "pageErrors": [],
  "consoleErrors": []
}
```

## Test Fixtures

The test HTML page includes mock Bloblang code blocks:

- **fixture-basic**: Basic block with `# In:` comment
- **fixture-skip**: Block with `# Skip: true` directive
- **fixture-metadata**: Block with both `# In:` and `# Meta:` comments
- **fixture-multiline**: Block with multi-line input JSON
- **fixture-no-input**: Block without `# In:` (no Try It button)
- **fixture-yaml**: Connect YAML with embedded Bloblang
- **fixture-yaml-k8s**: Regular Kubernetes YAML (should not be processed)

## Manual Testing

Some features require manual testing:

### Accessibility
- Tab navigation with keyboard
- Focus indicators visible (`:focus-visible`)
- Reduced motion respected (`prefers-reduced-motion: reduce`)

### Hover Documentation
- Tooltips appear on hover over functions/methods
- Correct documentation fetched
- Keyboard navigation (Enter/Space to show, Escape to hide)

### WASM Fallback
- Test on servers without `application/wasm` MIME type
- Verify fallback to non-streaming `WebAssembly.instantiate()`

## Dependencies

Tests use Puppeteer for headless browser automation:
- `puppeteer` - Browser automation
- `express` - Local test server

## Architecture

```
tests/bloblang-interactive/
├── README.md                      # This file
├── mini-playground-test.html      # Test page with fixtures
└── test-runner.js                 # Puppeteer test runner
```

The test page:
1. Loads all required CSS/JS dependencies
2. Creates mock Bloblang code blocks (fixtures)
3. Loads interactive features (16-bloblang-interactive.js, 17-bloblang-yaml.js)
4. Runs tests and exposes results to Puppeteer
5. Puppeteer collects results and generates report

## Adding New Tests

To add a new test, edit `mini-playground-test.html`:

```javascript
runner.test(
    'Test Title',
    'Test description',
    async () => {
        // Your test code here
        // Throw Error() on failure
        return 'Success message';
    }
);
```

Tests run in sequence after page load.

## Troubleshooting

### Tests timeout
- Check if WASM file exists: `src/static/blobl.wasm`
- Rebuild WASM: `npm run build:wasm`
- Check browser console in test output

### Tests fail to load page
- Ensure port 5252 is available (or runner will pick random port)
- Check for conflicting processes

### Specific test fails
- Run tests in headed mode (set `headless: false` in test-runner.js)
- Check browser console output
- Verify fixture HTML matches expected structure

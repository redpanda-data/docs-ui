const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Test runner for JSON-fetch negative caching
 *
 * Verifies that:
 * - HTTP 404 and 410 responses for Connect JSON and properties JSON are
 *   negative-cached in localStorage, so they are not re-requested on every
 *   page view
 * - Transient failures (429, 5xx, network errors, JSON parse errors) are NOT
 *   cached and are retried on the next page view
 * - Markers expire after their TTL and successful fetches clear them
 * - Preview mode (localhost) never writes markers and always retries
 *
 * The negative cache is disabled in preview mode (localhost / 127.0.0.1 /
 * docs-ui.netlify.app), so most tests use Puppeteer request interception to
 * serve the page from a fake production hostname without touching the
 * network; the preview-mode scenario serves the same page from localhost.
 */

const PROD_HOST = 'http://docs.example.test';
const PREVIEW_HOST = 'http://localhost';
const CONNECT_PATH = '/redpanda-connect/components/_attachments/connect-9.9.9.json';
const PROPERTIES_PATH = '/current/reference/properties/_attachments/redpanda-properties-v9.9.9.json';
// In preview mode the Connect fetch ignores the meta tag and uses the static
// UI path instead
const CONNECT_PREVIEW_PATH = '/_/connect.json';

const BLOBLANG_JS = fs.readFileSync(path.resolve(__dirname, '../../src/js/16-bloblang-interactive.js'), 'utf8');
const PROPERTY_JS = fs.readFileSync(path.resolve(__dirname, '../../src/js/19-property-tooltips.js'), 'utf8');

const CONNECT_JSON_BODY = JSON.stringify({
    'bloblang-functions': [],
    'bloblang-methods': []
});

const PROPERTIES_JSON_BODY = JSON.stringify({
    properties: {
        log_retention_ms: {
            name: 'log_retention_ms',
            type: 'integer',
            description: 'Test property'
        }
    }
});

const TEST_PAGE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="connect-json-url" content="${CONNECT_PATH}">
  <meta name="properties-json-url" content="${PROPERTIES_PATH}">
  <meta name="latest-redpanda-tag" content="v9.9.9">
  <script>
    window.__tippyCalls = [];
    window.tippy = function (el) {
      window.__tippyCalls.push(el && el.textContent ? el.textContent.slice(0, 30) : String(el));
      return {};
    };
    // Track lookups of the tooltip container: processCodeElements queries
    // 'article.doc' only after passing its empty-properties check
    window.__qsArticle = 0;
    var origQS = Document.prototype.querySelector;
    Document.prototype.querySelector = function (sel) {
      if (sel === 'article.doc') window.__qsArticle++;
      return origQS.apply(this, arguments);
    };
    // Test probes: record unhandled rejections and idle-callback activity
    window.__rejections = [];
    window.addEventListener('unhandledrejection', function (e) {
      window.__rejections.push(String((e.reason && e.reason.stack) || e.reason));
    });
    window.__ricScheduled = 0;
    window.__ricFired = 0;
    if (window.requestIdleCallback) {
      var origRIC = window.requestIdleCallback.bind(window);
      window.requestIdleCallback = function (cb, opts) {
        window.__ricScheduled++;
        return origRIC(function (deadline) {
          window.__ricFired++;
          return cb(deadline);
        }, opts);
      };
    }
  </script>
</head>
<body>
  <article class="doc">
    <div class="listingblock"><pre><code class="language-bloblang">root = this</code></pre></div>
    <p><code>log_retention_ms</code></p>
  </article>
  <script src="/js/16-bloblang-interactive.js"></script>
  <script src="/js/19-property-tooltips.js"></script>
</body>
</html>`;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
    let browser = null;
    const results = [];
    let failures = 0;

    function assert(name, condition, detail) {
        const passed = !!condition;
        if (!passed) failures++;
        results.push({ name, passed, detail: detail || '' });
        console.log(`   ${passed ? '✅ PASS' : '❌ FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
    }

    try {
        console.log('🚀 Launching browser...');
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-extensions'
            ],
            timeout: 30000
        });

        const page = await browser.newPage();

        // Surface page-side failures in the runner output for debugging
        page.on('pageerror', (err) => console.log(`   ⚠️ pageerror: ${err.message}`));
        page.on('console', (msg) => {
            if (msg.type() === 'error' || msg.type() === 'warning') {
                console.log(`   ⚠️ console.${msg.type()}: ${msg.text().slice(0, 200)}`);
            }
        });

        // Per-scenario response behavior: an HTTP status number, 'abort'
        // (network error), or 'badjson' (200 with a non-JSON body)
        const state = {
            connect: 404,
            properties: 404,
            connectRequests: 0,
            propertiesRequests: 0
        };

        function respondJson(req, behavior, successBody) {
            if (behavior === 'abort') return req.abort('failed');
            if (behavior === 'badjson') {
                return req.respond({ status: 200, contentType: 'application/json', body: 'this is not json' });
            }
            if (behavior === 200) {
                return req.respond({ status: 200, contentType: 'application/json', body: successBody });
            }
            return req.respond({ status: behavior, contentType: 'text/plain', body: 'error' });
        }

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            let url;
            try {
                url = new URL(req.url());
            } catch (e) {
                return req.respond({ status: 404, contentType: 'text/plain', body: 'bad url' });
            }

            if (url.origin === PROD_HOST || url.origin === PREVIEW_HOST) {
                if (url.pathname === '/test.html') {
                    return req.respond({ status: 200, contentType: 'text/html', body: TEST_PAGE });
                }
                if (url.pathname === '/js/16-bloblang-interactive.js') {
                    return req.respond({ status: 200, contentType: 'application/javascript', body: BLOBLANG_JS });
                }
                if (url.pathname === '/js/19-property-tooltips.js') {
                    return req.respond({ status: 200, contentType: 'application/javascript', body: PROPERTY_JS });
                }
                if (url.pathname === CONNECT_PATH || url.pathname === CONNECT_PREVIEW_PATH) {
                    state.connectRequests++;
                    return respondJson(req, state.connect, CONNECT_JSON_BODY);
                }
                if (url.pathname === PROPERTIES_PATH) {
                    state.propertiesRequests++;
                    return respondJson(req, state.properties, PROPERTIES_JSON_BODY);
                }
            }

            // Anything else (bloblang-docs.json fallback, favicon, ...) is a 404
            return req.respond({ status: 404, contentType: 'text/plain', body: 'not found' });
        });

        // Loads the test page from the given origin and returns how many
        // requests hit each JSON URL during that page view
        async function loadPage(origin = PROD_HOST) {
            const before = {
                connect: state.connectRequests,
                properties: state.propertiesRequests
            };
            await page.goto(`${origin}/test.html`, { waitUntil: 'networkidle0', timeout: 30000 });
            // Property tooltips fetch via requestIdleCallback; give async work
            // time to settle beyond networkidle0
            await page.waitForNetworkIdle({ idleTime: 600, timeout: 5000 }).catch(() => {});
            await sleep(500);
            return {
                connect: state.connectRequests - before.connect,
                properties: state.propertiesRequests - before.properties
            };
        }

        function readStorage(key) {
            return page.evaluate((k) => localStorage.getItem(k), key);
        }

        async function readMissingMarkers() {
            return JSON.parse(await readStorage('redpanda-properties-missing') || '{}');
        }

        async function readConnectFailures() {
            return JSON.parse(await readStorage('connect-json-fetch-failures') || '{}');
        }

        // Rewrites all stored marker timestamps to two hours ago
        function expireMarkers() {
            return page.evaluate(() => {
                const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
                const failures = JSON.parse(localStorage.getItem('connect-json-fetch-failures') || '{}');
                Object.keys(failures).forEach((url) => { failures[url] = twoHoursAgo; });
                localStorage.setItem('connect-json-fetch-failures', JSON.stringify(failures));
                const missing = JSON.parse(localStorage.getItem('redpanda-properties-missing') || '{}');
                Object.keys(missing).forEach((url) => { missing[url].timestamp = twoHoursAgo; });
                localStorage.setItem('redpanda-properties-missing', JSON.stringify(missing));
            });
        }

        // --- Scenario 1: 404 responses are negative-cached ---
        console.log('\n📋 Scenario 1: 404 responses are negative-cached');
        state.connect = 404;
        state.properties = 404;
        const load1 = await loadPage();
        assert('404: Connect JSON requested once on first view', load1.connect === 1, `got ${load1.connect}`);
        assert('404: properties JSON requested once on first view', load1.properties === 1, `got ${load1.properties}`);
        assert('404: Connect failure marker written', CONNECT_PATH in await readConnectFailures());
        assert('404: properties missing-marker written for URL', PROPERTIES_PATH in await readMissingMarkers());

        const load2 = await loadPage();
        assert('404: Connect JSON NOT re-requested on next view', load2.connect === 0, `got ${load2.connect}`);
        assert('404: properties JSON NOT re-requested on next view', load2.properties === 0, `got ${load2.properties}`);

        // --- Scenario 2: markers expire after their TTL ---
        console.log('\n📋 Scenario 2: markers expire after their TTL');
        await expireMarkers();
        const load3 = await loadPage();
        assert('Expiry: Connect JSON re-requested after TTL', load3.connect === 1, `got ${load3.connect}`);
        assert('Expiry: properties JSON re-requested after TTL', load3.properties === 1, `got ${load3.properties}`);

        // --- Scenario 3: 410 responses are negative-cached ---
        console.log('\n📋 Scenario 3: 410 responses are negative-cached');
        await page.evaluate(() => localStorage.clear());
        state.connect = 410;
        state.properties = 410;
        const load410a = await loadPage();
        assert('410: Connect JSON requested once on first view', load410a.connect === 1, `got ${load410a.connect}`);
        assert('410: properties JSON requested once on first view', load410a.properties === 1, `got ${load410a.properties}`);
        const load410b = await loadPage();
        assert('410: Connect JSON NOT re-requested on next view', load410b.connect === 0, `got ${load410b.connect}`);
        assert('410: properties JSON NOT re-requested on next view', load410b.properties === 0, `got ${load410b.properties}`);

        // --- Scenario 4: transient failures (503, 429) are retried ---
        console.log('\n📋 Scenario 4: transient HTTP failures are retried');
        await page.evaluate(() => localStorage.clear());
        state.connect = 503;
        state.properties = 503;
        const load4 = await loadPage();
        assert('503: Connect JSON requested exactly once', load4.connect === 1, `got ${load4.connect}`);
        assert('503: properties JSON requested exactly once', load4.properties === 1, `got ${load4.properties}`);
        assert('503: no Connect failure marker written', !(CONNECT_PATH in await readConnectFailures()));
        assert('503: no properties missing-marker written', !(PROPERTIES_PATH in await readMissingMarkers()));

        state.connect = 429;
        state.properties = 429;
        const load5 = await loadPage();
        assert('429: Connect JSON retried on next view', load5.connect === 1, `got ${load5.connect}`);
        assert('429: properties JSON retried on next view', load5.properties === 1, `got ${load5.properties}`);
        assert('429: no Connect failure marker written', !(CONNECT_PATH in await readConnectFailures()));
        assert('429: no properties missing-marker written', !(PROPERTIES_PATH in await readMissingMarkers()));

        // --- Scenario 5: network errors are retried ---
        console.log('\n📋 Scenario 5: network errors are retried');
        state.connect = 'abort';
        state.properties = 'abort';
        const load6 = await loadPage();
        assert('Network error: Connect JSON requested', load6.connect === 1, `got ${load6.connect}`);
        assert('Network error: properties JSON requested', load6.properties === 1, `got ${load6.properties}`);
        const load7 = await loadPage();
        assert('Network error: Connect JSON retried on next view', load7.connect === 1, `got ${load7.connect}`);
        assert('Network error: properties JSON retried on next view', load7.properties === 1, `got ${load7.properties}`);
        assert('Network error: no Connect failure marker written', !(CONNECT_PATH in await readConnectFailures()));
        assert('Network error: no properties missing-marker written', !(PROPERTIES_PATH in await readMissingMarkers()));

        // --- Scenario 6: JSON parse errors are retried ---
        console.log('\n📋 Scenario 6: JSON parse errors are retried');
        state.connect = 'badjson';
        state.properties = 'badjson';
        const load8 = await loadPage();
        assert('Parse error: Connect JSON requested', load8.connect === 1, `got ${load8.connect}`);
        assert('Parse error: properties JSON requested', load8.properties === 1, `got ${load8.properties}`);
        const load9 = await loadPage();
        assert('Parse error: Connect JSON retried on next view', load9.connect === 1, `got ${load9.connect}`);
        assert('Parse error: properties JSON retried on next view', load9.properties === 1, `got ${load9.properties}`);
        assert('Parse error: no Connect failure marker written', !(CONNECT_PATH in await readConnectFailures()));
        assert('Parse error: no properties missing-marker written', !(PROPERTIES_PATH in await readMissingMarkers()));

        // --- Scenario 7: success clears markers and populates the cache ---
        console.log('\n📋 Scenario 7: success clears markers and populates the cache');
        await page.evaluate(() => localStorage.clear());
        state.connect = 404;
        state.properties = 404;
        await loadPage(); // writes fresh markers
        state.connect = 200;
        state.properties = 200;
        const load10 = await loadPage();
        assert('Fresh markers still suppress fetches', load10.connect === 0 && load10.properties === 0,
            `connect ${load10.connect}, properties ${load10.properties}`);

        await expireMarkers();
        const load11 = await loadPage();
        assert('Success: Connect JSON fetched', load11.connect === 1, `got ${load11.connect}`);
        assert('Success: properties JSON fetched', load11.properties === 1, `got ${load11.properties}`);
        assert('Success: properties missing-marker cleared', !(PROPERTIES_PATH in await readMissingMarkers()));
        assert('Success: properties data cached', !!(await readStorage('redpanda-properties-cache')));
        // Interval polling, not the default requestAnimationFrame polling:
        // RAF can stall in headless Chrome on busy CI runners even though
        // the element is present
        const tooltipAttached = await page.waitForFunction(
            () => !!document.querySelector('code.has-property-tooltip'),
            { polling: 100, timeout: 10000 }
        ).then(() => true).catch(() => false);
        if (!tooltipAttached) {
            const diag = await page.evaluate(() => ({
                hasArticle: !!document.querySelector('article.doc'),
                codeEls: Array.from(document.querySelectorAll('code')).map((el) => ({
                    text: el.textContent.slice(0, 40),
                    cls: el.className
                })),
                cachedData: (localStorage.getItem('redpanda-properties-cache') || 'null').slice(0, 300),
                tippyType: typeof window.tippy,
                ricScheduled: window.__ricScheduled,
                ricFired: window.__ricFired,
                rejections: window.__rejections,
                qsArticle: window.__qsArticle,
                tippyCalls: window.__tippyCalls,
                // Which requests THIS page actually issued
                resources: performance.getEntriesByType('resource').map((r) => r.name)
            })).catch((e) => ({ evalError: String(e) }));
            console.log('   🔍 DIAG:', JSON.stringify(diag));
        }
        assert('Success: property tooltip attached to matching code element', tooltipAttached);

        const load12 = await loadPage();
        assert('Success: properties served from cache on next view', load12.properties === 0, `got ${load12.properties}`);

        // --- Scenario 8: preview mode (localhost) never negative-caches ---
        console.log('\n📋 Scenario 8: preview mode (localhost) never negative-caches');
        state.connect = 404;
        state.properties = 404;
        const load13 = await loadPage(PREVIEW_HOST);
        assert('Preview: Connect JSON requested', load13.connect === 1, `got ${load13.connect}`);
        assert('Preview: properties JSON requested', load13.properties === 1, `got ${load13.properties}`);
        const load14 = await loadPage(PREVIEW_HOST);
        assert('Preview: Connect JSON re-requested on next view', load14.connect === 1, `got ${load14.connect}`);
        assert('Preview: properties JSON re-requested on next view', load14.properties === 1, `got ${load14.properties}`);
        assert('Preview: no Connect failure marker written', Object.keys(await readConnectFailures()).length === 0);
        assert('Preview: no properties missing-marker written', Object.keys(await readMissingMarkers()).length === 0);

        // --- Summary ---
        const total = results.length;
        const passed = total - failures;
        console.log(`\n📊 Results: ${passed}/${total} passed`);

        fs.writeFileSync(
            path.resolve(__dirname, '../../test-results-negative-cache.json'),
            JSON.stringify({ total, passed, failed: failures, results }, null, 2)
        );

        if (failures > 0) {
            process.exitCode = 1;
        }
    } catch (error) {
        console.error('💥 Test runner error:', error);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
    }
}

runTests();

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Test runner for JSON-fetch negative caching
 *
 * Verifies that:
 * - 404/410 responses for Connect JSON and properties JSON are negative-cached
 *   in localStorage, so they are not re-requested on every page view
 * - Transient failures (429, 5xx) are NOT cached and are retried on the next
 *   page view
 * - Markers expire after their TTL and successful fetches clear them
 *
 * The negative cache is disabled in preview mode (localhost /
 * docs-ui.netlify.app), so these tests use Puppeteer request interception to
 * serve the page from a fake production hostname without touching the network.
 */

const HOST = 'http://docs.example.test';
const CONNECT_PATH = '/redpanda-connect/components/_attachments/connect-9.9.9.json';
const PROPERTIES_PATH = '/current/reference/properties/_attachments/redpanda-properties-v9.9.9.json';

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
  <script>window.tippy = function () { return {}; };</script>
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

        // Mutable per-scenario response statuses and request counters
        const state = {
            connectStatus: 404,
            propertiesStatus: 404,
            connectRequests: 0,
            propertiesRequests: 0
        };

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            let url;
            try {
                url = new URL(req.url());
            } catch (e) {
                return req.respond({ status: 404, contentType: 'text/plain', body: 'bad url' });
            }

            // Connect version lookup (external) - always succeeds
            if (url.hostname === 'raw.githubusercontent.com') {
                return req.respond({
                    status: 200,
                    contentType: 'text/yaml',
                    body: "latest-connect-version: '9.9.9'\n"
                });
            }

            if (url.origin === HOST) {
                if (url.pathname === '/test.html') {
                    return req.respond({ status: 200, contentType: 'text/html', body: TEST_PAGE });
                }
                if (url.pathname === '/js/16-bloblang-interactive.js') {
                    return req.respond({ status: 200, contentType: 'application/javascript', body: BLOBLANG_JS });
                }
                if (url.pathname === '/js/19-property-tooltips.js') {
                    return req.respond({ status: 200, contentType: 'application/javascript', body: PROPERTY_JS });
                }
                if (url.pathname === CONNECT_PATH) {
                    state.connectRequests++;
                    if (state.connectStatus === 200) {
                        return req.respond({ status: 200, contentType: 'application/json', body: CONNECT_JSON_BODY });
                    }
                    return req.respond({ status: state.connectStatus, contentType: 'text/plain', body: 'error' });
                }
                if (url.pathname === PROPERTIES_PATH) {
                    state.propertiesRequests++;
                    if (state.propertiesStatus === 200) {
                        return req.respond({ status: 200, contentType: 'application/json', body: PROPERTIES_JSON_BODY });
                    }
                    return req.respond({ status: state.propertiesStatus, contentType: 'text/plain', body: 'error' });
                }
            }

            // Anything else (bloblang-docs.json fallback, favicon, ...) is a 404
            return req.respond({ status: 404, contentType: 'text/plain', body: 'not found' });
        });

        // Loads the test page and returns how many requests hit each JSON URL
        // during that page view
        async function loadPage() {
            const before = {
                connect: state.connectRequests,
                properties: state.propertiesRequests
            };
            await page.goto(`${HOST}/test.html`, { waitUntil: 'networkidle0', timeout: 30000 });
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

        // --- Scenario 1: 404 responses are negative-cached ---
        console.log('\n📋 Scenario 1: 404 responses are negative-cached');
        state.connectStatus = 404;
        state.propertiesStatus = 404;
        const load1 = await loadPage();
        assert('404: Connect JSON requested once on first view', load1.connect === 1, `got ${load1.connect}`);
        assert('404: properties JSON requested once on first view', load1.properties === 1, `got ${load1.properties}`);
        const connectFailures = JSON.parse(await readStorage('connect-json-fetch-failures') || '{}');
        assert('404: Connect failure marker written', CONNECT_PATH in connectFailures);
        assert('404: properties missing-marker written', !!(await readStorage('redpanda-properties-missing')));

        const load2 = await loadPage();
        assert('404: Connect JSON NOT re-requested on next view', load2.connect === 0, `got ${load2.connect}`);
        assert('404: properties JSON NOT re-requested on next view', load2.properties === 0, `got ${load2.properties}`);

        // --- Scenario 2: markers expire after their TTL ---
        console.log('\n📋 Scenario 2: markers expire after their TTL');
        await page.evaluate((connectPath) => {
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
            const failures = JSON.parse(localStorage.getItem('connect-json-fetch-failures') || '{}');
            if (failures[connectPath]) failures[connectPath] = twoHoursAgo;
            localStorage.setItem('connect-json-fetch-failures', JSON.stringify(failures));
            const missing = JSON.parse(localStorage.getItem('redpanda-properties-missing') || 'null');
            if (missing) {
                missing.timestamp = twoHoursAgo;
                localStorage.setItem('redpanda-properties-missing', JSON.stringify(missing));
            }
        }, CONNECT_PATH);
        const load3 = await loadPage();
        assert('Expiry: Connect JSON re-requested after TTL', load3.connect === 1, `got ${load3.connect}`);
        assert('Expiry: properties JSON re-requested after TTL', load3.properties === 1, `got ${load3.properties}`);

        // --- Scenario 3: transient failures (503, 429) are retried ---
        console.log('\n📋 Scenario 3: transient failures are retried');
        await page.evaluate(() => localStorage.clear());
        state.connectStatus = 503;
        state.propertiesStatus = 503;
        const load4 = await loadPage();
        assert('503: Connect JSON requested', load4.connect >= 1, `got ${load4.connect}`);
        assert('503: properties JSON requested', load4.properties >= 1, `got ${load4.properties}`);
        const failuresAfter503 = JSON.parse(await readStorage('connect-json-fetch-failures') || '{}');
        assert('503: no Connect failure marker written', !(CONNECT_PATH in failuresAfter503));
        assert('503: no properties missing-marker written', !(await readStorage('redpanda-properties-missing')));

        state.connectStatus = 429;
        state.propertiesStatus = 429;
        const load5 = await loadPage();
        assert('429: Connect JSON retried on next view', load5.connect >= 1, `got ${load5.connect}`);
        assert('429: properties JSON retried on next view', load5.properties >= 1, `got ${load5.properties}`);
        const failuresAfter429 = JSON.parse(await readStorage('connect-json-fetch-failures') || '{}');
        assert('429: no Connect failure marker written', !(CONNECT_PATH in failuresAfter429));
        assert('429: no properties missing-marker written', !(await readStorage('redpanda-properties-missing')));

        // --- Scenario 4: success clears markers and populates the cache ---
        console.log('\n📋 Scenario 4: success clears markers and populates the cache');
        await page.evaluate(() => localStorage.clear());
        state.connectStatus = 404;
        state.propertiesStatus = 404;
        await loadPage(); // writes fresh markers
        state.connectStatus = 200;
        state.propertiesStatus = 200;
        const load6 = await loadPage();
        assert('Fresh markers still suppress fetches', load6.connect === 0 && load6.properties === 0,
            `connect ${load6.connect}, properties ${load6.properties}`);

        // Expire the markers so the next view retries and succeeds
        await page.evaluate((connectPath) => {
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
            const failures = JSON.parse(localStorage.getItem('connect-json-fetch-failures') || '{}');
            if (failures[connectPath]) failures[connectPath] = twoHoursAgo;
            localStorage.setItem('connect-json-fetch-failures', JSON.stringify(failures));
            const missing = JSON.parse(localStorage.getItem('redpanda-properties-missing') || 'null');
            if (missing) {
                missing.timestamp = twoHoursAgo;
                localStorage.setItem('redpanda-properties-missing', JSON.stringify(missing));
            }
        }, CONNECT_PATH);
        const load7 = await loadPage();
        assert('Success: Connect JSON fetched', load7.connect === 1, `got ${load7.connect}`);
        assert('Success: properties JSON fetched', load7.properties === 1, `got ${load7.properties}`);
        assert('Success: properties missing-marker cleared', !(await readStorage('redpanda-properties-missing')));
        assert('Success: properties data cached', !!(await readStorage('redpanda-properties-cache')));

        const load8 = await loadPage();
        assert('Success: properties served from cache on next view', load8.properties === 0, `got ${load8.properties}`);

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

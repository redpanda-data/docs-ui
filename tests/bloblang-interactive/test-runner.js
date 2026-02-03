const puppeteer = require('puppeteer');
const fs = require('fs');
const express = require('express');
const path = require('path');

/**
 * Test runner for Bloblang Interactive Features
 * Tests mini-playground, YAML detection, and # In: comment parsing
 */
async function runTests() {
    let browser = null;
    let server = null;

    try {
        // Start HTTP server
        console.log('📡 Starting test server...');
        const app = express();
        const projectRoot = path.resolve(__dirname, '../../');
        app.use(express.static(projectRoot));

        server = await new Promise((resolve, reject) => {
            const s = app.listen(0, (err) => {
                if (err) reject(err);
                else {
                    console.log(`📡 Test server running on port ${s.address().port}`);
                    resolve(s);
                }
            });
            setTimeout(() => reject(new Error('Server startup timeout')), 10000);
        });

        const port = server.address().port;

        // Launch browser
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
        await page.setViewport({ width: 1280, height: 720 });

        // Set up error handling
        let pageErrors = [];
        let consoleErrors = [];

        page.on('error', (err) => {
            pageErrors.push(`Page crash: ${err.message}`);
        });

        page.on('pageerror', (err) => {
            pageErrors.push(`Page error: ${err.message}`);
        });

        page.on('console', (msg) => {
            const text = msg.text();
            if (msg.type() === 'error') {
                consoleErrors.push(text);
            }
            // Log test output
            if (text.includes('PASS') || text.includes('FAIL')) {
                console.log(`   ${text}`);
            }
        });

        // Navigate to test page
        console.log('📄 Loading test page...');
        const testUrl = `http://localhost:${port}/tests/bloblang-interactive/mini-playground-test.html`;

        const response = await page.goto(testUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        if (!response || !response.ok()) {
            throw new Error(`Failed to load test page: HTTP ${response ? response.status() : 'unknown'}`);
        }

        console.log('✅ Page loaded successfully');

        // Wait for tests to complete
        console.log('⏳ Running tests...\n');

        await page.waitForFunction(
            () => window.testsComplete === true,
            { timeout: 60000 }
        );

        // Get test results
        const results = await page.evaluate(() => {
            return {
                summary: window.testSummary,
                tests: window.testResults,
                pageErrors: [],
                consoleErrors: []
            };
        });

        results.pageErrors = pageErrors;
        results.consoleErrors = consoleErrors;

        // Display results
        console.log('\n📊 Test Results:');
        console.log('═══════════════════════════════════════════════════════════');

        results.tests.forEach((test, idx) => {
            const icon = test.success ? '✓' : '✗';
            const status = test.success ? 'PASS' : 'FAIL';
            console.log(`\n${idx + 1}. ${icon} ${test.title} - ${status}`);
            console.log(`   ${test.description}`);
            if (!test.success) {
                console.log(`   Error: ${test.output}`);
            }
        });

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(`\n📈 Summary:`);
        console.log(`   Total:   ${results.summary.total}`);
        console.log(`   Passed:  ${results.summary.passed} ✓`);
        console.log(`   Failed:  ${results.summary.failed} ✗`);
        console.log(`   Rate:    ${results.summary.successRate}%`);

        if (pageErrors.length > 0) {
            console.log('\n⚠️  Page Errors:');
            pageErrors.forEach(err => console.log(`   - ${err}`));
        }

        if (consoleErrors.length > 0) {
            console.log('\n⚠️  Console Errors:');
            consoleErrors.forEach(err => console.log(`   - ${err}`));
        }

        // Save results to JSON
        const outputFile = path.join(projectRoot, 'test-results-interactive.json');
        results.timestamp = new Date().toISOString();
        fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
        console.log(`\n💾 Results saved to: ${outputFile}`);

        // Exit code based on test results
        const exitCode = results.summary.failed > 0 ? 1 : 0;

        await browser.close();
        server.close();

        console.log('\n' + (exitCode === 0 ? '✅ All tests passed!' : '❌ Some tests failed'));
        process.exit(exitCode);

    } catch (error) {
        console.error('\n❌ Test runner error:', error);

        if (browser) {
            await browser.close().catch(() => {});
        }
        if (server) {
            server.close();
        }

        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

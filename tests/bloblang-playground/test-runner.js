const puppeteer = require('puppeteer');
const fs = require('fs');
const express = require('express');
/**
 * Robust headless test runner for Bloblang Playground
 * Handles browser lifecycle and connection issues more gracefully
 */
async function runTests() {
    let browser = null;
    let server = null;
    try {
        // Start HTTP server first
        console.log('📡 Starting test server...');
        const app = express();
        // Determine correct static path based on working directory
        const path = require('path');
        const projectRoot = path.resolve(__dirname, '../../');
        // Always serve from project root, regardless of where we're run from
        app.use(express.static(projectRoot));
        server = await new Promise((resolve, reject) => {
            const s = app.listen(0, (err) => {
                if (err) reject(err);
                else {
                    console.log(`📡 Test server running on port ${s.address().port}`);
                    resolve(s);
                }
            });
            // Add timeout for server startup
            setTimeout(() => reject(new Error('Server startup timeout')), 10000);
        });
        const port = server.address().port;
        // Launch browser with more conservative settings
        console.log('🚀 Launching browser...');
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--disable-plugins',
                '--disable-images',
                '--js-flags="--max-old-space-size=4096"',
                '--disable-javascript-harmony-shipping',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ],
            ignoreHTTPSErrors: true,
            timeout: 30000
        });
        // Create page with error handling
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        // Set up comprehensive error handling
        let pageErrors = [];
        let consoleErrors = [];
        page.on('error', (err) => {
            pageErrors.push(`Page crash: ${err.message}`);
        });
        page.on('pageerror', (err) => {
            pageErrors.push(`Page error: ${err.message}`);
        });
        page.on('requestfailed', (request) => {
            console.warn(`❌ Request failed: ${request.url()}`);
        });
        // Navigate with retries
        console.log('📄 Loading test page...');
        const testUrl = `http://localhost:${port}/tests/bloblang-playground/bloblang-playground-test.html`;
        let navigationSuccess = false;
        let attempt = 0;
        const maxAttempts = 3;
        while (!navigationSuccess && attempt < maxAttempts) {
            attempt++;
            try {
                console.log(`   Attempt ${attempt}/${maxAttempts}...`);
                const response = await page.goto(testUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });
                if (response && response.ok()) {
                    navigationSuccess = true;
                    console.log('✅ Page loaded successfully');
                } else {
                    throw new Error(`HTTP ${response ? response.status() : 'unknown'}`);
                }
            } catch (error) {
                console.warn(`   Navigation attempt ${attempt} failed: ${error.message}`);
                if (attempt < maxAttempts) {
                    console.log('   Retrying in 2 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    throw new Error(`All navigation attempts failed. Last error: ${error.message}`);
                }
            }
        }
        // Wait for page to be ready
        console.log('⏳ Waiting for page initialization...');
        await page.waitForSelector('body', { timeout: 10000 });
        // Check for immediate errors
        if (pageErrors.length > 0) {
            console.warn('⚠️ Page errors detected:', pageErrors);
        }
        // Wait for WASM initialization with progressive timeouts
        console.log('⚙️ Waiting for WASM module...');
        console.log('   (This may take up to 2 minutes due to 60MB WASM file)');
        // Step 1: Wait for Go object
        try {
            await page.waitForFunction(() => typeof window.Go !== 'undefined', { 
                timeout: 30000 
            });
            console.log('✅ Go runtime loaded');
        } catch (error) {
            throw new Error('Go runtime failed to load: ' + error.message);
        }
        // Step 2: Wait for WASM initialization
        try {
            await page.waitForFunction(() => window.wasmInitialized === true, { 
                timeout: 90000 
            });
            console.log('✅ WASM module initialized');
        } catch (error) {
            console.warn('⚠️ WASM initialization timeout, checking for fallback...');
            // Check if tests started anyway
            const hasTestResults = await page.$('#summary');
            if (!hasTestResults) {
                // Get any error messages from the page
                const loadingElement = await page.$('#loading');
                if (loadingElement) {
                    const errorText = await page.evaluate(el => el.textContent, loadingElement);
                    console.error('Loading error:', errorText);
                }
                throw new Error('WASM failed to initialize and no tests found');
            }
            console.log('⚠️ Proceeding with fallback - tests may be running');
        }
        // Wait for test completion
        console.log('⏱️ Waiting for tests to complete...');
        try {
            await page.waitForSelector('#summary', { 
                visible: true, 
                timeout: 120000 
            });
            console.log('✅ Tests completed');
        } catch (error) {
            throw new Error('Tests did not complete within timeout: ' + error.message);
        }
        // Give tests extra time to finish
        await page.waitForTimeout(5000);
        // Extract results
        console.log('📊 Extracting test results...');
        const results = await page.evaluate(() => {
            const passedCount = parseInt(document.getElementById('passed-count')?.textContent) || 0;
            const failedCount = parseInt(document.getElementById('failed-count')?.textContent) || 0;
            const totalCount = parseInt(document.getElementById('total-count')?.textContent) || 0;
            // Get detailed test results
            const testCases = [];
            const testElements = document.querySelectorAll('.test-case');
            testElements.forEach((testElement) => {
                const titleElement = testElement.querySelector('.test-title');
                const descriptionElement = testElement.querySelector('.test-description');
                const outputElement = testElement.querySelector('.test-output');
                const isSuccess = testElement.classList.contains('test-success');
                const isError = testElement.classList.contains('test-error');
                if (titleElement) {
                    const title = titleElement.textContent.trim();
                    const description = descriptionElement ? descriptionElement.textContent.trim() : '';
                    const output = outputElement ? outputElement.textContent.trim() : '';
                    testCases.push({
                        title,
                        description,
                        status: isSuccess ? 'PASS' : (isError ? 'FAIL' : 'UNKNOWN'),
                        success: isSuccess,
                        output: output // Include the full output for debugging
                    });
                }
            });
            return {
                passed: passedCount,
                failed: failedCount,
                total: totalCount,
                testCases: testCases
            };
        });
        // Validate results
        if (results.total === 0) {
            throw new Error('No test results found - tests may not have run');
        }
        // Report results
        console.log('\n📊 TEST RESULTS:');
        console.log('================');
        console.log(`Total Tests: ${results.total}`);
        console.log(`✅ Passed: ${results.passed}`);
        console.log(`❌ Failed: ${results.failed}`);
        console.log(`📈 Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
        console.log('\n📝 DETAILED RESULTS:');
        console.log('====================');
        results.testCases.forEach((test, index) => {
            const statusIcon = test.success ? '✅' : '❌';
            console.log(`${index + 1}. ${statusIcon} ${test.title.replace(/ - (PASS|FAIL|ERROR)$/, '')}`);
            if (test.description) {
                console.log(`   📄 ${test.description}`);
            }
            // Show detailed output for failed tests
            if (!test.success && test.output) {
                console.log(`   🔍 Details: ${test.output.substring(0, 200)}${test.output.length > 200 ? '...' : ''}`);
            }
        });
        // Show any console errors
        if (consoleErrors.length > 0) {
            console.log('\n⚠️ Console Errors:');
            consoleErrors.forEach(error => console.log(`   ${error}`));
        }
        // Generate JSON report
        const jsonReport = {
            timestamp: new Date().toISOString(),
            summary: {
                total: results.total,
                passed: results.passed,
                failed: results.failed,
                successRate: ((results.passed / results.total) * 100).toFixed(1)
            },
            tests: results.testCases,
            pageErrors: pageErrors,
            consoleErrors: consoleErrors
        };
        fs.writeFileSync('test-results.json', JSON.stringify(jsonReport, null, 2));
        console.log('\n📄 JSON test report saved to test-results.json');
        // Final result
        if (results.failed > 0) {
            console.log('\n❌ Some tests failed!');
            process.exit(1);
        } else {
            console.log('\n🎉 All tests passed!');
            process.exit(0);
        }
    } catch (error) {
        console.error(`\n❌ Test execution failed: ${error.message}`);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    } finally {
        // Cleanup
        if (browser) {
            try {
                await browser.close();
                console.log('🔒 Browser closed');
            } catch (e) {
                console.warn('Warning: Failed to close browser:', e.message);
            }
        }
        if (server) {
            try {
                await new Promise((resolve) => {
                    server.close(resolve);
                });
                console.log('🔒 Server closed');
            } catch (e) {
                console.warn('Warning: Failed to close server:', e.message);
            }
        }
    }
}
// Run the tests
runTests();

'use strict';

const { defineConfig, devices } = require('@playwright/test');
const { execSync } = require('child_process');

let systemChromium;
try {
    systemChromium = execSync('which chromium', { encoding: 'utf8' }).trim();
} catch (_) {
    systemChromium = undefined;
}

module.exports = defineConfig({
    testDir: './tests/e2e',
    workers: 1,
    timeout: 40000,
    expect: {
        timeout: 5000,
    },
    webServer: {
        command: 'python3 server/app.py',
        url: 'http://localhost:5000',
        reuseExistingServer: true,
        timeout: 30000,
    },
    use: {
        baseURL: 'http://localhost:5000',
        headless: true,
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                channel: 'chromium',
                ...(systemChromium ? { executablePath: systemChromium } : {}),
            },
        },
    ],
});

'use strict';

const { defineConfig, devices } = require('@playwright/test');
const { execSync } = require('child_process');

let systemChromium;
try {
    systemChromium = execSync('which chromium', { encoding: 'utf8' }).trim();
} catch (_) {
    systemChromium = undefined;
}

// Default to a dedicated port (never 5000) so the standalone e2e-tests
// workflow can never contend for the same port as the main dev server
// ("Church Machine IDE" workflow), even when invoked without an explicit
// E2E_PORT override. server/app.py also has a bind-retry guard as a
// second line of defense against stray processes holding the port.
const E2E_PORT = process.env.E2E_PORT || '5050';
const webServerEnv = {
    E2E_PORT,
    CHURCH_TEST_ISOLATED_MODE: process.env.CHURCH_TEST_ISOLATED_MODE || '',
};
for (const key of [
    'CHURCH_TEST_LUMPS_DIR',
    'CHURCH_TEST_BOOT_CONFIG_PATH',
    'CHURCH_TEST_BUILD_SNAPSHOTS_DIR',
    'CHURCH_TEST_DB_PATH',
]) {
    if (process.env[key]) webServerEnv[key] = process.env[key];
}

module.exports = defineConfig({
    testDir: './tests/e2e',
    workers: 1,
    timeout: 40000,
    expect: {
        timeout: 5000,
    },
    webServer: {
        command: `python3 server/app.py`,
        url: `http://localhost:${E2E_PORT}`,
        // The disposable Task 3430 harness must never attach to a server that
        // was started without its isolated fixture/database overrides or
        // explicit external-integration shutdown mode.
        reuseExistingServer: !process.env.CHURCH_TEST_LUMPS_DIR &&
            !process.env.CHURCH_TEST_ISOLATED_MODE,
        timeout: 30000,
        env: webServerEnv,
    },
    use: {
        baseURL: `http://localhost:${E2E_PORT}`,
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

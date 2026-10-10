'use strict';

// No webServer: this test must never start the normal app against live data.
const { defineConfig } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const executablePath = execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();

module.exports = defineConfig({
    testDir: __dirname,
    testMatch: 'idx1_exact_saved_revision_editor.spec.js',
    workers: 1,
    timeout: 60000,
    outputDir: '../../generated-artifacts/idx1-browser-results',
    use: { headless: true, launchOptions: { executablePath } },
});

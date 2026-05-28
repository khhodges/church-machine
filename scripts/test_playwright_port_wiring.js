#!/usr/bin/env node
'use strict';
/**
 * test_playwright_port_wiring.js
 *
 * Static smoke-test: parses playwright.config.js and asserts that E2E_PORT
 * is correctly wired so that the free-port logic in run-all-tests.sh actually
 * reaches the web server.
 *
 * Checks:
 *   PW1 — webServer.url references E2E_PORT (not a literal port number)
 *   PW2 — webServer.env passes E2E_PORT to the server process
 *   PW3 — use.baseURL references E2E_PORT (not a literal port number)
 *
 * Run:  node scripts/test_playwright_port_wiring.js
 */

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'playwright.config.js');

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log(`PASS  ${label}`);
        pass++;
    } else {
        console.log(`FAIL  ${label}`);
        if (detail) console.log(`      ${detail}`);
        fail++;
    }
}

// ---------------------------------------------------------------------------
// Read source
// ---------------------------------------------------------------------------
if (!fs.existsSync(CONFIG_PATH)) {
    console.log(`FAIL  playwright.config.js not found at ${CONFIG_PATH}`);
    process.exit(1);
}

const src = fs.readFileSync(CONFIG_PATH, 'utf8');

// ---------------------------------------------------------------------------
// PW1 — webServer.url must use E2E_PORT, not a bare literal port
//
// Accepted form:  url: `http://localhost:${E2E_PORT}` (or any variant that
// embeds the variable).  A literal port like `http://localhost:5000` is the
// failure case.
// ---------------------------------------------------------------------------
{
    // Extract the webServer block by finding `webServer:` and the text up to
    // the matching closing brace.  We look for url: lines within that region.
    const wsBock = (() => {
        const start = src.indexOf('webServer:');
        if (start === -1) return '';
        // Grab enough characters to cover the entire webServer object
        return src.slice(start, start + 800);
    })();

    // Must contain E2E_PORT somewhere in the url value
    const urlLineMatch = wsBock.match(/url\s*:\s*(`[^`]*`|'[^']*'|"[^"]*")/);
    if (!urlLineMatch) {
        check('PW1: webServer.url references E2E_PORT', false,
            'Could not locate a url: field inside the webServer block');
    } else {
        const urlValue = urlLineMatch[1];
        const hasVar   = urlValue.includes('E2E_PORT');
        // Reject bare numeric ports (e.g. :5000) that are not a template expression
        const hasLiteral = /:\d{4,5}[^}]/.test(urlValue.replace(/\$\{E2E_PORT\}/g, ''));
        check('PW1: webServer.url references E2E_PORT',
            hasVar && !hasLiteral,
            hasVar
                ? (hasLiteral ? `url still contains a literal port after substituting E2E_PORT: ${urlValue}` : '')
                : `url does not reference E2E_PORT: ${urlValue}`);
    }
}

// ---------------------------------------------------------------------------
// PW2 — webServer.env must pass E2E_PORT to the spawned server process
//
// Accepted forms:
//   env: { E2E_PORT }            (shorthand property)
//   env: { E2E_PORT: E2E_PORT }  (explicit)
//   env: { ..., E2E_PORT, ... }
// ---------------------------------------------------------------------------
{
    const wsBlock = (() => {
        const start = src.indexOf('webServer:');
        if (start === -1) return '';
        return src.slice(start, start + 800);
    })();

    // Look for an env: { ... } object that contains E2E_PORT as a key
    const envMatch = wsBlock.match(/env\s*:\s*\{([^}]*)\}/);
    if (!envMatch) {
        check('PW2: webServer.env passes E2E_PORT to the server process', false,
            'Could not locate an env: { } field inside the webServer block');
    } else {
        const envBody = envMatch[1];
        // E2E_PORT appears as a property key (shorthand or explicit)
        const hasKey = /\bE2E_PORT\b/.test(envBody);
        check('PW2: webServer.env passes E2E_PORT to the server process',
            hasKey,
            hasKey ? '' : `env block does not contain E2E_PORT: { ${envBody.trim()} }`);
    }
}

// ---------------------------------------------------------------------------
// PW3 — use.baseURL must reference E2E_PORT, not a bare literal port
// ---------------------------------------------------------------------------
{
    const useBlock = (() => {
        const start = src.indexOf('use:');
        if (start === -1) return '';
        return src.slice(start, start + 400);
    })();

    const baseUrlMatch = useBlock.match(/baseURL\s*:\s*(`[^`]*`|'[^']*'|"[^"]*")/);
    if (!baseUrlMatch) {
        check('PW3: use.baseURL references E2E_PORT', false,
            'Could not locate a baseURL: field inside the use block');
    } else {
        const baseUrlValue = baseUrlMatch[1];
        const hasVar       = baseUrlValue.includes('E2E_PORT');
        const hasLiteral   = /:\d{4,5}[^}]/.test(baseUrlValue.replace(/\$\{E2E_PORT\}/g, ''));
        check('PW3: use.baseURL references E2E_PORT',
            hasVar && !hasLiteral,
            hasVar
                ? (hasLiteral ? `baseURL still contains a literal port after substituting E2E_PORT: ${baseUrlValue}` : '')
                : `baseURL does not reference E2E_PORT: ${baseUrlValue}`);
    }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log(`playwright-port-wiring tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

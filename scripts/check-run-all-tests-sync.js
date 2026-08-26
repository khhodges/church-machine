#!/usr/bin/env node
/**
 * check-run-all-tests-sync.js
 *
 * Diffs the set of test workflows in .replit against the register_suite
 * entries in scripts/run-all-tests.sh. Exits non-zero with a clear message if
 * any test workflow is missing from the script, if the script lists a suite
 * name that has no matching workflow, or if the sync configuration is invalid.
 *
 * "Test workflow" is defined as any named workflow that is NOT in the
 * INFRASTRUCTURE_WORKFLOWS exclusion set below.  Add entries to that set only
 * when you introduce a new non-test workflow (e.g. a new app server).
 *
 * Usage:
 *   node scripts/check-run-all-tests-sync.js
 *
 * Wired into:
 *   - scripts/run-all-tests.sh  (self-check before running any suite)
 *   - check-api-reference-stale workflow  (CI gate)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Infrastructure workflows that are NOT test suites.
// The list lives in scripts/test-workflow-config.json — edit that file
// (not this one) when adding a new non-test workflow.
//
// The configuration is required. A missing, malformed, or structurally
// invalid file must stop the release check rather than silently changing which
// workflows are considered tests.
// ---------------------------------------------------------------------------

const configPath = path.join(__dirname, 'test-workflow-config.json');
let parsedConfig;
if (!fs.existsSync(configPath)) {
    console.error(`SYNC CONFIG ERROR — required file not found: ${configPath}`);
    process.exit(1);
}
try {
    parsedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.error(`SYNC CONFIG ERROR — could not parse ${configPath}: ${e.message}`);
    process.exit(1);
}

if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) {
    console.error(`SYNC CONFIG ERROR — ${configPath} must contain a JSON object.`);
    process.exit(1);
}

function readStringArray(field) {
    const value = parsedConfig[field];
    if (!Array.isArray(value) || value.length === 0 ||
        value.some(name => typeof name !== 'string' || name.trim() === '')) {
        console.error(
            `SYNC CONFIG ERROR — ${configPath} must contain a non-empty "${field}" string array.`
        );
        process.exit(1);
    }
    const duplicates = [...new Set(value.filter((name, index) => value.indexOf(name) !== index))];
    if (duplicates.length > 0) {
        console.error(
            `SYNC CONFIG ERROR — "${field}" contains duplicate entries: ${duplicates.join(', ')}`
        );
        process.exit(1);
    }
    return new Set(value);
}

const INFRASTRUCTURE_WORKFLOWS = readStringArray('infrastructureWorkflows');
const SCRIPT_ONLY_SUITES = readStringArray('scriptOnlySuites');

// ---------------------------------------------------------------------------
// Parse .replit — extract names of all [[workflows.workflow]] entries
// ---------------------------------------------------------------------------
function parseAllWorkflowNames(replitPath) {
    const text  = fs.readFileSync(replitPath, 'utf8');
    const names = new Set();
    const re    = /^\[\[workflows\.workflow\]\]\s*\n(?:.*\n)*?name\s*=\s*"([^"]+)"/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        names.add(m[1]);
    }
    return names;
}

// ---------------------------------------------------------------------------
// Parse run-all-tests.sh — extract the first arg of every register_suite call.
// Supports legacy launch_suite/run_suite literals for backwards compatibility.
// ---------------------------------------------------------------------------
function parseRunAllSuites(scriptPath) {
    const text  = fs.readFileSync(scriptPath, 'utf8');
    const names = new Set();
    const re    = /^\s*(?:register_suite|launch_suite|run_suite)\s+"([^"]+)"/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        // Skip bash variable expansions like ${SUITE_NAMES[$i]}
        if (!m[1].includes('$')) {
            names.add(m[1]);
        }
    }
    return names;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const replitPath = path.join(ROOT, '.replit');
const scriptPath = path.join(ROOT, 'scripts', 'run-all-tests.sh');

if (!fs.existsSync(replitPath)) {
    console.error('ERROR: .replit not found at', replitPath);
    process.exit(1);
}
if (!fs.existsSync(scriptPath)) {
    console.error('ERROR: scripts/run-all-tests.sh not found at', scriptPath);
    process.exit(1);
}

const allWorkflowNames = parseAllWorkflowNames(replitPath);
const testWorkflowNames = new Set(
    [...allWorkflowNames].filter(n => !INFRASTRUCTURE_WORKFLOWS.has(n))
);
const suiteNames = parseRunAllSuites(scriptPath);

// Test workflows that are missing from run-all-tests.sh
const missingFromScript = [...testWorkflowNames].filter(n => !suiteNames.has(n)).sort();

// Suite names in run-all-tests.sh that have no matching workflow in .replit
// (script-only suites are intentionally exempt)
const orphanInScript = [...suiteNames]
    .filter(n => !testWorkflowNames.has(n) && !SCRIPT_ONLY_SUITES.has(n))
    .sort();

// Script-only declarations must continue to describe real direct-run suites.
// Otherwise a stale exemption can hide a removed test workflow indefinitely.
const scriptOnlyMissingFromScript = [...SCRIPT_ONLY_SUITES]
    .filter(n => !suiteNames.has(n))
    .sort();

// A script-only suite is specifically one without a dedicated workflow.  If
// one is added to .replit later, the exemption should be removed so the two
// registries cannot drift independently.
const scriptOnlyWithWorkflow = [...SCRIPT_ONLY_SUITES]
    .filter(n => allWorkflowNames.has(n))
    .sort();

let ok = true;

if (missingFromScript.length > 0) {
    ok = false;
    console.error('');
    console.error('SYNC ERROR — the following workflows exist in .replit but are');
    console.error('missing from scripts/run-all-tests.sh:');
    for (const name of missingFromScript) {
        console.error(`  • ${name}`);
    }
    console.error('');
    console.error('Add a run_suite entry for each missing workflow, then re-run.');
    console.error('If the workflow is infrastructure (not a test), add it to');
    console.error('the infrastructureWorkflows array in scripts/test-workflow-config.json.');
}

if (orphanInScript.length > 0) {
    ok = false;
    console.error('');
    console.error('SYNC ERROR — the following run_suite names in run-all-tests.sh');
    console.error('have no matching workflow in .replit:');
    for (const name of orphanInScript) {
        console.error(`  • ${name}`);
    }
    console.error('');
    console.error('Either add a matching workflow to .replit or remove the stale');
    console.error('run_suite entry from scripts/run-all-tests.sh.');
}

if (scriptOnlyMissingFromScript.length > 0) {
    ok = false;
    console.error('');
    console.error('SYNC ERROR — the following script-only declarations are not');
    console.error('registered in scripts/run-all-tests.sh:');
    for (const name of scriptOnlyMissingFromScript) {
        console.error(`  • ${name}`);
    }
    console.error('');
    console.error('Add a matching run_suite entry or remove the stale');
    console.error('scriptOnlySuites declaration from scripts/test-workflow-config.json.');
}

if (scriptOnlyWithWorkflow.length > 0) {
    ok = false;
    console.error('');
    console.error('SYNC ERROR — the following script-only declarations also have');
    console.error('a dedicated workflow in .replit:');
    for (const name of scriptOnlyWithWorkflow) {
        console.error(`  • ${name}`);
    }
    console.error('');
    console.error('Remove the declaration from scriptOnlySuites; dedicated workflows');
    console.error('must be tracked as normal test workflows.');
}

if (ok) {
    const n = testWorkflowNames.size;
    console.log(`OK — all ${n} test workflow${n === 1 ? '' : 's'} are present in run-all-tests.sh.`);
    process.exit(0);
} else {
    process.exit(1);
}

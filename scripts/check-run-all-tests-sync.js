#!/usr/bin/env node
/**
 * check-run-all-tests-sync.js
 *
 * Diffs the set of test workflows in .replit against the run_suite entries in
 * scripts/run-all-tests.sh.  Exits non-zero with a clear message if any test
 * workflow is missing from the script, or if the script lists a suite name
 * that has no matching workflow.
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
// Missing-file behaviour: if test-workflow-config.json cannot be found, the
// guard falls back to the built-in DEFAULT_INFRASTRUCTURE_WORKFLOWS list below
// and prints a warning.  The check still runs rather than aborting, so CI is
// not silently broken by an accidentally deleted config file.  Restore the
// file (or add the new workflow to the default list here) to suppress the
// warning.
// ---------------------------------------------------------------------------

/** Fallback used when test-workflow-config.json is absent. */
const DEFAULT_INFRASTRUCTURE_WORKFLOWS = [
    'Project',
    'Church Machine IDE',
    'all-tests',
    'artifacts/mockup-sandbox: Component Preview Server',
];

/**
 * Suites that are registered in run-all-tests.sh but have no dedicated
 * workflow entry (they run as direct scripts).  Keep this in sync with
 * the scriptOnlySuites array in test-workflow-config.json.
 */
const DEFAULT_SCRIPT_ONLY_SUITES = [
    'sha32-vectors',
    'check-sha32-collisions',
    'compile-api-tests',
];

const configPath = path.join(__dirname, 'test-workflow-config.json');
let INFRASTRUCTURE_WORKFLOWS;
if (!fs.existsSync(configPath)) {
    console.warn('WARNING: scripts/test-workflow-config.json not found at', configPath);
    console.warn('Falling back to built-in default infrastructure-workflow list.');
    console.warn('Restore the file to suppress this warning.\n');
    INFRASTRUCTURE_WORKFLOWS = new Set(DEFAULT_INFRASTRUCTURE_WORKFLOWS);
} else {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        console.warn('WARNING: scripts/test-workflow-config.json could not be parsed:', e.message);
        console.warn('Falling back to built-in default infrastructure-workflow list.\n');
        parsed = { infrastructureWorkflows: DEFAULT_INFRASTRUCTURE_WORKFLOWS };
    }
    INFRASTRUCTURE_WORKFLOWS = new Set(parsed.infrastructureWorkflows);
}

// Script-only suites: registered in run-all-tests.sh but intentionally have
// no dedicated workflow entry (too lightweight, or workflow limit reached).
let SCRIPT_ONLY_SUITES;
if (!fs.existsSync(configPath)) {
    SCRIPT_ONLY_SUITES = new Set(DEFAULT_SCRIPT_ONLY_SUITES);
} else {
    let parsed2;
    try {
        parsed2 = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        parsed2 = { scriptOnlySuites: DEFAULT_SCRIPT_ONLY_SUITES };
    }
    SCRIPT_ONLY_SUITES = new Set(parsed2.scriptOnlySuites || DEFAULT_SCRIPT_ONLY_SUITES);
}

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

if (ok) {
    const n = testWorkflowNames.size;
    console.log(`OK — all ${n} test workflow${n === 1 ? '' : 's'} are present in run-all-tests.sh.`);
    process.exit(0);
} else {
    process.exit(1);
}

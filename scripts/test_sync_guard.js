#!/usr/bin/env node
'use strict';
/**
 * test_sync_guard.js
 *
 * Tests fail-closed behaviour when test-workflow-config.json is missing or
 * unparseable, validates script-only declarations, and confirms the happy-path
 * produces the expected OK output.
 *
 * Run:  node scripts/test_sync_guard.js
 */

const fs    = require('fs');
const path  = require('path');
const cp    = require('child_process');

const ROOT        = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'test-workflow-config.json');
const GUARD_SCRIPT = path.join(__dirname, 'check-run-all-tests-sync.js');
const BACKUP_PATH = CONFIG_PATH + '.bak_synctest';

let pass = 0;
let fail = 0;

function check(label, cond) {
    if (cond) {
        console.log(`PASS  ${label}`);
        pass++;
    } else {
        console.log(`FAIL  ${label}`);
        fail++;
    }
}

function runGuard() {
    return cp.spawnSync(process.execPath, [GUARD_SCRIPT], {
        cwd: ROOT,
        encoding: 'utf8',
    });
}

function withConfig(tempContent, fn) {
    const had = fs.existsSync(CONFIG_PATH);
    const original = had ? fs.readFileSync(CONFIG_PATH, 'utf8') : null;

    if (tempContent === null) {
        if (had) fs.renameSync(CONFIG_PATH, BACKUP_PATH);
    } else {
        fs.writeFileSync(CONFIG_PATH, tempContent, 'utf8');
    }

    try {
        return fn();
    } finally {
        if (tempContent === null) {
            if (had) fs.renameSync(BACKUP_PATH, CONFIG_PATH);
        } else {
            if (original !== null) {
                fs.writeFileSync(CONFIG_PATH, original, 'utf8');
            } else {
                fs.unlinkSync(CONFIG_PATH);
            }
        }
        if (fs.existsSync(BACKUP_PATH)) fs.unlinkSync(BACKUP_PATH);
    }
}

function configWithScriptOnlySuites(scriptOnlySuites) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    config.scriptOnlySuites = scriptOnlySuites;
    return JSON.stringify(config);
}

// ---------------------------------------------------------------------------
// T1 — missing config file: exits 1 with a clear configuration error
// ---------------------------------------------------------------------------
{
    const result = withConfig(null, () => runGuard());

    check('T1: missing config — exit code 1',
        result.status === 1);

    check('T1: missing config — clear error on stderr',
        (result.stderr || '').includes('SYNC CONFIG ERROR') &&
        (result.stderr || '').includes('not found'));
}

// ---------------------------------------------------------------------------
// T2 — corrupt JSON: exits 1 with a clear configuration error
// ---------------------------------------------------------------------------
{
    const result = withConfig('{ this is not valid JSON !!!', () => runGuard());

    check('T2: corrupt JSON — exit code 1',
        result.status === 1);

    check('T2: corrupt JSON — clear error on stderr',
        (result.stderr || '').includes('SYNC CONFIG ERROR') &&
        (result.stderr || '').includes('could not parse'));
}

// ---------------------------------------------------------------------------
// T3 — corrupt schema: exits 1 with a clear configuration error
// ---------------------------------------------------------------------------
{
    const result = withConfig(JSON.stringify({
        infrastructureWorkflows: [],
        scriptOnlySuites: 'not-an-array',
    }), () => runGuard());

    check('T3: corrupt schema — exit code 1',
        result.status === 1);

    check('T3: corrupt schema — clear error on stderr',
        (result.stderr || '').includes('SYNC CONFIG ERROR') &&
        (result.stderr || '').includes('infrastructureWorkflows'));
}

// ---------------------------------------------------------------------------
// T4 — stale script-only declaration: exits 1 and reports the declaration
// ---------------------------------------------------------------------------
{
    const config = configWithScriptOnlySuites(['suite-that-no-longer-exists']);
    const result = withConfig(config, () => runGuard());
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;

    check('T4: stale script-only declaration — exit code 1',
        result.status === 1);

    check('T4: stale script-only declaration — reports missing script registration',
        output.includes('script-only declarations are not') &&
        output.includes('suite-that-no-longer-exists'));
}

// ---------------------------------------------------------------------------
// T5 — script-only declaration with a dedicated workflow: exits 1 and reports it
// ---------------------------------------------------------------------------
{
    const config = configWithScriptOnlySuites(['assembler-tests']);
    const result = withConfig(config, () => runGuard());
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;

    check('T5: script-only declaration with workflow — exit code 1',
        result.status === 1);

    check('T5: script-only declaration with workflow — reports dedicated workflow',
        output.includes('also have') &&
        output.includes('a dedicated workflow in .replit') &&
        output.includes('assembler-tests'));
}

// ---------------------------------------------------------------------------
// T6 — duplicate script-only declaration: exits 1 with a config error
// ---------------------------------------------------------------------------
{
    const config = configWithScriptOnlySuites([
        'sha32-vectors',
        'lambda-exec-tests',
        'sha32-vectors',
        'lambda-exec-tests',
    ]);
    const result = withConfig(config, () => runGuard());
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;

    check('T6: duplicate script-only declaration — exit code 1',
        result.status === 1);

    check('T6: duplicate script-only declaration — clear config error',
        output.includes('SYNC CONFIG ERROR') &&
        output.includes('"scriptOnlySuites" contains duplicate entries') &&
        output.includes('sha32-vectors') &&
        output.includes('lambda-exec-tests'));
}

// ---------------------------------------------------------------------------
// T7 — normal case: exits 0, stdout contains "OK"
// ---------------------------------------------------------------------------
{
    const result = runGuard();

    check('T7: normal case — exit code 0',
        result.status === 0);

    check('T7: normal case — OK line printed',
        (result.stdout || '').includes('OK — all'));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log(`sync-guard tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

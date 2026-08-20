#!/usr/bin/env node
'use strict';
/**
 * test_sync_guard.js
 *
 * Tests the fallback behaviour of check-run-all-tests-sync.js when
 * test-workflow-config.json is missing or unparseable, validates script-only
 * declarations, and confirms the happy-path produces the expected OK output.
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
// T1 — missing config file: exits 0, stderr contains WARNING
// ---------------------------------------------------------------------------
{
    const result = withConfig(null, () => runGuard());

    check('T1: missing config — exit code 0',
        result.status === 0);

    check('T1: missing config — WARNING on stderr',
        (result.stderr || '').includes('WARNING'));
}

// ---------------------------------------------------------------------------
// T2 — corrupt JSON: exits 0, stderr contains WARNING
// ---------------------------------------------------------------------------
{
    const result = withConfig('{ this is not valid JSON !!!', () => runGuard());

    check('T2: corrupt JSON — exit code 0',
        result.status === 0);

    check('T2: corrupt JSON — WARNING on stderr',
        (result.stderr || '').includes('WARNING'));
}

// ---------------------------------------------------------------------------
// T3 — stale script-only declaration: exits 1 and reports the declaration
// ---------------------------------------------------------------------------
{
    const config = configWithScriptOnlySuites(['suite-that-no-longer-exists']);
    const result = withConfig(config, () => runGuard());
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;

    check('T3: stale script-only declaration — exit code 1',
        result.status === 1);

    check('T3: stale script-only declaration — reports missing script registration',
        output.includes('script-only declarations are not') &&
        output.includes('suite-that-no-longer-exists'));
}

// ---------------------------------------------------------------------------
// T4 — script-only declaration with a dedicated workflow: exits 1 and reports it
// ---------------------------------------------------------------------------
{
    const config = configWithScriptOnlySuites(['assembler-tests']);
    const result = withConfig(config, () => runGuard());
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;

    check('T4: script-only declaration with workflow — exit code 1',
        result.status === 1);

    check('T4: script-only declaration with workflow — reports dedicated workflow',
        output.includes('also have') &&
        output.includes('a dedicated workflow in .replit') &&
        output.includes('assembler-tests'));
}

// ---------------------------------------------------------------------------
// T5 — duplicate script-only declaration: exits 1 and reports the duplicate
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

    check('T5: duplicate script-only declaration — exit code 1',
        result.status === 1);

    check('T5: duplicate script-only declaration — reports duplicated suite',
        output.includes('scriptOnlySuites contains duplicate declarations') &&
        output.includes('sha32-vectors') &&
        output.includes('lambda-exec-tests'));
}

// ---------------------------------------------------------------------------
// T6 — normal case: exits 0, stdout contains "OK"
// ---------------------------------------------------------------------------
{
    const result = runGuard();

    check('T6: normal case — exit code 0',
        result.status === 0);

    check('T6: normal case — OK line printed',
        (result.stdout || '').includes('OK — all'));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log(`sync-guard tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { historicalClassification, inspect } = require('./check-lump-embedded-content.js');
const ROOT = path.resolve(__dirname, '..');
const CANONICAL_LUMPS = path.join(ROOT, 'server', 'lumps');
const builds = [
    ['build_capability_test_lump.js', 'simulator/examples/capability_test.cloomc'],
    ['build_selftest_lump.js', 'simulator/examples/post_flash_selftest.cloomc'],
    ['build_wukong_callhome_lump.js', 'simulator/examples/wukong_callhome.cloomc'],
    ['build_event_router_lump.js', 'simulator/cloomc/EventRouter.cloomc'],
];

const canonicalManifest = JSON.parse(fs.readFileSync(
    path.join(CANONICAL_LUMPS, 'manifest.json'), 'utf8'));
const canonicalState = JSON.parse(fs.readFileSync(
    path.join(CANONICAL_LUMPS, 'ns-state.json'), 'utf8'));

function seedCanonicalState(dir, script) {
    const names = {
        'build_capability_test_lump.js': 'CapabilityTest',
        'build_selftest_lump.js': 'SelfTest',
        'build_wukong_callhome_lump.js': 'WukongCallHome',
        'build_event_router_lump.js': 'EventRouter',
    };
    const abstraction = names[script];
    const rows = (canonicalState.abstractions || []).filter(row =>
        row.name === abstraction && row.resident === true && row.boot_resident === true);
    const selected = new Set(rows.map(row => row.filename));
    const manifest = canonicalManifest.filter(entry =>
        entry.abstraction === abstraction && selected.has(entry.filename));
    if (rows.length && manifest.length !== rows.length) {
        throw new Error(`canonical ${abstraction} state has no matching manifest locator`);
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'ns-state.json'),
        JSON.stringify({ abstractions: rows }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'approvals.json'),
        JSON.stringify({ version: 1, algorithm: 'sha256', approvals: {} }, null, 2) + '\n');
}

let failures = 0;

try {
    const missing = new Error('embedded content missing');
    const legacy = historicalClassification({ pre_embedded_content: true }, missing);
    const unmarked = historicalClassification({
        filename: 'Salvation.1.6be43a9d.lump',
    }, missing);
    if (legacy !== 'historical pre-embedded-content artifact') {
        throw new Error('manifest pre-embedded-content classification was not honored');
    }
    if (unmarked !== null) {
        throw new Error('unmarked current artifact did not fail closed');
    }
    console.log('PASS manifest legacy classification');
} catch (error) {
    console.error(`FAIL manifest legacy classification: ${error.message}`);
    failures++;
}

for (const [script, sourceName] of builds) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lump-content-'));
    try {
        seedCanonicalState(dir, script);
        execFileSync(process.execPath,
            [path.join(__dirname, script), '--out-dir', dir], { cwd: ROOT, stdio: 'pipe' });
        const files = fs.readdirSync(dir);
        const binaries = files.filter(name => name.endsWith('.lump'));
        const stateFiles = new Set(['manifest.json', 'ns-state.json', 'approvals.json']);
        const unexpectedJson = files.filter(name => name.endsWith('.json') && !stateFiles.has(name));
        if (binaries.length !== 1 || unexpectedJson.length) {
            throw new Error(`expected one binary and no per-LUMP JSON; got ${files.join(', ')}`);
        }
        const content = inspect(path.join(dir, binaries[0]));
        const expected = fs.readFileSync(path.join(ROOT, sourceName), 'utf8');
        if (!content.api || !Array.isArray(content.api.methods) || content.source !== expected) {
            throw new Error('embedded API/source mismatch');
        }
        console.log(`PASS ${script}`);
    } catch (error) {
        console.error(`FAIL ${script}: ${error.message}`);
        failures++;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
if (failures) process.exit(1);
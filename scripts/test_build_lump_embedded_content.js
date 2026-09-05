#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { inspect } = require('./check-lump-embedded-content.js');
const ROOT = path.resolve(__dirname, '..');
const builds = [
    ['build_capability_test_lump.js', 'simulator/examples/capability_test.cloomc'],
    ['build_selftest_lump.js', 'simulator/examples/post_flash_selftest.cloomc'],
    ['build_wukong_callhome_lump.js', 'simulator/examples/wukong_callhome.cloomc'],
    ['build_event_router_lump.js', 'simulator/cloomc/EventRouter.cloomc'],
];

let failures = 0;
for (const [script, sourceName] of builds) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lump-content-'));
    try {
        fs.writeFileSync(path.join(dir, 'manifest.json'), '[]\n');
        execFileSync(process.execPath,
            [path.join(__dirname, script), '--out-dir', dir], { cwd: ROOT, stdio: 'pipe' });
        const files = fs.readdirSync(dir);
        const binaries = files.filter(name => name.endsWith('.lump'));
        const unexpectedJson = files.filter(name => name.endsWith('.json') && name !== 'manifest.json');
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
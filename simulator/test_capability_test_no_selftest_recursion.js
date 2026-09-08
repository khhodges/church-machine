'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const canonical = fs.readFileSync(
    path.join(__dirname, 'examples', 'capability_test.cloomc'), 'utf8');
const appRunFile = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const builder = fs.readFileSync(
    path.join(root, 'scripts', 'build_capability_test_lump.js'), 'utf8');
const appRunStart = appRunFile.indexOf("'capability_test': `");
const appRunEnd = appRunFile.indexOf("'system_patterns': `", appRunStart);
assert(appRunStart >= 0 && appRunEnd > appRunStart,
    'inline CapabilityTest source block must exist');
const appRun = appRunFile.slice(appRunStart, appRunEnd);

for (const source of [canonical, appRun]) {
    assert.doesNotMatch(
        source,
        /ELOADCALL\s+CR0,\s*SelfTest\b/,
        'CapabilityTest must not recursively call the startup SelfTest');
    assert.match(
        source,
        /ELOADCALL\s+CR0,\s*WukongCallHome,\s*0/,
        'CapabilityTest must continue to WukongCallHome');
    assert.doesNotMatch(
        source,
        /SWITCH\s+CR13\b/,
        'continuing CapabilityTest must not execute the terminal M-absent fault case');
}

assert.match(
    builder,
    /gt:\s*0x4A000007,\s*name:\s*'WukongCallHome'/,
    'CapabilityTest binary must carry the WukongCallHome E-GT');

console.log('CapabilityTest recursion guard passed');
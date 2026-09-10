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
        /ELOADCALL\s+CR0,\s*WukongCallHome\.hw,\s*0/,
        'CapabilityTest must continue to WukongCallHome.hw');
    assert.match(
        source,
        /BRANCH\s+Start\b/,
        'CapabilityTest must rerun from Start if WukongCallHome returns');
}

assert.match(
    builder,
    /gt:\s*0x4A000007,\s*name:\s*'WukongCallHome\.hw'/,
    'CapabilityTest binary must carry the WukongCallHome.hw E-GT');
assert.match(canonical, /LOAD\s+CR0,\s*M_BIT_DEV/);
assert.match(canonical, /IADD\s+DR1,\s*#0b0001000000000000/);
assert.match(canonical, /IADD\s+DR1,\s*#1[\s\S]*SHL\s+DR1,\s*DR1,\s*15/);
assert.strictEqual((canonical.match(/DWRITE\s+DR1,\s*CR0,\s*#0/g) || []).length, 2);
assert.match(canonical, /SWITCH\s+CR12,\s*CR6,\s*#0/);
assert.match(canonical, /SWITCH\s+CR15,\s*CR15/);

console.log('CapabilityTest recursion guard passed');
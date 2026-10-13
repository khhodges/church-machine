'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('./capability_tokens');
const config = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../server/ide-hierarchy.json'), 'utf8'));
const approved = {
    'Thread.2': `${config.node}.Thread2`,
    'Thread.3': `${config.node}.Thread3`,
    'ide.Thread.2': `${config.node}.Thread2`,
    'ide.Thread.3': `${config.node}.Thread3`,
    'Boot.Thread': `${config.node}.BootThread`,
};
for (const [name, canonical] of Object.entries(approved)) {
    const cap = {name, rights: []};
    const decision = policy.checkLeafOwnership(cap, config);
    assert.equal(decision.error, null, name);
    assert.equal(decision.ownership, 'local', name);
    assert.equal(decision.canonical, canonical, name);
    // These are exact operator-provisioned aliases, not a permissionless
    // Thread exemption from canonical identity or foreign ownership checks.
    const missing = {...config, aliases: {}};
    assert(policy.checkLeafOwnership(cap, missing).error, `${name}: missing alias must fail`);
    const foreign = {...config, node: 'anotherIDE'};
    assert(policy.checkLeafOwnership(cap, foreign).error, `${name}: foreign ownership must fail`);
}
console.log('Approved Thread aliases, missing-alias rejection and foreign ownership checks passed.');

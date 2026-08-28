'use strict';

// The boot UI must distinguish the destination control register (CR15) from
// the Namespace source slot (NS[0]) and use the canonical Boot.NS name.
const assert = require('assert');
const fs = require('fs');

const runSource = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const memorySource = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const canonical = 'CR15 \\u2190 NS[0] Boot.NS.';

assert(runSource.includes(canonical),
    'boot NIA sequence uses the canonical CR15 ← NS[0] Boot.NS. label');
assert(memorySource.includes(canonical),
    'boot memory listing uses the canonical CR15 ← NS[0] Boot.NS. label');
assert(!runSource.includes('CR15 \\u2190 NS[0] Namespace'),
    'boot NIA sequence does not use the ambiguous Namespace label');
assert(!memorySource.includes('CR15 \\u2190 NS[0] Namespace'),
    'boot memory listing does not use the ambiguous Namespace label');

console.log('PASS boot display labels');
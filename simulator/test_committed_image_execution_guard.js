'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');

for (const [name, context] of [
    ['stepSim', 'Step'],
    ['runSimGo', 'Run'],
    ['runThreadFromModal', 'Thread Run'],
    ['selectThreadContext', 'Thread selection'],
]) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} exists`);
    const body = source.slice(start, source.indexOf('\n}', start) + 2);
    assert(body.includes(`_requireCommittedImageForExecution('${context}')`),
        `${name} blocks fallback execution without a committed image`);
}

assert(source.includes(
    'sim && sim._bootImageLoaded === true'),
    'execution authority requires an image accepted by the simulator');
assert(source.includes(
    '_bootHasCommittedImage()'),
    'execution authority requires the prepared browser cache');

console.log('committed boot-image execution guard tests passed');
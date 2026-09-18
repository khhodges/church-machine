'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const threadRunStart = source.indexOf('function runThreadFromModal()');
const threadRunEnd = source.indexOf('\n}', threadRunStart);
const threadRun = source.slice(threadRunStart, threadRunEnd + 2);
const runGoStart = source.indexOf('function runSimGo(');
const runGoEnd = source.indexOf('\n}', runGoStart);
const runGo = source.slice(runGoStart, runGoEnd + 2);

assert(threadRun.includes('selectConfiguredThread(requestedSlot)'),
    'Thread Run restores the selected Thread through CHANGE');
assert(threadRun.includes('runSimGo(undefined, { applyPendingLoad: false })'),
    'Thread Run explicitly selects pure resume mode');
assert(!threadRun.includes('_applyPendingSimLoad()'),
    'Thread Run never installs an editor candidate after CHANGE');
assert(runGo.includes('options.applyPendingLoad !== false'),
    'generic Run applies a pending candidate only when the caller permits it');

console.log('Thread Run resume-boundary tests passed');
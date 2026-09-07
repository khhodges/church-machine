#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'app-misc.js'), 'utf8');

assert.match(source,
    /physicalPC[\s\S]*_nsOwnerOf\(physicalPC\)[\s\S]*lumpTokenAtSlot\(nsIdx\)/,
    'trace capture binds each instruction to its executed LUMP identity');
assert.match(source,
    /instrIdx:[\s\S]*owner\.offset - 1/,
    'trace capture converts the physical LUMP offset to a code-word index');
assert.match(source,
    /trace-row-source-link[\s\S]*_traceOpenExecutedSource\(entry\)/,
    'clickable trace rows open their executed source');
assert.match(source,
    /openLumpInEditor\(entry\.lumpToken\)[\s\S]*getLastLineNums[\s\S]*_jumpToAsmLine\(targetLine\)/,
    'trace navigation opens the immutable LUMP and uses its assembler source map');
assert.match(source,
    /event\.key !== 'Enter'[\s\S]*event\.key !== ' '/,
    'trace source navigation is keyboard accessible');

console.log('Trace-to-editor navigation regression passed');
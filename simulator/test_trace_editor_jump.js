#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'app-misc.js'), 'utf8');
const memorySource = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');

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
assert.match(memorySource,
    /function _canonicalEditorTokenForSlot[\s\S]*saved\.token[\s\S]*padStart\(8, '0'\)[\s\S]*function _openSimulatorInstructionSource[\s\S]*_traceOpenExecutedSource/,
    'Simulator code rows resolve the canonical saved artifact before opening source');
assert.match(memorySource,
    /_canonicalEditorTokenForSlot[\s\S]*window\._nsState[\s\S]*saved\.token[\s\S]*_findSrcLump\(nsIdx, label\)/,
    'source navigation prefers authoritative Namespace metadata and falls back to repository identity');
assert.match(memorySource,
    /class="cr-idx code-breakpoint-address"[\s\S]*ondblclick="event\.stopPropagation\(\);openBreakPopoverAt/,
    'double-click breakpoint handling is limited to the address cell');
assert.doesNotMatch(memorySource,
    /<tr class="\$\{rowClass\}"[^>]*ondblclick=/,
    'the complete Simulator code row no longer captures breakpoint double-clicks');
assert.match(memorySource,
    /class="code-disasm code-source-link"[\s\S]*onclick="\$\{_openSource\}"/,
    'clicking the Simulator mnemonic opens its source line');

console.log('Trace-to-editor navigation regression passed');
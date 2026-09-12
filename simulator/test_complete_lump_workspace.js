'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const lumps = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const memory = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'styles-toolbar.css'), 'utf8');

assert(html.includes('id="savedLumpIdentityPanel"'),
    'complete workspace includes the visible verified identity panel');
assert(html.indexOf('id="asmEditor"') < html.indexOf('id="savedLumpDisassemblyPanel"'),
    'source and exact disassembly coexist in the editor layout');

for (const label of [
    'Canonical dot-name token', 'Exact lookup token', 'Golden T ID',
    'Golden Token', 'Binary seal'
]) {
    assert(lumps.includes(label), `complete workspace shows ${label}`);
}
assert(lumps.includes("server ? text(server.golden_token) : null"),
    'Golden Token is accepted only from server metadata');
assert(lumps.includes("text(server.golden_t_id) || text(server.identity_hash)"),
    'Golden T uses verified server identity metadata');
assert(!lumps.includes('goldenT: server ? text(server.token)'),
    'lookup token is never used as a Golden T fallback');
assert(lumps.includes("unavailable in verified server metadata"),
    'missing identity facts fail visibly');

const nsOpen = memory.slice(memory.indexOf('function _nsLabelOpen'),
    memory.indexOf('// Dedicated read-only popup', memory.indexOf('function _nsLabelOpen')));
assert(nsOpen.indexOf('openLumpInEditor(srcLump.token)') <
    nsOpen.indexOf('_showNSLumpModal(slotIdx, e)'),
    'known Namespace code slots route directly to the complete workspace');

assert(lumps.includes('_resolveSavedLumpEditorSource(_binaryFrameSource)'),
    'embedded binary source remains authoritative');
assert(lumps.includes('_enterSavedLumpEditorMode(_compiledDisasm, lumpName,'),
    'identity and exact disassembly enter the same workspace');
assert(css.includes('@media (max-width: 760px)') &&
    css.includes('grid-template-rows: minmax(16rem, 1fr) minmax(16rem, 1fr)'),
    'complete workspace stacks source and disassembly responsively');

console.log('PASS complete LUMP workspace contract');
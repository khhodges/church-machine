'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {JSDOM} = require('jsdom');
const {spawnSync} = require('child_process');
const dom = new JSDOM(`<div id="editor"><div class="editor-layout">
<section id="savedLumpDisassemblyPanel"><pre id="savedLumpDisassembly"></pre>
<details id="compiledLumpMetadata"><pre id="compiledLumpMetadataText"></pre></details>
<details id="savedLumpBuildDetails"></details></section></div></div>`);
dom.window.LumpApiCodec = require('./lump-api-codec');
const file = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const start = file.indexOf('function _showCompiledCandidateBesideSource(');
const end = file.indexOf('window._showCompiledCandidateBesideSource', start);
const ctx = vm.createContext({window:dom.window,document:dom.window.document,TextDecoder,
    _formatLumpHeaderDisassembly: () => '[0000] HEADER',
    _lumpDispatchAnnotation: () => '',
    _setDisassemblyPresentationStatus: () => {},
    assembler: {disassemble: word => 'DECODE ' + word}});
vm.runInContext(file.slice(start, end), ctx);
const source = 'abstraction test.View {\ncapabilities { SELF E }\nmethod Run() {\nRETURN\n}\n}';
const proc = spawnSync(process.execPath, ['server/compile_worker.js'], {
    input:JSON.stringify({source, language:'javascript',tier:2}), encoding:'utf8'});
const compiled = JSON.parse(proc.stdout);
assert(compiled.ok, JSON.stringify(compiled));
ctx._showCompiledCandidateBesideSource(compiled.words, {methodCount:1,
    referenceReport:'Reference verification: SELF containing artifact'});
const code = dom.window.document.getElementById('savedLumpDisassembly').textContent;
const meta = dom.window.document.getElementById('compiledLumpMetadataText').textContent;
assert.match(code, /HEADER/);
assert.match(code, /DECODE/);
assert.doesNotMatch(code, /Reference verification|Embedded definition|C-list|methods|;/);
assert.match(meta, /C-list\[0\] "SELF"/);
assert.doesNotMatch(meta, /PetName unavailable/);
assert.match(dom.window._compiledCandidateAuditText, /Reference verification/);
console.log('PASS disassembly, decoded compact SELF, metadata and audit separation');

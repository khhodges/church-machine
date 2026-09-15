'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const helper = code.slice(code.indexOf('function _openLumpHistorySourceInEditor('),
    code.indexOf('async function _lumpHistoryPreview('));
function run(activeTab, source) {
    const tabs = [];
    const editor = { value: 'previous unsaved source' };
    const ctx = {
        window: { _editorSourceFilePath: 'old.cloomc', _activeBuiltInKey: 'old' },
        activeUserTabId: activeTab,
        document: { getElementById: id => id === 'asmEditor' ? editor : { value: 'assembly' } },
        createUserTab: (name, lang, text, sourceRevision) => tabs.push({ name, lang, text, sourceRevision }),
        _isRawISASource: () => true,
        _closeLumpHistoryPreviewModal: () => { ctx.closed = true; },
        switchView: view => { ctx.view = view; },
    };
    vm.createContext(ctx);
    vm.runInContext(helper, ctx);
    ctx._openLumpHistorySourceInEditor(source, 'CapabilityTest', 26);
    return { ctx, tabs };
}
const source = '; exact archived source\nLOAD CR0, CR6[1]\n';
let result = run(null, source);
assert.equal(result.tabs.length, 2);
assert.equal(result.tabs[0].text, 'previous unsaved source');
assert.equal(result.tabs[1].text, source);
assert.equal(result.tabs[1].name, 'CapabilityTest');
assert.equal(result.tabs[1].sourceRevision, 26);
assert.equal(result.ctx.window._editorSourceFilePath, null);
assert.equal(result.ctx.view, 'editor');
assert.equal(result.ctx.closed, true);
result = run('existing-personal-tab', source);
assert.equal(result.tabs.length, 1);
assert.equal(result.tabs[0].text, source);
result = run(null, '');
assert.equal(result.tabs.length, 0);
assert.ok(code.includes('class="btn lump-history-open-editor"'));
assert.ok(code.includes('_openLumpHistorySourceInEditor(archivedSource, name, version)'));
console.log('PASS exact historical source, prior buffer preservation, personal tabs, empty source, and preview wiring');
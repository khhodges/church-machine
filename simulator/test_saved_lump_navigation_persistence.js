'use strict';

const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');
const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const lumps = fs.readFileSync('simulator/app-lumps.js', 'utf8');

const start = shell.indexOf('function switchView(viewId)');
const end = shell.indexOf('\nfunction ', start + 1);
assert(start >= 0 && end > start, 'switchView is present');
const switchView = shell.slice(start, end);

assert(
    switchView.includes('!window._savedLumpEditorMode') &&
    switchView.includes('returning to Editor leaves the source/name visible'),
    'main-view navigation preserves the complete saved-LUMP editor workspace'
);
assert(
    lumps.includes('if (window._savedLumpEditorMode) exitSavedLumpEditorMode();'),
    'opening another LUMP still replaces the previous saved-LUMP workspace'
);
assert(
    run.includes('window.exitSavedLumpEditorMode();'),
    'explicit editor document changes still close saved-LUMP mode'
);

// Execute the production navigation teardown, not just a textual assertion.
// History opens a personal draft whose exact binary is a separate presentation.
const teardown = switchView.slice(
    switchView.indexOf("if (viewId !== 'editor' && currentView === 'editor'"),
    switchView.indexOf("if (viewId !== 'editor') window._restoredEditorOwnerPending"));
assert(teardown.includes('window.exitSavedLumpEditorMode();'));
for (const mode of ['saved', 'personal', 'plain']) {
    for (const [currentView, viewId] of [
        ['editor', 'editor'], ['editor', 'abstractions'], ['abstractions', 'editor'],
    ]) {
        const context = {
            currentView, viewId, clears: 0, source: 'owned draft', disassembly: 'exact saved words',
            document: { getElementById() { return null; } },
            window: {
                _savedLumpEditorMode: mode === 'saved',
                _personalSavedBinaryPresentation: mode === 'personal',
            },
        };
        context.window.exitSavedLumpEditorMode = () => {
            context.clears++;
            context.disassembly = '';
        };
        vm.runInNewContext(teardown, context);
        assert.equal(context.source, 'owned draft');
        assert.equal(context.clears, mode === 'plain' ? 1 : 0, `${mode}: ${currentView} → ${viewId}`);
        assert.equal(context.disassembly, mode === 'plain' ? '' : 'exact saved words');
    }
}
assert(lumps.includes('Full source — ${displayedCode.split(/\\r\\n|\\r|\\n/).length} lines.'));
assert(lumps.includes('tabindex="0" aria-label="Full source for version'));
const editorEntry = switchView.slice(
    switchView.indexOf('const preserveRestoredOwner ='),
    switchView.indexOf('_updateEditorPatchBar();'));
assert(editorEntry.includes('activeUserTabId = null'));
for (const restored of [false, true]) {
    const context = {
        window: { _restoredEditorOwnerPending: restored },
        activeUserTabId: 'v41-personal-draft', userTabDirty: true,
        _editorCREditActive: false,
        document: { querySelectorAll() { throw new Error('must not reset personal selection'); } },
    };
    vm.runInNewContext(editorEntry, context);
    assert.equal(context.activeUserTabId, 'v41-personal-draft',
        'entering Editor must preserve the owner checked by the pending binary fetch');
    assert.equal(context.userTabDirty, true, 'navigation must not mark an edited draft clean');
}
console.log('PASS saved and personal-LUMP disassembly survives ordinary view navigation');
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const src = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const start = src.indexOf("_bannerRestoreBtn.addEventListener('click', async function()");
const handler = src.slice(start, src.indexOf('\n            }\n            if (_bannerDiscardBtn)', start));
const full = '; header\n' + Array.from({length: 788}, (_, i) => 'instruction ' + i).join('\n');
const short = full.slice(0, 1024);
function setup(kind = 'restore') {
    let stored = full, click, reviewed, approved = false;
    const status = {setAttribute(){}};
    const context = {
        token: 'A', _savedDraft: short, _recoveredSource: 'saved source',
        _draftLsGet: () => stored,
        asmEd: {value: 'saved source', classList: {add(){}}},
        _draftBanner: {querySelector: () => status},
        _bannerRestoreBtn: {addEventListener: (_, fn) => click = fn, remove(){}},
        _bannerDiscardBtn: {disabled: false, addEventListener: (_, fn) => click = fn},
        _setSavedLumpEditorSource: text => { context.asmEd.value = text; },
        window: {
            _editorOpenLumpToken: 'A', _savedLumpOpenRequestId: 1,
            _advanceEditorNavigationEpoch(){},
            confirmSourceReplacement: async (editor, draft) => {
                reviewed = draft; return approved;
            },
            confirmProtectedChange: async details => {
                reviewed = details.changes[1].slice('After:\n'.length);
                return false;
            },
        },
    };
    const discardStart = src.indexOf("_bannerDiscardBtn.addEventListener('click', async function()");
    const discardHandler = src.slice(discardStart, src.indexOf('\n            }\n        } else {', discardStart));
    vm.runInNewContext(kind === 'restore' ? handler : discardHandler, context);
    return {context, status, click: () => click(), setStored: value => stored = value,
        approve: () => approved = true, reviewed: () => reviewed, stored: () => stored};
}
(async () => {
    let h = setup();
    await h.click();
    assert.equal(h.reviewed(), full, 'restore must not review captured 1024-character prefix');
    assert.equal(h.context.asmEd.value, 'saved source');
    assert.equal(h.stored(), full);
    h.approve();
    await h.click();
    assert.equal(h.context.asmEd.value, full, 'restoration must use exactly the reviewed full copy');
    h = setup('discard');
    await h.click();
    assert.equal(h.reviewed(), full, 'deletion and restore must review the same current full copy');
    assert.equal(h.stored(), full, 'opening and rejecting review must preserve the full copy');
    h = setup();
    h.context.window.confirmSourceReplacement = async () => {h.setStored('newer'); return true;};
    await h.click();
    assert.equal(h.context.asmEd.value, 'saved source');
    assert.equal(h.stored(), 'newer');
    assert.match(h.status.textContent, /changed during review/);
    h = setup();
    h.setStored(null);
    await h.click();
    assert.equal(h.reviewed(), undefined);
    assert.equal(h.context.asmEd.value, 'saved source');
    console.log('PASS restore reviews current full draft, rejects stale approval, preserves cancelled/missing copies');
})().catch(e => {console.error(e);process.exitCode=1;});

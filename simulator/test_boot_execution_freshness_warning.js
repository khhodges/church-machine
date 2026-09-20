'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const start = source.indexOf('function _renderBootExecutionFreshness');
const end = source.indexOf('window._renderBootExecutionFreshness = _renderBootExecutionFreshness;');
if (start < 0 || end < 0) throw new Error('execution freshness renderer is missing');
const block = source.slice(start, end);

function makeBanner() {
    return { style: {}, textContent: '', innerHTML: '' };
}

const banner = makeBanner();
const renderedActionButton = {
    onclick: null,
};
const context = {
    window: {},
    document: {
        getElementById: id => id === 'bootExecutionUpdateButton'
            ? renderedActionButton : banner,
        createElement: () => ({
            _text: '',
            set textContent(value) {
                this._text = String(value);
                this.innerHTML = this._text
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            },
        }),
    },
};
/*
 * The pre-rebase assertions are retained for reference; the incoming test
 * below checks warning-only explicit freshness behavior.
vm.createContext(context);
vm.runInContext(block, context);

context._renderBootExecutionFreshness({
    executionFreshness: { warnings: [{
        abstraction: 'SelfTest',
        selected: { version: 86 },
        latest: { version: 87 },
    }] },
});
if (banner.style.display !== 'flex') throw new Error('stale execution warning was hidden');
if (!banner.innerHTML.includes('NOT RUNNING THE LATEST COMPILED CODE')) {
    throw new Error('warning does not clearly state the consequence');
}
if (!banner.innerHTML.includes('SelfTest is executing v86 instead of latest successful v87')) {
    throw new Error('warning does not identify selected and latest versions');
}
if (!banner.innerHTML.includes('Review compilations') ||
        !banner.innerHTML.includes('_openBootExecutionUpdate()')) {
    throw new Error('warning does not offer explicit compilation review');
}
if (source.includes("fetch('/api/boot-image/update-to-latest'") ||
        !source.includes("switchView('lumps')")) {
    throw new Error('freshness action still substitutes instead of requesting review');
}

context._renderBootExecutionFreshness({
    executionFreshness: { warnings: [] },
});
if (banner.style.display !== 'none') throw new Error('current execution warning did not clear');

context._renderBootExecutionFreshness({
    executionFreshness: {
        warnings: [],
        failedSaves: [{
            abstraction: 'SelfTest',
            token: '4c35bef2',
            version: 88,
            reason: 'bootstrap-identity-invalid',
        }],
    },
});
if (banner.style.display !== 'flex' ||
        !banner.innerHTML.includes('SAVE FAILED') ||
        !banner.innerHTML.includes('SelfTest v88') ||
        !banner.innerHTML.includes('different SelfTest ID') ||
        !banner.innerHTML.includes('Open source to save again')) {
    throw new Error('failed save warning is not explicit and actionable');
}
if (!source.includes("'/diagnostic-source'") ||
        !source.includes("switchView('editor')") ||
        !source.includes('Try opening source again')) {
    throw new Error('failed save button does not directly recover source or report failure');
}

const actionStart = source.indexOf('async function _openBootExecutionUpdate');
const actionEnd = source.indexOf('window._openBootExecutionUpdate = _openBootExecutionUpdate;');
if (actionStart < 0 || actionEnd < 0) throw new Error('failed save recovery action is missing');
const editor = {
    value: '',
    dispatched: false,
    dispatchEvent() { this.dispatched = true; },
};
const status = { textContent: '' };
const button = { disabled: false, textContent: '' };
let switchedTo = null;
const actionContext = {
    window: {
        _nsState: {
            executionFreshness: {
                warnings: [],
                failedSaves: [{ token: '4c35bef2', version: 88 }],
            },
        },
        _bootExecutionRepairTarget: {
            abstraction: 'SelfTest',
            token: '4c35bef2',
            revision: 88,
            failedSave: true,
        },
    },
    document: {
        getElementById(id) {
            if (id === 'bootExecutionUpdateStatus') return status;
            if (id === 'bootExecutionUpdateButton') return button;
            if (id === 'asmEditor') return editor;
            return null;
        },
    },
    fetch: async () => ({
        ok: true,
        json: async () => ({ source: 'CALL CR0' }),
    }),
    Event: function Event() {},
    switchView(view) { switchedTo = view; },
    encodeURIComponent,
    String,
};
vm.createContext(actionContext);
vm.runInContext(source.slice(actionStart, actionEnd), actionContext);
actionContext._openBootExecutionUpdate().then(result => {
    if (result !== true || editor.value !== 'CALL CR0' ||
            !editor.dispatched || switchedTo !== 'editor') {
        throw new Error('failed save recovery button did not open source in Programs');
    }
    console.log('boot execution freshness warning tests passed');
}).catch(error => {
    console.error(error);
    process.exit(1);
});
*/
vm.createContext(context);
vm.runInContext(block, context);

context._renderBootExecutionFreshness({
    executionFreshness: { warnings: [{
        abstraction: 'SelfTest',
        selected: { version: 86 },
        latest: { version: 87 },
    }] },
});
if (banner.style.display !== 'flex') throw new Error('stale execution warning was hidden');
if (!banner.innerHTML.includes('NOT RUNNING THE LATEST COMPILED CODE')) {
    throw new Error('warning does not clearly state the consequence');
}
if (!banner.innerHTML.includes('SelfTest is executing v86 instead of latest successful v87')) {
    throw new Error('warning does not identify selected and latest versions');
}
if (!banner.innerHTML.includes('cannot boot until the IDE repairs its saved identity')) {
    throw new Error('warning does not explain why the newer revision cannot run');
}
if (!banner.innerHTML.includes('Fix v87 now') ||
        typeof renderedActionButton.onclick !== 'function') {
    throw new Error('warning does not provide the exact revision repair action');
}
if (source.includes("fetch('/api/boot-image/update-to-latest'")) {
    throw new Error('freshness UI must not trigger automatic latest promotion');
}
if (!source.includes('_showLatestCompilationPromotion(token, target)')) {
    throw new Error('freshness action does not open guarded identity repair');
}

context._renderBootExecutionFreshness({
    executionFreshness: {
        warnings: [],
        failedSaves: [{
            abstraction: 'SelfTest',
            slot: 6,
            token: '00000600',
            currentToken: '4a000006',
            filename: 'SelfTest.v76.lump',
            version: 76,
            archived: true,
        }],
    },
});
if (!banner.innerHTML.includes('IDE SAVE REPAIR REQUIRED') ||
        !banner.innerHTML.includes('Review IDE repair') ||
        banner.innerHTML.includes('Open recovered source') ||
        banner.innerHTML.includes('Save LUMP')) {
    throw new Error('historical identity incident still delegates compiler repair to the programmer');
}
if (!source.includes("_switchLumpTab(tk, 'history')") ||
        !source.includes('await _lumpHistoryPreview(') ||
        source.includes("'/diagnostic-source'")) {
    throw new Error('historical incident does not open the IDE-owned History repair control');
}

context._renderBootExecutionFreshness({
    executionFreshness: { warnings: [] },
});
if (banner.style.display !== 'none') throw new Error('current execution warning did not clear');

console.log('boot execution freshness warning tests passed');

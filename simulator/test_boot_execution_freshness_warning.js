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
const context = {
    window: {},
    document: {
        getElementById: () => banner,
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

console.log('boot execution freshness warning tests passed');
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
        !banner.innerHTML.includes('_openBootExecutionUpdate()')) {
    throw new Error('warning does not provide the exact revision repair action');
}
if (source.includes("fetch('/api/boot-image/update-to-latest'")) {
    throw new Error('freshness UI must not trigger automatic latest promotion');
}
if (!source.includes('_showLatestCompilationPromotion(token)')) {
    throw new Error('freshness action does not open guarded identity repair');
}

context._renderBootExecutionFreshness({
    executionFreshness: { warnings: [] },
});
if (banner.style.display !== 'none') throw new Error('current execution warning did not clear');

console.log('boot execution freshness warning tests passed');

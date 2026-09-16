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
if (!banner.innerHTML.includes('Update to latest') ||
        !banner.innerHTML.includes('_openBootExecutionUpdate()')) {
    throw new Error('warning does not offer the guarded update action');
}

context._renderBootExecutionFreshness({
    executionFreshness: { warnings: [] },
});
if (banner.style.display !== 'none') throw new Error('current execution warning did not clear');

console.log('boot execution freshness warning tests passed');
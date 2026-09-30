'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('simulator/app-memory.js', 'utf8');
const start = source.indexOf('// Capacity reads the committed server image');
const end = source.indexOf('// Pending Prepare/Run pins', start);
assert(start >= 0 && end > start);
const root = { innerHTML: '', textContent: '' };
const button = { disabled: false };
const context = {
    window: {},
    document: {
        getElementById(id) {
            return id === 'bootCapacityReport' ? root :
                id === 'bootCapacityRefresh' ? button : null;
        },
    },
    _escHtml(text) {
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
context._renderBootCapacity({
    layout: 'generic', denseBytes: 65536, totalWords: 16384,
    advisory: { applies: true }, physicalTarget: {},
    allocatedWords: null, freeWords: null, largestFreeWords: null,
    warnings: ['Untrusted <slot>'], rows: [{
        slot: 15, name: '<unsafe>', version: 1,
        allocatedWords: null, paddingWords: null,
        unclassifiedWords: null, threadHeapWords: null,
        status: 'Design-only symbolic placement; not installed',
    }],
});
assert.match(root.innerHTML, /Capacity not validated/);
assert.match(root.innerHTML, /Free: unavailable/);
assert.match(root.innerHTML, /NS\[15\] &lt;unsafe&gt;/);
assert.doesNotMatch(root.innerHTML, /<unsafe>/);
assert.match(root.innerHTML, /Saved unclassified contents \/ slack/);
context._renderBootCapacity({
    layout: 'generic', denseBytes: 65536, totalWords: 16384,
    advisory: { applies: true, bootBudgetWords: 12288 }, physicalTarget: {},
    trusted: true, allocatedWords: 13000, freeWords: 3384,
    largestFreeWords: 2000, warnings: [], rows: [{
        slot: 6, name: 'Example', version: 1,
        savedAllocationWords: 128, savedPaddingWords: 30,
        allocatedWords: 128, savedUnclassifiedWords: 0,
        threadHeapWords: null, status: 'verified',
    }],
});
assert.match(root.innerHTML, /advisory budget exceeded by 712 words/);
assert.doesNotMatch(root.innerHTML, /headroom below the 48 KiB threshold: -/);
assert.match(root.innerHTML, /Exact saved cost/);
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const start = source.indexOf('    // ── Capabilities table');
const end = source.indexOf('_capsEl.innerHTML = _capsHtml;', start);
assert(start >= 0 && end > start);
const code = source.slice(start, end + '_capsEl.innerHTML = _capsHtml;'.length) + '\n}}';
const table = {};
const names = ['SelfTest','LED_DEV','UART_DEV','BTN_DEV','TIMER_DEV','M_BIT_DEV','Exact.Name#2','Unknown'];
const slots = [6,3,2,4,5,13,0];
const ctx = {
    document: {getElementById: () => table},
    _cc: names.length + 1,
    _caps: names,
    _svLumpSize: names.length + 1,
    _svBinary: Array(names.length).fill(0).concat(0xFEED0000),
    ChurchSimulator: {PENDING_GT_NAMES: ['LED_DEV']},
    abstractionRegistry: {getByName: n => {
        const i = names.indexOf(n);
        return i >= 0 && i < slots.length ? {index:slots[i]} : null;
    }},
    _fmtEscape: s => String(s),
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
names.forEach((name, i) => {
    assert(table.innerHTML.includes('class="fmt-caps-name">' + name + '</span>'));
    if (i < slots.length) assert(table.innerHTML.includes('NS[' + slots[i] + ']'));
});
assert(!table.innerHTML.includes('SelfTest#6'));
assert(!table.innerHTML.includes('LED_DEV#3'));
assert(table.innerHTML.includes('LED_DEV (pending)</span>'));
assert(!table.innerHTML.includes('NS[null]'));
assert.deepEqual(ctx._caps, names);
console.log('PASS names unchanged, separate locations, explicit issue, zero slot, unknown and pending');
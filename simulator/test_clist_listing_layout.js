'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const start = source.indexOf('function _formatCListListing(');
const end = source.indexOf('\nfunction _clistTypeLabel(', start);
assert.notStrictEqual(start, -1, 'C-list formatter exists');
assert.notStrictEqual(end, -1, 'C-list formatter has a stable extraction boundary');

const context = {
    _clistTypeLabel(name) {
        return name === 'SelfTest' || name === 'WukongCallHomeAbstr' ? 'Abstr' : '-';
    },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const listing = context._formatCListListing([
    { name: 'SELF', rights: ['E'] },
    { name: 'SelfTest', rights: ['E'] },
    { name: 'LED_DEV', rights: ['R', 'W'] },
    { name: 'WukongCallHomeAbstr', rights: ['E'] },
]);
const rows = listing.split('\n').filter(line => line.startsWith('  *'));
assert.strictEqual(rows.length, 4);

const columns = rows.map(line => line.trim().split(/\s{2,}/));
assert.deepStrictEqual(columns[0], ['* [0]', 'SELF', '-', '[E]']);
assert.deepStrictEqual(columns[1], ['* [1]', 'SelfTest', 'Abstr', '[E]']);
assert.deepStrictEqual(columns[2], ['* [2]', 'LED_DEV', '-', '[RW]']);
assert.deepStrictEqual(columns[3],
    ['* [3]', 'WukongCallHomeAbstr', 'Abstr', '[E]']);
assert.match(rows[3], /WukongCallHomeAbstr {2,}Abstr {2,}\[E\]/,
    'long capability names retain visible separation from type and rights');

console.log('C-list listing layout regression: PASS');
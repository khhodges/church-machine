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
const rows = [
    { slot: 10, name: 'Ten', locationWord: 256, allocatedWords: 128,
        status: 'verified' },
    { slot: 2, name: 'Two', locationWord: 16, allocatedWords: 128,
        status: 'verified' },
    { slot: 8, name: 'Eight', locationWord: 100, allocatedWords: 64,
        status: 'verified' },
    { slot: 12, name: '<uninstalled>', savedAllocationWords: 256,
        status: 'No validated committed image descriptor' },
    { slot: 3, name: 'Three', savedAllocationWords: 128,
        status: 'Design-only symbolic placement; not installed', designOnly: true },
];
const report = {
    denseBytes: 65536, totalWords: 16384, reservedWords: 272,
    allocatedWords: null, freeWords: null, largestFreeWords: null,
    warnings: ['NS[2] overlaps NS[8]'], trusted: false,
    reservedRanges: [
        { name: 'Namespace table', locationWord: 1024, allocatedWords: 256 },
        { name: 'Namespace header', locationWord: 0, allocatedWords: 16 },
    ],
    rows,
};
context._renderBootCapacity(report);
const html = root.innerHTML;
const tableRows = [...html.matchAll(/<tr(?: style="[^"]*")?><td>(.*?)<\/tr>/g)]
    .map(match => match[0]);
assert.equal(tableRows.length, 7);
assert.deepEqual(tableRows.map(row => row.match(/<td>(.*?)<\/td>/)[1]), [
    'Namespace header (Reserved)', 'NS[2] Two', 'NS[8] Eight',
    'NS[10] Ten', 'Namespace table (Reserved)',
    'NS[3] Three', 'NS[12] &lt;uninstalled&gt;',
]);
assert.equal(rows[0].slot, 10); // Presentation sorting did not mutate report.
assert.match(html, /word addresses \(hex\)<\/strong>, not byte offsets/);
assert.match(html, /Base \(word address\)/);
assert.match(html, /Last \(word address, inclusive\)/);
assert.match(tableRows[1], /128 words \(512 bytes\)<\/td><td>0x10<\/td><td>0x8F<\/td>/);
assert.match(tableRows[2], /64 words \(256 bytes\)<\/td><td>0x64<\/td><td>0xA3<\/td>/);
assert.match(tableRows[0], /0x0<\/td><td>0xF<\/td>/);
assert.match(tableRows[1], /background:rgba\(248,113,113,0.18\).*Overlap/);
assert.match(tableRows[2], /background:rgba\(248,113,113,0.18\).*Overlap/);
assert.doesNotMatch(tableRows[3], /Overlap/);
assert.match(tableRows[5], /128 words \(512 bytes\) \(saved; not installed size\)<\/td><td>—<\/td><td>—<\/td>/);
assert.match(tableRows[6], /256 words \(1,024 bytes\) \(saved; not installed size\)<\/td><td>—<\/td><td>—<\/td>/);
assert.match(html, /Capacity not validated/);
assert.match(html, /Free: Cannot validate — see layout issues below/);
assert.doesNotMatch(html, /<uninstalled>/);

context._renderBootCapacity({
    denseBytes: 65536, totalWords: 16384,
    trusted: true, allocatedWords: 13000, freeWords: 3384,
    largestFreeWords: 2000, warnings: [],
    advisory: { applies: true, bootBudgetWords: 12288 },
    rows: [{ slot: 1, locationWord: 4096, allocatedWords: 256,
        threadHeapWords: 194, status: 'installed Thread geometry' }],
});
assert.match(root.innerHTML, /advisory budget exceeded by 712 words/);
assert.match(root.innerHTML, /256 words \(1,024 bytes\)<\/td><td>0x1000<\/td><td>0x10FF/);
assert.doesNotMatch(root.innerHTML, /Saved verified padding|Thread heap \/ stack/);

context._renderBootCapacity({
    denseBytes: 65536, totalWords: 16384, trusted: false,
    allocatedWords: 1234, freeWords: 456, warnings: [],
    rows: [{ slot: 7, name: 'Broken', allocatedWords: 128, locationWord: 16,
        status: 'verified' }, { slot: 9, name: 'Missing file',
        savedIssue: 'Exact selected artifact is missing',
        status: 'Exact selected artifact is missing' }],
});
assert.match(root.innerHTML, /Capacity not validated/);
assert.match(root.innerHTML, /Occupied \(including reserved\): Cannot validate/);
assert.match(root.innerHTML, /128 words \(512 bytes\)<\/td><td>0x10<\/td><td>0x8F/);
assert.match(root.innerHTML, /Installation unverified — Exact selected artifact is missing/);
context._renderBootCapacity({ denseBytes: null, rows: [], warnings: ['No image'] });
assert.match(root.innerHTML, /Cannot calculate — no committed boot image/);
context._renderBootCapacity({
    denseBytes: null, trusted: false, warnings: ['Invalid placement'],
    rows: [
        { slot: 13, name: 'M_BIT_DEV', entryKind: 'mmio',
            physicalByteAddress: 0xFFFFFF1C, status: 'Memory-mapped I/O — no LUMP RAM body' },
        { slot: 14, name: 'ide.Alice', imageEvidence: {
            locationWord: 1024, allocatedWords: 256, verifiedSelection: false },
            status: 'saved code words=8; image code words=9' },
    ],
});
assert.match(root.innerHTML, /M_BIT_DEV/);
assert.match(root.innerHTML, /0xFFFFFF1C \(physical byte address\)/);
assert.match(root.innerHTML, /Image evidence only \(not validated placement\): 0x400–0x4FF/);
assert.match(root.innerHTML, /saved code words=8; image code words=9/);
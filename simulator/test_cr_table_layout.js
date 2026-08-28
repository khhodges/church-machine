'use strict';

// Regression coverage for the CR table's visual grouping.  This deliberately
// renders the real updateCRDisplay function with a tiny simulator double so
// the assertion follows the browser table construction rather than a copied
// fixture.
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(__dirname + '/app-cr-display.js', 'utf8');
const container = { innerHTML: '' };
const fakeDocument = { getElementById: () => container };

// Keep the test independent of browser globals while executing the real
// renderer against a tiny simulator double.
const rendered = new Function(
    'sim', 'document', '_petNameCRMap', 'showCRPopup', 'hideCRPopup',
    `${source}; return updateCRDisplay;`
)(
    {
        getFormattedCR(i) {
            return {
                isNull: i !== 0,
                mBit: 0,
                word0_gt: i === 0 ? '02000001' : '00000000',
                perms: i === 0 ? 'R--' : '----',
                gtSeq: i === 0 ? 3 : 0,
                gtIndex: i === 0 ? 1 : 0,
                gtTypeName: i === 0 ? 'Inform' : 'NULL',
                word1_location: 0x100,
                limitB: 0,
                limitF: 0,
                limit17: 0xff,
                sealGtSeq: 3,
                sealCRC: 0x12345678,
            };
        },
        parseGT: () => ({ type: 1 }),
        programName: '',
    },
    fakeDocument,
    {},
    () => {},
    () => {},
);

rendered();
const html = container.innerHTML;
const crIndex = html.indexOf('>CR#</th>');
const gtGroupIndex = html.indexOf('GT FIELDS (R0)');
const crGroupIndex = html.indexOf('CR / SLOT FIELDS');
const columnHeader = html.slice(html.indexOf('</tr><tr>') + 10, html.indexOf('</tr></thead>'));
const gtIndex = columnHeader.indexOf('>GT</th>');
const slotIndex = columnHeader.indexOf('>NS Slot</th>');
const mIndex = columnHeader.indexOf('>M</th>');

assert(crIndex >= 0, 'CR# heading is present');
assert(gtGroupIndex > crIndex, 'GT group follows CR#');
assert(crGroupIndex > gtGroupIndex, 'CR / slot group follows the GT group');
assert(gtIndex >= 0 && slotIndex > gtIndex, 'slot heading follows the GT heading');
assert(mIndex > slotIndex, 'CR fields follow the GT and slot headings');
assert(html.includes('0x02000001'), 'GT value remains rendered');
assert(html.includes('[R--]'), 'GT permissions remain rendered');
assert(html.includes('0x00000100'), 'CR slot location remains rendered');

console.log('PASS CR table layout');
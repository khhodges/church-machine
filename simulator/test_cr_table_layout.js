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
                isNull: i > 5,
                mBit: 0,
                word0_gt: i <= 5 ? '02000001' : '00000000',
                perms: i === 0 ? 'R--' : i <= 5 ? '-E-----' : '-------',
                gtSeq: i === 0 ? 3 : i <= 5 ? 4 : 0,
                gtIndex: i <= 3 ? i + 1 : 0,
                nsSlot: i <= 3 ? i + 1 : null,
                nsLabel: i === 0 ? 'Target.Abs' : '',
                nsVersion: i === 0 ? 3 : i === 1 ? 5 : null,
                versionMatch: i === 0,
                validationStatus: i === 0 ? 'valid' : i === 1 ? 'stale' : i === 2 ? 'missing'
                    : i === 3 ? 'malformed' : i === 4 ? 'revoked' : undefined,
                validationMessage: i === 0 ? 'GT version 3 matches live NS version 3' : '',
                gtTypeName: i === 5 ? 'Abstract' : i <= 4 ? 'Inform' : 'NULL',
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
assert(html.includes('NS[1]'), 'CR target includes the Namespace slot');
assert(html.includes('Target.Abs'), 'CR target includes the Namespace label');
assert(html.includes('cr-version-valid'), 'matching version receives a success badge');
assert(html.includes('&#x2713; v3 / NS v3'), 'matching version displays a check mark and comparison');
assert(html.includes('cr-version-stale'), 'stale version receives a non-success badge');
assert(html.includes('cr-version-missing'), 'missing Namespace entry receives a non-success badge');
assert(html.includes('cr-version-malformed'), 'malformed GT receives a non-success badge');
assert(html.includes('cr-version-revoked'), 'revoked Namespace entry receives a non-success badge');
assert(html.includes('cr-version-unavailable'), 'incomplete validation receives a non-success badge');
assert(html.includes('Abstract GT'), 'abstract GTs do not render a Namespace target');
assert.strictEqual((html.match(/cr-version-valid/g) || []).length, 1,
    'only the matching version receives a success badge');
assert(html.includes('class="cr-version-neutral"'), 'NULL rows remain readable without validation');

console.log('PASS CR table layout');